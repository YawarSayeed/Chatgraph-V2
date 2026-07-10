"""Author the medical (headache) domain GraphSchema and write it to JSON.

Offline schema-authoring step. Run via::

    chatgraph-build-schema medical

Output: ``src/main/json/medical.json`` at the project root.

Role: this module is a *convenience authoring tool*, not a runtime
dependency. Its only job is to produce ``medical.json`` ergonomically --
expressing the schema as readable Python (helpers, shared constants,
loops over symptom lists) instead of hand-writing a large JSON file. The
runtime never imports it; ``medical.json`` is the single source of truth
that the application loads (see the "Schema: one source of truth" section
in ``CLAUDE.md``). Consequently this file is disposable: once the schema
is finalized and we no longer expect to modify it, ``schema_build.py``
could be dropped entirely and the committed JSON would stand on its own.
Until then it is the editing surface -- change the schema here and
regenerate, never hand-edit the JSON.

Design notes
------------

This is a clinical model. The structure mirrors how a headache specialist
reasons:

* **Person** roots the graph and carries cross-headache attributes:
  family history, comorbidities, prior diagnoses.
* **Headache** is a named *pattern* (e.g. "daily", "acute"), not a
  single episode. Most clinically interesting attributes hang off a
  Headache pattern.
* **Phases of a headache attack** -- prodrome, aura, pain, postdrome --
  are captured as separate vertex types attached to a Headache, each
  with their own symptom edges. This separation matters clinically
  (e.g. nausea during the prodrome vs during the pain phase carries
  different significance).
* **Concrete-symptom vertex types** rather than a polymorphic Symptom
  union, because TinkerPop's ``EdgeType`` pins one in-label per edge
  label. Each clinically distinct symptom is its own vertex type with
  a dedicated ``hasX`` edge.
* **Reification buckets** for groupings whose contents are categorised:
  ``HeadacheTriggers`` (with edges by category to typed Trigger types),
  ``AlleviatingFactors`` (same shape). ``triggers`` and ``aggravatedBy``
  both target ``HeadacheTriggers``; the edge label tells you which.
* **Red flags** (SNOOP10) are first-class. Specific concerning features
  the patient can report (thunderclap onset, positional pain, woke them
  from sleep, etc.) have dedicated vertex types so a clinician scanning
  the graph can see them at a glance.
* **Concept** remains the one allowed reification union, only because
  the open-world ``Comment`` escape hatch needs an "any-vertex" target.

Naming conventions:
* Vertex labels are PascalCase.
* Edge labels are camelCase.

Requires ``HYDRAPOP_HOME`` to be set.
"""

import json
import sys
from pathlib import Path

import chatgraph  # noqa: F401  -- triggers HydraPop bootstrap

from hydrapop.dsl.pg import edge_type, graph_schema, int32, string, vertex_type
from hydrapop.encode import encode_graph_schema


# =====================================================================
# VERTEX LABELS
# =====================================================================

# --- Root ---
PERSON = "Person"

# --- Headache pattern + classification ---
HEADACHE = "Headache"
HEADACHE_CLASSIFICATION = "HeadacheClassification"

# --- Phases of a headache attack ---
PRODROME = "Prodrome"          # the "coming on" phase, hours to a day before pain
AURA = "Aura"                  # the 5-60 minute neurological phase
POSTDROME = "Postdrome"        # the "migraine hangover" after pain

# --- Concrete pain-phase symptoms (label IS the value, no properties) ---
NAUSEA = "Nausea"
VOMITING = "Vomiting"
LIGHT_SENSITIVITY = "LightSensitivity"          # photophobia
SOUND_SENSITIVITY = "SoundSensitivity"          # phonophobia
SMELL_SENSITIVITY = "SmellSensitivity"          # osmophobia
DIZZINESS = "Dizziness"
VERTIGO = "Vertigo"
NECK_STIFFNESS = "NeckStiffness"
NECK_PAIN = "NeckPain"
SCALP_TENDERNESS = "ScalpTenderness"
JAW_TENDERNESS = "JawTenderness"

# --- Concrete autonomic / TAC features (cluster, hemicrania continua, ...) ---
CONJUNCTIVAL_INJECTION = "ConjunctivalInjection"   # red watery eye on the painful side
LACRIMATION = "Lacrimation"                         # tearing
NASAL_CONGESTION = "NasalCongestion"
RHINORRHEA = "Rhinorrhea"                           # runny nose
EYELID_EDEMA = "EyelidEdema"
FACIAL_SWEATING = "FacialSweating"
PTOSIS = "Ptosis"                                   # drooping eyelid
MIOSIS = "Miosis"                                   # constricted pupil
RESTLESSNESS = "Restlessness"                       # cluster patients can't sit still
EAR_FULLNESS = "EarFullness"

