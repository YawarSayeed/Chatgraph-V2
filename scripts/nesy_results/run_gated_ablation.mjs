/**
 * Staged ablation of the symbolic gate.
 *
 * Run with:
 *   node --import ./scripts/ts-alias-hooks.mjs scripts/nesy_results/run_gated_ablation.mjs
 *
 * Two properties make this a controlled experiment rather than a demonstration:
 *
 * 1. It calls the DEPLOYED gate (lib/gate) and the DEPLOYED prompt generator
 *    (lib/gate/prompt). There is no second implementation to drift from the one
 *    that serves live sessions, so a result here is a claim about the product.
 *
 * 2. Extraction is STATELESS. Every condition sends the same request for a given
 *    turn and attempt, so attempt-1 proposals are byte-identical across A1-A5 and
 *    fact-level pairing across conditions is valid. The gate is the only stateful
 *    component, which is exactly the variable under study.
 *
 * Every API call is cached by content hash, so a re-run costs nothing and returns
 * the same numbers.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

import { gateContract } from "@/lib/gate/contract";
import { runGate } from "@/lib/gate/gate";
import { extractionToolSchema, provenanceInstructions, schemaReference } from "@/lib/gate/prompt";
import { getDomain } from "@/lib/domains";

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, "results");
const CACHE = path.join(RESULTS, "cache", "gated-ablation");
const RAW = path.join(RESULTS, "raw");

const DOMAIN = "hospitality";
const EXTRACTOR_MODEL = process.env.CHATGRAPH_EXTRACTOR_MODEL || "gpt-4o-mini";
const JUDGE_MODEL = process.env.CHATGRAPH_JUDGE_MODEL || "gpt-4o";
const SEED = 20260721;
const MAX_ATTEMPTS = 3;

const CONTRACT = gateContract(DOMAIN);

/**
 * Each condition adds exactly one constraint class to the one above it.
 * `gate: null` means the delta is admitted as proposed.
 */
const CONDITIONS = [
  { id: "A0", label: "ungated free-form", style: "free", gate: null, retry: false },
  { id: "A1", label: "constrained decoding", style: "tool", gate: null, retry: false },
  { id: "A2", label: "+ typed-schema gate", style: "tool", gate: { mode: "schema" }, retry: false },
  { id: "A3", label: "+ typed-error retry", style: "tool", gate: { mode: "schema" }, retry: true },
  { id: "A4", label: "+ provenance requirement", style: "tool", gate: { mode: "governed" }, retry: true },
  {
    id: "A4-strict",
    label: "+ provenance enforced hard",
    style: "tool",
    gate: { mode: "governed", severityOverrides: { HR006: "hard" } },
    retry: true
  },
  {
    id: "A5",
    label: "full deployed gate",
    style: "tool",
    gate: { mode: "governed", deterministicIds: true, temporalContradictions: true, resolveEntities: true },
    retry: true
  }
];

const FILLER =
  /^(okay|ok|sounds great|let'?s go|yeah[, ]*)?(continue|move on|next question|no[, ]*move on|let'?s move on|go on|that would be it|no|yes|sorry,? you can just move on|i want to continue|you want to continue\??|yeah continue please|yeah,? let'?s continue|no,? i think this is it)[.! ]*$/i;

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
    if (!process.env[key]) process.env[key] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const words = (value) => String(value ?? "").trim().split(/\s+/).filter(Boolean);

function isFiller(text) {
  const value = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!value) return true;
  if (/^(okay,? sounds great\.? let'?s go|sounds great\.? let'?s go)$/i.test(value)) return true;
  if (words(value).length <= 3 && /^(ok|okay|yes|yeah|no|continue|move on|next)$/i.test(value)) return true;
  return FILLER.test(value);
}

