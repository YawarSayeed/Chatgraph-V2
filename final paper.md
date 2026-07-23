# Provenance by Construction: A Symbolic Admission Gate for Live Knowledge-Graph Elicitation from Domain Experts

**Anonymous Author(s)**
_Submitted to KG-NeSy 2026 — 3rd International Workshop on Knowledge Graphs and Neurosymbolic AI, co-located with ISWC 2026, Bari, Italy. CEUR-ART single column, full paper (12–15 pp)._

> **Status of this draft.** All figures marked ⟨·⟩ are placeholders for the
> multi-session corpus run (iteration 08) and will be filled from the frozen
> `results/metrics.json` before submission; every other number in this draft is
> measured, frozen in `results/iterations/`, and regenerable. Evidential
> faithfulness and citation correctness are model-adjudicated, not
> human-verified, and are reported as such throughout. Where an effect is not
> statistically significant, we say so.

## Abstract

Institutions increasingly convert live expert interviews into typed knowledge graphs with large language models, but for tacit expertise there is no reference graph to verify against: no Wikidata records how a senior practitioner decides. Ground truth must therefore be manufactured at capture time, by binding every admitted fact to the utterance that licensed it. We present a deployed neurosymbolic architecture in which a deterministic **symbolic admission gate** governs the write path of a live, incrementally constructed knowledge graph: an LLM conducts the interview, a second LLM proposes typed graph deltas, and the gate — generated from a single human-authored contract independent of both models — decides, fact by fact, what may persist. The gate enforces six constraint classes: typed-schema conformance; **structural provenance** with an anti-vacuity span rule, under which evidence is carried inline on every proposed fact *and relationship* and the gate itself materializes the provenance subgraph, making orphan evidence unrepresentable; a calibrated confidence vocabulary with an explicit tier for cross-episode inference; content-derived identity with **identity-consistency checking**, after a live deployment showed a graph can be 100% span-grounded yet still attach edges to the wrong concept; a **cross-turn edge-witness rule** requiring that a relationship between two already-known entities quote the utterance asserting it; and invalidate-not-delete supersession. A staged ablation whose harness *imports the deployed gate* shows structural provenance moves coverage from the 2–5% measured when evidence was a structure the model had to remember to 85–100%, and per interview turn the full gate yields 1.69 usable grounded facts versus 1.28 for constrained decoding alone (+32%) at 100% ontology conformance. A live deployed-session audit with a cross-family judge held the span rule on 54/54 facts and 30/30 edges while exposing two hallucination channels — property padding and identity mutation — that per-fact faithfulness metrics structurally under-detect; both are now closed by constraint, and a ⟨k⟩-session corpus evaluation quantifies the effect. We contribute the architecture, the constraint taxonomy, the first published ablation decomposing what each admission constraint is worth, and a methodological pipeline in which every paper figure is machine-verified against the measurement record.

**Keywords:** knowledge graphs, neurosymbolic validation, symbolic admission, provenance, hallucination, expert elicitation, temporal knowledge graphs

---

## 1 Introduction

Organisations lose operating knowledge when experts leave. Converting that knowledge into machine-usable form is now an LLM task, and the artifact of choice is a typed knowledge graph built by extraction from interviews or documents [1, 2, 6, 7]. The construction side of this pipeline has advanced rapidly: incremental builders update graphs document by document [2], atomic decomposition stabilises dynamic temporal construction [3], induced schemas scale to billions of edges [4], and ungated LLM extraction is an industrial default [6]. The validation side has not kept pace with a specific and consequential setting: **live elicitation of tacit expertise**, where the graph is written turn by turn during an ongoing conversation and no external resource exists to check it against.

Two observations frame the problem. First, *structural validity is solved and is therefore not the binding constraint*. Grammar-constrained decoding guarantees schema-compliant output at negligible serving cost [11, 12, 13] — but a JSON object can be perfectly schema-valid and entirely fabricated, and no context-free grammar can express "this fact must be supported by something the expert just said" [12]. Second, the standard fallback — verifying candidate facts against a reference knowledge graph [19, 20, 21] — is unavailable *by construction* for tacit expert knowledge. Every KG-grounded verification method presupposes a public reference KG whose coverage gaps become false positives exactly where knowledge is rare and expert-held [20, 21]; and depth-of-knowledge hallucination is scale-resistant — bigger models fix what a model knows *about*, not how deeply it knows it [21]. Waiting for larger models is not a strategy. The binding constraint is **evidential grounding, enforced at the ingestion boundary by a symbolic authority independent of the extractor**.

This paper describes such an authority, deployed in a production elicitation product, and evaluates it with an unusual discipline: the evaluation harness imports the deployed gate — there is no second implementation to drift — and every figure in this paper is machine-checked against the measurement record by the project's own test suite.

Our target setting is a voice-first structured interview in the hospitality vertical (with a second, medical, domain shipped): an LLM interviewer conducts a seven-section session grounded in cognitive-task-analysis practice [38, 39]; a second LLM proposes typed graph deltas per expert turn; and a deterministic gate admits, rejects with a typed error for bounded retry, or repairs each proposed element. Nothing enters the graph without an admission decision.

**Contributions.**

1. **A symbolic admission gate for live LLM-driven KG construction**, generated from a single human-authored contract (schema + governance specification) that also generates the extractor's prompt schema and tool signature, so the generator and its guardrail cannot drift apart — and the guardrail is, by construction, independent of the generator (contrast [4, 23, 24]).
2. **Provenance by construction.** Evidence travels inline on every proposed fact and every proposed relationship; the gate materializes the evidence node, selects the typed provenance edge from the contract, and stamps episode and speaker itself. Orphan or fabricated provenance is unrepresentable rather than merely detectable, and an anti-vacuity span rule makes the *quality* of evidence an admission criterion — a predicate PROV-O can record but cannot enforce [35, 36].
3. **A constraint taxonomy hardened by deployment.** Two constraint classes in the deployed gate exist because live sessions falsified weaker designs: an **identity-consistency rule** (a reused content-hash id whose content names a different concept is de-collided, after a session in which a span-grounded graph mutated "loyalty program" into "theft" and re-attached its edges), and a **cross-turn edge-witness rule** (an edge between two already-known entities must carry its own span-valid evidence, closing a channel through which relationships were minted from graph memory with no utterance asserting them). Both defects were found by audit, converted to constraints, and re-measured — grounding, we show, is not coherence.
4. **The first ablation decomposing an admission gate.** Surveys name hybrid neural–symbolic validation as the dominant emerging paradigm but report no marginal-contribution evidence for any of its stages [7]. Our staged ablation (A0 ungated → A5 full gate, one frozen extractor, stateless requests, per-fact pairing) quantifies what schema typing, typed-error retry, provenance, severity policy, and identity each buy — including the honest negatives: which constraints bought nothing, which effects were prompt-sensitive, and a non-replication of our own earlier headline finding.
5. **A verifiable evaluation methodology.** Frozen per-iteration metric snapshots, a claim-verifier that fails CI when a paper figure diverges from the measurement record, cross-family adjudication (a Claude-family judge over a GPT-family extractor), and a one-click per-session analysis bundle (transcript, per-turn admitted deltas, gate log of every rejection and retry, and derived audit input) that makes each elicitation session self-documenting.

