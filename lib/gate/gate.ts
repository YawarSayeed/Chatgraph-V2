/**
 * The symbolic gate: a deterministic admission decision for every proposed fact.
 *
 * Two properties matter and are deliberate:
 *
 * 1. Admission is PER FACT, not per delta. A single bad edge drops that edge, not
 *    the turn's knowledge. Replaying the frozen ablation deltas under per-delta
 *    admission yields 60.4% (A3); per-fact admission yields 97.9% of the same
 *    proposals, because whole turns were being discarded over one dangling edge.
 *
 * 2. Provenance is STRUCTURAL, not remembered. The extractor attaches evidence
 *    inline to each knowledge vertex; this module materializes the evidence
 *    vertex and selects the correctly-typed provenance edge from the contract.
 *    An unlinked evidence node and a mistyped provenance edge are therefore not
 *    representable. In the frozen run the extractor emitted 41 evidence nodes but
 *    only 7 provenance edges, which is what collapsed A4 to zero admitted facts.
 *
 * The check is stateless apart from the caller-supplied graph, so any admission
 * decision can be reproduced from the contract and the record's own metadata.
 */

import type { GraphDelta, GraphEdge, GraphState, GraphVertex, JsonValue } from "@/lib/types";
import { gateContract, severityOf, type GateContract, type Severity } from "./contract";

export type GateMode = "schema" | "governed";

/**
 * Turn-level facts the gate fills in on materialized evidence. Supplying these
 * deterministically means the extractor only has to quote the expert; it cannot
 * misattribute a speaker or invent an episode id.
 */
export type EvidenceContext = {
  sourceEpisode: string;
  speaker: string;
};

export type GateOptions = {
  mode?: GateMode;
  evidenceContext?: EvidenceContext;
};

export type GateFinding = {
  ruleId: string;
  severity: Severity;
  message: string;
  subjectId: string | null;
  action: "dropped" | "flagged" | "repaired";
};

export type GateResult = {
  delta: GraphDelta;
  findings: GateFinding[];
  /** Feedback for a bounded retry, or null when nothing hard was rejected. */
  retryFeedback: string | null;
};

type Candidate = {
  id: string;
  label: string;
  properties: Record<string, JsonValue>;
  evidence: Record<string, JsonValue> | null;
};

export function runGate(
  input: unknown,
  graph: GraphState,
  domainId: string,
  options: GateOptions = {}
): GateResult {
  const contract = gateContract(domainId);
  const findings: GateFinding[] = [];
  const governed = (options.mode ?? "governed") === "governed" && contract.governed;

  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) {
    findings.push(finding("HR000", "hard", "extractor returned a non-object delta", null, "dropped"));
  }

  const candidates = parseVertices(raw.vertices, findings);
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];

  // Materialize inline evidence before validation, so the synthesized vertices and
  // edges are held to exactly the same rules as extractor-authored ones.
  const materialized = governed
    ? materializeEvidence(candidates, contract, findings, options.evidenceContext)
    : { vertices: [], edges: [] };

  const admittedVertices: GraphVertex[] = [];
  const labels = new Map<string, string>(
    Object.values(graph.vertices).map((vertex) => [vertex.id, vertex.label])
  );

  for (const candidate of [...candidates, ...materialized.vertices]) {
    const spec = contract.vertexSpecs.get(candidate.label);
    if (!spec) {
      findings.push(finding("HR002", severityOf(contract, "HR002", "hard"), `unknown vertex label ${candidate.label}`, candidate.id, "dropped"));
      continue;
    }
    const properties = pick(candidate.properties, spec.properties);
    const missing = [...spec.requiredProperties].filter((key) => isBlank(properties[key]));
    if (missing.length > 0) {
      findings.push(finding("HR001", severityOf(contract, "HR001", "hard"), `${candidate.id} missing required ${missing.join(", ")}`, candidate.id, "dropped"));
      continue;
    }
    if (governed && !admitEvidenceQuality(candidate.label, properties, contract, findings, candidate.id)) continue;
    if (governed && !admitTextQuality(candidate.label, properties, contract, findings, candidate.id)) continue;
    if (governed && !admitSingleton(candidate, graph, contract, findings)) continue;
    admittedVertices.push({ id: candidate.id, label: candidate.label, properties });
    labels.set(candidate.id, candidate.label);
  }

  const admittedEdges: GraphEdge[] = [];
  const seenEdgeIds = new Set<string>();
  for (const item of [...rawEdges.map(parseEdge), ...materialized.edges]) {
    if (!item) continue;
    const spec = contract.edgeSpecs.get(item.label);
    if (!spec) {
      findings.push(finding("HR003", severityOf(contract, "HR003", "hard"), `unknown edge label ${item.label}`, item.id || null, "dropped"));
      continue;
    }
    if (!labels.has(item.out) || !labels.has(item.in)) {
      findings.push(finding("HR005", severityOf(contract, "HR005", "hard"), `dangling ${item.label}: ${labels.has(item.out) ? item.in : item.out} is not in this delta or the graph`, item.id || null, "dropped"));
      continue;
    }
    const outLabel = labels.get(item.out) ?? "";
    const inLabel = labels.get(item.in) ?? "";
    if (!endpointsConform(contract, item.label, outLabel, inLabel)) {
      findings.push(finding("HR004", severityOf(contract, "HR004", "hard"), `${item.label} connects ${outLabel}->${inLabel}, expected ${expectedEndpoints(contract, item.label)}`, item.id || null, "dropped"));
      continue;
    }
    const id = item.id || `${item.out}--${item.label}-->${item.in}`;
    if (seenEdgeIds.has(id)) continue;
    seenEdgeIds.add(id);
    admittedEdges.push({ id, label: item.label, out: item.out, in: item.in, properties: item.properties });
  }

  // Provenance attachment is checked after admission, on what actually survived.
  if (governed) checkProvenanceAttachment(admittedVertices, admittedEdges, labels, contract, findings);

  const delta: GraphDelta = { vertices: admittedVertices, edges: admittedEdges };
  return { delta, findings, retryFeedback: buildRetryFeedback(findings, contract) };
}

