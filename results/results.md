# Measured results — gated elicitation ablation

Generated: 2026-07-21T22:58:50.638Z

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
  prompt hash `dd62d951b0145838`. Judge gpt-4o.
- Fact definition: A fact is one non-infrastructure vertex, or one edge whose endpoints are both non-infrastructure vertices. Infrastructure and provenance structure are excluded.

## Conditions

- **A0** (ungated free-form): proposed 48, admitted 48. OC 4.2% (2/48; CI 1.2-14%). EF 87.5% (42/48; CI 75.3-94.1%). Provenance 0.0% (0/11; CI 0-25.9%). Citations UNMEASURED. Usable+faithful 4.2% (2/48; CI 1.2-14%). 519 tokens/fact, 1.22 s/fact, retry budget 0.0%.
- **A1** (constrained decoding): proposed 45, admitted 45. OC 91.1% (41/45; CI 79.3-96.5%). EF 93.3% (42/45; CI 82.1-97.7%). Provenance 0.0% (0/39; CI 0-9%). Citations UNMEASURED. Usable+faithful 84.4% (38/45; CI 71.2-92.3%). 1550 tokens/fact, 1.25 s/fact, retry budget 0.0%.
- **A2** (+ typed-schema gate): proposed 45, admitted 41. OC 100.0% (41/41; CI 91.4-100%). EF 92.7% (38/41; CI 80.6-97.5%). Provenance 0.0% (0/39; CI 0-9%). Citations UNMEASURED. Usable+faithful 84.4% (38/45; CI 71.2-92.3%). 1701 tokens/fact, 1.37 s/fact, retry budget 0.0%.
- **A3** (+ typed-error retry): proposed 78, admitted 74. OC 100.0% (74/74; CI 95.1-100%). EF 74.3% (55/74; CI 63.3-82.9%). Provenance 0.0% (0/56; CI 0-6.4%). Citations UNMEASURED. Usable+faithful 70.5% (55/78; CI 59.6-79.5%). 2054 tokens/fact, 2.19 s/fact, retry budget 53.1%.
- **A4** (+ provenance requirement): proposed 75, admitted 71. OC 100.0% (71/71; CI 94.9-100%). EF 76.1% (54/71; CI 65-84.5%). Provenance 87.5% (49/56; CI 76.4-93.8%). Citations 79.6% (39/49; CI 66.4-88.5%). Usable+faithful 72.0% (54/75; CI 61-80.9%). 2285 tokens/fact, 2.52 s/fact, retry budget 59.4%.
- **A4-strict** (+ provenance enforced hard): proposed 77, admitted 61. OC 100.0% (61/61; CI 94.1-100%). EF 75.4% (46/61; CI 63.3-84.5%). Provenance 100.0% (49/49; CI 92.7-100%). Citations 79.6% (39/49; CI 66.4-88.5%). Usable+faithful 59.7% (46/77; CI 48.6-70%). 2774 tokens/fact, 2.98 s/fact, retry budget 64.1%.
- **A5** (full deployed gate): proposed 75, admitted 75. OC 100.0% (75/75; CI 95.1-100%). EF 76.0% (57/75; CI 65.2-84.2%). Provenance 84.5% (49/58; CI 73.1-91.6%). Citations 81.6% (40/49; CI 68.6-90%). Usable+faithful 76.0% (57/75; CI 65.2-84.2%). 2230 tokens/fact, 2.47 s/fact, retry budget 62.5%.

## Findings

### 1. Ungated extraction produces almost no usable typed knowledge

The composite metric — facts both schema-conforming and judge-confirmed, over proposals — is
4.2% (2/48; CI 1.2-14%) ungated versus 84.4% (38/45; CI 71.2-92.3%) under a typed
tool schema. Free-form output invents its own vocabulary and stays close to the wording of the
turn; such statements can be individually faithful (A0 EF 87.5%) and collectively useless,
because they conform to no ontology that could be queried, merged, or governed. The A0 EF column
must never be read as "ungated extraction works": its usable yield is 4.2%.

Whether constrained decoding also *costs* per-fact faithfulness is prompt-sensitive: an earlier
run of this harness (archived with the repository history) measured a significant A0→A1 EF drop;
under the current prompt the same contrast is A0 vs A1: discordant 3, exact p = 1 — not statistically significant. We report the
composite because it is stable across both runs; the EF-direction claim is not.

### 2. Structural provenance: coverage is architectural, not behavioural

Provenance coverage is 87.5%–100.0% in the conditions that
require evidence and 0.0% in those that do not. The 2026-07-16 package measured
2.2–5.4% under identical intent, when evidence was a separate vertex plus an edge the extractor
had to remember to emit. Carrying evidence inline on the fact and letting the gate materialize
the node and select the typed edge makes the orphan-evidence failure unrepresentable. Coverage
moved ~90 points because the representation changed, not because the model behaved better.

### 3. Enforcing provenance hard buys coverage, and only coverage

A4 and A4-strict differ in one bit: whether the spec's soft evidence rule is enforced as hard.
Coverage rises 87.5% → 100.0%; yield falls
94.7% → 79.2%; usable+faithful falls 72.0% →
59.7%; per-fact EF is unchanged within its interval
(76.1% (54/71; CI 65-84.5%) → 75.4% (46/61; CI 63.3-84.5%); A4 vs A4-strict: discordant 1, exact p = 1 — not statistically significant).
Severity escalation purchases a reporting metric at the price of knowledge kept. The spec's
choice of soft severity for live sessions is the right default.

### 4. Typed-error retry buys volume; its faithfulness cost is real here

Retry raises admitted facts 41 → 74 at
1701 → 2054 tokens per admitted fact. On this run the recovered
volume is measurably less grounded: A2 vs A3: discordant 7, exact p = 0.0156 — significant, EF 92.7% → 74.3%.
The earlier run measured no such cost, so the effect is not stable across prompts either — but a
deployment enabling retry should watch EF, not assume recovery is free.

### 5. The full deployed gate

A5 (schema + soft provenance + confidence vocabulary + entity resolution + content-derived
identity + supersession) admits 100.0% (75/75; CI 95.1-100%) of proposals with OC 100.0%,
duplicates 0.0% (0/57), usable+faithful
76.0% (57/75; CI 65.2-84.2%) — the highest composite among the retry-bearing
conditions — and 2 temporal supersessions that the other conditions
would have overwritten silently. Against ungated extraction the per-utterance contamination test
is A0 vs A5: discordant 5, exact p = 0.0625 — not statistically significant.

### 6. Coverage is not quality

An independent judge confirms only 79.6% (39/49; CI 66.4-88.5%) (A4) to
81.6% (40/49; CI 68.6-90%) (A5) of admitted citations actually license the fact that
cites them, even after the span-based specificity rule. Roughly one citation in five is a quote
that does not support its claim. Provenance coverage alone overstates grounding; report both.

## Paired tests

Outcome per utterance: "at least one admitted fact is unsupported by the utterance".
Exact two-sided McNemar over the 32 eligible turns.

| Comparison | left-only | right-only | discordant | exact p |
|---|---:|---:|---:|---:|
| A0 vs A1 | 2 | 1 | 3 | 1 |
| A1 vs A2 | 0 | 0 | 0 | 1 |
| A2 vs A3 | 0 | 7 | 7 | 0.0156 |
| A3 vs A4 | 1 | 0 | 1 | 1 |
| A4 vs A4-strict | 1 | 0 | 1 | 1 |
| A4 vs A5 | 1 | 1 | 2 | 1 |
| A0 vs A5 | 0 | 5 | 5 | 0.0625 |

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