The workshop's second strand — NeSy AI supporting KG engineering through extraction, integration, validation, and continuous evaluation — is this paper's home; we also offer the architecture to the third strand as a reusable design pattern in the boxology sense [31]: *a deterministic symbolic authority gating a neural generator at a persistence boundary*, a region of the pattern catalogue that remains under-populated.

## 2 Related Work

### 2.1 LLM-driven KG construction measures hallucination; it does not prevent it

Text2KGBench [1] established the metric vocabulary — ontology conformance (OC) and subject/relation/object hallucination (SH/RH/OH) — and showed structural conformance and factual faithfulness dissociate; but it measures post hoc, blocking nothing at write time. We adopt its metrics verbatim for comparability and extend them with provenance coverage and evidential faithfulness. iText2KG [2] is the closest prior art on the incremental axis: it grows the graph document by document with embedding-similarity resolution, but admits everything the extractor proposes — incrementality without an admission gate compounds error rather than knowledge. ATOM [3] optimises exhaustiveness and run-to-run stability of dynamic temporal construction, not truth. AutoSchemaKG [4] is the opposite pole to our design: the schema is induced *by* the extractor, so a hallucinated type creates a new slot rather than triggering a violation — the guardrail and the thing being guarded share an origin; its statistical support filtering is meaningless for a single expert's rare, high-value heuristic. EDC [5] canonicalises after extraction — repair, not prevention; nothing is rejected, and a well-formed fabrication passes cleanly. GraphRAG [6] made LLM-built graphs an industrial reality while evaluating comprehensiveness and diversity, never faithfulness; it is the ungated posture our A0 condition approximates. Bian's survey [7] names hybrid neural–symbolic validation as the dominant emerging paradigm and documents that no surveyed work decomposes what each validation stage is worth — the gap our ablation fills. SPIRES [8] shows schema-driven interrogation works, but grounds to public ontologies — the resource tacit knowledge lacks — and *retains* ungrounded strings. PiVe [9] is the closest prior to our typed-error retry loop, with the decisive difference that its verifier is learned, fallible, and non-auditable; ours is a deterministic symbolic checker whose verdicts are reproducible from the schema plus the source record. KB-agnostic entity resolution inside the prompting pipeline was demonstrated early [10] — along with its danger: when the resolver is itself an LLM, resolution errors correlate with extraction errors and cannot be caught, which is why our resolution passes are deterministic.

### 2.2 Structured generation is solved; grounding is not

JSONSchemaBench [11] shows structural conformance is essentially a solved engineering problem across ~10,000 real-world schemas; XGrammar [12] makes grammar-constrained decoding effectively free at serving time; Outlines [13] established the FSM formulation the ecosystem builds on. None of this says anything about content: these engines guarantee form, never the relation of output to a source, and the constraints we need — cross-record, temporal, evidential — are not context-free properties [12]. Moreover, format restriction itself carries a measured reasoning cost [14], which is why our architecture validates *after* generation with a symbolic gate and typed-error retry rather than pushing every constraint into the decoder.

### 2.3 Symbolic validation: the right ancestor, the precise gap

SHACL [15] is our gate's intellectual ancestor: declarative, deterministic, reportable, with graduated severity (Violation/Warning/Info) — and industrially proven. But SHACL validates a graph *state*, not an ingestion *transaction*, and has no vocabulary for the predicates this setting needs: that a fact be supported by a specific source utterance, that the supporting evidence be non-vacuous, that a claim carry a calibrated confidence tier, or that contradicted facts be invalidated rather than deleted. A record citing a generic or empty source validates cleanly. Performance work [16] makes the same constraint class faster, not richer — the answer to "why not just run SHACL?" is expressivity, not speed. Recent work inverts our control flow: LLMs explain SHACL violations [17] or repair invalid graphs [18]; repair is expensive, unreliable, and can silently discard correct information to satisfy a shape [18] — the strongest recent evidence for *block, don't repair*. Shape induction from data [23] promotes systematic errors already in the graph into constraints that then certify them, and LLM-generated ontologies [24, 42] make the guardrail inherit the generator's errors: both reinforce our design principle that the schema must be human-authored, version-controlled, and independent of the generator.

### 2.4 Hallucination detection is post hoc and reference-dependent

GraphEval [19] established triple-level decomposition as the right granularity for localising hallucination — our per-fact admission adopts it, with the difference that their graph is a measurement instrument while ours is the artifact being written. KGR [20] is the canonical verify-against-the-KG method and presupposes exactly the high-coverage public oracle that does not exist for a clinician's or operator's private judgment. KEA Explain [22] — presented at NeSy — documents the failure mode directly: reference-KG coverage gaps for niche entities become false positives. KGHaluBench [21] supplies the single strongest number in our motivation: depth-of-knowledge hallucination barely improves with scale while breadth hallucination falls sharply. Reference-free self-consistency [26] cannot distinguish a well-memorised falsehood from a fact; a binding to a specific expert utterance can. RAGTruth [43] and FaithBench [25] supply our audit template (span-level typed taxonomies, adjudication) and the evidential basis for graduated severity — not all unsupported content is equally harmful, so uniform maximal enforcement is a category error; our A4-strict condition quantifies exactly that.

### 2.5 Live and temporal graphs govern time, not truth

