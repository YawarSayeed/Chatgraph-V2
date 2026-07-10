"""Deepgram Flux streaming STT.

Flux is Deepgram's conversational-speech model. It provides contextual
turn detection out of the box, emitting a small alphabet of events:

- ``StartOfTurn`` -- user has begun speaking this turn
- ``Update`` -- interim transcript, no turn-state change
- ``EagerEndOfTurn`` -- moderate confidence the user is done; an opportunity
  to start preparing an agent reply optimistically
- ``TurnResumed`` -- a previously-issued EagerEndOfTurn was wrong; the user
  is still speaking
- ``EndOfTurn`` -- confirmed end of the user's turn

This module wraps Deepgram's V2SocketClient (synchronous) as an async
producer of structured ``FluxEvent`` values consumable by the orchestrator.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import AsyncIterator
from dataclasses import dataclass

from deepgram import DeepgramClient

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class FluxEvent:
    """A turn-state event from Deepgram Flux."""

    kind: str  # one of: StartOfTurn, Update, EagerEndOfTurn, TurnResumed, EndOfTurn
    transcript: str
    turn_index: int
    end_of_turn_confidence: float
    audio_window_start: float
    audio_window_end: float


def _event_from_dict(d: dict) -> FluxEvent:
    return FluxEvent(
        kind=d.get("event", ""),
        transcript=d.get("transcript", ""),
        turn_index=int(d.get("turn_index", 0)),
        end_of_turn_confidence=float(d.get("end_of_turn_confidence", 0.0)),
        audio_window_start=float(d.get("audio_window_start", 0.0)),
        audio_window_end=float(d.get("audio_window_end", 0.0)),
    )


class DeepgramFluxSTT:
    """Async wrapper around Deepgram's Flux V2 streaming client.

    Usage::

        async with DeepgramFluxSTT() as stt:
            async def feeder():
                async for frame in audio_input.frames():
                    await stt.send(frame)
            asyncio.create_task(feeder())
            async for event in stt.events():
                ...

    The Deepgram SDK exposes a synchronous socket client; we run its
    receive loop on a worker thread and bridge events back into asyncio.
    """

    MODEL = "flux-general-en"
    ENCODING = "linear16"
    SAMPLE_RATE = 16_000

    def __init__(self, api_key: str | None = None) -> None:
        self._api_key = api_key or os.environ.get("DEEPGRAM_API_KEY")
        if not self._api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is not set")
        self._client = DeepgramClient(api_key=self._api_key)
        self._socket = None
        self._cm = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._events: asyncio.Queue[FluxEvent | None] = asyncio.Queue()
        self._recv_thread: threading.Thread | None = None
        self._closed = False

    async def __aenter__(self) -> DeepgramFluxSTT:
        self._loop = asyncio.get_running_loop()
        log.info(
            "Connecting to Deepgram Flux (model=%s, sample_rate=%d)...",
            self.MODEL,
            self.SAMPLE_RATE,
        )

        # listen.v2.connect() is synchronous and blocks on a WebSocket
        # handshake. Run it on a worker thread so the asyncio loop stays
        # responsive (signal handlers, cancellation), and bound it with a
        # timeout so a stalled handshake can never wedge the program.
        #
        # NOTE: do NOT call sock.start_listening() here. That method IS
        # the blocking receive loop (it dispatches messages to handlers
        # registered via sock.on()); calling it wedges the worker forever.
        # We use the pull-based API (sock.recv()) on our own recv thread.
        def _do_connect():
            cm = self._client.listen.v2.connect(
                model=self.MODEL,
                encoding=self.ENCODING,
                sample_rate=self.SAMPLE_RATE,
            )
            sock = cm.__enter__()
            return cm, sock

        try:
            self._cm, self._socket = await asyncio.wait_for(
                self._loop.run_in_executor(None, _do_connect),
                timeout=15.0,
            )
        except asyncio.TimeoutError:
            log.error(
                "Deepgram Flux connect timed out after 15s. Check network, "
                "DEEPGRAM_API_KEY, and Flux access on your account."
            )
            raise
        except Exception:
            log.exception("Failed to connect to Deepgram Flux")
            raise

        log.info("Deepgram Flux socket established.")
        self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
        self._recv_thread.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        self._closed = True
        if self._socket is not None:
            try:
                self._socket.send_close_stream()
            except Exception:
                pass
        if self._cm is not None:
            try:
                self._cm.__exit__(exc_type, exc, tb)
            except Exception:
                pass
        # Wake any pending events() consumer.
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._events.put_nowait, None)

    def _recv_loop(self) -> None:
        # Deepgram's V2 socket recv() returns the parsed pydantic object when
        # construct_type succeeds and the raw dict otherwise (and as of
        # deepgram-sdk 7.1.1 the union deserialization regularly fails,
        # leaving us with dicts). Dispatch on the dict's "type" field so we
        # work in both shapes.
        assert self._socket is not None
        assert self._loop is not None
        try:
            while not self._closed:
                msg = self._socket.recv()
                if msg is None:
                    log.info("Deepgram socket: server closed the stream.")
                    break
                d = msg if isinstance(msg, dict) else getattr(msg, "model_dump", lambda: {})()
                kind = d.get("type") if isinstance(d, dict) else None
                if kind == "TurnInfo":
                    event = _event_from_dict(d)
                    self._loop.call_soon_threadsafe(self._events.put_nowait, event)
                elif kind == "Connected":
                    log.info("Deepgram Flux connected (request_id=%s).", d.get("request_id"))
                elif kind == "ConfigureFailure":
                    log.error("Deepgram Flux configure failure: %r", d)
                    break
                elif kind == "FatalError":
                    log.error("Deepgram Flux fatal error: %r", d)
                    break
                else:
                    log.debug("Deepgram Flux unhandled message: %r", msg)
        except Exception:
            if not self._closed:
                log.exception("Deepgram receive loop crashed")
        finally:
            if self._loop is not None:
                self._loop.call_soon_threadsafe(self._events.put_nowait, None)

    async def send(self, pcm: bytes) -> None:
        """Send a frame of 16 kHz mono int16 PCM to Deepgram."""
        if self._socket is None or self._closed:
            return
        # send_media is synchronous; do it on the default executor so we
        # don't stall the audio loop.
        assert self._loop is not None
        await self._loop.run_in_executor(None, self._socket.send_media, pcm)

    async def events(self) -> AsyncIterator[FluxEvent]:
        while True:
            event = await self._events.get()
            if event is None:
                return
            yield event
