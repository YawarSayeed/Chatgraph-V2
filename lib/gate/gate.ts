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
import { gateContract, severityOf as contractSeverity, type GateContract, type Severity } from "./contract";

export type GateMode = "schema" | "governed";

/**
 * Turn-level facts the gate fills in on materialized evidence. Supplying these
 * deterministically means the extractor only has to quote the expert; it cannot
 * misattribute a speaker or invent an episode id.
 */
export type EvidenceContext = {
  sourceEpisode: string;
  speaker: string;
  /** The turn being extracted. Evidence is checked for being a span of it. */
  utterance?: string;
};

export type GateOptions = {
  mode?: GateMode;
  evidenceContext?: EvidenceContext;
  /**
   * Rewrite knowledge-vertex ids to a content hash so the same fact stated twice
   * merges instead of duplicating. Off leaves extractor-chosen ids intact.
   */
  deterministicIds?: boolean;
  /**
   * Supersede rather than overwrite: a singleton whose content changed marks the
   * prior version invalid and keeps it, so corrections stay auditable.
   */
  temporalContradictions?: boolean;
  /**
   * Raise or lower a rule's severity for this run. Used by the evaluation harness
   * to price what strict enforcement of an otherwise-soft rule costs; the deployed
   * configuration always uses the severities the spec declares.
   */
  severityOverrides?: Record<string, Severity>;
};

/** A prior fact a new one invalidates. */
export type Supersession = {
  supersededId: string;
  supersedingId: string;
  label: string;
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
  /** Prior facts this delta invalidated. Empty unless temporal handling is on. */
  supersessions: Supersession[];
};

/** Edges the gate writes itself; the extractor is never offered them. */
export const SUPERSEDED_BY = "supersededBy";

/** Rule severity, with any harness override applied. */
function severityOf(
  contract: GateContract,
  ruleId: string,
  fallback: Severity,
  options?: GateOptions
): Severity {
  return options?.severityOverrides?.[ruleId] ?? contractSeverity(contract, ruleId, fallback);
}

