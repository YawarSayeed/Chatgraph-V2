# Iteration 03 — Full gate, stateless harness, first controlled measurement

**Date:** 2026-07-21 (afternoon)
**Metrics snapshot:** `iteration-03-metrics.json` (generated 2026-07-21T21:34Z,
prompt hash `25aa1b78…`)
**Status:** superseded by iteration 04; its headline EF contrast did not replicate
there and the non-replication is itself a reported result.

## Method

**Gate completed to all five constraint classes.** The schema was fixed to declare
polymorphic provenance endpoints (removing the harness bypass and 2 of 3 drift
findings), HR014/HR15 gained explicit `target_property` fields (removing the third
— drift now 0, asserted by tests), and constraint classes iv and v were
implemented: content-derived ids (order-independent FNV-1a over normalized
properties) and invalidate-not-delete supersession via a gate-authored
`supersededBy` edge. The echo-satisfiable anti-generic rule was replaced by a
span rule: traceText must appear **in** the utterance and must not restate ≥90%
of a ≥20-word turn.

**New harness** (`run_gated_ablation.mjs`) with two controls iteration 01 lacked:
it **imports the deployed gate** (no second implementation), and extraction is
**stateless** — the request depends only on turn, attempt, and correction text, so
attempt-1 proposals are byte-identical across A1–A5 and fact-level pairing is
valid. Added the A4 vs A4-strict one-bit contrast (spec-soft vs hard provenance)
and model-judged EF + citation correctness with condition-blind judging.
Two measurement bugs were found and fixed *during* this iteration: the judge was
shown opaque hash ids instead of readable claims (depressing A5's EF), and the
duplicate metric compared delta signatures rather than graph content.

**Composite metric introduced:** usable+faithful = schema-conforming AND
judge-confirmed, over proposals — because A0's high EF with 2.1% OC made either
number alone misleading.

## Outcome (see iteration-03-metrics.json for counts and CIs)

| Cond. | OC | EF | Prov. | Cite | Usable+faithful | Yield |
|---|---|---|---|---|---|---|
| A0 | 2.1% | **95.8%** | 0% | — | **2.1%** | 100% |
| A1 | 95.6% | 82.2% | 0% | — | 80.0% | 100% |
| A2 | 100% | 83.3% | 0% | — | 77.8% | 93.3% |
| A3 | 100% | 85.5% | 0% | — | 78.7% | 92.0% |
| A4 | 100% | 81.1% | 92.7% | 70.6% | 74.1% | 91.4% |
| A4-strict | 100% | 86.4% | 98.1% | 78.4% | 73.1% | 84.6% |
| A5 | 100% | 80.0% | 92.7% | 76.5% | 75.0% | 93.8% |

Significant: A0 vs A1 (EF contamination, p = 0.031) and A0 vs A5 (p = 0.0156).
Not significant: A4 vs A4-strict (+5.3 EF, p = 0.5). Duplicates 0% with and
without deterministic ids. 2 temporal supersessions under A5 only.

## Why it happened

- **A0's 95.8% EF with 2.1% usable yield** is the precision of vagueness: invented
  vocabulary ("eye twitch signal", "appreciates") paraphrases the transcript
  faithfully and is unusable as typed knowledge. This motivated the composite.
- **Provenance coverage 0% → 92.7–98.1%** versus iteration 01's 2.2–5.4% under
  identical intent: structural evidence made the orphan case unrepresentable.
- **The A0→A1 EF drop** was read as typing pressuring the model into specific,
  riskier claims. Iteration 04 shows this contrast is prompt-sensitive — it was
  real in this run and absent in the next.

## What it taught us

- Fact rendering for judges matters: measure on readable claims, not ids.
- Coverage ≠ quality: 21–29% of citations that passed the span rule were rejected
  by the judge as not licensing their fact.
- Constraints can be worth 0 on a given corpus (deterministic ids: nothing to
  collapse) and that must be reported plainly.

## Evidence

- `iteration-03-metrics.json` (frozen; recovered from commit `99327ea`)
- Harness: `scripts/nesy_results/run_gated_ablation.mjs` at commit `2463d4f`
- Gate completion: commit `a430daf`; paper against these numbers: commit `5eb640e`
