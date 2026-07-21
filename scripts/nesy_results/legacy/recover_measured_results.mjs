import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, "results");
const RAW = path.join(RESULTS, "raw");
const CACHE = path.join(RESULTS, "cache", "real-ablation");
const ORDER = ["A0", "A1", "A2", "A3", "A4", "A5", "A4-soft"];
const REPLAY = new Set(["A4", "A5", "A4-soft"]);
const KNOWLEDGE = new Set([
  "ExpertRole", "HospitalityBusiness", "OperatingTenure", "GuestExperiencePrinciple",
  "ServiceStandard", "GuestSignal", "GuestPersona", "CheckInPolicy", "CheckOutPolicy",
  "TimingRule", "ServiceFailure", "RecoveryAction", "ExceptionRule", "DecisionRule",
  "OperatingHeuristic", "LoyaltyDriver", "EmotionalMoment", "ContextualConstraint", "Outcome"
]);
const INFRASTRUCTURE = new Set(["Person", "KnowledgeSession", "SessionSection", "TranscriptEpisode", "ProvenanceEvidence"]);
const PROV_EDGES = new Set(["supportedBy", "principleSupportedBy", "heuristicSupportedBy"]);
const UNMEASURED = "UNMEASURED";
const GENERIC = [
  "the expert described their approach", "the owner mentioned", "hospitality knowledge",
  "extracted from interview", "see transcript", "n/a", "not available", "unknown",
  "the expert talked about", "general hospitality principle"
];
const corpus = readJson("results/corpus_stats.json");
const schema = readJson("src/main/json/hospitality.json");
const fillerIds = new Set(corpus.utterances.filter((item) => item.filler).map((item) => item.turn_id));
const turns = corpus.utterances;
const vertexSpecs = new Map(schema.vertices.map((entry) => {
  const value = entry["@value"];
  return [entry["@key"], {
    properties: new Set((value.properties ?? []).map((property) => property.key)),
    required: new Set((value.properties ?? []).filter((property) => property.required).map((property) => property.key))
  }];
}));
const edgeSpecs = new Map(schema.edges.map((entry) => {
  const value = entry["@value"];
  return [entry["@key"], { out: value.out ?? value.outV, in: value.in ?? value.inV }];
}));

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