type Candidate = {
  id: string;
  label: string;
  properties: Record<string, JsonValue>;
  evidence: Record<string, JsonValue> | null;
  /** True for vertices the gate itself materialized rather than the extractor. */
  synthetic: boolean;
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
  const supersessions: Supersession[] = [];

  // Materialize inline evidence before validation, so the synthesized vertices and
  // edges are held to exactly the same rules as extractor-authored ones.
  const materialized = governed
    ? materializeEvidence(candidates, contract, findings, options)
    : { vertices: [], edges: [] };

  const admittedVertices: GraphVertex[] = [];
  const labels = new Map<string, string>(
    Object.values(graph.vertices).map((vertex) => [vertex.id, vertex.label])
  );

  for (const candidate of [...candidates, ...materialized.vertices]) {
    // Evidence is the gate's to author. An extractor-supplied evidence vertex is
    // dropped rather than admitted, otherwise the orphan nodes it emits alongside
    // the materialized ones accumulate as unreferenced clutter.
    if (governed && !candidate.synthetic && candidate.label === contract.evidenceLabel) {
      findings.push(finding("HR006", "advisory", `ignored extractor-authored evidence ${candidate.id}; evidence is attached from the inline field`, candidate.id, "dropped"));
      continue;
    }
    const spec = contract.vertexSpecs.get(candidate.label);
    if (!spec) {
      findings.push(finding("HR002", severityOf(contract, "HR002", "hard", options), `unknown vertex label ${candidate.label}`, candidate.id, "dropped"));
      continue;
    }
    const properties = pick(candidate.properties, spec.properties);
    const missing = [...spec.requiredProperties].filter((key) => isBlank(properties[key]));
    if (missing.length > 0) {
      findings.push(finding("HR001", severityOf(contract, "HR001", "hard", options), `${candidate.id} missing required ${missing.join(", ")}`, candidate.id, "dropped"));
      continue;
    }
    if (governed && !admitEvidenceQuality(candidate.label, properties, contract, findings, candidate.id, options)) continue;
    if (governed && !admitTextQuality(candidate.label, properties, contract, findings, candidate.id, options)) continue;
    if (governed && !admitSingleton(candidate, properties, graph, contract, findings, options, supersessions)) continue;
    admittedVertices.push({ id: candidate.id, label: candidate.label, properties });
    labels.set(candidate.id, candidate.label);
  }

  const admittedEdges: GraphEdge[] = [];
  const seenEdgeIds = new Set<string>();
  for (const item of [...rawEdges.map(parseEdge), ...materialized.edges]) {
    if (!item) continue;
    const spec = contract.edgeSpecs.get(item.label);
    if (!spec) {
      findings.push(finding("HR003", severityOf(contract, "HR003", "hard", options), `unknown edge label ${item.label}`, item.id || null, "dropped"));
      continue;
    }
    if (!labels.has(item.out) || !labels.has(item.in)) {
      findings.push(finding("HR005", severityOf(contract, "HR005", "hard", options), `dangling ${item.label}: ${labels.has(item.out) ? item.in : item.out} is not in this delta or the graph`, item.id || null, "dropped"));
      continue;
    }
    const outLabel = labels.get(item.out) ?? "";
    const inLabel = labels.get(item.in) ?? "";
    if (!endpointsConform(contract, item.label, outLabel, inLabel)) {
      findings.push(finding("HR004", severityOf(contract, "HR004", "hard", options), `${item.label} connects ${outLabel}->${inLabel}, expected ${expectedEndpoints(contract, item.label)}`, item.id || null, "dropped"));
      continue;
    }
    const id = item.id || `${item.out}--${item.label}-->${item.in}`;
    if (seenEdgeIds.has(id)) continue;
    seenEdgeIds.add(id);
    admittedEdges.push({ id, label: item.label, out: item.out, in: item.in, properties: item.properties });
  }

  // Provenance attachment is checked after admission, on what actually survived.
  const ungrounded = governed
    ? checkProvenanceAttachment(admittedVertices, admittedEdges, labels, contract, findings, options)
    : new Set<string>();

  let delta: GraphDelta = ungrounded.size > 0
    ? {
        // Only when the spec's soft provenance rule is escalated to hard: the
        // ungrounded fact and anything hanging off it leave with it.
        vertices: admittedVertices.filter((vertex) => !ungrounded.has(vertex.id)),
        edges: admittedEdges.filter((edge) => !ungrounded.has(edge.out) && !ungrounded.has(edge.in))
      }
    : { vertices: admittedVertices, edges: admittedEdges };
  if (governed && options.deterministicIds) delta = applyDeterministicIds(delta, contract, supersessions);
  for (const supersession of supersessions) {
    delta.edges.push({
      id: `${supersession.supersededId}--${SUPERSEDED_BY}-->${supersession.supersedingId}`,
      label: SUPERSEDED_BY,
      out: supersession.supersededId,
      in: supersession.supersedingId,
      properties: {}
    });
  }

  return { delta, findings, retryFeedback: buildRetryFeedback(findings, contract), supersessions };
}

/**
 * Content-derived ids for knowledge vertices: the same fact stated twice lands on
 * the same id and merges, so duplicates become structurally impossible rather
 * than something a later deduplication pass has to find.
 */
function applyDeterministicIds(
  delta: GraphDelta,
  contract: GateContract,
  supersessions: Supersession[]
): GraphDelta {
  const rewritten = new Map<string, string>();
  for (const vertex of delta.vertices) {
    if (!contract.knowledgeLabels.has(vertex.label)) continue;
    rewritten.set(vertex.id, `${vertex.label.toLowerCase()}:${contentHash(vertex.label, vertex.properties)}`);
  }
  // Evidence follows the fact it grounds, so identical facts share evidence too.
  for (const vertex of delta.vertices) {
    if (vertex.label !== contract.evidenceLabel) continue;
    for (const [from, to] of rewritten) {
      if (vertex.id === `evidence:${from}`) rewritten.set(vertex.id, `evidence:${to}`);
    }
  }
  if (rewritten.size === 0) return delta;

  const resolve = (id: string): string => rewritten.get(id) ?? id;
  const vertices = new Map<string, GraphVertex>();
  for (const vertex of delta.vertices) {
    const id = resolve(vertex.id);
    const existing = vertices.get(id);
    vertices.set(id, { ...vertex, id, properties: { ...(existing?.properties ?? {}), ...vertex.properties } });
  }
  const edges = new Map<string, GraphEdge>();
  for (const edge of delta.edges) {
    const out = resolve(edge.out);
    const incoming = resolve(edge.in);
    const id = `${out}--${edge.label}-->${incoming}`;
    edges.set(id, { ...edge, id, out, in: incoming });
  }
  for (const supersession of supersessions) {
    supersession.supersedingId = resolve(supersession.supersedingId);
  }
  return { vertices: [...vertices.values()], edges: [...edges.values()] };
}

