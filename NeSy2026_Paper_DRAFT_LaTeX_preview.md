Proceedings of Machine Learning Research -:1-6, 2026 NeSy 2026 Industry Track

# Structure Is Not Grounding: A Symbolic Admission Gate for Expert-Elicited Knowledge Graphs

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
the result against. Constrained decoding already guarantees structural validity, and
that is widely treated as sufficient. It is not — but the failure is subtler than a
faithfulness drop. Ungated free-form extraction scores well on per-fact evidential
faithfulness (87.5% here) while converting only **4.2%** of its proposals into
knowledge that is both schema-conforming and judge-confirmed, because it invents its
own vocabulary turn by turn; every gated configuration converts **60–84%**. We
therefore argue for a composite metric — usable *and* faithful — and show that the
per-fact faithfulness comparison between ungated and constrained extraction is
prompt-sensitive: a significant drop in one run of our harness vanished (exact
p = 1) under a revised extractor prompt, while the composite gap was stable across
both. We describe a deterministic symbolic gate — typed schema, structural
provenance with a span rule, calibrated confidence, entity resolution,
content-derived identity, invalidate-not-delete corrections — deployed in a live
elicitation product, and a staged ablation whose harness executes the deployed gate
itself. Making provenance *structural* rather than remembered raises evidence
coverage from 0% to 84.5–100%; escalating the provenance rule from soft to hard buys
full coverage but no measurable faithfulness (p = 1) at a 12-point cost in usable
yield; typed-error retry nearly doubles admitted volume but, in this run, the
recovered facts are measurably less grounded (exact p = 0.0156). An independent
judge still rejects roughly one admitted citation in five, so provenance coverage
alone overstates grounding.

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
2. **structural provenance** — evidence carried inline on each proposed fact, with the
   gate materializing the evidence node and selecting the correctly-typed edge — which
   makes the orphan-evidence failure mode unrepresentable rather than merely detected;
3. a staged ablation in which the evaluation harness *imports the deployed gate*, so a
   measured result is a claim about the shipped system;
4. a composite metric (schema-conforming **and** judge-confirmed, over proposals) under
   which the value of gating is stable across runs, together with the measurement that
   the per-fact faithfulness contrast between ungated and constrained extraction is
   prompt-sensitive — significant in one run of the same harness, absent in the next;
5. an honest accounting of which constraints bought nothing on our corpus, including a
   non-replication of our own earlier headline.

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
- **(ii) Provenance with a specificity rule.** Every knowledge vertex must carry
  traceable evidence. Crucially, the extractor does not *build* provenance: it attaches
  an `evidence` object to the fact, and the gate materializes the evidence vertex,
  supplies episode and speaker from the turn, and selects the provenance edge from the
  contract. The specificity rule requires the trace to be a **span of the utterance**
  and to not restate the whole turn.
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

Table 1: Staged ablation; only the gate varies across A1–A5. Exact counts and Wilson
95% intervals in `results/metrics.json`.

| Cond. | OC ↑ | Prov. Cov. ↑ | Cite ↑ | EF ↑ | Usable+faithful ↑ | Yield | tok/fact |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A0 ungated | 4.2% | 0.0% | — | 87.5% | 4.2% | 100.0% | 519 |
| A1 constrained | 91.1% | 0.0% | — | 93.3% | 84.4% | 100.0% | 1550 |
| A2 +schema | 100.0% | 0.0% | — | 92.7% | 84.4% | 91.1% | 1701 |
| A3 +retry | 100.0% | 0.0% | — | 74.3% | 70.5% | 94.9% | 2054 |
| A4 +provenance | 100.0% | 87.5% | 79.6% | 76.1% | 72.0% | 94.7% | 2285 |
| A4-strict | 100.0% | 100.0% | 79.6% | 75.4% | 59.7% | 79.2% | 2774 |
| A5 full gate | 100.0% | 84.5% | 81.6% | 76.0% | 76.0% | 100.0% | 2230 |

**Ungated extraction produces almost no usable typed knowledge.** A0 converts 4.2%
(2/48; CI 1.2–14) of its proposals into facts that are both schema-conforming and
judge-confirmed; A1–A5 convert 59.7–84.4%. A0's per-fact EF of 87.5% (42/48) is the
precision of vagueness: labels such as "eye twitch signal" and relations such as
"appreciates" restate the transcript in an ad-hoc vocabulary no query or governance
rule can reach. The composite, not the EF column, is the comparison that matters —
and it is the comparison that is stable. Whether constrained decoding also *costs*
per-fact faithfulness is prompt-sensitive: an earlier run of this same harness
measured a significant A0→A1 EF drop (95.8%→82.2%, exact p = 0.031); under the
current revised prompt the contrast is discordant on 3 utterances, exact p = 1, with
EF *higher* under constraint. We report the non-replication rather than choosing the
run that flatters the thesis.