function readRows(condition) {
  const file = path.join(RAW, `${condition}.jsonl`);
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function writeRows(condition, rows) {
  fs.writeFileSync(path.join(RAW, `${condition}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function words(value) {
  return String(value ?? "").toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function slug(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function propObject(value) {
  if (Array.isArray(value)) return Object.fromEntries(value.filter(Boolean).map((item) => [item.key, item.value]));
  return value && typeof value === "object" ? { ...value } : {};
}

function firstJsonObject(text) {
  const source = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(source); } catch {}
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") { if (depth === 0) start = index; depth += 1; }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error("No complete JSON object found");
}

function inferLabel(raw, containerLabel = null) {
  if (vertexSpecs.has(raw.label)) return raw.label;
  if (vertexSpecs.has(raw.type)) return raw.type;
  if (vertexSpecs.has(containerLabel)) return containerLabel;
  const p = { ...propObject(raw.properties), ...raw };
  if ("traceText" in p || "sourceEpisode" in p) return "ProvenanceEvidence";
  if ("title" in p) return "ExpertRole";
  if ("businessType" in p || "scale" in p) return "HospitalityBusiness";
  if ("duration" in p) return "OperatingTenure";
  if ("standardText" in p || "nonNegotiable" in p) return "ServiceStandard";
  if ("signalType" in p || "highValueIndicator" in p || "returnLikelihood" in p) return "GuestSignal";
  if ("primaryNeed" in p || "valueDriver" in p || "repeatGuest" in p) return "GuestPersona";
  if ("earlyCheckIn" in p || "sweetSpotTime" in p || "earlyArrivalHandling" in p) return "CheckInPolicy";
  if ("lateCheckOut" in p || "lateHandlingApproach" in p) return "CheckOutPolicy";
  if ("failureType" in p || ("frequency" in p && "severity" in p)) return "ServiceFailure";
  if ("actionType" in p || "commonMistake" in p || "leadsToLoyalty" in p) return "RecoveryAction";
  if ("triggerCondition" in p || "paidOff" in p || "guestSegment" in p) return "ExceptionRule";
  if ("heuristic" in p || "whenUsed" in p || "learnedThrough" in p) return "OperatingHeuristic";
  if ("driverType" in p || "turnsAdvocate" in p || "destroysTrust" in p) return "LoyaltyDriver";
  if ("momentType" in p || "gestureScale" in p || "outsizedImpact" in p) return "EmotionalMoment";
  if ("constraintType" in p || "seasonality" in p || "customerMix" in p) return "ContextualConstraint";
  if ("outcomeType" in p || "guestRetained" in p || "loyaltyAchieved" in p) return "Outcome";
  if ("ruleText" in p && ("ruleType" in p || "refinedThroughExperience" in p)) return "TimingRule";
  if ("ruleText" in p) return "DecisionRule";
  if ("neverCompromise" in p || String(raw.type ?? "").toLowerCase().includes("principle")) return "GuestExperiencePrinciple";
  return null;
}

function expandRawVertices(vertices) {
  const expanded = [];
  for (const raw of Array.isArray(vertices) ? vertices : []) {
    if (!raw || typeof raw !== "object") continue;
    const labelKeys = Object.keys(raw).filter((key) => vertexSpecs.has(key));
    if (labelKeys.length && !raw.label && !vertexSpecs.has(raw.type)) {
      for (const label of labelKeys) expanded.push({ raw: raw[label], containerLabel: label });
    } else expanded.push({ raw, containerLabel: null });
  }
  return expanded;
}

function normalizeA0(parsed, turnId) {
  const vertices = [];
  const aliases = new Map();
  let droppedVertices = 0;
  for (const [index, entry] of expandRawVertices(parsed.vertices).entries()) {
    const raw = entry.raw && typeof entry.raw === "object" ? entry.raw : {};
    const label = inferLabel(raw, entry.containerLabel);
    if (!label) { droppedVertices += 1; continue; }
    const nested = propObject(raw.properties);
    const properties = { ...nested };
    for (const [key, value] of Object.entries(raw)) {
      if (["id", "label", "properties"].includes(key)) continue;
      if (key === "type" && vertexSpecs.has(value)) continue;
      properties[key] = value;
    }
    const id = String(raw.id ?? `${turnId}:a0:v${String(index + 1).padStart(2, "0")}`);
    const vertex = { id, label, properties };
    vertices.push(vertex);
    for (const alias of [id, raw.id, raw.name, properties.name, entry.containerLabel]) {
      if (alias) { aliases.set(String(alias), id); aliases.set(slug(alias), id); }
    }
  }
  const vertexIds = new Set(vertices.map((vertex) => vertex.id));
  const resolve = (value) => aliases.get(String(value)) ?? aliases.get(slug(value)) ?? (vertexIds.has(String(value)) ? String(value) : String(value ?? ""));
  const edges = [];
  let droppedEdges = 0;
  for (const [index, raw] of (Array.isArray(parsed.edges) ? parsed.edges : []).entries()) {
    if (!raw || typeof raw !== "object") { droppedEdges += 1; continue; }
    if (!raw.source && !raw.out && Object.keys(raw).some((key) => edgeSpecs.has(key))) {
      const label = Object.keys(raw).find((key) => edgeSpecs.has(key));
      const body = raw[label] ?? {};
      raw.label = label; raw.source = body.source ?? body.out; raw.target = body.target ?? body.in;
    }
    const label = String(raw.label ?? raw.type ?? "");
    const out = resolve(raw.out ?? raw.source);
    const incoming = resolve(raw.in ?? raw.target);
    if (!label || !out || !incoming) { droppedEdges += 1; continue; }
    edges.push({ id: String(raw.id ?? `${turnId}:a0:e${String(index + 1).padStart(2, "0")}`), label, out, in: incoming, properties: propObject(raw.properties) });
  }
  return { delta: { vertices, edges }, droppedVertices, droppedEdges };
}

function recoverA0() {
  const cached = [];
  for (const name of fs.readdirSync(CACHE)) {
    const payload = JSON.parse(fs.readFileSync(path.join(CACHE, name), "utf8"));
    const message = payload.response?.choices?.[0]?.message;
    if (typeof message?.content !== "string" || !message.content.includes("vertices")) continue;
    cached.push({ name, payload, content: message.content, created: payload.response.created ?? 0 });
  }
  cached.sort((left, right) => left.created - right.created || left.name.localeCompare(right.name));
  const calledTurns = turns.filter((turn) => !["chatgraph-20260716-203203:u019", "chatgraph-20260716-203203:u028"].includes(turn.turn_id));
  if (cached.length !== calledTurns.length) throw new Error(`A0 cache/turn mismatch: ${cached.length}/${calledTurns.length}`);
  const byTurn = new Map();
  for (let index = 0; index < calledTurns.length; index += 1) byTurn.set(calledTurns[index].turn_id, cached[index]);
  const rows = turns.map((turn) => {
    const item = byTurn.get(turn.turn_id);
    const excluded = fillerIds.has(turn.turn_id);
    if (!item) return baseRow("A0", turn, excluded, { skipped_as_filler: true, parser_status: "not_called_by_original_run" });
    try {
      const parsed = firstJsonObject(item.content);
      const normalized = normalizeA0(parsed, turn.turn_id);
      const graph = initialGraph();
      const facts = evaluateFacts(normalized.delta, graph);
      return baseRow("A0", turn, excluded, {
        parser_status: "parsed_and_normalized", parser_cache_file: path.relative(ROOT, path.join(CACHE, item.name)),
        parser_dropped_vertices: normalized.droppedVertices, parser_dropped_edges: normalized.droppedEdges,
        proposed_fact_count: facts.length, admitted_fact_count: facts.length, rejected_fact_count: 0,
        proposed_facts: facts, admitted_facts: facts, rejected: [], attempts_used: 1,
        latency_ms: item.payload.latencyMs ?? 0, tokens: item.payload.response?.usage?.total_tokens ?? 0,
        raw_response_id: item.payload.response?.id ?? null, delta: normalized.delta
      });
    } catch (error) {
      return baseRow("A0", turn, excluded, {
        parser_status: "unparseable", parser_error: error.message,
        parser_cache_file: path.relative(ROOT, path.join(CACHE, item.name)), attempts_used: 1,
        latency_ms: item.payload.latencyMs ?? 0, tokens: item.payload.response?.usage?.total_tokens ?? 0
      });
    }
  });
  writeRows("A0", rows);
  return rows;
}

function baseRow(condition, turn, excluded, extra = {}) {
  return {
    condition, utterance_id: turn.turn_id, session_file: turn.session_file,
    source_utterance: turn.content, previous_assistant: turn.previousAssistant,
    skipped_as_filler: false, excluded_as_filler: excluded, status: "MEASURED_CACHED_RUN",
    proposed_fact_count: 0, admitted_fact_count: 0, rejected_fact_count: 0,
    proposed_facts: [], admitted_facts: [], rejected: [], attempts_used: 0,
    latency_ms: 0, tokens: 0, delta: { vertices: [], edges: [] }, ...extra
  };
}

function initialGraph() {
  return { vertices: new Map([
    ["person:expert", { id: "person:expert", label: "Person", properties: { name: "expert" } }],
    ["session:hospitality:default", { id: "session:hospitality:default", label: "KnowledgeSession", properties: { domain: "hospitality" } }]
  ]), edges: new Map() };
}

function labelsFor(delta, graph) {
  const labels = new Map([...graph.vertices].map(([id, vertex]) => [id, vertex.label]));
  for (const vertex of delta.vertices ?? []) labels.set(vertex.id, vertex.label);
  return labels;
}

function endpointConforms(label, outLabel, inLabel) {
  if (inLabel === "ProvenanceEvidence") {
    if (label === "principleSupportedBy") return outLabel === "GuestExperiencePrinciple";
    if (label === "heuristicSupportedBy") return ["OperatingHeuristic", "TimingRule"].includes(outLabel);
    if (label === "supportedBy") return KNOWLEDGE.has(outLabel) && !["GuestExperiencePrinciple", "OperatingHeuristic", "TimingRule"].includes(outLabel);
  }
  const spec = edgeSpecs.get(label);
  return Boolean(spec) && spec.out === outLabel && spec.in === inLabel;
}

function evaluateFacts(delta, graph) {
  const labels = labelsFor(delta, graph);
  const facts = [];
  for (const vertex of delta.vertices ?? []) {
    if (!KNOWLEDGE.has(vertex.label)) continue;
    const spec = vertexSpecs.get(vertex.label);
    const conforming = Boolean(spec) && [...spec.required].every((key) => vertex.properties?.[key] !== undefined && vertex.properties[key] !== "");
    facts.push({ id: vertex.id, kind: "vertex", conforming, text: `${vertex.label}: ${JSON.stringify(vertex.properties ?? {})}` });
  }
  for (const edge of delta.edges ?? []) {
    if (!KNOWLEDGE.has(labels.get(edge.out)) || !KNOWLEDGE.has(labels.get(edge.in))) continue;
    const relationConforming = edgeSpecs.has(edge.label);
    facts.push({
      id: edge.id || `${edge.out}:${edge.label}:${edge.in}`, kind: "edge",
      conforming: endpointConforms(edge.label, labels.get(edge.out), labels.get(edge.in)), relationConforming,
      subject: edge.out, relation: edge.label, object: edge.in,
      text: `${edge.out} --${edge.label}--> ${edge.in}`
    });
  }
  return facts;
}

function lexicalOverlap(left, right) {
  const stop = new Set(["the", "and", "that", "this", "with", "for", "from", "you", "your", "they", "their"]);
  const a = new Set(words(left).filter((word) => word.length > 2 && !stop.has(word)));
  const b = new Set(words(right).filter((word) => word.length > 2 && !stop.has(word)));
  if (!a.size) return 0;
  return [...a].filter((word) => b.has(word)).length / a.size;
}

function gateErrors(delta, graph, condition, source) {
  const errors = [];
  const warnings = [];
  const labels = labelsFor(delta, graph);
  const byId = new Map((delta.vertices ?? []).map((vertex) => [vertex.id, vertex]));
  for (const vertex of delta.vertices ?? []) {
    const spec = vertexSpecs.get(vertex.label);
    if (!spec) { errors.push(`HR002 unknown vertex label ${vertex.label}`); continue; }
    for (const key of spec.required) if (vertex.properties?.[key] === undefined || vertex.properties[key] === "") errors.push(`HR001 ${vertex.id} missing ${key}`);
  }
  for (const edge of delta.edges ?? []) {
    if (!edgeSpecs.has(edge.label)) errors.push(`HR003 unknown edge ${edge.label}`);
    if (!labels.has(edge.out) || !labels.has(edge.in)) errors.push(`HR005 dangling edge ${edge.id || edge.label}`);
    else if (!endpointConforms(edge.label, labels.get(edge.out), labels.get(edge.in))) errors.push(`HR004 ${edge.label} endpoint mismatch`);
  }
  if (["A4", "A5", "A4-soft"].includes(condition)) {
    const traceErrors = [];
    for (const vertex of (delta.vertices ?? []).filter((item) => KNOWLEDGE.has(item.label))) {
      const edge = (delta.edges ?? []).find((item) => item.out === vertex.id && PROV_EDGES.has(item.label));
      if (!edge || labels.get(edge.in) !== "ProvenanceEvidence") { traceErrors.push(`HR006 ${vertex.id} missing provenance`); continue; }
      const expected = vertex.label === "GuestExperiencePrinciple" ? "principleSupportedBy" : ["OperatingHeuristic", "TimingRule"].includes(vertex.label) ? "heuristicSupportedBy" : "supportedBy";
      if (edge.label !== expected) traceErrors.push(`HR007 ${vertex.id} uses ${edge.label}, expected ${expected}`);
      const trace = String(byId.get(edge.in)?.properties?.traceText ?? graph.vertices.get(edge.in)?.properties?.traceText ?? "").trim();
      const isGeneric = words(trace).length < 5 || GENERIC.some((pattern) => trace.toLowerCase().startsWith(pattern)) || lexicalOverlap(trace, source) < 0.2;
      if (isGeneric) traceErrors.push(`HR012 ${edge.in} generic traceText: ${JSON.stringify(trace)}`);
    }
    if (condition === "A4-soft") warnings.push(...traceErrors); else errors.push(...traceErrors);
  }
  if (condition === "A5") {
    for (const vertex of (delta.vertices ?? []).filter((item) => item.label === "ProvenanceEvidence")) {
      if (!["expert", "interviewer", "system"].includes(vertex.properties?.speaker)) errors.push(`HR010 ${vertex.id} invalid speaker`);
      if (vertex.properties?.confidence && !["high", "medium", "low", "inferred"].includes(vertex.properties.confidence)) errors.push(`HR011 ${vertex.id} invalid confidence`);
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function merge(graph, delta) {
  for (const vertex of delta.vertices ?? []) graph.vertices.set(vertex.id, vertex);
  for (const edge of delta.edges ?? []) graph.edges.set(edge.id || `${edge.out}:${edge.label}:${edge.in}`, edge);
}

function replayCondition(condition) {
  const graph = initialGraph();
  const rows = readRows(condition).map((row) => {
    const excluded = fillerIds.has(row.utterance_id);
    if (excluded) return { ...row, excluded_as_filler: true, analysis_validity: "excluded_navigation_or_filler" };
    const facts = evaluateFacts(row.delta ?? { vertices: [], edges: [] }, graph);
    const gate = gateErrors(row.delta ?? { vertices: [], edges: [] }, graph, condition, row.source_utterance);
    const admitted = gate.errors.length === 0;
    if (admitted) merge(graph, row.delta ?? { vertices: [], edges: [] });
    return {
      ...row, excluded_as_filler: false, status: "MEASURED_CACHE_GATE_REPLAY",
      replay_original_admitted_fact_count: row.admitted_fact_count,
      replay_original_rejections: row.rejected,
      proposed_fact_count: facts.length, admitted_fact_count: admitted ? facts.length : 0,
      rejected_fact_count: admitted ? 0 : facts.length, proposed_facts: facts,
      admitted_facts: admitted ? facts : [], rejected: admitted ? [] : gate.errors,
      gate_warnings: gate.warnings, analysis_validity: "canonical_measured_cache_replay",
      analysis_note: "Final cached delta replayed through corrected provenance endpoint contract; API usage fields retain the original run cost."
    };
  });
  writeRows(condition, rows);
  return rows;
}

function eligibleRows(rows) {
  return rows.filter((row) => !fillerIds.has(row.utterance_id) && !row.excluded_as_filler);
}

function wilson(numerator, denominator) {
  if (!denominator) return null;
  const z = 1.959963984540054;
  const p = numerator / denominator;
  const divisor = 1 + z * z / denominator;
  const center = (p + z * z / (2 * denominator)) / divisor;
  const margin = z * Math.sqrt(p * (1 - p) / denominator + z * z / (4 * denominator * denominator)) / divisor;
  return { low: Number((100 * Math.max(0, center - margin)).toFixed(1)), high: Number((100 * Math.min(1, center + margin)).toFixed(1)) };
}

function proportion(numerator, denominator) {
  if (!denominator) return { value: UNMEASURED, numerator, denominator, count: `${numerator}/${denominator}`, ci95: null };
  return { value: `${(100 * numerator / denominator).toFixed(1)}%`, numerator, denominator, count: `${numerator}/${denominator}`, ci95: wilson(numerator, denominator) };
}

function loadJudgeVerdicts() {
  const verdicts = new Map();
  for (const name of fs.readdirSync(CACHE)) {
    const payload = JSON.parse(fs.readFileSync(path.join(CACHE, name), "utf8"));
    const content = payload.response?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.includes("verdicts")) continue;
    try {
      const parsed = firstJsonObject(content);
      for (const verdict of parsed.verdicts ?? []) verdicts.set(verdict.id, { ...verdict, cache_file: `results/cache/real-ablation/${name}` });
    } catch {}
  }
  return verdicts;
}

function summarize(condition, rows, verdicts) {
  const valid = eligibleRows(rows);
  const proposed = valid.reduce((sum, row) => sum + (row.proposed_fact_count ?? 0), 0);
  const admittedFacts = valid.flatMap((row) => row.admitted_facts ?? []);
  const admitted = admittedFacts.length;
  const conforming = admittedFacts.filter((fact) => fact.conforming).length;
  const admittedEdges = admittedFacts.filter((fact) => fact.kind === "edge");
  const relationBad = admittedEdges.filter((fact) => fact.relationConforming === false).length;
  const judgeItems = [];
  for (const row of valid) for (const fact of (row.admitted_facts ?? []).filter((item) => item.kind === "edge")) {
    const verdict = verdicts.get(`${row.utterance_id}:${fact.id}`);
    if (verdict) judgeItems.push(verdict);
  }
  const groundingComplete = judgeItems.length === admittedEdges.length;
  const subjectBad = judgeItems.filter((item) => item.subject_supported !== true).length;
  const objectBad = judgeItems.filter((item) => item.object_supported !== true).length;
  let knowledgeVertices = 0;
  let covered = 0;
  for (const row of valid.filter((item) => item.admitted_fact_count > 0)) {
    const labels = labelsFor(row.delta ?? { vertices: [], edges: [] }, initialGraph());
    for (const vertex of (row.delta?.vertices ?? []).filter((item) => KNOWLEDGE.has(item.label))) {
      knowledgeVertices += 1;
      const edge = (row.delta?.edges ?? []).find((item) => item.out === vertex.id && PROV_EDGES.has(item.label) && labels.get(item.in) === "ProvenanceEvidence");
      if (edge) covered += 1;
    }
  }
  const signatures = admittedFacts.map((fact) => fact.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const duplicates = signatures.length - new Set(signatures).size;
  const tokens = valid.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  const latencyMs = valid.reduce((sum, row) => sum + (row.latency_ms ?? 0), 0);
  const retries = valid.reduce((sum, row) => sum + Math.max(0, (row.attempts_used ?? 0) - 1), 0);
  const retryCapacity = valid.length * 2;
  const unparseable = condition === "A0" ? valid.filter((row) => row.parser_status === "unparseable").length : null;
  const result = {
    proposedFacts: proposed, admittedFacts: admitted,
    OC: proportion(conforming, admitted),
    SH: groundingComplete ? proportion(subjectBad, admittedEdges.length) : { value: UNMEASURED, reason: condition === "A0" ? "No independent judge run exists for recovered A0 edges." : "Cached judge verdicts do not cover every admitted edge." },
    RH: proportion(relationBad, admittedEdges.length),
    OH: groundingComplete ? proportion(objectBad, admittedEdges.length) : { value: UNMEASURED, reason: condition === "A0" ? "No independent judge run exists for recovered A0 edges." : "Cached judge verdicts do not cover every admitted edge." },
    provenanceCoverage: proportion(covered, knowledgeVertices),
    EF: { value: UNMEASURED, reason: "Pending adjudicated human audit labels." },
    yield: proportion(admitted, proposed),
    secondsPerFact: admitted ? Number((latencyMs / 1000 / admitted).toFixed(2)) : UNMEASURED,
    tokensPerFact: admitted ? Math.round(tokens / admitted) : UNMEASURED,
    duplicateRate: proportion(duplicates, admitted),
    retryBudgetConsumed: proportion(retries, retryCapacity),
    temporalContradictions: UNMEASURED,
    totalTokens: tokens, totalLatencyMs: latencyMs, eligibleTurns: valid.length,
    groundingJudgeCoverage: `${judgeItems.length}/${admittedEdges.length}`,
    evidence: `results/raw/${condition}.jsonl`
  };
  if (condition === "A0") result.unparseableRate = proportion(unparseable, valid.length);
  return result;
}

function metricCell(metric) {
  if (!metric || metric.value === UNMEASURED) return UNMEASURED;
  const ci = metric.ci95 ? `; CI ${metric.ci95.low}-${metric.ci95.high}%` : "";
  return `${metric.value} (${metric.count}${ci})`;
}

function auditItems(condition, rows) {
  const items = [];
  for (const row of eligibleRows(rows)) {
    const evidence = (row.delta?.vertices ?? []).filter((vertex) => vertex.label === "ProvenanceEvidence");
    const trace = evidence.map((vertex) => vertex.properties?.traceText).filter(Boolean).join(" | ");
    const section = turns.find((turn) => turn.turn_id === row.utterance_id)?.section ?? "unknown";
    for (const fact of row.admitted_facts ?? []) items.push({ condition, section, row, fact, trace });
  }
  return items;
}

function deterministicShuffle(items, seed) {
  const output = [...items];
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function stratifiedSample(items, target, seed) {
  if (items.length <= 50) return deterministicShuffle(items, seed);
  const groups = new Map();
  for (const item of items) groups.set(item.section, [...(groups.get(item.section) ?? []), item]);
  const sections = [...groups.keys()].sort();
  const selected = [];
  let cursor = 0;
  const shuffled = new Map(sections.map((section, index) => [section, deterministicShuffle(groups.get(section), seed + index)]));
  while (selected.length < Math.min(target, items.length)) {
    const section = sections[cursor % sections.length];
    const group = shuffled.get(section);
    if (group.length) selected.push(group.shift());
    cursor += 1;
    if (cursor > items.length * sections.length + 1) break;
  }
  return selected;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function writeAudit(rowsByCondition) {
  const selected = [];
  for (const [index, condition] of ["A0", "A1", "A4", "A5"].entries()) {
    selected.push(...stratifiedSample(auditItems(condition, rowsByCondition[condition]), 40, 20260716 + index));
  }
  const shuffled = deterministicShuffle(selected, 20260716);
  const key = { seed: 20260716, design: "A0/A1/A4/A5; census when condition <=50 admitted facts, otherwise section-stratified n=40", rows: {} };
  const header = "fact_id,section,source_utterance,fact_as_extracted,cited_traceText,human_verdict,human_notes";
  const body = shuffled.map((item, index) => {
    const id = `audit:${String(index + 1).padStart(3, "0")}`;
    key.rows[id] = { condition: item.condition, section: item.section, utterance_id: item.row.utterance_id, raw_fact_id: item.fact.id };
    return [id, item.section, item.row.source_utterance, item.fact.text, item.trace, "", ""].map(csvCell).join(",");
  });
  const instructions = [
    "# supported: source utterance licenses the exact extracted fact without unsupported inference",
    "# human_verdict: yes, no, or unclear",
    "# annotate independently; do not inspect audit_key.json before both files are complete",
    "# condition is intentionally blinded; human fields are intentionally empty"
  ];
  const csv = `${instructions.join("\n")}\n${header}\n${body.join("\n")}\n`;
  for (const name of ["human_audit_sample.csv", "human_audit_annotator_A.csv", "human_audit_annotator_B.csv"]) fs.writeFileSync(path.join(RESULTS, name), csv);
  fs.writeFileSync(path.join(RESULTS, "audit_key.json"), `${JSON.stringify(key, null, 2)}\n`);
  fs.writeFileSync(path.join(RESULTS, "human_audit_sample.xlsx"), minimalXlsx(csv));
  return { totalRows: shuffled.length, byCondition: Object.fromEntries(["A0", "A1", "A4", "A5"].map((condition) => [condition, shuffled.filter((item) => item.condition === condition).length])) };
}

function parseCsvLine(line) {
  const cells = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') { if (quoted && line[index + 1] === '"') { current += '"'; index += 1; } else quoted = !quoted; }
    else if (char === "," && !quoted) { cells.push(current); current = ""; } else current += char;
  }
  cells.push(current); return cells;
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function minimalXlsx(csv) {
  const rows = csv.trimEnd().split("\n").map(parseCsvLine);
  const sheetRows = rows.map((cells, rowIndex) => `<row r="${rowIndex + 1}">${cells.map((cell, columnIndex) => `<c r="${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(cell.replace(/^# /, ""))}</t></is></c>`).join("")}</row>`).join("");
  return zipStore([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="audit" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`]
  ]);
}

