# Iteration 01 — Deterministic product, reimplemented-gate ablation

**Date:** 2026-07-09 → 2026-07-16
**Status:** superseded; package archived unmodified at `results/legacy-2026-07-16/`,
harness at `scripts/nesy_results/legacy/`.

## Method

**Product.** The hospitality domain did not use an LLM extractor at all: turns were
converted to graph deltas by ~290 lines of deterministic keyword rules
(`hospitalityFallbackDelta` in `lib/server/extract.ts`, since deleted). Regex hits
("hot towel", "check-in", role words) produced hardcoded concept vertices, wired
every principle to the same business and persona hubs, and attached
`TranscriptEpisode`/`ProvenanceEvidence` scaffolding per turn. Medical used an LLM
tool call sanitized by `sanitizeDelta` (schema-only filtering, no governance).

**Evaluation.** `run_real_ablation.mjs` (now `scripts/nesy_results/legacy/`) ran an
A0–A5 ablation with its **own reimplementation** of the gate rather than the
product's code. One hospitality session (78 messages, 45 expert turns, 32 eligible),
gpt-4o-mini at temperature 0.

## Outcome

| Cond. | Yield | OC (admitted) | Provenance |
|---|---|---|---|
| A0 ungated | 62/62 | 55/62 | 1/46 |
| A1 constrained | 67/67 | 63/67 | 2/37 |
| A2 +schema | 3/40 | 3/3 | 0/2 |
| A3 +retry | 29/48 | 29/29 | 1/21 |
| A4 +provenance | **0/59** | — | — |
| A4-soft | 53/69 | 53/53 | 0/25 |
| A5 full | 3/61 | 3/3 | 2/2 |

EF and human κ: UNMEASURED. All three McNemar tests non-significant (p = 1, 1, 0.25).
The paper draft of this date claimed "provenance delivers the largest single
faithfulness gain" — placeholder text the measurements never supported.

The product trial of the same date (session 2026-07-16-203203) produced a graph of
110 vertices / 188 edges containing **22 near-duplicate `GuestExperiencePrinciple`
vertices**, each wired to the same two hub nodes (degree 22+), and zero use of 11 of
the 19 knowledge classes.

## Why it happened

Post-hoc analysis (iteration 02) identified four causes, all mechanical:

1. **The evaluation reimplemented the gate, and the copy drifted.** It enforced
   HR006/HR007 (provenance attachment) as *hard* although the authored
   specification declares them *soft*. The A4 = 0/59 collapse was the harness
   contradicting the spec — a bug reported as a finding.
2. **Admission was per delta.** One dangling edge discarded a whole turn's
   knowledge. Replaying the same frozen deltas per-fact recovers 47/48 (A3)
   and 60/61 (A5).
3. **The schema forbade the provenance the spec required.** `supportedBy` was
   declared `DecisionRule → ProvenanceEvidence` only, while the spec mapped 16
   labels onto it; the harness hid this behind a hardcoded endpoint bypass.
4. **Provenance was remembered, not structural.** The extractor emitted 41
   evidence vertices but only 7 provenance edges — it wrote the evidence down
   and forgot to wire it.

The product graph's mess had a fifth cause: the regex extractor minted a new
principle vertex per matching turn with no identity resolution, and wired each to
fixed hubs.

## What it taught us

- A gate is only a gate if the evaluation runs the deployed one (became the
  harness invariant in iteration 03).
- Severity must be read from the specification, not re-encoded (Lesson 4).
- "UNMEASURED, never zero" — this package's one lasting methodological
  contribution; kept in every later iteration.

## Evidence

- `results/legacy-2026-07-16/metrics.json`, `results.md`, `table1.md`
- `scripts/nesy_results/legacy/run_real_ablation.mjs` (+ its README)
- Trial graph counts reproducible from the local session file (not committed).
