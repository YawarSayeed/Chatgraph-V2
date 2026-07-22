# Table 1 — staged ablation of the symbolic gate

Generated 2026-07-21T23:55:03.384Z from `results/gated_ablation_metrics.json`.

| Cond. | UF/turn ↑ | EF ↑ | OC ↑ | Prov. Cov. ↑ | Edge Prov. ↑ | Cite ↑ | Edge Cite ↑ | UF-rate | Yield | s/fact |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 ungated free-form | 0 | 92.3% | 0.0% | 0.0% | 0.0% | UNMEASURED | UNMEASURED | 0.0% | 100.0% | 1.06 |
| A1 constrained decoding | 1.28 | 82.0% | 90.0% | 0.0% | 0.0% | UNMEASURED | UNMEASURED | 82.0% | 100.0% | 1.3 |
| A2 + typed-schema gate | 1.28 | 91.1% | 100.0% | 0.0% | 0.0% | UNMEASURED | UNMEASURED | 82.0% | 90.0% | 1.44 |
| A3 + typed-error retry | 1.75 | 86.2% | 100.0% | 0.0% | 0.0% | UNMEASURED | UNMEASURED | 83.6% | 97.0% | 2.16 |
| A4 + provenance requirement | 1.53 | 83.1% | 100.0% | 83.7% | 68.8% | 63.9% | 54.5% | 76.6% | 92.2% | 2.73 |
| A4-strict + provenance enforced hard | 1.41 | 84.9% | 100.0% | 100.0% | 100.0% | 67.5% | 46.2% | 68.2% | 80.3% | 2.98 |
| A5 full deployed gate | 1.69 | 81.8% | 100.0% | 84.8% | 65.0% | 69.2% | 46.2% | 81.8% | 100.0% | 2.4 |

OC = ontology conformance. SH/OH = subject/object hallucination over admitted knowledge-to-knowledge edges.
Prov. Cov. = admitted knowledge vertices carrying evidence. Cite = citations an independent judge confirms license their fact.
EF = admitted facts the judge confirms the utterance supports. UF/turn = usable+faithful facts (schema-conforming AND judge-confirmed) per eligible interview turn — the headline productivity metric; its denominator is the interview, which unlike proposals is constant across conditions. UF-rate divides the same numerator by proposals and reads as precision. Edge Prov. = admitted knowledge-to-knowledge edges carrying their own evidence.

Exact counts and Wilson 95% intervals for every proportion are in `results/metrics.json`.