function loadTurns() {
  const turns = [];
  for (const dir of ["data/sessions", "data/session"]) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((item) => item.endsWith(".json")).sort()) {
      const session = JSON.parse(fs.readFileSync(path.join(full, name), "utf8"));
      if (session.domainId !== DOMAIN) continue;
      const messages = [...(session.messages ?? [])].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      let previousAssistant = "";
      let index = 0;
      for (const message of messages) {
        if (message.role === "assistant") previousAssistant = message.content ?? "";
        if (message.role !== "user") continue;
        index += 1;
        const content = String(message.content ?? "").trim();
        turns.push({
          id: `${path.basename(name, ".json")}:u${String(index).padStart(3, "0")}`,
          sessionFile: path.relative(ROOT, path.join(full, name)),
          content,
          previousAssistant,
          filler: isFiller(content)
        });
      }
    }
  }
  return turns;
}

// --- extraction -----------------------------------------------------------

const DOMAIN_CONFIG = getDomain(DOMAIN);
const SYSTEM_PROMPT = [DOMAIN_CONFIG.extractorIntro, provenanceInstructions(DOMAIN), schemaReference(DOMAIN)]
  .filter(Boolean)
  .join("\n\n");
const PROMPT_HASH = sha(SYSTEM_PROMPT);

const FREE_FORM_SYSTEM = `${DOMAIN_CONFIG.extractorIntro}

Return one JSON object with "vertices" and "edges". Each vertex has id, label, and properties. Each edge has id, label, out, and in. Do not use markdown.`;

/**
 * The request depends only on the turn, the attempt, and the correction text --
 * never on the condition. Conditions that reach the same attempt with the same
 * feedback therefore share a cache entry and, by construction, an output.
 */
function extractionRequest(style, turn, feedback) {
  if (style === "free") {
    return {
      model: EXTRACTOR_MODEL,
      temperature: 0,
      seed: SEED,
      max_completion_tokens: 1600,
      messages: [
        { role: "system", content: FREE_FORM_SYSTEM },
        { role: "user", content: userMessage(turn, feedback) }
      ]
    };
  }
  return {
    model: EXTRACTOR_MODEL,
    temperature: 0,
    seed: SEED,
    max_completion_tokens: 1600,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage(turn, feedback) }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "emit_graph_delta",
          description: "Emit the knowledge the latest expert utterance adds, with evidence attached to every knowledge vertex.",
          parameters: extractionToolSchema(DOMAIN)
        }
      }
    ],
    tool_choice: { type: "function", function: { name: "emit_graph_delta" } }
  };
}

function userMessage(turn, feedback) {
  return (
    `Previous interviewer question:\n${turn.previousAssistant}\n\n` +
    `Latest expert utterance (the only evidence for new facts):\n${turn.content}` +
    (feedback ? `\n\nCORRECTION REQUIRED:\n${feedback}` : "")
  );
}

async function cachedCall(openai, key, request) {
  const file = path.join(CACHE, `${sha(key)}.json`);
  if (fs.existsSync(file)) return { ...JSON.parse(fs.readFileSync(file, "utf8")), cached: true };
  const started = Date.now();
  const response = await openai.chat.completions.create(request);
  const record = { response, latencyMs: Date.now() - started };
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, cached: false };
}

function parseJsonText(text) {
  const trimmed = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return { value: JSON.parse(trimmed), ok: true };
  } catch {
    return { value: null, ok: false };
  }
}

/** Free-form output varies in shape; normalize without inventing content. */
function normalizeFreeForm(raw) {
  if (!raw || typeof raw !== "object") return { vertices: [], edges: [] };
  const vertices = (Array.isArray(raw.vertices) ? raw.vertices : []).map((item) => {
    if (!item || typeof item !== "object") return null;
    const { id, label, type, properties, evidence, ...rest } = item;
    return {
      id: String(id ?? ""),
      label: String(label ?? type ?? ""),
      properties: properties && typeof properties === "object" ? properties : rest,
      ...(evidence && typeof evidence === "object" ? { evidence } : {})
    };
  }).filter(Boolean);
  const edges = (Array.isArray(raw.edges) ? raw.edges : []).map((item) => {
    if (!item || typeof item !== "object") return null;
    return {
      id: String(item.id ?? ""),
      label: String(item.label ?? item.type ?? ""),
      out: String(item.out ?? item.outV ?? item.source ?? item.from ?? ""),
      in: String(item.in ?? item.inV ?? item.target ?? item.to ?? "")
    };
  }).filter(Boolean);
  return { vertices, edges };
}

