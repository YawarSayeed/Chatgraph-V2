"""OpenAI streaming TTS with cancellable playback.

The original async implementation got stuck mid-stream: ``iter_bytes``
would yield two HTTP chunks and then sit on the open connection forever,
apparently because httpx/httpcore wasn't getting fair scheduling on an
event loop that was also driving a Deepgram WebSocket.

The fix: use the synchronous OpenAI client on a worker thread, push
audio chunks to an ``asyncio.Queue``, and pump that queue from the
caller's coroutine. The asyncio loop stays free for other work; the
HTTP body drains on its own thread.

Cancellation: cancelling the caller's task signals the worker thread
via ``_cancel``; the worker exits its iteration loop and the HTTP
response context closes. Already-queued audio is dropped via
``output.stop()``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import AsyncIterator

from openai import OpenAI

from chatgraph.chat.audio import AudioOutput, SAMPLE_RATE

log = logging.getLogger(__name__)

# tts-1 is the older but much faster + more consistent TTS model. Typical
# first-byte latency 200-400ms and audio arrives faster than realtime.
# (gpt-4o-mini-tts produces nicer audio but has had 5-30s first-byte
# latency in practice; see the README notes.) Available voices on tts-1:
# alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer.
# Set CHATGRAPH_TTS_VOICE to override.
MODEL = "tts-1"
DEFAULT_VOICE = "nova"

# Playback speed multiplier passed to OpenAI TTS (tts-1 accepts 0.25-4.0;
# 1.0 is normal pace). Default is a touch brisk so the agent sounds
# punchy rather than ponderous; override with CHATGRAPH_TTS_SPEED.
DEFAULT_SPEED = 1.15
_SPEED_MIN = 0.25
_SPEED_MAX = 4.0


def _resolve_speed() -> float:
    """Read CHATGRAPH_TTS_SPEED, falling back to DEFAULT_SPEED, clamped to
    the range OpenAI accepts. A malformed value logs a warning and uses
    the default rather than crashing the session."""
    raw = os.environ.get("CHATGRAPH_TTS_SPEED")
    if not raw:
        return DEFAULT_SPEED
    try:
        speed = float(raw)
    except ValueError:
        log.warning(
            "CHATGRAPH_TTS_SPEED=%r is not a number; using default %.2f",
            raw, DEFAULT_SPEED,
        )
        return DEFAULT_SPEED
    clamped = max(_SPEED_MIN, min(_SPEED_MAX, speed))
    if clamped != speed:
        log.warning(
            "CHATGRAPH_TTS_SPEED=%s out of range [%.2f, %.2f]; clamped to %.2f",
            speed, _SPEED_MIN, _SPEED_MAX, clamped,
        )
    return clamped

# OpenAI returns 24 kHz PCM when response_format="pcm". We resample down
# to 16 kHz for the AudioOutput at write time.
OPENAI_SAMPLE_RATE = 24_000


def _downsample_24k_to_16k(pcm24: bytes) -> bytes:
    """Crude 24 kHz -> 16 kHz int16 downsample (3:2 decimation).

    Drops one of every three samples after a tiny low-pass average.
    Adequate for speech; not audiophile quality.
    """
    import numpy as np

    if not pcm24:
        return pcm24
    arr = np.frombuffer(pcm24, dtype=np.int16)
    n = (len(arr) // 3) * 3
    if n == 0:
        return b""
    arr = arr[:n].astype(np.int32).reshape(-1, 3)
    out = np.empty((arr.shape[0], 2), dtype=np.int16)
    out[:, 0] = ((arr[:, 0] + arr[:, 1]) // 2).astype(np.int16)
    out[:, 1] = ((arr[:, 1] + arr[:, 2]) // 2).astype(np.int16)
    return out.reshape(-1).tobytes()


class OpenAITTS:
    def __init__(self, api_key: str | None = None, voice: str | None = None) -> None:
        api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        # The synchronous client; we run its blocking stream on a worker
        # thread to avoid contending for the asyncio loop's attention.
        self._client = OpenAI(api_key=api_key)
        self._voice = voice or os.environ.get("CHATGRAPH_TTS_VOICE") or DEFAULT_VOICE
        self._speed = _resolve_speed()

    async def warmup(self) -> None:
        """Fire a tiny TTS request to warm OpenAI's TLS connection and
        model cache, so the first user-facing request doesn't pay the
        cold-start tax (which we've seen reach 25+ seconds).

        Runs on a worker thread; safe to call before the asyncio loop is
        otherwise busy.
        """
        loop = asyncio.get_running_loop()

        def _warm() -> None:
            try:
                with self._client.audio.speech.with_streaming_response.create(
                    model=MODEL, voice=self._voice, input=".",
                    response_format="pcm", speed=self._speed,
                ) as response:
                    # Drain the body so the connection is fully primed.
                    for _ in response.iter_bytes(chunk_size=4096):
                        pass
                log.info("OpenAITTS: warmup complete")
            except Exception:
                log.exception("OpenAITTS: warmup failed (non-fatal)")

        log.info("OpenAITTS: warming up...")
        await loop.run_in_executor(None, _warm)

    async def speak(self, text: str, output: AudioOutput) -> None:
        """Synthesize ``text`` and stream it to the speaker. Cancellable.

        On cancellation, the worker thread is signalled to stop, the HTTP
        stream closes, and ``output.stop()`` drops queued audio.
        """
        cancel_event = threading.Event()
        try:
            await self._speak_one(text, output, cancel_event)
        except asyncio.CancelledError:
            cancel_event.set()
            output.stop()
            raise

    async def speak_stream(
        self, text_chunks: AsyncIterator[str], output: AudioOutput
    ) -> None:
        """Speak an async stream of text chunks, synthesizing each as soon
        as it arrives so playback starts before the whole reply exists.

        The caller supplies an async iterator that yields ready-to-speak
        fragments (typically whole sentences split off a streaming LLM
        reply). Each fragment is synthesized and written to ``output`` in
        order; because ``AudioOutput`` plays its queue back-to-back, the
        first fragment begins playing while later fragments are still being
        produced upstream. This collapses the perceived gap from "first
        byte of the entire reply" to "first byte of the first sentence".

        Cancellable across the whole stream: a cancel stops the in-flight
        synthesis, drops queued audio, and halts consumption of further
        fragments (barge-in).
        """
        cancel_event = threading.Event()
        try:
            async for chunk in text_chunks:
                if cancel_event.is_set():
                    break
                chunk = chunk.strip()
                if not chunk:
                    continue
                await self._speak_one(chunk, output, cancel_event)
        except asyncio.CancelledError:
            cancel_event.set()
            output.stop()
            raise

    async def _speak_one(
        self, text: str, output: AudioOutput, cancel_event: threading.Event
    ) -> None:
        """Synthesize one text fragment and write its audio to ``output``.

        Shared by :meth:`speak` and :meth:`speak_stream`. ``cancel_event``
        is owned by the caller so a single barge-in can stop a multi-chunk
        stream; this method signals it on its own cancellation too, then
        re-raises so the caller's handler runs.
        """
        loop = asyncio.get_running_loop()
        # The async-iteration consumer awaits chunks here; the worker
        # thread feeds it. None signals EOF (clean end or cancellation).
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=64)

        def _producer() -> None:
            chunks_seen = 0
            try:
                with self._client.audio.speech.with_streaming_response.create(
                    model=MODEL,
                    voice=self._voice,
                    input=text,
                    response_format="pcm",
                    speed=self._speed,
                ) as response:
                    for chunk in response.iter_bytes(chunk_size=4096):
                        if cancel_event.is_set():
                            return
                        if not chunk:
                            continue
                        chunks_seen += 1
                        loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except Exception:
                if not cancel_event.is_set():
                    log.exception("OpenAITTS producer crashed")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        producer = threading.Thread(target=_producer, daemon=True)
        producer.start()

        try:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    return
                if SAMPLE_RATE == OPENAI_SAMPLE_RATE:
                    await output.write(chunk)
                else:
                    await output.write(_downsample_24k_to_16k(chunk))
        except asyncio.CancelledError:
            cancel_event.set()
            # Drain whatever the producer might still push.
            try:
                while True:
                    queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            raise
