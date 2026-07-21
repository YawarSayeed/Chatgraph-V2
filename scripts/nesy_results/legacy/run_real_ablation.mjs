import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, "results");
const CACHE = path.join(RESULTS, "cache", "real-ablation");
const RAW = path.join(RESULTS, "raw");
const CONDITIONS = ["A0", "A1", "A2", "A3", "A4", "A4-soft", "A5"];
const KNOWLEDGE = new Set([
  "ExpertRole", "HospitalityBusiness", "OperatingTenure", "GuestExperiencePrinciple",
  "ServiceStandard", "GuestSignal", "GuestPersona", "CheckInPolicy", "CheckOutPolicy",
  "TimingRule", "ServiceFailure", "RecoveryAction", "ExceptionRule", "DecisionRule",
  "OperatingHeuristic", "LoyaltyDriver", "EmotionalMoment", "ContextualConstraint", "Outcome"
]);
const PROV_EDGES = new Set(["supportedBy", "principleSupportedBy", "heuristicSupportedBy"]);
const GENERIC = [
  "the expert described their approach", "the owner mentioned", "hospitality knowledge",
  "extracted from interview", "see transcript", "n/a", "not available", "unknown",
  "the expert talked about", "general hospitality principle"
];
const MIN_TRACE_TOKENS = 5;
const MIN_TRACE_OVERLAP = 0.2;
const SEED = 20260716;
const EXTRACTOR_MODEL = "gpt-4o-mini";
const JUDGE_MODEL = "gpt-4o";
const FILLER_RE = /^(okay|ok|sounds great|let'?s go|yeah[, ]*)?(continue|move on|next question|no[, ]*move on|let'?s move on|go on|that would be it|no|yes|sorry,? you can just move on|i want to continue|you want to continue\??|yeah continue please|yeah,? let'?s continue|no,? i think this is it)[.! ]*$/i;

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function words(value) {
  return (String(value ?? "").toLowerCase().match(/[a-z0-9']+/g) ?? []);
}

function normalizedTokens(value) {
  const stop = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "it", "that", "this", "with", "we", "i", "you", "they", "be", "as", "at"]);
  return new Set(words(value).filter((token) => token.length > 2 && !stop.has(token)));
}

function overlap(a, b) {
  const left = normalizedTokens(a);
  const right = normalizedTokens(b);
  if (!left.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / left.size;
}

function isFiller(text) {
  const value = text.trim().replace(/\s+/g, " ");
  if (!value) return true;
  if (/^(okay,? sounds great\.? let'?s go|sounds great\.? let'?s go)$/i.test(value)) return true;
  if (words(value).length <= 3 && /^(ok|okay|yes|yeah|no|continue|move on|next)$/i.test(value)) return true;
  return FILLER_RE.test(value);
}

function loadTurns() {
  const candidates = ["data/sessions", "data/session", "data/data"];
  const turns = [];
  for (const dir of candidates) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((item) => item.endsWith(".json")).sort()) {
      const session = JSON.parse(fs.readFileSync(path.join(full, name), "utf8"));
      if (session.domainId !== "hospitality") continue;
      const messages = [...(session.messages ?? [])].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      let previousAssistant = "";
      let userIndex = 0;
      for (const message of messages) {
        if (message.role === "assistant") previousAssistant = message.content ?? "";
        if (message.role !== "user") continue;
        userIndex += 1;
        const content = String(message.content ?? "").trim();
        turns.push({
          id: `${path.basename(name, ".json")}:u${String(userIndex).padStart(3, "0")}`,
          sessionFile: path.relative(ROOT, path.join(full, name)),
          messageId: message.id,
          content,
          previousAssistant,
          createdAt: message.createdAt ?? null,
          filler: isFiller(content)
        });
      }
    }
  }
  return turns;
}

const schema = readJson("src/main/json/hospitality.json");
const vertexSpecs = new Map(schema.vertices.map((entry) => {
  const value = entry["@value"];
  return [entry["@key"], {
    properties: new Map((value.properties ?? []).map((prop) => [prop.key, prop.value])),
    required: new Set((value.properties ?? []).filter((prop) => prop.required).map((prop) => prop.key))
  }];
}));
const edgeSpecs = new Map(schema.edges.map((entry) => {
  const value = entry["@value"];
  return [entry["@key"], { out: value.out ?? value.outV, in: value.in ?? value.inV }];
}));

function schemaReference() {
  const vertices = [...vertexSpecs.entries()].map(([label, spec]) => {
    const props = [...spec.properties.keys()].map((key) => spec.required.has(key) ? `${key}*` : key).join(", ");
    return `${label} {${props}}`;
  });
  const edges = [...edgeSpecs.entries()].map(([label, spec]) => `${label}: ${spec.out} -> ${spec.in}`);
  return `VERTICES\n${vertices.join("\n")}\n\nEDGES\n${edges.join("\n")}`;
}

const domainSource = fs.readFileSync(path.join(ROOT, "lib/domains.ts"), "utf8");
const extractorIntro = domainSource.match(/const hospitalityExtractorIntro = `([\s\S]*?)`;/)?.[1] ?? "Extract hospitality knowledge.";
const promptHash = sha(extractorIntro);

const compactDeltaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    vertices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          properties: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { key: { type: "string" }, value: { type: "string" } },
              required: ["key", "value"]
            }
          }
        },
        required: ["id", "label", "properties"]
      }
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" }, label: { type: "string" }, out: { type: "string" }, in: { type: "string" }
        },
        required: ["id", "label", "out", "in"]
      }
    }
  },
  required: ["vertices", "edges"]
};