async function extract(openai, style, turn, attempt, feedback) {
  const request = extractionRequest(style, turn, feedback);
  const key = JSON.stringify({ v: 1, style, turn: turn.id, attempt, feedback, promptHash: PROMPT_HASH, model: EXTRACTOR_MODEL });
  const result = await cachedCall(openai, key, request);
  const message = result.response.choices?.[0]?.message;

  let delta = { vertices: [], edges: [] };
  let parsed = true;
  if (style === "free") {
    const attemptParse = parseJsonText(message?.content);
    parsed = attemptParse.ok;
    delta = normalizeFreeForm(attemptParse.value);
  } else {
    const args = message?.tool_calls?.[0]?.function?.arguments;
    const attemptParse = parseJsonText(args ?? "{}");
    parsed = attemptParse.ok;
    delta = normalizeFreeForm(attemptParse.value);
  }
  return {
    delta,
    parsed,
    latencyMs: result.latencyMs,
    tokens: (result.response.usage?.prompt_tokens ?? 0) + (result.response.usage?.completion_tokens ?? 0)
  };
}

// --- fact accounting ------------------------------------------------------

/** A fact is a non-infrastructure vertex, or an edge between two of them. */
function isFactLabel(label) {
  return Boolean(label) && !CONTRACT.infrastructureLabels.has(label);
}

function factsOf(delta, graph) {
  const byId = new Map(Object.values(graph.vertices).map((v) => [v.id, v]));
  for (const vertex of delta.vertices) byId.set(vertex.id, vertex);
  const facts = [];
  for (const vertex of delta.vertices) {
    if (!isFactLabel(vertex.label)) continue;
    facts.push({
      kind: "vertex",
      id: vertex.id,
      label: vertex.label,
      text: describe(vertex),
      conforming: vertexConforms(vertex),
      signature: contentSignature(vertex.label, vertex.properties)
    });
  }
  for (const edge of delta.edges) {
    const outVertex = byId.get(edge.out);
    const inVertex = byId.get(edge.in);
    if (!isFactLabel(outVertex?.label) || !isFactLabel(inVertex?.label)) continue;
    facts.push({
      kind: "edge",
      id: edge.id || `${edge.out}-${edge.label}-${edge.in}`,
      label: edge.label,
      subject: describe(outVertex),
      relation: edge.label,
      object: describe(inVertex),
      subjectLabel: outVertex.label,
      objectLabel: inVertex.label,
      // Rendered from endpoint content so the claim is legible independently of
      // whichever id scheme the condition happens to use.
      text: `${describe(outVertex)} --${edge.label}--> ${describe(inVertex)}`,
      conforming: edgeConforms(edge.label, outVertex.label, inVertex.label),
      relationConforming: CONTRACT.edgeSpecs.has(edge.label),
      signature: `${contentSignature(outVertex.label, outVertex.properties)}|${edge.label}|${contentSignature(inVertex.label, inVertex.properties)}`
    });
  }
  return facts;
}

/** A short human-readable rendering of a vertex, for judges and audit files. */
function describe(vertex) {
  if (!vertex) return "(unknown)";
  const properties = vertex.properties ?? {};
  const preferred = ["name", "title", "ruleText", "heuristic", "standardText", "description", "duration", "signalText"];
  for (const key of preferred) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return `${vertex.label} "${value.trim()}"`;
  }
  const first = Object.entries(properties).find(([, value]) => typeof value === "string" && value.trim());
  return first ? `${vertex.label} "${String(first[1]).trim()}"` : vertex.label;
}

function vertexConforms(vertex) {
  const spec = CONTRACT.vertexSpecs.get(vertex.label);
  if (!spec) return false;
  return [...spec.requiredProperties].every((key) => {
    const value = vertex.properties?.[key];
    return value !== undefined && value !== null && value !== "";
  });
}

