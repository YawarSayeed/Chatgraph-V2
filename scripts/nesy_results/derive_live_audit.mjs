/**
 * Derive the live-audit input from a session export — the step that was done by
 * hand for iteration 06, automated.
 *
 * Usage:
 *   node --import ./scripts/ts-alias-hooks.mjs scripts/nesy_results/derive_live_audit.mjs <session-export.json> [out.json]
 *
 * Reads a `chatgraph-session/v1` export and writes the facts/edges audit input
 * consumed by aggregate_live_audit.mjs (and handed to the judge workflow):
 * every knowledge vertex and every semantic edge, each with its grounding trace
 * and the 1-based index of the user utterance it was extracted from.
 *
 * Utterance attribution never trusts episode-id arithmetic. Iteration 06's one
 * audit error came from assuming the export's `turns` array is ordered by
 * utterance time (it is ordered by extraction *completion*, and two concurrent
 * voice turns once minted the same count-based episode id). Here each item is
 * attributed through the turn record that admitted it — `turns[i].userMessageId`
 * → position among user messages — which is collision-proof, and the evidence's
 * sourceEpisode is only used as a cross-check, reported when it disagrees.
 */

import fs from "node:fs";
import path from "node:path";
import { gateContract } from "../../lib/gate/contract.ts";
import { keyText } from "../../lib/gate/gate.ts";

const [exportPath, outArg] = process.argv.slice(2);
if (!exportPath) {
  console.error("usage: derive_live_audit.mjs <session-export.json> [out.json]");
  process.exit(1);
}

const session = JSON.parse(fs.readFileSync(exportPath, "utf8"));
if (session.format !== "chatgraph-session/v1") {
  console.error(`unexpected export format: ${session.format ?? "(none)"}`);
  process.exit(1);
}
if (!session.graph || !session.turns) {
  console.error(
    "this export carries only the transcript (no graph/turns): it was produced by a build that predates " +
    "the research export. Redeploy the app and re-export, or derive the audit input by hand as in iteration 06."
  );
  process.exit(1);
}

const domainId = session.domainId ?? "hospitality";
const contract = gateContract(domainId);

// The export serializes the graph as arrays; the in-app state keys by id.
// Accept both so the deriver also runs on raw state dumps.
const asMap = (value) =>
  Array.isArray(value) ? Object.fromEntries(value.map((item) => [item.id, item])) : (value ?? {});
const graph = { vertices: asMap(session.graph.vertices), edges: asMap(session.graph.edges) };
const sessionName = path.basename(exportPath).replace(/\.json$/, "");

// --- utterance attribution -------------------------------------------------

// 1-based index of each user message, in utterance-time order. The export's
// `transcript` view drops message ids, so attribution reads the harness-facing
// `messages` array, which preserves them.
const userMessages = (session.messages ?? [])
  .filter((m) => m.role === "user")
  .map((m) => ({ id: m.id, content: m.content }));
const uttIdxByMessageId = new Map(userMessages.map((m, i) => [m.id, i + 1]));

// Which turn admitted each vertex/edge id. Later turns never overwrite an
// earlier claim: the first admitting turn is the extraction event.
const turnByItemId = new Map();
for (const turn of session.turns ?? []) {
  for (const v of turn.admitted?.vertices ?? []) {
    if (!turnByItemId.has(v.id)) turnByItemId.set(v.id, turn);
  }
  for (const e of turn.admitted?.edges ?? []) {
    if (!turnByItemId.has(e.id)) turnByItemId.set(e.id, turn);
  }
}

// Episode id → uttIdx, via the turn that scaffolded it (collision-aware).
const episodeUtt = new Map();
const episodeCollisions = [];
for (const turn of session.turns ?? []) {
  const idx = uttIdxByMessageId.get(turn.userMessageId);
  for (const v of turn.admitted?.vertices ?? []) {
    if (v.label !== "TranscriptEpisode") continue;
    if (episodeUtt.has(v.id) && episodeUtt.get(v.id) !== idx) episodeCollisions.push(v.id);
    else episodeUtt.set(v.id, idx);
  }
}

function uttIdxOf(itemId, sourceEpisode) {
  const turn = turnByItemId.get(itemId);
  const byTurn = turn ? uttIdxByMessageId.get(turn.userMessageId) : undefined;
  const byEpisode = sourceEpisode ? episodeUtt.get(sourceEpisode) : undefined;
  return { uttIdx: byTurn ?? byEpisode ?? null, disagreement: byTurn && byEpisode && byTurn !== byEpisode };
}