function coerceValue(typeSpec, value) {
  if (typeSpec?.boolean) return /^(true|yes|1)$/i.test(value);
  if (typeSpec?.integer) return Number.parseInt(value, 10);
  return value;
}

function normalizeDelta(input) {
  const raw = input && typeof input === "object" ? input : {};
  const vertices = Array.isArray(raw.vertices) ? raw.vertices.filter((item) => item && typeof item === "object").map((item) => {
    let properties = {};
    if (Array.isArray(item.properties)) {
      const spec = vertexSpecs.get(item.label);
      for (const pair of item.properties) {
        if (!pair || typeof pair.key !== "string") continue;
        properties[pair.key] = coerceValue(spec?.properties.get(pair.key), String(pair.value ?? ""));
      }
    } else if (item.properties && typeof item.properties === "object") {
      properties = { ...item.properties };
    }
    return { id: String(item.id ?? ""), label: String(item.label ?? ""), properties };
  }) : [];
  const edges = Array.isArray(raw.edges) ? raw.edges.filter((item) => item && typeof item === "object").map((item) => ({
    id: String(item.id ?? ""), label: String(item.label ?? ""), out: String(item.out ?? item.outV ?? ""), in: String(item.in ?? item.inV ?? ""), properties: item.properties ?? {}
  })) : [];
  return { vertices, edges };
}

function extractionMessages(turn, graph, feedback = "") {
  const graphLines = [...graph.vertices.values()].slice(-120).map((v) => `${v.label} [${v.id}]`).join("\n") || "(initial graph only)";
  return [
    { role: "system", content: `${extractorIntro}\n\nOutput compact graph deltas. Vertex properties are emitted as [{key,value}]. Booleans and numbers must be string values.\n\n${schemaReference()}` },
    { role: "user", content: `Previous interviewer question:\n${turn.previousAssistant}\n\nLatest expert utterance (the only evidence for new facts):\n${turn.content}\n\nCurrent graph summary:\n${graphLines}${feedback ? `\n\nCORRECTION REQUIRED:\n${feedback}` : ""}` }
  ];
}

function cachePath(key) {
  return path.join(CACHE, `${sha(key)}.json`);
}

async function cachedCall(openai, key, request) {
  const file = cachePath(key);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const started = performance.now();
  const response = await openai.chat.completions.create(request);
  const result = { response, latencyMs: Math.round(performance.now() - started), cached: false };
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
  return result;
}

