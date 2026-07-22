Proceedings of Machine Learning Research -:1-6, 2026 NeSy 2026 Industry Track

# Provenance by Construction: A Symbolic Admission Gate for Knowledge Graphs from Live Expert Elicitation

**Anonymous Author(s)** [anonymous@example.com](mailto:anonymous@example.com)

_Affiliation withheld for double-blind review_

> **Status.** Every number in this draft is measured from the run recorded in
> `results/metrics.json` and reproducible with `npm run ablation`. Evidential
> faithfulness and citation correctness are adjudicated by an independent model,
> not by human annotators; a blinded human-audit sample is prepared but unlabelled,
> and those figures are reported as such throughout. Where an effect is not
> statistically significant, we say so.

## Abstract

Institutions increasingly convert expert interviews into typed knowledge graphs with
large language models, but for tacit expertise there is no reference graph to check
the result against: ground truth must be manufactured at capture time, by binding
every admitted fact to the utterance that licensed it. We describe a deterministic
symbolic gate — typed schema, structural provenance with a span rule, calibrated
confidence, entity resolution with content-derived identity, invalidate-not-delete
corrections — deployed in a live elicitation product, and a staged ablation whose
harness executes the deployed gate itself. Our central engineering result is
representational: carrying evidence *inline on each proposed fact*, with the gate
materializing the evidence node and selecting the typed edge, raises provenance
coverage from the 2–5% we measured when evidence was a separate structure the model
had to remember, to 84.8–100% — and extends to relationship claims, where edges
carry their own citations (65–100% coverage). Per interview turn, the full gate
yields 1.69 usable grounded facts versus 1.28 for constrained decoding alone (+32%),
at 100% ontology conformance, zero duplicates, and full auditability. We report
costs and failures as measured: citation *quality* lags coverage (69% of vertex and
46% of edge citations are confirmed by an independent judge); a previously invisible
hallucination channel — the extractor padding optional properties with unstated
elaboration — was exposed by the citation audit and closed, moving evidential
faithfulness up 7–9 points; per-fact faithfulness contrasts between conditions
proved prompt-sensitive across three controlled runs on the same corpus, and none
of this run's paired contrasts reach significance on 32 turns. Provenance can be
guaranteed by construction; whether the citation *supports* the claim remains the
open, measurable frontier.

**Keywords:** neurosymbolic validation, knowledge graphs, hallucination, provenance,
expert elicitation

## 1. Introduction

Organisations lose operating knowledge when experts leave, and converting it into
machine-usable form is now an LLM task. The artifact of choice is a typed knowledge
graph built by extraction from interview transcripts.

Two observations motivate this paper. First, *structure is solved*: constrained
decoding guarantees schema-compliant output at scale — but a JSON object can be
perfectly schema-compliant and entirely fabricated, and no grammar can express "this
triple must be supported by something the expert said." Second, the standard
fallback — verifying candidates against a reference knowledge graph — is unavailable
*by construction* for tacit expertise: there is no Wikidata for how a senior
practitioner decides. Ground truth must be **manufactured at capture time**, by binding
every admitted fact to the utterance that licensed it.

We contribute:

1. a deterministic symbolic gate that admits, rejects, or repairs LLM-proposed
   knowledge at the ingestion boundary, deployed in a live elicitation product;
2. **provenance by construction** — evidence carried inline on each proposed fact
   *and each proposed relationship*, with the gate materializing evidence nodes,
   selecting typed edges, and storing edge citations — making the orphan-evidence
   failure mode unrepresentable rather than merely detected;
3. a staged ablation in which the evaluation harness *imports the deployed gate*,
   so a measured result is a claim about the shipped system, with the interview
   turn as the cross-condition denominator;
4. the identification, via citation auditing, of **property padding** as a
   hallucination channel that per-fact faithfulness metrics under-detect, and its
   closure by a grounding rule worth +7–9 EF points;
5. an honest accounting across three controlled runs: which constraints bought
   nothing, which effects are prompt-sensitive, and a non-replication of our own
   earlier headline finding.

## 2. Related Work

**Structured generation is solved; grounding is not.** Grammar-constrained decoding is
commoditised, with production frameworks evaluated over thousands of real schemas.
These guarantee the *form* of output, never its relation to a source. Our A0→A1
contrast quantifies the gap directly.

**LLM→KG construction measures hallucination; it does not prevent it.** Text2KGBench
defines the canonical metrics — ontology conformance and subject/relation/object
hallucination — but scores pipelines post hoc. EDC canonicalises *after* extraction;
AutoSchemaKG lets the extractor induce its own schema, so a hallucinated type creates a
slot rather than hitting one; GraphRAG ships ungated extraction evaluated on
comprehensiveness, not faithfulness. Surveys agree that "LLM proposes, validation
disposes" is the dominant paradigm, with no evidence of what each stage is worth.

