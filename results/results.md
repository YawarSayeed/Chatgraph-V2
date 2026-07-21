# Measured results — gated elicitation ablation

Generated: 2026-07-21T21:34:48.177Z

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
  prompt hash `25aa1b780beeda5d`. Judge gpt-4o.
- Fact definition: A fact is one non-infrastructure vertex, or one edge whose endpoints are both non-infrastructure vertices. Infrastructure and provenance structure are excluded.

## Conditions

- **A0** (ungated free-form): proposed 48, admitted 48. OC 2.1% (1/48; CI 0.4-10.9%). EF 95.8% (46/48; CI 86-98.8%). Provenance 0.0% (0/16; CI 0-19.4%). Citations UNMEASURED. Usable+faithful 2.1% (1/48; CI 0.4-10.9%). 476 tokens/fact, 1.42 s/fact, retry budget 0.0%.
- **A1** (constrained decoding): proposed 45, admitted 45. OC 95.6% (43/45; CI 85.2-98.8%). EF 82.2% (37/45; CI 68.7-90.7%). Provenance 0.0% (0/37; CI 0-9.4%). Citations UNMEASURED. Usable+faithful 80.0% (36/45; CI 66.2-89.1%). 1510 tokens/fact, 1.82 s/fact, retry budget 0.0%.
- **A2** (+ typed-schema gate): proposed 45, admitted 42. OC 100.0% (42/42; CI 91.6-100%). EF 83.3% (35/42; CI 69.4-91.7%). Provenance 0.0% (0/37; CI 0-9.4%). Citations UNMEASURED. Usable+faithful 77.8% (35/45; CI 63.7-87.5%). 1618 tokens/fact, 1.95 s/fact, retry budget 0.0%.
- **A3** (+ typed-error retry): proposed 75, admitted 69. OC 100.0% (69/69; CI 94.7-100%). EF 85.5% (59/69; CI 75.3-91.9%). Provenance 0.0% (0/54; CI 0-6.6%). Citations UNMEASURED. Usable+faithful 78.7% (59/75; CI 68.1-86.4%). 2300 tokens/fact, 3.71 s/fact, retry budget 60.9%.
- **A4** (+ provenance requirement): proposed 81, admitted 74. OC 100.0% (74/74; CI 95.1-100%). EF 81.1% (60/74; CI 70.7-88.4%). Provenance 92.7% (51/55; CI 82.7-97.1%). Citations 70.6% (36/51; CI 57-81.3%). Usable+faithful 74.1% (60/81; CI 63.6-82.4%). 2244 tokens/fact, 3.62 s/fact, retry budget 65.6%.
- **A4-strict** (+ provenance enforced hard): proposed 78, admitted 66. OC 100.0% (66/66; CI 94.5-100%). EF 86.4% (57/66; CI 76.1-92.7%). Provenance 98.1% (51/52; CI 89.9-99.7%). Citations 78.4% (40/51; CI 65.4-87.5%). Usable+faithful 73.1% (57/78; CI 62.3-81.7%). 2597 tokens/fact, 4.32 s/fact, retry budget 68.8%.
- **A5** (full deployed gate): proposed 80, admitted 75. OC 100.0% (75/75; CI 95.1-100%). EF 80.0% (60/75; CI 69.6-87.5%). Provenance 92.7% (51/55; CI 82.7-97.1%). Citations 76.5% (39/51; CI 63.2-86%). Usable+faithful 75.0% (60/80; CI 64.5-83.2%). 2212 tokens/fact, 3.53 s/fact, retry budget 65.6%.

## Findings

### 1. Structure is not grounding — and it costs grounding

Constrained decoding does what it claims: ontology conformance rises from
2.1% (1/48) ungated to 95.6% (43/45) under a typed tool schema.
Evidential faithfulness moves the other way, from 95.8% (46/48; CI 86-98.8%) to 82.2% (37/45; CI 68.7-90.7%).
The paired test over the 32 shared utterances is significant:
A0 vs A1 discordant 6, exact p = 0.0313.

The mechanism is visible in the raw output. Ungated extraction invents its own
vocabulary — labels such as "Service Standardization" and "eye twitch signal",
relations such as "appreciates" and "enhances" — and stays close to the wording of
the turn. Those statements are easy for a judge to confirm and impossible to query,
merge, or govern. **Free-form faithfulness is the precision of vagueness.**

### 2. What the gate is actually worth: usable, grounded knowledge