Zep/Graphiti [27] is the most important comparator for a live graph and sits in our conceptual lineage: episodes, bi-temporal edges, invalidate-not-delete. But it governs *when* a fact is true, not *whether* it may be written: every extractor proposal is admitted, there is no evidence-quality requirement, no confidence tier, no typed-error retry, and the graph stores synthesised fact strings rather than licensing source text. Our contribution is orthogonal and composable. Mem0's [28] LLM-decided DELETE is the sharpest illustration of an unguarded write path — a hallucinated fact can erase a correct memory with no symbolic check and no audit trail. AriGraph [29] independently validates the episodic-plus-semantic split our schema uses and documents the resolution-drift failure mode our deterministic identity machinery targets.

### 2.6 Provenance standards record; they cannot enforce

PROV-O [35] standardises recording lineage; nothing in it requires a provenance record to exist *before* an assertion is admitted, and nothing judges whether the cited source actually supports the claim — a record pointing at a vacuous source is perfectly valid PROV-O. Nanopublications [36] proved per-assertion provenance workable at scale but check nothing. We turn provenance from documentation into an admission criterion and add the quality predicate (the anti-vacuity span rule) that the standards have no vocabulary for. Formal work on provenance *of* SHACL validation [37] is the dual of what we need — validation *of* provenance — and supports our auditability posture: a verdict that names its own evidence is what makes external reproduction possible.

### 2.7 Elicitation

Cognitive task analysis is the validated methodology for surfacing tacit expert decision knowledge [38, 39], and its transcript-parsing bottleneck has been a recognised automation target since before the LLM era [40]. The most recent statement of the problem is verbatim our thesis: LLM-mediated elicitation shows genuine potential but "has no inherent logic check of its own," and the required complement — an automated, scalable consistency check — is named as the open problem [41]. Our symbolic gate is that check.

### 2.8 The gap, summarised

Table 1 condenses the capability analysis across representative systems. Four rows are jointly empty across every prior column — evidence-quality admission, calibrated confidence, an explicit inferred tier, and a published constraint ablation — and they are this paper's contribution surface, together with the five gaps the review establishes: **(G1)** structural validity is solved and not binding [11–13]; **(G2)** KG-grounded verification presupposes a reference KG that tacit knowledge lacks [19–21]; **(G3)** hybrid validation is dominant yet undecomposed — no published ablation [7]; **(G4)** provenance standards record lineage but cannot enforce it, and no system judges evidence non-vacuity [35, 36]; **(G5)** live/temporal systems govern *when* a fact is true but leave the write path ungoverned [27, 28].

**Table 1.** Capability coverage of representative approaches versus this system (condensed; Yes/Partial/No as defined in the accompanying gap analysis).

| Capability | SHACL [15] | Text2KGBench [1] | iText2KG [2] | AutoSchemaKG [4] | EDC [5] | Zep/Graphiti [27] | KGR/GraphEval [19,20] | Constrained decoding [11–13] | **This system** |
|---|---|---|---|---|---|---|---|---|---|
| Schema authored independently of the extractor | Yes | Yes | Partial | No | Partial | No | Yes | Yes | **Yes** |
| Structural conformance enforced before the write | Yes | No | Partial | No | Partial | No | No | Yes | **Yes** |
| Per-fact provenance to a specific utterance is mandatory | No | No | No | No | No | Partial | No | No | **Yes** |
| Evidence quality checked (anti-generic/non-vacuous) | No | No | No | No | No | No | No | No | **Yes** |
| Calibrated confidence tier on every fact | No | No | No | No | No | No | Partial | No | **Yes** |
| Explicit tier for cross-episode inferred knowledge | No | No | No | No | No | No | No | No | **Yes** |
| Non-conforming output rejected, not repaired | Partial | No | No | No | No | No | No | Yes | **Yes** |
| Typed error to the generator + bounded retry | No | No | No | No | Partial | No | No | Partial | **Yes** |
| Graduated severity (hard/soft/advisory) | Partial | No | No | No | No | No | No | No | **Yes** |
| Live incremental construction during a session | No | No | Yes | Partial | No | Yes | No | No | **Yes** |
| Deterministic IDs, idempotent merge | No | No | No | No | No | Partial | No | No | **Yes** |
| Invalidate-not-delete on contradiction | No | No | No | No | No | Yes | No | No | **Yes** |
| Operates with no public reference KG | Yes | No | Yes | Yes | Yes | Yes | No | Yes | **Yes** |
| Verdict deterministic and externally reproducible | Yes | Partial | No | No | No | No | No | Yes | **Yes** |
| Marginal contribution of each constraint quantified | No | No | No | No | No | No | No | Partial | **Yes** |

## 3 System: A Gated Elicitation Engine

### 3.1 Deployment context and pipeline

The system is a deployed knowledge-elicitation product. A domain expert speaks (OpenAI Realtime voice, with client-owned response creation and semantic turn detection tuned against mid-sentence interruption) or types; an LLM interviewer conducts a seven-section structured session whose design instantiates cognitive-task-analysis practice [38, 39] — knowledge audit, decision rules, recovery cases, psychology, systemic context — under conduct rules learned from live trials: exactly one question per reply, never answering its own question or supplying candidate answers (agreement is not the expert's knowledge), never treating filler as an answer, and re-asking rather than skipping when a turn arrives fragmented.

Per expert turn the pipeline is: **elicitation → deterministic episodic scaffold → typed extraction → gated persistence**. A shared deterministic filler classifier (the same module in the product and the evaluation harness, so eligible-turn counts are comparable by construction) skips extraction entirely on navigation turns ("continue", "move on"): a filler turn carries no knowledge, and — an empirical finding from our first live audit — re-running the extractor on filler turns is precisely when it re-emits prior facts and mutates identities. For substantive turns, the session/section/episode chain is built deterministically, not asked of the model: the episode id derives from the message id (collision-proof under concurrent voice turns), the section is classified from the interviewer's question against the domain's declared interview structure with monotonic carry-forward, and the verbatim utterance is stored on the episode. The attachment of every fact to the transcript is therefore reproducible from the transcript alone.

The extractor (gpt-4o-mini, temperature 0) is called with a contract-generated schema reference, grounding instructions, and a summary of known entities framed as ids to reuse; it proposes a graph delta through a tool call whose parameter schema *requires* an inline `evidence` object on every knowledge vertex and accepts one on every edge. The gate then decides.

### 3.2 One contract, generated

Everything that must agree is generated from one source. A single contract is derived from the hand-authored domain schema (24 vertex classes — 19 knowledge, 5 infrastructure — and 33 edge types for the hospitality domain) plus an authored governance specification (26 rules with declared severities). From this contract are generated: the extractor's prompt schema reference, its tool parameter schema, the grounding instructions (including, derived from the schema's own property type declarations, the list of assertion-only boolean/numeric properties — §4.3), and the gate's rule bindings. Severities are read from the specification, never hardcoded. A rule the contract cannot bind to the schema is reported as **drift and disabled**, never silently reinterpreted; the test suite asserts drift is zero. Every drift bug in this project's history came from a hand-written copy of something already derivable — including an evaluation harness that once enforced spec-soft rules as hard and reported the resulting zero yield as a finding about provenance (§6.4).