**KG-grounded factuality assumes a public KG; symbolic gating is industrially proven —
but not at this boundary.** KGHaluBench and KG-retrofitting approaches presuppose
consensus reference knowledge that tacit expertise lacks. Bi-temporal agent-memory
substrates govern *time* but drive extraction with an LLM and no independent schema
gate, and are evaluated on retrieval rather than extraction faithfulness. SHACL is the
right symbolic ancestor but cannot express evidential support, calibrated confidence, or
temporal validity, and has no retry path back to a generative producer. LLM-as-judge
verification is neural checking neural and not deterministically reproducible.

## 3. A Gated Elicitation Pipeline

**Deployment context.** The system is a knowledge-elicitation product in the hospitality
vertical. A seven-section structured interview elicits an expert's operating knowledge
by voice or text; each turn is segmented into a typed episode, from which an LLM
extractor proposes a delta against a typed schema of 24 vertex classes (19 knowledge,
5 infrastructure) and 33 edge types.

**Pipeline.** Elicitation → episodic segmentation → typed extraction → *gated
persistence*. Nothing enters the graph without passing the gate.

**The gate.** A deterministic function evaluates every proposed element against five
constraint classes:

- **(i) Typed-schema conformance.** Allowed labels, edge endpoint types, required
  properties, from a human-authored, version-controlled schema.
- **(ii) Provenance with a specificity rule — on facts and on relationships.**
  Every knowledge vertex must carry traceable evidence, and every knowledge-to-
  knowledge edge may carry its own: the extractor attaches an `evidence` object to
  the fact or edge, and the gate materializes the evidence vertex (or stores the
  citation on the edge), supplies episode and speaker from the turn, and selects
  the provenance edge from the contract. The specificity rule requires the trace to
  be a **span of the utterance** and to not restate the whole turn; the `inferred`
  confidence tier relaxes the span requirement to an audit flag, since cross-turn
  synthesis is by definition not a span of the current turn. Property values must
  be grounded too: optional properties are omitted rather than filled with
  elaboration the evidence cannot support.
- **(iii) Confidence tier** from a closed vocabulary {high, medium, low, inferred},
  with `inferred` marking cross-episode synthesis that no single quote supports.
- **(iv) Identity: resolution, then content-derived ids.** A proposed fact whose label
  and key text match an existing vertex (identical after normalisation, or token
  overlap ≥ 0.6 with tokens matched up to one edit, so "centred" matches "centered"
  and "signal" matches "signals") resolves onto the existing vertex; genuinely new
  facts receive an id derived from a hash of label and normalised properties. Both
  passes are deterministic. Without resolution, a live pilot session accumulated 22
  near-duplicate GuestExperiencePrinciple vertices, each re-wired to the same hub
  nodes; with it, the same transcript yields 5.
- **(v) Invalidate-not-delete.** A changed session-singleton supersedes its predecessor
  via an explicit edge; the superseded claim stays in the graph.

**Per-fact admission.** The gate admits or rejects each element, not each delta. This is
not a detail: replaying our own earlier per-delta implementation over its archived
deltas, one dangling edge discarded an entire turn's knowledge, costing 60.4% → 97.9%
of otherwise-admissible facts.

**Severity and repair.** Constraints carry graduated severity — *hard* (reject; typed
error echoed to the extractor; bounded retry), *soft* (admit, warn, flag), *advisory*
(reported only) — read from the authored specification rather than from the code.

**One contract.** The schema reference in the extractor's prompt, the tool parameter
schema, and the gate's rules are all generated from a single contract derived from the
schema and specification files. A rule the contract cannot bind to the schema is
reported as drift and **disabled**, never silently reinterpreted. The harness refuses to
run while drift is non-zero.

## 4. Evaluation Design

**Data.** One deployed hospitality elicitation session: 45 expert turns, 32 eligible
after 13 deterministic filler exclusions. The transcript is private and post-dates the
extractor's training data, so the evaluation is leakage-free by construction.

**Conditions.** Seven configurations of one frozen extractor (gpt-4o-mini, temperature
0, seed 20260721, prompt hash fixed): **A0** ungated free-form; **A1** constrained
decoding only; **A2** + typed-schema gate; **A3** + typed-error bounded retry; **A4** +
provenance requirement at the severity the specification declares (soft); **A4-strict**
identical to A4 with that one rule escalated to hard; **A5** + confidence vocabulary,
content-derived identity, and temporal supersession — the deployed configuration.

