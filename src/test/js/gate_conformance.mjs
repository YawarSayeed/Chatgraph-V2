/**
 * Conformance tests for the symbolic gate.
 *
 * Run with:  node --import ./scripts/ts-alias-hooks.mjs src/test/js/gate_conformance.mjs
 *
 * Two kinds of check:
 *   - behavioural assertions on admission, materialized provenance, and severity;
 *   - a replay of the frozen ablation deltas in results/raw, which pins the
 *     per-fact admission gain against the published per-delta numbers without
 *     re-running any paid API call.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { gateContract } from "@/lib/gate/contract";
import { runGate } from "@/lib/gate/gate";

const ROOT = process.cwd();
const CONTRACT = gateContract("hospitality");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${error.message.split("\n").join("\n    ")}`);
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

// --- contract -------------------------------------------------------------

test("contract binds the governance spec", () => {
  assert.equal(CONTRACT.governed, true);
  assert.equal(CONTRACT.evidenceLabel, "ProvenanceEvidence");
  assert.equal(CONTRACT.knowledgeLabels.size, 19);
  assert.equal(CONTRACT.severities.get("HR006"), "soft", "HR006 severity must come from the spec, not the implementation");
  assert.equal(CONTRACT.severities.get("HR012"), "hard");
});

test("contract reports schema/spec drift instead of hiding it", () => {
  const ids = CONTRACT.drift.map((item) => item.ruleId).sort();
  assert.deepEqual(ids, ["HR004", "HR004", "HR015"]);
  assert.ok(
    CONTRACT.drift.some((item) => item.ruleId === "HR015" && item.message.includes("heuristicText")),
    "HR015 targets a property the schema does not declare and must be disabled"
  );
});

test("provenance out-labels are the union the spec declares", () => {
  assert.equal(CONTRACT.provenanceOutLabels.get("supportedBy").size, 16);
  assert.ok(CONTRACT.provenanceOutLabels.get("supportedBy").has("ServiceStandard"));
  assert.ok(CONTRACT.provenanceOutLabels.get("heuristicSupportedBy").has("TimingRule"));
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
  const file = path.join(ROOT, "results/raw", `${condition}.jsonl`);
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

test("per-fact admission recovers the facts per-delta rejection discarded", () => {
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

// --- report ---------------------------------------------------------------

if (failures.length > 0) {
  process.stdout.write(`\nGate conformance: ${passed} passed, ${failures.length} FAILED\n\n`);
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Gate conformance: ${passed} checks passed.\n`);
}