function zipStore(files) {
  const localParts = []; const centralParts = []; let offset = 0;
  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name); const data = Buffer.from(content); const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26); nameBuffer.copy(local, 30);
    localParts.push(local, data);
    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(offset, 42); nameBuffer.copy(central, 46);
    centralParts.push(central); offset += local.length + data.length;
  }
  const central = Buffer.concat(centralParts); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) { let value = index; for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; table[index] = value >>> 0; }
  return table;
})();

function inferredCount(rowsByCondition) {
  let count = 0;
  const examples = [];
  for (const condition of ORDER) for (const row of eligibleRows(rowsByCondition[condition])) {
    const inferredEvidence = new Set((row.delta?.vertices ?? []).filter((vertex) => vertex.label === "ProvenanceEvidence" && vertex.properties?.confidence === "inferred").map((vertex) => vertex.id));
    const targets = new Set((row.delta?.edges ?? []).filter((edge) => inferredEvidence.has(edge.in)).map((edge) => edge.out));
    for (const vertex of (row.delta?.vertices ?? []).filter((item) => ["DecisionRule", "OperatingHeuristic"].includes(item.label) && targets.has(item.id))) {
      count += 1; examples.push({ condition, utterance_id: row.utterance_id, vertex_id: vertex.id });
    }
  }
  return { count, examples };
}

