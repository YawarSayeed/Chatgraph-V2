"""Two-participant conversation transcript writer.

Writes three files in parallel, all sharing one ``<session>`` timestamp:

- ``transcripts/<session>.txt`` -- human-readable, one utterance per
  paragraph, ``speaker: text`` formatting.
- ``transcripts/<session>.jsonl`` -- JSON Lines, one utterance per line with
  start/end timestamps and an ``interrupted`` flag for agent turns that
  were cut short by barge-in.
- ``transcripts/<session>.log`` -- the raw diagnostic log for the
  session (DEBUG and up), so errors and warnings that scroll past on the
  console are captured durably. The ``.txt`` / ``.jsonl`` files stay
  clean conversation transcripts; everything operational (extractor
  validation failures, STT/TTS/agent errors, per-turn detail) goes here
  instead. Plain text -- no ANSI color codes, regardless of the console.

The two transcript files are append-only and each ``write(utterance)``
flushes immediately so partial transcripts survive a crash. The ``.log``
file is fed by a :class:`logging.Handler` (``log_handler``) that the
caller attaches to the root logger.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Utterance:
    speaker: str  # "patient" or "agent"
    text: str
    ts_start: float
    ts_end: float
    interrupted: bool = False


class TranscriptWriter:
    def __init__(self, session_dir: Path | None = None) -> None:
        if session_dir is None:
            session_dir = Path("transcripts")
        session_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        self._txt = (session_dir / f"{stamp}.txt").open("a", encoding="utf-8")
        self._jsonl = (session_dir / f"{stamp}.jsonl").open("a", encoding="utf-8")
        self.txt_path = Path(self._txt.name)
        self.jsonl_path = Path(self._jsonl.name)

        # Per-session diagnostic log. The handler is created here (so it
        # shares the session stamp) but attached to the root logger by the
        # caller; it captures everything at DEBUG and up, in plain text.
        self.log_path = session_dir / f"{stamp}.log"
        self.log_handler: logging.Handler = logging.FileHandler(
            self.log_path, encoding="utf-8"
        )
        self.log_handler.setLevel(logging.DEBUG)
        self.log_handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s: %(message)s",
                datefmt="%H:%M:%S",
            )
        )

    def write(self, u: Utterance) -> None:
        # During shutdown a coroutine may race to write an utterance after
        # close() has run; ignore those writes rather than crashing.
        if self._txt.closed or self._jsonl.closed:
            return
        suffix = " [interrupted]" if u.interrupted else ""
        self._txt.write(f"{u.speaker}: {u.text}{suffix}\n\n")
        self._txt.flush()
        self._jsonl.write(
            json.dumps(
                {
                    "speaker": u.speaker,
                    "text": u.text,
                    "ts_start": u.ts_start,
                    "ts_end": u.ts_end,
                    "interrupted": u.interrupted,
                }
            )
            + "\n"
        )
        self._jsonl.flush()

    def close(self) -> None:
        self._txt.close()
        self._jsonl.close()
        # Detach from the root logger before closing so no later record
        # tries to write to a closed file, then release the file handle.
        logging.getLogger().removeHandler(self.log_handler)
        self.log_handler.close()

    def __enter__(self) -> TranscriptWriter:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
