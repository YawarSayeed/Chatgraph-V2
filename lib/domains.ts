import medicalSchemaRaw from "../src/main/json/medical.json";
import hospitalitySchemaRaw from "../src/main/json/hospitality.json";
import { MEDICAL_AGENT_PROMPT, MEDICAL_EXTRACTOR_INTRO, OPENING_LINE } from "./prompts";
import type { DomainId, GraphEdge, GraphVertex } from "./types";

export type DomainSchema = {
  vertices: Array<{
    "@key": string;
    "@value": {
      properties?: Array<{
        key: string;
        value?: unknown;
        required?: boolean;
      }>;
    };
  }>;
  edges: Array<{
    "@key": string;
    "@value": {
      // An endpoint may name several labels: one relation, many legal source
      // types (provenance attaches to every knowledge class).
      out?: string | string[];
      in?: string | string[];
      outV?: string | string[];
      inV?: string | string[];
      properties?: Array<{
        key: string;
        value?: unknown;
        required?: boolean;
      }>;
    };
  }>;
};

export type GraphDisplayConfig = {
  labelOverrides?: Record<string, string>;
  colors?: Record<string, string>;
  radii?: Record<string, number>;
  hiddenLabels?: string[];
  hiddenEdges?: string[];
  hiddenTextPatterns?: string[];
};

export type InterviewSection = {
  key: string;
  title: string;
  order: number;
  /** Words that identify an interviewer question as belonging to this section. */
  keywords: string[];
};

export type DomainConfig = {
  id: DomainId;
  label: string;
  subtitle: string;
  openingLine: string;
  composerPlaceholder: string;
  userLabel: string;
  agentPrompt: string;
  extractorIntro: string;
  schema: DomainSchema;
  initialVertices: GraphVertex[];
  initialEdges?: GraphEdge[];
  graphDisplay?: GraphDisplayConfig;
  /**
   * The interview's section structure, mirrored from the agent prompt. Used to
   * attach each transcript episode to the section actually being discussed,
   * deterministically (keyword match on the interviewer's question) — no model
   * involved, so the attachment is reproducible from the transcript alone.
   */
  interviewSections?: InterviewSection[];
};

const hospitalityOpeningLine =
  "Hi, I'll conduct your knowledge session today on hospitality. The purpose of today's session is to extract explicit knowledge, tacit expertise, workflows, heuristics, rules, customer-experience judgment, and system-level insights from your hospitality business experience, so we can build a comprehensive hospitality knowledge base.";

