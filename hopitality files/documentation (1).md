# Hospitality Domain — Knowledge Graph Documentation

Human-readable walkthrough of the hospitality domain's typed property-graph schema.

`schema-hospitality.json` is the **single source of truth** for the schema. This document is a prose companion for human readers and reviewers. It is loaded by **no** code. If this document and the JSON disagree, **the JSON wins.** Do not treat vertex or edge counts here as authoritative — they are a point-in-time snapshot.

**21 vertex types · 27 edge types.**

---

## Conventions

- Vertex labels are **PascalCase** (e.g. `GuestExperiencePrinciple`).
- Edge labels are **camelCase** (e.g. `appliesToPersona`).
- IDs are lowercase, colon-namespaced slugs (e.g. `principle:first-impressions-matter`, `session:hospitality:2026-06-18`).
- Every extracted knowledge vertex **must** have at least one outgoing provenance edge to a `ProvenanceEvidence` vertex. Infrastructure vertices (`Person`, `KnowledgeSession`, `SessionSection`, `TranscriptEpisode`, `ProvenanceEvidence` itself) are exempt.
- `CheckInPolicy` and `CheckOutPolicy` are **session singletons** — emitted exactly once per session and upserted (never duplicated) in subsequent sections.

---

## Top-Level Graph Shape

```
Person
  └──hasSession──> KnowledgeSession
                     └──hasSection──> SessionSection (×7, one per prompt section A–G)
                                        └──hasEpisode──> TranscriptEpisode
                                                           └──discusses──────────> GuestExperiencePrinciple
                                                           └──discussesRule──────> DecisionRule
                                                           └──discussesHeuristic─> OperatingHeuristic
                                                           └──discussesFailure───> ServiceFailure
```

The `KnowledgeSession` is the root of one expert's knowledge capture. `SessionSection` organises the session into the 7 prompt sections (A–G). `TranscriptEpisode` records every conversational turn verbatim. All extracted knowledge hangs off transcript episodes or other knowledge vertices — never directly off the session root.

---

## Layer Overview

The hospitality graph has **6 logical layers**, from session infrastructure at the top to outcomes at the bottom:

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — SESSION INFRASTRUCTURE                                   │
│  Person · KnowledgeSession · SessionSection · TranscriptEpisode     │
│  ProvenanceEvidence                                                  │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│  LAYER 2 — PRINCIPLES & STANDARDS (Section B)                       │
│  GuestExperiencePrinciple · ServiceStandard                         │
│  GuestSignal · GuestPersona                                         │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│  LAYER 3 — POLICY LAYER — SINGLETON VERTICES (Section C)            │
│  CheckInPolicy · CheckOutPolicy · TimingRule                        │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│  LAYER 4 — OPERATIONAL KNOWLEDGE (Sections C–E)                     │
│  DecisionRule · OperatingHeuristic                                  │
│  ServiceFailure · RecoveryAction · ExceptionRule                    │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│  LAYER 5 — LOYALTY & PSYCHOLOGY (Section F)                         │
│  LoyaltyDriver · EmotionalMoment                                    │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│  LAYER 6 — CONTEXT & OUTCOMES (Section G)                           │
│  ContextualConstraint · Outcome                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Vertex Reference

### Layer 1 — Session Infrastructure

#### `Person`
The expert whose knowledge is being captured. Session root anchor.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | No | Expert's name or pseudonym |

**ID convention:** `person:{expert-name-slug}`  
**Edges out:** `hasSession → KnowledgeSession`

---

#### `KnowledgeSession`
One knowledge-capture session. Holds session-level metadata. Created once per session in Section A; never duplicated.

| Property | Type | Required | Notes |
|---|---|---|---|
| `domain` | string | **Yes** | Always `"hospitality"` |
| `expertName` | string | No | |
| `expertRole` | string | No | e.g. `"boutique hotel owner"` |
| `date` | string | No | ISO-8601 date |
| `objective` | string | No | Session goal summary |
| `confidentialityLevel` | string | No | e.g. `"internal"`, `"public"` |

**ID convention:** `session:hospitality:{YYYY-MM-DD}`  
**Edges out:** `hasSection → SessionSection`

