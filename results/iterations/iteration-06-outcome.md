# Iteration 06 (measured) — First fixed-product session: a live-graph audit

**Date:** 2026-07-22
**Inputs:** `data/session/chatgraph-20260722-110534.json` (deployed export, 47 expert
turns), `data/live_audit/facts-20260722-110534.json` (its 57-fact / 40-edge
knowledge view).
**Metrics:** `results/live_session_audit.json` (committed, summary only).
**Status:** current. The A0–A5 ablation half is **deferred** — the OpenAI key hit
`insufficient_quota` mid-run; no data was damaged and the iteration-05 package is
intact. This file reports the *live-graph audit*, which needs no OpenAI key: it
grades the deployed pipeline's own output.

## Method

Two independent layers over the graph the **deployed** app actually built:

1. **Deterministic** (no model): does each stored `traceText` appear verbatim in
   the utterance it cites (span rule), what is provenance coverage, how many
   concept names duplicate under one label.
2. **Cross-family judged** (Claude, via a 7-agent workflow; the extractor is
   gpt-4o-mini, so judge and extractor share no model family): per-fact
   evidential faithfulness, citation correctness, and — new this iteration —
   **per-property padding** (which property *values* the utterance does not
   support), per-edge relationship support, edge citation correctness, edge
   semantic coherence, plus a conversation-conduct audit and an internal
   graph-coherence audit.

This is a different measurement object from the ablation. The ablation replays
clean text through A0–A5 to price each constraint. This audits what a real voice
session, with ASR noise and mid-sentence fragments, actually produced under the
full gate. It is the more honest picture of deployed quality.

## Outcome

### The grounding machinery works

| Metric | Value | CI95 |
|---|---|---|
| Span rule held (vertex evidence) | **54/54 = 100%** | 93.4–100 |
| Span rule held (edge evidence) | **30/30 = 100%** | 88.6–100 |
| Vertex provenance coverage | 54/57 = 94.7% | 85.6–98.2 |
| Edge provenance coverage | 30/40 = 75.0% | 59.8–85.8 |
| Evidential faithfulness (judged) | 51/57 = 89.5% | 78.9–95.1 |
| Vertex citation correctness (judged) | 41/54 = 75.9% | 63.1–85.4 |

Every stored citation is a genuine verbatim span of its source turn — the
structural-provenance guarantee held in production under ASR noise. Per-fact
faithfulness (89.5%) is in line with the ablation's A5.

### Three defect classes the ablation cannot see

**D-06-1 — Identity mutation (HIGH; root cause reproduced).** The graph-coherence
judge flagged 19 incoherent facts (5 high). All five high cases share one
mechanism: a content-derived id that the extractor *reused* across turns while
attaching *different content*. `LoyaltyDriver:3bd8…` was "loyalty program" (turn
9) and became "theft" (turn 41); `ServiceFailure:4de0…` was "unclean toilets" and
became "cigarette violation"; `CheckInPolicy:c4a7…` mutated its `standardTime`
from "1 p.m." to "3:00 PM"; `TimingRule:9c84…` went from an early-check-in rule to
"stop explaining and apologize". Every edge written into the id *before* the
mutation now points at the wrong concept — hence "EmotionalMoment(watch return)
shapesLoyalty LoyaltyDriver(theft)".

