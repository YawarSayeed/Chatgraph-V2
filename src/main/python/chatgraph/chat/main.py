"""Orchestrator and CLI entry point for the chatgraph voice loop.

Single asyncio event loop. Five concurrent activities, coordinated through
asyncio primitives:

1. Audio capture (sounddevice -> async frame queue).
2. Deepgram Flux STT (frames -> turn events).
3. Local Silero VAD (frames -> fast barge-in signal).
4. Agent reply (Claude Sonnet streaming -> OpenAI streaming TTS).
5. Transcript writer.

State machine for the agent: ``idle`` -> ``preparing`` (Claude generation in
flight after EagerEndOfTurn) -> ``speaking`` (TTS playback after EndOfTurn).

Barge-in: local VAD's speech-onset edge cancels TTS playback immediately
(low latency); Flux's StartOfTurn cancels any in-flight generation. The
patient's turn proceeds normally.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import signal
import sys
import time
from collections.abc import AsyncIterator

from dotenv import load_dotenv

from chatgraph.chat.agent import Agent, Conversation
from chatgraph.chat.audio import VAD, AudioInput, AudioOutput
from chatgraph.chat.extractor import Extractor, RollingContext
from chatgraph.chat.graph_writer import GremlinWriter
from chatgraph.chat.stt import DeepgramFluxSTT, FluxEvent
from chatgraph.chat.transcript import TranscriptWriter, Utterance
from chatgraph.chat.tts import OpenAITTS

log = logging.getLogger(__name__)


class _ColorFormatter(logging.Formatter):
    """Log formatter that wraps WARNING/ERROR lines in ANSI color.

    WARNING is yellow; ERROR and CRITICAL are red. Other levels are left
    uncolored. When ``use_color`` is False the formatter behaves exactly
    like a plain ``logging.Formatter`` (used when stderr is not a TTY, so
    redirected output and log files stay clean).
    """

    _RESET = "\033[0m"
    _COLORS = {
        logging.WARNING: "\033[33m",   # yellow
        logging.ERROR: "\033[31m",     # red
        logging.CRITICAL: "\033[31m",  # red
    }

    def __init__(self, *args, use_color: bool = True, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._use_color = use_color

    def format(self, record: logging.LogRecord) -> str:
        text = super().format(record)
        if not self._use_color:
            return text
        color = self._COLORS.get(record.levelno)
        return f"{color}{text}{self._RESET}" if color else text


# Default log level for the CLI. Overridden by ``main()`` based on -v / -vv
# command-line flags, or by the CHATGRAPH_LOG_LEVEL env var (highest
# priority).
_DEFAULT_LOG_LEVEL = "WARNING"

# When True, ``run()`` drops everything in the Gremlin graph at startup
# before any resume logic runs. Set by ``main()`` from the --fresh flag.
_DROP_GRAPH_AT_STARTUP = False

# Domain name the CLI selected (e.g. ``"medical"``). Set by ``main()``;
# read by ``run()`` to construct the Agent and Extractor.
_DOMAIN_NAME: str | None = None


def _now() -> float:
    return time.monotonic()


class Coordinator:
    def __init__(
        self,
        agent: Agent,
        tts: "OpenAITTS",
        transcript: TranscriptWriter,
        audio_out: AudioOutput,
        extractor: Extractor | None = None,
        graph_writer: GremlinWriter | None = None,
    ) -> None:
        self._agent = agent
        self._tts = tts
        self._transcript = transcript
        self._audio_out = audio_out
        self._conversation = Conversation()

        # Phase 2: incremental graph extraction. extractor + graph_writer
        # are independent; either may be None. RollingContext threads the
        # current Headache id and last few turns to the extractor for
        # anaphora resolution.
        self._extractor = extractor
        self._graph_writer = graph_writer
        self._rolling = RollingContext()

        # Agent state and the in-flight task driving it.
        self._agent_task: asyncio.Task | None = None
        # When the agent is "speaking", this is the TTS task that we may need
        # to cancel on barge-in.
        self._tts_task: asyncio.Task | None = None
        # Buffered reply text from a "preparing" generation; if the patient
        # confirms EndOfTurn while preparing is still running, we await this
        # and then speak. If TurnResumed fires, we cancel it.
        self._prepared_text: asyncio.Future[str] | None = None

        # Current patient utterance accounting.
        self._patient_turn_start: float | None = None

        # True while TTS playback is active. macOS has no built-in acoustic
        # echo cancellation on the default mic capture path, so the agent's
        # own voice would otherwise (a) feed back into Silero VAD and
        # trigger spurious "barge-in" that cancels the agent mid-sentence,
        # and (b) feed back into Deepgram and get transcribed as the
        # patient's next utterance. While speaking, we therefore drop mic
        # frames from both the local VAD and the STT feed. Trade-off:
        # barge-in is delayed until the agent finishes its current turn.
        self.agent_speaking: bool = False

    def on_flux_event(self, event: FluxEvent, t0: float) -> None:
        """React to a Deepgram Flux turn event."""
        if event.kind == "StartOfTurn":
            if self._patient_turn_start is None:
                self._patient_turn_start = _now() - t0
            self._cancel_agent()

        elif event.kind == "Update":
            # Interim transcript update; nothing to do here besides UI.
            pass

        elif event.kind == "EagerEndOfTurn":
            # Optimistically begin preparing a reply.
            if self._prepared_text is None:
                self._begin_preparing(event.transcript)

        elif event.kind == "TurnResumed":
            # Patient kept talking; abandon the speculative generation.
            self._cancel_agent()

        elif event.kind == "EndOfTurn":
            self._finalize_patient_turn(event, t0)

    def on_local_speech_onset(self) -> None:
        """Fast barge-in: the patient started speaking again.

        Local VAD detects this faster than Flux's StartOfTurn (which has to
        round-trip through Deepgram). Cut TTS audio now -- unless we're the
        ones speaking, in which case the "speech" is our own audio leaking
        back through the mic.
        """
        if self.agent_speaking:
            log.debug("on_local_speech_onset: gated (agent_speaking=True)")
            return
        if self._tts_task is not None and not self._tts_task.done():
            log.warning("on_local_speech_onset: cancelling TTS task (barge-in)")
            self._tts_task.cancel()
            self._audio_out.stop()

    def _agent_extra_system(self) -> str | None:
        """Per-turn instructions for the agent that depend on session
        state (currently: whether the patient has signaled they're done).
        """
        if self._rolling.session_done:
            return (
                "The patient has indicated they are done discussing "
                "their headaches for now. Do NOT ask another clinical "
                "question. Briefly and warmly acknowledge what they "
                "said (one short sentence). If they resume substantive "
                "clinical content later you'll be told to start asking "
                "questions again; until then, just acknowledge whatever "
                "they say."
            )
        return None

    def _begin_preparing(self, partial_transcript: str) -> None:
        # Snapshot the conversation with the partial transcript as the
        # pending user turn. We'll re-do it on EndOfTurn with the final
        # transcript if it differs significantly.
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._prepared_text = future
        extra = self._agent_extra_system()

        async def _prepare() -> None:
            convo = Conversation(messages=list(self._conversation.messages))
            convo.add_user(partial_transcript)
            try:
                pieces: list[str] = []
                async for delta in self._agent.stream_reply(
                    convo, extra_system=extra,
                ):
                    pieces.append(delta)
                text = "".join(pieces).strip()
                if not future.done():
                    future.set_result(text)
            except asyncio.CancelledError:
                if not future.done():
                    future.cancel()
                raise
            except Exception as e:
                if not future.done():
                    future.set_exception(e)
                raise

        self._agent_task = asyncio.create_task(_prepare())

    def _cancel_agent(self) -> None:
        if self._agent_task is not None and not self._agent_task.done():
            self._agent_task.cancel()
        self._agent_task = None
        self._prepared_text = None
        if self._tts_task is not None and not self._tts_task.done():
            self._tts_task.cancel()
            self._audio_out.stop()
        self._tts_task = None

    def _finalize_patient_turn(self, event: FluxEvent, t0: float) -> None:
        text = event.transcript.strip()
        if not text:
            return
        ts_start = self._patient_turn_start or (_now() - t0)
        ts_end = _now() - t0
        self._patient_turn_start = None
        self._transcript.write(
            Utterance(
                speaker="patient",
                text=text,
                ts_start=ts_start,
                ts_end=ts_end,
            )
        )
        self._conversation.add_user(text)
        print(f"\npatient: {text}")

        # Phase 2: kick off graph extraction in the background. Don't
        # block the conversation; the agent reply path keeps running.
        self._rolling.add("patient", text)
        if self._extractor is not None and self._graph_writer is not None:
            asyncio.create_task(self._extract_and_write(text))

        # Speak the prepared reply if available; otherwise generate fresh.
        prepared = self._prepared_text
        self._prepared_text = None
        agent_task = self._agent_task
        self._agent_task = None
        asyncio.create_task(self._speak_reply(prepared, agent_task, t0))

    async def _extract_and_write(self, utterance: str) -> None:
        """Extract a graph delta from one patient utterance and write it.

        Fire-and-forget from the orchestrator. Logs success/failure;
        never raises.
        """
        assert self._extractor is not None  # gated by caller
        try:
            result = await self._extractor.extract(utterance, self._rolling)
        except Exception:
            log.exception("extractor: extract() raised; skipping write")
            return
        # Register any Headache vertices in this delta so subsequent
        # extractions reuse their ids rather than minting fresh ones.
        from hydra.pg.model import PropertyKey
        for v in result.delta.vertices.values():
            if v.label.value == "Headache":
                desc_lit = v.properties.get(PropertyKey("description"))
                label = desc_lit.value if desc_lit is not None else ""
                self._rolling.register_headache(v.id.value, label)
            elif v.label.value in self._rolling.BUCKET_LABELS:
                # Register the bucket; ownership will be filled in below
                # when we see which Headaches point at it via edges.
                self._rolling.register_bucket(v.label.value, v.id.value)

        # Wire Headache -> bucket ownership from the edges in this delta.
        # Any edge that points at a bucket vertex records the source
        # Headache as an owner of that bucket. The known_buckets map then
        # shows the LLM which bucket each pattern uses, so the next turn
        # can re-use an existing bucket instead of minting a parallel one.
        bucket_in_labels = self._rolling.BUCKET_LABELS
        for e in result.delta.edges.values():
            in_label = (
                result.delta.vertices.get(e.in_).label.value
                if e.in_ in result.delta.vertices
                else None
            )
            if in_label in bucket_in_labels:
                self._rolling.register_bucket(in_label, e.in_.value, e.out.value)

        if result.new_current_headache_id:
            self._rolling.current_headache_id = result.new_current_headache_id

        # Session-done state machine.
        if result.patient_signaled_done and not self._rolling.session_done:
            log.info("session: patient signaled done")
            self._rolling.session_done = True
        elif result.patient_resumed and self._rolling.session_done:
            log.info("session: patient resumed")
            self._rolling.session_done = False
        n_v = len(result.delta.vertices)
        n_e = len(result.delta.edges)
        if n_v == 0 and n_e == 0:
            log.info("extractor: empty delta for this turn")
            return
        log.info("extractor: writing delta (%d vertices, %d edges)", n_v, n_e)
        if self._graph_writer is not None:
            # submit() returns immediately; the writer's serial queue
            # guarantees this delta lands after prior submitted deltas,
            # so edges in this delta can safely reference vertices from
            # earlier turns.
            self._graph_writer.submit(result.delta)

    def add_agent_turn_to_context(self, text: str) -> None:
        """Record an agent reply in the rolling context so the extractor
        sees it as preceding history on the next patient turn. We do NOT
        extract from agent turns (per design); we only let the extractor
        observe them as anaphora context."""
        self._rolling.add("agent", text)

    def seed_from_graph(self, graph) -> bool:
        """Seed RollingContext + Conversation from the existing graph.

        Returns ``True`` if the graph is non-empty and seeding happened,
        ``False`` if there's nothing to resume from (caller should use
        the default greeting).

        The actual opening *spoken* line is generated separately by
        ``generate_resume_opening`` (an async LLM call).
        """
        if graph is None or len(graph.vertices) == 0:
            return False

        headaches = [
            v for v in graph.vertices.values() if v.label.value == "Headache"
        ]
        if headaches:
            from collections import Counter
            from hydra.pg.model import PropertyKey
            edge_counts: Counter = Counter()
            for e in graph.edges.values():
                if e.out.value in {h.id.value for h in headaches}:
                    edge_counts[e.out.value] += 1
            current_h_id = (
                edge_counts.most_common(1)[0][0] if edge_counts
                else headaches[0].id.value
            )
            # Populate known_headaches for the extractor so it reuses
            # these ids next turn instead of minting fresh ones.
            for h in headaches:
                desc = h.properties.get(PropertyKey("description"))
                label = desc.value if desc is not None else ""
                self._rolling.register_headache(h.id.value, label)
            self._rolling.current_headache_id = current_h_id

            # Populate known_buckets from existing bucket vertices in the
            # graph + their incoming bucket-attaching edges. This lets
            # the LLM see "AlleviatingFactors:shared is attached to both
            # Headache:daily and Headache:acute" on a resumed session.
            bucket_labels = self._rolling.BUCKET_LABELS
            for v in graph.vertices.values():
                if v.label.value in bucket_labels:
                    self._rolling.register_bucket(v.label.value, v.id.value)
            for e in graph.edges.values():
                in_v = graph.vertices.get(e.in_)
                if in_v is None:
                    continue
                if in_v.label.value in bucket_labels:
                    self._rolling.register_bucket(
                        in_v.label.value, in_v.id.value, e.out.value,
                    )

            summary = self._summarize_graph(graph, current_h_id)
            log.info("resume: current_headache_id=%s", current_h_id)
            log.info(
                "resume: known Headache patterns: %s",
                list(self._rolling.known_headaches.keys()),
            )
            log.info(
                "resume: known buckets: %s",
                {
                    bl: {bid: sorted(owners)
                         for bid, owners in d.items()}
                    for bl, d in self._rolling.known_buckets.items()
                },
            )
            log.info("resume: known so far:\n%s", summary)
        else:
            log.info(
                "resume: graph has %d vertices but no Headache; "
                "non-headache resume",
                len(graph.vertices),
            )

        # Inject a synthesized turn into the conversation so the agent
        # has the prior context on its subsequent replies.
        whole_summary = self._summarize_whole_graph(graph)
        resume_assistant_msg = (
            "[session resume] Based on our prior conversation, here is "
            "what I already have on file:\n"
            f"{whole_summary}\n"
            "I'll continue from here."
        )
        self._conversation.add_user("[system: session resume]")
        self._conversation.add_assistant(resume_assistant_msg)
        return True

    async def generate_resume_opening(self, graph) -> str:
        """Ask the agent's LLM to produce a single focused opening
        question that extends the existing graph. Prepends a brief
        'Welcome back.' so the user knows the session is resuming.

        Returns a hardcoded fallback if the LLM call fails for any reason.
        """
        fallback = (
            "Welcome back. What's been happening with your headaches "
            "since we last spoke?"
        )
        if graph is None or len(graph.vertices) == 0:
            return fallback
        summary = self._summarize_whole_graph(graph)
        opening_system_prompt = (
            "You are about to resume a clinical interview about a "
            "patient's headaches. A property graph of what we already "
            "know is shown below. Your task: produce ONE short, focused "
            "follow-up question that would extend this graph in a "
            "useful direction -- prefer dimensions of the headache that "
            "are NOT yet represented (e.g. quality if there's no "
            "Quality vertex on the current Headache, location if no "
            "BodyLocation, etc.). Reply with the question only -- no "
            "preamble, no 'welcome back', no apologies. One or two "
            "sentences."
        )
        user_prompt = (
            f"Graph so far:\n{summary}\n\n"
            "Produce one short follow-up question that would extend "
            "what we know about this patient's headaches."
        )
        try:
            question = await self._agent.complete(
                user_prompt, system=opening_system_prompt
            )
        except Exception:
            log.exception("resume: failed to generate opening question")
            return fallback
        if not question:
            return fallback
        return f"Welcome back. {question}"

    @staticmethod
    def _summarize_graph(graph, current_h_id: str) -> str:
        """Render a compact bullet summary of what's known about the
        current headache. Used to inject into the agent's conversation
        context on resume."""
        # Collect outgoing edges from the current headache.
        attached: dict[str, list[str]] = {}
        for e in graph.edges.values():
            if e.out.value != current_h_id:
                continue
            target = graph.vertices.get(e.in_)
            if target is None:
                continue
            label = e.label.value
            # Prefer a property called "value" if present, else the id.
            from hydra.pg.model import PropertyKey
            val_lit = target.properties.get(PropertyKey("value"))
            val = (
                val_lit.value if val_lit is not None
                else target.id.value
            )
            attached.setdefault(label, []).append(val)

        if not attached:
            return "  (the current Headache vertex has no details yet)"

        lines = []
        for edge_label, values in sorted(attached.items()):
            lines.append(f"  - {edge_label}: {', '.join(sorted(set(values)))}")
        return "\n".join(lines)

    @staticmethod
    def _summarize_whole_graph(graph) -> str:
        """Render the entire graph as a compact text summary for the LLM.

        Vertices grouped by label with their property values listed; then
        edges listed flat with their endpoint ids. Small graphs only --
        we trust the demo not to grow this past a few hundred vertices.
        """
        from hydra.pg.model import PropertyKey

        # Group vertices by label.
        by_label: dict[str, list] = {}
        for v in graph.vertices.values():
            by_label.setdefault(v.label.value, []).append(v)

        lines = ["Vertices:"]
        for label in sorted(by_label.keys()):
            for v in sorted(by_label[label], key=lambda v: v.id.value):
                props = []
                for k, val in v.properties.items():
                    props.append(f"{k.value}={getattr(val, 'value', val)!r}")
                prop_str = (" {" + ", ".join(props) + "}") if props else ""
                lines.append(f"  {label} [{v.id.value}]{prop_str}")
        lines.append("Edges:")
        for e in sorted(graph.edges.values(), key=lambda e: (e.label.value, e.out.value)):
            lines.append(f"  {e.out.value} --{e.label.value}--> {e.in_.value}")
        return "\n".join(lines)

    async def _speak_reply(
        self,
        prepared: asyncio.Future[str] | None,
        prep_task: asyncio.Task | None,
        t0: float,
    ) -> None:
        try:
            # Collects the full reply text as sentences are spoken, for the
            # transcript and conversation history. Populated by the
            # sentence generator below as a side effect.
            spoken: list[str] = []
            agent_ts_start = _now() - t0
            printed_header = False

            def _emit(sentence: str) -> str:
                """Record a sentence and print it as it begins to be spoken,
                so the on-screen text tracks the voice rather than dumping
                the whole reply before any audio plays."""
                nonlocal printed_header
                sentence = sentence.strip()
                spoken.append(sentence)
                if not printed_header:
                    # Leading blank line separates the agent reply from the
                    # preceding patient line in the terminal echo.
                    print(f"\nagent: {sentence}", end="", flush=True)
                    printed_header = True
                else:
                    print(f" {sentence}", end="", flush=True)
                return sentence

            async def _sentences() -> "AsyncIterator[str]":
                if prepared is not None and prep_task is not None:
                    # Speculative generation already produced the full text;
                    # split it into sentences so TTS first-byte is paid on
                    # the first sentence, not the whole reply.
                    try:
                        text = await prepared
                    except (asyncio.CancelledError, Exception):
                        text = ""
                    for s in _split_sentences_final(text):
                        yield _emit(s)
                else:
                    # Generate fresh: split the live delta stream into
                    # sentences and yield each as soon as it completes.
                    extra = self._agent_extra_system()
                    buf = ""
                    async for delta in self._agent.stream_reply(
                        self._conversation, extra_system=extra,
                    ):
                        buf += delta
                        sentences, buf = _split_sentences_buffer(buf)
                        for s in sentences:
                            yield _emit(s)
                    tail = buf.strip()
                    if tail:
                        yield _emit(tail)

            # Stream TTS into the speaker. Track the task so barge-in can
            # cancel it.
            #
            # Important: set agent_speaking=True BEFORE creating/publishing
            # the TTS task. Otherwise the _feeder coroutine can run after
            # the task is published but before the flag is set, see the
            # task in the cancellable state, and cancel it on the very next
            # local-VAD onset event (which happens within milliseconds in
            # a normal room).
            self.agent_speaking = True
            async def _tts_run() -> None:
                await self._tts.speak_stream(_sentences(), self._audio_out)

            tts_task = asyncio.create_task(_tts_run())
            self._tts_task = tts_task
            interrupted = False
            try:
                await tts_task
                # tts.speak() returns when the last chunk is queued, not
                # when the speaker has finished playing. Wait for the
                # audio output to actually drain before un-gating, or the
                # remaining audio bleeds into the mic as a fake user
                # turn.
                await self._audio_out.wait_until_idle()
            except asyncio.CancelledError:
                interrupted = True
            finally:
                self._tts_task = None
                self.agent_speaking = False

            # Terminate the incrementally-printed agent line.
            if printed_header:
                print()

            # Reassemble the full reply from the sentences that were
            # actually emitted (sentence splitting inserts no characters it
            # drops, but joins need single spaces between fragments).
            text = " ".join(s.strip() for s in spoken).strip()
            if not text:
                return

            agent_ts_end = _now() - t0
            self._transcript.write(
                Utterance(
                    speaker="agent",
                    text=text,
                    ts_start=agent_ts_start,
                    ts_end=agent_ts_end,
                    interrupted=interrupted,
                )
            )
            if not interrupted:
                self._conversation.add_assistant(text)
                self.add_agent_turn_to_context(text)
        except asyncio.CancelledError:
            pass


# Sentence-boundary detection for streaming TTS. We break on sentence
# punctuation followed by whitespace. The goal is low latency, not
# linguistic perfection: over-splitting just means more (smaller) TTS
# requests, while under-splitting only costs a little latency, so a
# simple rule is fine. To avoid choppy synthesis on abbreviations
# ("Dr.", "e.g.") and decimals, a fragment must reach a minimum length
# before we treat a boundary as real.
_SENTENCE_END = re.compile(r"([.!?])(\s+)")
_MIN_SENTENCE_CHARS = 12


def _split_sentences_buffer(buf: str) -> tuple[list[str], str]:
    """Split off complete sentences from a growing ``buf``.

    Returns ``(sentences, remainder)`` where ``sentences`` are
    ready-to-speak fragments and ``remainder`` is the trailing text not
    yet ending in a boundary (carried into the next call). A boundary is
    only honored once the fragment is at least ``_MIN_SENTENCE_CHARS``
    long, so abbreviations don't fragment playback.
    """
    sentences: list[str] = []
    start = 0
    for m in _SENTENCE_END.finditer(buf):
        end = m.end(1)  # include the punctuation, drop the following space
        fragment = buf[start:end].strip()
        if len(fragment) >= _MIN_SENTENCE_CHARS:
            sentences.append(fragment)
            start = m.end()  # skip the whitespace after the boundary
    return sentences, buf[start:]


def _split_sentences_final(text: str) -> list[str]:
    """Split a complete reply into ready-to-speak sentences (used when the
    full text is already in hand, e.g. speculative generation)."""
    sentences, tail = _split_sentences_buffer(text)
    tail = tail.strip()
    if tail:
        sentences.append(tail)
    return sentences


async def _ensure_person(graph_writer: GremlinWriter, coord: "Coordinator") -> None:
    """Make sure a Person vertex exists and record its id in
    RollingContext.

    If the graph already has a Person, reuse the first one found.
    Otherwise create a new Person:patient vertex and write it via the
    serial submit queue.
    """
    import hydra.core as core
    import hydra.pg.model as pg
    from hydra.dsl.python import FrozenDict

    graph = await graph_writer.load_graph()
    if graph is not None:
        # Seed the label cache from every vertex already in the live
        # graph, so edges in the first extracted delta can anchor to them
        # (validate_delta resolves endpoints against this set). See
        # chatgraph.chat.validation for why this is needed.
        coord._rolling.register_vertices(graph.vertices.values())  # noqa: SLF001
        existing_persons = [
            v for v in graph.vertices.values() if v.label.value == "Person"
        ]
        if existing_persons:
            pid = existing_persons[0].id.value
            coord._rolling.person_id = pid  # noqa: SLF001
            log.info("Person vertex discovered: %s", pid)
            return

    # No existing Person; create one.
    person_id = "Person:patient"
    person_lit = core.LiteralString(person_id)
    person = pg.Vertex(
        label=pg.VertexLabel("Person"),
        id=person_lit,
        properties=FrozenDict({pg.PropertyKey("name"): core.LiteralString("patient")}),
    )
    delta = pg.Graph(
        vertices=FrozenDict({person_lit: person}),
        edges=FrozenDict({}),
    )
    graph_writer.submit(delta)
    coord._rolling.person_id = person_id  # noqa: SLF001
    # The new Person root is now in the live graph; register it so the
    # first turn's `reports` edge resolves its out-vertex.
    coord._rolling.register_vertices([person])  # noqa: SLF001
    log.info("Person vertex created: %s", person_id)


async def run() -> int:
    load_dotenv()

    # Many of our operations use the default ThreadPoolExecutor for
    # offloading blocking calls (sounddevice writes, Deepgram socket sends).
    # The default cap (min(32, os.cpu_count()+4)) can leave audio writes
    # queued behind mic-frame send_media calls on a busy moment, which
    # surfaces as audible playback gaps. Bump the cap so the audio write
    # never has to wait for a worker slot.
    import concurrent.futures
    asyncio.get_running_loop().set_default_executor(
        concurrent.futures.ThreadPoolExecutor(max_workers=64)
    )

    # Configure logging early so STT/TTS/agent failures are visible.
    # Default level: WARNING (uncluttered demo output). Override via
    # --verbose / -v (INFO), --verbose --verbose / -vv (DEBUG), or the
    # CHATGRAPH_LOG_LEVEL env var (takes precedence).
    log_level = os.environ.get(
        "CHATGRAPH_LOG_LEVEL", _DEFAULT_LOG_LEVEL
    ).upper()
    # StreamHandler defaults to stderr; force flush after every record so we
    # don't lose output to buffering when the program hangs.
    handler = logging.StreamHandler(sys.stderr)
    # Color WARNING/ERROR lines red/yellow when stderr is an interactive
    # terminal, so the extractor's validation failures stand out against
    # the conversation transcript. Disabled when output is piped/redirected
    # (so logs stay plain) or when NO_COLOR is set (https://no-color.org).
    use_color = sys.stderr.isatty() and not os.environ.get("NO_COLOR")
    handler.setFormatter(
        _ColorFormatter(
            "%(asctime)s %(levelname)s %(name)s: %(message)s",
            datefmt="%H:%M:%S",
            use_color=use_color,
        )
    )
    handler.flush = lambda: sys.stderr.flush()  # type: ignore[method-assign]
    # The console handler carries the user's chosen verbosity; the root
    # logger sits at DEBUG so the per-session .log file handler (attached
    # later, when the TranscriptWriter opens) can capture everything
    # regardless of what the console shows.
    handler.setLevel(getattr(logging, log_level, logging.INFO))
    logging.basicConfig(
        level=logging.DEBUG,
        handlers=[handler],
        force=True,
    )
    # Make sure stdout/stderr are line-buffered so prints flush promptly.
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
        sys.stderr.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except AttributeError:
        pass

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set", file=sys.stderr)
        return 1
    if not os.environ.get("DEEPGRAM_API_KEY"):
        print("DEEPGRAM_API_KEY is not set", file=sys.stderr)
        return 1
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set", file=sys.stderr)
        return 1

    # Resolve the domain selected by the CLI.
    from chatgraph import domains as _domains_pkg
    if _DOMAIN_NAME is None:
        print("internal error: no domain selected", file=sys.stderr)
        return 1
    try:
        domain = _domains_pkg.get(_DOMAIN_NAME)
    except KeyError as e:
        print(str(e), file=sys.stderr)
        return 1

    agent = Agent(system_prompt=domain.agent_system_prompt)
    tts = OpenAITTS()
    extractor = Extractor(domain=domain)

    # The first OpenAI TTS request on a fresh connection has been observed
    # to take 25+ seconds before audio starts flowing. Fire a dummy
    # request now to prime the connection so the user-facing greeting
    # plays promptly.
    print("chatgraph: warming up...")
    await tts.warmup()

    print(
        f"chatgraph [{domain.name}]: listening. Ctrl-C to stop."
    )
    print()

    with TranscriptWriter() as transcript:
        # Route the full diagnostic log into the session's .log file (the
        # console handler keeps the user's -v/-vv level; the file gets
        # everything at DEBUG). Detached in TranscriptWriter.close().
        logging.getLogger().addHandler(transcript.log_handler)
        log.info("session log: %s", transcript.log_path)

        # Order matters: bring up Deepgram first so a stalled WebSocket
        # handshake fails fast (it has a 15s timeout) before we touch the
        # audio hardware. Audio streams come up after STT is ready.
        async with DeepgramFluxSTT() as stt, \
                AudioInput() as audio_in, \
                AudioOutput() as audio_out, \
                GremlinWriter() as graph_writer:
            coord = Coordinator(
                agent, tts, transcript, audio_out,
                extractor=extractor,
                graph_writer=graph_writer,
            )
            vad = VAD()
            t0 = _now()

            # If --fresh was passed, drop everything before resume logic.
            if _DROP_GRAPH_AT_STARTUP and graph_writer.connected:
                await graph_writer.drop_all()
                print("chatgraph: cleared prior graph (--fresh)")

            # Ensure a Person vertex exists rooting the graph. On a fresh
            # graph we create one; on resume we discover an existing one.
            # The id is recorded in RollingContext so the extractor uses
            # it as the source of every new `reports` edge.
            if graph_writer.connected:
                await _ensure_person(graph_writer, coord)

            # If a prior session left data in the graph, resume from it.
            existing = await graph_writer.load_graph() if graph_writer.connected else None
            resuming = coord.seed_from_graph(existing) if existing else False
            if resuming:
                print(
                    f"chatgraph: resuming session "
                    f"({len(existing.vertices)} vertices, "
                    f"{len(existing.edges)} edges already on file)"
                )

            # Choose the opening line: a fresh-session greeting, or a
            # resume-aware question generated by the agent based on the
            # graph contents.
            if resuming:
                opening_text = await coord.generate_resume_opening(existing)
            else:
                # Domain-supplied opening line. For the medical domain
                # this is the doctor-LIKE invitation; other domains
                # have their own.
                opening_text = domain.opening_line

            async def _opening() -> None:
                await asyncio.sleep(0.3)
                agent_ts_start = _now() - t0
                print(f"agent: {opening_text}")

                # Set the speaking flag BEFORE publishing the task; see
                # the comment in _speak_reply for the race this avoids.
                coord.agent_speaking = True
                log.info("opening: agent_speaking=True, starting TTS")

                async def _tts_run() -> None:
                    await tts.speak(opening_text, audio_out)

                tts_task = asyncio.create_task(_tts_run())
                coord._tts_task = tts_task  # noqa: SLF001
                interrupted = False
                try:
                    await tts_task
                    # Wait for the speaker to actually drain before
                    # un-gating; see the same dance in _speak_reply.
                    await audio_out.wait_until_idle()
                    log.info("opening: TTS task completed normally")
                except asyncio.CancelledError:
                    interrupted = True
                    log.warning("opening: TTS task was cancelled")
                except Exception:
                    log.exception("opening: TTS task raised")
                    raise
                finally:
                    coord._tts_task = None  # noqa: SLF001
                    coord.agent_speaking = False
                    log.info("opening: agent_speaking=False")
                transcript.write(
                    Utterance(
                        speaker="agent",
                        text=opening_text,
                        ts_start=agent_ts_start,
                        ts_end=_now() - t0,
                        interrupted=interrupted,
                    )
                )
                if not interrupted:
                    coord._conversation.add_assistant(opening_text)  # noqa: SLF001
                    coord.add_agent_turn_to_context(opening_text)

            # Wire feeder: mic frames -> STT + local VAD.
            # While the agent is speaking we drop frames entirely so the
            # agent's own audio (which leaks back into the mic on macOS,
            # which has no built-in echo cancellation in the default
            # capture path) doesn't (a) trigger spurious VAD onset that
            # cancels the TTS mid-sentence, or (b) get transcribed by
            # Deepgram as the patient's next turn.
            async def _feeder() -> None:
                async for frame in audio_in.frames():
                    if coord.agent_speaking:
                        continue
                    # Local VAD (fast barge-in).
                    report = vad.process(frame)
                    if report.speech_started:
                        coord.on_local_speech_onset()
                    # STT (canonical turn events).
                    await stt.send(frame)

            async def _events() -> None:
                async for event in stt.events():
                    coord.on_flux_event(event, t0)

            opener = asyncio.create_task(_opening())
            feeder = asyncio.create_task(_feeder())
            events = asyncio.create_task(_events())
            tasks = [opener, feeder, events]
            try:
                await asyncio.gather(*tasks)
            except asyncio.CancelledError:
                pass
            finally:
                for t in tasks:
                    t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

    print()
    print(f"Transcript: {transcript.txt_path}")
    print(f"           {transcript.jsonl_path}")
    print(f"Log:        {transcript.log_path}")
    return 0


def main() -> int:
    import argparse
    from chatgraph import domains as _domains_pkg

    # Pre-fetch the list of available domains for the help text and the
    # ``choices=`` validator. Importing the package is idempotent and
    # registers each domain's manifest.
    _available = _domains_pkg.available()

    parser = argparse.ArgumentParser(
        prog="chatgraph",
        description=(
            "Voice-driven knowledge-elicitation demo. Talks with a "
            "patient and builds a property graph in real time."
        ),
    )
    parser.add_argument(
        "domain",
        choices=_available,
        help=(
            "Which domain to run. Each domain bundles a schema, an "
            "agent system prompt, and an opening line. Available: "
            + ", ".join(_available)
        ),
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help=(
            "Increase log verbosity. -v shows INFO (per-turn extractor / "
            "TTS / STT lines). -vv adds DEBUG (per-chunk audio details, "
            "WebSocket frames). Default is WARNING (uncluttered)."
        ),
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help=(
            "Drop everything in the Gremlin graph before starting. "
            "Otherwise the session resumes from whatever is on file."
        ),
    )
    args = parser.parse_args()

    # Map verbosity count to log level. CHATGRAPH_LOG_LEVEL still wins
    # if set explicitly in the environment.
    global _DEFAULT_LOG_LEVEL, _DROP_GRAPH_AT_STARTUP, _DOMAIN_NAME
    if args.verbose >= 2:
        _DEFAULT_LOG_LEVEL = "DEBUG"
    elif args.verbose == 1:
        _DEFAULT_LOG_LEVEL = "INFO"
    else:
        _DEFAULT_LOG_LEVEL = "WARNING"

    _DROP_GRAPH_AT_STARTUP = args.fresh
    _DOMAIN_NAME = args.domain

    try:
        return asyncio.run(_run_with_signal())
    except KeyboardInterrupt:
        return 0


async def _run_with_signal() -> int:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    # Two-stage shutdown: first SIGINT requests graceful shutdown via
    # ``stop.set()``; a second SIGINT raises KeyboardInterrupt in the main
    # thread, which causes asyncio.run() to bail out. This guarantees that
    # Ctrl-C always works even if some task is wedged in a blocking call.
    shutdown_requested = False

    def on_signal() -> None:
        nonlocal shutdown_requested
        if not shutdown_requested:
            shutdown_requested = True
            print("\nShutting down. Press Ctrl-C again to force.", file=sys.stderr)
            stop.set()
        else:
            # Force-exit by raising in the main thread.
            import _thread

            _thread.interrupt_main()

    try:
        loop.add_signal_handler(signal.SIGINT, on_signal)
        loop.add_signal_handler(signal.SIGTERM, on_signal)
    except NotImplementedError:
        # Windows.
        pass

    run_task = asyncio.create_task(run())
    stop_task = asyncio.create_task(stop.wait())
    done, _ = await asyncio.wait(
        [run_task, stop_task], return_when=asyncio.FIRST_COMPLETED
    )
    if stop_task in done:
        run_task.cancel()
        try:
            # Bound the graceful-shutdown window so a wedged task can't
            # keep us hung forever; a second Ctrl-C still force-exits.
            await asyncio.wait_for(run_task, timeout=3.0)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        return 0
    return run_task.result()


if __name__ == "__main__":
    sys.exit(main())