---

#### `SessionSection`
One section of the interview prompt (A–G). Organises transcript episodes by topic.

| Property | Type | Required | Notes |
|---|---|---|---|
| `sectionType` | string | **Yes** | e.g. `"guest_experience_principles"` |
| `title` | string | No | Human-readable title |
| `order` | int32 | **Yes** | 1–7 |
| `purpose` | string | No | What this section captures |

**ID convention:** `section:{session_id}:{order}`  
**Edges out:** `hasEpisode → TranscriptEpisode`

---

#### `TranscriptEpisode`
One conversational turn — a single expert utterance in response to the interviewer. The atomic unit of provenance. Every extracted knowledge vertex traces back to one or more `TranscriptEpisode` vertices.

| Property | Type | Required | Notes |
|---|---|---|---|
| `verbatimText` | string | **Yes** | The expert's exact words |
| `speaker` | string | No | `"expert"` or `"interviewer"` |
| `startTime` | string | No | Session offset, e.g. `"00:12:34"` |
| `endTime` | string | No | |
| `confidence` | string | No | ASR confidence if auto-transcribed |

**ID convention:** `ep:{session_id}:{sequence}` — sequence is a zero-padded integer  
**Edges out:** `discusses`, `discussesRule`, `discussesHeuristic`, `discussesFailure`

---

#### `ProvenanceEvidence`
The evidentiary anchor for every extracted knowledge vertex. Contains the verbatim quote or faithful paraphrase that justifies the extraction. See `provenance-spec.json` for full detail.

| Property | Type | Required | Notes |
|---|---|---|---|
| `traceText` | string | **Yes** | Verbatim quote or faithful paraphrase. Must be specific — generic placeholders are rejected. |
| `sourceEpisode` | string | **Yes** | ID of the source `TranscriptEpisode` |
| `speaker` | string | **Yes** | `"expert"` \| `"interviewer"` \| `"system"` |
| `timestamp` | string | No | ISO-8601 or session offset |
| `confidence` | string | No | `"high"` \| `"medium"` \| `"low"` \| `"inferred"` |

**ID convention:** `prov:{episode_id}:{sequence}` — e.g. `prov:ep:session:hospitality:2026-06-18:5:01`

**Confidence definitions:**
- `high` — expert stated the rule directly and unambiguously; traceText is a near-verbatim quote
- `medium` — expert clearly implied the rule conversationally; traceText is a faithful paraphrase
- `low` — expert gestured at the idea without elaborating; flagged for human review
- `inferred` — synthesised across 2+ utterances; traceText names contributing episode IDs

> **Hospitality note:** Experts frequently embed rules inside stories and anecdotes. Accept paraphrased story summaries as valid `traceText` as long as the specific rule or principle is captured, not just the topic.

---

### Layer 2 — Principles & Standards

#### `GuestExperiencePrinciple`
A core, foundational belief about what excellent hospitality means — what guests love, what they remember, what makes this property distinctive. The top-level belief layer. Extracted in Section B; enriched in Section F.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | Short label, e.g. `"First impressions are permanent"` |
| `description` | string | No | Fuller explanation |
| `type` | string | No | e.g. `"interaction"`, `"environment"`, `"emotional"` |
| `neverCompromise` | boolean | No | `true` if expert says this is non-negotiable |

**ID convention:** `principle:{name-slug}`  
**Provenance edge:** `principleSupportedBy → ProvenanceEvidence`  
**Edges out:** `appliesToPersona → GuestPersona`  
**Edges in:** `standardEnforces ← ServiceStandard`, `discusses ← TranscriptEpisode`

---

#### `ServiceStandard`
A specific, concrete standard the expert enforces that operationalises a principle. More specific than a principle; often maps one-to-one with a process or checklist item.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | e.g. `"Welcome drink within 3 minutes of arrival"` |
| `standardText` | string | No | Full description of the standard |
| `nonNegotiable` | boolean | No | `true` if expert never compromises this |
| `appliesToSegment` | string | No | Guest segment this standard targets |

