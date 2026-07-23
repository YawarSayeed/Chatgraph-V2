/**
 * Audit-input derivation from a session export — shared between the browser
 * (download bundle) and the CLI (scripts/nesy_results/derive_live_audit.mjs),
 * so there is exactly one implementation of utterance attribution.
 *
 * Utterance attribution never trusts episode-id arithmetic. Iteration 06's one
 * audit error came from assuming the export's `turns` array is ordered by
 * utterance time (it is ordered by extraction *completion*, and two concurrent
 * voice turns once minted the same count-based episode id). Here each item is
 * attributed through the turn record that admitted it — `userMessageId` →
 * position among user messages — which is collision-proof, and the evidence's
 * sourceEpisode is only used as a cross-check, reported when it disagrees.
 */

import { gateContract } from "./gate/contract";
import { keyText } from "./gate/gate";
import type { GraphEdge, GraphVertex, JsonValue } from "./types";

type ExportLike = {
  format?: string;
  domainId?: string;
  messages?: { id: string; role: string; content: string }[];
  turns?: {
    userMessageId: string;
    admitted?: { vertices?: GraphVertex[]; edges?: GraphEdge[] };
  }[];
  graph?: {
    vertices: GraphVertex[] | Record<string, GraphVertex>;
    edges: GraphEdge[] | Record<string, GraphEdge>;
  };
};

export type AuditFact = {
  id: string;
  label: string;
  props: Record<string, JsonValue>;
  trace: string | null;
  confidence?: string;
  uttIdx: number | null;
};

export type AuditEdge = {
  rel: string;
  trace: string | null;
  uttIdx: number | null;
};

export type AuditInput = {
  session: string;
  note: string;
  exportStats: {
    vertices: number;
    edges: number;
    knowledgeVertices: number;
    groundedKnowledgeVertices: number;
    semanticEdges: number;
    groundedSemanticEdges: number;
    supersededFacts: number;
  };
  attribution: {
    episodeCollisions: string[];
    turnVsEpisodeDisagreements: string[];
    unattributed: number;
  };
  spanPreCheck: { ok: number; fail: number };
  facts: AuditFact[];
  edges: AuditEdge[];
};