# --- Aura-specific neurological features ---
VISUAL_AURA = "VisualAura"
SENSORY_AURA = "SensoryAura"                        # tingling / numbness
SPEECH_AURA = "SpeechAura"                          # dysphasic
MOTOR_AURA = "MotorAura"                            # weakness (hemiplegic migraine)
BRAINSTEM_AURA = "BrainstemAura"                    # vertigo, dysarthria, ataxia
RETINAL_AURA = "RetinalAura"                        # monocular

# --- Prodromal-phase non-pain symptoms ---
FATIGUE = "Fatigue"
MOOD_CHANGE = "MoodChange"
COGNITIVE_SLOWNESS = "CognitiveSlowness"            # "brain fog"
FOOD_CRAVING = "FoodCraving"
YAWNING = "Yawning"
FLUID_RETENTION = "FluidRetention"
URINARY_FREQUENCY = "UrinaryFrequency"

# --- Red-flag features (patient-reportable subset of SNOOP10) ---
THUNDERCLAP_ONSET = "ThunderclapOnset"              # peak in seconds
WORSE_WITH_VALSALVA = "WorseWithValsalva"           # cough / sneeze / strain
POSITIONAL_HEADACHE = "PositionalHeadache"
PROGRESSIVELY_WORSE = "ProgressivelyWorse"
WAKES_FROM_SLEEP = "WakesFromSleep"
NEW_AFTER_FIFTY = "NewAfterFifty"
FEVER = "Fever"
WEIGHT_LOSS = "WeightLoss"
FOCAL_NEUROLOGICAL_DEFICIT = "FocalNeurologicalDeficit"
VISION_CHANGE = "VisionChange"
CONFUSION = "Confusion"

# --- Trigger reification ---
HEADACHE_TRIGGERS = "HeadacheTriggers"
INGESTED_TRIGGER = "IngestedTrigger"
SENSORY_TRIGGER = "SensoryTrigger"
PHYSIOLOGICAL_TRIGGER = "PhysiologicalTrigger"
ENVIRONMENTAL_TRIGGER = "EnvironmentalTrigger"
HORMONAL_TRIGGER = "HormonalTrigger"                # menstrual, ovulation, pregnancy

TRIGGER_CATEGORIES = (
    (INGESTED_TRIGGER, "ingested"),
    (SENSORY_TRIGGER, "sensory"),
    (PHYSIOLOGICAL_TRIGGER, "physiological"),
    (ENVIRONMENTAL_TRIGGER, "environmental"),
    (HORMONAL_TRIGGER, "hormonal"),
)

# --- Alleviating-factor reification (mirrors HeadacheTriggers) ---
ALLEVIATING_FACTORS = "AlleviatingFactors"
BEHAVIORAL_RELIEF = "BehavioralRelief"
PHYSICAL_RELIEF = "PhysicalRelief"
PHARMACOLOGICAL_RELIEF = "PharmacologicalRelief"
ENVIRONMENTAL_RELIEF = "EnvironmentalRelief"

RELIEF_CATEGORIES = (
    (BEHAVIORAL_RELIEF, "behavioralRelief"),
    (PHYSICAL_RELIEF, "physicalRelief"),
    (PHARMACOLOGICAL_RELIEF, "pharmacologicalRelief"),
    (ENVIRONMENTAL_RELIEF, "environmentalRelief"),
)

# --- Pain characteristics that aren't simple quality ---
PAIN_CHARACTER = "PainCharacter"

# --- Other Headache-attached vocabulary ---
BODY_LOCATION = "BodyLocation"
QUALITY = "Quality"
SEVERITY = "Severity"
LATERALITY = "Laterality"
FREQUENCY = "Frequency"
DURATION = "Duration"
AGE = "Age"
FUNCTIONAL_IMPACT = "FunctionalImpact"

# --- Person-level attributes ---
FAMILY_HISTORY = "FamilyHistory"
COMORBIDITY = "Comorbidity"
DIAGNOSIS = "Diagnosis"
MENSTRUAL_RELATIONSHIP = "MenstrualRelationship"

# --- Open-world escape hatch + reification indirection ---
COMMENT = "Comment"
CONCEPT = "Concept"