**ID convention:** `standard:{name-slug}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges out:** `standardEnforces → GuestExperiencePrinciple`

---

#### `GuestSignal`
An observable behaviour, cue, or indicator that the expert uses to read a guest — to infer their type, satisfaction level, or likelihood of return. These are the expert's "tells."

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | e.g. `"Guest lingers at reception"` |
| `signalType` | string | No | `"behavioural"`, `"verbal"`, `"non-verbal"`, `"written"` |
| `interpretation` | string | No | What this signal means to the expert |
| `highValueIndicator` | boolean | No | `true` if this signal identifies a high-value guest |
| `returnLikelihood` | string | No | `"high"` \| `"medium"` \| `"low"` |

**ID convention:** `signal:{name-slug}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges out:** `signalIndicates → GuestPersona`, `signalTriggers → DecisionRule`

> **Reuse rule:** `GuestSignal` vertices are frequently relevant across Sections B, C, and E. Always check the vertex ID cache before emitting — reuse the existing ID and add new edges rather than creating a duplicate.

---

#### `GuestPersona`
A distinct guest type the expert recognises and serves differently. Not a marketing persona — a practical operational category the expert uses to make real decisions.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | e.g. `"repeat-guest"`, `"first-timer"`, `"high-value-traveller"` |
| `description` | string | No | How the expert describes this guest type |
| `primaryNeed` | string | No | What this guest type needs most |
| `valueDriver` | string | No | What creates value for this guest type |
| `repeatGuest` | boolean | No | `true` if this is a returning-guest persona |

**ID convention:** `persona:{name-slug}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges in:** `appliesToPersona ← GuestExperiencePrinciple`, `signalIndicates ← GuestSignal`, `exceptionMadeFor ← ExceptionRule`, `drivenBy ← LoyaltyDriver`

> **Reuse rule:** `GuestPersona` is the most frequently reused vertex across sections (B, C, D, E, F). Always reuse the existing vertex ID. Never duplicate.

---

### Layer 3 — Policy Layer (Singleton Vertices)

#### `CheckInPolicy`
The expert's formal and informal check-in policy for their property. **Session singleton** — emitted once in Section C; upserted (never re-created) in later sections when new context modifies it (e.g. Section G adds a seasonal constraint).

| Property | Type | Required | Notes |
|---|---|---|---|
| `standardTime` | string | No | Standard check-in time, e.g. `"14:00"` |
| `earlyCheckIn` | boolean | No | Whether early check-in is offered |
| `earlyCheckInFee` | boolean | No | Whether a fee is charged for early check-in |
| `sweetSpotTime` | string | No | The expert's preferred optimal check-in window |
| `earlyArrivalHandling` | string | No | How early-arriving guests are managed |
| `rationale` | string | No | Why the policy is structured this way |

**ID convention:** `policy:checkin:{session_id}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges out:** `governs → TimingRule`, `constraintAffectsPolicy ← ContextualConstraint`

> **Singleton rule:** If a `CheckInPolicy` vertex for this session already exists in the vertex ID cache, add new properties or edges to the existing vertex — never emit a second `CheckInPolicy`.

---

#### `CheckOutPolicy`
The expert's check-out policy. Session singleton with identical lifecycle rules to `CheckInPolicy`.

| Property | Type | Required | Notes |
|---|---|---|---|
| `standardTime` | string | No | Standard check-out time, e.g. `"11:00"` |
| `lateCheckOut` | boolean | No | Whether late check-out is offered |
| `lateCheckOutFee` | boolean | No | Whether a fee applies for late check-out |
| `lateHandlingApproach` | string | No | How late departures are managed |
| `rationale` | string | No | Why the policy is structured this way |

