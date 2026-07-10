# Headache-domain schema

Hand-written walkthrough of the medical (headache) domain's typed
property-graph schema, **for human consumption only**.

`src/main/json/medical.json` is the single source of truth for the
schema. It is authored as Python in
`src/main/python/chatgraph/domains/medical/schema_build.py` and emitted
to the JSON by the `chatgraph-build-schema medical` CLI; the JSON is what
the runtime loads, and the extractor's prompt schema-reference and
tool-spec are generated from it programmatically (no LLM in that step).

This document is loaded by **no** code -- it is a prose companion to help
a reader understand the clinical model, nothing more. It can lag behind
the JSON; if the two disagree, the JSON wins. Do not treat anything here
as authoritative, and do not rely on it staying in lockstep with the
schema (the vertex/edge counts just below, in particular, are a
point-in-time snapshot).

**77 vertex types, 158 edge types.**

This is a clinical model. The vertex/edge structure reflects how a
headache specialist actually thinks about the domain.

## Conventions

- Vertex labels are **PascalCase**.
- Edge labels are **camelCase**.
- We avoid union-typed edges, since TinkerPop's `EdgeType` pins one
  in-label per edge label. The only exception is `Concept`, which exists
  solely as a reification indirection for the open-world `Comment`
  escape hatch.

## Top-level shape

```
Person ──reports──> Headache (pattern, e.g. "daily" or "acute")
      └──hasFamilyHistory──> FamilyHistory
      └──hasComorbidity──> Comorbidity
      └──hasDiagnosis──> Diagnosis
      └──hasMenstrualRelationship──> MenstrualRelationship
```

A `Person` is the root of one patient's data. They `report` one or more
`Headache` patterns. Most clinically interesting attributes hang off a
Headache pattern, not the Person.

## Headache pattern: properties

- `description` — short patient-given label ("daily", "acute")
- `chronicity` — `episodic` | `chronic` (chronic = >=15 headache days/month, >3 months)
- `currentTrend` — `improving` | `stable` | `worsening` | `chronified`

## Phases of an attack

A single Headache pattern can have up to four phases, each as a
separate vertex:

- **`Prodrome`** (hours-to-a-day before pain) — `typicalHoursBeforePain` property
- **`Aura`** (5-60 min before/overlapping pain) — `openEye`, `closedEye`, `monocular`, `typicalMinutes`, `overlapsWithPain`
- **`PainCharacter`** — the pain-phase metadata that isn't simple quality: `worseWithRoutineActivity`, `worseAtNight`, `worseOnWaking`, `wakesFromSleep`, `worseBendingForward`, `positional`, `progressivelyWorseWithinEpisode`
- **`Postdrome`** ("migraine hangover") — `typicalHoursAfterPain` property

The pain-phase symptoms attach directly to `Headache` (not to a separate
PainPhase vertex) since pain is the canonical phase.

## Concrete-symptom vertex types

No union types. Each clinically distinct symptom is its own vertex type
with a dedicated `hasX` edge from `Headache`.

**Pain-phase symptoms** (`Headache --hasX-->`):

`Nausea`, `Vomiting`, `LightSensitivity` (photophobia),
`SoundSensitivity` (phonophobia), `SmellSensitivity` (osmophobia),
`Dizziness`, `Vertigo`, `NeckStiffness`, `NeckPain`, `ScalpTenderness`,
`JawTenderness`.

**Autonomic / TAC features** (`Headache --hasX-->`):

`ConjunctivalInjection` (red watery eye), `Lacrimation`,
`NasalCongestion`, `Rhinorrhea`, `EyelidEdema`, `FacialSweating`,
`Ptosis`, `Miosis`, `Restlessness`, `EarFullness`.

These suggest a TAC (cluster, paroxysmal hemicrania, etc.) when
unilateral and co-occurring with pain.

**Aura subtypes** (`Aura --hasX-->`):

`VisualAura`, `SensoryAura` (tingling/numbness), `SpeechAura` (dysphasia),
`MotorAura` (weakness — hemiplegic), `BrainstemAura` (vertigo, dysarthria,
ataxia), `RetinalAura` (monocular).

`VisualAura` is the one aura subtype that carries its own properties,
describing what the patient actually sees: `pattern` (free text —
"zigzag", "fortification spectra", "crescent"), `colors` ("rainbow",
"white"), and the booleans `scintillating` (flashing/shimmering),
`photopsia` (flashes of light), `scotoma` (blind spot), `fortification`
(zigzag spectra), plus `positiveNegative` and a free-text `note`. The
other subtypes are bare-label presence markers.

**Prodromal symptoms** (`Prodrome --hasX-->`):

`Fatigue`, `MoodChange`, `CognitiveSlowness`, `FoodCraving`, `Yawning`,
`FluidRetention`, `UrinaryFrequency`.

**Postdromal symptoms** (`Postdrome --postdromalX-->`):

`postdromalFatigue`, `postdromalMoodChange`, `postdromalCognitiveSlowness`,
`postdromalScalpTenderness` — these reuse the bare vertex types from the
prodrome catalogue with phase-distinct edge labels.

## Triggers and AlleviatingFactors (reified)

To avoid union-typed edges *and* keep the cause/aggravation distinction:

