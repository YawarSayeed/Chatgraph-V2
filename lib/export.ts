import { getDomain } from "./domains";
import { gateContract } from "./gate/contract";
import { keyText, SUPERSEDED_BY } from "./gate/gate";
import type { ChatSession, GraphVertex, JsonValue } from "./types";

export function exportTranscriptTxt(session: ChatSession): void {
  const userLabel = getDomain(session.domainId).userLabel;
  const lines = session.messages.map((message) => {
    const speaker = message.role === "assistant" ? "agent" : userLabel;
    return `${speaker}: ${message.content}`;
  });
  downloadText(`chatgraph-${stamp()}.txt`, lines.join("\n\n"), "text/plain");
}

/**
 * The research export: everything the pipeline knew about this session in one
 * self-describing JSON — the transcript, what extraction admitted per dialogue
 * turn, the full graph, and a knowledge view giving each fact its evidence and
 * relationships. Top-level `domainId` + `messages` keep the shape the evaluation
 * harness already reads, so the same file is both corpus and analysis artifact.
 */
export function exportSessionJson(session: ChatSession): void {
  downloadText(`chatgraph-${stamp()}.json`, JSON.stringify(buildSessionExport(session), null, 2), "application/json");
}

export function buildSessionExport(session: ChatSession) {
  const domain = getDomain(session.domainId);
  const contract = gateContract(session.domainId);
  const vertices = Object.values(session.graph.vertices);
  const edges = Object.values(session.graph.edges);

  const superseded = new Set(edges.filter((edge) => edge.label === SUPERSEDED_BY).map((edge) => edge.out));

  // Evidence lookup: knowledge vertex id -> its ProvenanceEvidence vertex.
  const evidenceFor = new Map<string, GraphVertex>();
  for (const edge of edges) {
    if (!contract.provenanceEdgeLabels.has(edge.label)) continue;
    const target = session.graph.vertices[edge.in];
    if (target?.label === contract.evidenceLabel) evidenceFor.set(edge.out, target);
  }

  const isKnowledge = (vertex: GraphVertex | undefined): vertex is GraphVertex =>
    Boolean(vertex && (contract.governed ? contract.knowledgeLabels.has(vertex.label) : !structuralLabel(vertex.label)));

  const knowledge = vertices.filter(isKnowledge).map((vertex) => {
    const evidence = evidenceFor.get(vertex.id);
    const relations = edges
      .filter(
        (edge) =>
          (edge.out === vertex.id || edge.in === vertex.id) &&
          !contract.provenanceEdgeLabels.has(edge.label) &&
          edge.label !== SUPERSEDED_BY &&
          isKnowledge(session.graph.vertices[edge.out === vertex.id ? edge.in : edge.out])
      )
      .map((edge) => ({
        direction: edge.out === vertex.id ? "out" : "in",
        relation: edge.label,
        otherId: edge.out === vertex.id ? edge.in : edge.out,
        otherName: nameOf(session.graph.vertices[edge.out === vertex.id ? edge.in : edge.out]),
        traceText: stringOrNull(edge.properties?.traceText),
        confidence: stringOrNull(edge.properties?.confidence)
      }));
    return {
      id: vertex.id,
      label: vertex.label,
      name: nameOf(vertex),
      properties: vertex.properties,
      superseded: superseded.has(vertex.id),
      evidence: evidence
        ? {
            traceText: stringOrNull(evidence.properties.traceText),
            confidence: stringOrNull(evidence.properties.confidence),
            sourceEpisode: stringOrNull(evidence.properties.sourceEpisode),
            speaker: stringOrNull(evidence.properties.speaker)
          }
        : null,
      relations
    };
  });

  const semanticEdges = edges.filter(
    (edge) =>
      !contract.provenanceEdgeLabels.has(edge.label) &&
      edge.label !== SUPERSEDED_BY &&
      isKnowledge(session.graph.vertices[edge.out]) &&
      isKnowledge(session.graph.vertices[edge.in])
  );

  const turnRecords = session.turnRecords ?? [];

  return {
    format: "chatgraph-session/v1",
    exportedAt: new Date().toISOString(),
    domainId: session.domainId,
    domainLabel: domain.label,
    userLabel: domain.userLabel,

    // Verbatim conversation, in order (the shape the evaluation harness reads).
    messages: session.messages,
    transcript: session.messages.map((message, index) => ({
      index,
      speaker: message.role === "assistant" ? "agent" : domain.userLabel,
      text: message.content,
      at: new Date(message.createdAt).toISOString()
    })),

    // What extraction admitted per dialogue turn: the gated delta plus warnings.
    turns: turnRecords.map((record, index) => ({
      turn: index + 1,
      userMessageId: record.userMessageId,
      userText: record.userText,
      admitted: {
        vertices: record.delta.vertices,
        edges: record.delta.edges
      },
      warnings: record.warnings,
      at: new Date(record.createdAt).toISOString()
    })),

    // The full graph as persisted.
    graph: { vertices, edges },

    // The analysis view: every knowledge fact with its grounding and relations.
    knowledge,

    stats: {
      messages: session.messages.length,
      userTurns: session.messages.filter((message) => message.role === "user").length,
      recordedTurns: turnRecords.length,
      vertices: vertices.length,
      edges: edges.length,
      knowledgeVertices: knowledge.length,
      groundedKnowledgeVertices: knowledge.filter((item) => item.evidence?.traceText).length,
      semanticEdges: semanticEdges.length,
      groundedSemanticEdges: semanticEdges.filter((edge) => typeof edge.properties?.traceText === "string").length,
      supersededFacts: superseded.size
    }
  };
}

function structuralLabel(label: string): boolean {
  return ["Person", "KnowledgeSession", "SessionSection", "TranscriptEpisode", "ProvenanceEvidence"].includes(label);
}

function nameOf(vertex: GraphVertex | undefined): string {
  if (!vertex) return "";
  return keyText(vertex.properties) || vertex.label;
}

function stringOrNull(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value ? value : null;
}

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}