**Two controls that the design depends on.** First, the harness *imports the deployed
gate*; there is no second implementation to drift. Second, extraction is **stateless**:
the request depends only on the turn, the attempt, and the correction text, never on the
condition, so attempt-1 proposals are identical across A1–A5 and fact-level pairing is
valid. A prior version of this experiment varied request shape and graph context by
condition, which invalidated exactly that pairing.

**Metrics.** Ontology Conformance (OC) and Subject/Object Hallucination (SH/OH) follow
Text2KGBench. Ours: *Provenance Coverage* (admitted knowledge vertices carrying
evidence); *Citation Correctness* (citations an independent judge confirms license their
fact); *Evidential Faithfulness* (EF, admitted facts the judge confirms the utterance
supports); *Usable+Faithful* (admitted facts that are **both** schema-conforming and
judge-confirmed, over proposals); *Duplicate Rate*; *Yield*; *Cost*.

**A fact** is one non-infrastructure vertex, or one edge whose endpoints are both
non-infrastructure vertices.

**Verification.** EF and citation correctness are adjudicated by gpt-4o, which never
sees the condition. Human EF is UNMEASURED; a blinded, condition-stratified sample of
119 rows is prepared for labelling.

## 5. Results

Table 1: Staged ablation; only the gate varies across A1–A5. UF/turn = facts both
schema-conforming and judge-confirmed, per eligible interview turn. Exact counts and
Wilson 95% intervals in `results/metrics.json`.

| Cond. | UF/turn ↑ | UF-rate ↑ | EF ↑ | OC ↑ | Prov. ↑ | Edge Prov. ↑ | Cite ↑ | Edge Cite ↑ | Yield |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A0 ungated | 0.00 | 0.0% | 92.3% | 0.0% | 0% | — | — | — | 100.0% |
| A1 constrained | 1.28 | 82.0% | 82.0% | 90.0% | 0% | — | — | — | 100.0% |
| A2 +schema | 1.28 | 82.0% | 91.1% | 100.0% | 0% | — | — | — | 90.0% |
| A3 +retry | 1.75 | 83.6% | 86.2% | 100.0% | 0% | — | — | — | 97.0% |
| A4 +provenance | 1.53 | 76.6% | 83.1% | 100.0% | 83.7% | 68.8% | 63.9% | 54.5% | 92.2% |
| A4-strict | 1.41 | 68.2% | 84.9% | 100.0% | 100.0% | 100.0% | 67.5% | 46.2% | 80.3% |
| A5 full gate | 1.69 | 81.8% | 81.8% | 100.0% | 84.8% | 65.0% | 69.2% | 46.2% | 100.0% |

**The denominator is the experiment's quiet decision.** Retry inflates proposals, so
per-proposal rates penalize the mechanism that recovers knowledge; the denominator
constant across conditions is the interview itself. Per eligible turn, usable
grounded knowledge goes 1.28 (A1) → 1.69 (A5): 41 → 54 facts, **+32%**, at 100%
conformance and 100% yield (66/66). Ungated extraction converts nothing this run —
0 of 52 proposals are both typed and confirmed (OC 0.0%) — a baseline we report as
context, not contribution, since free-form output is scored against a schema it was
never given.

**Provenance by construction, now on relationships too.** Vertex coverage is
83.7–100% where required and 0% elsewhere; when evidence was a free-standing vertex
the extractor had to remember, the archived measurement was 2.2–5.4%. Edge
citations — new in this iteration — reach 65.0–100% coverage. The instrumentation
lesson repeated itself: the first sub-run measured 0/N edge coverage across every
condition, which was a harness bug (the normalizer silently stripped edge
evidence), not a model failure.

**Property padding: a hallucination channel citation audits expose.** Mid-iteration,
vertex citation correctness fell to 56–67% and the refusals showed why: 34 of 41
grounded A5 facts carried optional properties filled with the model's own
elaboration — a persona cited by "our primary demographic consists of corporate
travelers" carrying `description: "…seeking efficiency and reliability"`, unstated
by the expert, riding inside an admitted "grounded" fact. Per-fact EF under-detects
this (the core claim *is* supported). Forbidding padded properties moved EF up
7.7–9.1 points across governed conditions (A4 75.4→83.1, A4-strict 77.4→84.9,
A5 72.7→81.8) and vertex citations to 69.2%.