function edgeConforms(label, outLabel, inLabel) {
  const spec = CONTRACT.edgeSpecs.get(label);
  return Boolean(spec) && spec.out.has(outLabel) && spec.in.has(inLabel);
}

function contentSignature(label, properties) {
  const entries = Object.entries(properties ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value).toLowerCase().replace(/\s+/g, " ").trim()}`)
    .sort();
  return `${label}|${entries.join("|")}`;
}

function initialGraph() {
  const domain = getDomain(DOMAIN);
  const vertices = {};
  for (const vertex of domain.initialVertices) vertices[vertex.id] = { ...vertex };
  const edges = {};
  for (const edge of domain.initialEdges ?? []) edges[edge.id] = { ...edge };
  return { vertices, edges };
}

function scaffold(graph, turn) {
  const sessionId = Object.values(graph.vertices).find((v) => v.label === "KnowledgeSession")?.id
    ?? "session:hospitality:default";
  const sectionId = `section:${sessionId}:1`;
  const episodeId = `ep:${sessionId}:${turn.id.split(":").pop()}`;
  return {
    episodeId,
    vertices: [
      { id: sectionId, label: "SessionSection", properties: { sectionType: "introduction", title: "Session", order: 1 } },
      { id: episodeId, label: "TranscriptEpisode", properties: { verbatimText: turn.content, speaker: "expert" } }
    ],
    edges: [
      { id: `${sessionId}--hasSection-->${sectionId}`, label: "hasSection", out: sessionId, in: sectionId },
      { id: `${sectionId}--hasEpisode-->${episodeId}`, label: "hasEpisode", out: sectionId, in: episodeId }
    ]
  };
}

// --- one condition --------------------------------------------------------

async function runCondition(openai, condition, turns) {
  const graph = initialGraph();
  const rows = [];

  for (const turn of turns) {
    if (turn.filler) {
      rows.push({
        condition: condition.id, utterance_id: turn.id, source_utterance: turn.content,
        excluded_as_filler: true, proposed_facts: [], admitted_facts: [],
        attempts_used: 0, tokens: 0, latency_ms: 0, findings: [], supersessions: []
      });
      continue;
    }

    const turnScaffold = scaffold(graph, turn);
    const maxAttempts = condition.retry ? MAX_ATTEMPTS : 1;
    let feedback = "";
    let attempts = 0;
    let tokens = 0;
    let latency = 0;
    let parsed = true;
    let proposed = [];
    let admitted = [];
    let findings = [];
    let supersessions = [];
    let finalDelta = { vertices: [], edges: [] };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const output = await extract(openai, condition.style, turn, attempt, feedback);
      tokens += output.tokens;
      latency += output.latencyMs;
      parsed = output.parsed;

      // Proposals are counted before the gate, from the extractor's own output.
      proposed = factsOf(output.delta, graph);

      if (!condition.gate) {
        finalDelta = output.delta;
        admitted = proposed;
        findings = [];
        break;
      }

      const withScaffold = {
        vertices: [...turnScaffold.vertices, ...output.delta.vertices],
        edges: [...turnScaffold.edges, ...output.delta.edges]
      };
      const result = runGate(withScaffold, graph, DOMAIN, {
        ...condition.gate,
        evidenceContext: { sourceEpisode: turnScaffold.episodeId, speaker: "expert", utterance: turn.content }
      });
      finalDelta = result.delta;
      admitted = factsOf(result.delta, graph);
      findings = result.findings;
      supersessions = result.supersessions;

      if (!result.retryFeedback) break;
      feedback = result.retryFeedback;
    }

    // Admitted material becomes the graph the next turn is gated against.
    for (const vertex of finalDelta.vertices) {
      graph.vertices[vertex.id] = { ...graph.vertices[vertex.id], ...vertex };
    }
    for (const edge of finalDelta.edges) graph.edges[edge.id] = edge;

    rows.push({
      condition: condition.id, utterance_id: turn.id, session_file: turn.sessionFile,
      source_utterance: turn.content, excluded_as_filler: false, json_parsed: parsed,
      proposed_fact_count: proposed.length, admitted_fact_count: admitted.length,
      proposed_facts: proposed, admitted_facts: admitted,
      provenance: provenanceOf(finalDelta),
      findings: findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, action: f.action, message: f.message })),
      supersessions, attempts_used: attempts, tokens, latency_ms: latency,
      delta: finalDelta
    });
  }

  fs.writeFileSync(path.join(RAW, `${condition.id}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return { rows, graph };
}

