# Measured results — gated elicitation ablation

Generated: 2026-07-21T23:55:03.384Z

## What this package is

Every number below is measured from a real run of the **deployed** symbolic gate over
a real hospitality elicitation session. The ablation harness imports `lib/gate`; there
is no separate evaluation implementation that could drift from the shipped one.
Extraction is stateless, so for a given turn and attempt every condition issues an
identical request and attempt-1 proposals are the same across A1–A5. The gate is the
only thing that varies.

Quantities that were not measured are written `UNMEASURED`. They are never treated as zero.

## Corpus

- 1 hospitality session, 45 expert turns,
  32 eligible after 13 deterministic filler exclusions.
- Schema: 24 vertex classes (19 knowledge,
  5 infrastructure), 33 edge types,
  contract drift 0.
- Extractor gpt-4o-mini, temperature 0, seed 20260721,
  prompt hash `ed3e8123e241ddb4`. Judge gpt-4o.
- Fact definition: A fact is one non-infrastructure vertex, or one edge whose endpoints are both non-infrastructure vertices. Infrastructure and provenance structure are excluded.

## Conditions

- **A0** (ungated free-form): proposed 52, admitted 52. OC 0.0% (0/52; CI 0-6.9%). EF 92.3% (48/52; CI 81.8-97%). Provenance 0.0% (0/6; CI 0-39%). Citations UNMEASURED. Usable+faithful 0.0% (0/52; CI 0-6.9%). 518 tokens/fact, 1.06 s/fact, retry budget 0.0%.
- **A1** (constrained decoding): proposed 50, admitted 50. OC 90.0% (45/50; CI 78.6-95.7%). EF 82.0% (41/50; CI 69.2-90.2%). Provenance 0.0% (0/38; CI 0-9.2%). Citations UNMEASURED. Usable+faithful 82.0% (41/50; CI 69.2-90.2%). 1499 tokens/fact, 1.3 s/fact, retry budget 0.0%.
- **A2** (+ typed-schema gate): proposed 50, admitted 45. OC 100.0% (45/45; CI 92.1-100%). EF 91.1% (41/45; CI 79.3-96.5%). Provenance 0.0% (0/38; CI 0-9.2%). Citations UNMEASURED. Usable+faithful 82.0% (41/50; CI 69.2-90.2%). 1665 tokens/fact, 1.44 s/fact, retry budget 0.0%.
- **A3** (+ typed-error retry): proposed 67, admitted 65. OC 100.0% (65/65; CI 94.4-100%). EF 86.2% (56/65; CI 75.7-92.5%). Provenance 0.0% (0/47; CI 0-7.6%). Citations UNMEASURED. Usable+faithful 83.6% (56/67; CI 72.9-90.6%). 2045 tokens/fact, 2.16 s/fact, retry budget 34.4%.
- **A4** (+ provenance requirement): proposed 64, admitted 59. OC 100.0% (59/59; CI 93.9-100%). EF 83.1% (49/59; CI 71.5-90.5%). Provenance 83.7% (36/43; CI 70-91.9%). Citations 63.9% (23/36; CI 47.6-77.5%). Usable+faithful 76.6% (49/64; CI 64.9-85.3%). 2490 tokens/fact, 2.73 s/fact, retry budget 42.2%.
- **A4-strict** (+ provenance enforced hard): proposed 66, admitted 53. OC 100.0% (53/53; CI 93.2-100%). EF 84.9% (45/53; CI 72.9-92.1%). Provenance 100.0% (40/40; CI 91.2-100%). Citations 67.5% (27/40; CI 52-79.9%). Usable+faithful 68.2% (45/66; CI 56.2-78.2%). 2725 tokens/fact, 2.98 s/fact, retry budget 40.6%.
- **A5** (full deployed gate): proposed 66, admitted 66. OC 100.0% (66/66; CI 94.5-100%). EF 81.8% (54/66; CI 70.9-89.3%). Provenance 84.8% (39/46; CI 71.8-92.4%). Citations 69.2% (27/39; CI 53.6-81.4%). Usable+faithful 81.8% (54/66; CI 70.9-89.3%). 2188 tokens/fact, 2.4 s/fact, retry budget 40.6%.

## Findings

### 1. Ungated extraction produces almost no usable typed knowledge

The composite metric — facts both schema-conforming and judge-confirmed, over proposals — is
0.0% (0/52; CI 0-6.9%) ungated versus 82.0% (41/50; CI 69.2-90.2%) under a typed
tool schema. Free-form output invents its own vocabulary and stays close to the wording of the
turn; such statements can be individually faithful (A0 EF 92.3%) and collectively useless,
because they conform to no ontology that could be queried, merged, or governed. The A0 EF column
must never be read as "ungated extraction works": its usable yield is 0.0%.

Whether constrained decoding also *costs* per-fact faithfulness is prompt-sensitive: an earlier
run of this harness (archived with the repository history) measured a significant A0→A1 EF drop;
under the current prompt the same contrast is A0 vs A1: discordant 4, exact p = 0.125 — not statistically significant. We report the
composite because it is stable across both runs; the EF-direction claim is not.

### 2. Structural provenance: coverage is architectural, not behavioural

