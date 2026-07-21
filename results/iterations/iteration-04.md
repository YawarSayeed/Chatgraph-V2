# Iteration 04 — Product-quality fixes, entity resolution, and a non-replication

**Date:** 2026-07-21 (evening)
**Metrics snapshot:** `iteration-04-metrics.json` (generated 2026-07-21T22:58Z,
prompt hash `dd62d951…`) — this is the current `results/metrics.json`.
**Status:** current.

## Method

Driven by three live-product defects observed in trials (messy hospitality graph;
generic labels appearing mid-interview; the interview stalling until told
"continue"), six changes — the first two alter the measured pipeline, the rest are
product-layer:

1. **Entity resolution in the gate** (`resolveEntities`): a proposed knowledge
   vertex whose label and key text match an existing vertex (identical after
   normalization, or token overlap ≥ 0.6 with tokens matched up to one edit —
   "centred"="centered", "signal"="signals") resolves onto the existing id, before
   evidence materialization and hashing. Superseded vertices are not match
   targets. Two subsidiary bugs fixed: a correctly-*reused* id was being re-hashed
   into a fork by the deterministic-id pass; and `keyText` was blind to labels
   whose naming property is not in the preferred list (`CheckInPolicy`,
   `ContextualConstraint`).
2. **Context discipline**: the extractor's prompt previously included every
   episode and evidence vertex with full quoted properties; by mid-interview this
   dwarfed the schema reference and the model drifted into invented vocabulary
   ("applies to", "appreciates" — the exact symptom observed live). Replaced by a
   contract-generated "known entities — reuse these ids" table (knowledge
   vertices only, one line each, superseded excluded). Prompt additionally asks
   for distilled third-person rule statements, with quotes reserved for
   `evidence.traceText`.
3. Stable incremental graph layout (warm-started simulation, neighbor seeding,
   persistent viewport, superseded facts hidden).
4. Interview continuity: full-history agent window (was 14 messages — the agent
   lost its place mid-session) and single-confirmation section transitions.
5. Realtime deadlock fix: a cancelled response never re-requested; added re-arm +
   watchdog.
6. Domain-correct export speaker labels (trial corpus hygiene).

Because the prompt and the deployed gate changed, the **entire ablation was
re-run** (same corpus, same seed policy, new prompt hash) with harness-A5 kept
equal to the deployed configuration (now including resolution).

## Outcome (see iteration-04-metrics.json for counts and CIs)

| Cond. | OC | EF | Prov. | Cite | Usable+faithful | Yield |
|---|---|---|---|---|---|---|
| A0 | 4.2% | 87.5% | 0% | — | **4.2%** | 100% |
| A1 | 91.1% | **93.3%** | 0% | — | **84.4%** | 100% |
| A2 | 100% | 92.7% | 0% | — | 84.4% | 91.1% |
| A3 | 100% | 74.3% | 0% | — | 70.5% | 94.9% |
| A4 | 100% | 76.1% | 87.5% | 79.6% | 72.0% | 94.7% |
| A4-strict | 100% | 75.4% | **100%** | 79.6% | 59.7% | 79.2% |
| A5 | 100% | 76.0% | 84.5% | **81.6%** | **76.0%** | **100% (75/75)** |

Significant: A2 vs A3 (retry contaminates, discordant 7, p = 0.0156).
**Not significant / non-replicated:** A0 vs A1 (p = 1; iteration 03 had measured a
significant EF drop, p = 0.031), A0 vs A5 (p = 0.0625), A4 vs A4-strict (p = 1;
iteration 03's +5.3 EF point estimate is gone).

**Product replay** of the iteration-01 trial transcript through the new pipeline:
**5** `GuestExperiencePrinciple` vertices instead of **22**; maximum semantic hub
degree **8** instead of **22+**; 11 previously-unused knowledge classes now
populated (TimingRule, GuestSignal, LoyaltyDriver, RecoveryAction, …);
A5 duplicates 0/57.

## Why it happened

- **The A0→A1 EF contrast flipped because the prompt changed.** Same harness, same
  corpus, same seed policy; the revised prompt (distilled rules, compact entity
  table) lifted A1/A2 EF to ~93% and lowered A0's to 87.5%. Conclusion: the
  per-fact EF comparison between ungated and constrained extraction is
  **prompt-sensitive** and must not be a headline. The composite gap
  (4.2% vs 60–84%) held in both runs and is the durable claim.
- **Retry's cost surfaced** (92.7% → 74.3% EF, significant): retry-recovered
  volume is disproportionately the model's second-guess material. Iteration 03
  measured no such cost — also prompt-sensitive; the durable statement is that
  retry reliably buys volume (41 → 74 admitted) and its faithfulness effect must
  be monitored, not assumed.
- **A5 reached 100% yield** because resolution converts would-be near-duplicate
  rejections and forks into merges.
- **Hard provenance enforcement now buys coverage only** (100% vs 87.5%) at −12.3
  points usable yield with EF unchanged — strengthening the spec's choice of soft
  severity as the live default.

## What it taught us

- **Re-run before you believe.** Two controlled runs on the same corpus disagreed
  about two effects; single-run ablations at n=32 over-claim by construction.
  Consequence: the results narrative is now *generated* with significance wording
  computed from the paired tests, so prose can never outlive its numbers.
- Identity needs resolution before hashing; hashing alone merges only exact
  restatements.
- Context bloat is a governance failure mode: the graph summary was an ungoverned
  prompt channel that grew until it displaced the schema.

## Evidence

- `iteration-04-metrics.json` (frozen) = `results/metrics.json` (current);
  narrative `results/results.md`, table `results/table1.md`
- Product + measurement changes: commit `099f2d8`
- Raw per-turn rows: `results/raw/` (local only; quotes the expert verbatim)