/** Which admitted knowledge vertices carry evidence, and what that evidence says. */
function provenanceOf(delta) {
  const byId = new Map(delta.vertices.map((v) => [v.id, v]));
  const out = [];
  for (const vertex of delta.vertices) {
    if (!CONTRACT.knowledgeLabels.has(vertex.label)) continue;
    const edge = delta.edges.find((e) => e.out === vertex.id && CONTRACT.provenanceEdgeLabels.has(e.label));
    const evidence = edge ? byId.get(edge.in) : null;
    out.push({
      vertexId: vertex.id,
      label: vertex.label,
      grounded: Boolean(evidence),
      traceText: evidence ? String(evidence.properties?.traceText ?? "") : null,
      confidence: evidence ? (evidence.properties?.confidence ?? null) : null
    });
  }
  return out;
}

// --- judging --------------------------------------------------------------

/**
 * Evidential faithfulness: does the utterance actually support the fact? Asked of
 * an independent model that never sees the condition, so the same fact proposed
 * under different conditions receives the same verdict from cache.
 */
async function judgeFacts(openai, rows) {
  const items = new Map();
  for (const row of rows) {
    for (const fact of row.admitted_facts) {
      const key = sha(`${row.source_utterance}|${fact.text}`);
      if (!items.has(key)) {
        items.set(key, { key, utterance: row.source_utterance, fact: fact.text, kind: fact.kind });
      }
    }
  }
  const verdicts = new Map();
  const list = [...items.values()];
  for (let index = 0; index < list.length; index += 20) {
    const batch = list.slice(index, index + 20);
    const key = `ef-v1:${JSON.stringify(batch.map((item) => [item.key, item.utterance, item.fact]))}`;
    const result = await cachedCall(openai, key, {
      model: JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You audit knowledge-graph facts against the single expert utterance they were extracted from. " +
            "Reply with JSON only. " +
            'For each item return {"key":..., "supported": true|false, "subject_supported": true|false, ' +
            '"object_supported": true|false, "reason": "..."}. ' +
            "supported is true only when the utterance states or directly implies the whole fact. " +
            "For a vertex, subject_supported and object_supported repeat supported. " +
            "For an edge of the form A --relation--> B, subject_supported asks whether A is something the utterance " +
            "refers to, object_supported asks the same of B, and supported asks whether the utterance asserts the relation between them. " +
            'Ordinary coreference counts as reference. Return {"verdicts": [...]} covering every item.'
        },
        { role: "user", content: JSON.stringify(batch.map(({ key, utterance, fact }) => ({ key, utterance, fact }))) }
      ]
    });
    const parsed = parseJsonText(result.response.choices?.[0]?.message?.content);
    for (const verdict of parsed.value?.verdicts ?? []) {
      if (verdict && typeof verdict.key === "string") verdicts.set(verdict.key, verdict);
    }
  }
  return verdicts;
}