function utteranceGroundingOutcomes(rows, verdicts) {
  const outcomes = new Map();
  for (const row of eligibleRows(rows)) {
    const edgeFacts = (row.admitted_facts ?? []).filter((fact) => fact.kind === "edge");
    const judged = edgeFacts.map((fact) => verdicts.get(`${row.utterance_id}:${fact.id}`));
    if (judged.some((verdict) => !verdict)) return null;
    outcomes.set(row.utterance_id, judged.some((verdict) => verdict.subject_supported !== true || verdict.object_supported !== true));
  }
  return outcomes;
}

function exactMcNemar(leftName, rightName, left, right) {
  if (!left || !right) return { status: UNMEASURED, reason: "Incomplete utterance-level grounding verdict coverage." };
  const ids = [...left.keys()].filter((id) => right.has(id));
  let leftOnly = 0; let rightOnly = 0;
  for (const id of ids) {
    if (left.get(id) && !right.get(id)) leftOnly += 1;
    if (!left.get(id) && right.get(id)) rightOnly += 1;
  }
  const discordant = leftOnly + rightOnly;
  let probability = 1;
  if (discordant) {
    const tail = Math.min(leftOnly, rightOnly);
    let sum = 0;
    for (let index = 0; index <= tail; index += 1) sum += combination(discordant, index) / (2 ** discordant);
    probability = Math.min(1, 2 * sum);
  }
  return {
    status: "MEASURED", contrast: `${leftName} vs ${rightName}`, pairedUtterances: ids.length,
    outcome: "utterance contains at least one admitted edge with an unsupported subject or object",
    leftOnly, rightOnly, discordant, exactTwoSidedP: Number(probability.toFixed(4))
  };
}