**ID convention:** `policy:checkout:{session_id}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges out:** `governsCheckOut → TimingRule`

---

#### `TimingRule`
A specific if-then timing rule the expert has refined through experience — e.g. *"if room is physically ready before noon and the guest is present, allow early check-in regardless of official policy."* Governed by `CheckInPolicy` or `CheckOutPolicy`.

| Property | Type | Required | Notes |
|---|---|---|---|
| `ruleText` | string | **Yes** | The complete rule as the expert states it |
| `ruleType` | string | No | `"early-checkin"`, `"late-checkout"`, `"arrival-handling"`, etc. |
| `ifCondition` | string | No | Trigger condition |
| `thenAction` | string | No | Resulting action |
| `exception` | string | No | Any stated exception to the rule |
| `refinedThroughExperience` | boolean | No | `true` if expert says they learned this over time |

**ID convention:** `timing:{rule-type-slug}:{sequence}`  
**Provenance edge:** `heuristicSupportedBy → ProvenanceEvidence`  
**Edges in:** `governs ← CheckInPolicy`, `governsCheckOut ← CheckOutPolicy`

---

### Layer 4 — Operational Knowledge

#### `DecisionRule`
An explicit if-then operational rule. The most important knowledge vertex type — it encodes the expert's concrete decision logic. Distinguished from `OperatingHeuristic` by being more explicit and less tacit.

| Property | Type | Required | Notes |
|---|---|---|---|
| `ruleText` | string | **Yes** | Full rule as a specific statement. Must be >20 chars and not a placeholder. |
| `ifCondition` | string | No | The trigger condition |
| `thenAction` | string | No | The resulting action |
| `exception` | string | No | Any stated override condition |
| `priority` | string | No | `"high"` \| `"medium"` \| `"low"` |
| `intuitionBased` | boolean | No | `true` if the expert describes this as gut-feel rather than process |

**ID convention:** `rule:{if-condition-slug}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges in:** `signalTriggers ← GuestSignal`, `discussesRule ← TranscriptEpisode`, `heuristicExplains ← OperatingHeuristic`, `exceptionAppliesTo ← ExceptionRule`, `modulatedBy ← ContextualConstraint`  
**Edges out:** `leadsTo → Outcome`

> **Example:** *"If a guest is complaining loudly at the front desk and there are other guests nearby, move the conversation immediately to a private space before attempting to resolve."* — `ruleText`, `ifCondition: "complaining loudly in public area"`, `thenAction: "move to private space first"`.

---

#### `OperatingHeuristic`
An intuitive pattern or rule of thumb the expert has refined through lived experience — less explicit than a `DecisionRule`, more like professional wisdom. Often the "why" behind a decision rule.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | Short label |
| `heuristic` | string | No | The heuristic in the expert's own words |
| `whenUsed` | string | No | The context in which this heuristic applies |
| `learnedThrough` | string | No | How this was learned (e.g. `"years of service recovery"`) |

**ID convention:** `heuristic:{name-slug}`  
**Provenance edge:** `heuristicSupportedBy → ProvenanceEvidence`  
**Edges out:** `heuristicExplains → DecisionRule`  
**Edges in:** `discussesHeuristic ← TranscriptEpisode`

> **Example:** *"New operators always try to enforce the policy. Experienced ones know when to bend it."* — This is a heuristic, not a rule. It doesn't have a specific if-then structure; it's a meta-pattern about how expertise expresses itself. It would be linked to a `DecisionRule` about policy flexibility via `heuristicExplains`.

---

#### `ServiceFailure`
A type of service failure the expert has experienced and developed a recovery playbook for. Represents the category of failure, not a specific incident.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | e.g. `"Room not ready at check-in"` |
| `frequency` | string | No | How often this occurs: `"rare"`, `"occasional"`, `"common"` |
| `description` | string | No | Fuller description |
| `severity` | string | No | `"minor"`, `"moderate"`, `"major"`, `"reputation-threatening"` |

**ID convention:** `failure:{name-slug}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges out:** `resolvedBy → RecoveryAction`  
**Edges in:** `discussesFailure ← TranscriptEpisode`

---

#### `RecoveryAction`
The specific recovery action the expert takes in response to a `ServiceFailure`. Represents the expert's proven recovery playbook entry.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | e.g. `"Immediate apology + complimentary upgrade"` |
| `actionType` | string | No | `"apology"`, `"compensation"`, `"explanation"`, `"upgrade"`, `"combination"` |
| `description` | string | No | Fuller description of the recovery action |
| `leadsToLoyalty` | boolean | No | `true` if the expert says this recovery action typically creates loyalty |
| `commonMistake` | string | No | The mistake newer operators make instead of this action |

**ID convention:** `recovery:{name-slug}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges in:** `resolvedBy ← ServiceFailure`  
**Edges out:** `recoveryLeadsTo → Outcome`