/** Does the cited span support the fact it is attached to? */
async function judgeCitations(openai, rows) {
  const items = new Map();
  for (const row of rows) {
    for (const entry of row.provenance ?? []) {
      if (!entry.grounded || !entry.traceText) continue;
      const key = sha(`${entry.label}|${entry.vertexId}|${entry.traceText}`);
      if (!items.has(key)) {
        const vertex = row.delta.vertices.find((v) => v.id === entry.vertexId);
        items.set(key, { key, fact: `${entry.label}: ${JSON.stringify(vertex?.properties ?? {})}`, citation: entry.traceText });
      }
    }
  }
  const verdicts = new Map();
  const list = [...items.values()];
  for (let index = 0; index < list.length; index += 20) {
    const batch = list.slice(index, index + 20);
    const key = `cite-v1:${JSON.stringify(batch.map((item) => [item.key, item.fact, item.citation]))}`;
    const result = await cachedCall(openai, key, {
      model: JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You check whether a quoted span of an expert's speech supports the fact that cites it. " +
            "Reply with JSON only. " +
            'Return {"verdicts":[{"key":..., "supports": true|false, "reason": "..."}]} covering every item. ' +
            "supports is true only when the quotation on its own licenses the fact."
        },
        { role: "user", content: JSON.stringify(batch.map(({ key, fact, citation }) => ({ key, fact, citation }))) }
      ]
    });
    const parsed = parseJsonText(result.response.choices?.[0]?.message?.content);
    for (const verdict of parsed.value?.verdicts ?? []) {
      if (verdict && typeof verdict.key === "string") verdicts.set(verdict.key, verdict);
    }
  }
  return verdicts;
}

// --- statistics -----------------------------------------------------------

/** Wilson score interval; the normal approximation is wrong at these counts. */
function wilson(numerator, denominator) {
  if (!denominator) return null;
  const z = 1.959963984540054;
  const p = numerator / denominator;
  const denom = 1 + (z * z) / denominator;
  const centre = p + (z * z) / (2 * denominator);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * denominator)) / denominator);
  return {
    low: Number((100 * Math.max(0, (centre - spread) / denom)).toFixed(1)),
    high: Number((100 * Math.min(1, (centre + spread) / denom)).toFixed(1))
  };
}

function proportion(numerator, denominator) {
  if (!denominator) {
    return { value: "UNMEASURED", reason: "no denominator", numerator, denominator: 0 };
  }
  return {
    value: `${((100 * numerator) / denominator).toFixed(1)}%`,
    numerator,
    denominator,
    count: `${numerator}/${denominator}`,
    ci95: wilson(numerator, denominator)
  };
}

/** Exact two-sided McNemar test over paired utterances. */
function mcnemar(leftOnly, rightOnly) {
  const n = leftOnly + rightOnly;
  if (n === 0) return { leftOnly, rightOnly, discordant: 0, p: 1 };
  const choose = (a, b) => {
    let result = 1;
    for (let i = 0; i < b; i += 1) result = (result * (a - i)) / (i + 1);
    return result;
  };
  let tail = 0;
  const k = Math.min(leftOnly, rightOnly);
  for (let i = 0; i <= k; i += 1) tail += choose(n, i) * 0.5 ** n;
  return { leftOnly, rightOnly, discordant: n, p: Number(Math.min(1, 2 * tail).toFixed(4)) };
}