**Structural provenance: coverage is architectural.** Coverage is 84.5–100% where
evidence is required and 0% elsewhere. The archived 2026-07-16 package measured
2.2–5.4% under identical intent, when evidence was a free-standing vertex plus an
edge the extractor had to remember: it emitted 41 evidence nodes and only 7
provenance edges. Inline evidence materialized by the gate moved coverage ~90 points
by changing the representation, not the model.

**Escalating provenance to hard buys coverage, and only coverage.** A4 vs A4-strict
differ in one bit. Coverage rises 87.5% → 100%; yield falls 94.7% → 79.2%;
usable+faithful falls 72.0% → 59.7%; per-fact EF is unchanged within its interval
(76.1% → 75.4%, discordant 1, exact p = 1). Severity escalation purchases a
reporting metric at the price of knowledge kept. The specification's soft severity
is the right live default.

**Typed-error retry buys volume at a measurable grounding cost — in this run.**
Retry lifts admitted facts 41 → 74 at 1701 → 2054 tokens per fact, and the recovered
volume is less grounded: EF 92.7% → 74.3%, and per utterance the contamination
increase is significant (discordant 7, exact p = 0.0156). The previous run measured
no such cost. Two runs, two directions: the volume gain is robust, the faithfulness
effect is not, and a deployment enabling retry should monitor EF rather than assume
recovery is free.

**The full deployed gate.** A5 admits 100% (75/75) of proposals with OC 100%,
duplicate rate 0% (0/57), the highest usable+faithful among retry-bearing conditions
(76.0%, CI 65.2–84.2), citation correctness 81.6%, and 2 temporal supersessions the
other conditions would have overwritten silently. Against ungated extraction the
per-utterance contamination test is discordant 5, exact p = 0.0625 — suggestive, not
significant, on 32 turns.

**Coverage is not quality.** The judge rejects 20.4% of A4/A4-strict citations and
18.4% of A5 citations as not licensing the fact that cites them, even after the
span-based specificity rule. Provenance coverage alone overstates grounding; both
numbers must be reported.

## 6. Lessons, Limitations, and Outlook

**(1) Generate the contract; do not restate it.** Schema drift was our dominant failure
mode, and it was self-inflicted three times over: the committed schema forbade the very
provenance edges the specification required; a rule targeted a property the schema did
not declare; and a hand-written prompt instructed the extractor to author evidence the
gate would then discard. Removing that last contradiction alone moved live provenance
coverage from 60% to 100%. The contract is now generated, and both the harness and the
test suite refuse to run while drift is non-zero.

**(2) Make constraints structural, not remembered.** The strongest engineering result
here is a representation, not a rule: an evidence field the extractor cannot omit beats
an evidence node it must remember to link, by ~90 points of coverage.

**(3) Identity needs resolution before hashing.** Content-derived ids only merge exact
restatements. Live sessions produce paraphrase families ("guest-centered service",
"guest-centred experience"), and without deterministic resolution the pilot graph held
22 near-duplicate principle vertices; with it, 5. Duplicate rate under the full gate is
0% (0/57).

**(4) Read severity from the specification — and expect severity to buy less than it
promises.** Our earlier harness enforced as *hard* two rules the specification declares
*soft* and reported the resulting 0/59 admission as a finding about provenance. With
severities read from the specification, escalating the evidence rule to hard buys
coverage (100%) and nothing else we can measure, at a 12-point cost in usable yield.

**(5) Re-run before you believe.** Two runs of the same controlled harness on the same
corpus, differing only in extractor prompt, disagreed about whether constrained decoding
costs per-fact faithfulness and about whether retry is free. The composite metric and
the structural-provenance result survived both runs; the per-fact EF contrasts did not.
Single-run ablations at this scale over-claim by construction — which is why every
significance statement in this paper is computed from the paired tests of the run it
describes.

**Limitations.** One session, one domain, one expert, 32 eligible turns: intervals are
wide, and A2-vs-A3 is the only significant cross-condition contrast in the current run.
EF and citation correctness are model-adjudicated, and judge and extractor share a model
family, so shared blind spots are plausible; human labels remain UNMEASURED with a
blinded 119-row sample prepared. A0's facts have no ontology and are not the same
objects as typed facts; the composite metric exists for exactly that reason. The corpus
is ASR output. Downstream question-answering utility is out of scope.

**Outlook.** The gate generalises along two unevaluated axes: *time* — bi-temporal
validity extending admission to knowledge evolution — and *consent* — the same machinery
enforcing permitted use and propagating revocation. Symbolic gating as knowledge
governance.

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