# Concrete bare-symptom vertex types (no payload; the label is the value).
# Used both for pain-phase symptoms and for cross-phase concrete things
# like fatigue.
BARE_PAIN_SYMPTOMS = (
    NAUSEA, VOMITING,
    LIGHT_SENSITIVITY, SOUND_SENSITIVITY, SMELL_SENSITIVITY,
    DIZZINESS, VERTIGO,
    NECK_STIFFNESS, NECK_PAIN,
    SCALP_TENDERNESS, JAW_TENDERNESS,
)
BARE_AUTONOMIC_FEATURES = (
    CONJUNCTIVAL_INJECTION, LACRIMATION, NASAL_CONGESTION, RHINORRHEA,
    EYELID_EDEMA, FACIAL_SWEATING, PTOSIS, MIOSIS, RESTLESSNESS, EAR_FULLNESS,
)
# VisualAura is NOT bare-label: it carries appearance properties
# (see the visual_aura vertex_type in build_schema). The other aura
# subtypes remain bare-label presence markers.
BARE_AURA_TYPES = (
    SENSORY_AURA, SPEECH_AURA, MOTOR_AURA, BRAINSTEM_AURA,
    RETINAL_AURA,
)
BARE_PRODROMAL_SYMPTOMS = (
    FATIGUE, MOOD_CHANGE, COGNITIVE_SLOWNESS, FOOD_CRAVING, YAWNING,
    FLUID_RETENTION, URINARY_FREQUENCY,
)
BARE_RED_FLAGS = (
    THUNDERCLAP_ONSET, WORSE_WITH_VALSALVA, POSITIONAL_HEADACHE,
    PROGRESSIVELY_WORSE, WAKES_FROM_SLEEP, NEW_AFTER_FIFTY,
    FEVER, WEIGHT_LOSS, FOCAL_NEUROLOGICAL_DEFICIT, VISION_CHANGE, CONFUSION,
)


# Vocabulary labels a Concept can reify (everything except Concept itself,
# Comment, and the reification buckets).
VOCABULARY_LABELS = (
    HEADACHE, HEADACHE_CLASSIFICATION,
    PRODROME, AURA, POSTDROME,
    *BARE_PAIN_SYMPTOMS,
    *BARE_AUTONOMIC_FEATURES,
    # VisualAura was moved out of BARE_AURA_TYPES (it now carries
    # appearance properties) but is still a reifiable concept, so list
    # it explicitly here -- same as other propertied vocab (Quality, etc).
    VISUAL_AURA,
    *BARE_AURA_TYPES,
    *BARE_PRODROMAL_SYMPTOMS,
    *BARE_RED_FLAGS,
    HEADACHE_TRIGGERS,
    INGESTED_TRIGGER, SENSORY_TRIGGER, PHYSIOLOGICAL_TRIGGER,
    ENVIRONMENTAL_TRIGGER, HORMONAL_TRIGGER,
    ALLEVIATING_FACTORS,
    BEHAVIORAL_RELIEF, PHYSICAL_RELIEF,
    PHARMACOLOGICAL_RELIEF, ENVIRONMENTAL_RELIEF,
    PAIN_CHARACTER,
    BODY_LOCATION, QUALITY, SEVERITY, LATERALITY, FREQUENCY, DURATION, AGE,
    FUNCTIONAL_IMPACT,
    FAMILY_HISTORY, COMORBIDITY, DIAGNOSIS, MENSTRUAL_RELATIONSHIP,
)


def _boolean_type():
    """Build a Hydra boolean LiteralType. ``hydrapop.dsl.pg`` may not
    export a ``boolean_type`` helper in all versions; fall back to
    ``hydra.core`` if needed."""
    try:
        from hydrapop.dsl.pg import boolean_type  # type: ignore[attr-defined]
        return boolean_type()
    except ImportError:
        import hydra.core as core
        return core.LiteralTypeBoolean()


