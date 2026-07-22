# Iteration 05 — Edge grounding, per-turn framing, and the property-padding discovery

**Date:** 2026-07-21 (night)
**Metrics snapshot:** `iteration-05-metrics.json` (generated 2026-07-21T23:55Z) —
current `results/metrics.json`.
**Status:** current. Motivated by `iteration-04-claims-audit.md`.

## Method

Nine changes across the stack; the first four alter the measured pipeline.

1. **Edge provenance (new constraint surface).** Relationships between knowledge
   vertices were admitted with no grounding at all — the exact surface the SH/OH
   hallucination metrics measure (12.5–40% across earlier runs). All 22 semantic
   edges in the schema now declare optional `traceText`/`confidence`; the extractor
   attaches inline evidence to edges exactly as to vertices; the gate validates it
   with the same span rule and stores it on the edge (advisory on failure — the
   edge survives ungrounded and flagged, mirroring the spec's soft vertex rule).
   Also fixed: edge properties previously bypassed schema filtering entirely.
2. **The `inferred` tier made usable.** Cross-turn synthesis can never be a span of
   the current utterance, so the span rule rejected exactly what the spec's
   `inferred` confidence was designed to admit. For inferred evidence, span
   failure now records an HR013 advisory instead of rejecting; length and
   banned-pattern checks stay hard.
3. **Retry anti-invention.** Retry feedback now forbids adding facts not present
   in the previous attempt — corrections correct, they do not expand. (Targets
   iteration 04's only significant negative: retry contamination, p = 0.0156.)
4. **Anti-padding rule** (added mid-iteration; see Discovery below).
5. Interview sections: episodes now attach to the section actually being
   discussed, classified deterministically from the interviewer's question by
   keyword match against the domain's declared A–G structure (reproducible from
   the transcript alone; no model involved).
6. Evidence panel in the product UI: clicking a node shows its label, the quote
   that grounds it, confidence, and its relationships with their edge citations.
7. Harness: `usableFaithfulPerTurn` (headline; the interview is the only
   denominator constant across conditions), edge provenance/citation metrics,
   and the previously missing **A1-vs-A5** paired test.
8. Framing corrections from the claims audit (per-turn headline; retitled paper).
9. Measurement bug found and fixed: the harness's free-form normalizer stripped
   the `evidence` field from edges, silently zeroing edge coverage (0/N across
   all conditions in the first sub-run). The product path was unaffected.

Three full measured sub-runs were made (prompt hash changes force re-extraction):
(a) edge grounding live but harness stripping edge evidence → edge coverage 0/N;
(b) harness fixed → edge coverage real (45–92%) but vertex citation correctness
*fell* to 56–67% from iteration 04's ~80%; (c) after the padding fix → final.

## Discovery: property padding is a hallucination channel

Sub-run (b)'s citation drop was diagnosed by sampling refused citations: **34 of 41
grounded A5 facts carried verbose property bags**, with optional properties filled
by the model's own elaboration — a `GuestPersona` cited by *"our primary demographic
consists of corporate travelers"* carried `description: "Guests who travel for
business purposes, seeking efficiency and reliability"` — content the expert never
said, inside an admitted, "grounded" fact. The citation judge was right to refuse
credit. This is a genuine hallucination channel that per-fact EF under-detects
(the *core* claim is supported; the padding rides along).

Fix: the extractor intro now requires every property value to be grounded in the
expert's words and to **omit** optional properties rather than invent values.
Effect (sub-run b → c, governed conditions): EF +7.7 (A4 75.4→83.1), +7.5
(A4-strict 77.4→84.9), +9.1 (A5 72.7→81.8); vertex citations 56→69% (A5);
UF/turn 1.5→1.69 (A5).

## Outcome (final sub-run; counts and CIs in iteration-05-metrics.json)

| Cond. | UF/turn | UF# | EF | OC | Prov. | Edge Prov. | vCite | eCite | Yield |
|---|---|---|---|---|---|---|---|---|---|
| A0 | 0 | 0 | 92.3% | 0.0% | 0% | 0/6 | — | — | 100% |
| A1 | 1.28 | 41 | 82.0% | 90.0% | 0% | 0/12 | — | — | 100% |
| A2 | 1.28 | 41 | 91.1% | 100% | 0% | 0/7 | — | — | 90.0% |
| A3 | 1.75 | 56 | 86.2% | 100% | 0% | 0/18 | — | — | 97.0% |
| A4 | 1.53 | 49 | 83.1% | 100% | 83.7% | 68.8% | 63.9% | 54.5% | 92.2% |
| A4-strict | 1.41 | 45 | 84.9% | 100% | 100% | 100% (13/13) | 67.5% | 46.2% | 80.3% |
| A5 | **1.69** | **54** | 81.8% | 100% | 84.8% | 65.0% | 69.2% | 46.2% | 100% (66/66) |

Paired tests: **nothing is significant this run** (A0 vs A5 p = 0.125,
A1 vs A5 p = 1, A2 vs A3 p = 0.375). The A1-vs-A5 contamination asymmetry of
sub-run (b) (0/5 against A5) disappeared after the anti-padding and
anti-invention rules (2/2). Iteration 04's significant retry contamination did
not recur — consistent with the anti-invention rule, but not attributable on
n = 32.

## Why it happened

- **Per-turn, the full gate now delivers +32% usable grounded knowledge over
  structure alone** (1.28 → 1.69; 41 → 54 facts) while adding everything A1
  cannot have: vertex provenance 84.8%, edge provenance 65%, deterministic
  identity (0 duplicates), 2 audited supersessions, and 100% conformance.
- **A3 matches A5's volume (1.75 vs 1.69) without any governance.** The gate's
  value over plain retry is not volume — it is that the same volume arrives
  *audited*: quoted, typed, deduplicated, supersession-tracked. This is the
  honest comparison the paper must make.
- **A0's OC hit 0.0%** under this prompt: free-form invented vocabulary for every
  single fact. The baseline is real but near-definitional; framed as context,
  not contribution.
- **Citation quality is now the weakest measured link** (~69% vertex, ~46% edge
  on small n). Edge citations are young — the model often cites the span naming
  one endpoint rather than the span stating the *relationship*.

## What it taught us

- **Grounding leaks through properties.** Fact-level checks pass while
  model-elaborated property values ride in ungrounded. Property-level grounding
  discipline (and eventually property-level checking) is a distinct constraint
  class no metric we had would have isolated — the citation judge caught it.
- Instrumentation bugs announce themselves as zeros: the 0/N edge coverage was a
  harness bug, not a model failure. Check the pipe before the model.
- Framing is part of measurement: with proposals as denominator the gate looked
  like a regression; per interview turn it is a +32% improvement. Both are true;
  only one answers the question a deployer asks.

## Evidence

- `iteration-05-metrics.json` (frozen); `results/results.md`, `results/table1.md`
- Raw per-turn rows: `results/raw/` (local only; verbatim expert speech)
- Sub-run (b) diagnosis: sampled citation refusals with verbose property bags
  (reproduced in this file's Discovery section without verbatim quotes beyond
  those already published in the metrics narrative)
- Code: edge grounding in `lib/gate/gate.ts` / `lib/gate/prompt.ts`; schema
  `src/main/json/hospitality.json`; sections in `lib/server/extract-governed.ts`;
  evidence panel in `components/GraphView.tsx`