const hospitalityAgentPrompt = `You are Cognisee, a knowledge engineer interviewing a senior hospitality business owner.

Your task is to extract explicit operational knowledge, tacit expertise, customer-experience heuristics, service recovery rules, pricing and timing judgments, workflow decisions, and system-level insights to build a comprehensive hospitality knowledge base for a future AI specialist.

Speak naturally like a human. Be warm, respectful, and professional. Do not sound robotic. Do not mention scripts, section letters, internal rules, schema labels, or graph extraction.

Drive the session proactively. Ask questions in order from Section A to G. Ask one question at a time. Acknowledge briefly after each answer. If an answer is partial, vague, or high-level, probe deeper with follow-up questions until the core knowledge is fully extracted.

Avoid generic business advice. This is knowledge capture from lived experience, not consulting.

At the end of each section, ask once: "Anything you'd like to add before we move on?" If the expert declines, says continue, or gives a short acknowledgment, immediately ask the first question of the next section. Never ask a second confirmation, never wait silently, and never answer "continue" with another question about continuing — always respond to it with the next substantive interview question.

Track your position in the section sequence from the whole conversation so far. Never re-ask a question the expert has already answered; if an answer already covered a later question, skip it and move on.

If the expert says "continue", "go on", or similar WITHOUT having answered the question you just asked, briefly re-ask that same question — never treat filler as an answer and never skip an unanswered question. If the expert's message appears cut off mid-sentence (it ends abruptly, like "All that needs to be done in a"), ask them to finish that thought instead of answering the fragment.

Conduct rules, every reply:
- End with exactly ONE question. Never two questions in the same reply, and never a reply with no question until the closing summary.
- Never answer your own question or suggest example answers. If the expert seems stuck, rephrase the question more concretely — do not supply candidate answers they can merely agree with, because agreement is not their knowledge.
- Never speak your planning aloud. No "let me think", "I'll quickly frame this", "moving to the next area, which is..." — just acknowledge and ask.

Section A - Introduction:
1. Confirm role, hospitality business type, and how long they have operated it.
2. What makes the business especially successful?
3. Confirm session is only for knowledge capture, not operational advice or guest service.
4. Ask pacing/depth/example preferences.

Section B - Guest Experience Principles:
Ask what guests love most, small details that affect satisfaction, subtle signs of guest experience, what repeat customers value, never-compromise service standards, practical definition of excellent hospitality, and what guests remember after leaving.

Section C - Arrival, Check-In, and Timing:
Ask how ideal check-in time is decided, early check-in policy, factors for granting or refusing it, balance between convenience and room readiness, sweet-spot check-in time, early-arrival handling, delayed checkout handling, late fees/waivers/case-by-case rules, and refined timing rules.

Section D - Service Recovery and Flexibility:
Ask how problems are recovered, common failures, when flexibility beats strict policy, when exceptions are made, exceptions that paid off in loyalty, when to apologize/compensate/explain, and recovery mistakes newer operators make.

Section E - Operating Heuristics and Decision Rules:
Ask if-then rules, return-likelihood judgment, high-value guest cues, habits of seasoned operators, trusted patterns, intuition-based decisions, rules balancing guest happiness/staff workload/profitability, and refined timing/pricing/exception rules.

Section F - Customer Psychology and Loyalty:
Ask what makes customers feel cared for, emotional loyalty moments, repeat vs first-time guest differences, small gestures with outsized goodwill, experiences that create advocates, trust destroyers, and what hospitality means to different customer types.

Section G - Context, Business Model, and System Factors:
Ask how location/seasonality/customer mix change the approach, how staffing/training/coordination affect quality, key bottlenecks, consistency across shifts, business decisions influencing guest experience, system-level improvements, and what smarter hospitality systems should learn from the expert.

Session closure: thank the expert, summarize what was covered, and ask whether they want to add, correct, or expand anything before concluding.`;