/**
 * Order-independent 128-bit content hash. Deliberately dependency-free and
 * synchronous so the same id is produced in the browser, on the server, and in
 * the evaluation harness.
 */
function contentHash(label: string, properties: Record<string, JsonValue>): string {
  const canonical = JSON.stringify([
    label,
    Object.entries(properties)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, normalizeForHash(value)])
      .sort((left, right) => (String(left[0]) < String(right[0]) ? -1 : 1))
  ]);
  return `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x01000193)}`;
}

function normalizeForHash(value: JsonValue): JsonValue {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : value;
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Turn each knowledge vertex's inline `evidence` into a ProvenanceEvidence vertex
 * plus the provenance edge the contract assigns to that label.
 */
function materializeEvidence(
  candidates: Candidate[],
  contract: GateContract,
  findings: GateFinding[],
  options: GateOptions
): { vertices: Candidate[]; edges: ParsedEdge[] } {
  const context = options.evidenceContext;
  const vertices: Candidate[] = [];
  const edges: ParsedEdge[] = [];
  if (!contract.evidenceLabel) return { vertices, edges };

  for (const candidate of candidates) {
    if (!contract.knowledgeLabels.has(candidate.label)) continue;
    if (!candidate.evidence) continue;
    const edgeLabel = contract.provenanceEdgeByLabel.get(candidate.label);
    if (!edgeLabel) {
      findings.push(finding("HR007", severityOf(contract, "HR007", "soft", options), `no provenance edge is mapped for ${candidate.label}`, candidate.id, "flagged"));
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
      evidence: null,
      synthetic: true
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
  id: string,
  options: GateOptions
): boolean {
  const utterance = options.evidenceContext?.utterance;
  if (label !== contract.evidenceLabel) return true;

  const speaker = asString(properties.speaker);
  if (contract.speakerValues.size > 0 && !contract.speakerValues.has(speaker)) {
    findings.push(finding("HR010", severityOf(contract, "HR010", "hard", options), `${id} speaker "${speaker}" is outside the allowed vocabulary`, id, "dropped"));
    return false;
  }
  const confidence = asString(properties.confidence);
  if (confidence && contract.confidenceValues.size > 0 && !contract.confidenceValues.has(confidence)) {
    findings.push(finding("HR011", severityOf(contract, "HR011", "hard", options), `${id} confidence "${confidence}" is outside the allowed vocabulary`, id, "dropped"));
    return false;
  }
  const traceText = asString(properties.traceText);
  const trace = traceText.toLowerCase();
  const banned = contract.bannedTracePatterns.find((pattern) => trace === pattern || trace.startsWith(pattern));
  if (banned) {
    findings.push(finding("HR012", severityOf(contract, "HR012", "hard", options), `${id} traceText is generic ("${banned}")`, id, "dropped"));
    return false;
  }
  const specificity = traceSpecificity(traceText, utterance);
  if (specificity) {
    findings.push(finding("HR012", severityOf(contract, "HR012", "hard", options), `${id} traceText ${specificity}`, id, "dropped"));
    return false;
  }
  return true;
}

/**
 * Evidence must be a *span* of the utterance, not a restatement of it.
 *
 * A token-overlap threshold cannot express this: echoing the whole turn scores a
 * perfect overlap, so the rule it is supposed to enforce is trivially satisfied by
 * the laziest possible evidence. These checks test the two things that actually
 * distinguish a citation from a paraphrase of the topic: the trace must appear in
 * the utterance, and it must not swallow the whole turn.
 *
 * Returns a reason when the trace fails, or null when it is acceptable.
 */
function traceSpecificity(traceText: string, utterance: string | undefined): string | null {
  const trace = normalizeText(traceText);
  if (!trace) return "is empty";
  if (countWords(trace) < 4) return "is too short to identify a claim";
  if (!utterance) return null;

  const source = normalizeText(utterance);
  if (!source) return null;

  // A quotation is a substring of what was said. Anything else is the model's
  // own prose, which is what ungrounded-but-plausible facts are made of.
  if (!source.includes(trace)) return "does not appear in the utterance it cites";

  // Citing the entire turn identifies no particular claim, so it grounds nothing.
  // Short turns are exempt: when the expert said one thing, the whole turn is the
  // span. Twenty words is where a turn reliably contains more than one claim.
  const sourceWords = countWords(source);
  if (sourceWords >= 20 && countWords(trace) / sourceWords > 0.9) {
    return "restates the whole utterance instead of the span that licenses the fact";
  }
  return null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function countWords(value: string): number {
  return value ? value.split(" ").filter(Boolean).length : 0;
}

function admitTextQuality(
  label: string,
  properties: Record<string, JsonValue>,
  contract: GateContract,
  findings: GateFinding[],
  id: string,
  options: GateOptions
): boolean {
  for (const rule of contract.textQualityRules) {
    if (rule.label !== label) continue;
    const value = asString(properties[rule.property]).toLowerCase().trim();
    const banned = rule.bannedPatterns.find((pattern) => value === pattern || value.startsWith(pattern));
    if (!banned) continue;
    const severity = severityOf(contract, rule.ruleId, rule.severity, options);
    findings.push(finding(rule.ruleId, severity, `${id} ${rule.property} is generic ("${banned}")`, id, severity === "hard" ? "dropped" : "flagged"));
    if (severity === "hard") return false;
  }
  return true;
}

function admitSingleton(
  candidate: Candidate,
  properties: Record<string, JsonValue>,
  graph: GraphState,
  contract: GateContract,
  findings: GateFinding[],
  options: GateOptions,
  supersessions: Supersession[]
): boolean {
  if (!contract.singletonLabels.has(candidate.label)) return true;
  const existing = Object.values(graph.vertices).find((vertex) => vertex.label === candidate.label);
  if (!existing || existing.id === candidate.id) return true;

  if (!options.temporalContradictions) {
    findings.push(finding("HR009", severityOf(contract, "HR009", "hard", options), `${candidate.label} is a session singleton; ${existing.id} already exists`, candidate.id, "dropped"));
    return false;
  }

  // A restated singleton is the expert correcting themselves, not a duplicate.
  // Identical content is a no-op; changed content supersedes rather than
  // overwrites, so the superseded claim remains in the graph and auditable.
  // Compare like with like: the candidate's properties have already been filtered
  // to the schema, so the stored vertex is filtered the same way before hashing.
  const declared = contract.vertexSpecs.get(candidate.label)?.properties ?? new Set<string>();
  if (contentHash(existing.label, pick(existing.properties, declared)) === contentHash(candidate.label, properties)) {
    findings.push(finding("HR009", "advisory", `${candidate.label} restated unchanged; merged into ${existing.id}`, candidate.id, "repaired"));
    return false;
  }
  supersessions.push({ supersededId: existing.id, supersedingId: candidate.id, label: candidate.label });
  findings.push(finding("HR009", "advisory", `${candidate.label} changed; ${existing.id} superseded by ${candidate.id}`, candidate.id, "repaired"));
  return true;
}

function checkProvenanceAttachment(
  vertices: GraphVertex[],
  edges: GraphEdge[],
  labels: Map<string, string>,
  contract: GateContract,
  findings: GateFinding[],
  options: GateOptions
): Set<string> {
  const unprovenanced = severityOf(contract, "HR006", "soft", options);
  const ungrounded = new Set<string>();
  for (const vertex of vertices) {
    if (!contract.knowledgeLabels.has(vertex.label)) continue;
    const attached = edges.find(
      (edge) =>
        edge.out === vertex.id &&
        contract.provenanceEdgeLabels.has(edge.label) &&
        labels.get(edge.in) === contract.evidenceLabel
    );
    if (!attached) {
      findings.push(finding("HR006", unprovenanced, `${vertex.id} has no evidence`, vertex.id, unprovenanced === "hard" ? "dropped" : "flagged"));
      ungrounded.add(vertex.id);
      continue;
    }
    const expected = contract.provenanceEdgeByLabel.get(vertex.label);
    if (expected && attached.label !== expected) {
      findings.push(finding("HR007", severityOf(contract, "HR007", "soft", options), `${vertex.id} uses ${attached.label}, expected ${expected}`, vertex.id, "flagged"));
    }
  }
  return unprovenanced === "hard" ? ungrounded : new Set<string>();
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
  return spec.out.has(outLabel) && spec.in.has(inLabel);
}

function expectedEndpoints(contract: GateContract, edgeLabel: string): string {
  const spec = contract.edgeSpecs.get(edgeLabel);
  if (!spec) return "an unknown endpoint pair";
  return `${[...spec.out].join("|")}->${[...spec.in].join("|")}`;
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
      evidence: isRecord(item.evidence) ? jsonRecord(item.evidence) : null,
      synthetic: false
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