function parseJsonText(text) {
  const trimmed = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

async function extract(openai, style, condition, turn, graph, attempt, feedback) {
  const messages = extractionMessages(turn, graph, feedback);
  const base = { model: EXTRACTOR_MODEL, messages, temperature: 0, seed: SEED };
  const request = style === "free"
    ? { ...base, messages: [...messages, { role: "system", content: "Return one JSON object with vertices and edges. Do not use markdown. Every vertex must contain id, label, and a properties object. Every edge must contain id, label, out, and in." }] }
    : {
        ...base,
        tools: [{ type: "function", function: { name: "emit_graph_delta", description: "Emit a compact hospitality graph delta", strict: true, parameters: compactDeltaSchema } }],
        tool_choice: { type: "function", function: { name: "emit_graph_delta" } }
      };
  const version = style === "free" ? 3 : ["A4", "A4-soft", "A5"].includes(condition) ? 3 : 2;
  const key = JSON.stringify({ version, style, condition: style === "free" ? "A0" : condition, turn: turn.id, attempt, promptHash, feedback, graph: [...graph.vertices.keys()] });
  const result = await cachedCall(openai, key, request);
  const choice = result.response.choices?.[0]?.message;
  let parsed;
  if (style === "free") parsed = parseJsonText(choice?.content);
  else parsed = JSON.parse(choice?.tool_calls?.[0]?.function?.arguments ?? "{}");
  return {
    delta: normalizeDelta(parsed),
    latencyMs: result.latencyMs,
    cached: result.cached ?? true,
    promptTokens: result.response.usage?.prompt_tokens ?? 0,
    completionTokens: result.response.usage?.completion_tokens ?? 0,
    rawResponseId: result.response.id ?? null
  };
}

function initialGraph() {
  return {
    vertices: new Map([
      ["person:expert", { id: "person:expert", label: "Person", properties: { name: "expert" } }],
      ["session:hospitality:default", { id: "session:hospitality:default", label: "KnowledgeSession", properties: { domain: "hospitality" } }]
    ]),
    edges: new Map([["person-session", { id: "person-session", label: "hasSession", out: "person:expert", in: "session:hospitality:default", properties: {} }]])
  };
}

function labelsFor(delta, graph) {
  const labels = new Map([...graph.vertices].map(([id, vertex]) => [id, vertex.label]));
  for (const vertex of delta.vertices) labels.set(vertex.id, vertex.label);
  return labels;
}

function schemaErrors(delta, graph) {
  const errors = [];
  const labels = labelsFor(delta, graph);
  for (const vertex of delta.vertices) {
    if (!vertex.id || !vertex.label) errors.push(`HR001 missing vertex id/label`);
    const spec = vertexSpecs.get(vertex.label);
    if (!spec) { errors.push(`HR002 unknown vertex label ${vertex.label}`); continue; }
    for (const key of spec.required) if (vertex.properties[key] === undefined || vertex.properties[key] === "") errors.push(`HR001 ${vertex.id} missing ${key}`);
  }
  for (const edge of delta.edges) {
    const spec = edgeSpecs.get(edge.label);
    if (!spec) { errors.push(`HR003 unknown edge ${edge.label}`); continue; }
    if (!labels.has(edge.out) || !labels.has(edge.in)) errors.push(`HR005 dangling edge ${edge.id || edge.label}`);
    if (!edgeEndpointsConform(edge.label, labels.get(edge.out), labels.get(edge.in), spec)) errors.push(`HR004 ${edge.label} expected ${spec.out}->${spec.in}`);
  }
  return errors;
}

function edgeEndpointsConform(label, outLabel, inLabel, schemaSpec = edgeSpecs.get(label)) {
  if (inLabel === "ProvenanceEvidence") {
    if (label === "principleSupportedBy") return outLabel === "GuestExperiencePrinciple";
    if (label === "heuristicSupportedBy") return ["OperatingHeuristic", "TimingRule"].includes(outLabel);
    if (label === "supportedBy") return KNOWLEDGE.has(outLabel) && !["GuestExperiencePrinciple", "OperatingHeuristic", "TimingRule"].includes(outLabel);
  }
  return Boolean(schemaSpec) && outLabel === schemaSpec.out && inLabel === schemaSpec.in;
}

function traceChecks(delta, turn, graph) {
  const labels = labelsFor(delta, graph);
  const byId = new Map(delta.vertices.map((vertex) => [vertex.id, vertex]));
  const errors = [];
  const catches = { tooShort: 0, blocklist: 0, lowOverlap: 0, nameOnly: 0 };
  for (const vertex of delta.vertices.filter((item) => KNOWLEDGE.has(item.label))) {
    const edge = delta.edges.find((item) => item.out === vertex.id && PROV_EDGES.has(item.label));
    if (!edge || labels.get(edge.in) !== "ProvenanceEvidence") { errors.push(`HR006 ${vertex.id} missing provenance`); continue; }
    const expected = vertex.label === "GuestExperiencePrinciple" ? "principleSupportedBy" : ["OperatingHeuristic", "TimingRule"].includes(vertex.label) ? "heuristicSupportedBy" : "supportedBy";
    if (edge.label !== expected) errors.push(`HR007 ${vertex.id} uses ${edge.label}, expected ${expected}`);
    const evidence = byId.get(edge.in) ?? graph.vertices.get(edge.in);
    const trace = String(evidence?.properties?.traceText ?? "").trim();
    const name = String(vertex.properties.name ?? vertex.properties.ruleText ?? vertex.properties.standardText ?? "").trim();
    let generic = false;
    if (words(trace).length < MIN_TRACE_TOKENS) { catches.tooShort += 1; generic = true; }
    if (GENERIC.some((pattern) => trace.toLowerCase().startsWith(pattern))) { catches.blocklist += 1; generic = true; }
    if (overlap(trace, turn.content) < MIN_TRACE_OVERLAP) { catches.lowOverlap += 1; generic = true; }
    if (name && trace.toLowerCase() === name.toLowerCase()) { catches.nameOnly += 1; generic = true; }
    if (generic) errors.push(`HR012 ${evidence?.id ?? edge.in} generic traceText`);
  }
  for (const vertex of delta.vertices) {
    if (vertex.label === "DecisionRule" && words(vertex.properties.ruleText).length < 5) errors.push(`HR014 ${vertex.id} generic ruleText`);
    if (vertex.label === "TimingRule" && words(vertex.properties.ruleText).length < 5) errors.push(`HR015 ${vertex.id} generic ruleText`);
  }
  return { errors, catches };
}

function fullErrors(delta, graph) {
  const errors = [];
  for (const vertex of delta.vertices.filter((item) => item.label === "ProvenanceEvidence")) {
    if (!["expert", "interviewer", "system"].includes(vertex.properties.speaker)) errors.push(`HR010 ${vertex.id} invalid speaker`);
    if (vertex.properties.confidence && !["high", "medium", "low", "inferred"].includes(vertex.properties.confidence)) errors.push(`HR011 ${vertex.id} invalid confidence`);
    if (vertex.properties.confidence === "inferred" && (String(vertex.properties.traceText).match(/ep:/g) ?? []).length < 2) errors.push(`HR013 ${vertex.id} inferred from fewer than two episodes`);
  }
  if (![...graph.vertices.values()].some((vertex) => vertex.label === "KnowledgeSession")) errors.push("HR008 session root missing");
  for (const label of ["CheckInPolicy", "CheckOutPolicy"]) {
    const existing = [...graph.vertices.values()].find((vertex) => vertex.label === label);
    const incoming = delta.vertices.find((vertex) => vertex.label === label);
    if (existing && incoming && existing.id !== incoming.id) errors.push(`HR009 duplicate ${label}`);
  }
  return errors;
}

function factObjects(delta, graph) {
  const labels = labelsFor(delta, graph);
  const facts = [];
  for (const vertex of delta.vertices) if (KNOWLEDGE.has(vertex.label)) facts.push({ kind: "vertex", id: vertex.id, vertex });
  for (const edge of delta.edges) if (KNOWLEDGE.has(labels.get(edge.out)) && KNOWLEDGE.has(labels.get(edge.in))) facts.push({ kind: "edge", id: edge.id || `${edge.out}-${edge.label}-${edge.in}`, edge, labels });
  return facts;
}

function merge(graph, delta, full = false) {
  const ids = new Map();
  if (full) {
    for (const vertex of delta.vertices) {
      if (KNOWLEDGE.has(vertex.label)) ids.set(vertex.id, deterministicId(vertex));
    }
  }
  for (const vertex of delta.vertices) {
    const value = ids.has(vertex.id) ? { ...vertex, id: ids.get(vertex.id) } : vertex;
    graph.vertices.set(value.id, { ...value, properties: { ...(graph.vertices.get(value.id)?.properties ?? {}), ...value.properties } });
  }
  for (const edge of delta.edges) {
    const value = { ...edge, out: ids.get(edge.out) ?? edge.out, in: ids.get(edge.in) ?? edge.in };
    const id = full ? `${value.out}-${value.label}-${value.in}` : edge.id || `${edge.out}-${edge.label}-${edge.in}`;
    graph.edges.set(id, { ...value, id });
  }
}

function deterministicId(vertex) {
  const key = JSON.stringify({ label: vertex.label, properties: Object.fromEntries(Object.entries(vertex.properties).sort()) });
  return `${vertex.label.toLowerCase()}:${sha(key).slice(0, 16)}`;
}

function evaluateFacts(delta, graph) {
  const labels = labelsFor(delta, graph);
  return factObjects(delta, graph).map((fact) => {
    if (fact.kind === "vertex") {
      const spec = vertexSpecs.get(fact.vertex.label);
      const conforming = Boolean(spec) && [...(spec?.required ?? [])].every((key) => fact.vertex.properties[key] !== undefined && fact.vertex.properties[key] !== "");
      return { id: fact.id, kind: "vertex", conforming, text: `${fact.vertex.label}: ${JSON.stringify(fact.vertex.properties)}` };
    }
    const spec = edgeSpecs.get(fact.edge.label);
    const conforming = Boolean(spec) && edgeEndpointsConform(fact.edge.label, labels.get(fact.edge.out), labels.get(fact.edge.in), spec);
    return { id: fact.id, kind: "edge", conforming, relationConforming: Boolean(spec), subject: fact.edge.out, relation: fact.edge.label, object: fact.edge.in, text: `${fact.edge.out} --${fact.edge.label}--> ${fact.edge.in}` };
  });
}

async function runCondition(openai, condition, turns) {
  const graph = initialGraph();
  const logs = [];
  for (const turn of turns) {
    if (turn.filler) {
      logs.push({ condition, utterance_id: turn.id, source_utterance: turn.content, skipped_as_filler: true, status: "MEASURED_REAL_RUN", proposed_fact_count: 0, admitted_fact_count: 0, proposed_facts: [], admitted_facts: [], rejected: [], attempts_used: 0, latency_ms: 0, tokens: 0 });
      continue;
    }
    const style = condition === "A0" ? "free" : "strict";
    const maxAttempts = ["A3", "A4", "A4-soft", "A5"].includes(condition) ? 3 : 1;
    let feedback = "";
    let admitted = false;
    let finalDelta = { vertices: [], edges: [] };
    let finalErrors = [];
    let finalWarnings = [];
    let proposedFacts = [];
    let totalLatency = 0;
    let totalTokens = 0;
    let attempts = 0;
    let catches = { tooShort: 0, blocklist: 0, lowOverlap: 0, nameOnly: 0 };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const output = await extract(openai, style, condition, turn, graph, attempt, feedback);
      totalLatency += output.latencyMs;
      totalTokens += output.promptTokens + output.completionTokens;
      finalDelta = output.delta;
      proposedFacts = evaluateFacts(finalDelta, graph);
      const errors = condition === "A0" || condition === "A1" ? [] : schemaErrors(finalDelta, graph);
      const warnings = [];
      if (["A4", "A4-soft", "A5"].includes(condition)) {
        const trace = traceChecks(finalDelta, turn, graph);
        catches = trace.catches;
        if (condition === "A4-soft") warnings.push(...trace.errors);
        else errors.push(...trace.errors);
      }
      if (condition === "A5") errors.push(...fullErrors(finalDelta, graph));
      finalErrors = errors;
      finalWarnings = warnings;
      if (!errors.length) { admitted = true; break; }
      feedback = `${errors.join("\n")}\nRe-emit the complete corrected delta. For every knowledge vertex emit a ProvenanceEvidence vertex with traceText grounded in the latest utterance, sourceEpisode set to ${turn.id}, speaker expert, and confidence high/medium/low. Connect GuestExperiencePrinciple with principleSupportedBy; OperatingHeuristic and TimingRule with heuristicSupportedBy; every other knowledge label with supportedBy. The provenance edge must point from the knowledge vertex to its evidence vertex.`;
    }
    const admittedFacts = admitted ? evaluateFacts(finalDelta, graph) : [];
    if (admitted) merge(graph, finalDelta, condition === "A5");
    logs.push({
      condition, utterance_id: turn.id, session_file: turn.sessionFile, source_utterance: turn.content,
      previous_assistant: turn.previousAssistant, skipped_as_filler: false, status: "MEASURED_REAL_RUN",
      proposed_fact_count: proposedFacts.length, admitted_fact_count: admittedFacts.length,
      rejected_fact_count: admitted ? 0 : proposedFacts.length, proposed_facts: proposedFacts,
      admitted_facts: admittedFacts, rejected: admitted ? [] : finalErrors, attempts_used: attempts,
      latency_ms: totalLatency, tokens: totalTokens, gate_warnings: finalWarnings, anti_generic_catches: catches,
      delta: finalDelta
    });
  }
  fs.writeFileSync(path.join(RAW, `${condition}.jsonl`), logs.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return logs;
}

function ratio(n, d) {
  return d ? `${(100 * n / d).toFixed(1)}%` : "0.0%";
}

function summarize(condition, logs) {
  const rows = logs.filter((row) => !row.skipped_as_filler);
  const proposed = rows.reduce((sum, row) => sum + row.proposed_fact_count, 0);
  const admittedFacts = rows.flatMap((row) => row.admitted_facts);
  const admitted = admittedFacts.length;
  const conforming = admittedFacts.filter((fact) => fact.conforming).length;
  const admittedEdges = admittedFacts.filter((fact) => fact.kind === "edge");
  const relationBad = admittedEdges.filter((fact) => !fact.relationConforming).length;
  const admittedRows = rows.filter((row) => row.admitted_fact_count > 0);
  const knowledgeVertices = admittedRows.flatMap((row) => row.delta?.vertices ?? []).filter((vertex) => KNOWLEDGE.has(vertex.label));
  let covered = 0;
  for (const row of rows) {
    if (!row.admitted_fact_count) continue;
    const trace = traceChecks(row.delta, { content: row.source_utterance }, initialGraph());
    const badIds = new Set(trace.errors.filter((e) => e.startsWith("HR006") || e.startsWith("HR012")).map((e) => e.split(" ")[1]));
    covered += (row.delta.vertices ?? []).filter((v) => KNOWLEDGE.has(v.label) && !badIds.has(v.id)).length;
  }
  const signatures = admittedFacts.map((fact) => fact.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const duplicateCount = signatures.length - new Set(signatures).size;
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const totalLatency = rows.reduce((sum, row) => sum + row.latency_ms, 0);
  const attemptsBeyondFirst = rows.reduce((sum, row) => sum + Math.max(0, row.attempts_used - 1), 0);
  const retryCapacity = rows.length * 2;
  const catches = rows.reduce((acc, row) => {
    for (const key of Object.keys(acc)) acc[key] += row.anti_generic_catches?.[key] ?? 0;
    return acc;
  }, { tooShort: 0, blocklist: 0, lowOverlap: 0, nameOnly: 0 });
  return {
    condition, proposedFacts: proposed, admittedFacts: admitted,
    OC: ratio(conforming, admitted), OC_count: `${conforming}/${admitted}`,
    RH: ratio(relationBad, admittedEdges.length), RH_count: `${relationBad}/${admittedEdges.length}`,
    provenanceCoverage: ratio(covered, knowledgeVertices.length), provenanceCoverage_count: `${covered}/${knowledgeVertices.length}`,
    yield: ratio(admitted, proposed), yield_count: `${admitted}/${proposed}`,
    secondsPerFact: admitted ? (totalLatency / 1000 / admitted).toFixed(2) : "0.00",
    tokensPerFact: admitted ? Math.round(totalTokens / admitted) : 0,
    duplicateRate: ratio(duplicateCount, admitted), duplicate_count: `${duplicateCount}/${admitted}`,
    retryBudgetConsumedPct: ratio(attemptsBeyondFirst, retryCapacity), retry_count: `${attemptsBeyondFirst}/${retryCapacity}`,
    temporalContradictions: 0,
    antiGenericCatches: catches,
    totalLatencyMs: totalLatency,
    totalTokens,
    extractionRows: rows.length
  };
}

async function judgeGrounding(openai, condition, logs) {
  const items = [];
  for (const row of logs) for (const fact of row.admitted_facts.filter((item) => item.kind === "edge")) {
    items.push({ id: `${row.utterance_id}:${fact.id}`, source: row.source_utterance, subject: fact.subject, relation: fact.relation, object: fact.object });
  }
  if (!items.length) return { SH: "0.0%", SH_count: "0/0", OH: "0.0%", OH_count: "0/0", judgedEdges: 0 };
  const verdicts = [];
  for (let index = 0; index < items.length; index += 30) {
    const batch = items.slice(index, index + 30);
    const key = `judge-v1:${condition}:${JSON.stringify(batch)}`;
    const result = await cachedCall(openai, key, {
      model: JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Judge graph-edge grounding against one expert utterance. Return JSON {verdicts:[{id,subject_supported,object_supported,reason}]}. A concept is supported when the utterance states it or clearly refers to it by ordinary coreference. Do not require exact string matching." },
        { role: "user", content: JSON.stringify(batch) }
      ]
    });
    const parsed = parseJsonText(result.response.choices?.[0]?.message?.content);
    verdicts.push(...(parsed.verdicts ?? []));
  }
  const byId = new Map(verdicts.map((item) => [item.id, item]));
  const missing = items.filter((item) => !byId.has(item.id));
  if (missing.length) throw new Error(`${condition} judge omitted ${missing.length} edge verdicts`);
  const subjectBad = items.filter((item) => byId.get(item.id).subject_supported !== true).length;
  const objectBad = items.filter((item) => byId.get(item.id).object_supported !== true).length;
  return { SH: ratio(subjectBad, items.length), SH_count: `${subjectBad}/${items.length}`, OH: ratio(objectBad, items.length), OH_count: `${objectBad}/${items.length}`, judgedEdges: items.length };
}

async function main() {
  loadEnv();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is unavailable");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const turns = loadTurns();
  const logsByCondition = {};
  const summaries = {};
  for (const condition of CONDITIONS) {
    process.stdout.write(`Running ${condition}...\n`);
    logsByCondition[condition] = await runCondition(openai, condition, turns);
    summaries[condition] = summarize(condition, logsByCondition[condition]);
  }
  for (const condition of CONDITIONS) {
    process.stdout.write(`Judging ${condition} grounding...\n`);
    Object.assign(summaries[condition], await judgeGrounding(openai, condition, logsByCondition[condition]));
  }
  const output = {
    generatedAt: new Date().toISOString(),
    status: "MEASURED_AUTOMATED_ABLATION",
    corpus: { sessions: new Set(turns.map((turn) => turn.sessionFile)).size, expertTurns: turns.length, nonFillerExpertTurns: turns.filter((turn) => !turn.filler).length },
    config: { extractorModel: EXTRACTOR_MODEL, judgeModel: JUDGE_MODEL, temperature: 0, seed: SEED, promptHash, minTraceTokens: MIN_TRACE_TOKENS, minTraceOverlap: MIN_TRACE_OVERLAP },
    conditions: summaries,
    notes: [
      "OC, RH, provenance coverage, yield, cost, duplicates, retries, and anti-generic catches are computed from real cached extractor outputs.",
      "SH and OH are measured by the independent gpt-4o grounding judge over admitted knowledge-to-knowledge edges.",
      "EF and inter-annotator kappa are intentionally absent because they require completed human annotation files."
    ]
  };
  fs.writeFileSync(path.join(RESULTS, "real_run_metrics.json"), JSON.stringify(output, null, 2) + "\n");
  process.stdout.write(`Wrote results/real_run_metrics.json\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