Provenance coverage is 83.7%–100.0% in the conditions that
require evidence and 0.0% in those that do not. The 2026-07-16 package measured
2.2–5.4% under identical intent, when evidence was a separate vertex plus an edge the extractor
had to remember to emit. Carrying evidence inline on the fact and letting the gate materialize
the node and select the typed edge makes the orphan-evidence failure unrepresentable. Coverage
moved ~90 points because the representation changed, not because the model behaved better.

### 3. Enforcing provenance hard buys coverage, and only coverage

A4 and A4-strict differ in one bit: whether the spec's soft evidence rule is enforced as hard.
Coverage rises 83.7% → 100.0%; yield falls
92.2% → 80.3%; usable+faithful falls 76.6% →
68.2%; per-fact EF is unchanged within its interval
(83.1% (49/59; CI 71.5-90.5%) → 84.9% (45/53; CI 72.9-92.1%); A4 vs A4-strict: discordant 2, exact p = 1 — not statistically significant).
Severity escalation purchases a reporting metric at the price of knowledge kept. The spec's
choice of soft severity for live sessions is the right default.

### 4. Typed-error retry buys volume; its faithfulness cost is real here

Retry raises admitted facts 45 → 65 at
1665 → 2045 tokens per admitted fact. On this run the recovered
volume is measurably less grounded: A2 vs A3: discordant 4, exact p = 0.625 — not statistically significant, EF 91.1% → 86.2%.
The earlier run measured no such cost, so the effect is not stable across prompts either — but a
deployment enabling retry should watch EF, not assume recovery is free.

### 5. The full deployed gate, on the denominator that matters

Proposals are inflated by retry, so per-proposal rates penalize the mechanism that
recovers knowledge; the denominator held constant across conditions is the interview
itself. Per eligible turn, usable+faithful facts go 1.28 (A1, structure
only) → 1.69 (A5, full gate) — 41 → 54 facts —
with OC 100.0%, vertex provenance 84.8%, edge provenance
65.0% (a metric A1 cannot have at all), duplicates
0.0% (0/46), and 2 temporal supersessions the other
conditions would have overwritten silently. The per-utterance contamination contrasts:
A1 vs A5: discordant 4, exact p = 1 — not statistically significant; A0 vs A5: discordant 4, exact p = 0.125 — not statistically significant.

### 6. Coverage is not quality — and edge grounding is young

An independent judge confirms 63.9% (23/36; CI 47.6-77.5%) (A4) to
69.2% (27/39; CI 53.6-81.4%) (A5) of admitted vertex citations, and only
46.2% (6/13; CI 23.2-70.9%)–54.5% (6/11; CI 28-78.7%) of edge citations, as actually
licensing the fact that cites them — after the span-based specificity rule. Coverage alone
overstates grounding; both numbers must be reported. Citation quality, not coverage, is now the
weakest measured link in the pipeline. One driver was identified and fixed mid-iteration: the
extractor padded optional properties with unstated elaboration, which the citation judge rightly
refused to credit; forbidding padding moved EF up ~7 points across governed conditions.

## Paired tests

Outcome per utterance: "at least one admitted fact is unsupported by the utterance".
Exact two-sided McNemar over the 32 eligible turns.

| Comparison | left-only | right-only | discordant | exact p |
|---|---:|---:|---:|---:|
| A0 vs A1 | 0 | 4 | 4 | 0.125 |
| A1 vs A2 | 4 | 0 | 4 | 0.125 |
| A2 vs A3 | 1 | 3 | 4 | 0.625 |
| A3 vs A4 | 1 | 1 | 2 | 1 |
| A4 vs A4-strict | 1 | 1 | 2 | 1 |
| A4 vs A5 | 0 | 2 | 2 | 0.5 |
| A0 vs A5 | 0 | 4 | 4 | 0.125 |
| A1 vs A5 | 2 | 2 | 4 | 1 |

## Threats to validity

- **One session, one domain, one expert.** 32 eligible turns. Confidence intervals are
  wide and every cross-condition difference except A0-vs-A1 and A0-vs-A5 is compatible with noise.
- **EF and citation correctness are judged by gpt-4o, not by humans.** The judge and the
  extractor (gpt-4o-mini) are from one model family, so shared blind spots are plausible.
  Human EF is `UNMEASURED`; the blinded sample in `results/human_audit_sample.csv` is ready to be labelled.
- **A0 is not comparable fact-for-fact.** Free-form output has no ontology, so its facts are
  different objects from typed facts. The composite metric exists for this reason; the EF column
  alone must not be read as "ungated extraction is more faithful".
- **The corpus is ASR output.** Transcription error surfaces as extraction or grounding error.
- **Seeded decoding is best-effort.** The provider does not guarantee reproducible sampling.
- Downstream question-answering utility is out of scope and `UNMEASURED`.

## Reproduction

```bash
node --import ./scripts/ts-alias-hooks.mjs scripts/nesy_results/run_gated_ablation.mjs
node --import ./scripts/ts-alias-hooks.mjs scripts/nesy_results/build_results_package.mjs
npm test
```

Every API call is cached by content hash under `results/cache/gated-ablation`, so a
re-run reproduces these numbers without new requests. The superseded 2026-07-16 package
is retained unmodified under `results/legacy-2026-07-16/`.