---

#### `ExceptionRule`
A deliberate exception to a standard policy — a decision the expert makes to break their own rule for a specific guest or circumstance. Often the source of the most durable loyalty stories.

| Property | Type | Required | Notes |
|---|---|---|---|
| `ruleText` | string | **Yes** | Description of the exception and when it applies |
| `triggerCondition` | string | No | What situation triggers this exception |
| `paidOff` | boolean | No | `true` if the expert says making this exception created loyalty or revenue |
| `guestSegment` | string | No | Which guest type this exception is typically made for |
| `frequency` | string | No | How often this exception is made |

**ID convention:** `exception:{trigger-condition-slug}:{sequence}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges out:** `exceptionAppliesTo → DecisionRule`, `exceptionMadeFor → GuestPersona`

---

### Layer 5 — Loyalty & Psychology

#### `LoyaltyDriver`
A factor that drives genuine guest loyalty — repeat visits, advocacy, or emotional connection. Distinguished from satisfaction: a guest can be satisfied and not loyal. These are the deeper drivers.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | e.g. `"Being remembered by name on return visit"` |
| `description` | string | No | Fuller explanation |
| `driverType` | string | No | `"emotional"`, `"functional"`, `"relational"`, `"experiential"` |
| `turnsAdvocate` | boolean | No | `true` if this driver turns guests into active advocates |
| `destroysTrust` | boolean | No | `true` if this is actually a trust-destruction factor (negative loyalty) |

**ID convention:** `loyalty:{name-slug}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges in:** `shapesLoyalty ← EmotionalMoment`  
**Edges out:** `drivenBy → GuestPersona`, `loyaltyLeadsTo → Outcome`

---

#### `EmotionalMoment`
A specific gesture, moment, or micro-interaction that shapes loyalty — the "small thing with outsized impact." These are concrete instances that map to a loyalty driver.

| Property | Type | Required | Notes |
|---|---|---|---|
| `name` | string | **Yes** | e.g. `"Remembering guest's coffee order from previous stay"` |
| `description` | string | No | Fuller account |
| `momentType` | string | No | `"gesture"`, `"recognition"`, `"recovery"`, `"personalisation"`, `"surprise"` |
| `gestureScale` | string | No | `"micro"`, `"small"`, `"medium"` — most powerful moments are micro |
| `outsizedImpact` | boolean | No | `true` if the expert explicitly says this had disproportionate impact |

**ID convention:** `moment:{name-slug}:{sequence}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges out:** `shapesLoyalty → LoyaltyDriver`

---

### Layer 6 — Context & Outcomes

#### `ContextualConstraint`
A real-world constraint that modifies how the expert applies rules or policies — seasonality, location, customer mix, staffing. These are the modulating factors that explain why the expert sometimes breaks their own rules.

| Property | Type | Required | Notes |
|---|---|---|---|
| `constraintType` | string | No | `"seasonal"`, `"locational"`, `"staffing"`, `"customer-mix"`, `"operational"` |
| `seasonality` | string | No | e.g. `"peak season"`, `"low season"`, `"holiday period"` |
| `location` | string | No | Geographic or property-type factor |
| `staffingFactor` | string | No | Staffing level or skills gap affecting delivery |
| `customerMix` | string | No | Guest mix characteristic (e.g. `"70% business travellers"`) |
| `operationalBottleneck` | string | No | The specific operational constraint |

**ID convention:** `constraint:{context-slug}:{sequence}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges out:** `modulatedBy → DecisionRule`, `constraintAffectsPolicy → CheckInPolicy` (or `CheckOutPolicy`)

---

#### `Outcome`
The result of a decision, recovery action, loyalty driver, or contextual override — whether positive (guest retained, loyalty achieved, revenue impact) or negative (trust lost, complaint escalated). Outcomes make the graph's causal chains complete.