def build_schema():
    s = string()
    i = int32()
    b = _boolean_type()

    # -----------------------------------------------------------------
    # VERTEX TYPES
    # -----------------------------------------------------------------

    # --- Root ---
    person = (
        vertex_type(PERSON, s)
        .property("name", s, False)
        .build()
    )

    # --- Headache pattern ---
    headache = (
        vertex_type(HEADACHE, s)
        # short label the patient uses ("daily", "acute", "morning")
        .property("description", s, False)
        # episodic | chronic; chronic = >= 15 headache days/month for >3 mo
        .property("chronicity", s, False)
        # improving | stable | worsening | chronified
        .property("currentTrend", s, False)
        .build()
    )

    # ICHD-3 classification. We capture the diagnosis as a single
    # HeadacheClassification vertex per pattern; properties are the
    # ICHD-3 axes.
    classification = (
        vertex_type(HEADACHE_CLASSIFICATION, s)
        # primary | secondary | painfulCranialNeuropathy
        .property("primarySecondary", s, False)
        # migraine | tensionType | cluster | paroxysmalHemicrania |
        # hemicraniaContinua | suncT | medicationOveruse |
        # newDailyPersistent | trigeminalNeuralgia | other
        .property("family", s, False)
        # withAura | withoutAura | chronic | episodic | ...
        .property("subtype", s, False)
        # natural-language summary
        .property("value", s, True)
        .property("confidence", s, False)  # patient-reported | suspected | confirmed
        .build()
    )

    # --- Phases of a headache attack ---
    # Each phase is a separate vertex per Headache pattern. Concrete
    # symptoms attach to a phase via dedicated hasX edges.

    prodrome = (
        vertex_type(PRODROME, s)
        # duration in hours before the pain phase starts
        .property("typicalHoursBeforePain", i, False)
        .property("note", s, False)
        .build()
    )

    # Aura: structured properties to capture ICHD-3 distinctions without
    # exploding into per-variant vertex types. Concrete Aura subtypes
    # (VisualAura, SensoryAura, ...) attach via hasX edges for cases the
    # patient reports specifically.
    aura = (
        vertex_type(AURA, s)
        # Patient-observable attributes:
        .property("openEye", b, False)        # aura visible with eyes open
        .property("closedEye", b, False)      # aura visible only with eyes closed
        .property("monocular", b, False)      # retinal-aura suggestion
        # typical duration in minutes
        .property("typicalMinutes", i, False)
        # does the aura overlap with the pain or strictly precede it
        .property("overlapsWithPain", b, False)
        .property("note", s, False)
        .build()
    )

    # VisualAura: the concrete visual-aura subtype, carrying what the
    # patient actually sees. Bare-label was too lossy -- "zigzag lines,
    # flashing rainbows" had nowhere to go. Properties follow ICHD-3
    # visual-aura descriptors; all optional and free-text/boolean so the
    # extractor can fill in whatever the patient describes.
    visual_aura = (
        vertex_type(VISUAL_AURA, s)
        # free-text shape/pattern: "zigzag", "fortification spectra",
        # "crescent", "blind spot", etc.
        .property("pattern", s, False)
        # whether the phenomenon is colored, and which colors
        # ("rainbow", "white", "monochrome")
        .property("colors", s, False)
        .property("scintillating", b, False)   # flashing / shimmering / sparkling
        .property("photopsia", b, False)        # flashes / sparks of light
        .property("scotoma", b, False)          # area of lost vision / blind spot
        .property("fortification", b, False)    # zigzag fortification spectra
        # positive (added, e.g. flashes) vs negative (lost vision) phenomena
        .property("positiveNegative", s, False)
        .property("note", s, False)
        .build()
    )

    postdrome = (
        vertex_type(POSTDROME, s)
        .property("typicalHoursAfterPain", i, False)
        .property("note", s, False)
        .build()
    )

    # --- Pain characteristics beyond simple Quality ---
    pain_character = (
        vertex_type(PAIN_CHARACTER, s)
        .property("worseWithRoutineActivity", b, False)  # ICHD migraine criterion
        .property("worseAtNight", b, False)
        .property("worseOnWaking", b, False)             # raises sleep apnea concern
        .property("wakesFromSleep", b, False)            # raises cluster / ICP concern
        .property("worseBendingForward", b, False)       # sinus suggestion
        .property("positional", b, False)                # red flag
        .property("progressivelyWorseWithinEpisode", b, False)
        .property("note", s, False)
        .build()
    )

    # --- Concrete bare-symptom vertex types (no payload). ---
    bare_label_vts = [
        vertex_type(label, s).build() for label in (
            *BARE_PAIN_SYMPTOMS,
            *BARE_AUTONOMIC_FEATURES,
            *BARE_AURA_TYPES,
            *BARE_PRODROMAL_SYMPTOMS,
            *BARE_RED_FLAGS,
        )
    ]

    # --- Trigger bucket + concrete-by-category trigger types ---
    headache_triggers = vertex_type(HEADACHE_TRIGGERS, s).build()
    category_trigger_vts = [
        vertex_type(label, s).property("value", s, True).build()
        for label, _ in TRIGGER_CATEGORIES
    ]

    # --- Alleviating-factor bucket + categories ---
    alleviating_factors = vertex_type(ALLEVIATING_FACTORS, s).build()
    relief_category_vts = [
        vertex_type(label, s).property("value", s, True).build()
        for label, _ in RELIEF_CATEGORIES
    ]

    # --- Other Headache-attached vocabulary ---
    body_location = (
        vertex_type(BODY_LOCATION, s)
        .property("value", s, True)
        # True when the location moves around between or within episodes
        # ("sometimes more toward the front, sometimes more toward the
        # back").
        .property("variable", b, False)
        # Optional descriptor of HOW the location varies:
        # "shifting" | "diffuse" | "frontToBack" | "symmetrical".
        .property("pattern", s, False)
        .build()
    )

    # Quality is small and stable; keep as one type with a value
    # property. ICHD-3 standard qualities: throbbing/pulsating,
    # pressing/tightening, stabbing/lancinating, electric, burning,
    # exploding, dull.
    quality = (
        vertex_type(QUALITY, s)
        .property("value", s, True)
        # When this quality applies: "typical" | "atWorst" | "atOnset" |
        # "throughoutEpisode". The pain that's normally dull but becomes
        # throbbing only at peak severity needs this discrimination.
        .property("context", s, False)
        .build()
    )

    # Severity supports both a categorical value AND a numeric range.
    # The same Headache can have multiple Severity vertices for
    # different contexts (typical / at worst / when escalated).
    severity = (
        vertex_type(SEVERITY, s)
        .property("value", s, True)         # mild | moderate | severe | description
        .property("scale", i, False)        # 0-10 point estimate
        .property("scaleMax", i, False)     # the top of the scale being used (usually 10)
        .property("minScale", i, False)
        .property("maxScale", i, False)
        # "typical" | "atWorst" | "atOnset" | "betweenEpisodes" | "untreated"
        .property("context", s, False)
        .build()
    )

    laterality = (
        vertex_type(LATERALITY, s)
        # left | right | bilateral | shifting | unspecified
        .property("value", s, True)
        # for unilateral pain, does it ever switch sides between episodes?
        .property("alternatesSides", b, False)
        # "symmetrical" | "asymmetrical" -- when bilateral, is it usually
        # the same intensity on both sides?
        .property("symmetry", s, False)
        .build()
    )

    frequency = (
        vertex_type(FREQUENCY, s)
        .property("value", s, True)
        .property("count", i, False)
        .property("per", s, False)          # day | week | month | year
        # "approximately", "exactly", "varies", "varies a lot"
        .property("certainty", s, False)
        # "currently" | "historically" | "before-trigger-avoidance" -- the
        # patient said "these days" the acute happens ~biweekly, implying
        # the historical rate was different.
        .property("context", s, False)
        .build()
    )

    duration = (
        vertex_type(DURATION, s)
        .property("value", s, True)
        .property("count", i, False)
        .property("unit", s, False)         # minutes | hours | days
        # untreated duration distinct from treated duration; ICHD-3
        # migraine requires 4-72h untreated
        .property("untreated", b, False)
        # "typical" | "atWorst" | "minimum" | "maximum"
        .property("context", s, False)
        .property("minCount", i, False)
        .property("maxCount", i, False)
        .build()
    )

    age = (
        vertex_type(AGE, s)
        .property("value", s, True)         # natural-language label
        .property("age", i, False)          # numeric years
        .build()
    )

    # Disability / impact. Lightly inspired by HIT-6 / MIDAS but kept
    # simple enough to elicit verbally.
    functional_impact = (
        vertex_type(FUNCTIONAL_IMPACT, s)
        # missed days per month
        .property("missedDaysPerMonth", i, False)
        # subjective: none | mild | moderate | severe
        .property("disabilityLevel", s, False)
        # patient needs to lie down / be in a dark room
        .property("bedRequired", b, False)
        # the first or only time required hospital-level care
        .property("hospitalizationRequired", b, False)
        # ER visits in the last year
        .property("erVisitsPerYear", i, False)
        # affects work / school / family responsibilities
        .property("affectsWork", b, False)
        # the burden of trigger avoidance is its own impact; the
        # transcript explicitly called this out as separate from the pain
        .property("triggerAvoidanceBurden", b, False)
        # "ongoing" | "firstEpisodeOnly" | "historical"
        .property("context", s, False)
        .property("note", s, False)
        .build()
    )

    # --- Person-level attributes ---
    family_history = (
        vertex_type(FAMILY_HISTORY, s)
        .property("relation", s, True)      # mother | father | sibling | child | ...
        .property("condition", s, True)     # migraine | tension | cluster | unknown
        .build()
    )

    comorbidity = (
        vertex_type(COMORBIDITY, s)
        .property("condition", s, True)     # anxiety | depression | IBS | ...
        .property("note", s, False)
        .build()
    )

    diagnosis = (
        vertex_type(DIAGNOSIS, s)
        .property("value", s, True)         # natural-language diagnosis
        .property("diagnosedBy", s, False)  # neurologist | GP | self | ...
        .property("year", i, False)
        .build()
    )

    # Honour privacy: structure present but the agent prompt will NOT
    # ask about menstrual relationship unless the patient volunteers.
    menstrual_relationship = (
        vertex_type(MENSTRUAL_RELATIONSHIP, s)
        .property("menstrualAssociated", b, False)
        .property("perimenstrual", b, False)
        .property("pregnancyChange", s, False)     # better | worse | unchanged | na
        .property("contraceptiveChange", s, False) # better | worse | unchanged | na
        .property("note", s, False)
        .build()
    )

    # --- Open-world escape hatch + reification indirection ---
    comment = (
        vertex_type(COMMENT, s)
        .property("description", s, True)
        # "operator" indicates a meta-comment from the demo operator
        # about schema gaps; "patient" is the patient's own free text
        # the schema couldn't capture.
        .property("kind", s, False)
        .build()
    )
    concept = (
        vertex_type(CONCEPT, s)
        .property("label", s, True)
        .property("note", s, False)
        .build()
    )

    vertices = [
        person,
        headache, classification,
        prodrome, aura, postdrome, pain_character,
        visual_aura,
        *bare_label_vts,
        headache_triggers, *category_trigger_vts,
        alleviating_factors, *relief_category_vts,
        body_location, quality, severity, laterality,
        frequency, duration, age,
        functional_impact,
        family_history, comorbidity, diagnosis, menstrual_relationship,
        comment, concept,
    ]

    # -----------------------------------------------------------------
    # EDGE TYPES
    # -----------------------------------------------------------------

    # --- Person -> Headache, plus Person-level attributes ---
    person_edges = [
        edge_type("reports", s, PERSON, HEADACHE).build(),
        edge_type("hasFamilyHistory", s, PERSON, FAMILY_HISTORY).build(),
        edge_type("hasComorbidity", s, PERSON, COMORBIDITY).build(),
        edge_type("hasDiagnosis", s, PERSON, DIAGNOSIS).build(),
        edge_type("hasMenstrualRelationship", s, PERSON, MENSTRUAL_RELATIONSHIP).build(),
    ]

    # --- Headache -> phase vertices ---
    phase_edges = [
        edge_type("hasProdrome", s, HEADACHE, PRODROME).build(),
        edge_type("hasAura", s, HEADACHE, AURA).build(),
        edge_type("hasPostdrome", s, HEADACHE, POSTDROME).build(),
        edge_type("hasPainCharacter", s, HEADACHE, PAIN_CHARACTER).build(),
    ]

    # --- Headache -> pain-phase concrete symptoms ---
    headache_to_pain_symptoms = [
        edge_type("hasNausea", s, HEADACHE, NAUSEA).build(),
        edge_type("hasVomiting", s, HEADACHE, VOMITING).build(),
        edge_type("hasLightSensitivity", s, HEADACHE, LIGHT_SENSITIVITY).build(),
        edge_type("hasSoundSensitivity", s, HEADACHE, SOUND_SENSITIVITY).build(),
        edge_type("hasSmellSensitivity", s, HEADACHE, SMELL_SENSITIVITY).build(),
        edge_type("hasDizziness", s, HEADACHE, DIZZINESS).build(),
        edge_type("hasVertigo", s, HEADACHE, VERTIGO).build(),
        edge_type("hasNeckStiffness", s, HEADACHE, NECK_STIFFNESS).build(),
        edge_type("hasNeckPain", s, HEADACHE, NECK_PAIN).build(),
        edge_type("hasScalpTenderness", s, HEADACHE, SCALP_TENDERNESS).build(),
        edge_type("hasJawTenderness", s, HEADACHE, JAW_TENDERNESS).build(),
    ]

    # --- Headache -> autonomic features (TAC indicators) ---
    autonomic_edges = [
        edge_type("hasConjunctivalInjection", s, HEADACHE, CONJUNCTIVAL_INJECTION).build(),
        edge_type("hasLacrimation", s, HEADACHE, LACRIMATION).build(),
        edge_type("hasNasalCongestion", s, HEADACHE, NASAL_CONGESTION).build(),
        edge_type("hasRhinorrhea", s, HEADACHE, RHINORRHEA).build(),
        edge_type("hasEyelidEdema", s, HEADACHE, EYELID_EDEMA).build(),
        edge_type("hasFacialSweating", s, HEADACHE, FACIAL_SWEATING).build(),
        edge_type("hasPtosis", s, HEADACHE, PTOSIS).build(),
        edge_type("hasMiosis", s, HEADACHE, MIOSIS).build(),
        edge_type("hasRestlessness", s, HEADACHE, RESTLESSNESS).build(),
        edge_type("hasEarFullness", s, HEADACHE, EAR_FULLNESS).build(),
    ]

    # --- Aura -> aura subtype concretes ---
    # Multiple aura subtype edges can co-occur (visual+sensory, etc.).
    aura_subtype_edges = [
        edge_type("hasVisualAura", s, AURA, VISUAL_AURA).build(),
        edge_type("hasSensoryAura", s, AURA, SENSORY_AURA).build(),
        edge_type("hasSpeechAura", s, AURA, SPEECH_AURA).build(),
        edge_type("hasMotorAura", s, AURA, MOTOR_AURA).build(),
        edge_type("hasBrainstemAura", s, AURA, BRAINSTEM_AURA).build(),
        edge_type("hasRetinalAura", s, AURA, RETINAL_AURA).build(),
    ]

    # --- Prodrome -> prodromal symptoms ---
    prodrome_edges = [
        edge_type("hasFatigue", s, PRODROME, FATIGUE).build(),
        edge_type("hasMoodChange", s, PRODROME, MOOD_CHANGE).build(),
        edge_type("hasCognitiveSlowness", s, PRODROME, COGNITIVE_SLOWNESS).build(),
        edge_type("hasFoodCraving", s, PRODROME, FOOD_CRAVING).build(),
        edge_type("hasYawning", s, PRODROME, YAWNING).build(),
        edge_type("hasFluidRetention", s, PRODROME, FLUID_RETENTION).build(),
        edge_type("hasUrinaryFrequency", s, PRODROME, URINARY_FREQUENCY).build(),
    ]

    # --- Postdrome -> postdromal symptoms ---
    # Reuse fatigue / mood / cognitive-slowness / scalp-tenderness types
    # since the postdrome syndrome shares vocabulary with prodrome and
    # the pain phase.
    postdrome_edges = [
        edge_type("postdromalFatigue", s, POSTDROME, FATIGUE).build(),
        edge_type("postdromalMoodChange", s, POSTDROME, MOOD_CHANGE).build(),
        edge_type("postdromalCognitiveSlowness", s, POSTDROME, COGNITIVE_SLOWNESS).build(),
        edge_type("postdromalScalpTenderness", s, POSTDROME, SCALP_TENDERNESS).build(),
    ]

    # --- Red flags hanging off Headache directly ---
    red_flag_edges = [
        edge_type("hasRedFlagThunderclapOnset", s, HEADACHE, THUNDERCLAP_ONSET).build(),
        edge_type("hasRedFlagWorseWithValsalva", s, HEADACHE, WORSE_WITH_VALSALVA).build(),
        edge_type("hasRedFlagPositional", s, HEADACHE, POSITIONAL_HEADACHE).build(),
        edge_type("hasRedFlagProgressivelyWorse", s, HEADACHE, PROGRESSIVELY_WORSE).build(),
        edge_type("hasRedFlagWakesFromSleep", s, HEADACHE, WAKES_FROM_SLEEP).build(),
        edge_type("hasRedFlagNewAfterFifty", s, HEADACHE, NEW_AFTER_FIFTY).build(),
        edge_type("hasRedFlagFever", s, HEADACHE, FEVER).build(),
        edge_type("hasRedFlagWeightLoss", s, HEADACHE, WEIGHT_LOSS).build(),
        edge_type("hasRedFlagFocalDeficit", s, HEADACHE, FOCAL_NEUROLOGICAL_DEFICIT).build(),
        edge_type("hasRedFlagVisionChange", s, HEADACHE, VISION_CHANGE).build(),
        edge_type("hasRedFlagConfusion", s, HEADACHE, CONFUSION).build(),
    ]

    # --- Trigger bucket edges (cause + aggravation share the bucket shape) ---
    # Multiple Headaches may point at the SAME HeadacheTriggers vertex
    # when the patient says triggers are shared across patterns.
    trigger_root_edges = [
        edge_type("triggers", s, HEADACHE, HEADACHE_TRIGGERS)
        # How quickly the trigger leads to a headache: "withinMinutes" |
        # "withinHours" | "sameDay" | "nextDay" | "variable".
        .property("latency", s, False)
        # How consistently the trigger fires: "almostAlways" | "often" |
        # "sometimes" | "rare".
        .property("reliability", s, False)
        # Subjective magnitude: "powerful" | "moderate" | "mild".
        .property("magnitude", s, False)
        # Free text the model can use when the above don't fit.
        .property("note", s, False)
        .build(),
        edge_type("aggravatedBy", s, HEADACHE, HEADACHE_TRIGGERS)
        # Whether aggravation only happens once a headache is already
        # present (vs being a trigger that can cause one from baseline).
        .property("requiresExistingHeadache", b, False)
        .property("magnitude", s, False)
        .property("note", s, False)
        .build(),
    ]
    category_edges = [
        edge_type(category_edge, s, HEADACHE_TRIGGERS, label).build()
        for label, category_edge in TRIGGER_CATEGORIES
    ]

    # --- Alleviating-factor edges (mirror of trigger structure) ---
    relief_root_edges = [
        edge_type("relievedBy", s, HEADACHE, ALLEVIATING_FACTORS)
        .property("magnitude", s, False)    # "powerful" | "moderate" | "mild"
        .property("note", s, False)
        .build(),
    ]
    relief_category_edges = [
        edge_type(category_edge, s, ALLEVIATING_FACTORS, label).build()
        for label, category_edge in RELIEF_CATEGORIES
    ]

    # --- Headache -> other vocabulary (direct) ---
    # Several of these carry a `context` edge property because the same
    # underlying dimension can have multiple readings (typical / at
    # worst / when escalated) per Headache pattern.
    direct_edges = [
        edge_type("locatedAt", s, HEADACHE, BODY_LOCATION).build(),
        edge_type("hasQuality", s, HEADACHE, QUALITY)
        # "typical" | "atWorst" | "whenSevere" | "atOnset"
        .property("context", s, False)
        .build(),
        edge_type("hasSeverity", s, HEADACHE, SEVERITY)
        .property("context", s, False)
        .build(),
        edge_type("hasLaterality", s, HEADACHE, LATERALITY).build(),
        edge_type("hasFrequency", s, HEADACHE, FREQUENCY)
        # "current" | "historical" | "untreatedBaseline"
        .property("context", s, False)
        .build(),
        edge_type("hasDuration", s, HEADACHE, DURATION)
        .property("context", s, False)
        .build(),
        edge_type("hasOnset", s, HEADACHE, AGE).build(),
        edge_type("emergedAt", s, HEADACHE, AGE).build(),
        edge_type("classifiedAs", s, HEADACHE, HEADACHE_CLASSIFICATION).build(),
        edge_type("hasImpact", s, HEADACHE, FUNCTIONAL_IMPACT).build(),
    ]

    # --- Inter-Headache relationships ---
    headache_to_headache = [
        edge_type("escalatesTo", s, HEADACHE, HEADACHE)
        # Free-text bridge ("fluorescent lights", "exertion", ...).
        .property("via", s, False)
        # How often the escalation happens.
        .property("frequency", s, False)
        # Magnitude of the escalation.
        .property("note", s, False)
        .build(),
        # When one pattern evolved out of another (e.g. an episodic
        # migraine pattern that "became" daily chronic migraine).
        edge_type("evolvedFrom", s, HEADACHE, HEADACHE)
        .property("atAge", i, False)
        .property("note", s, False)
        .build(),
    ]

    # --- Comment-to-Concept edges (open reference) ---
    comment_edges = [
        edge_type("mentions", s, COMMENT, CONCEPT).build(),
        edge_type("about", s, COMMENT, CONCEPT).build(),
    ]

    # --- Concept-to-vocabulary edges (one per vocabulary label) ---
    concept_edges = [
        edge_type("concept" + label, s, CONCEPT, label).build()
        for label in VOCABULARY_LABELS
    ]

    edges = (
        person_edges
        + phase_edges
        + headache_to_pain_symptoms
        + autonomic_edges
        + aura_subtype_edges
        + prodrome_edges
        + postdrome_edges
        + red_flag_edges
        + trigger_root_edges
        + category_edges
        + relief_root_edges
        + relief_category_edges
        + direct_edges
        + headache_to_headache
        + comment_edges
        + concept_edges
    )

    return graph_schema(vertices, edges)


def schema_path() -> Path:
    # __file__: src/main/python/chatgraph/domains/medical/schema_build.py
    # parents[4] is src/main/, so the resolved path is
    # src/main/json/medical.json. The JSON artifact lives as a peer of
    # the Python sources under src/main/, mirroring Hydra's polyglot
    # src/main/<lang>/ layout. Ancestry for reference:
    #   [0]=medical [1]=domains [2]=chatgraph [3]=python
    #   [4]=main    [5]=src     [6]=project_root
    return Path(__file__).resolve().parents[4] / "json" / "medical.json"


def main() -> int:
    schema = build_schema()
    encoded = encode_graph_schema(schema)
    out = schema_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(encoded, indent=2) + "\n")
    print(f"Wrote {out}")
    print(
        f"  {len(schema.vertices)} vertex types, {len(schema.edges)} edge types"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