function summarize(condition, rows, efVerdicts, citationVerdicts, finalGraph) {
  const active = rows.filter((row) => !row.excluded_as_filler);
  const admitted = active.flatMap((row) => row.admitted_facts.map((fact) => ({ ...fact, utterance: row.source_utterance })));
  const proposed = active.reduce((sum, row) => sum + row.proposed_fact_count, 0);

  const conforming = admitted.filter((fact) => fact.conforming).length;
  const edges = admitted.filter((fact) => fact.kind === "edge");

  let subjectBad = 0;
  let objectBad = 0;
  let unsupported = 0;
  let judged = 0;
  let usableFaithful = 0;
  for (const fact of admitted) {
    const verdict = efVerdicts.get(sha(`${fact.utterance}|${fact.text}`));
    if (!verdict) continue;
    judged += 1;
    if (verdict.supported !== true) unsupported += 1;
    // The goal is knowledge that is both grounded and typed. A supported fact
    // that conforms to no ontology cannot be queried, merged, or governed, and a
    // schema-perfect fact the utterance does not support is a hallucination.
    if (verdict.supported === true && fact.conforming) usableFaithful += 1;
    if (fact.kind === "edge") {
      if (verdict.subject_supported !== true) subjectBad += 1;
      if (verdict.object_supported !== true) objectBad += 1;
    }
  }
  const judgedEdges = edges.filter((fact) => efVerdicts.has(sha(`${fact.utterance}|${fact.text}`))).length;

  const provenanceEntries = active.flatMap((row) => row.provenance ?? []);
  const grounded = provenanceEntries.filter((entry) => entry.grounded);
  let citationsChecked = 0;
  let citationsGood = 0;
  for (const entry of grounded) {
    const verdict = citationVerdicts.get(sha(`${entry.label}|${entry.vertexId}|${entry.traceText}`));
    if (!verdict) continue;
    citationsChecked += 1;
    if (verdict.supports === true) citationsGood += 1;
  }

  // Redundancy in the graph the condition actually produced: content-identical
  // knowledge vertices that were nevertheless stored under different ids.
  const knowledgeVertices = Object.values(finalGraph.vertices).filter((v) => CONTRACT.knowledgeLabels.has(v.label));
  const distinctContent = new Set(knowledgeVertices.map((v) => contentSignature(v.label, v.properties)));
  const duplicates = knowledgeVertices.length - distinctContent.size;

  const attemptsBeyondFirst = active.reduce((sum, row) => sum + Math.max(0, row.attempts_used - 1), 0);
  const retryCapacity = active.length * (MAX_ATTEMPTS - 1);
  const tokens = active.reduce((sum, row) => sum + row.tokens, 0);
  const latency = active.reduce((sum, row) => sum + row.latency_ms, 0);
  const unparseable = active.filter((row) => row.json_parsed === false).length;

  return {
    condition: condition.id,
    label: condition.label,
    eligibleTurns: active.length,
    proposedFacts: proposed,
    admittedFacts: admitted.length,
    OC: proportion(conforming, admitted.length),
    SH: proportion(subjectBad, judgedEdges),
    RH: proportion(edges.filter((fact) => !fact.relationConforming).length, edges.length),
    OH: proportion(objectBad, judgedEdges),
    EF: proportion(judged - unsupported, judged),
    faithfulFacts: judged - unsupported,
    usableFaithfulFacts: usableFaithful,
    usableFaithfulYield: proportion(usableFaithful, proposed),
    provenanceCoverage: proportion(grounded.length, provenanceEntries.length),
    citationCorrectness: proportion(citationsGood, citationsChecked),
    yield: proportion(admitted.length, proposed),
    duplicateRate: proportion(duplicates, knowledgeVertices.length),
    retryBudgetConsumed: proportion(attemptsBeyondFirst, retryCapacity),
    unparseableRate: proportion(unparseable, active.length),
    temporalContradictions: active.reduce((sum, row) => sum + (row.supersessions?.length ?? 0), 0),
    tokensPerFact: admitted.length ? Math.round(tokens / admitted.length) : null,
    secondsPerFact: admitted.length ? Number((latency / 1000 / admitted.length).toFixed(2)) : null,
    totalTokens: tokens,
    totalLatencyMs: latency,
    judgedFacts: judged,
    evidence: `results/raw/${condition.id}.jsonl`
  };
}

/** Per-utterance outcome used for paired testing: any admitted fact unsupported. */
function utteranceOutcomes(rows, efVerdicts) {
  const outcomes = new Map();
  for (const row of rows) {
    if (row.excluded_as_filler) continue;
    const bad = row.admitted_facts.some((fact) => {
      const verdict = efVerdicts.get(sha(`${row.source_utterance}|${fact.text}`));
      return verdict ? verdict.supported !== true : false;
    });
    outcomes.set(row.utterance_id, bad);
  }
  return outcomes;
}

// --- main -----------------------------------------------------------------