This is the architectural answer to AutoSchemaKG [4] and LLM-generated ontologies [24]: a gate is only a gate if it is independent of the generator. Ours is authored by humans, version-controlled, and bound mechanically.

## 4 The Symbolic Gate

The gate is a deterministic function over (proposed delta, current graph, contract, turn context) returning the admitted delta, a typed findings report, and — when hard rules fired — a correction message for bounded retry. Admission is **per fact, not per delta**: replaying our earlier per-delta implementation over its archived deltas, a single dangling edge discarded an entire turn's knowledge, costing 60.4% of otherwise-admissible facts; per-fact admission recovers 97.9%. Six constraint classes:

**(i) Typed-schema conformance.** Labels, endpoint types (an endpoint declaration may be a single label or an array — one relation legitimately accepts many source types), required properties, property filtering to the declared set. Violations are hard: the element is rejected and a typed error is echoed to the extractor for a bounded retry, with an anti-invention rule (corrections must correct, never add facts) whose absence measurably contaminated retries in an earlier iteration (§6.4).

**(ii) Structural provenance with an anti-vacuity span rule.** The extractor attaches `evidence: {traceText, confidence}` inline; the gate materializes the `ProvenanceEvidence` vertex, selects the typed provenance edge from the contract, and stamps `sourceEpisode` and `speaker` from the turn itself — overwriting anything the model supplied. Extractor-authored evidence vertices and provenance edges are discarded by design; orphan evidence is unrepresentable. The **span rule** requires `traceText` to be a verbatim span of the current utterance, rejects a banned vocabulary of generic traces ("the expert described their approach"), and rejects a trace that merely restates the whole turn — quality of evidence is itself an admission criterion (G4). Missing evidence on a knowledge vertex is *soft* per the authored specification: the fact is admitted flagged, a design decision the A4/A4-strict ablation contrast justifies empirically (§6.1), and one soft retry is spent attempting to ground it, with attempt scoring that prefers a smaller fully-grounded delta over a larger flagged one.

**(iii) Calibrated confidence with an inferred tier.** `confidence ∈ {high, medium, low, inferred}` from a closed vocabulary. `inferred` marks cross-episode synthesis that no single quote supports — expert knowledge is frequently stated through stories and rarely once explicitly [39] — and relaxes the span rule to an audit flag rather than a rejection, trading a guarantee for an honest label. This is the enforced analogue of abstention credit [21].

**(iv) Identity: resolution, content-derived ids, and identity consistency.** Entity resolution merges a proposal onto an existing vertex when label and key text match (exact after normalisation, token overlap ≥ 0.7 with single-edit tolerance, or subset naming), keyed only on schema-declared properties (an undeclared property the gate would later strip must not block a merge). Genuinely new facts receive a content-hash id (`label:hash16`), making identical content idempotent regardless of the id the model picks. Deployment then taught us the missing constraint: an id the extractor *reuses* is protected from re-hashing only when its content names the **same concept** as the stored vertex. In our first fully-instrumented live session, the extractor reused an existing hash id for a different concept and last-write-wins merging relabeled the stored vertex — "loyalty program" became "theft" — leaving every previously attached edge pointing at the wrong concept. The graph was 100% span-grounded and materially wrong: **grounding is not coherence.** The gate now de-collides such reuse onto a fresh content-derived id and reports the repair. Within-delta duplicates and second singleton candidates are likewise collapsed deterministically.

**(v) Cross-turn edge witnesses.** The same live audit located the weakest population in the graph: relationships between two *already-known* entities, which the extractor could mint from graph memory with no utterance asserting them (21/40 relationships judged supported; 30% of edge citations correct). The authored rule HR026 — enforced hard — requires a knowledge-to-knowledge edge whose endpoints both pre-exist (neither re-asserted this turn) to carry its own span-valid evidence quoting the sentence that asserts the *relationship*, not a span naming one endpoint; otherwise it is rejected with a typed, retryable error. An edge with a freshly asserted endpoint is exempt — the endpoint's own evidence witnesses the turn. To our knowledge no prior construction system distinguishes these two edge populations, and the distinction is exactly where our measured incoherence concentrated.

**(vi) Invalidate-not-delete supersession.** A changed session-singleton (e.g. a revised check-in policy) supersedes its predecessor through an explicit gate-authored edge; the superseded claim remains in the graph and is excluded from resolution targets and summaries. The record of belief revision is part of the knowledge [27, 30].

**Graduated severity.** Rules carry *hard* (reject; typed error; bounded retry), *soft* (admit, warn, flag), or *advisory* (report) severity — read from the authored specification. FaithBench's severity finding [25] is the evidential basis: not all unsupported content is equally harmful, and §6.1 shows uniform maximal enforcement (A4-strict) is a coverage purchase paid for in yield with no faithfulness gain.

### 4.1 Property-level grounding