**What retry and the gate each buy.** Retry alone (A3) matches the full gate's
volume (1.75 vs 1.69 UF/turn) with none of its governance: no provenance, no
deterministic identity, no supersession. The gate's value over retry is not volume
— it is that the same volume arrives *audited*: quoted, typed, deduplicated
(0/54), supersession-tracked (2 corrections kept, not overwritten). Enforcing the
provenance rule hard (A4-strict) remains a coverage purchase: 100% on both vertex
and edge coverage, at −0.28 UF/turn against A5 and EF unchanged within intervals.

**Nothing is significant on 32 turns — and we say so.** Every paired contrast in
this run is not statistically significant: A0 vs A5 p = 0.125, A1 vs A5 p = 1,
A2 vs A3 p = 0.625 (exact McNemar, contamination outcome).
Iteration 04's significant retry contamination (p = 0.0156) did not recur after the
anti-invention rule; with n = 32 we do not attribute the disappearance. Across
three controlled runs on this corpus, per-fact EF contrasts between conditions have
been prompt-sensitive in both directions; the per-turn composite ordering
(gated ≫ ungated; A5 > A1) held in every run.

**Citation quality is the frontier.** An independent judge confirms 69.2% of vertex
citations and 46.2% of edge citations. Coverage can be guaranteed by construction;
*support* cannot — it is where this pipeline's measurable error now concentrates.

## 6. Lessons, Limitations, and Outlook

**(1) Make provenance structural, and extend it to every claim surface.** An
evidence field the extractor cannot omit beats an evidence node it must remember to
link, by ~90 points of coverage — and the same move applies to relationships, which
were an ungrounded claim surface until edges carried their own citations. The
residual surface is properties, where padding was caught by audit rather than by
construction; property-level grounding is the next constraint class.

**(2) Audit the citations, not just the coverage.** Coverage is purchasable by
construction; support is not. The citation audit is what exposed property padding —
a hallucination channel that per-fact faithfulness under-detects because the core
claim is genuinely supported while elaboration rides along.

**(3) Choose the denominator before reading the table.** Per proposal, the gate
looks like a regression next to plain constrained decoding; per interview turn it is
+32%. Both are true; only one answers the question a deployer asks. Retry inflates
proposals, so any per-proposal rate silently penalizes recovery.

**(4) Generate the contract; read severities from the spec; run the deployed gate
in the harness.** Every drift bug this project had came from a hand-written copy of
something already derivable — including the evaluation harness that once enforced
soft rules as hard and reported the resulting zero-yield as a finding about
provenance, and the normalizer that silently zeroed edge coverage. Zeros are
instrumentation until proven otherwise.

**(5) Re-run before you believe.** Three controlled runs on one corpus disagreed
about per-fact EF contrasts in both directions; the per-turn composite ordering held
in all three. Single-run ablations at n = 32 over-claim by construction, which is
why every significance statement in this paper is computed from the paired tests of
the run it describes, and why the iteration record (`results/iterations/`) preserves
every run, including the unflattering ones.

**Limitations.** One session, one domain, one expert, 32 eligible turns; **no paired
contrast in the current run reaches significance**, and intervals are wide. EF and
citation correctness are model-adjudicated (judge and extractor share a model
family); human labels remain UNMEASURED with a blinded 119-row sample prepared. A0's
facts have no ontology and are not the same objects as typed facts; its baseline is
context, not contribution. Edge-citation counts are small (n = 11–13). The corpus is
ASR output. Downstream question-answering utility is out of scope.

**Outlook.** Two constraint surfaces are specified but unevaluated: *property-level
grounding* (the padding rule is currently prompt-enforced; the gate could check it)
and *time* — bi-temporal validity extending supersession to knowledge evolution.
The same machinery extends to *consent*: permitted-use enforcement and revocation
propagation. Symbolic gating as knowledge governance.

## Reproducibility

```bash
npm run ablation        # runs A0-A5 against the deployed gate; API calls are cached
npm run results:build   # regenerates metrics.json, table1.md, results.md, audit sample
npm test                # gate conformance + results-package integrity
```

Raw per-turn rows and the audit sample quote the expert verbatim and are generated
locally rather than committed. The superseded 2026-07-16 package and its harness are
retained under `results/legacy-2026-07-16/` and `scripts/nesy_results/legacy/`.

## References

