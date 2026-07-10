"""Standalone diagnostic for chatgraph.

Runs each external dependency in isolation, prints results, and exits.
No microphone, no asyncio orchestration. Useful for triaging which
component is failing before running the full voice loop.

Usage::

    cd /path/to/chatgraph
    source .venv/bin/activate
    export HYDRAPOP_HOME=/path/to/HydraPop
    python bin/diagnose.py
"""

import asyncio
import logging
import os
import sys
import time
from pathlib import Path

# Make sure we get every log line and they're flushed promptly.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stderr)],
    force=True,
)
try:
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    sys.stderr.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
except AttributeError:
    pass

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def check(name: str, ok: bool, detail: str = "") -> None:
    mark = "OK" if ok else "FAIL"
    print(f"[{mark}] {name}{(': ' + detail) if detail else ''}", flush=True)


def check_env() -> bool:
    all_ok = True
    for var in ("ANTHROPIC_API_KEY", "DEEPGRAM_API_KEY", "OPENAI_API_KEY"):
        v = os.environ.get(var, "")
        ok = bool(v)
        check(f"env {var}", ok, f"length={len(v)}" if ok else "(not set)")
        all_ok = all_ok and ok
    check("env HYDRAPOP_HOME", bool(os.environ.get("HYDRAPOP_HOME")),
          os.environ.get("HYDRAPOP_HOME", "(not set)"))
    return all_ok and bool(os.environ.get("HYDRAPOP_HOME"))


def check_audio() -> None:
    try:
        import sounddevice as sd

        devs = sd.query_devices()
        default_in = sd.default.device[0] if isinstance(sd.default.device, (list, tuple)) else None
        default_out = sd.default.device[1] if isinstance(sd.default.device, (list, tuple)) else None
        check("sounddevice import", True, f"{len(devs)} devices")
        if default_in is not None:
            check("default input", True, str(devs[default_in]["name"]))
        if default_out is not None:
            check("default output", True, str(devs[default_out]["name"]))
        # Quick open/close test on output (no audio played).
        import numpy as np

        s = sd.OutputStream(samplerate=16000, channels=1, dtype="int16", blocksize=320)
        s.start()
        s.write(np.zeros((320, 1), dtype=np.int16))
        s.stop()
        s.close()
        check("output stream open/close", True)
    except Exception as e:
        check("audio", False, f"{type(e).__name__}: {e}")


def check_deepgram() -> None:
    """Measure the Deepgram WebSocket connect + Connected message.

    Bounds the recv() with a thread + timeout so a stalled handshake or
    missing Connected message can't wedge the diagnostic.
    """
    try:
        from deepgram import DeepgramClient
        import threading

        c = DeepgramClient(api_key=os.environ["DEEPGRAM_API_KEY"])
        t0 = time.monotonic()
        with c.listen.v2.connect(
            model="flux-general-en", encoding="linear16", sample_rate=16000
        ) as sock:
            connect_elapsed = time.monotonic() - t0
            # NB: sock.start_listening() is the blocking event-dispatch loop;
            # don't call it. We use pull-based recv() instead.
            # Read one message with a thread-bounded timeout.
            msg_box: list = [None]
            err_box: list = [None]

            def _do_recv():
                try:
                    msg_box[0] = sock.recv()
                except BaseException as e:
                    err_box[0] = e

            tr = threading.Thread(target=_do_recv, daemon=True)
            tr.start()
            tr.join(timeout=5.0)
            if tr.is_alive():
                check(
                    "deepgram connect",
                    False,
                    f"connect OK ({connect_elapsed:.2f}s) but no message "
                    f"received in 5s after start_listening",
                )
                return
            if err_box[0] is not None:
                raise err_box[0]
            msg = msg_box[0]
            elapsed = time.monotonic() - t0
            kind = msg.get("type") if isinstance(msg, dict) else type(msg).__name__
            check(
                "deepgram connect",
                True,
                f"{elapsed:.2f}s (connect={connect_elapsed:.2f}s), first message: {kind}",
            )
    except Exception as e:
        check("deepgram connect", False, f"{type(e).__name__}: {e}")


async def check_openai_tts() -> None:
    try:
        from openai import AsyncOpenAI

        c = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        t0 = time.monotonic()
        total = 0
        # Match the runtime TTS model in chatgraph/chat/tts.py so that
        # this diagnostic actually exercises what the demo will use.
        async with c.audio.speech.with_streaming_response.create(
            model="tts-1",
            voice=os.environ.get("CHATGRAPH_TTS_VOICE", "nova"),
            input="Diagnostic.",
            response_format="pcm",
        ) as r:
            async for chunk in r.iter_bytes(chunk_size=4096):
                total += len(chunk)
        elapsed = time.monotonic() - t0
        check("openai tts", True, f"{elapsed:.2f}s, {total} bytes")
    except Exception as e:
        check("openai tts", False, f"{type(e).__name__}: {e}")


async def check_anthropic() -> None:
    try:
        from anthropic import AsyncAnthropic

        c = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        model = os.environ.get("CHATGRAPH_AGENT_MODEL", "claude-sonnet-4-6")
        t0 = time.monotonic()
        r = await c.messages.create(
            model=model,
            max_tokens=20,
            messages=[{"role": "user", "content": "Say 'ok' and nothing else."}],
        )
        elapsed = time.monotonic() - t0
        text = "".join(b.text for b in r.content if hasattr(b, "text"))
        check("anthropic", True, f"{elapsed:.2f}s, model={model}, reply={text!r}")
    except Exception as e:
        check("anthropic", False, f"{type(e).__name__}: {e}")


async def check_gremlin() -> None:
    """Connect to the local Gremlin Server and count vertices.

    Expects the server to be running:
        export GREMLIN_SERVER_HOME=/path/to/apache-tinkerpop-gremlin-server-3.7.3
        "$GREMLIN_SERVER_HOME/bin/gremlin-server.sh" \\
          "$GREMLIN_SERVER_HOME/conf/chatgraph-gremlin-server.yaml"

    gremlinpython uses its own asyncio event loop internally; doing this from
    the diagnostic's loop deadlocks with "Cannot run the event loop while
    another loop is running". Offload to a worker thread.
    """

    def _check():
        from gremlin_python.driver.driver_remote_connection import (
            DriverRemoteConnection,
        )
        from gremlin_python.process.anonymous_traversal import traversal

        conn = DriverRemoteConnection("ws://localhost:8182/gremlin", "g")
        try:
            g = traversal().with_remote(conn)
            return g.V().count().next()
        finally:
            conn.close()

    try:
        count = await asyncio.get_running_loop().run_in_executor(None, _check)
        check("gremlin server", True, f"vertex count = {count}")
    except Exception as e:
        check("gremlin server", False, f"{type(e).__name__}: {e}")


async def main() -> int:
    print("--- chatgraph diagnostics ---", flush=True)
    if not check_env():
        print("(env incomplete; continuing diagnostics anyway)", flush=True)
    check_audio()
    check_deepgram()
    await check_gremlin()
    await check_anthropic()
    await check_openai_tts()
    print("--- done ---", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
