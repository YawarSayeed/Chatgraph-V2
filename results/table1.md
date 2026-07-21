# Table 1 — staged ablation of the symbolic gate

Generated 2026-07-21T21:34:48.177Z from `results/gated_ablation_metrics.json`.

| Cond. | OC ↑ | SH ↓ | OH ↓ | Prov. Cov. ↑ | Cite ↑ | EF ↑ | Usable+faithful ↑ | Yield | s/fact |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 ungated free-form | 2.1% | 0.0% | 0.0% | 0.0% | UNMEASURED | 95.8% | 2.1% | 100.0% | 1.42 |
| A1 constrained decoding | 95.6% | 0.0% | 12.5% | 0.0% | UNMEASURED | 82.2% | 80.0% | 100.0% | 1.82 |
| A2 + typed-schema gate | 100.0% | 0.0% | 20.0% | 0.0% | UNMEASURED | 83.3% | 77.8% | 93.3% | 1.95 |
| A3 + typed-error retry | 100.0% | 6.7% | 13.3% | 0.0% | UNMEASURED | 85.5% | 78.7% | 92.0% | 3.71 |
| A4 + provenance requirement | 100.0% | 10.5% | 21.1% | 92.7% | 70.6% | 81.1% | 74.1% | 91.4% | 3.62 |
| A4-strict + provenance enforced hard | 100.0% | 7.1% | 14.3% | 98.1% | 78.4% | 86.4% | 73.1% | 84.6% | 4.32 |
| A5 full deployed gate | 100.0% | 20.0% | 25.0% | 92.7% | 76.5% | 80.0% | 75.0% | 93.8% | 3.53 |

OC = ontology conformance. SH/OH = subject/object hallucination over admitted knowledge-to-knowledge edges.
Prov. Cov. = admitted knowledge vertices carrying evidence. Cite = citations an independent judge confirms license their fact.
EF = admitted facts the judge confirms the utterance supports. Usable+faithful = admitted facts that are both schema-conforming and judge-confirmed, as a share of proposed.

Exact counts and Wilson 95% intervals for every proportion are in `results/metrics.json`.