- S. Ahmetaj, R. David, M. Ortiz, A. Polleres, B. Shehu, and M. Šimkus. Reasoning about explanations for non-validation in SHACL. In _Proc. KR_, 2021.
- Amazon Web Services. Automated reasoning checks (Amazon Bedrock Guardrails). AWS documentation and technical report, 2025.
- J. Bai, W. Fan, Q. Hu, Q. Zong, C. Li, H.T. Tsang, H. Luo, et al. AutoSchemaKG: Autonomous knowledge graph construction through dynamic schema induction from web-scale corpora. _arXiv:2505.23628_, 2025.
- Y. Bang, Z. Ji, A. Schelten, A. Hartshorn, T. Fowler, C. Zhang, et al. HalluLens: LLM hallucination benchmark. _arXiv:2504.17550_, 2025.
- F.S. Bao, M. Li, R. Qu, G. Luo, E. Wanchoo, K. Tu, Z. Xu, C. Xu, et al. FaithBench: A diverse hallucination benchmark for summarization by modern LLMs. In _Proc. NAACL_, 2025.
- H. Bian. LLM-empowered knowledge graph construction: A survey. _arXiv:2510.20345_, 2025.
- O. Brown, N. Power, and J. Gore. Cognitive task analysis: Eliciting expert cognition in context. _Applied Ergonomics_, 2025.
- Y. Dong et al. XGrammar: Flexible and efficient structured generation engine for large language models. _arXiv:2411.15100_, 2024.
- D. Edge, H. Trinh, N. Cheng, J. Bradley, A. Chao, A. Mody, S. Truitt, et al. From local to global: A graph RAG approach to query-focused summarization. _arXiv:2404.16130_, 2024.
- R. Friel and A. Sanyal. ChainPoll: A high efficacy method for LLM hallucination detection. _arXiv:2310.18344_, 2023.
- B. Galitsky and A. Rybalov. Neuro-symbolic verification for preventing LLM hallucinations in process control. _Processes_, 14(2):322, 2026.
- S. Geng et al. JSONSchemaBench: A rigorous benchmark of structured outputs for language models. _arXiv:2501.10868_, 2025.
- X. Guan, Y. Liu, H. Lin, Y. Lu, B. He, X. Han, and L. Sun. Mitigating large language model hallucinations via autonomous knowledge graph-based retrofitting. In _Proc. AAAI_, 2024.
- R. Haskins and B. Adams. KEA Explain: Explanations of hallucinations using graph kernel analysis. In _Proc. NeSy_, PMLR vol. 284, pp. 1-18, 2025.
- H. Knublauch and D. Kontokostas. Shapes constraint language (SHACL). W3C Recommendation, 2017.
- J. Li, X. Cheng, W.X. Zhao, J.-Y. Nie, and J.-R. Wen. HaluEval: A large-scale hallucination evaluation benchmark for large language models. In _Proc. EMNLP_, 2023.
- A.S. Lippolis, M.J. Saeedizade, R. Keskisärkkä, S. Zuppiroli, et al. Ontology generation using large language models. In _Proc. ESWC_, 2025.
- Y. Lu and H. Wang. KARMA: Leveraging multi-agent LLMs for automated knowledge graph enrichment. _arXiv:2502.06472_, 2025.
- N. Mihindukulasooriya, S. Tiwari, C.F. Enguix, and K. Lata. Text2KGBench: A benchmark for ontology-driven knowledge graph generation from text. In _Proc. ISWC_, 2023.
- P. Rasmussen, P. Paliychuk, T. Beauvais, J. Ryan, and D. Chalef. Zep: A temporal knowledge graph architecture for agent memory. _arXiv:2501.13956_, 2025.
- T. Rebedea, R. Dinu, M. Sreedhar, C. Parisien, and J. Cohen. NeMo Guardrails: A toolkit for controllable and safe LLM applications with programmable rails. In _Proc. EMNLP System Demonstrations_, 2023.
- H. Sansford, N. Richardson, H. Petric Maretic, and J. Nait Saada. GraphEval: A knowledge-graph based LLM hallucination evaluation framework. _arXiv:2407.10793_, 2024.
- Z.R. Tam, C.-K. Wu, Y.-L. Tsai, C.-Y. Lin, H.-Y. Lee, and Y.-N. Chen. Let me speak freely? A study on the impact of format restrictions on performance of large language models. In _Proc. EMNLP Industry Track_, 2024.
- M.S. Tamber, F.S. Bao, C. Xu, G. Luo, S. Kazi, M. Bae, M. Li, et al. Benchmarking LLM faithfulness in RAG with evolving leaderboards. _arXiv:2505.04847_, 2025.
- B.T. Willard and R. Louf. Efficient guided generation for large language models. _arXiv:2307.09702_, 2023.
- B. Zhang and H. Soh. Extract, define, canonicalize: An LLM-based framework for knowledge graph construction. In _Proc. EMNLP_, 2024.