async function main() {
  loadEnv();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is unavailable");
  if (CONTRACT.drift.length > 0) {
    throw new Error(`refusing to run with contract drift:\n${CONTRACT.drift.map((d) => `${d.ruleId}: ${d.message}`).join("\n")}`);
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const turns = loadTurns();
  if (turns.length === 0) throw new Error("no hospitality session found under data/");

  const rowsByCondition = {};
  const graphByCondition = {};
  for (const condition of CONDITIONS) {
    process.stdout.write(`Running ${condition.id} (${condition.label})... `);
    const run = await runCondition(openai, condition, turns);
    rowsByCondition[condition.id] = run.rows;
    graphByCondition[condition.id] = run.graph;
    const active = run.rows.filter((row) => !row.excluded_as_filler);
    process.stdout.write(
      `${active.reduce((s, r) => s + r.admitted_fact_count, 0)}/${active.reduce((s, r) => s + r.proposed_fact_count, 0)} facts admitted\n`
    );
  }

  process.stdout.write("Judging evidential faithfulness...\n");
  const allRows = Object.values(rowsByCondition).flat();
  const efVerdicts = await judgeFacts(openai, allRows);
  process.stdout.write("Judging citation correctness...\n");
  const citationVerdicts = await judgeCitations(openai, allRows);

  const conditions = {};
  for (const condition of CONDITIONS) {
    conditions[condition.id] = summarize(condition, rowsByCondition[condition.id], efVerdicts, citationVerdicts, graphByCondition[condition.id]);
  }

  const outcomes = Object.fromEntries(
    CONDITIONS.map((condition) => [condition.id, utteranceOutcomes(rowsByCondition[condition.id], efVerdicts)])
  );
  const pairs = [["A0", "A1"], ["A1", "A2"], ["A2", "A3"], ["A3", "A4"], ["A4", "A4-strict"], ["A4", "A5"], ["A0", "A5"]];
  const tests = {};
  for (const [left, right] of pairs) {
    let leftOnly = 0;
    let rightOnly = 0;
    for (const [id, leftBad] of outcomes[left]) {
      const rightBad = outcomes[right].get(id);
      if (leftBad && !rightBad) leftOnly += 1;
      if (!leftBad && rightBad) rightOnly += 1;
    }
    tests[`${left} vs ${right}`] = mcnemar(leftOnly, rightOnly);
  }

  const activeTurns = turns.filter((turn) => !turn.filler);
  const output = {
    generatedAt: new Date().toISOString(),
    status: "MEASURED_GATED_ABLATION",
    harness: {
      note: "Conditions call the deployed gate in lib/gate; there is no separate evaluation implementation.",
      statelessExtraction: true,
      statelessExtractionNote:
        "The extraction request depends only on the turn, attempt, and correction text, so attempt-1 proposals are identical across A1-A5 and fact-level pairing is valid.",
      extractorModel: EXTRACTOR_MODEL,
      judgeModel: JUDGE_MODEL,
      temperature: 0,
      seed: SEED,
      maxAttempts: MAX_ATTEMPTS,
      promptHash: PROMPT_HASH
    },
    schema: {
      vertexClasses: CONTRACT.vertexSpecs.size,
      knowledgeClasses: CONTRACT.knowledgeLabels.size,
      infrastructureClasses: CONTRACT.infrastructureLabels.size,
      edgeTypes: CONTRACT.edgeSpecs.size,
      contractDrift: CONTRACT.drift.length
    },
    corpus: {
      sessions: new Set(turns.map((turn) => turn.sessionFile)).size,
      expertTurns: turns.length,
      eligibleTurns: activeTurns.length,
      excludedAsFiller: turns.length - activeTurns.length
    },
    factDefinition:
      "A fact is one non-infrastructure vertex, or one edge whose endpoints are both non-infrastructure vertices. Infrastructure and provenance structure are excluded.",
    conditions,
    pairedTests: tests,
    humanAudit: {
      status: "UNMEASURED",
      reason: "EF and citation correctness are adjudicated by an independent model. Human labels require the blinded sample in results/human_audit_sample.csv to be completed."
    }
  };

  fs.writeFileSync(path.join(RESULTS, "gated_ablation_metrics.json"), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write("\nWrote results/gated_ablation_metrics.json\n");
  for (const condition of CONDITIONS) {
    const summary = conditions[condition.id];
    process.stdout.write(
      `${condition.id.padEnd(10)} yield ${String(summary.yield.count ?? "-").padEnd(8)} ` +
      `EF ${String(summary.EF.value).padEnd(8)} prov ${String(summary.provenanceCoverage.value).padEnd(8)} ` +
      `OC ${summary.OC.value}\n`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