/**
 * Turn each knowledge vertex's inline `evidence` into a ProvenanceEvidence vertex
 * plus the provenance edge the contract assigns to that label.
 */
function materializeEvidence(
  candidates: Candidate[],
  contract: GateContract,
  findings: GateFinding[],
  context?: EvidenceContext
): { vertices: Candidate[]; edges: ParsedEdge[] } {
  const vertices: Candidate[] = [];
  const edges: ParsedEdge[] = [];
  if (!contract.evidenceLabel) return { vertices, edges };

  for (const candidate of candidates) {
    if (!contract.knowledgeLabels.has(candidate.label)) continue;
    if (!candidate.evidence) continue;
    const edgeLabel = contract.provenanceEdgeByLabel.get(candidate.label);
    if (!edgeLabel) {
      findings.push(finding("HR007", severityOf(contract, "HR007", "soft"), `no provenance edge is mapped for ${candidate.label}`, candidate.id, "flagged"));
      continue;
    }
    const evidenceId = `evidence:${candidate.id}`;
    vertices.push({
      id: evidenceId,
      label: contract.evidenceLabel,
      // Turn-level facts come from the gate, not the model; anything the model
      // did supply for them is overwritten rather than trusted.
      properties: {
        ...candidate.evidence,
        ...(context ? { sourceEpisode: context.sourceEpisode, speaker: context.speaker } : {})
      },
      evidence: null
    });
    edges.push({
      id: `${candidate.id}--${edgeLabel}-->${evidenceId}`,
      label: edgeLabel,
      out: candidate.id,
      in: evidenceId,
      properties: {}
    });
    findings.push(finding("HR006", "advisory", `materialized evidence for ${candidate.id} as ${edgeLabel}`, candidate.id, "repaired"));
  }
  return { vertices, edges };
}

function admitEvidenceQuality(
  label: string,
  properties: Record<string, JsonValue>,
  contract: GateContract,
  findings: GateFinding[],
  id: string
): boolean {
  if (label !== contract.evidenceLabel) return true;

  const speaker = asString(properties.speaker);
  if (contract.speakerValues.size > 0 && !contract.speakerValues.has(speaker)) {
    findings.push(finding("HR010", severityOf(contract, "HR010", "hard"), `${id} speaker "${speaker}" is outside the allowed vocabulary`, id, "dropped"));
    return false;
  }
  const confidence = asString(properties.confidence);
  if (confidence && contract.confidenceValues.size > 0 && !contract.confidenceValues.has(confidence)) {
    findings.push(finding("HR011", severityOf(contract, "HR011", "hard"), `${id} confidence "${confidence}" is outside the allowed vocabulary`, id, "dropped"));
    return false;
  }
  const trace = asString(properties.traceText).toLowerCase();
  const banned = contract.bannedTracePatterns.find((pattern) => trace === pattern || trace.startsWith(pattern));
  if (banned) {
    findings.push(finding("HR012", severityOf(contract, "HR012", "hard"), `${id} traceText is generic ("${banned}")`, id, "dropped"));
    return false;
  }
  return true;
}

function admitTextQuality(
  label: string,
  properties: Record<string, JsonValue>,
  contract: GateContract,
  findings: GateFinding[],
  id: string
): boolean {
  for (const rule of contract.textQualityRules) {
    if (rule.label !== label) continue;
    const value = asString(properties[rule.property]).toLowerCase().trim();
    const banned = rule.bannedPatterns.find((pattern) => value === pattern || value.startsWith(pattern));
    if (!banned) continue;
    findings.push(finding(rule.ruleId, rule.severity, `${id} ${rule.property} is generic ("${banned}")`, id, rule.severity === "hard" ? "dropped" : "flagged"));
    if (rule.severity === "hard") return false;
  }
  return true;
}

