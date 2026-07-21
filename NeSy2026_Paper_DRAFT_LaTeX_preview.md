Proceedings of Machine Learning Research -:[1](#_bookmark0)-[6](#_bookmark34), 2026 NeSy 2026 Industry Track

# Block, Don't Repair: A Symbolic Validation Gate for Faithful Knowledge-Graph Construction from Live Expert Elicitation

**Anonymous Author(s)** [anonymous@example.com](mailto:anonymous@example.com)

_Affiliation withheld for double-blind review_

**DRAFT - NOT FOR SUBMISSION.** Every value in red brackets is an unmeasured placeholder awaiting the A0-A5 ablation runs. Fill all placeholders, set \\PHfinaltrue, and delete this box before building the submission PDF. See the companion Submission Run Sheet.

## Abstract

Institutions increasingly use large language models (LLMs) to convert expert interviews into typed knowledge graphs, but LLM extraction hallucinates - and for tacit expert knowledge there is no reference knowledge graph to check against afterwards. Constrained decoding already guarantees structural validity, yet a schema-perfect triple can be entirely fabricated: the binding constraint is evidential grounding. We report on a deployed elic-itation pipeline in which an independent, deterministic symbolic gate - typed schema, provenance with a quality rule, calibrated confidence, deterministic identity, temporal con-tradiction handling - admits, rejects, or retries every LLM-proposed fact at the ingestion boundary, before persistence. A staged ablation (A0-A5) on private hospitality-domain transcripts isolates each constraint's marginal contribution: structural validity alone leaves

evidential faithfulness essentially unchanged (\[XX\]%→\[XX\]%); the provenance requirement accounts for the largest single gain (+\[XX\] points), at a measured yield and latency cost.

We distill five lessons for practitioners building governed knowledge bases from expert elicitation.

**Keywords:** neurosymbolic validation, knowledge graphs, hallucination, provenance, ex-pert elicitation

## Introduction

Organisations lose operating knowledge whenever experts leave, and converting it into machine-usable form is now an LLM task: structured elicitation surfaces 40-70% of task-critical steps experts omit from informal instruction \[[18](#_bookmark18), [7](#_bookmark8)\], and the artifact of choice is a typed knowledge graph built by LLM extraction from the transcripts \[[6](#_bookmark7)\].

But LLM extraction hallucinates, and scale is not the cure: on a continuously refreshed grounded-summarisation leaderboard, frontier reasoning models still exceed 10% halluci-nation, some variants above 20% \[[30](#_bookmark31)\]. A hallucinated fact that _persists_ is worse than a hallucinated sentence: it is retrieved, cited, and compounded downstream.

Two observations pivot this paper. First, _structure is solved_ : constrained decoding guar-antees schema-compliant output at scale \[[13](#_bookmark14), [31](#_bookmark32), [9](#_bookmark10)\] - but a JSON object can be perfectly schema-compliant and entirely fabricated; no grammar can express "this triple must be

 2026 A. Author(s).

supported by something the expert said." Second, the standard fallback - verifying candi-dates against a reference knowledge graph \[[26](#_bookmark27), [15](#_bookmark16), [17](#_bookmark19)\] - is unavailable _by construction_ for tacit expertise: there is no Wikidata for how a senior practitioner decides. Ground truth must be _manufactured at capture time_, by binding every admitted fact to the utterance that licensed it.

We contribute: **(1)** an independent, deterministic symbolic gate that admits, rejects, or retries LLM-proposed knowledge at ingestion; **(2)** provenance as an _admission criterion_, with a quality rule rejecting vacuous evidence; **(3)** the first staged ablation quantifying what each constraint is worth; **(4)** a calibrated confidence vocabulary with an inferred tier for cross-utterance synthesis; **(5)** deployment evidence and lessons from a live system.

## Related Work

**Structured generation is solved - grounding is not.** Grammar-constrained decoding is commoditised: JSONSchemaBench evaluates six production frameworks over 10,000 real-world schemas \[[13](#_bookmark14)\], with Outlines \[[31](#_bookmark32)\] and XGrammar \[[9](#_bookmark10)\] now default serving infrastructure. These guarantee the _form_ of output, never its relation to a source; format restriction can even degrade reasoning \[[28](#_bookmark29)\], motivating our post-generation gate over decode-time masking.

**LLM**→**KG construction measures hallucination; it does not prevent it.** Text2KGBench defines the canonical metrics - ontology conformance and subject/relation/object hallu-cination - but scores pipelines post hoc \[[23](#_bookmark24)\]; GraphEval and KEA Explain likewise use

graphs as disposable measuring instruments, not governed assets \[[27](#_bookmark28), [17](#_bookmark19)\]. EDC canoni-calises _after_ extraction \[[32](#_bookmark33)\]; AutoSchemaKG lets the extractor induce its own schema, so a hallucinated type creates a slot rather than hitting one \[[3](#_bookmark4)\]; GraphRAG ships ungated extraction, evaluated on comprehensiveness, not faithfulness \[[10](#_bookmark11)\]. A survey confirms hybrid "LLM proposes, validation disposes" is now the dominant paradigm \[[6](#_bookmark7)\] - with no evidence of what each stage is worth.

**KG-grounded factuality assumes a public KG; symbolic gating of neural out-put is industrially proven - but not at this boundary.** KGHaluBench probes 25 LLMs against Wikidata \[[26](#_bookmark27)\] and KGR retrofits output against public KGs \[[15](#_bookmark16)\]; both pre-suppose consensus reference knowledge that tacit expertise lacks. Zep/Graphiti governs _time_ with a production bi-temporal model, but its extraction is LLM-driven with no inde-pendent schema gate and is evaluated on retrieval, never extraction faithfulness \[[24](#_bookmark25)\] - we adopt this substrate class and contribute the gate it lacks. SHACL is the right symbolic ancestor \[[19](#_bookmark20)\] but cannot express evidential support, calibrated confidence, or temporal va-lidity, and has no retry loop to a generative producer \[[14](#_bookmark15)\]. LLM-as-judge verification is neural checking neural, not deterministically reproducible \[[22](#_bookmark23), [11](#_bookmark12)\]; production guardrails \[[25](#_bookmark26), [2](#_bookmark2)\] and neuro-symbolic process control \[[12](#_bookmark13)\] prove symbolic gating of neural output - just never at the knowledge-ingestion boundary.

## A Gated Elicitation Pipeline

**Deployment context.** The system is a commercial knowledge-elicitation platform live in the hospitality vertical. A seven-section structured interview elicits an expert's operating knowledge; each session yields a transcript segmented into typed episodes, from which an

**SYMBOLIC GATE** admitGoverned schema*·\_prov*·_conf_·_ID_·\_temporal graph

Expert transcript

LLM typed extraction

Episodic segmentation

**reject** _→_ **typed error** _→_ **bounded retry**

Figure 1: Neural stages (blue) propose; the symbolic gate (orange) disposes at ingestion.

Rejection echoes a typed error for bounded retry.

LLM extractor proposes deltas - entities, relations, evidence, confidence - against a typed graph schema with \[14\] vertex classes.

**Pipeline.** Elicitation → episodic segmentation → typed extraction → embedding → resolution/deduplication → contradiction detection → _gated persistence_ (Figure [1](#_bookmark1)): nothing persists without passing the gate.

**The gate.** A deterministic function evaluates every proposed delta against five con-straint classes: **(i)** _typed-schema conformance_ - allowed labels, edge endpoint types, re-quired properties, per a human-authored, version-controlled schema; **(ii)** _provenance re-quirement with a quality rule_ - every knowledge node must carry a traceable source utter-ance (trace text, episode, speaker), and an anti-generic rule rejects vacuous evidence such as "the expert described their approach"; **(iii)** _confidence tier_ from a closed vocabulary

{high, medium, low, inferred}, inferred marking knowledge synthesised across ≥2 episodes that no single quote supports - the shape tacit knowledge takes; **(iv)** _determin-_

_istic identity_ - content-derived IDs make merges idempotent and duplicates structurally impossible; **(v)** _temporal contradiction handling_ - a conflicting fact invalidates its prede-cessor rather than deleting it. The check is stateless, drawing only on the active schema and the record's own metadata - an external auditor can reproduce every admission decision, an auditability LLM-as-judge verification cannot offer \[[11](#_bookmark12), [22](#_bookmark23)\].

**Severity and retry.** Constraints carry graduated severity: _hard_ (reject; typed error echoed to the extractor; bounded retry budget), _soft_ (admit, warn, flag), _advisory_ (session-close report only), checked per-delta and at session close. The schema is authored and versioned independently of the extractor - a gate is only a gate if it is independent \[[3](#_bookmark4), [14](#_bookmark15)\].

## Evaluation Design

**Data.** \[N\] elicitation sessions from the deployed hospitality vault: \[N\] episodes, \[N\] expert utterances, \[N\] proposed candidate facts. Two annotators independently labelled a strati-fied sample of \[N\] utterances with the admissible facts each licenses (Cohen's _κ_ \= \[0.XX\]). The transcripts are private and post-date the extractor's training data, so the evaluation is leakage-free by construction - a guarantee public-KG benchmarks cannot make \[[4](#_bookmark5)\].

**Conditions.** Six configurations of one frozen extractor (model, temperature, seed, prompt fixed): **A0** ungated free-form extraction; **A1** constrained decoding only (the indus-try default); **A2** \+ independent typed-schema gate (reject, no retry); **A3** \+ typed-error bounded retry; **A4** \+ provenance requirement with the anti-generic rule; **A5** \+ confidence tiers, ID deduplication, temporal contradiction handling (the deployed full gate).

Table 1: Staged ablation; only the gate varies. EF = human-verified Evidential Faithful-ness.

| Cond.          | OC*↑*  | SH*↓*  | RH*↓*  | OH*↓*  | Prov. Cov._↑_ | EF*↑*  | Yield  | s/fact  |
| -------------- | ------ | ------ | ------ | ------ | ------------- | ------ | ------ | ------- |
| A0 ungated     | \[XX\] | \[XX\] | \[XX\] | \[XX\] | \[XX\]        | \[XX\] | \[XX\] | \[X.X\] |
| A1 structure   | \[XX\] | \[XX\] | \[XX\] | \[XX\] | \[XX\]        | \[XX\] | \[XX\] | \[X.X\] |
| A2 +schema     | \[XX\] | \[XX\] | \[XX\] | \[XX\] | \[XX\]        | \[XX\] | \[XX\] | \[X.X\] |
| A3 +retry      | \[XX\] | \[XX\] | \[XX\] | \[XX\] | \[XX\]        | \[XX\] | \[XX\] | \[X.X\] |
| A4 +provenance | \[XX\] | \[XX\] | \[XX\] | \[XX\] | \[XX\]        | \[XX\] | \[XX\] | \[X.X\] |
| A5 full gate   | \[XX\] | \[XX\] | \[XX\] | \[XX\] | \[XX\]        | \[XX\] | \[XX\] | \[X.X\] |

**Metrics.** From Text2KGBench \[[23](#_bookmark24)\]: Ontology Conformance (OC), Subject/Relation/Object Hallucination (SH/RH/OH). Ours: _Provenance Coverage_ (% of admitted nodes with a valid,

non-generic evidence link); _Evidential Faithfulness_ (EF, the headline: % of admitted facts a human annotator confirms the cited utterance supports); _Duplicate Rate_; _Yield_ (admit-ted/proposed); _Cost_ (tokens, latency).

**Verification protocol.** Surface-string hallucination metrics over-report - coreference false positives inflated subject hallucination from 1.6% to 65.2% \[[8](#_bookmark9)\] - and detectors average

∼67% balanced accuracy, near chance on hard cases \[[5](#_bookmark6), [29](#_bookmark30)\]. We therefore verify hybrid: string match, then LLM-judge adjudication of the residue, then human audit of a stratified

sample, reporting agreement and the string layer's false-positive rate.

## Results

**Structure is not faithfulness.** Moving from A0 to A1 lifts structural validity to \[∼100\]% while moving evidential faithfulness only \[X\] points (\[XX\]%→\[XX\]%): the industry-default constraint guarantees form, not truth.

**What each constraint buys.** The schema gate (A2) cuts relation hallucination from \[XX\]% to \[XX\]% but costs \[XX\] points of yield; typed-error retry (A3) recovers \[XX\] of those points at +\[XX\]% tokens per admitted fact. The provenance requirement (A4) delivers the largest single faithfulness gain (+\[XX\] EF points), catching ungrounded-but-plausible facts - the semantic illusions similarity-based checks miss \[[20](#_bookmark21)\] - that no other constraint touched; its anti-generic rule alone rejected \[XX\]% of first-pass evidence links as vacuous. The full gate (A5) drives duplicates to \[∼0\]% and surfaces \[N\] temporal contradictions that would otherwise overwrite silently. \[If any constraint bought nothing, state it plainly here.\]

**Costs, honestly.** The full gate admits \[XX\]% of proposed facts (vs. \[XX\]% ungated), at \[X.X\]× tokens and \[X.X\]× latency per admitted fact, consuming \[XX\]% of the retry budget. A \[N\]-question QA probe yields \[XX\]% citation correctness gated versus \[XX\]% ungated.

## Lessons, Limitations, and Outlook

**(1) The extractor and the schema must agree by construction:** schema drift was our dominant failure mode; deriving the extractor's schema reference from the artifact the gate enforces makes drift impossible. **(2) Rejection must be a retry, not a drop:** a dropped fact is knowledge lost forever; a retry usually succeeds. **(3) Provenance quality needs its**

**own rule:** without the anti-generic rule, extractors emit vacuous evidence that passes any existence check. **(4) Graduated severity keeps live sessions alive:** uniform hard en-forcement stalls a real interview, consistent with adaptive neuro-symbolic routing \[[16](#_bookmark17)\]. **(5) Experts state rules through stories** - hence the inferred tier; without it, a pipeline drops tacit knowledge or launders it as quoted fact. _Barrier to adoption:_ with enforcement automated, schema authoring is the bottleneck; LLM-assisted drafting \[[21](#_bookmark22)\] may shift it.

**Limitations and outlook.** This is a deployment report, not a scaling study: one vertical, one vault, \[N\] facts - small N, declared, but internally controlled (only the gate varies), which makes the ablation valid. A wrong schema is a wrong gate. Human audit covers a sample; judge-assisted layers inherit judge error \[[5](#_bookmark6)\] - hence headline numbers are human-verified. We claim no downstream business outcomes. The gate generalises along two unevaluated axes: _time_ - bi-temporal validity and invalidate-not-delete corrections extend admission to knowledge evolution \[[24](#_bookmark25), [1](#_bookmark3)\] - and _consent_ - the same machinery can enforce permitted-use and propagate revocation: symbolic gating as knowledge governance.

## References

- S. Ahmetaj, R. David, M. Ortiz, A. Polleres, B. Shehu, and M. Sˇimkus. Reasoning about explanations for non-validation in SHACL. In _Proc. KR_, 2021.
- Amazon Web Services. Automated reasoning checks (Amazon Bedrock Guardrails). AWS doc-umentation and technical report, 2025.
- J. Bai, W. Fan, Q. Hu, Q. Zong, C. Li, H.T. Tsang, H. Luo, et al. AutoSchemaKG: Au-tonomous knowledge graph construction through dynamic schema induction from web-scale corpora. _arXiv:2505.23628_, 2025.
- Y. Bang, Z. Ji, A. Schelten, A. Hartshorn, T. Fowler, C. Zhang, et al. HalluLens: LLM hallucination benchmark. _arXiv:2504.17550_, 2025.
- F.S. Bao, M. Li, R. Qu, G. Luo, E. Wanchoo, K. Tu, Z. Xu, C. Xu, et al. FaithBench: A diverse hallucination benchmark for summarization by modern LLMs. In _Proc. NAACL_, 2025.
- H. Bian. LLM-empowered knowledge graph construction: A survey. _arXiv:2510.20345_, 2025.
- O. Brown, N. Power, and J. Gore. Cognitive task analysis: Eliciting expert cognition in context.

_Applied Ergonomics_, 2025.

- Anonymous. Ontology-driven triple extraction from corporate financial reports with proxy met-rics. _Preprint_, 2025. \[Verify exact authors/venue before camera-ready.\]
- Y. Dong et al. XGrammar: Flexible and efficient structured generation engine for large language models. _arXiv:2411.15100_, 2024.
- D. Edge, H. Trinh, N. Cheng, J. Bradley, A. Chao, A. Mody, S. Truitt, et al. From local to global: A graph RAG approach to query-focused summarization. _arXiv:2404.16130_, 2024.
- R. Friel and A. Sanyal. ChainPoll: A high efficacy method for LLM hallucination detection.

_arXiv:2310.18344_, 2023.

- B. Galitsky and A. Rybalov. Neuro-symbolic verification for preventing LLM hallucinations in process control. _Processes_, 14(2):322, 2026.
- S. Geng et al. JSONSchemaBench: A rigorous benchmark of structured outputs for language models. _arXiv:2501.10868_, 2025.
- Anonymous. Automated validation of textual constraints against AutomationML via LLMs and SHACL. _arXiv:2506.10678_, 2025. \[Verify exact authors before camera-ready.\]
- X. Guan, Y. Liu, H. Lin, Y. Lu, B. He, X. Han, and L. Sun. Mitigating large language model hallucinations via autonomous knowledge graph-based retrofitting. In _Proc. AAAI_, 2024.
- S. Hakim et al. SymRAG: Adaptive neuro-symbolic retrieval-augmented generation. _arXiv preprint_, 2025. \[Verify arXiv ID before camera-ready.\]
- R. Haskins and B. Adams. KEA Explain: Explanations of hallucinations using graph kernel analysis. In _Proc. NeSy_, PMLR vol. 284, pp. 1-18, 2025.
- J.M. Johnson. Cognitive task analysis and AI-assisted elicitation: A comparative study. 2025.

\[Verify venue before camera-ready.\]

- H. Knublauch and D. Kontokostas. Shapes constraint language (SHACL). W3C Recommenda-tion, 2017.
- J. Li, X. Cheng, W.X. Zhao, J.-Y. Nie, and J.-R. Wen. HaluEval: A large-scale hallucination evaluation benchmark for large language models. In _Proc. EMNLP_, 2023.
- A.S. Lippolis, M.J. Saeedizade, R. Keskis¨arkk¨a, S. Zuppiroli, et al. Ontology generation using large language models. In _Proc. ESWC_, 2025.
- Y. Lu and H. Wang. KARMA: Leveraging multi-agent LLMs for automated knowledge graph enrichment. _arXiv:2502.06472_, 2025.
- N. Mihindukulasooriya, S. Tiwari, C.F. Enguix, and K. Lata. Text2KGBench: A benchmark for ontology-driven knowledge graph generation from text. In _Proc. ISWC_, 2023.
- P. Rasmussen, P. Paliychuk, T. Beauvais, J. Ryan, and D. Chalef. Zep: A temporal knowledge graph architecture for agent memory. _arXiv:2501.13956_, 2025.
- T. Rebedea, R. Dinu, M. Sreedhar, C. Parisien, and J. Cohen. NeMo Guardrails: A toolkit for controllable and safe LLM applications with programmable rails. In _Proc. EMNLP System_ _Demonstrations_, 2023.
- A. Robertson, H. Liang, M. Gani, R. Kumar, and S. Rajamohan. KGHaluBench: A knowledge graph-based hallucination benchmark for evaluating the breadth and depth of LLM knowledge. _arXiv:2602.19643_, 2026.
- H. Sansford, N. Richardson, H. Petric Maretic, and J. Nait Saada. GraphEval: A knowledge-graph based LLM hallucination evaluation framework. _arXiv:2407.10793_, 2024.
- Z.R. Tam, C.-K. Wu, Y.-L. Tsai, C.-Y. Lin, H.-Y. Lee, and Y.-N. Chen. Let me speak freely? A study on the impact of format restrictions on performance of large language models. In _Proc._ _EMNLP Industry Track_, 2024.
- M.S. Tamber, F.S. Bao, C. Xu, G. Luo, S. Kazi, M. Bae, M. Li, et al. Benchmarking LLM faithfulness in RAG with evolving leaderboards. _arXiv:2505.04847_, 2025.
- Vectara. Hallucination leaderboard (HHEM). github.com/vectara/hallucination-leaderboard, accessed 2026. \[Re-verify cited figures against the live leaderboard before camera-ready.\]
- B.T. Willard and R. Louf. Efficient guided generation for large language models.

_arXiv:2307.09702_, 2023.

- B. Zhang and H. Soh. Extract, define, canonicalize: An LLM-based framework for knowledge graph construction. In _Proc. EMNLP_, 2024.