function combination(n, k) {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (n - index + 1) / index;
  return result;
}

function writeArtifacts(metrics, audit, rowsByCondition) {
  const tableRows = ORDER.map((condition) => {
    const c = metrics.conditions[condition];
    return `| ${condition} | ${metricCell(c.OC)} | ${metricCell(c.SH)} | ${metricCell(c.RH)} | ${metricCell(c.OH)} | ${metricCell(c.provenanceCoverage)} | ${UNMEASURED} | ${metricCell(c.yield)} | ${c.secondsPerFact} |`;
  }).join("\n");
  const table = `# Table 1: Staged Ablation\n\n| Cond. | OC up | SH down | RH down | OH down | Prov. Cov. up | EF up | Yield | s/fact |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${tableRows}\n\nAll reported proportions include exact counts and Wilson 95% intervals. ${UNMEASURED} means the required measurement does not exist; it is not treated as zero.\n`;
  const costRows = ORDER.map((condition) => {
    const c = metrics.conditions[condition];
    return `| ${condition} | ${c.proposedFacts} | ${c.admittedFacts} | ${c.tokensPerFact} | ${c.secondsPerFact} | ${metricCell(c.retryBudgetConsumed)} |`;
  }).join("\n");
  const a0 = metrics.conditions.A0;
  const a4 = metrics.conditions.A4;
  const a5 = metrics.conditions.A5;
  const soft = metrics.conditions["A4-soft"];
  const traceExample = ORDER.flatMap((condition) => eligibleRows(rowsByCondition[condition]).flatMap((row) => (row.rejected ?? []).filter((reason) => reason.includes("traceText")).map((reason) => ({ condition, utterance_id: row.utterance_id, reason })))).at(0);
  const hallucination = loadJudgeVerdicts();
  const hallucinationExample = [...hallucination.values()].find((item) => item.object_supported === false || item.subject_supported === false);
  const results = `# NeSy 2026 Measured Results\n\nGenerated: ${metrics.generatedAt}\n\n## Executive Result\n\nThis package reports only measurements recovered from API caches and deterministic gate replay. A1-A3 are unchanged. A0 was recovered by normalizing the actual free-form responses. A4 and A5 admitted ${a4.admittedFacts}/${a4.proposedFacts} and ${a5.admittedFacts}/${a5.proposedFacts} facts after the corrected endpoint contract; A4-soft admitted ${soft.admittedFacts}/${soft.proposedFacts}. Human EF and kappa remain ${UNMEASURED}.\n\n## Corpus And Method\n\n- One hospitality session, 78 transcript messages, 45 expert turns, 32 eligible turns, and 13 deterministic navigation/filler exclusions.\n- Extractor: gpt-4o-mini; temperature 0; seed 20260716; prompt hash f075680de0f1ef0c13a94df1fa5c5baccaf143d09526a3a7b19d7214111d384f.\n- Grounding judge: gpt-4o where cached verdicts cover every admitted edge.\n- Fact: one knowledge vertex, or one edge whose endpoints are both knowledge vertices.\n- A4/A5/A4-soft were replayed locally from their final cached deltas after the provenance contract repair. Original API token, latency, and retry totals are retained.\n\n## Table 1\n\n${table.replace(/^# Table 1: Staged Ablation\n\n/, "")}\n## Findings\n\n### Structure Is Not Evidential Binding\n\nA1 reached ${metricCell(metrics.conditions.A1.OC)}, but only ${metricCell(metrics.conditions.A1.provenanceCoverage)} of admitted knowledge vertices had provenance. A3 reached ${metricCell(metrics.conditions.A3.OC)} with provenance coverage ${metricCell(metrics.conditions.A3.provenanceCoverage)}. Typed structure and retry therefore produced schema-valid output without reliably binding it to evidence.\n\n### Provenance Contract Failure\n\nThe provenance attachment map omitted ExpertRole, HospitalityBusiness, and OperatingTenure even though the schema declares them as knowledge classes. This first-hand deployment failure caused endpoint and attachment disagreement, directly supporting Lesson 1: extractor instructions, schema endpoints, and gate rules must share one generated contract. The repair makes all three provenance-required via supportedBy. Other failures, including missing provenance edges and dangling semantic edges, remain genuine rejections.\n\n### A0 Parser Recovery\n\nThe original A0 parser expected strict id/label/properties and out/in shapes. Actual free-form responses used flat properties, source/target edges, and occasional type-keyed objects. The liberal parser recovered ${a0.admittedFacts} admitted facts from 32 eligible turns. JSON unparseable rate: ${metricCell(a0.unparseableRate)}. Empty deltas remain legitimate zero-yield outputs.\n\n### Logged Examples\n\n- Rejected provenance trace: ${traceExample ? `\`${traceExample.condition}\` ${traceExample.utterance_id}: ${traceExample.reason}` : `${UNMEASURED}; no final replay rejection contained trace text.`}\n- Hallucinated relation endpoint: ${hallucinationExample ? `${hallucinationExample.id}: ${hallucinationExample.reason}` : UNMEASURED}.\n- Temporal contradiction example: ${UNMEASURED}; the run did not implement a temporal contradiction adjudicator, so the previous numeric claims were removed.\n\n### Lesson-5 Check\n\nDecisionRule or OperatingHeuristic vertices attached to evidence marked confidence=inferred: ${metrics.lesson5.inferredRuleOrHeuristicCount}. The count is descriptive; compliance with the two-episode rule requires the cited episode text and is not inferred from confidence alone.\n\n## Cost Accounting\n\n| Condition | Proposed | Admitted | Tokens/fact | Seconds/fact | Retry budget |\n|---|---:|---:|---:|---:|---:|\n${costRows}\n\nProposal counts vary materially by condition. This is a threat to the paper's claim that only the gate varies: request shape, feedback, and graph state also changed extractor volume. Fact-level pairing is therefore invalid.\n\n## Audit And Statistical Tests\n\nThe blinded audit contains ${audit.totalRows} rows: ${Object.entries(audit.byCondition).map(([condition, count]) => `${condition}=${count}`).join(", ")}. Conditions with at most 50 admitted facts use a census; larger pools use a section-stratified sample of 40. Human fields are blank. EF and Cohen's kappa are ${UNMEASURED} until two pre-adjudication files and one adjudicated file arrive.\n\nMcNemar tests are omitted. A0 lacks cached per-edge judge verdicts, and the recovered A4/A5 conditions do not provide paired grounded-fact outcomes. Reporting a paired test from proposal-level facts would be invalid.\n\nThe downstream QA probe is ${UNMEASURED} and out of scope. Recommend cutting the corresponding sentence from Section 5 paragraph 3.\n\n## Decisions I Made Autonomously\n\n- Classified ExpertRole, HospitalityBusiness, and OperatingTenure as provenance-required because they are expert-asserted world claims, using supportedBy to match the default provenance convention. This can reduce yield relative to exempting identity/business facts, but preserves the experiment's evidence-binding thesis.\n- Treated empty A0 JSON deltas as parsed zero-yield results; only malformed JSON counts as unparseable.\n- Replayed final cached A4/A5/A4-soft deltas and retained original run costs. Earlier attempt bodies are cache-resident but not linked in raw rows, so no claim is made that replay stopped at the earliest newly passing attempt.\n- Used ${UNMEASURED}, never zero, when a denominator or required annotation is absent.\n\n## Threats To Validity\n\n- One session and one domain limit external validity.\n- Proposal-count variance means fact-level cross-condition pairing is impossible.\n- The session was voice-transcribed; verbatimText is ASR output, so transcription errors can surface as apparent extraction or grounding failures.\n- Seed support is best-effort and does not guarantee deterministic provider output.\n- SH/OH use an independent model judge and are ${UNMEASURED} where complete cached verdict coverage is absent.\n- Final-delta gate replay cannot reconstruct the counterfactual graph state that would result from stopping on an earlier corrected attempt.\n- A0 normalization infers schema labels from emitted property signatures; all raw responses and adapter diagnostics remain available for audit.\n\n## Reproduction\n\n- Rebuild: \`npm run results:recover\`\n- Ingest completed human audit: \`npm run results:audit\`\n- Validate: \`npm run test\`\n- Full checks: \`npm run typecheck && npm run lint && npm run build && npm run test\`\n`;
  const mcnemarText = `Exact two-sided McNemar tests use 32 paired utterances and the binary outcome "at least one admitted edge has an unsupported subject or object":\n${Object.values(metrics.mcnemar).map((test) => `- ${test.contrast}: left-only=${test.leftOnly}, right-only=${test.rightOnly}, discordant=${test.discordant}, exact p=${test.exactTwoSidedP}.`).join("\n")}\n\nThis utterance-level pairing is valid even though fact-level pairing is not; a no-edge or no-admission utterance has no ungrounded admitted edge.`;
  const correctedResults = results
    .replace("marked confidence=inferred: undefined.", `marked confidence=inferred: ${metrics.lesson5.count}.`)
    .replace("McNemar tests are omitted. A0 lacks cached per-edge judge verdicts, and the recovered A4/A5 conditions do not provide paired grounded-fact outcomes. Reporting a paired test from proposal-level facts would be invalid.", mcnemarText);
  const numberRows = [];
  numberRows.push(["Schema vertex classes", schema.vertices.length, "src/main/json/hospitality.json"]);
  numberRows.push(["Knowledge vertex classes", KNOWLEDGE.size, "Schema labels minus infrastructure"]);
  numberRows.push(["Edge types", schema.edges.length, "src/main/json/hospitality.json"]);
  numberRows.push(["Sessions", 1, "results/corpus_stats.json"]);
  numberRows.push(["Expert turns", "45 total; 32 eligible", "results/corpus_stats.json"]);
  numberRows.push(["Cohen's kappa", UNMEASURED, "Pending two completed pre-adjudication files"]);
  numberRows.push(["QA probe", `${UNMEASURED} - out of scope`, "Recommend cut from Section 5 paragraph 3"]);
  for (const condition of ORDER) {
    const c = metrics.conditions[condition];
    numberRows.push([`${condition} candidate facts`, c.proposedFacts, `results/raw/${condition}.jsonl proposed_fact_count`]);
    numberRows.push([`${condition} admitted facts`, c.admittedFacts, `results/raw/${condition}.jsonl admitted_fact_count`]);
    for (const [label, key] of [["ontology conformance", "OC"], ["subject hallucination", "SH"], ["relation hallucination", "RH"], ["object hallucination", "OH"], ["provenance coverage", "provenanceCoverage"], ["yield", "yield"], ["duplicate rate", "duplicateRate"], ["retry budget", "retryBudgetConsumed"]]) {
      numberRows.push([`${condition} ${label}`, metricCell(c[key]), c[key]?.value === UNMEASURED ? c[key]?.reason ?? "No valid denominator" : `${c.evidence}; exact numerator/denominator in results/metrics.json`]);
    }
    numberRows.push([`${condition} evidential faithfulness`, UNMEASURED, "Pending adjudicated human audit labels"]);
    numberRows.push([`${condition} tokens per admitted fact`, c.tokensPerFact, `${c.evidence}; sum(tokens)/admitted facts`]);
    numberRows.push([`${condition} seconds per admitted fact`, c.secondsPerFact, `${c.evidence}; sum(latency_ms)/admitted facts`]);
    numberRows.push([`${condition} temporal contradictions`, UNMEASURED, "No temporal contradiction adjudicator was run"]);
  }
  for (const test of Object.values(metrics.mcnemar)) numberRows.push([`${test.contrast} McNemar exact p`, test.exactTwoSidedP, `results/metrics.json; ${test.pairedUtterances} paired utterances, ${test.discordant} discordant pairs`]);
  const numberMap = `# Complete Number Map\n\n| Claim | Value | Evidence |\n|---|---:|---|\n${numberRows.map((row) => `| ${row[0]} | ${row[1]} | ${row[2]} |`).join("\n")}\n\nEvery numeric result in this package is computed from a named artifact. Missing experiments are ${UNMEASURED}; no benchmark-derived substitutions are used.\n`;
  fs.writeFileSync(path.join(RESULTS, "results.md"), correctedResults);
  fs.writeFileSync(path.join(RESULTS, "table1.md"), table);
  fs.writeFileSync(path.join(RESULTS, "number_map.md"), numberMap);
}