function admitSingleton(
  candidate: Candidate,
  graph: GraphState,
  contract: GateContract,
  findings: GateFinding[]
): boolean {
  if (!contract.singletonLabels.has(candidate.label)) return true;
  const existing = Object.values(graph.vertices).find((vertex) => vertex.label === candidate.label);
  if (!existing || existing.id === candidate.id) return true;
  findings.push(finding("HR009", severityOf(contract, "HR009", "hard"), `${candidate.label} is a session singleton; ${existing.id} already exists`, candidate.id, "dropped"));
  return false;
}

function checkProvenanceAttachment(
  vertices: GraphVertex[],
  edges: GraphEdge[],
  labels: Map<string, string>,
  contract: GateContract,
  findings: GateFinding[]
): void {
  for (const vertex of vertices) {
    if (!contract.knowledgeLabels.has(vertex.label)) continue;
    const attached = edges.find(
      (edge) =>
        edge.out === vertex.id &&
        contract.provenanceEdgeLabels.has(edge.label) &&
        labels.get(edge.in) === contract.evidenceLabel
    );
    if (!attached) {
      findings.push(finding("HR006", severityOf(contract, "HR006", "soft"), `${vertex.id} has no evidence`, vertex.id, severityOf(contract, "HR006", "soft") === "hard" ? "dropped" : "flagged"));
      continue;
    }
    const expected = contract.provenanceEdgeByLabel.get(vertex.label);
    if (expected && attached.label !== expected) {
      findings.push(finding("HR007", severityOf(contract, "HR007", "soft"), `${vertex.id} uses ${attached.label}, expected ${expected}`, vertex.id, "flagged"));
    }
  }
}

function buildRetryFeedback(findings: GateFinding[], contract: GateContract): string | null {
  const hard = findings.filter((item) => item.severity === "hard" && item.action === "dropped");
  if (hard.length === 0) return null;
  const lines = hard.map((item) => `${item.ruleId}: ${item.message}`);
  const guidance = contract.governed
    ? "Re-emit the complete corrected delta. Every edge endpoint must be a vertex you emit in this same delta or one already in the graph. Attach evidence to each knowledge vertex with its inline evidence field, quoting the expert's own words."
    : "Re-emit the complete corrected delta using only schema labels and edge directions.";
  return `${lines.join("\n")}\n\n${guidance}`;
}

function endpointsConform(contract: GateContract, edgeLabel: string, outLabel: string, inLabel: string): boolean {
  const spec = contract.edgeSpecs.get(edgeLabel);
  if (!spec) return false;
  if (contract.provenanceEdgeLabels.has(edgeLabel)) {
    return Boolean(contract.provenanceOutLabels.get(edgeLabel)?.has(outLabel)) && inLabel === spec.in;
  }
  return outLabel === spec.out && inLabel === spec.in;
}

function expectedEndpoints(contract: GateContract, edgeLabel: string): string {
  const spec = contract.edgeSpecs.get(edgeLabel);
  if (!spec) return "an unknown endpoint pair";
  const allowed = contract.provenanceOutLabels.get(edgeLabel);
  return `${allowed ? [...allowed].join("|") : spec.out}->${spec.in}`;
}

type ParsedEdge = {
  id: string;
  label: string;
  out: string;
  in: string;
  properties: Record<string, JsonValue>;
};

function parseVertices(input: unknown, findings: GateFinding[]): Candidate[] {
  const items = Array.isArray(input) ? input : [];
  const out: Candidate[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      findings.push(finding("HR001", "hard", "vertex is not an object", null, "dropped"));
      continue;
    }
    const id = asString(item.id).trim();
    const label = asString(item.label).trim();
    if (!id || !label) {
      findings.push(finding("HR001", "hard", "vertex is missing id or label", id || null, "dropped"));
      continue;
    }
    out.push({
      id,
      label,
      properties: jsonRecord(item.properties),
      evidence: isRecord(item.evidence) ? jsonRecord(item.evidence) : null
    });
  }
  return out;
}

function parseEdge(item: unknown): ParsedEdge | null {
  if (!isRecord(item)) return null;
  const label = asString(item.label).trim();
  const out = asString(item.out).trim();
  const incoming = asString(item.in).trim();
  if (!label || !out || !incoming) return null;
  return { id: asString(item.id).trim(), label, out, in: incoming, properties: jsonRecord(item.properties) };
}

function finding(
  ruleId: string,
  severity: Severity,
  message: string,
  subjectId: string | null,
  action: GateFinding["action"]
): GateFinding {
  return { ruleId, severity, message, subjectId, action };
}

function pick(properties: Record<string, JsonValue>, allowed: Set<string>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

function jsonRecord(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isJsonValue(item)) out[key] = item;
  }
  return out;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isBlank(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}