// Domain judgement only. The label inventory, edge directions, provenance rules,
// and vocabularies are generated from the gate contract and appended at call time
// (lib/gate/prompt.ts) — restating any of them here is how the extractor and the
// gate drift apart.
const hospitalityExtractorIntro = `You extract structured property-graph data from the latest expert utterance in a hospitality knowledge-capture interview.

Emit only what the latest expert utterance adds. If the utterance is small talk, filler, a clarification request, or has no substantive hospitality knowledge, emit nothing.

Core conventions:
- Person root already exists as person:expert. Do not emit another Person unless the expert gives a concrete name; if needed, update person:expert.
- KnowledgeSession root already exists as session:hospitality:default and is linked from person:expert. Reuse it. The session, section, and transcript episode for this turn are created for you — do not emit them.
- Use lowercase, hyphen-separated, colon-namespaced ids.
- Do not use the full expert utterance as a knowledge vertex name. Names must be short semantic concepts, such as "hot towel welcome ritual", "rushed guest signal", or "flexible early check-in".
- ruleText, heuristic, and description values must be concise normalized statements in third person ("Early check-in granted only when a room is ready and the guest informed in advance"), never verbatim quotes — the quote belongs in evidence.traceText, the distilled rule in the property.
- Every property value must be grounded in what the expert actually said. Never pad optional properties with your own elaboration: if the expert did not state a description, a primaryNeed, a severity, or any other optional value, OMIT that property entirely rather than inventing plausible content for it. A property the evidence quote cannot support is a hallucination.
- Reuse existing GuestPersona, GuestSignal, ServiceStandard, CheckInPolicy, and CheckOutPolicy ids when the current graph already has them.
- CheckInPolicy and CheckOutPolicy are session singletons. Use ids policy:checkin:session:hospitality:default and policy:checkout:session:hospitality:default.
- Extract practical, lived-experience hospitality knowledge, not generic business advice.
- Connect what you emit: every knowledge vertex you emit MUST carry at least one semantic edge to another knowledge vertex — newly emitted, or existing via its exact id from KNOWN ENTITIES — whenever the utterance states or implies any relationship. A vertex with no semantic edge should be a rare exception, not the norm: a principle belongs to the business that practices it, a signal indicates something, a rule governs something. Prefer connecting new knowledge to what the graph already holds.

Good extraction choices:
- A belief about excellent hospitality -> GuestExperiencePrinciple.
- A concrete enforced standard -> ServiceStandard.
- A guest cue/tell -> GuestSignal.
- A practical guest type -> GuestPersona.
- An if/then operating decision -> DecisionRule.
- A gut-feel pattern learned over time -> OperatingHeuristic.
- A check-in/check-out timing policy -> CheckInPolicy, CheckOutPolicy, TimingRule.
- A service problem -> ServiceFailure; a fix -> RecoveryAction; result -> Outcome.
- Flexibility rule or exception -> ExceptionRule.
- Loyalty psychology -> LoyaltyDriver or EmotionalMoment.
- Seasonality/location/staffing/business model limit -> ContextualConstraint.`;

const hospitalitySections: InterviewSection[] = [
  { key: "A", title: "Introduction", order: 1,
    keywords: ["role", "business type", "operated", "operating", "successful", "pacing", "knowledge capture", "confirm"] },
  { key: "B", title: "Guest Experience Principles", order: 2,
    keywords: ["guests love", "satisfaction", "subtle signs", "repeat customers", "never-compromise", "excellent hospitality", "remember after", "small details"] },
  { key: "C", title: "Arrival, Check-In, and Timing", order: 3,
    keywords: ["check-in", "check in", "checkout", "check-out", "early", "arrival", "room readiness", "sweet spot", "sweet-spot", "late fee", "waiver", "timing"] },
  { key: "D", title: "Service Recovery and Flexibility", order: 4,
    keywords: ["recover", "recovery", "failures", "goes wrong", "flexibility", "exception", "apologize", "compensate", "mistakes"] },
  { key: "E", title: "Operating Heuristics and Decision Rules", order: 5,
    keywords: ["if-then", "rules", "return-likelihood", "high-value", "habits", "patterns", "intuition", "workload", "profitability", "heuristic"] },
  { key: "F", title: "Customer Psychology and Loyalty", order: 6,
    keywords: ["cared for", "emotional", "loyalty", "first-time", "gestures", "goodwill", "advocates", "trust", "psychology"] },
  { key: "G", title: "Context, Business Model, and System Factors", order: 7,
    keywords: ["location", "seasonality", "customer mix", "staffing", "training", "coordination", "bottleneck", "shifts", "consistency", "system-level", "smarter"] }
];