| Property | Type | Required | Notes |
|---|---|---|---|
| `outcomeType` | string | No | `"loyalty_achieved"`, `"guest_retained"`, `"trust_lost"`, `"revenue_impact"`, `"system_insight"` |
| `description` | string | No | Fuller description |
| `guestRetained` | boolean | No | |
| `loyaltyAchieved` | boolean | No | |
| `revenueImpact` | string | No | e.g. `"positive"`, `"negative"`, `"neutral"` |

**ID convention:** `outcome:{type-slug}:{sequence}`  
**Provenance edge:** `supportedBy → ProvenanceEvidence`  
**Edges in:** `leadsTo ← DecisionRule`, `recoveryLeadsTo ← RecoveryAction`, `loyaltyLeadsTo ← LoyaltyDriver`

---

## Edge Reference

### Session Infrastructure Edges

| Edge | Out → In | Description |
|---|---|---|
| `hasSession` | `Person → KnowledgeSession` | Links expert to their session |
| `hasSection` | `KnowledgeSession → SessionSection` | Session broken into 7 sections |
| `hasEpisode` | `SessionSection → TranscriptEpisode` | Each section contains multiple turns |

### Transcript → Knowledge Edges (Extraction Links)

| Edge | Out → In | Description |
|---|---|---|
| `discusses` | `TranscriptEpisode → GuestExperiencePrinciple` | Episode discusses a core principle |
| `discussesRule` | `TranscriptEpisode → DecisionRule` | Episode contains a decision rule |
| `discussesHeuristic` | `TranscriptEpisode → OperatingHeuristic` | Episode contains a heuristic |
| `discussesFailure` | `TranscriptEpisode → ServiceFailure` | Episode describes a service failure |

### Principles & Standards Edges

| Edge | Out → In | Description |
|---|---|---|
| `appliesToPersona` | `GuestExperiencePrinciple → GuestPersona` | Principle targets this guest type |
| `standardEnforces` | `ServiceStandard → GuestExperiencePrinciple` | Standard is the operational form of the principle |
| `signalIndicates` | `GuestSignal → GuestPersona` | Signal identifies this guest type |
| `signalTriggers` | `GuestSignal → DecisionRule` | Signal fires this decision rule |

### Policy Edges

| Edge | Out → In | Description |
|---|---|---|
| `governs` | `CheckInPolicy → TimingRule` | Policy governs this timing rule |
| `governsCheckOut` | `CheckOutPolicy → TimingRule` | Checkout policy governs this timing rule |
| `constraintAffectsPolicy` | `ContextualConstraint → CheckInPolicy` (or `CheckOutPolicy`) | Context modifies the policy |

### Operational Knowledge Edges

| Edge | Out → In | Description |
|---|---|---|
| `resolvedBy` | `ServiceFailure → RecoveryAction` | Failure is addressed by this recovery |
| `exceptionAppliesTo` | `ExceptionRule → DecisionRule` | Exception overrides this rule |
| `exceptionMadeFor` | `ExceptionRule → GuestPersona` | Exception was made for this guest type |
| `heuristicExplains` | `OperatingHeuristic → DecisionRule` | Heuristic is the tacit rationale for the rule |
| `modulatedBy` | `ContextualConstraint → DecisionRule` | Context changes how this rule is applied |

### Causal / Outcome Edges

| Edge | Out → In | Description |
|---|---|---|
| `leadsTo` | `DecisionRule → Outcome` | Rule produces this outcome |
| `recoveryLeadsTo` | `RecoveryAction → Outcome` | Recovery action produces this outcome |
| `loyaltyLeadsTo` | `LoyaltyDriver → Outcome` | Loyalty driver produces this outcome |

### Loyalty & Psychology Edges

| Edge | Out → In | Description |
|---|---|---|
| `shapesLoyalty` | `EmotionalMoment → LoyaltyDriver` | Moment creates or reinforces this loyalty driver |
| `drivenBy` | `LoyaltyDriver → GuestPersona` | This driver is especially powerful for this persona |

### Provenance Edges