```
Headache ──triggers────────> HeadacheTriggers ──ingested──────> IngestedTrigger { value }
         ──aggravatedBy────>                 ──sensory───────> SensoryTrigger { value }
                                              ──physiological─> PhysiologicalTrigger { value }
                                              ──environmental─> EnvironmentalTrigger { value }
                                              ──hormonal─────> HormonalTrigger { value }

Headache ──relievedBy─────> AlleviatingFactors ──behavioralRelief─────> BehavioralRelief { value }
                                                ──physicalRelief──────> PhysicalRelief { value }
                                                ──pharmacologicalRelief> PharmacologicalRelief { value }
                                                ──environmentalRelief─> EnvironmentalRelief { value }
```

The bucket vertex holds no information — it's a typed indirection so the
schema can pin every edge's `(out, in)` labels. The concrete
category-typed trigger/relief vertices carry the actual `value` (e.g.
`"caffeine"`, `"fluorescent lights"`, `"dark quiet room"`).

`triggers` and `aggravatedBy` share the `HeadacheTriggers` target shape;
the distinction is at the edge level (cause vs aggravation).

## Pain location, quality, severity, laterality, frequency, duration

These keep a single vertex type with a `value` property — the
vocabulary is large enough that promoting each value to its own type
would explode the schema.

- `BodyLocation { value }`
- `Quality { value }` (throbbing, pressing, stabbing, ...)
- `Severity { value, scale, minScale, maxScale }` — supports both a
  point estimate and a range
- `Laterality { value, alternatesSides }`
- `Frequency { value, count, per, certainty }`
- `Duration { value, count, unit, untreated }`

## Time

- `hasOnset: Headache → Age` — when this headache *type* first occurred for the patient
- `emergedAt: Headache → Age` — when this specific pattern emerged (may be later than `hasOnset` if a new pattern developed)
- `evolvedFrom: Headache → Headache` — captures e.g. "the episodic pattern became chronic" with `atAge` property

`Age` is a single vertex type with `value` (natural language) and `age`
(numeric years).

## Inter-Headache relationships

- `escalatesTo: Headache → Headache` with optional `via` property — captures e.g. "the daily becomes acute when fluorescent lights set me off."
- `evolvedFrom: Headache → Headache` with `atAge` — captures pattern evolution over time.

## Red flags (SNOOP10-style)

Each patient-reportable red flag is its own vertex type. The Headache
gets a `hasRedFlagX` edge if any are present.

`ThunderclapOnset`, `WorseWithValsalva`, `PositionalHeadache`,
`ProgressivelyWorse`, `WakesFromSleep`, `NewAfterFifty`, `Fever`,
`WeightLoss`, `FocalNeurologicalDeficit`, `VisionChange`, `Confusion`.

Clinically: any of these warrants further investigation for a secondary
cause.

## Person-level attributes

- **`FamilyHistory { relation, condition }`** — `relation` is e.g.
  "mother", `condition` is the headache type. One vertex per relative
  with a notable headache history.
- **`Comorbidity { condition, note }`** — non-headache conditions the
  patient mentions (anxiety, IBS, etc.).
- **`Diagnosis { value, diagnosedBy, year }`** — prior clinician-given
  diagnoses.
- **`MenstrualRelationship { menstrualAssociated, perimenstrual,
  pregnancyChange, contraceptiveChange, note }`** — structure is
  present; the agent does NOT proactively ask about this. Captured only
  if the patient volunteers.

## Functional impact

`FunctionalImpact { missedDaysPerMonth, disabilityLevel, bedRequired,
erVisitsPerYear, affectsWork }` — lightly inspired by HIT-6/MIDAS.
Attached to a Headache via `hasImpact`.

## Classification

`HeadacheClassification { primarySecondary, family, subtype, value,
confidence }` — ICHD-3 axes captured as properties on one vertex.
Attached via `classifiedAs`.

- `primarySecondary`: `primary` | `secondary` | `painfulCranialNeuropathy`
- `family`: `migraine` | `tensionType` | `cluster` | `paroxysmalHemicrania` | `hemicraniaContinua` | `suncT` | `medicationOveruse` | `newDailyPersistent` | `trigeminalNeuralgia` | `other`
- `subtype`: `withAura` | `withoutAura` | `chronic` | `episodic` | …
- `confidence`: `patientReported` | `suspected` | `confirmed`

## Comment / Concept (escape hatch)

The one allowed union pattern, justified by needing an "any-vertex"
target for the open-world Comment.

```
Comment { description, kind: "patient" | "operator" }
   ──mentions───> Concept { label, note }
   ──about──────> Concept
                  └──conceptHeadache────> Headache
                  └──conceptLaterality──> Laterality
                  └──concept{LabelName}─> {LabelName}    (one edge per vocab label)
```

Use a `Comment` only when nothing else fits. `kind="patient"` for
patient utterances the schema couldn't capture; `kind="operator"` for
demo-operator meta-comments about schema gaps.

## What the agent will and won't ask about

The agent's system prompt explicitly avoids asking about:
- Age, gender
- Medications (any)
- Menstrual / hormonal cycles unless the patient volunteers

Beyond that, the agent has a clinical narrative covering: pattern names,
location & laterality, pain quality and character, severity (with
ranges), frequency, duration, onset & evolution, all four phases of an
attack with their phase-specific symptoms, autonomic features, triggers
(causal) and aggravators (worsening), alleviating factors, inter-pattern
relationships, functional impact, red flags, classification cues, family
history, comorbidities, prior diagnoses.

## Things deliberately NOT in the schema

- **Pharmacological treatments and medication doses.** Privacy.
- **Specific dates or appointments.** PHI we don't want.
- **Imaging results / labs / vital signs.** Not patient-reportable.
- **Vendor-specific clinical scales** (PHQ-9, GAD-7, etc.). Too rigid for
  a conversational interview.
