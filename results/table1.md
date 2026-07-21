# Table 1 — staged ablation of the symbolic gate

Generated 2026-07-21T22:58:50.638Z from `results/gated_ablation_metrics.json`.

| Cond. | OC ↑ | SH ↓ | OH ↓ | Prov. Cov. ↑ | Cite ↑ | EF ↑ | Usable+faithful ↑ | Yield | s/fact |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 ungated free-form | 4.2% | 0.0% | 0.0% | 0.0% | UNMEASURED | 87.5% | 4.2% | 100.0% | 1.22 |
| A1 constrained decoding | 91.1% | 0.0% | 0.0% | 0.0% | UNMEASURED | 93.3% | 84.4% | 100.0% | 1.25 |
| A2 + typed-schema gate | 100.0% | 0.0% | 0.0% | 0.0% | UNMEASURED | 92.7% | 84.4% | 91.1% | 1.37 |
| A3 + typed-error retry | 100.0% | 16.7% | 33.3% | 0.0% | UNMEASURED | 74.3% | 70.5% | 94.9% | 2.19 |
| A4 + provenance requirement | 100.0% | 13.3% | 40.0% | 87.5% | 79.6% | 76.1% | 72.0% | 94.7% | 2.52 |
| A4-strict + provenance enforced hard | 100.0% | 16.7% | 33.3% | 100.0% | 79.6% | 75.4% | 59.7% | 79.2% | 2.98 |
| A5 full deployed gate | 100.0% | 23.5% | 29.4% | 84.5% | 81.6% | 76.0% | 76.0% | 100.0% | 2.47 |

OC = ontology conformance. SH/OH = subject/object hallucination over admitted knowledge-to-knowledge edges.
Prov. Cov. = admitted knowledge vertices carrying evidence. Cite = citations an independent judge confirms license their fact.
EF = admitted facts the judge confirms the utterance supports. Usable+faithful = admitted facts that are both schema-conforming and judge-confirmed, as a share of proposed.

Exact counts and Wilson 95% intervals for every proportion are in `results/metrics.json`.