Reproduced deterministically (see the reproduction in this iteration's commit):
`applyDeterministicIds` skips re-hashing any vertex whose id is already in the
graph (the iteration-05 "reused-id protection", added to stop resolution forks),
and `mergeDelta` is last-write-wins. Together, a reused id with divergent content
silently overwrites the concept and keeps the old id. The protection is correct
for *genuine* restatements and for resolver-mapped ids; it is wrong when the
reused id's content hashes differently. **Fix (proposed, not yet applied): only
skip re-hashing for ids the resolver explicitly mapped; a reused id whose content
hash differs from its id is a different concept and must take its own hash.**

**D-06-2 — Edge quality is the weak layer.** Only 21/40 = 52.5% of relationships
are judge-confirmed, 9/30 = 30.0% of edge citations license their relationship,
and 12/40 = 30.0% of edges are semantically incoherent. Two causes: the incoherent
edges are downstream of D-06-1 (they point at mutated endpoints), and the extractor
often cites a span that names *one* endpoint rather than the span asserting the
*relationship*. Edge grounding is younger and materially worse than vertex
grounding; this is the top measured quality gap.

**D-06-3 — Property padding persists (57.9% of facts, 58 values).** Despite the
iteration-05 anti-padding rule, 33/57 facts still carry at least one property value
the utterance does not support — most commonly `neverCompromise: true` stamped on
principles the expert never called non-negotiable, and fabricated `frequency` /
`severity` / `returnLikelihood` / `highValueIndicator` fields. The prompt rule
curbed *description* padding but not *enum/boolean* padding. This is the channel
the citation judge keeps catching and per-fact EF keeps missing.

**Two duplicate concepts** survived (`ServiceFailure "cigarette violation"`,
`ContextualConstraint "demographic"`). The demographic case was checked against
current repo code and **resolves correctly** — the deployed build predates the
subset-containment resolution fix, confirming the live graph was produced by a
**stale deployment**. (Deployment is the standing action item from iteration 06.)

### Conversation conduct: much improved, not perfect

All seven interview sections A–G were covered in order — the continuity fixes held.
Wins: recovered the cut-off cigarette anecdote across three turns; re-asked
too-broad answers with concrete reframes; honored the pacing preference; accurate
closing summary. Residual defects: 2 self-answering turns (the agent answered its
own question after a bare "I think"), 2 acknowledge-only replies that stalled until
the expert typed "Continue", 4 leaked planning monologues ("let me think about how
to connect…"), 7 double-questions (two questions in one turn, second half often
dropped), 3 skipped question-halves. None lost a whole section; several cost detail.

## Why it happened

The pipeline's *grounding* contract is sound and held in production. The failures
are in *identity* and *edges*, which the ablation's per-fact accounting never
tests. The single most damaging bug (D-06-1) is a direct, ironic consequence of the
iteration-05 fix that stopped a *different* identity bug — the reused-id protection
was too broad. This is exactly why per-session live audits belong in the record
alongside the controlled ablation: the ablation says A5 is 100% conforming and
~82% faithful per fact, and it is; the live audit says the resulting *graph* is
locally grounded but globally incoherent, and it is. Both are true.

## What it taught us

- **Grounding ≠ coherence.** A graph can have 100% verbatim citations and still be
  globally wrong, because identity, not evidence, is what binds facts across turns.
- **Content-hash identity needs a merge policy.** Hashing makes duplicates
  impossible only if a reused id whose content changed is treated as a new
  concept, not a mutation of the old one.
- **Padding is enum-shaped now.** The next anti-padding move is structural:
  optional enum/boolean properties should require their own supporting span, or be
  dropped by the gate, not merely discouraged in the prompt.
- **Edges are the frontier**, confirming iteration 05's closing line with a second,
  independent measurement.

## Deferred / next

- **Ablation on the 2-session corpus** (blocked on OpenAI quota). The harness is
  ready and now resets its graph per session (fix committed this iteration, so
  resolution cannot merge two different experts' concepts). Resume with
  `npm run ablation` once credit is restored; cached calls make it cheap.
- **Fixes await direction** (per the owner's request to review shortcomings first):
  D-06-1 identity-mutation fix, D-06-2 edge-citation prompt, D-06-3 enum-padding
  gate rule, and redeploy.

## Evidence

- `results/live_session_audit.json` (committed) — all counts + Wilson intervals.
- `data/session/…` and `data/live_audit/…` (local only; verbatim expert speech).
- Deterministic checks and the D-06-1 reproduction are in this iteration's commit.
- 7-agent judge workflow: 267,957 subagent tokens, 0 errors, 0 empty results.