// --- classify the graph ----------------------------------------------------

const superseded = new Set();
for (const e of Object.values(graph.edges)) if (e.label === "supersededBy") superseded.add(e.out);

const evidenceByOwner = new Map();
for (const e of Object.values(graph.edges)) {
  if (!contract.provenanceEdgeLabels.has(e.label)) continue;
  const evidence = graph.vertices[e.in];
  if (evidence) evidenceByOwner.set(e.out, evidence);
}

const facts = [];
const disagreements = [];
for (const v of Object.values(graph.vertices)) {
  if (!contract.knowledgeLabels.has(v.label) || superseded.has(v.id)) continue;
  const evidence = evidenceByOwner.get(v.id);
  const { uttIdx, disagreement } = uttIdxOf(v.id, evidence?.properties?.sourceEpisode);
  if (disagreement) disagreements.push(v.id);
  facts.push({
    id: v.id,
    label: v.label,
    props: v.properties,
    trace: evidence?.properties?.traceText ?? null,
    ...(evidence?.properties?.confidence ? { confidence: evidence.properties.confidence } : {}),
    uttIdx
  });
}
facts.sort((a, b) => (a.uttIdx ?? 999) - (b.uttIdx ?? 999) || a.id.localeCompare(b.id));

const semanticLabel = (id) => {
  const v = graph.vertices[id];
  return v && (contract.knowledgeLabels.has(v.label) || v.label === "Person");
};
const edges = [];
for (const e of Object.values(graph.edges)) {
  if (contract.provenanceEdgeLabels.has(e.label) || e.label === "supersededBy") continue;
  if (!semanticLabel(e.out) || !semanticLabel(e.in)) continue;
  if (superseded.has(e.out) || superseded.has(e.in)) continue;
  const outV = graph.vertices[e.out];
  const inV = graph.vertices[e.in];
  const { uttIdx } = uttIdxOf(e.id, undefined);
  edges.push({
    rel: `${outV.label}(${keyText(outV.properties) || outV.id}) --${e.label}--> ${inV.label}(${keyText(inV.properties) || inV.id})`,
    trace: e.properties?.traceText ?? null,
    uttIdx
  });
}
edges.sort((a, b) => (a.uttIdx ?? 999) - (b.uttIdx ?? 999) || a.rel.localeCompare(b.rel));

// --- deterministic pre-checks (informational; the aggregate recomputes) -----

let spanOk = 0;
let spanFail = 0;
for (const f of facts) {
  if (!f.trace || !f.uttIdx) continue;
  const utterance = userMessages[f.uttIdx - 1]?.content ?? "";
  const normalize = (t) => t.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalize(utterance).includes(normalize(f.trace))) spanOk += 1;
  else spanFail += 1;
}

const out = {
  session: sessionName,
  note:
    "Derived mechanically by derive_live_audit.mjs. uttIdx is the 1-based index into the session's user messages, " +
    "attributed through the admitting turn record (collision-proof), with the evidence episode as cross-check.",
  exportStats: {
    vertices: Object.keys(graph.vertices).length,
    edges: Object.keys(graph.edges).length,
    knowledgeVertices: facts.length + [...superseded].filter((id) => contract.knowledgeLabels.has(graph.vertices[id]?.label)).length,
    groundedKnowledgeVertices: facts.filter((f) => f.trace).length,
    semanticEdges: edges.length,
    groundedSemanticEdges: edges.filter((e) => e.trace).length,
    supersededFacts: superseded.size
  },
  attribution: {
    episodeCollisions,
    turnVsEpisodeDisagreements: disagreements,
    unattributed: facts.filter((f) => !f.uttIdx).length
  },
  facts,
  edges
};

const outPath = outArg ?? path.join("data", "live_audit", `facts-${sessionName.replace(/^chatgraph-/, "")}.json`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`wrote ${outPath}`);
console.log(`  facts: ${facts.length} (${out.exportStats.groundedKnowledgeVertices} grounded), edges: ${edges.length} (${out.exportStats.groundedSemanticEdges} grounded)`);
console.log(`  span pre-check: ${spanOk} ok, ${spanFail} fail (of grounded+attributed)`);
if (episodeCollisions.length) console.log(`  episode-id collisions: ${episodeCollisions.join(", ")}`);
if (disagreements.length) console.log(`  turn-vs-episode disagreements: ${disagreements.join(", ")}`);
if (out.attribution.unattributed) console.log(`  unattributed facts: ${out.attribution.unattributed}`);