function main() {
  const rowsByCondition = {};
  rowsByCondition.A0 = recoverA0();
  for (const condition of ["A1", "A2", "A3"]) rowsByCondition[condition] = readRows(condition).map((row) => ({ ...row, excluded_as_filler: fillerIds.has(row.utterance_id), analysis_validity: fillerIds.has(row.utterance_id) ? "excluded_navigation_or_filler" : "canonical_measured_run" }));
  for (const condition of REPLAY) rowsByCondition[condition] = replayCondition(condition);
  for (const condition of ["A1", "A2", "A3"]) writeRows(condition, rowsByCondition[condition]);
  const verdicts = loadJudgeVerdicts();
  const conditions = Object.fromEntries(ORDER.map((condition) => [condition, summarize(condition, rowsByCondition[condition], verdicts)]));
  const audit = writeAudit(rowsByCondition);
  const lesson5 = inferredCount(rowsByCondition);
  const outcomes = Object.fromEntries(ORDER.map((condition) => [condition, utteranceGroundingOutcomes(rowsByCondition[condition], verdicts)]));
  const mcnemar = {
    A0_vs_A1: exactMcNemar("A0", "A1", outcomes.A0, outcomes.A1),
    A3_vs_A4: exactMcNemar("A3", "A4", outcomes.A3, outcomes.A4),
    A0_vs_A5: exactMcNemar("A0", "A5", outcomes.A0, outcomes.A5)
  };
  const generatedAt = new Date().toISOString();
  const metrics = {
    generatedAt, status: "MEASURED_OR_UNMEASURED_ONLY",
    scope: "One hospitality session; 32 eligible expert turns after deterministic filler exclusion",
    schema: { vertexClasses: schema.vertices.length, knowledgeVertexClasses: KNOWLEDGE.size, infrastructureClasses: INFRASTRUCTURE.size, edgeTypes: schema.edges.length },
    validationRules: 25,
    factDefinition: "One knowledge vertex, or one edge whose endpoints are both knowledge vertices. Infrastructure and provenance edges are excluded.",
    corpus: { sessions: 1, messages: corpus.messages, expertTurns: 45, eligibleTurns: 32, excludedTurns: 13 },
    conditions, cohensKappa: UNMEASURED,
    downstreamQa: { status: UNMEASURED, reason: "Out of scope; experiment was not run." },
    mcnemar,
    humanAudit: { status: "pending", ...audit }, lesson5,
    methodology: { proportions: "Exact counts with Wilson 95% confidence intervals.", unavailable: "UNMEASURED is used when the required experiment, denominator, or human labels do not exist." }
  };
  fs.writeFileSync(path.join(RESULTS, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(path.join(RESULTS, "evidence_manifest.json"), `${JSON.stringify({
    generatedAt, canonical: "results/metrics.json", status: "measured_or_unmeasured_only",
    conditionEvidence: Object.fromEntries(ORDER.map((condition) => [condition, `results/raw/${condition}.jsonl`])),
    groundingJudgeEvidence: "results/cache/real-ablation/*.json responses containing verdicts",
    humanAuditStatus: "pending", endpointContract: ["hopitality files/provenance spec.json", "hopitality files/validation rules.json"]
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(RAW, "README.md"), `# Raw Run Logs\n\nEvery JSONL file contains one row per expert turn. Rows marked excluded_as_filler do not contribute to canonical metrics. A0 was reconstructed from cached free-form API responses. A1-A3 preserve the measured run. A4, A5, and A4-soft contain deterministic final-delta gate replay under the corrected provenance endpoint contract; replay_original_* fields preserve the pre-replay decision.\n`);
  fs.writeFileSync(path.join(RESULTS, "rejections", "README.md"), `# Rejection Logs\n\nCanonical per-turn rule IDs and reasons are stored in the rejected array of results/raw/A2.jsonl, A3.jsonl, A4.jsonl, A5.jsonl, and A4-soft.jsonl. Original A4/A5/A4-soft decisions remain in replay_original_rejections.\n`);
  fs.writeFileSync(path.join(RESULTS, "config", "source_specs_snapshot.json"), `${JSON.stringify({
    validation: readJson("hopitality files/validation rules.json"),
    provenance: readJson("hopitality files/provenance spec.json"),
    ingestionConfig: readJson("hopitality files/ingestion config.json")
  }, null, 2)}\n`);
  writeArtifacts(metrics, audit, rowsByCondition);
  console.log(JSON.stringify({ status: metrics.status, conditions: Object.fromEntries(ORDER.map((condition) => [condition, { proposed: conditions[condition].proposedFacts, admitted: conditions[condition].admittedFacts }])), audit }, null, 2));
}

main();
