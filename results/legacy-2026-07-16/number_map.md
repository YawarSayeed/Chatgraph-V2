# Complete Number Map

| Claim | Value | Evidence |
|---|---:|---|
| Schema vertex classes | 24 | src/main/json/hospitality.json |
| Knowledge vertex classes | 19 | Schema labels minus infrastructure |
| Edge types | 32 | src/main/json/hospitality.json |
| Sessions | 1 | results/corpus_stats.json |
| Expert turns | 45 total; 32 eligible | results/corpus_stats.json |
| Cohen's kappa | UNMEASURED | Pending two completed pre-adjudication files |
| QA probe | UNMEASURED - out of scope | Recommend cut from Section 5 paragraph 3 |
| A0 candidate facts | 62 | results/raw/A0.jsonl proposed_fact_count |
| A0 admitted facts | 62 | results/raw/A0.jsonl admitted_fact_count |
| A0 ontology conformance | 88.7% (55/62; CI 78.5-94.4%) | results/raw/A0.jsonl; exact numerator/denominator in results/metrics.json |
| A0 subject hallucination | 18.8% (3/16; CI 6.6-43%) | results/raw/A0.jsonl; exact numerator/denominator in results/metrics.json |
| A0 relation hallucination | 0.0% (0/16; CI 0-19.4%) | results/raw/A0.jsonl; exact numerator/denominator in results/metrics.json |
| A0 object hallucination | 18.8% (3/16; CI 6.6-43%) | results/raw/A0.jsonl; exact numerator/denominator in results/metrics.json |
| A0 provenance coverage | 2.2% (1/46; CI 0.4-11.3%) | results/raw/A0.jsonl; exact numerator/denominator in results/metrics.json |
| A0 yield | 100.0% (62/62; CI 94.2-100%) | results/raw/A0.jsonl; exact numerator/denominator in results/metrics.json |
| A0 duplicate rate | 0.0% (0/62; CI 0-5.8%) | results/raw/A0.jsonl; exact numerator/denominator in results/metrics.json |
| A0 retry budget | 0.0% (0/64; CI 0-5.7%) | results/raw/A0.jsonl; exact numerator/denominator in results/metrics.json |
| A0 evidential faithfulness | UNMEASURED | Pending adjudicated human audit labels |
| A0 tokens per admitted fact | 991 | results/raw/A0.jsonl; sum(tokens)/admitted facts |
| A0 seconds per admitted fact | 2.4 | results/raw/A0.jsonl; sum(latency_ms)/admitted facts |
| A0 temporal contradictions | UNMEASURED | No temporal contradiction adjudicator was run |
| A1 candidate facts | 67 | results/raw/A1.jsonl proposed_fact_count |
| A1 admitted facts | 67 | results/raw/A1.jsonl admitted_fact_count |
| A1 ontology conformance | 94.0% (63/67; CI 85.6-97.7%) | results/raw/A1.jsonl; exact numerator/denominator in results/metrics.json |
| A1 subject hallucination | 3.3% (1/30; CI 0.6-16.7%) | results/raw/A1.jsonl; exact numerator/denominator in results/metrics.json |
| A1 relation hallucination | 0.0% (0/30; CI 0-11.4%) | results/raw/A1.jsonl; exact numerator/denominator in results/metrics.json |
| A1 object hallucination | 10.0% (3/30; CI 3.5-25.6%) | results/raw/A1.jsonl; exact numerator/denominator in results/metrics.json |
| A1 provenance coverage | 5.4% (2/37; CI 1.5-17.7%) | results/raw/A1.jsonl; exact numerator/denominator in results/metrics.json |
| A1 yield | 100.0% (67/67; CI 94.6-100%) | results/raw/A1.jsonl; exact numerator/denominator in results/metrics.json |
| A1 duplicate rate | 3.0% (2/67; CI 0.8-10.2%) | results/raw/A1.jsonl; exact numerator/denominator in results/metrics.json |
| A1 retry budget | 0.0% (0/64; CI 0-5.7%) | results/raw/A1.jsonl; exact numerator/denominator in results/metrics.json |
| A1 evidential faithfulness | UNMEASURED | Pending adjudicated human audit labels |
| A1 tokens per admitted fact | 1065 | results/raw/A1.jsonl; sum(tokens)/admitted facts |
| A1 seconds per admitted fact | 1.71 | results/raw/A1.jsonl; sum(latency_ms)/admitted facts |
| A1 temporal contradictions | UNMEASURED | No temporal contradiction adjudicator was run |
| A2 candidate facts | 40 | results/raw/A2.jsonl proposed_fact_count |
| A2 admitted facts | 3 | results/raw/A2.jsonl admitted_fact_count |
| A2 ontology conformance | 100.0% (3/3; CI 43.9-100%) | results/raw/A2.jsonl; exact numerator/denominator in results/metrics.json |
| A2 subject hallucination | 0.0% (0/1; CI 0-79.3%) | results/raw/A2.jsonl; exact numerator/denominator in results/metrics.json |
| A2 relation hallucination | 0.0% (0/1; CI 0-79.3%) | results/raw/A2.jsonl; exact numerator/denominator in results/metrics.json |
| A2 object hallucination | 0.0% (0/1; CI 0-79.3%) | results/raw/A2.jsonl; exact numerator/denominator in results/metrics.json |
| A2 provenance coverage | 0.0% (0/2; CI 0-65.8%) | results/raw/A2.jsonl; exact numerator/denominator in results/metrics.json |
| A2 yield | 7.5% (3/40; CI 2.6-19.9%) | results/raw/A2.jsonl; exact numerator/denominator in results/metrics.json |
| A2 duplicate rate | 0.0% (0/3; CI 0-56.1%) | results/raw/A2.jsonl; exact numerator/denominator in results/metrics.json |
| A2 retry budget | 0.0% (0/64; CI 0-5.7%) | results/raw/A2.jsonl; exact numerator/denominator in results/metrics.json |
| A2 evidential faithfulness | UNMEASURED | Pending adjudicated human audit labels |
| A2 tokens per admitted fact | 20314 | results/raw/A2.jsonl; sum(tokens)/admitted facts |
| A2 seconds per admitted fact | 37.11 | results/raw/A2.jsonl; sum(latency_ms)/admitted facts |
| A2 temporal contradictions | UNMEASURED | No temporal contradiction adjudicator was run |
| A3 candidate facts | 48 | results/raw/A3.jsonl proposed_fact_count |
| A3 admitted facts | 29 | results/raw/A3.jsonl admitted_fact_count |
| A3 ontology conformance | 100.0% (29/29; CI 88.3-100%) | results/raw/A3.jsonl; exact numerator/denominator in results/metrics.json |
| A3 subject hallucination | 0.0% (0/8; CI 0-32.4%) | results/raw/A3.jsonl; exact numerator/denominator in results/metrics.json |
| A3 relation hallucination | 0.0% (0/8; CI 0-32.4%) | results/raw/A3.jsonl; exact numerator/denominator in results/metrics.json |
| A3 object hallucination | 12.5% (1/8; CI 2.2-47.1%) | results/raw/A3.jsonl; exact numerator/denominator in results/metrics.json |
| A3 provenance coverage | 4.8% (1/21; CI 0.8-22.7%) | results/raw/A3.jsonl; exact numerator/denominator in results/metrics.json |
| A3 yield | 60.4% (29/48; CI 46.3-73%) | results/raw/A3.jsonl; exact numerator/denominator in results/metrics.json |
| A3 duplicate rate | 0.0% (0/29; CI 0-11.7%) | results/raw/A3.jsonl; exact numerator/denominator in results/metrics.json |
| A3 retry budget | 39.1% (25/64; CI 28.1-51.3%) | results/raw/A3.jsonl; exact numerator/denominator in results/metrics.json |
| A3 evidential faithfulness | UNMEASURED | Pending adjudicated human audit labels |
| A3 tokens per admitted fact | 4315 | results/raw/A3.jsonl; sum(tokens)/admitted facts |
| A3 seconds per admitted fact | 10.72 | results/raw/A3.jsonl; sum(latency_ms)/admitted facts |
| A3 temporal contradictions | UNMEASURED | No temporal contradiction adjudicator was run |
| A4 candidate facts | 59 | results/raw/A4.jsonl proposed_fact_count |
| A4 admitted facts | 0 | results/raw/A4.jsonl admitted_fact_count |
| A4 ontology conformance | UNMEASURED | No valid denominator |
| A4 subject hallucination | UNMEASURED | No valid denominator |
| A4 relation hallucination | UNMEASURED | No valid denominator |
| A4 object hallucination | UNMEASURED | No valid denominator |
| A4 provenance coverage | UNMEASURED | No valid denominator |
| A4 yield | 0.0% (0/59; CI 0-6.1%) | results/raw/A4.jsonl; exact numerator/denominator in results/metrics.json |
| A4 duplicate rate | UNMEASURED | No valid denominator |
| A4 retry budget | 78.1% (50/64; CI 66.6-86.5%) | results/raw/A4.jsonl; exact numerator/denominator in results/metrics.json |
| A4 evidential faithfulness | UNMEASURED | Pending adjudicated human audit labels |
| A4 tokens per admitted fact | UNMEASURED | results/raw/A4.jsonl; sum(tokens)/admitted facts |
| A4 seconds per admitted fact | UNMEASURED | results/raw/A4.jsonl; sum(latency_ms)/admitted facts |
| A4 temporal contradictions | UNMEASURED | No temporal contradiction adjudicator was run |
| A5 candidate facts | 61 | results/raw/A5.jsonl proposed_fact_count |
| A5 admitted facts | 3 | results/raw/A5.jsonl admitted_fact_count |
| A5 ontology conformance | 100.0% (3/3; CI 43.9-100%) | results/raw/A5.jsonl; exact numerator/denominator in results/metrics.json |
| A5 subject hallucination | 0.0% (0/1; CI 0-79.3%) | results/raw/A5.jsonl; exact numerator/denominator in results/metrics.json |
| A5 relation hallucination | 0.0% (0/1; CI 0-79.3%) | results/raw/A5.jsonl; exact numerator/denominator in results/metrics.json |
| A5 object hallucination | 0.0% (0/1; CI 0-79.3%) | results/raw/A5.jsonl; exact numerator/denominator in results/metrics.json |
| A5 provenance coverage | 100.0% (2/2; CI 34.2-100%) | results/raw/A5.jsonl; exact numerator/denominator in results/metrics.json |
| A5 yield | 4.9% (3/61; CI 1.7-13.5%) | results/raw/A5.jsonl; exact numerator/denominator in results/metrics.json |
| A5 duplicate rate | 0.0% (0/3; CI 0-56.1%) | results/raw/A5.jsonl; exact numerator/denominator in results/metrics.json |
| A5 retry budget | 78.1% (50/64; CI 66.6-86.5%) | results/raw/A5.jsonl; exact numerator/denominator in results/metrics.json |
| A5 evidential faithfulness | UNMEASURED | Pending adjudicated human audit labels |
| A5 tokens per admitted fact | 57692 | results/raw/A5.jsonl; sum(tokens)/admitted facts |
| A5 seconds per admitted fact | 165.72 | results/raw/A5.jsonl; sum(latency_ms)/admitted facts |
| A5 temporal contradictions | UNMEASURED | No temporal contradiction adjudicator was run |
| A4-soft candidate facts | 69 | results/raw/A4-soft.jsonl proposed_fact_count |
| A4-soft admitted facts | 53 | results/raw/A4-soft.jsonl admitted_fact_count |
| A4-soft ontology conformance | 100.0% (53/53; CI 93.2-100%) | results/raw/A4-soft.jsonl; exact numerator/denominator in results/metrics.json |
| A4-soft subject hallucination | 10.7% (3/28; CI 3.7-27.2%) | results/raw/A4-soft.jsonl; exact numerator/denominator in results/metrics.json |
| A4-soft relation hallucination | 0.0% (0/28; CI 0-12.1%) | results/raw/A4-soft.jsonl; exact numerator/denominator in results/metrics.json |
| A4-soft object hallucination | 21.4% (6/28; CI 10.2-39.5%) | results/raw/A4-soft.jsonl; exact numerator/denominator in results/metrics.json |
| A4-soft provenance coverage | 0.0% (0/25; CI 0-13.3%) | results/raw/A4-soft.jsonl; exact numerator/denominator in results/metrics.json |
| A4-soft yield | 76.8% (53/69; CI 65.6-85.2%) | results/raw/A4-soft.jsonl; exact numerator/denominator in results/metrics.json |
| A4-soft duplicate rate | 1.9% (1/53; CI 0.3-9.9%) | results/raw/A4-soft.jsonl; exact numerator/denominator in results/metrics.json |
| A4-soft retry budget | 43.8% (28/64; CI 32.3-55.9%) | results/raw/A4-soft.jsonl; exact numerator/denominator in results/metrics.json |
| A4-soft evidential faithfulness | UNMEASURED | Pending adjudicated human audit labels |
| A4-soft tokens per admitted fact | 2495 | results/raw/A4-soft.jsonl; sum(tokens)/admitted facts |
| A4-soft seconds per admitted fact | 6.66 | results/raw/A4-soft.jsonl; sum(latency_ms)/admitted facts |
| A4-soft temporal contradictions | UNMEASURED | No temporal contradiction adjudicator was run |
| A0 vs A1 McNemar exact p | 1 | results/metrics.json; 32 paired utterances, 6 discordant pairs |
| A3 vs A4 McNemar exact p | 1 | results/metrics.json; 32 paired utterances, 1 discordant pairs |
| A0 vs A5 McNemar exact p | 0.25 | results/metrics.json; 32 paired utterances, 3 discordant pairs |

Every numeric result in this package is computed from a named artifact. Missing experiments are UNMEASURED; no benchmark-derived substitutions are used.
