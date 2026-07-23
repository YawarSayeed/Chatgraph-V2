import { getDomain } from "./domains";
import { gateContract } from "./gate/contract";
import { keyText, SUPERSEDED_BY } from "./gate/gate";
import { deriveAuditInput } from "./audit";
import type { ChatSession, GateAttemptReport, GraphVertex, JsonValue, TurnRecord } from "./types";

/**
 * One click, the complete analysis bundle — every input the research pipeline
 * needs from a session, under one shared timestamp:
 *
 *   chatgraph-<stamp>.json             the session export (harness corpus format:
 *                                      transcript, per-turn admitted deltas with
 *                                      gate reports, full graph, knowledge view)
 *   chatgraph-<stamp>-transcript.txt   the conversation, human-readable
 *   chatgraph-<stamp>-audit.json       audit input: every fact and semantic edge
 *                                      with its trace and utterance attribution
 *   chatgraph-<stamp>-gatelog.json     what went right/wrong: every attempt,
 *                                      every finding, rejections, retries
 *
 * Downloads are staggered so the browser treats them as one user gesture.
 */
export function exportSessionBundle(session: ChatSession): void {
  const base = `chatgraph-${stamp()}`;
  const built = buildSessionExport(session);

  const userLabel = getDomain(session.domainId).userLabel;
  const transcript = session.messages
    .map((message) => `${message.role === "assistant" ? "agent" : userLabel}: ${message.content}`)
    .join("\n\n");

  const files: [string, string, string][] = [
    [`${base}.json`, JSON.stringify(built, null, 2), "application/json"],
    [`${base}-transcript.txt`, transcript, "text/plain"],
    [`${base}-audit.json`, JSON.stringify(deriveAuditInput(built, base), null, 2), "application/json"],
    [`${base}-gatelog.json`, JSON.stringify(buildGateLog(session, built.build), null, 2), "application/json"]
  ];
  files.forEach(([name, text, mime], index) => {
    setTimeout(() => downloadText(name, text, mime), index * 300);
  });
}

/**
 * The gate's account of the session: per turn, every extraction attempt with
 * its findings (including hard rejections that never reached the graph), plus
 * an aggregate summary. This is the "what went wrong" file — the session
 * export shows what was admitted; this shows what it cost to admit it.
 */
export function buildGateLog(session: ChatSession, build: { commit: string; branch: string | null }) {
  const turnRecords = session.turnRecords ?? [];

  const findingCounts = new Map<string, number>();
  let totalAttempts = 0;
  let turnsWithRetries = 0;
  let fillerSkipped = 0;
  let proposedVertices = 0;
  let proposedEdges = 0;
  let admittedVertices = 0;
  let admittedEdges = 0;

  for (const record of turnRecords) {
    const gate = record.gate;
    if (!gate) continue;
    if (gate.skippedAsFiller) {
      fillerSkipped += 1;
      continue;
    }
    totalAttempts += gate.attempts.length;
    if (gate.attempts.length > 1) turnsWithRetries += 1;
    const chosen = gate.attempts.find((a: GateAttemptReport) => a.attempt === gate.chosenAttempt);
    if (chosen) {
      proposedVertices += chosen.proposedVertices;
      proposedEdges += chosen.proposedEdges;
      admittedVertices += chosen.admittedVertices;
      admittedEdges += chosen.admittedEdges;
    }
    for (const attempt of gate.attempts) {
      for (const finding of attempt.findings) {
        const key = `${finding.ruleId}|${finding.severity}|${finding.action}`;
        findingCounts.set(key, (findingCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return {
    format: "chatgraph-gatelog/v1",
    exportedAt: new Date().toISOString(),
    domainId: session.domainId,
    build,
    summary: {
      recordedTurns: turnRecords.length,
      turnsSkippedAsFiller: fillerSkipped,
      turnsWithoutGateReport: turnRecords.filter((record: TurnRecord) => !record.gate).length,
      totalAttempts,
      turnsWithRetries,
      chosenAttemptTotals: {
        proposedVertices,
        proposedEdges,
        admittedVertices,
        admittedEdges
      },
      findings: [...findingCounts.entries()]
        .map(([key, count]) => {
          const [ruleId, severity, action] = key.split("|");
          return { ruleId, severity, action, count };
        })
        .sort((a, b) => b.count - a.count)
    },
    turns: turnRecords.map((record, index) => ({
      turn: index + 1,
      userMessageId: record.userMessageId,
      userText: record.userText,
      gate: record.gate ?? null
    }))
  };
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

    // Which build produced this session. Vercel inlines the commit sha at
    // build time; "dev" means a local run.
    build: {
      commit: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "dev",
      branch: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ?? null
    },

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
      // The gate's full account of the turn: every attempt, every finding,
      // including hard rejections that never reached the graph.
      gate: record.gate ?? null,
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