The live audit exposed a hallucination channel that per-fact metrics structurally under-detect: **property padding**. 33 of 57 facts (57.9%) carried at least one optional property filled with the model's own elaboration — 58 padded values in total, dominated by judgment-typed booleans stamped `true` — riding inside admitted, span-grounded facts whose *core* claim was genuinely supported. Fact-level evidential faithfulness was 89.5% while the padding rate was 57.9%: the metric and the channel are nearly orthogonal. The mitigation is derived from the schema itself: the contract exposes each property's declared value type, and the prompt derives the list of optional boolean/integer properties with the instruction to set them only when the expert explicitly asserts that judgment — a list that cannot drift because it is generated, not authored. An echo guard addresses the adjacent channel (content the interviewer suggested and the expert merely agreed to is not the expert's knowledge). The corpus run quantifies the effect: padded-fact rate ⟨·⟩% versus the 57.9% baseline.

### 4.2 The gate's account of itself

Every turn produces a machine-readable gate report: each attempt with proposal and admission counts, every finding (including hard rejections that never reached the graph), and the correction echoed back. A one-click session export bundles the transcript, per-turn admitted deltas with gate reports, the full graph, a derived audit input (every fact and edge with its trace and utterance attribution, computed by the same library the evaluation uses), and the aggregate gate log — plus the commit hash of the build that produced it, making a stale deployment self-identifying in the data. The elicitation session is self-documenting; continuous evaluation (Strand 2's closing concern) is a property of the artifact, not a separate campaign.

## 5 Evaluation Design

### 5.1 Controls

Three controls carry the design. **The harness imports the deployed gate** — a measured result is a claim about the shipped system, and there is no second gate implementation to drift (an earlier harness reimplemented the gate, and its bugs were reported as findings; §6.4). **Extraction is stateless**: the request depends only on the turn, attempt, and correction text, never on the condition, so attempt-1 proposals are identical across gated conditions and fact-level pairing is valid. **Graphs are per-session**: each session replays against a fresh graph, so cross-session contamination is impossible.

### 5.2 Conditions

Seven configurations of one frozen extractor (gpt-4o-mini, temperature 0, fixed seed and prompt hash): **A0** ungated free-form; **A1** constrained decoding only [11–13]; **A2** + typed-schema gate; **A3** + typed-error bounded retry; **A4** + provenance requirement at the severity the specification declares (soft); **A4-strict** identical with that one rule escalated to hard — an ablation *of severity policy itself*; **A5** the full deployed gate (confidence vocabulary, identity machinery, edge witnesses, supersession).

### 5.3 Metrics

OC and SH/RH/OH follow Text2KGBench [1]. Ours: **Provenance Coverage** (admitted knowledge vertices/edges carrying evidence); **Citation Correctness** (citations an independent judge confirms license their fact); **Evidential Faithfulness** (EF; admitted facts the judge confirms the utterance supports); **Usable-Faithful per turn** (facts both schema-conforming and judge-confirmed, per eligible interview turn — the denominator constant across conditions); **Duplicate Rate**; **Yield**; padding and coherence rates from the live audit. Every proportion carries exact counts and a Wilson 95% interval; a missing denominator is reported as UNMEASURED, never as zero. Paired contrasts use exact McNemar tests.

**The denominator is the experiment's quiet decision.** Retry inflates proposals, so per-proposal rates penalise the mechanism that recovers knowledge; the denominator constant across conditions is the interview itself. We report both and headline per-turn.

### 5.4 Adjudication

Harness EF and citation correctness are adjudicated by a judge model that never sees the condition. For the live deployed-session audit the judge is **cross-family** (Claude-family judge, GPT-family extractor), removing shared-pretraining correlation — the failure mode of agreement-based verification, where correlated models certify shared errors. Human labels remain UNMEASURED; a blinded, condition-stratified 119-row sample is prepared for labelling and nothing in this paper is described as human-verified.

### 5.5 The iteration record and machine-checked claims

Every methodological iteration is frozen — date, method, outcome with counts, causal reasoning, evidence — with an immutable metrics snapshot, *before work moves on*; the test suite fails if the current run is not the latest snapshot. Negative results, dead ends, and non-replications are part of the record and are cited in this paper as such. A claim verifier extracts every figure from this paper and fails CI unless it matches the measurement record — including required presence of the non-replication and non-significance statements. We offer this pipeline itself as a contribution to Strand 2's "continuous evaluation" concern: the paper cannot silently drift from the evidence.

### 5.6 Corpus

⟨k⟩ deployed elicitation sessions in the hospitality vertical (⟨N⟩ expert turns, ⟨N_e⟩ eligible after deterministic filler exclusion), collected on the fully-hardened build; plus the two instrumented single sessions from earlier iterations, which we report separately as the measured motivation for the final constraint classes. Transcripts are private, post-date the extractor's training data (leakage-free by construction), and never leave the local environment; committed artifacts carry counts and metrics only.

## 6 Results

### 6.1 Staged ablation: what each constraint buys

Table 2 reports the ablation on the corpus (⟨k⟩ sessions, ⟨N_e⟩ eligible turns; single-session iteration-05 values shown in brackets where the corpus cell is pending).

**Table 2.** Staged ablation; only the gate varies across A1–A5. UF/turn = facts both schema-conforming and judge-confirmed per eligible interview turn. Exact counts and Wilson 95% CIs in the results package.

| Cond. | UF/turn ↑ | UF-rate ↑ | EF ↑ | OC ↑ | Prov. ↑ | Edge Prov. ↑ | Cite ↑ | Edge Cite ↑ | Yield |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 ungated | ⟨·⟩ [0.00] | ⟨·⟩ [0.0%] | ⟨·⟩ [92.3%] | ⟨·⟩ [0.0%] | 0% | — | — | — | [100%] |
| A1 constrained | ⟨·⟩ [1.28] | ⟨·⟩ [82.0%] | ⟨·⟩ [82.0%] | ⟨·⟩ [90.0%] | 0% | — | — | — | [100%] |
| A2 +schema | ⟨·⟩ [1.28] | ⟨·⟩ [82.0%] | ⟨·⟩ [91.1%] | ⟨·⟩ [100%] | 0% | — | — | — | [90.0%] |
| A3 +retry | ⟨·⟩ [1.75] | ⟨·⟩ [83.6%] | ⟨·⟩ [86.2%] | ⟨·⟩ [100%] | 0% | — | — | — | [97.0%] |
| A4 +provenance (soft) | ⟨·⟩ [1.53] | ⟨·⟩ [76.6%] | ⟨·⟩ [83.1%] | ⟨·⟩ [100%] | [83.7%] | [68.8%] | [63.9%] | [54.5%] | [92.2%] |
| A4-strict (hard) | ⟨·⟩ [1.41] | ⟨·⟩ [68.2%] | ⟨·⟩ [84.9%] | ⟨·⟩ [100%] | [100%] | [100%] | [67.5%] | [46.2%] | [80.3%] |
| A5 full gate | ⟨·⟩ [1.69] | ⟨·⟩ [81.8%] | ⟨·⟩ [81.8%] | ⟨·⟩ [100%] | [84.8%] | [65.0%] | [69.2%] | [46.2%] | [100%] |

Five findings, stated on the measured single-session run and re-tested on the corpus:

**Ungated extraction converts nothing.** A0 is faithful but unusable: EF 92.3% yet 0 of 52 proposals conform to a schema it was never given — usable-faithful yield 0%. This baseline is context, not contribution; it approximates the industrial default posture [6] and quantifies G1: structure and truth are different axes, and without structure, truth is not machine-usable.

**Provenance by construction is worth ~90 points of coverage.** When evidence was a free-standing vertex the model had to remember to author and link, measured coverage was 2.2–5.4%. Carried inline and materialized by the gate, coverage is 83.7–100% on vertices and 65–100% on edges across three independent measurements (harness A4/A4-strict/A5; live session §6.2). An evidence field the extractor cannot omit beats an evidence node it must remember, decisively (G4).

**Severity is a coverage dial, not a truthfulness dial.** Hard-enforcing the provenance rule (A4-strict vs A4) buys coverage (100% vs 83.7%) and costs yield (−0.12 UF/turn single-session) with EF unchanged within intervals (84.9% vs 83.1%). This is the empirical justification for graduated severity [25] and for the authored specification marking the rule soft: audit and retry recover grounding more cheaply than rejection buys it. Corpus: ⟨·⟩.

**Retry recovers volume; the gate makes the volume auditable.** Retry alone (A3) matches the full gate's throughput (1.75 vs 1.69 UF/turn) with none of its governance — no provenance, no deterministic identity, no supersession. The gate's value over retry is not volume; it is that the same volume arrives quoted, typed, deduplicated (0/54), and supersession-tracked. Per eligible turn, the full gate over constrained decoding alone is 1.28 → 1.69 UF/turn (+32%) at 100% conformance and 100% yield.

**Nothing is significant at n = 32 — and we say so.** On the single session every paired contrast fails significance (A0 vs A5 p = 0.125; A1 vs A5 p = 1; A2 vs A3 p = 0.625; exact McNemar). An earlier iteration's significant retry-contamination effect (p = 0.0156) did not recur after the anti-invention rule; across three controlled runs on the same corpus, per-fact EF contrasts between conditions moved in both directions with prompt changes, while the per-turn composite ordering (gated ≫ ungated; A5 > A1) held in every run. The corpus run is powered to decide what the single session could not: A1 vs A5 usable-faithful contrast, p = ⟨·⟩ over ⟨N_e⟩ paired turns.

### 6.2 Live deployed-session audit: grounding is not coherence

Between ablation iterations we audited a complete session of the deployed product (47 user turns; 57 knowledge facts; 40 semantic edges) with deterministic checks plus a cross-family judge. The span rule **held universally**: 54/54 grounded facts and 30/30 grounded edges quote verbatim spans of their attributed utterance (deterministically verified); vertex provenance coverage 94.7% (54/57), edge coverage 75.0% (30/40); fact-level EF 89.5% (51/57); citation correctness 75.9% (41/54).

And yet the graph was materially wrong in two ways the headline metrics barely register:

- **Property padding** (§4.1): 57.9% of facts carried unstated property values — 58 fabricated values inside span-grounded facts. Citation auditing catches what fact-level EF misses; the enum/boolean channel is now closed by the schema-derived assertion-only rule. Corpus re-measurement: ⟨·⟩% padded (target: materially below 57.9%).
- **Identity mutation** (§4-iv): one reused hash-id relabeled a stored concept and silently re-attached its edges; 12/40 edges (30%) were judged semantically incoherent, concentrated among cross-turn edges (relationship support 52.5%; edge citation correctness 30.0%). Both constraint classes that close this channel (identity consistency; HR026 edge witnesses) are deployed and covered by conformance tests. Corpus re-measurement: edge incoherence ⟨·⟩% (target: below 30.0%), edge citation correctness ⟨·⟩% (target: above 30.0%), HR026 admission cost ⟨·⟩ rejected witnessless edges per session.

We consider this the paper's central qualitative lesson for the workshop audience: **a knowledge graph can pass a perfect provenance audit and still be wrong**, because grounding constrains facts while identity and relational coherence are properties *of the graph*, not of any fact. Symbolic admission must therefore check identity consistency and relational witnesses, not only spans — constraint classes we have not found in any prior construction system (Table 1).

### 6.3 Corpus results

*(This subsection is populated from the frozen iteration-08 metrics: per-session and pooled tables for Table 2's columns; padding, coherence, and edge-witness deltas against the §6.2 baselines; per-session gate-log summaries — retries consumed, hard rejections by rule, filler exclusions; and the paired significance tests. Placeholders ⟨·⟩ throughout this draft resolve here. Per the project's standing rule, these numbers are generated by `npm run ablation && npm run results:build` and machine-verified against this paper by the claim verifier; they are never hand-edited.)*

Expected outcomes, stated as falsifiable predictions registered in the claims file before the corpus was collected: padded-fact rate materially below 57.9%; edge incoherence below 30%; edge citation correctness above 30%; vertex provenance coverage ≥ 85% maintained; UF/turn not below the 1.69 single-session value; identity-mutation incidents = 0 under the consistency rule. If the corpus does not move these numbers, the mechanisms — not the measurements — are wrong, and that result would be reported here in their place.

### 6.4 Negative results and instrumentation lessons

The iteration record requires these to be reported, and they are load-bearing for anyone reproducing this class of system:

1. **A reimplemented harness manufactures findings.** The first ablation's harness reimplemented the gate, enforced spec-soft rules as hard, rejected per delta rather than per fact, and required remembered rather than structural evidence — and reported the resulting 0/59 admission as a finding about provenance strictness. Every subsequent run imports the deployed gate. Zeros are instrumentation until proven otherwise: a later sub-run measured 0/N edge coverage across all conditions, which was the harness normalizer silently stripping edge evidence, not a model failure.
2. **A non-replication of our own headline.** Iteration 03's A0-vs-gated EF contrast collapsed when a prompt asymmetry was fixed in iteration 04. Per-fact EF contrasts on one session are prompt-sensitive in both directions; only the per-turn composite ordering survived all three runs. Single-run ablations at n = 32 over-claim by construction.
3. **Retry-cost direction reversed** across runs on the same corpus — the expected penalty of correction rounds ran opposite on one session — so we report retry economics per run and draw no general conclusion below corpus scale.
4. **The audit itself had a bug**: our first utterance-attribution pass assumed the export's turn order was utterance order; it is extraction-completion order, and a concurrent-voice-turn id collision made three span checks fail spuriously. Attribution now goes through admitting turn records (collision-proof), the episode id is derived from the message id, and the derivation is a shared library with the collision case under test.

## 7 Discussion

**Where this sits in the NeSy design space.** In boxology terms [31, 32], the pattern is a deterministic symbolic authority gating a neural generator at a persistence boundary, with a typed feedback edge from the symbolic verdict back to the generator (bounded retry) and a severity policy authored outside both. Industrial evidence that symbolic gating of neural output works, and that generator-independence is the load-bearing property, exists in process control [33]; our contribution is applying it at the knowledge-*ingestion* boundary, where the artifact being defended is the accumulating graph itself. Selective, graduated enforcement is an established NeSy deployment posture [34]; our A4/A4-strict contrast is, to our knowledge, its first quantification for knowledge admission (G3).

**Composability with temporal memory.** The gate is orthogonal to bi-temporal substrates [27, 30]: Graphiti-class systems decide *when* a fact is true; the gate decides *whether* it may be written at all (G5). The supersession class is deliberately minimal (invalidate-not-delete on singletons); full bi-temporal validity over elicited knowledge is future work with formal grounding available [30].

**What remains hard.** Citation *support* lags citation *coverage* everywhere we measure it: coverage can be guaranteed by construction, support cannot — it is judged, and the judge is a model. The honest frontier is exactly there: property-level grounding is now prompt-enforced and schema-derived but not yet gate-checked; the cross-family judge removes shared-family correlation but not model-judge fallibility; and the blinded human sample remains unlabelled. We say plainly: nothing in this paper is human-verified, and the pipeline is built so that when the human labels arrive, they slot into the same frozen record.

**Why elicitation is the right stress test for neurosymbolic KG engineering.** Elicited tacit knowledge is the setting where every crutch is removed at once: no reference KG (G2), no redundancy across documents, a single fallible source, real-time construction, and high stakes per fact (a senior operator's rare heuristic appears once, in one story [39]). A validation architecture that works here — where verification must be manufactured at capture time — transfers easily to settings with more safety nets; the reverse is not true.

## 8 Limitations

One vertical (hospitality) with a second domain shipped but unevaluated; ⟨k⟩ sessions from a small number of experts; single-session contrasts are not significant and are labelled as such; corpus significance is reported in §6.3 as measured, whatever it shows. EF, citation correctness, coherence, and padding judgments are model-adjudicated; the cross-family design removes shared-pretraining correlation but not judge error; human labels are UNMEASURED. A0's free-form facts are not the same objects as typed facts; its baseline is context. Edge-citation denominators are small. The interview corpus is ASR output with its error profile. Downstream utility (question-answering over the elicited graph) is out of scope here. The gate's constraint classes are domain-agnostic but the schema is not; authoring a schema and governance specification per domain is deliberate, unamortised human work — that is what independence of the generator costs (§2.3, [23, 24]).

## 9 Conclusion

In live, LLM-driven knowledge-graph construction, structural validity is already guaranteed by constrained decoding and is not the binding constraint; the binding constraint is evidential grounding, and it must be enforced at the ingestion boundary by a symbolic authority independent of the extractor — because for tacit expert knowledge there is no reference graph to check against afterwards. We built that authority, deployed it, and decomposed it: structural provenance is worth ~90 points of coverage over remembered provenance; severity policy trades yield for coverage, not faithfulness; retry buys volume while the gate makes volume auditable; and two live-deployment defects — property padding and identity mutation — taught us that grounding is not coherence, yielding two constraint classes (identity consistency, cross-turn edge witnesses) we have not found elsewhere in the construction literature. The evaluation methodology is itself part of the contribution: the harness runs the deployed gate, every iteration is frozen with its snapshot, negative results are retained, and this paper's figures are machine-verified against the record. The graph that results is not merely extracted knowledge; it is knowledge with a warrant — every fact carrying the expert's own words, every relationship its witness, every correction its history.

## Reproducibility

The gate, contract generator, harness, audit tooling, and claim verifier are in the project repository. `npm run ablation` executes all conditions against the deployed gate (API responses cached); `npm run results:build` regenerates the metrics package; `npm test` runs gate conformance (53 checks), results-package integrity (counts reconcile with raw evidence; latest iteration snapshot frozen), and the paper claim verifier. Raw per-turn rows and audit samples quote experts verbatim and are generated locally, never committed.

---

## References

[1] N. Mihindukulasooriya, S. Tiwari, C. F. Enguix, and K. Lata. Text2KGBench: A benchmark for ontology-driven knowledge graph generation from text. In *Proc. ISWC 2023*, LNCS 14266, pp. 247–265, 2023.

[2] Y. Lairgi et al. iText2KG: Incremental knowledge graphs construction using large language models. In *Proc. WISE 2024*, LNCS, 2024. arXiv:2409.03284. *(Verify full author list against proceedings before camera-ready.)*

[3] ATOM: Adaptive and optimized dynamic temporal knowledge graph construction using LLMs. arXiv:2510.22590, 2025. *(Verify author list before camera-ready.)*

[4] J. Bai, W. Fan, Q. Hu, Q. Zong, C. Li, H. T. Tsang, H. Luo, et al. AutoSchemaKG: Autonomous knowledge graph construction through dynamic schema induction from web-scale corpora. In *Proc. ACL 2026 (Long)*. arXiv:2505.23628.

[5] B. Zhang and H. Soh. Extract, define, canonicalize: An LLM-based framework for knowledge graph construction. In *Proc. EMNLP 2024*.

[6] D. Edge, H. Trinh, N. Cheng, J. Bradley, A. Chao, A. Mody, S. Truitt, and J. Larson. From local to global: A Graph RAG approach to query-focused summarization. arXiv:2404.16130, 2024.

[7] H. Bian. LLM-empowered knowledge graph construction: A survey. arXiv:2510.20345, 2025.

[8] J. H. Caufield et al. Structured Prompt Interrogation and Recursive Extraction of Semantics (SPIRES): A method for populating knowledge bases using zero-shot learning. *Bioinformatics*, 2024. arXiv:2304.02711.

[9] J. Han, N. Collier, W. Buntine, and E. Shareghi. PiVe: Prompting with iterative verification improving graph-based generative capability of LLMs. In *Findings of EMNLP 2024*. arXiv:2305.12392.

[10] S. Carta, A. Giuliani, L. Piano, A. S. Podda, L. Pompianu, and S. G. Tiddia. Iterative zero-shot LLM prompting for knowledge graph construction. arXiv:2307.01128, 2023.

[11] S. Geng et al. JSONSchemaBench: A rigorous benchmark of structured outputs for language models. In *Proc. ICML 2025*. arXiv:2501.10868.

[12] Y. Dong et al. XGrammar: Flexible and efficient structured generation engine for large language models. In *Proc. MLSys 2025*. arXiv:2411.15100.

[13] B. T. Willard and R. Louf. Efficient guided generation for large language models. arXiv:2307.09702, 2023.

[14] Z. R. Tam, C.-K. Wu, Y.-L. Tsai, C.-Y. Lin, H.-Y. Lee, and Y.-N. Chen. Let me speak freely? A study on the impact of format restrictions on performance of large language models. In *Proc. EMNLP 2024 Industry Track*. arXiv:2408.02442.

[15] H. Knublauch and D. Kontokostas (eds.). Shapes Constraint Language (SHACL). W3C Recommendation, 20 July 2017.

[16] M. Figuera, P. D. Rohde, and M.-E. Vidal. Trav-SHACL: Efficiently validating networks of SHACL constraints. In *Proc. WWW 2021*, pp. 3337–3348.

[17] G. C. Publio and J. E. Labra Gayo. xpSHACL: Explainable SHACL validation using retrieval-augmented generation and large language models. In *Proc. VLDB 2025 Workshop on LLM+Graph*.

[18] T. W. Lin et al. Systematic evaluation of knowledge graph repair with large language models. arXiv:2507.22419, 2025.

[19] H. Sansford, N. Richardson, H. Petric Maretic, and J. Nait Saada. GraphEval: A knowledge-graph based LLM hallucination evaluation framework. In *KDD 2024 Workshop on Knowledge-infused Learning* (CEUR). arXiv:2407.10793.

[20] X. Guan, Y. Liu, H. Lin, Y. Lu, B. He, X. Han, and L. Sun. Mitigating large language model hallucinations via autonomous knowledge graph-based retrofitting. In *Proc. AAAI 2024*. arXiv:2311.13314.

[21] A. Robertson, H. Liang, M. Gani, R. Kumar, and S. Rajamohan. KGHaluBench: Knowledge-graph grounded hallucination benchmarking for large language models. arXiv:2602.19643, 2026.

[22] R. Haskins and B. Adams. KEA Explain: Explanations of hallucinations using graph kernel analysis. In *Proc. NeSy 2025*, PMLR vol. 284, pp. 1–18. arXiv:2507.03847.

[23] D. Fernández-Álvarez, J. E. Labra-Gayo, and D. Gayo-Avello. Automatic extraction of shapes using sheXer. *Knowledge-Based Systems* 238:107975, 2022.

[24] L. M. V. da Silva, A. Köcher, F. Gehlhoff, and A. Fay. On the use of large language models to generate capability ontologies. In *Proc. IEEE ETFA 2024*, pp. 1–8.

[25] F. S. Bao et al. FaithBench: A diverse hallucination benchmark for summarization by modern LLMs. In *Proc. NAACL 2025*. arXiv:2410.13210.

[26] A. Sawczyn, J. Binkowski, D. Janiak, B. Gabrys, and T. Kajdanowicz. FactSelfCheck: Fact-level black-box hallucination detection for LLMs. In *Findings of EACL 2026*, pp. 5603–5621.

[27] P. Rasmussen, P. Paliychuk, T. Beauvais, J. Ryan, and D. Chalef. Zep: A temporal knowledge graph architecture for agent memory. arXiv:2501.13956, 2025.

[28] P. Chhikara et al. Mem0: Building production-ready AI agents with scalable long-term memory. arXiv:2504.19413, 2025.

[29] P. Anokhin et al. AriGraph: Learning knowledge graph world models with episodic memory for LLM agents. In *Proc. ICLR 2025*. arXiv:2407.04363.

[30] L. Meijer. Bi-VAKS: A bi-temporal versioning approach for knowledge graphs. MSc thesis, TU Delft, 2022.

[31] M. van Bekkum, M. de Boer, F. van Harmelen, A. Meyer-Vitali, and A. ten Teije. Modular design patterns for hybrid learning and reasoning systems. *Applied Intelligence* 51:6528–6546, 2021.

[32] A. d'Avila Garcez and L. C. Lamb. Neurosymbolic AI — the 3rd wave. *Artificial Intelligence Review* 56:12387–12406, 2023.

[33] B. Galitsky and A. Rybalov. Neuro-symbolic verification of large language model outputs in industrial process settings. *Processes (MDPI)*, 2026.

[34] SymRAG: Adaptive neuro-symbolic query routing for efficient retrieval-augmented generation. arXiv:2506.12981, 2025. *(Verify author list before camera-ready.)*

[35] T. Lebo, S. Sahoo, and D. McGuinness (eds.). PROV-O: The PROV Ontology. W3C Recommendation, 30 April 2013.

[36] P. Groth, A. Gibson, and J. Velterop. The anatomy of a nanopublication. *Information Services and Use* 30(1–2):51–56, 2010.

[37] T. Delva, A. Dimou, M. Jakubowski, and J. Van den Bussche. Data provenance for SHACL. In *Proc. ICDT 2023*.

[38] The use of cognitive task analysis in clinical and health services research — a systematic review. *BMC Health Services Research*, 2022. PROSPERO CRD42019128418. *(Verify author list before camera-ready.)*

[39] L. G. Militello and R. J. B. Hutton. Applied cognitive task analysis (ACTA): A practitioner's toolkit for understanding cognitive task demands. *Ergonomics* 41(11):1618–1641, 1998.

[40] J. Du, H. Jiang, J. Shen, and X. Ren. Eliciting knowledge from experts: Automatic transcript parsing for cognitive task analysis. In *Proc. ACL 2019*. arXiv:1906.11384.

[41] Reinterpreting corporate tacit knowledge using large language models. *Industry Science*, 2026. *(Verify author list and venue before camera-ready.)*

[42] H. Babaei Giglou, J. D'Souza, and S. Auer. LLMs4OL: Large language models for ontology learning. In *Proc. ISWC 2023*, LNCS 14265.

[43] C. Niu, Y. Wu, J. Zhu, S. Xu, K. Shum, R. Zhong, J. Song, and T. Zhang. RAGTruth: A hallucination corpus for developing trustworthy retrieval-augmented language models. In *Proc. ACL 2024*. arXiv:2401.00396.
