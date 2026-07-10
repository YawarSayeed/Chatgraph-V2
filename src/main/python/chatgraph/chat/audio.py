"""Audio I/O and voice-activity detection for the chatgraph voice loop.

- ``AudioInput`` captures 16 kHz mono PCM from the default microphone and
  exposes it as an async stream of int16 frames.
- ``AudioOutput`` plays 16 kHz mono PCM through the default speaker. Playback
  is cancellable: calling ``stop()`` drops any buffered audio immediately,
  which is the barge-in mechanism.
- ``VAD`` wraps the Silero VAD model and reports speech / silence per frame,
  plus a high-level "user just started speaking" edge event.

All buffers are 20 ms frames of int16 PCM at 16 kHz (320 samples).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

import numpy as np
import sounddevice as sd
import torch
from silero_vad import load_silero_vad

log = logging.getLogger(__name__)


SAMPLE_RATE = 16_000
FRAME_MS = 20
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # 320 samples per frame
# Silero VAD expects 512-sample windows at 16 kHz (32 ms). We buffer one
# 512-sample window across two 20 ms frames.
VAD_WINDOW_SAMPLES = 512


@dataclass(frozen=True)
class VADReport:
    """Per-frame VAD verdict."""

    is_speech: bool
    speech_started: bool  # rising edge (silence -> speech)
    speech_ended: bool  # falling edge (speech -> silence)


class AudioInput:
    """Async microphone capture as 20 ms int16 frames at 16 kHz."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=200)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stream: sd.InputStream | None = None

    def _on_audio(
        self, indata: np.ndarray, frames: int, time_info, status
    ) -> None:
        if status:
            # Buffer over/underflow; not fatal.
            pass
        # indata is float32 in [-1, 1] when no dtype override; we requested int16.
        pcm = bytes(indata)
        if self._loop is not None:
            try:
                self._loop.call_soon_threadsafe(self._queue.put_nowait, pcm)
            except asyncio.QueueFull:
                # Drop the frame rather than block the audio thread.
                pass

    async def __aenter__(self) -> AudioInput:
        self._loop = asyncio.get_running_loop()
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=FRAME_SAMPLES,
            callback=self._on_audio,
        )
        self._stream.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    async def frames(self) -> AsyncIterator[bytes]:
        while True:
            yield await self._queue.get()


class AudioOutput:
    """Async speaker playback for 16 kHz mono int16 PCM.

    Call ``write(pcm)`` to enqueue audio, ``stop()`` to discard the queue and
    cut playback immediately (used for barge-in).
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._stream: sd.OutputStream | None = None
        self._writer_task: asyncio.Task[None] | None = None
        # idle_event is set when the writer has no pending chunks and no
        # in-flight blocking write. Used by speak-and-wait callers that
        # want to know when the speaker is actually quiet (the queue going
        # empty isn't enough -- a chunk can be playing in sounddevice's
        # buffer for hundreds of ms).
        self._idle_event: asyncio.Event = asyncio.Event()
        self._idle_event.set()

    async def __aenter__(self) -> AudioOutput:
        self._stream = sd.OutputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=FRAME_SAMPLES,
        )
        self._stream.start()
        self._writer_task = asyncio.create_task(self._writer())
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self._queue.put(None)
        if self._writer_task is not None:
            try:
                await self._writer_task
            except asyncio.CancelledError:
                pass
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    async def _writer(self) -> None:
        loop = asyncio.get_running_loop()
        n = 0
        while True:
            chunk = await self._queue.get()
            if chunk is None:
                log.debug("AudioOutput._writer: shutdown sentinel, exiting")
                return
            self._idle_event.clear()
            n += 1
            log.debug("AudioOutput._writer: writing chunk #%d (%d bytes)", n, len(chunk))
            # sounddevice's write is blocking; run it on a thread so we don't
            # stall the event loop while a long chunk plays.
            await loop.run_in_executor(None, self._blocking_write, chunk)
            # If the queue is empty now, we're idle.
            if self._queue.empty():
                self._idle_event.set()

    async def wait_until_idle(self) -> None:
        """Block until the queue is empty and the writer has finished its
        current chunk."""
        await self._idle_event.wait()

    def _blocking_write(self, chunk: bytes) -> None:
        if self._stream is None:
            return
        arr = np.frombuffer(chunk, dtype=np.int16)
        self._stream.write(arr.reshape(-1, 1))

    async def write(self, pcm: bytes) -> None:
        self._idle_event.clear()
        await self._queue.put(pcm)

    def stop(self) -> None:
        """Drop queued audio and cut current playback ASAP.

        sounddevice's OutputStream doesn't expose a 'flush', so the current
        in-flight chunk will finish playing. To minimise the audible tail,
        we keep chunks short (TTS streaming produces ~50-100 ms frames).
        """
        dropped = 0
        try:
            while True:
                self._queue.get_nowait()
                dropped += 1
        except asyncio.QueueEmpty:
            pass
        if dropped:
            log.warning(
                "AudioOutput.stop(): dropped %d queued chunks", dropped,
            )
        else:
            log.debug("AudioOutput.stop(): queue was already empty")
        # Signal idle to unblock anyone waiting on wait_until_idle().
        self._idle_event.set()


class VAD:
    """Silero VAD wrapper for streaming 20 ms frames at 16 kHz.

    Internal state machine tracks the current speech/silence status and
    emits rising-edge / falling-edge signals.
    """

    SPEECH_THRESHOLD = 0.5
    SILENCE_THRESHOLD = 0.35  # hysteresis to avoid flapping
    # How many consecutive silence frames before we say speech ended.
    SILENCE_HANGOVER_FRAMES = 8  # 160 ms

    def __init__(self) -> None:
        self._model = load_silero_vad(onnx=False)
        self._buf = np.zeros(0, dtype=np.float32)
        self._in_speech = False
        self._silence_run = 0

    def process(self, frame_pcm: bytes) -> VADReport:
        # Append this 20 ms frame to the buffer and consume full 512-sample
        # windows. With 320-sample frames, every other call produces a
        # window. We score one window per call when available; otherwise
        # we hold over the prior state.
        samples = np.frombuffer(frame_pcm, dtype=np.int16).astype(np.float32) / 32768.0
        self._buf = np.concatenate([self._buf, samples])

        score: float | None = None
        if len(self._buf) >= VAD_WINDOW_SAMPLES:
            window = self._buf[:VAD_WINDOW_SAMPLES]
            self._buf = self._buf[VAD_WINDOW_SAMPLES:]
            with torch.no_grad():
                score = float(
                    self._model(torch.from_numpy(window), SAMPLE_RATE).item()
                )

        if score is None:
            # No verdict this frame; preserve current state.
            return VADReport(
                is_speech=self._in_speech, speech_started=False, speech_ended=False
            )

        was_in_speech = self._in_speech
        if self._in_speech:
            if score < self.SILENCE_THRESHOLD:
                self._silence_run += 1
                if self._silence_run >= self.SILENCE_HANGOVER_FRAMES:
                    self._in_speech = False
                    self._silence_run = 0
            else:
                self._silence_run = 0
        else:
            if score > self.SPEECH_THRESHOLD:
                self._in_speech = True
                self._silence_run = 0

        return VADReport(
            is_speech=self._in_speech,
            speech_started=(not was_in_speech) and self._in_speech,
            speech_ended=was_in_speech and (not self._in_speech),
        )
