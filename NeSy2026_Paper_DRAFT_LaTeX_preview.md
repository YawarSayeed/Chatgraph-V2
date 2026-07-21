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
that is widely treated as sufficient. It is not: we measure a **fall** in evidential
faithfulness when constrained decoding is introduced (95.8% → 82.2%, exact McNemar
p = 0.031 over 32 paired utterances), because typing pressures the extractor to commit
to specific claims while ungated extraction paraphrases safely into an ad-hoc
vocabulary. Neither metric alone captures the goal, so we report facts that are both
schema-conforming and judge-confirmed: ungated extraction converts **2.1%** of its
proposals into usable grounded knowledge, every gated configuration converts
**73–80%**. We describe a deterministic symbolic gate — typed schema, provenance with a
specificity rule, calibrated confidence, content-derived identity, invalidate-not-delete
corrections — that admits, rejects, or repairs every proposed fact at ingestion, and
report a staged ablation in which the harness executes the deployed gate itself. We
find that making provenance *structural* rather than something the extractor must
remember raises coverage from 0% to 92.7–98.1%; that enforcing evidence as an admission
criterion raises faithfulness by 5.3 points at an 6.8-point yield cost, an effect our
sample cannot establish as significant; and that provenance coverage overstates
grounding, since an independent judge rejects roughly one admitted citation in four.

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
4. the measurement that constrained decoding **reduces** evidential faithfulness, and a
   composite metric that shows why it is nonetheless the single largest improvement;
5. an honest accounting of which constraints bought nothing on our corpus.

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
- **(iv) Content-derived identity.** Ids are a hash of label and normalised properties,
  so restating a fact merges rather than duplicates.
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
| A0 ungated | 2.1% | 0.0% | — | 95.8% | 2.1% | 100.0% | 476 |
| A1 constrained | 95.6% | 0.0% | — | 82.2% | 80.0% | 100.0% | 1510 |
| A2 +schema | 100.0% | 0.0% | — | 83.3% | 77.8% | 93.3% | 1618 |
| A3 +retry | 100.0% | 0.0% | — | 85.5% | 78.7% | 92.0% | 2300 |
| A4 +provenance | 100.0% | 92.7% | 70.6% | 81.1% | 74.1% | 91.4% | 2244 |
| A4-strict | 100.0% | 98.1% | 78.4% | 86.4% | 73.1% | 84.6% | 2597 |
| A5 full gate | 100.0% | 92.7% | 76.5% | 80.0% | 75.0% | 93.8% | 2212 |

**Structure is not grounding — and it costs grounding.** A0→A1 lifts ontology
conformance from 2.1% (1/48) to 95.6% (43/45) and moves evidential faithfulness the
*other* way, 95.8% (46/48) → 82.2% (37/45). Over the 32 paired utterances the increase
in utterances yielding an unsupported fact is significant (discordant 6, exact
p = 0.031). The mechanism is visible in the raw output: ungated extraction invents its
own vocabulary — labels such as "Service Standardization" and "eye twitch signal",
relations such as "appreciates" and "enhances" — and stays close to the wording of the
turn. Such statements are easy to confirm and impossible to query, merge, or govern.
**Free-form faithfulness is the precision of vagueness.**

**What the gate is actually worth.** Counting facts that are both conforming and
judge-confirmed: A0 converts 2.1% (1/48; CI 0.4–10.9) of proposals into usable grounded
knowledge; A1–A5 convert 73.1–80.0%. That gap, not the EF column, is the gate's value.

**Structural provenance.** Coverage is 92.7–98.1% where required and 0% elsewhere. Our
archived earlier run measured 2.2–5.4% under identical *intent*, because evidence was a
separate vertex plus an edge the extractor had to remember: it emitted 41 evidence nodes
and only 7 provenance edges. Carrying evidence inline and materializing it in the gate
removes the failure mode rather than detecting it.

**Provenance as an admission criterion.** A4 and A4-strict differ in one bit. Enforcing
evidence raises EF 81.1% → 86.4% (+5.3), citation correctness 70.6% → 78.4% (+7.8), and
coverage 92.7% → 98.1%, at a yield cost 91.4% → 84.6% and +353 tokens per admitted fact.
The direction matches the design. **The effect is not statistically significant on this
corpus**: only 2 utterances are discordant, exact p = 0.5. We report the point estimate
and decline the claim.

**Coverage is not quality.** Even after the specificity rule, an independent judge
rejects 29.4% of A4 citations and 21.6% of A4-strict citations as not licensing the fact
that cites them. A deployment reporting coverage alone reports the wrong number.

**Constraints that bought nothing measurable here.** Duplicate rate is 0.0% both with
content-derived identity (0/55) and without (0/52): on this corpus the extractor rarely
restates a fact identically, so there was nothing to collapse. Temporal supersession
fired twice under A5 and never elsewhere. Typed-error retry raised admitted facts from
42 to 69 at 1618 → 2300 tokens per fact with EF unchanged within its interval — retry
buys volume, and, contrary to our expectation, does not cost faithfulness.

## 6. Lessons, Limitations, and Outlook

**(1) Generate the contract; do not restate it.** Schema drift was our dominant failure
mode, and it was self-inflicted three times over: the committed schema forbade the very
provenance edges the specification required; a rule targeted a property the schema did
not declare; and the hand-written prompt instructed the extractor to author evidence
that the gate would then discard. Removing that last contradiction alone moved
provenance coverage from 60% to 100% in live testing. The contract is now generated, and
the harness refuses to run while drift is non-zero.

**(2) Make constraints structural, not remembered.** The strongest engineering result
here is not a rule but a representation: an evidence field the extractor cannot omit
beats an evidence *node* it must remember to link, by 90 points of coverage.

**(3) Admit per fact, not per delta.** A dropped fact is knowledge lost; one bad edge
should cost one edge.

**(4) Read severity from the specification.** Our earlier harness enforced as *hard* two
rules the authored specification declares *soft*, and reported that the provenance gate
admitted 0 of 59 facts. That was a bug presented as a finding. Severities are now read
from the specification the auditors wrote.

**(5) Report the composite.** Conformance and faithfulness move in opposite directions
under exactly the intervention the field treats as settled. Either metric alone would
have told us something false.

**Limitations.** One session, one domain, one expert, 32 eligible turns: intervals are
wide and every cross-condition difference except A0-vs-A1 and A0-vs-A5 is compatible
with noise. EF and citation correctness are model-adjudicated, and judge and extractor
share a model family, so shared blind spots are plausible; human labels remain
UNMEASURED. A0's facts have no ontology and are therefore not the same objects as typed
facts — its EF column must not be read as "ungated extraction is more faithful", which
is precisely why we report the composite. The corpus is ASR output. Downstream
question-answering utility is out of scope.

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