| Edge | Out → In | Applies to |
|---|---|---|
| `principleSupportedBy` | `GuestExperiencePrinciple → ProvenanceEvidence` | Principles only |
| `heuristicSupportedBy` | `OperatingHeuristic` or `TimingRule → ProvenanceEvidence` | Tacit / experience-refined knowledge |
| `supportedBy` | Any other knowledge vertex `→ ProvenanceEvidence` | All remaining knowledge vertex types |

---

## Key Graph Patterns

### Pattern 1 — The Principle → Standard → Decision Chain
How the expert's beliefs manifest as operational rules:
```
GuestExperiencePrinciple
  ──standardEnforces── ServiceStandard
  ──appliesToPersona── GuestPersona
  ──principleSupportedBy── ProvenanceEvidence
```

### Pattern 2 — The Signal → Rule → Outcome Chain
How the expert recognises a situation and responds:
```
GuestSignal
  ──signalIndicates── GuestPersona
  ──signalTriggers──> DecisionRule ──leadsTo──> Outcome
                        ──supportedBy──> ProvenanceEvidence
```

### Pattern 3 — The Failure → Recovery → Loyalty Chain
How service failures become loyalty moments:
```
ServiceFailure
  ──resolvedBy──> RecoveryAction ──recoveryLeadsTo──> Outcome
                                                        (loyaltyAchieved=true)
ExceptionRule
  ──exceptionMadeFor──> GuestPersona
  ──exceptionAppliesTo──> DecisionRule
```

### Pattern 4 — The Emotional Moment → Loyalty → Advocacy Chain
How micro-gestures drive repeat business:
```
EmotionalMoment
  ──shapesLoyalty──> LoyaltyDriver
                       ──drivenBy──> GuestPersona
                       ──loyaltyLeadsTo──> Outcome (turnsAdvocate=true)
```

### Pattern 5 — The Context Modulation Pattern
How constraints explain why the same expert makes different decisions in different conditions:
```
ContextualConstraint
  ──modulatedBy──> DecisionRule   (modifies how the rule is applied)
  ──constraintAffectsPolicy──> CheckInPolicy   (modifies the singleton policy)
```

---

## ID Conventions Summary

| Vertex Type | ID Pattern | Example |
|---|---|---|
| `Person` | `person:{name-slug}` | `person:arjun-mehta` |
| `KnowledgeSession` | `session:hospitality:{YYYY-MM-DD}` | `session:hospitality:2026-06-18` |
| `SessionSection` | `section:{session_id}:{order}` | `section:session:hospitality:2026-06-18:2` |
| `TranscriptEpisode` | `ep:{session_id}:{sequence}` | `ep:session:hospitality:2026-06-18:14` |
| `ProvenanceEvidence` | `prov:{episode_id}:{sequence}` | `prov:ep:session:hospitality:2026-06-18:14:01` |
| `GuestExperiencePrinciple` | `principle:{name-slug}` | `principle:first-impressions-are-permanent` |
| `ServiceStandard` | `standard:{name-slug}` | `standard:welcome-drink-within-3min` |
| `GuestSignal` | `signal:{name-slug}` | `signal:guest-lingers-at-reception` |
| `GuestPersona` | `persona:{name-slug}` | `persona:repeat-guest` |
| `CheckInPolicy` | `policy:checkin:{session_id}` | `policy:checkin:session:hospitality:2026-06-18` |
| `CheckOutPolicy` | `policy:checkout:{session_id}` | `policy:checkout:session:hospitality:2026-06-18` |
| `TimingRule` | `timing:{rule-type-slug}:{sequence}` | `timing:early-checkin:01` |
| `DecisionRule` | `rule:{if-condition-slug}` | `rule:guest-arrives-early-room-ready` |
| `OperatingHeuristic` | `heuristic:{name-slug}` | `heuristic:experienced-operators-bend-policy` |
| `ServiceFailure` | `failure:{name-slug}` | `failure:room-not-ready-at-checkin` |
| `RecoveryAction` | `recovery:{name-slug}` | `recovery:apology-plus-upgrade` |
| `ExceptionRule` | `exception:{trigger-slug}:{sequence}` | `exception:early-arrival-room-ready:01` |
| `LoyaltyDriver` | `loyalty:{name-slug}` | `loyalty:remembered-by-name-on-return` |
| `EmotionalMoment` | `moment:{name-slug}:{sequence}` | `moment:remembered-coffee-order:01` |
| `ContextualConstraint` | `constraint:{context-slug}:{sequence}` | `constraint:peak-season:01` |
| `Outcome` | `outcome:{type-slug}:{sequence}` | `outcome:loyalty-achieved:03` |