Neither conformance nor faithfulness alone captures the goal. A fact that conforms to
no ontology cannot be used; a schema-perfect fact the utterance does not support is a
hallucination with good manners. Counting facts that are **both**:

- A0: 2.1% (1/48; CI 0.4-10.9%)
- A1: 80.0% (36/45; CI 66.2-89.1%)
- A2: 77.8% (35/45; CI 63.7-87.5%)
- A3: 78.7% (59/75; CI 68.1-86.4%)
- A4: 74.1% (60/81; CI 63.6-82.4%)
- A4-strict: 73.1% (57/78; CI 62.3-81.7%)
- A5: 75.0% (60/80; CI 64.5-83.2%)

Ungated extraction converts 2.1% of what it proposes into usable
grounded knowledge. Every gated condition converts 77.8%–80.0%.
That gap, not the EF column, is what the gate buys.

### 3. Provenance as an admission criterion

A4 and A4-strict differ in exactly one bit: whether the spec's soft rule HR006
("every knowledge vertex must carry evidence") is enforced as hard. Everything else —
prompt, model, seed, retry budget, other constraints — is identical.

| | A4 (soft) | A4-strict (hard) |
|---|---|---|
| Provenance coverage | 92.7% (51/55; CI 82.7-97.1%) | 98.1% (51/52; CI 89.9-99.7%) |
| Citation correctness | 70.6% (36/51; CI 57-81.3%) | 78.4% (40/51; CI 65.4-87.5%) |
| Evidential faithfulness | 81.1% (60/74; CI 70.7-88.4%) | 86.4% (57/66; CI 76.1-92.7%) |
| Yield | 91.4% (74/81; CI 83.2-95.8%) | 84.6% (66/78; CI 75-91%) |

Enforcing evidence raises faithfulness and citation quality and costs yield, in the
direction the design predicts. **The effect is not statistically significant on this
corpus**: only 2 utterances are discordant, exact p = 0.5.
The point estimate is suggestive; the sample cannot carry the claim.

### 4. Structural provenance is what made provenance measurable at all

Provenance coverage is 92.7%–98.1% in the conditions that require it
and 0.0% in those that do not. The archived 2026-07-16 run measured
2.2–5.4% under an identical intent, because evidence was a separate vertex plus an edge the
extractor had to remember to emit: it produced 41 evidence nodes and only 7 provenance edges.
Carrying evidence inline on the fact and letting the gate materialize the node and select the
correctly-typed edge makes the orphan case unrepresentable.

### 5. Coverage is not quality

Citations pass the anti-generic rule and still fail on inspection: an independent judge
confirms only 70.6% (36/51; CI 57-81.3%) of A4 citations and 78.4% (40/51; CI 65.4-87.5%) of A4-strict
citations actually license the fact that cites them. **Provenance coverage overstates
grounding.** A deployment that reports coverage alone is reporting the wrong number.

### 6. Constraints that bought nothing measurable here

Reported plainly because the ablation is only worth running if it can return a negative:

- **Deterministic identity.** Duplicate rate is 0.0% (0/55) under the full
  gate and 0.0% (0/52) without it. On this corpus the extractor rarely
  restates a fact in content-identical form, so content-derived ids had nothing to collapse.
  The constraint is cheap and prevents a failure this session did not exhibit.
- **Typed-error retry** raised admitted facts from 42 to 69 at
  1618→2300 tokens per admitted fact, with EF unchanged within its interval
  (83.3% → 85.5%). Retry buys volume, not faithfulness — and does not cost it.
- **Temporal contradiction handling** fired 2 times: 2 superseding corrections
  the other conditions would have silently overwritten. Real, but a single-session count.

## Paired tests

Outcome per utterance: "at least one admitted fact is unsupported by the utterance".
Exact two-sided McNemar over the 32 eligible turns.

| Comparison | left-only | right-only | discordant | exact p |
|---|---:|---:|---:|---:|
| A0 vs A1 | 0 | 6 | 6 | 0.0313 |
| A1 vs A2 | 1 | 0 | 1 | 1 |
| A2 vs A3 | 1 | 2 | 3 | 1 |
| A3 vs A4 | 1 | 2 | 3 | 1 |
| A4 vs A4-strict | 2 | 0 | 2 | 0.5 |
| A4 vs A5 | 1 | 1 | 2 | 1 |
| A0 vs A5 | 0 | 7 | 7 | 0.0156 |

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
