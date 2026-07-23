/**
 * Conformance tests for the symbolic gate.
 *
 * Run with:  node --import ./scripts/ts-alias-hooks.mjs src/test/js/gate_conformance.mjs
 *
 * Two kinds of check:
 *   - behavioural assertions on admission, materialized provenance, and severity;
 *   - a replay of the archived 2026-07-16 ablation deltas, which pins the per-fact
 *     admission gain against that run's published per-delta numbers without
 *     re-running any paid API call.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { gateContract } from "@/lib/gate/contract";
import { runGate } from "@/lib/gate/gate";
import { extractionToolSchema, provenanceInstructions, schemaReference } from "@/lib/gate/prompt";
import { extractGovernedDelta } from "@/lib/server/extract-governed";
import { buildGateLog, buildSessionExport } from "@/lib/export";
import { deriveAuditInput } from "@/lib/audit";
import { isFillerTurn } from "@/lib/filler";

const ROOT = process.cwd();
const CONTRACT = gateContract("hospitality");

let passed = 0;
const failures = [];
const pending = [];
function record(name, error) {
  if (error) failures.push(`${name}\n    ${error.message.split("\n").join("\n    ")}`);
  else passed += 1;
}
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(result.then(() => record(name), (error) => record(name, error)));
      return;
    }
    record(name);
  } catch (error) {
    record(name, error);
  }
}

function graphWith(...vertices) {
  return {
    vertices: Object.fromEntries(vertices.map((v) => [v.id, v])),
    edges: {}
  };
}

const EMPTY_GRAPH = graphWith(
  { id: "person:expert", label: "Person", properties: { name: "expert" } },
  { id: "session:hospitality:default", label: "KnowledgeSession", properties: { domain: "hospitality" } }
);

const CONTEXT = { sourceEpisode: "ep:test:001", speaker: "expert" };

const UTTERANCE = "We hand every guest a hot towel the moment they walk in, and we never charge for late checkout before noon.";

function knowledge(id, label, properties, traceText) {
  return { id, label, properties, evidence: { traceText } };
}


// --- contract -------------------------------------------------------------

test("contract binds the governance spec", () => {
  assert.equal(CONTRACT.governed, true);
  assert.equal(CONTRACT.evidenceLabel, "ProvenanceEvidence");
  assert.equal(CONTRACT.knowledgeLabels.size, 19);
  assert.equal(CONTRACT.severities.get("HR006"), "soft", "HR006 severity must come from the spec, not the implementation");
  assert.equal(CONTRACT.severities.get("HR012"), "hard");
});

test("schema and governance spec agree: zero drift", () => {
  assert.deepEqual(CONTRACT.drift, [], `schema/spec drift must be zero: ${JSON.stringify(CONTRACT.drift, null, 2)}`);
});

test("every text-quality rule binds to a property the schema declares", () => {
  const bound = CONTRACT.textQualityRules.map((rule) => `${rule.ruleId}:${rule.label}.${rule.property}`).sort();
  assert.deepEqual(bound, ["HR014:DecisionRule.ruleText", "HR015:OperatingHeuristic.heuristic"]);
  for (const rule of CONTRACT.textQualityRules) {
    assert.ok(CONTRACT.vertexSpecs.get(rule.label).properties.has(rule.property));
  }
});

test("the schema itself permits every provenance attachment the spec declares", () => {
  for (const [label, edgeLabel] of CONTRACT.provenanceEdgeByLabel) {
    assert.ok(
      CONTRACT.edgeSpecs.get(edgeLabel).out.has(label),
      `schema must permit ${label} as a source of ${edgeLabel}`
    );
  }
  assert.equal(CONTRACT.edgeSpecs.get("supportedBy").out.size, 16);
});

// --- structural provenance ------------------------------------------------

test("inline evidence materializes a vertex and the correctly-typed edge", () => {
  const cases = [
    ["GuestExperiencePrinciple", { name: "Predictability" }, "principleSupportedBy"],
    ["OperatingHeuristic", { name: "Read the lobby" }, "heuristicSupportedBy"],
    ["ServiceStandard", { name: "Hot towel on arrival" }, "supportedBy"]
  ];
  for (const [label, properties, expectedEdge] of cases) {
    const result = runGate(
      {
        vertices: [{ id: `v:${label}`, label, properties, evidence: { traceText: "We always hand guests a hot towel when they walk in." } }],
        edges: []
      },
      EMPTY_GRAPH,
      "hospitality",
      { evidenceContext: CONTEXT }
    );
    const evidence = result.delta.vertices.find((v) => v.label === "ProvenanceEvidence");
    assert.ok(evidence, `${label}: evidence vertex was not materialized`);
    assert.equal(evidence.properties.sourceEpisode, "ep:test:001", `${label}: gate must supply sourceEpisode`);
    assert.equal(evidence.properties.speaker, "expert");
    const edge = result.delta.edges.find((e) => e.out === `v:${label}`);
    assert.ok(edge, `${label}: provenance edge was not materialized`);
    assert.equal(edge.label, expectedEdge, `${label}: wrong provenance edge`);
    assert.ok(!result.findings.some((f) => f.ruleId === "HR006" && f.action === "flagged"), `${label}: should not be flagged unprovenanced`);
  }
});

test("gate overwrites model-supplied speaker with the turn's own", () => {
  const result = runGate(
    {
      vertices: [{
        id: "v:1", label: "ServiceStandard", properties: { name: "Seat guests at check-in" },
        evidence: { traceText: "We sit them down while we do the paperwork.", speaker: "interviewer", sourceEpisode: "ep:hallucinated" }
      }],
      edges: []
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: CONTEXT }
  );
  const evidence = result.delta.vertices.find((v) => v.label === "ProvenanceEvidence");
  assert.equal(evidence.properties.speaker, "expert");
  assert.equal(evidence.properties.sourceEpisode, "ep:test:001");
});

test("a knowledge vertex with no evidence is flagged, not dropped", () => {
  const result = runGate(
    { vertices: [{ id: "v:1", label: "ServiceStandard", properties: { name: "Warm welcome" } }], edges: [] },
    EMPTY_GRAPH, "hospitality", { evidenceContext: CONTEXT }
  );
  assert.equal(result.delta.vertices.length, 1, "spec severity for HR006 is soft: the vertex must still be written");
  const flag = result.findings.find((f) => f.ruleId === "HR006");
  assert.equal(flag.severity, "soft");
  assert.equal(flag.action, "flagged");
});

test("generic traceText drops the evidence but keeps the knowledge as unprovenanced", () => {
  const result = runGate(
    {
      vertices: [{
        id: "v:1", label: "ServiceStandard", properties: { name: "Warm welcome" },
        evidence: { traceText: "The expert described their approach" }
      }],
      edges: []
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: CONTEXT }
  );
  assert.ok(result.findings.some((f) => f.ruleId === "HR012" && f.action === "dropped"), "HR012 is hard and must drop the evidence");
  assert.ok(!result.delta.vertices.some((v) => v.label === "ProvenanceEvidence"));
  assert.ok(result.delta.vertices.some((v) => v.id === "v:1"));
  assert.ok(result.findings.some((f) => f.ruleId === "HR006" && f.action === "flagged"));
});

test("extractor-authored evidence vertices are ignored, not accumulated", () => {
  const result = runGate(
    {
      vertices: [
        { id: "v:1", label: "ServiceStandard", properties: { name: "Warm welcome" }, evidence: { traceText: "We greet every guest by name at the door." } },
        { id: "prov:model-authored", label: "ProvenanceEvidence", properties: { traceText: "We greet every guest by name at the door.", sourceEpisode: "ep:x", speaker: "expert" } }
      ],
      edges: []
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: CONTEXT }
  );
  const evidence = result.delta.vertices.filter((v) => v.label === "ProvenanceEvidence");
  assert.equal(evidence.length, 1, "only the gate-materialized evidence should survive");
  assert.equal(evidence[0].id, "evidence:v:1");
  assert.ok(result.findings.some((f) => f.subjectId === "prov:model-authored" && f.action === "dropped"));
});

// --- per-fact admission ---------------------------------------------------

test("a dangling edge drops only that edge", () => {
  const result = runGate(
    {
      vertices: [{ id: "v:1", label: "ServiceStandard", properties: { name: "Warm welcome" }, evidence: { traceText: "We greet everyone by name at the door." } }],
      edges: [{ id: "e:1", label: "standardEnforces", out: "v:1", in: "principle:does-not-exist" }]
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: CONTEXT }
  );
  assert.ok(result.delta.vertices.some((v) => v.id === "v:1"), "the knowledge vertex must survive its bad edge");
  assert.ok(!result.delta.edges.some((e) => e.id === "e:1"));
  assert.ok(result.findings.some((f) => f.ruleId === "HR005" && f.action === "dropped"));
  assert.ok(result.retryFeedback?.includes("HR005"));
});

test("unknown labels and required properties are enforced", () => {
  const result = runGate(
    {
      vertices: [
        { id: "v:1", label: "NotARealLabel", properties: {} },
        { id: "v:2", label: "ServiceStandard", properties: {} }
      ],
      edges: [{ id: "e:1", label: "notARealEdge", out: "person:expert", in: "v:2" }]
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: CONTEXT }
  );
  assert.equal(result.delta.vertices.length, 0);
  assert.ok(result.findings.some((f) => f.ruleId === "HR002"));
  assert.ok(result.findings.some((f) => f.ruleId === "HR001"), "ServiceStandard.name is required");
  assert.ok(result.findings.some((f) => f.ruleId === "HR003"));
});

test("schema mode skips governance rules", () => {
  const result = runGate(
    { vertices: [{ id: "v:1", label: "ServiceStandard", properties: { name: "Warm welcome" } }], edges: [] },
    EMPTY_GRAPH, "hospitality", { mode: "schema" }
  );
  assert.equal(result.delta.vertices.length, 1);
  assert.ok(!result.findings.some((f) => f.ruleId === "HR006"), "provenance is a governed-mode rule");
});

test("singleton policies are not duplicated", () => {
  const graph = graphWith(
    { id: "policy:checkin:existing", label: "CheckInPolicy", properties: { name: "Check-in" } }
  );
  const result = runGate(
    { vertices: [{ id: "policy:checkin:other", label: "CheckInPolicy", properties: { name: "Check-in" } }], edges: [] },
    graph, "hospitality", { evidenceContext: CONTEXT }
  );
  assert.equal(result.delta.vertices.filter((v) => v.label === "CheckInPolicy").length, 0);
  assert.ok(result.findings.some((f) => f.ruleId === "HR009" && f.action === "dropped"));
});

// --- generated prompt -----------------------------------------------------

test("the extractor is never offered a provenance edge it cannot author", () => {
  const schema = extractionToolSchema("hospitality");
  const edgeLabels = schema.properties.edges.items.properties.label.enum;
  for (const provenanceEdge of CONTRACT.provenanceEdgeLabels) {
    assert.ok(!edgeLabels.includes(provenanceEdge), `${provenanceEdge} must not be offered to the extractor`);
  }
  assert.ok(!schemaReference("hospitality").includes("principleSupportedBy"));
});

test("the tool schema requires inline evidence on vertices", () => {
  const vertexItems = extractionToolSchema("hospitality").properties.vertices.items;
  const vertexProps = vertexItems.properties;
  assert.ok(vertexProps.evidence, "vertices must carry an evidence field");
  assert.ok(
    vertexItems.required.includes("evidence"),
    "evidence must be required; left optional the model omits it and authors orphan evidence vertices"
  );
  assert.deepEqual(vertexProps.evidence.required, ["traceText"]);
  assert.deepEqual(
    vertexProps.evidence.properties.confidence.enum.sort(),
    [...CONTRACT.confidenceValues].sort(),
    "confidence vocabulary must come from the contract"
  );
  assert.deepEqual(
    vertexProps.label.enum.sort(),
    [...CONTRACT.vertexSpecs.keys()].sort(),
    "vertex labels must come from the contract"
  );
});

test("provenance instructions restate only what the contract holds", () => {
  const text = provenanceInstructions("hospitality");
  for (const label of CONTRACT.knowledgeLabels) assert.ok(text.includes(label), `${label} missing from instructions`);
  for (const pattern of CONTRACT.bannedTracePatterns) assert.ok(text.includes(pattern), `banned pattern missing: ${pattern}`);
});

// --- end to end with a stubbed extractor ----------------------------------

function stubOpenAI(toolArguments) {
  const calls = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (request) => {
            calls.push(request);
            const payload = Array.isArray(toolArguments) ? toolArguments[calls.length - 1] : toolArguments;
            return {
              choices: [{
                message: {
                  tool_calls: [{ function: { name: "emit_graph_delta", arguments: JSON.stringify(payload) } }]
                }
              }]
            };
          }
        }
      }
    }
  };
}

test("governed extraction scaffolds the episode and grounds the knowledge", async () => {
  const stub = stubOpenAI({
    vertices: [{
      id: "standard:hot-towel", label: "ServiceStandard",
      properties: { name: "Hot towel on arrival" },
      evidence: { traceText: "hand every guest a hot towel", confidence: "high" }
    }],
    edges: []
  });
  const body = {
    domainId: "hospitality",
    messages: [{ id: "m1", role: "user", content: "We hand every guest a hot towel the moment they walk in.", createdAt: 0 }],
    graph: EMPTY_GRAPH
  };
  const result = await extractGovernedDelta(stub.client, body.messages[0].content, body);

  const episode = result.delta.vertices.find((v) => v.label === "TranscriptEpisode");
  assert.ok(episode, "the turn's episode must be scaffolded deterministically");
  assert.equal(episode.properties.verbatimText, body.messages[0].content);

  const evidence = result.delta.vertices.find((v) => v.label === "ProvenanceEvidence");
  assert.ok(evidence, "evidence must be materialized from the inline field");
  assert.equal(evidence.properties.sourceEpisode, episode.id, "evidence must point at the scaffolded episode");

  const standard = result.delta.vertices.find((v) => v.label === "ServiceStandard");
  assert.match(standard.id, /^servicestandard:[0-9a-f]{16}$/, "the deployed gate assigns content-derived ids");
  assert.ok(result.delta.edges.some((e) => e.label === "supportedBy" && e.out === standard.id));
  assert.ok(!result.warnings.some((w) => w.startsWith("HR006")), "a grounded fact must not be flagged unprovenanced");
  assert.equal(stub.calls.length, 1, "a clean delta must not trigger a retry");
});

test("hard rejections drive a bounded retry and the best attempt wins", async () => {
  const stub = stubOpenAI([
    // First attempt: a dangling edge, which is hard.
    {
      vertices: [{ id: "standard:a", label: "ServiceStandard", properties: { name: "Warm welcome" }, evidence: { traceText: "greet every guest by name" } }],
      edges: [{ id: "e:bad", label: "standardEnforces", out: "standard:a", in: "principle:missing" }]
    },
    // Second attempt: corrected.
    {
      vertices: [
        { id: "standard:a", label: "ServiceStandard", properties: { name: "Warm welcome" }, evidence: { traceText: "greet every guest by name" } },
        { id: "principle:warmth", label: "GuestExperiencePrinciple", properties: { name: "Warmth" }, evidence: { traceText: "greet every guest by name" } }
      ],
      edges: [{ id: "e:good", label: "standardEnforces", out: "standard:a", in: "principle:warmth" }]
    }
  ]);
  const body = {
    domainId: "hospitality",
    messages: [{ id: "m1", role: "user", content: "We greet every guest by name.", createdAt: 0 }],
    graph: EMPTY_GRAPH
  };
  const result = await extractGovernedDelta(stub.client, body.messages[0].content, body);

  assert.equal(stub.calls.length, 2, "the hard rejection must trigger exactly one retry");
  assert.ok(stub.calls[1].messages[1].content.includes("HR005"), "the retry must echo the typed error");
  assert.ok(
    result.delta.edges.some((e) => e.label === "standardEnforces"),
    "the corrected edge must survive"
  );
  assert.ok(
    !result.delta.edges.some((e) => e.in === "principle:missing"),
    "the dangling endpoint must not survive"
  );
});


// --- entity resolution ----------------------------------------------------

test("a near-duplicate concept resolves onto the existing vertex", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "principle:guest-centered-service", label: "GuestExperiencePrinciple", properties: { name: "Guest-centered service" } }
  );
  const result = runGate(
    {
      vertices: [{
        id: "principle:guest-centred-experience", label: "GuestExperiencePrinciple",
        properties: { name: "guest centred  service" },
        evidence: { traceText: "we always put the guest at the center of service" }
      }],
      edges: []
    },
    graph, "hospitality",
    { resolveEntities: true, evidenceContext: { ...CONTEXT, utterance: "we always put the guest at the center of service decisions" } }
  );
  const principle = result.delta.vertices.find((v) => v.label === "GuestExperiencePrinciple");
  assert.equal(principle.id, "principle:guest-centered-service", "the candidate must land on the existing id");
  const evidence = result.delta.vertices.find((v) => v.label === "ProvenanceEvidence");
  assert.equal(evidence.id, "evidence:principle:guest-centered-service", "evidence must follow the resolved id");
  assert.ok(result.findings.some((f) => f.action === "repaired" && f.message.includes("resolved")));
});

test("resolution + deterministic ids: the resolved id survives, distinct concepts do not merge", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "servicestandard:abc123", label: "ServiceStandard", properties: { name: "Hot towel on arrival" } }
  );
  const result = runGate(
    {
      vertices: [
        { id: "standard:hot-towels", label: "ServiceStandard", properties: { name: "hot towel  on arrival" }, evidence: { traceText: "we hand every guest a hot towel" } },
        { id: "standard:seated-checkin", label: "ServiceStandard", properties: { name: "Seated check-in" }, evidence: { traceText: "we hand every guest a hot towel" } }
      ],
      edges: []
    },
    graph, "hospitality",
    { resolveEntities: true, deterministicIds: true, evidenceContext: { ...CONTEXT, utterance: "we hand every guest a hot towel and seat them for check-in" } }
  );
  const standards = result.delta.vertices.filter((v) => v.label === "ServiceStandard");
  const ids = standards.map((v) => v.id).sort();
  assert.ok(ids.includes("servicestandard:abc123"), "the near-duplicate keeps the existing id, not a fresh hash");
  assert.equal(standards.length, 2, "the genuinely new standard must not be swallowed");
  assert.ok(ids.some((id) => /^servicestandard:[0-9a-f]{16}$/.test(id)), "the new concept still gets a content-derived id");
});

test("two near-duplicates inside one delta collapse onto the first", () => {
  const result = runGate(
    {
      vertices: [
        { id: "signal:rushed-guest", label: "GuestSignal", properties: { name: "Rushed guest signal" }, evidence: { traceText: "you can tell a rushed guest from the doorway" } },
        { id: "signal:guest-rushed", label: "GuestSignal", properties: { name: "rushed guest  signals" }, evidence: { traceText: "you can tell a rushed guest from the doorway" } }
      ],
      edges: []
    },
    EMPTY_GRAPH, "hospitality",
    { resolveEntities: true, evidenceContext: { ...CONTEXT, utterance: "you can tell a rushed guest from the doorway every time" } }
  );
  assert.equal(result.delta.vertices.filter((v) => v.label === "GuestSignal").length, 1);
});

test("a superseded vertex is not a resolution target", () => {
  const graph = {
    vertices: {
      "person:expert": { id: "person:expert", label: "Person", properties: { name: "expert" } },
      "policy:v1": { id: "policy:v1", label: "CheckInPolicy", properties: { standardTime: "3pm" } },
      "policy:v2": { id: "policy:v2", label: "CheckInPolicy", properties: { standardTime: "2pm" } }
    },
    edges: {
      "policy:v1--supersededBy-->policy:v2": { id: "policy:v1--supersededBy-->policy:v2", label: "supersededBy", out: "policy:v1", in: "policy:v2", properties: {} }
    }
  };
  const result = runGate(
    { vertices: [{ id: "policy:new", label: "CheckInPolicy", properties: { standardTime: "3pm" }, evidence: { traceText: "check-in is at 3pm sharp" } }], edges: [] },
    graph, "hospitality",
    { resolveEntities: true, temporalContradictions: true, evidenceContext: { ...CONTEXT, utterance: "check-in is at 3pm sharp for everyone" } }
  );
  assert.ok(
    !result.delta.vertices.some((v) => v.id === "policy:v1"),
    "resolution must not resurrect the superseded version"
  );
});


test("an id the extractor correctly reused is never re-hashed into a fork", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "servicestandard:aaaa1111bbbb2222", label: "ServiceStandard", properties: { name: "Secondary revenue utilization", standardText: "Guests should use the spa and restaurant" } }
  );
  const result = runGate(
    {
      vertices: [{
        id: "servicestandard:aaaa1111bbbb2222", label: "ServiceStandard",
        properties: { name: "Secondary revenue utilization" },
        evidence: { traceText: "an excellent experience is going to utilize our other services" }
      }],
      edges: []
    },
    graph, "hospitality",
    { resolveEntities: true, deterministicIds: true, evidenceContext: { ...CONTEXT, utterance: "having an excellent experience is going to utilize our other services as well" } }
  );
  const standard = result.delta.vertices.find((v) => v.label === "ServiceStandard");
  assert.equal(standard.id, "servicestandard:aaaa1111bbbb2222", "partial-property restatement must merge, not fork");
});

test("keyText falls back to any string property for labels without a name", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "constraint:seasonality", label: "ContextualConstraint", properties: { constraintType: "seasonality", seasonality: "monsoon slows corporate bookings" } }
  );
  const result = runGate(
    { vertices: [{ id: "constraint:new", label: "ContextualConstraint", properties: { constraintType: "seasonality" }, evidence: { traceText: "monsoon season slows down our corporate bookings" } }], edges: [] },
    graph, "hospitality",
    { resolveEntities: true, evidenceContext: { ...CONTEXT, utterance: "the monsoon season slows down our corporate bookings a lot" } }
  );
  const constraint = result.delta.vertices.find((v) => v.label === "ContextualConstraint");
  assert.equal(constraint.id, "constraint:seasonality", "constraintType must be visible to resolution");
});


// --- edge grounding (iteration 05) ----------------------------------------

test("a relationship claim carries its evidence on the edge itself", () => {
  const result = runGate(
    {
      vertices: [
        knowledge("standard:hot-towel", "ServiceStandard", { name: "Hot towel on arrival" }, "we hand every guest a hot towel the moment they walk in"),
        knowledge("principle:warm-welcome", "GuestExperiencePrinciple", { name: "Warm welcome" }, "we hand every guest a hot towel the moment they walk in")
      ],
      edges: [{
        id: "e:1", label: "standardEnforces", out: "standard:hot-towel", in: "principle:warm-welcome",
        evidence: { traceText: "we hand every guest a hot towel the moment they walk in", confidence: "high" }
      }]
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const edge = result.delta.edges.find((e) => e.label === "standardEnforces");
  assert.ok(edge, "the semantic edge must be admitted");
  assert.equal(edge.properties.traceText, "we hand every guest a hot towel the moment they walk in");
  assert.equal(edge.properties.confidence, "high");
});

test("edge evidence that is not a span is flagged and dropped from the edge, not the graph", () => {
  const result = runGate(
    {
      vertices: [
        knowledge("standard:a", "ServiceStandard", { name: "Hot towel" }, "we hand every guest a hot towel"),
        knowledge("principle:b", "GuestExperiencePrinciple", { name: "Warmth" }, "we hand every guest a hot towel")
      ],
      edges: [{
        id: "e:1", label: "standardEnforces", out: "standard:a", in: "principle:b",
        evidence: { traceText: "The hotel believes warmth is enforced through amenities." }
      }]
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const edge = result.delta.edges.find((e) => e.label === "standardEnforces");
  assert.ok(edge, "the edge itself survives; only its bad evidence is refused");
  assert.equal(edge.properties.traceText, undefined);
  assert.ok(result.findings.some((f) => f.subjectId === "e:1" && f.message.includes("does not appear")));
});

test("edge properties are filtered to the schema like vertex properties", () => {
  const result = runGate(
    {
      vertices: [
        knowledge("standard:a", "ServiceStandard", { name: "Hot towel" }, "we hand every guest a hot towel"),
        knowledge("principle:b", "GuestExperiencePrinciple", { name: "Warmth" }, "we hand every guest a hot towel")
      ],
      edges: [{
        id: "e:1", label: "standardEnforces", out: "standard:a", in: "principle:b",
        properties: { madeUpField: "should not survive" }
      }]
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const edge = result.delta.edges.find((e) => e.label === "standardEnforces");
  assert.equal(edge.properties.madeUpField, undefined);
});

test("inferred evidence may synthesise across turns without being a span of this one", () => {
  const result = runGate(
    {
      vertices: [{
        id: "heuristic:pattern", label: "OperatingHeuristic",
        properties: { name: "Corporate guests forgive delays when informed early" },
        evidence: { traceText: "Across the conversation: corporate guests accept delays when told in advance and given a plan.", confidence: "inferred" }
      }],
      edges: []
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const evidence = result.delta.vertices.find((v) => v.label === "ProvenanceEvidence");
  assert.ok(evidence, "inferred synthesis must be admissible");
  assert.equal(evidence.properties.confidence, "inferred");
  assert.ok(result.findings.some((f) => f.ruleId === "HR013" && f.action === "flagged"), "and flagged for audit");
});

test("non-inferred evidence still hard-fails the span rule", () => {
  const result = runGate(
    {
      vertices: [{
        id: "standard:x", label: "ServiceStandard", properties: { name: "Hot towel" },
        evidence: { traceText: "The expert has a strong belief in towel service quality.", confidence: "high" }
      }],
      edges: []
    },
    EMPTY_GRAPH, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.ok(!result.delta.vertices.some((v) => v.label === "ProvenanceEvidence"));
  assert.ok(result.findings.some((f) => f.ruleId === "HR012" && f.action === "dropped"));
});

test("retry feedback forbids inventing new facts during correction", () => {
  const result = runGate(
    { vertices: [{ id: "v:1", label: "NotALabel", properties: {} }], edges: [] },
    EMPTY_GRAPH, "hospitality", { evidenceContext: CONTEXT }
  );
  assert.ok(result.retryFeedback.includes("Do NOT add any fact"), "corrections must correct, not expand");
});

test("the tool schema offers evidence on edges", () => {
  const edgeItems = extractionToolSchema("hospitality").properties.edges.items;
  assert.ok(edgeItems.properties.evidence, "edges must accept inline evidence");
});


test("a name contained in an existing name resolves onto it (trial: body language dupes)", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "signal:body-language-cues", label: "GuestSignal", properties: { name: "Body Language Cues" } }
  );
  const result = runGate(
    { vertices: [knowledge("signal:new", "GuestSignal", { name: "body language" }, "read the cues and read the personality of the body language")], edges: [] },
    graph, "hospitality",
    { resolveEntities: true, evidenceContext: { ...CONTEXT, utterance: "it is important to read the cues and read the personality of the body language of the customer" } }
  );
  const signal = result.delta.vertices.find((v) => v.label === "GuestSignal");
  assert.equal(signal.id, "signal:body-language-cues", "the shorter restatement must merge onto the existing concept");
});

test("subset merging never conflates distinct concepts sharing one word", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "rule:early", label: "TimingRule", properties: { ruleText: "early check policy applies" } }
  );
  const result = runGate(
    { vertices: [knowledge("rule:late", "TimingRule", { ruleText: "late check policy applies" }, "we never charge for late checkout before noon")], edges: [] },
    graph, "hospitality",
    { resolveEntities: true, evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const rule = result.delta.vertices.find((v) => v.label === "TimingRule");
  assert.equal(rule.id, "rule:late", "early and late policies are different rules");
});


test("the session export carries transcript, per-turn deltas, and per-fact evidence", () => {
  const gated = runGate(
    {
      vertices: [knowledge("standard:hot-towel", "ServiceStandard", { name: "Hot towel on arrival" }, "hand every guest a hot towel")],
      edges: []
    },
    EMPTY_GRAPH, "hospitality",
    { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const graph = { vertices: { ...EMPTY_GRAPH.vertices }, edges: {} };
  for (const v of gated.delta.vertices) graph.vertices[v.id] = v;
  for (const e of gated.delta.edges) graph.edges[e.id] = e;

  const out = buildSessionExport({
    domainId: "hospitality",
    messages: [
      { id: "a1", role: "assistant", content: "What makes you successful?", createdAt: 1 },
      { id: "u1", role: "user", content: UTTERANCE, createdAt: 2 }
    ],
    graph,
    settings: { voiceEnabled: true, autoSpeak: true },
    turnRecords: [{ userMessageId: "u1", userText: UTTERANCE, delta: gated.delta, warnings: [], createdAt: 3 }]
  });

  assert.equal(out.format, "chatgraph-session/v1");
  assert.equal(out.transcript.length, 2);
  assert.equal(out.turns.length, 1);
  assert.equal(out.turns[0].admitted.vertices.length, gated.delta.vertices.length);
  const fact = out.knowledge.find((k) => k.label === "ServiceStandard");
  assert.ok(fact, "the knowledge view must contain the fact");
  assert.equal(fact.evidence.traceText, "hand every guest a hot towel", "the export must surface the grounding quote");
  assert.equal(out.stats.groundedKnowledgeVertices, 1);
  assert.ok(out.messages, "harness-compatible messages array must remain at top level");
});

// --- frozen replay --------------------------------------------------------

function countFacts(vertices, edges, graph) {
  const labels = new Map(Object.values(graph.vertices).map((v) => [v.id, v.label]));
  for (const v of vertices) labels.set(v.id, v.label);
  let n = 0;
  for (const v of vertices) if (CONTRACT.knowledgeLabels.has(v.label)) n += 1;
  for (const e of edges) {
    if (CONTRACT.knowledgeLabels.has(labels.get(e.out)) && CONTRACT.knowledgeLabels.has(labels.get(e.in))) n += 1;
  }
  return n;
}

function replay(condition, mode) {
  const file = path.join(ROOT, "results/legacy-2026-07-16/raw", `${condition}.jsonl`);
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    .filter((row) => !row.excluded_as_filler && !row.skipped_as_filler);
  const graph = { vertices: { ...EMPTY_GRAPH.vertices }, edges: {} };
  let proposed = 0;
  let admitted = 0;
  for (const row of rows) {
    const delta = row.delta ?? { vertices: [], edges: [] };
    proposed += countFacts(delta.vertices ?? [], delta.edges ?? [], graph);
    const result = runGate(delta, graph, "hospitality", {
      mode,
      evidenceContext: { sourceEpisode: row.utterance_id, speaker: "expert" }
    });
    admitted += countFacts(result.delta.vertices, result.delta.edges, graph);
    for (const vertex of result.delta.vertices) graph.vertices[vertex.id] = vertex;
    for (const edge of result.delta.edges) graph.edges[edge.id] = edge;
  }
  return { proposed, admitted, turns: rows.length };
}

const ARCHIVED_RAW = path.join(ROOT, "results/legacy-2026-07-16/raw");

test("per-fact admission recovers the facts per-delta rejection discarded", () => {
  if (!fs.existsSync(ARCHIVED_RAW)) {
    // The archived rows quote the expert verbatim and are not committed.
    process.stdout.write("    replay: skipped (archived evidence not present locally)\n");
    return;
  }
  // Published per-delta figures from results/results.md, recomputed per fact here.
  const a3 = replay("A3", "schema");
  assert.equal(a3.turns, 32, "eligible turn count changed");
  assert.ok(
    a3.admitted >= 45,
    `A3 per-fact admission should far exceed the published per-delta 29/48; got ${a3.admitted}/${a3.proposed}`
  );

  const a5 = replay("A5", "governed");
  assert.ok(
    a5.admitted >= 40,
    `A5 governed per-fact admission should far exceed the published per-delta 3/61; got ${a5.admitted}/${a5.proposed}`
  );

  process.stdout.write(
    `    replay: A3 ${a3.admitted}/${a3.proposed} per-fact (published per-delta 29/48)\n` +
    `            A5 ${a5.admitted}/${a5.proposed} per-fact (published per-delta 3/61)\n`
  );
});


// --- constraint classes iv and v ------------------------------------------


test("evidence must be a span of the utterance, not the model's own prose", () => {
  const result = runGate(
    { vertices: [knowledge("v:1", "ServiceStandard", { name: "Hot towel" }, "The hotel provides a warm welcome amenity to arriving visitors.")], edges: [] },
    EMPTY_GRAPH, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.ok(
    result.findings.some((f) => f.ruleId === "HR012" && f.message.includes("does not appear")),
    "a plausible paraphrase that was never said must be rejected"
  );
  assert.ok(!result.delta.vertices.some((v) => v.label === "ProvenanceEvidence"));
});

test("echoing the whole utterance no longer satisfies the anti-generic rule", () => {
  const result = runGate(
    { vertices: [knowledge("v:1", "ServiceStandard", { name: "Hot towel" }, UTTERANCE)], edges: [] },
    EMPTY_GRAPH, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.ok(
    result.findings.some((f) => f.ruleId === "HR012" && f.message.includes("restates the whole utterance")),
    "citing the entire turn identifies no particular claim"
  );
});

test("a genuine span is accepted", () => {
  const result = runGate(
    { vertices: [knowledge("v:1", "ServiceStandard", { name: "Hot towel" }, "we hand every guest a hot towel the moment they walk in")], edges: [] },
    EMPTY_GRAPH, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.ok(!result.findings.some((f) => f.ruleId === "HR012"), JSON.stringify(result.findings));
  assert.ok(result.delta.vertices.some((v) => v.label === "ProvenanceEvidence"));
});

test("deterministic ids make the same fact idempotent regardless of the id the model picks", () => {
  const trace = "we hand every guest a hot towel the moment they walk in";
  const run = (id) => runGate(
    { vertices: [knowledge(id, "ServiceStandard", { name: "Hot towel on arrival" }, trace)], edges: [] },
    EMPTY_GRAPH, "hospitality",
    { deterministicIds: true, evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const first = run("standard:hot-towel");
  const second = run("standard:towels-on-arrival");
  const idOf = (r) => r.delta.vertices.find((v) => v.label === "ServiceStandard").id;
  assert.equal(idOf(first), idOf(second), "identical content must collapse onto one id");
  assert.match(idOf(first), /^servicestandard:[0-9a-f]{16}$/);

  const different = runGate(
    { vertices: [knowledge("standard:x", "ServiceStandard", { name: "Late checkout is free before noon" }, "we never charge for late checkout before noon")], edges: [] },
    EMPTY_GRAPH, "hospitality",
    { deterministicIds: true, evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.notEqual(idOf(different), idOf(first), "different content must not collide");
});

test("a changed singleton supersedes its predecessor instead of overwriting it", () => {
  const graph = graphWith(
    { id: "policy:checkin:v1", label: "CheckInPolicy", properties: { standardTime: "3pm" } }
  );
  const result = runGate(
    { vertices: [knowledge("policy:checkin:v2", "CheckInPolicy", { standardTime: "2pm" }, "we hand every guest a hot towel")], edges: [] },
    graph, "hospitality",
    { temporalContradictions: true, evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.equal(result.supersessions.length, 1);
  assert.equal(result.supersessions[0].supersededId, "policy:checkin:v1");
  const edge = result.delta.edges.find((e) => e.label === "supersededBy");
  assert.ok(edge, "an invalidation edge must be written");
  assert.equal(edge.out, "policy:checkin:v1", "the old fact points at the new one and is retained");
  assert.ok(result.delta.vertices.some((v) => v.id === "policy:checkin:v2"));
});

test("an unchanged singleton is a no-op, not a contradiction", () => {
  const graph = graphWith(
    { id: "policy:checkin:v1", label: "CheckInPolicy", properties: { standardTime: "3pm" } }
  );
  const result = runGate(
    { vertices: [knowledge("policy:checkin:restated", "CheckInPolicy", { standardTime: "3pm" }, "we hand every guest a hot towel")], edges: [] },
    graph, "hospitality",
    { temporalContradictions: true, evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.equal(result.supersessions.length, 0);
  assert.ok(!result.delta.edges.some((e) => e.label === "supersededBy"));
});

test("the extractor is never offered the gate-authored supersession edge", () => {
  const edgeLabels = extractionToolSchema("hospitality").properties.edges.items.properties.label.enum;
  assert.ok(!edgeLabels.includes("supersededBy"));
  assert.ok(!schemaReference("hospitality").includes("supersededBy"));
});

// --- iteration 07: identity consistency, edge witnesses, filler -----------

test("a reused id whose content names a different concept gets its own identity (D-06-1)", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "guestsignal:aaaa1111bbbb2222", label: "GuestSignal", properties: { name: "Loyalty program tier interest" } }
  );
  const result = runGate(
    {
      vertices: [{
        id: "guestsignal:aaaa1111bbbb2222", label: "GuestSignal",
        properties: { name: "Suspicion of staff theft" },
        evidence: { traceText: "we hand every guest a hot towel" }
      }],
      edges: []
    },
    graph, "hospitality",
    { deterministicIds: true, evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const insight = result.delta.vertices.find((v) => v.label === "GuestSignal");
  assert.notEqual(insight.id, "guestsignal:aaaa1111bbbb2222", "a different concept must not overwrite the stored one");
  assert.match(insight.id, /^guestsignal:[0-9a-f]{16}$/);
  assert.ok(
    result.findings.some((f) => f.ruleId === "HR009" && f.action === "repaired" && f.message.includes("different concept")),
    "the de-collision must be reported"
  );
});

test("a reused id whose content matches the stored concept still merges (D-06-1 guard)", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "guestsignal:aaaa1111bbbb2222", label: "GuestSignal", properties: { name: "Loyalty program tier interest" } }
  );
  const result = runGate(
    {
      vertices: [{
        id: "guestsignal:aaaa1111bbbb2222", label: "GuestSignal",
        properties: { name: "loyalty program  tier interest" },
        evidence: { traceText: "we hand every guest a hot towel" }
      }],
      edges: []
    },
    graph, "hospitality",
    { deterministicIds: true, evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  const insight = result.delta.vertices.find((v) => v.label === "GuestSignal");
  assert.equal(insight.id, "guestsignal:aaaa1111bbbb2222", "the same concept restated must keep merging");
});

test("HR026: a cross-turn edge between two existing entities needs its own witness", () => {
  assert.equal(CONTRACT.severities.get("HR026"), "hard", "HR026 severity must come from the spec");
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "standard:a", label: "ServiceStandard", properties: { name: "Hot towel" } },
    { id: "principle:b", label: "GuestExperiencePrinciple", properties: { name: "Warmth" } }
  );
  const witnessless = runGate(
    { vertices: [], edges: [{ id: "e:1", label: "standardEnforces", out: "standard:a", in: "principle:b" }] },
    graph, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.ok(!witnessless.delta.edges.some((e) => e.label === "standardEnforces"), "no witness, no edge");
  assert.ok(witnessless.findings.some((f) => f.ruleId === "HR026" && f.action === "dropped"));
  assert.ok(witnessless.retryFeedback?.includes("HR026"), "the drop must be retryable");

  const witnessed = runGate(
    {
      vertices: [],
      edges: [{
        id: "e:1", label: "standardEnforces", out: "standard:a", in: "principle:b",
        evidence: { traceText: "we hand every guest a hot towel the moment they walk in" }
      }]
    },
    graph, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.ok(witnessed.delta.edges.some((e) => e.label === "standardEnforces"), "a span-valid witness admits the edge");
  assert.ok(!witnessed.findings.some((f) => f.ruleId === "HR026"));
});

test("HR026 exempts an edge whose endpoint is asserted in this very turn", () => {
  const graph = graphWith(
    { id: "person:expert", label: "Person", properties: { name: "expert" } },
    { id: "principle:b", label: "GuestExperiencePrinciple", properties: { name: "Warmth" } }
  );
  const result = runGate(
    {
      vertices: [knowledge("standard:new", "ServiceStandard", { name: "Hot towel" }, "we hand every guest a hot towel")],
      edges: [{ id: "e:1", label: "standardEnforces", out: "standard:new", in: "principle:b" }]
    },
    graph, "hospitality", { evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.ok(!result.findings.some((f) => f.ruleId === "HR026"), "a fresh endpoint is itself the turn's witness");
  assert.ok(result.delta.edges.some((e) => e.label === "standardEnforces"));
});

test("two singleton candidates in one delta collapse to the first", () => {
  const result = runGate(
    {
      vertices: [
        knowledge("policy:a", "CheckInPolicy", { standardTime: "3pm" }, "we hand every guest a hot towel"),
        knowledge("policy:b", "CheckInPolicy", { standardTime: "2pm" }, "we never charge for late checkout")
      ],
      edges: []
    },
    EMPTY_GRAPH, "hospitality",
    { temporalContradictions: true, evidenceContext: { ...CONTEXT, utterance: UTTERANCE } }
  );
  assert.equal(result.delta.vertices.filter((v) => v.label === "CheckInPolicy").length, 1, "one singleton per delta");
  assert.ok(result.findings.some((f) => f.ruleId === "HR009" && f.subjectId === "policy:b"));
});

test("filler turns are recognized and skip extraction entirely", async () => {
  for (const filler of ["Continue", "Okay, sounds great. Let's go", "No let's move on", "yes", "move on"]) {
    assert.ok(isFillerTurn(filler), `"${filler}" must be classified as filler`);
  }
  for (const substantive of ["The staff is the bottleneck", "No, early check-in is never free", "I think trust matters most"]) {
    assert.ok(!isFillerTurn(substantive), `"${substantive}" must NOT be classified as filler`);
  }
  const stub = stubOpenAI({ vertices: [], edges: [] });
  const result = await extractGovernedDelta(stub.client, "Continue", {
    domainId: "hospitality",
    messages: [{ id: "m1", role: "user", content: "Continue", createdAt: 0 }],
    graph: EMPTY_GRAPH
  });
  assert.equal(stub.calls.length, 0, "no extractor call on a filler turn");
  assert.equal(result.delta.vertices.length, 0, "not even an episode is recorded for navigation");
});

test("episode ids derive from the message id, not a vertex count", async () => {
  const stub = stubOpenAI({ vertices: [], edges: [] });
  const messageId = "0c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
  const result = await extractGovernedDelta(stub.client, "We greet every guest by name at the door.", {
    domainId: "hospitality",
    messages: [{ id: messageId, role: "user", content: "We greet every guest by name at the door.", createdAt: 0 }],
    graph: EMPTY_GRAPH
  });
  const episode = result.delta.vertices.find((v) => v.label === "TranscriptEpisode");
  assert.ok(episode, "a substantive turn records its episode");
  assert.equal(episode.id, `ep:session:hospitality:default:m${messageId.replace(/-/g, "").slice(0, 10)}`);
});

test("the gate report tells the whole story: attempts, findings, and the retry that fixed it", async () => {
  const stub = stubOpenAI([
    {
      vertices: [{ id: "standard:a", label: "ServiceStandard", properties: { name: "Warm welcome" }, evidence: { traceText: "greet every guest by name" } }],
      edges: [{ id: "e:bad", label: "standardEnforces", out: "standard:a", in: "principle:missing" }]
    },
    {
      vertices: [
        { id: "standard:a", label: "ServiceStandard", properties: { name: "Warm welcome" }, evidence: { traceText: "greet every guest by name" } },
        { id: "principle:warmth", label: "GuestExperiencePrinciple", properties: { name: "Warmth" }, evidence: { traceText: "greet every guest by name" } }
      ],
      edges: [{ id: "e:good", label: "standardEnforces", out: "standard:a", in: "principle:warmth" }]
    }
  ]);
  const result = await extractGovernedDelta(stub.client, "We greet every guest by name.", {
    domainId: "hospitality",
    messages: [{ id: "m1", role: "user", content: "We greet every guest by name.", createdAt: 0 }],
    graph: EMPTY_GRAPH
  });

  assert.equal(result.gate.attempts.length, 2, "both attempts must be reported");
  assert.equal(result.gate.chosenAttempt, 2, "the corrected attempt must be the chosen one");
  const first = result.gate.attempts[0];
  assert.ok(first.findings.some((f) => f.ruleId === "HR005" && f.action === "dropped"), "the rejection must be visible in the report");
  assert.ok(first.retryFeedback, "the correction sent back must be recorded");
  assert.equal(first.proposedVertices, 1, "proposal counts must exclude the deterministic scaffold");
  const second = result.gate.attempts[1];
  assert.ok(second.admittedVertices > second.proposedVertices, "admitted includes gate-materialized evidence vertices");
});

test("a filler turn is reported as skipped, not as an empty extraction", async () => {
  const stub = stubOpenAI({ vertices: [], edges: [] });
  const result = await extractGovernedDelta(stub.client, "Continue", {
    domainId: "hospitality",
    messages: [{ id: "m1", role: "user", content: "Continue", createdAt: 0 }],
    graph: EMPTY_GRAPH
  });
  assert.equal(result.gate.skippedAsFiller, true);
  assert.equal(result.gate.chosenAttempt, 0);
  assert.equal(result.gate.attempts.length, 0);
});

test("the export bundle carries the gate report, the gate log aggregates it, and the audit input derives from it", async () => {
  const stub = stubOpenAI({
    vertices: [{
      id: "standard:hot-towel", label: "ServiceStandard",
      properties: { name: "Hot towel on arrival" },
      evidence: { traceText: "hand every guest a hot towel", confidence: "high" }
    }],
    edges: []
  });
  const message = { id: "0c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f", role: "user", content: "We hand every guest a hot towel the moment they walk in.", createdAt: 2 };
  const body = { domainId: "hospitality", messages: [message], graph: EMPTY_GRAPH };
  const result = await extractGovernedDelta(stub.client, message.content, body);

  const graph = { vertices: { ...EMPTY_GRAPH.vertices }, edges: {} };
  for (const v of result.delta.vertices) graph.vertices[v.id] = v;
  for (const e of result.delta.edges) graph.edges[e.id] = e;
  const session = {
    domainId: "hospitality",
    messages: [{ id: "a1", role: "assistant", content: "What makes you special?", createdAt: 1 }, message],
    graph,
    settings: { voiceEnabled: false, autoSpeak: false },
    turnRecords: [{ userMessageId: message.id, userText: message.content, delta: result.delta, warnings: result.warnings, gate: result.gate, createdAt: 3 }]
  };

  const built = buildSessionExport(session);
  assert.ok(built.build, "the export must say which build produced it");
  assert.equal(built.turns[0].gate.chosenAttempt, 1, "the per-turn gate report must be in the export");

  const log = buildGateLog(session, built.build);
  assert.equal(log.format, "chatgraph-gatelog/v1");
  assert.equal(log.summary.totalAttempts, 1);
  assert.equal(log.summary.chosenAttemptTotals.proposedVertices, 1);
  assert.ok(log.summary.chosenAttemptTotals.admittedVertices >= 2, "admitted counts include materialized evidence");
  assert.equal(log.turns[0].gate.attempts.length, 1);

  const audit = deriveAuditInput(built, "test-session");
  assert.equal(audit.facts.length, 1);
  assert.equal(audit.facts[0].trace, "hand every guest a hot towel");
  assert.equal(audit.facts[0].uttIdx, 1, "attribution must go through the admitting turn record");
  assert.equal(audit.spanPreCheck.ok, 1);
  assert.equal(audit.spanPreCheck.fail, 0);
});

test("assertion-only property guidance is derived from the schema's type declarations", () => {
  const text = provenanceInstructions("hospitality");
  assert.ok(text.includes("ASSERTION-ONLY"), "the padding guard must be present");
  const listed = text.match(/ASSERTION-ONLY[^:]*: ([^.]+)\./)?.[1] ?? "";
  for (const prop of listed.split(", ")) {
    const declared = [...CONTRACT.vertexSpecs.values()].some(
      (spec) => spec.propertyTypes?.get(prop) === "boolean" || spec.propertyTypes?.get(prop) === "integer"
    );
    assert.ok(declared, `"${prop}" is listed but not a declared boolean/integer property`);
  }
});

// --- report ---------------------------------------------------------------

await Promise.all(pending);

if (failures.length > 0) {
  process.stdout.write(`\nGate conformance: ${passed} passed, ${failures.length} FAILED\n\n`);
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Gate conformance: ${passed} checks passed.\n`);
}