---

## Section-to-Vertex Mapping

| Section | ID | Primary Vertices Created | Key Edges |
|---|---|---|---|
| Introduction | A | `Person`, `KnowledgeSession`, `SessionSection`, `TranscriptEpisode` | `hasSession`, `hasSection`, `hasEpisode` |
| Guest Experience Principles | B | `GuestExperiencePrinciple`, `ServiceStandard`, `GuestSignal`, `GuestPersona` | `discusses`, `appliesToPersona`, `standardEnforces`, `signalIndicates`, `principleSupportedBy` |
| Arrival, Check-In & Timing | C | `CheckInPolicy` *(singleton)*, `CheckOutPolicy` *(singleton)*, `TimingRule`, `DecisionRule` | `governs`, `governsCheckOut`, `signalTriggers`, `discussesRule`, `heuristicSupportedBy` |
| Service Recovery & Flexibility | D | `ServiceFailure`, `RecoveryAction`, `ExceptionRule`, `DecisionRule`, `Outcome` | `resolvedBy`, `recoveryLeadsTo`, `exceptionAppliesTo`, `exceptionMadeFor`, `leadsTo` |
| Operating Heuristics & Decision Rules | E | `OperatingHeuristic`, `DecisionRule`, `GuestSignal` *(reuse)*, `GuestPersona` *(reuse)*, `Outcome` | `discussesHeuristic`, `heuristicExplains`, `heuristicSupportedBy`, `signalTriggers`, `leadsTo` |
| Customer Psychology & Loyalty | F | `LoyaltyDriver`, `EmotionalMoment`, `GuestPersona` *(reuse)*, `Outcome` | `shapesLoyalty`, `drivenBy`, `loyaltyLeadsTo`, `appliesToPersona`, `principleSupportedBy` |
| Context, Business Model & System Factors | G | `ContextualConstraint`, `DecisionRule` *(enrichment)*, `Outcome` | `modulatedBy`, `constraintAffectsPolicy`, `leadsTo` |

---

## What Is Deliberately NOT in the Schema

- **Staff identities or HR data.** Not in scope; privacy risk.
- **Pricing, rates, or revenue figures.** Commercially sensitive; not extractable from expert interview.
- **Booking system or PMS data.** Operational data, not tacit expert knowledge.
- **Review text or third-party ratings.** External sources — not what this graph captures.
- **Specific guest identities.** Privacy; the graph uses `GuestPersona` types, not individuals.
- **Pharmacological or medical detail.** Not relevant to hospitality domain.

---

## Escape Hatch: Concepts That Don't Fit

If the extractor encounters expert knowledge that genuinely does not fit any vertex label in the schema, it should **not** invent a new label. Instead, use this pattern (cross-reference from the medical domain's `Comment` pattern):

1. Note the unclassifiable knowledge in the session audit log with the tag `SCHEMA_GAP`.
2. If a downstream schema version is planned, propose the new vertex type there.
3. Optionally, store a free-text `description` property on the nearest applicable vertex with a `[SCHEMA_GAP]` prefix.

---

## Files in This Bundle

| File | Purpose |
|---|---|
| `schema-hospitality.json` | **Source of truth.** All vertex/edge type declarations. |
| `section-map.json` | Maps prompt sections A–G to vertex types, edge patterns, and ID conventions. |
| `provenance-spec.json` | Full provenance rules, confidence levels, tacit knowledge patterns. |
| `validation_rules.json` | 17 validation rules (delta + session-close, hard/soft/advisory). |
| `documentation.md` | **This file.** Human-readable reference. Not loaded by any code. |

---

*This document is a point-in-time snapshot. If it conflicts with `schema-hospitality.json`, the JSON is authoritative.*
