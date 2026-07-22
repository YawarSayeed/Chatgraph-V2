# Claims-vs-measurements audit of iteration 04

**Date:** 2026-07-21 (late evening), audited against `iteration-04-metrics.json`.
**Purpose:** before further trials, an honest reconciliation of what the paper and
package *claim* with what the numbers *say*. This audit motivated iteration 05.

## Verdict in one line

The method is sound; the claims outran the data in three specific places, and the
paper's title asserted a thesis its own numbers had killed.

## Claim-by-claim

| Claim as stated | Measured (iteration 04) | Verdict |
|---|---|---|
| Title: "Structure Is Not Grounding" | A1 (structure, no gate) EF **93.3%** vs A0 ungated **87.5%** — structure *helped* grounding this run | **Contradicted.** The title came from iteration 03's EF drop (95.8→82.2, p=0.031), which did not replicate (p=1). The body reported the non-replication while the title kept the dead thesis. |
| Ungated yields 4.2% usable+faithful; gated 60–84% | 2/48 vs 38–57 facts | Supported, but partly tautological — see below. |
| Structural provenance: coverage 0% → 84.5–100% | Confirmed; 2.2–5.4% when evidence was "remembered" (iteration 01) | **Supported. Strongest result in the package.** |
| Hard provenance buys coverage only (p = 1), −12.3 pts usable yield | Confirmed | Supported (honest negative). |
| Retry costs faithfulness (p = 0.0156) | Confirmed; the only significant contrast in the run | Supported (honest negative about our own component). |
| ~1 in 5 citations do not license their fact | 79.6–81.6% citation correctness | Supported. |

## The three problems

### 1. Dead title

"Structure Is Not Grounding" was iteration 03's finding. Iteration 04 reversed the
direction and the paper kept the title while reporting the reversal in the body. A
reviewer reads the title first. The supported thesis is different: **ungated
extraction is faithful but unusable** — structure is necessary, not harmful.

### 2. Wrong denominator: the rate metric penalizes the mechanism that works

`usableFaithfulYield` divides by *proposals*, and retry inflates proposals
(A1 proposes 45, A5 proposes 75). Read as a rate, A1 (84.4%) beats every gated
condition (A5 76.0%) and the gate looks worthless. Per eligible turn — proposals
held out of the denominator — the picture inverts:

| | A1 (no gate) | A5 (full gate) |
|---|---|---|
| usable+faithful facts | 38 | **57 (+50%)** |
| per eligible turn | 1.19 | **1.78** |
| provenance coverage | 0% | 84.5% |
| ontology conformance | 91.1% | 100% |
| duplicates | 0/38 | 0/57 |
| tokens per fact | 1550 | 2230 (1.44×) |

The per-proposal rate remains a valid *precision* measure; it must not be the
headline. This was flagged after iteration 03 and not fixed; by iteration 04 it was
baked into the abstract, `results.md`, and the claim verifier.

### 3. Significance is thinner than the prose feels

Only A2-vs-A3 is significant (p = 0.0156) — a negative result about retry. The
comparison the paper is *about*, gate-vs-ungated (A0 vs A5), is p = 0.0625; and the
most decision-relevant contrast, **A1 vs A5, was never tested at all**. With n = 32
turns from one expert, that is the honest ceiling of this corpus.

### 4 (reviewer-anticipated). A0's 4.2% is close to definitional

Free-form extraction is scored for conformance to a schema it was never given.
"Unconstrained output does not match our ontology" is nearly a tautology — a
legitimate *practical* baseline (it is what ungated deployment would produce), but
it cannot carry the paper's contribution.

## What is genuinely achieved so far

1. **Provenance by construction**: inline evidence + gate materialization moved
   coverage ~90 points by changing the representation. Robust across both
   controlled runs and the live product.
2. **One generated contract** binding schema, specs, prompt, tool schema, and gate,
   with drift detected and disabled; zero drift asserted by tests.
3. **A controlled harness that runs the deployed gate** with stateless extraction —
   the property that made the iteration-03 → 04 non-replication *detectable* at all.
4. **Honest negatives**: hard enforcement buys coverage only; retry contaminates;
   deterministic ids bought nothing on this corpus; two prompt-sensitive effects
   reported as non-replications rather than choosing the flattering run.
5. **Product quality**: 22 → 5 duplicate principles, hub degree 22+ → 8, stable
   layout, interview continuity, realtime deadlock fixed.

## Gaps carried into iteration 05

- Edges between knowledge vertices are admitted **without any grounding** — the
  actual hallucination surface the SH/OH metrics measure (12.5–40% across runs).
- The `inferred` confidence tier is unusable by construction: cross-turn synthesis
  can never be a span of the current utterance, so the span rule rejects exactly
  what `inferred` was designed to admit.
- Retry feedback does not forbid inventing new facts during correction — the
  likely mechanism of the significant A2→A3 contamination.
- Edge properties bypass schema filtering in the gate (vertices are filtered,
  edges are not).
- Every transcript episode attaches to one hardcoded "introduction" section;
  interview-section structure (HR016) is dead weight.
- Provenance is invisible in the product UI — grounding that cannot be inspected.
- Headline metric, missing A1-vs-A5 test, and the title (this audit, items 1–3).