export function deriveAuditInput(session: ExportLike, sessionName: string): AuditInput {
  if (!session.graph || !session.turns) {
    throw new Error(
      "this export carries only the transcript (no graph/turns): it was produced by a build that predates " +
      "the research export. Redeploy the app and re-export, or derive the audit input by hand as in iteration 06."
    );
  }

  const domainId = session.domainId ?? "hospitality";
  const contract = gateContract(domainId);

  // The export serializes the graph as arrays; the in-app state keys by id.
  const asVertexMap = (value: GraphVertex[] | Record<string, GraphVertex>): Record<string, GraphVertex> =>
    Array.isArray(value) ? Object.fromEntries(value.map((item) => [item.id, item])) : (value ?? {});
  const asEdgeMap = (value: GraphEdge[] | Record<string, GraphEdge>): Record<string, GraphEdge> =>
    Array.isArray(value) ? Object.fromEntries(value.map((item) => [item.id, item])) : (value ?? {});
  const vertices = asVertexMap(session.graph.vertices);
  const edgeMap = asEdgeMap(session.graph.edges);

  // 1-based index of each user message, in utterance-time order. The export's
  // `transcript` view drops message ids, so attribution reads the
  // harness-facing `messages` array, which preserves them.
  const userMessages = (session.messages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => ({ id: m.id, content: m.content }));
  const uttIdxByMessageId = new Map(userMessages.map((m, i) => [m.id, i + 1]));

  // Which turn admitted each vertex/edge id. Later turns never overwrite an
  // earlier claim: the first admitting turn is the extraction event.
  const turnByItemId = new Map<string, { userMessageId: string }>();
  for (const turn of session.turns) {
    for (const v of turn.admitted?.vertices ?? []) {
      if (!turnByItemId.has(v.id)) turnByItemId.set(v.id, turn);
    }
    for (const e of turn.admitted?.edges ?? []) {
      if (!turnByItemId.has(e.id)) turnByItemId.set(e.id, turn);
    }
  }

  // Episode id → uttIdx, via the turn that scaffolded it (collision-aware).
  const episodeUtt = new Map<string, number | undefined>();
  const episodeCollisions: string[] = [];
  for (const turn of session.turns) {
    const idx = uttIdxByMessageId.get(turn.userMessageId);
    for (const v of turn.admitted?.vertices ?? []) {
      if (v.label !== "TranscriptEpisode") continue;
      if (episodeUtt.has(v.id) && episodeUtt.get(v.id) !== idx) episodeCollisions.push(v.id);
      else episodeUtt.set(v.id, idx);
    }
  }

  const uttIdxOf = (itemId: string, sourceEpisode?: string) => {
    const turn = turnByItemId.get(itemId);
    const byTurn = turn ? uttIdxByMessageId.get(turn.userMessageId) : undefined;
    const byEpisode = sourceEpisode ? episodeUtt.get(sourceEpisode) : undefined;
    return { uttIdx: byTurn ?? byEpisode ?? null, disagreement: Boolean(byTurn && byEpisode && byTurn !== byEpisode) };
  };

  const superseded = new Set<string>();
  for (const e of Object.values(edgeMap)) if (e.label === "supersededBy") superseded.add(e.out);

  const evidenceByOwner = new Map<string, GraphVertex>();
  for (const e of Object.values(edgeMap)) {
    if (!contract.provenanceEdgeLabels.has(e.label)) continue;
    const evidence = vertices[e.in];
    if (evidence) evidenceByOwner.set(e.out, evidence);
  }

  const facts: AuditFact[] = [];
  const disagreements: string[] = [];
  for (const v of Object.values(vertices)) {
    if (!contract.knowledgeLabels.has(v.label) || superseded.has(v.id)) continue;
    const evidence = evidenceByOwner.get(v.id);
    const sourceEpisode = evidence?.properties?.sourceEpisode;
    const { uttIdx, disagreement } = uttIdxOf(v.id, typeof sourceEpisode === "string" ? sourceEpisode : undefined);
    if (disagreement) disagreements.push(v.id);
    const trace = evidence?.properties?.traceText;
    const confidence = evidence?.properties?.confidence;
    facts.push({
      id: v.id,
      label: v.label,
      props: v.properties,
      trace: typeof trace === "string" ? trace : null,
      ...(typeof confidence === "string" ? { confidence } : {}),
      uttIdx
    });
  }
  facts.sort((a, b) => (a.uttIdx ?? 999) - (b.uttIdx ?? 999) || a.id.localeCompare(b.id));

  const semanticEndpoint = (id: string) => {
    const v = vertices[id];
    return Boolean(v && (contract.knowledgeLabels.has(v.label) || v.label === "Person"));
  };
  const edges: AuditEdge[] = [];
  for (const e of Object.values(edgeMap)) {
    if (contract.provenanceEdgeLabels.has(e.label) || e.label === "supersededBy") continue;
    if (!semanticEndpoint(e.out) || !semanticEndpoint(e.in)) continue;
    if (superseded.has(e.out) || superseded.has(e.in)) continue;
    const outV = vertices[e.out];
    const inV = vertices[e.in];
    const { uttIdx } = uttIdxOf(e.id);
    const trace = e.properties?.traceText;
    edges.push({
      rel: `${outV.label}(${keyText(outV.properties) || outV.id}) --${e.label}--> ${inV.label}(${keyText(inV.properties) || inV.id})`,
      trace: typeof trace === "string" ? trace : null,
      uttIdx
    });
  }
  edges.sort((a, b) => (a.uttIdx ?? 999) - (b.uttIdx ?? 999) || a.rel.localeCompare(b.rel));

  // Deterministic span pre-check (informational; the aggregate recomputes).
  let ok = 0;
  let fail = 0;
  const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  for (const f of facts) {
    if (!f.trace || !f.uttIdx) continue;
    const utterance = userMessages[f.uttIdx - 1]?.content ?? "";
    if (normalize(utterance).includes(normalize(f.trace))) ok += 1;
    else fail += 1;
  }

  return {
    session: sessionName,
    note:
      "Derived mechanically (lib/audit.ts). uttIdx is the 1-based index into the session's user messages, " +
      "attributed through the admitting turn record (collision-proof), with the evidence episode as cross-check.",
    exportStats: {
      vertices: Object.keys(vertices).length,
      edges: Object.keys(edgeMap).length,
      knowledgeVertices:
        facts.length + [...superseded].filter((id) => contract.knowledgeLabels.has(vertices[id]?.label)).length,
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
    spanPreCheck: { ok, fail },
    facts,
    edges
  };
}