export const domains: Record<DomainId, DomainConfig> = {
  medical: {
    id: "medical",
    label: "Headache / medical",
    subtitle: "medical interview prototype",
    openingLine: OPENING_LINE,
    composerPlaceholder: "Describe the headache in your own words",
    userLabel: "patient",
    agentPrompt: MEDICAL_AGENT_PROMPT,
    extractorIntro: MEDICAL_EXTRACTOR_INTRO,
    schema: medicalSchemaRaw as DomainSchema,
    initialVertices: [
      {
        id: "Person:patient",
        label: "Person",
        properties: { name: "patient" }
      }
    ],
    graphDisplay: {
      labelOverrides: { Person: "Patient" },
      colors: {
        Person: "#0f766e",
        Headache: "#b2462e",
        HeadacheClassification: "#e6a817",
        Comment: "#7c3aed",
        Concept: "#7c3aed"
      },
      radii: {
        Person: 18,
        Headache: 16,
        Comment: 14,
        Concept: 14,
        HeadacheClassification: 14,
        Diagnosis: 14,
        PainCharacter: 14
      }
    }
  },
  hospitality: {
    id: "hospitality",
    label: "Hospitality expert",
    subtitle: "hospitality knowledge session",
    openingLine: hospitalityOpeningLine,
    composerPlaceholder: "Share your hospitality experience in your own words",
    userLabel: "expert",
    agentPrompt: hospitalityAgentPrompt,
    extractorIntro: hospitalityExtractorIntro,
    schema: hospitalitySchemaRaw as DomainSchema,
    interviewSections: hospitalitySections,
    initialVertices: [
      {
        id: "person:expert",
        label: "Person",
        properties: { name: "expert" }
      },
      {
        id: "session:hospitality:default",
        label: "KnowledgeSession",
        properties: {
          domain: "hospitality",
          objective: "Capture tacit hospitality knowledge from an expert"
        }
      }
    ],
    initialEdges: [
      {
        id: "person:expert-hasSession->session:hospitality:default",
        label: "hasSession",
        out: "person:expert",
        in: "session:hospitality:default",
        properties: {}
      }
    ],
    graphDisplay: {
      labelOverrides: { Person: "Expert", KnowledgeSession: "Session" },
      colors: {
        Person: "#0f766e",
        KnowledgeSession: "#2563eb",
        ExpertRole: "#0f766e",
        HospitalityBusiness: "#2563eb",
        OperatingTenure: "#64748b",
        GuestExperiencePrinciple: "#b2462e",
        ServiceStandard: "#e6a817",
        GuestSignal: "#7c3aed",
        GuestPersona: "#0f766e",
        CheckInPolicy: "#2563eb",
        CheckOutPolicy: "#2563eb",
        TimingRule: "#d97706",
        DecisionRule: "#b2462e",
        OperatingHeuristic: "#7c3aed",
        ServiceFailure: "#be123c",
        RecoveryAction: "#15803d",
        LoyaltyDriver: "#0f766e",
        EmotionalMoment: "#db2777",
        ContextualConstraint: "#64748b",
        Outcome: "#15803d",
        ProvenanceEvidence: "#6b7280"
      },
      radii: {
        Person: 18,
        KnowledgeSession: 16,
        ExpertRole: 13,
        HospitalityBusiness: 15,
        OperatingTenure: 13,
        GuestExperiencePrinciple: 15,
        DecisionRule: 15,
        OperatingHeuristic: 15,
        CheckInPolicy: 14,
        CheckOutPolicy: 14,
        ProvenanceEvidence: 10
      },
      hiddenLabels: ["KnowledgeSession", "SessionSection", "TranscriptEpisode", "ProvenanceEvidence"],
      hiddenEdges: ["hasSession", "hasSection", "hasEpisode", "discusses", "discussesRule", "discussesHeuristic", "discussesFailure", "supportedBy", "principleSupportedBy", "heuristicSupportedBy", "appliesToPersona"],
      hiddenTextPatterns: [
        "^(okay|ok|sure|yes|yeah|great|thanks?)(\\b|[.!,'-])",
        "^let'?s\\s+(go|continue|start)",
        "^(i am|i'm|my role is|it'?s|it is|its)\\b",
        "^service quality practice$"
      ]
    }
  }
};

export const domainList = Object.values(domains);

export function getDomain(id: string | undefined): DomainConfig {
  return domains[isDomainId(id) ? id : "medical"];
}

export function isDomainId(value: string | undefined): value is DomainId {
  return value === "medical" || value === "hospitality";
}
