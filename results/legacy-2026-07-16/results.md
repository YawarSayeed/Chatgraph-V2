# NeSy 2026 Measured Results

Generated: 2026-07-16T23:42:39.334Z

## Executive Result

This package reports only measurements recovered from API caches and deterministic gate replay. A1-A3 are unchanged. A0 was recovered by normalizing the actual free-form responses. A4 and A5 admitted 0/59 and 3/61 facts after the corrected endpoint contract; A4-soft admitted 53/69. Human EF and kappa remain UNMEASURED.

## Corpus And Method

- One hospitality session, 78 transcript messages, 45 expert turns, 32 eligible turns, and 13 deterministic navigation/filler exclusions.
- Extractor: gpt-4o-mini; temperature 0; seed 20260716; prompt hash f075680de0f1ef0c13a94df1fa5c5baccaf143d09526a3a7b19d7214111d384f.
- Grounding judge: gpt-4o where cached verdicts cover every admitted edge.
- Fact: one knowledge vertex, or one edge whose endpoints are both knowledge vertices.
- A4/A5/A4-soft were replayed locally from their final cached deltas after the provenance contract repair. Original API token, latency, and retry totals are retained.

## Table 1

| Cond. | OC up | SH down | RH down | OH down | Prov. Cov. up | EF up | Yield | s/fact |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 | 88.7% (55/62; CI 78.5-94.4%) | 18.8% (3/16; CI 6.6-43%) | 0.0% (0/16; CI 0-19.4%) | 18.8% (3/16; CI 6.6-43%) | 2.2% (1/46; CI 0.4-11.3%) | UNMEASURED | 100.0% (62/62; CI 94.2-100%) | 2.4 |
| A1 | 94.0% (63/67; CI 85.6-97.7%) | 3.3% (1/30; CI 0.6-16.7%) | 0.0% (0/30; CI 0-11.4%) | 10.0% (3/30; CI 3.5-25.6%) | 5.4% (2/37; CI 1.5-17.7%) | UNMEASURED | 100.0% (67/67; CI 94.6-100%) | 1.71 |
| A2 | 100.0% (3/3; CI 43.9-100%) | 0.0% (0/1; CI 0-79.3%) | 0.0% (0/1; CI 0-79.3%) | 0.0% (0/1; CI 0-79.3%) | 0.0% (0/2; CI 0-65.8%) | UNMEASURED | 7.5% (3/40; CI 2.6-19.9%) | 37.11 |
| A3 | 100.0% (29/29; CI 88.3-100%) | 0.0% (0/8; CI 0-32.4%) | 0.0% (0/8; CI 0-32.4%) | 12.5% (1/8; CI 2.2-47.1%) | 4.8% (1/21; CI 0.8-22.7%) | UNMEASURED | 60.4% (29/48; CI 46.3-73%) | 10.72 |
| A4 | UNMEASURED | UNMEASURED | UNMEASURED | UNMEASURED | UNMEASURED | UNMEASURED | 0.0% (0/59; CI 0-6.1%) | UNMEASURED |
| A5 | 100.0% (3/3; CI 43.9-100%) | 0.0% (0/1; CI 0-79.3%) | 0.0% (0/1; CI 0-79.3%) | 0.0% (0/1; CI 0-79.3%) | 100.0% (2/2; CI 34.2-100%) | UNMEASURED | 4.9% (3/61; CI 1.7-13.5%) | 165.72 |
| A4-soft | 100.0% (53/53; CI 93.2-100%) | 10.7% (3/28; CI 3.7-27.2%) | 0.0% (0/28; CI 0-12.1%) | 21.4% (6/28; CI 10.2-39.5%) | 0.0% (0/25; CI 0-13.3%) | UNMEASURED | 76.8% (53/69; CI 65.6-85.2%) | 6.66 |

All reported proportions include exact counts and Wilson 95% intervals. UNMEASURED means the required measurement does not exist; it is not treated as zero.

## Findings

### Structure Is Not Evidential Binding

A1 reached 94.0% (63/67; CI 85.6-97.7%), but only 5.4% (2/37; CI 1.5-17.7%) of admitted knowledge vertices had provenance. A3 reached 100.0% (29/29; CI 88.3-100%) with provenance coverage 4.8% (1/21; CI 0.8-22.7%). Typed structure and retry therefore produced schema-valid output without reliably binding it to evidence.

### Provenance Contract Failure

The provenance attachment map omitted ExpertRole, HospitalityBusiness, and OperatingTenure even though the schema declares them as knowledge classes. This first-hand deployment failure caused endpoint and attachment disagreement, directly supporting Lesson 1: extractor instructions, schema endpoints, and gate rules must share one generated contract. The repair makes all three provenance-required via supportedBy. Other failures, including missing provenance edges and dangling semantic edges, remain genuine rejections.

### A0 Parser Recovery

The original A0 parser expected strict id/label/properties and out/in shapes. Actual free-form responses used flat properties, source/target edges, and occasional type-keyed objects. The liberal parser recovered 62 admitted facts from 32 eligible turns. JSON unparseable rate: 0.0% (0/32; CI 0-10.7%). Empty deltas remain legitimate zero-yield outputs.

### Logged Examples

- Rejected provenance trace: UNMEASURED; no final replay rejection contained trace text.
- Hallucinated relation endpoint: chatgraph-20260716-203203:u007:businessdifferentiatedby:service-integration: The utterance discusses utilizing other services like a restaurant or spa, which supports service integration, but does not mention predictability..
- Temporal contradiction example: UNMEASURED; the run did not implement a temporal contradiction adjudicator, so the previous numeric claims were removed.

### Lesson-5 Check

DecisionRule or OperatingHeuristic vertices attached to evidence marked confidence=inferred: 0. The count is descriptive; compliance with the two-episode rule requires the cited episode text and is not inferred from confidence alone.

## Cost Accounting

| Condition | Proposed | Admitted | Tokens/fact | Seconds/fact | Retry budget |
|---|---:|---:|---:|---:|---:|
| A0 | 62 | 62 | 991 | 2.4 | 0.0% (0/64; CI 0-5.7%) |
| A1 | 67 | 67 | 1065 | 1.71 | 0.0% (0/64; CI 0-5.7%) |
| A2 | 40 | 3 | 20314 | 37.11 | 0.0% (0/64; CI 0-5.7%) |
| A3 | 48 | 29 | 4315 | 10.72 | 39.1% (25/64; CI 28.1-51.3%) |
| A4 | 59 | 0 | UNMEASURED | UNMEASURED | 78.1% (50/64; CI 66.6-86.5%) |
| A5 | 61 | 3 | 57692 | 165.72 | 78.1% (50/64; CI 66.6-86.5%) |
| A4-soft | 69 | 53 | 2495 | 6.66 | 43.8% (28/64; CI 32.3-55.9%) |

Proposal counts vary materially by condition. This is a threat to the paper's claim that only the gate varies: request shape, feedback, and graph state also changed extractor volume. Fact-level pairing is therefore invalid.

## Audit And Statistical Tests

The blinded audit contains 83 rows: A0=40, A1=40, A4=0, A5=3. Conditions with at most 50 admitted facts use a census; larger pools use a section-stratified sample of 40. Human fields are blank. EF and Cohen's kappa are UNMEASURED until two pre-adjudication files and one adjudicated file arrive.

Exact two-sided McNemar tests use 32 paired utterances and the binary outcome "at least one admitted edge has an unsupported subject or object":
- A0 vs A1: left-only=3, right-only=3, discordant=6, exact p=1.
- A3 vs A4: left-only=1, right-only=0, discordant=1, exact p=1.
- A0 vs A5: left-only=3, right-only=0, discordant=3, exact p=0.25.

This utterance-level pairing is valid even though fact-level pairing is not; a no-edge or no-admission utterance has no ungrounded admitted edge.

The downstream QA probe is UNMEASURED and out of scope. Recommend cutting the corresponding sentence from Section 5 paragraph 3.

## Decisions I Made Autonomously

- Classified ExpertRole, HospitalityBusiness, and OperatingTenure as provenance-required because they are expert-asserted world claims, using supportedBy to match the default provenance convention. This can reduce yield relative to exempting identity/business facts, but preserves the experiment's evidence-binding thesis.
- Treated empty A0 JSON deltas as parsed zero-yield results; only malformed JSON counts as unparseable.
- Replayed final cached A4/A5/A4-soft deltas and retained original run costs. Earlier attempt bodies are cache-resident but not linked in raw rows, so no claim is made that replay stopped at the earliest newly passing attempt.
- Used UNMEASURED, never zero, when a denominator or required annotation is absent.

## Threats To Validity

- One session and one domain limit external validity.
- Proposal-count variance means fact-level cross-condition pairing is impossible.
- The session was voice-transcribed; verbatimText is ASR output, so transcription errors can surface as apparent extraction or grounding failures.
- Seed support is best-effort and does not guarantee deterministic provider output.
- SH/OH use an independent model judge and are UNMEASURED where complete cached verdict coverage is absent.
- Final-delta gate replay cannot reconstruct the counterfactual graph state that would result from stopping on an earlier corrected attempt.
- A0 normalization infers schema labels from emitted property signatures; all raw responses and adapter diagnostics remain available for audit.

## Reproduction

- Rebuild: `npm run results:recover`
- Ingest completed human audit: `npm run results:audit`
- Validate: `npm run test`
- Full checks: `npm run typecheck && npm run lint && npm run build && npm run test`
