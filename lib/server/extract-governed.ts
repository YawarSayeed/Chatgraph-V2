/**
 * Governed extraction: LLM proposes, the symbolic gate disposes.
 *
 * Replaces the deterministic keyword extractor that previously served the
 * hospitality domain. Per turn:
 *
 *   1. a deterministic episode scaffold is built (no model involved), so every
 *      admitted fact has a transcript episode to point at;
 *   2. the extractor is called with a contract-generated prompt and tool schema;
 *   3. the gate admits per fact, materializing evidence from the inline field;
 *   4. hard rejections are echoed back as typed errors for a bounded retry.
 *
 * Soft findings surface as warnings and never block: a live interview cannot be
 * stalled by a governance rule, and the authored spec marks the provenance rules
 * soft precisely for that reason.
 */

import OpenAI from "openai";
import { gateContract } from "@/lib/gate/contract";
import { runGate, type GateFinding } from "@/lib/gate/gate";
import { extractionToolSchema, knownEntitiesSummary, provenanceInstructions, schemaReference } from "@/lib/gate/prompt";
import { getDomain } from "@/lib/domains";
import { isFillerTurn } from "@/lib/filler";
import type { ChatRequest, GateAttemptReport, GraphDelta, GraphState, TurnGateReport } from "@/lib/types";

const DEFAULT_EXTRACTOR_MODEL = "gpt-4o-mini";
const MAX_ATTEMPTS = 3;

export async function extractGovernedDelta(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest
): Promise<{ delta: GraphDelta; warnings: string[]; gate: TurnGateReport }> {
  const domainId = body.domainId ?? "hospitality";
  reportDriftOnce(domainId);

  // A filler turn ("Continue", "Move on", a bare acknowledgment) carries no
  // knowledge. Running the extractor on it costs tokens and, worse, invites
  // re-emission of prior facts: the first live session's identity mutations all
  // happened on filler turns. Skip extraction entirely; not even an episode is
  // recorded, since a navigation utterance is not evidence of anything.
  if (isFillerTurn(latestText)) {
    return {
      delta: { vertices: [], edges: [] },
      warnings: [],
      gate: { attempts: [], chosenAttempt: 0, skippedAsFiller: true }
    };
  }

  const previousQuestion = [...body.messages].reverse().find(
    (message) => message.role === "assistant"
  )?.content ?? "";
  const latestUser = [...body.messages].reverse().find(
    (message) => message.role === "user" && message.content === latestText
  );
  const scaffold = episodeScaffold(domainId, body.graph, latestText, previousQuestion, latestUser?.id);

  let best: { delta: GraphDelta; warnings: string[]; score: number; attempt: number } | null = null;
  let feedback = "";
  const attempts: GateAttemptReport[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let raw: unknown;
    try {
      raw = await callExtractor(openai, latestText, body, domainId, feedback);
    } catch {
      break;
    }
    if (raw === null) {
      feedback = "The previous attempt produced no tool call. Emit the delta using the emit_graph_delta function.";
      attempts.push({
        attempt, proposedVertices: 0, proposedEdges: 0, admittedVertices: 0, admittedEdges: 0,
        score: 0, findings: [], retryFeedback: feedback
      });
      continue;
    }

    const merged = withScaffold(raw, scaffold);
    const result = runGate(merged, body.graph, domainId, {
      evidenceContext: { sourceEpisode: scaffold.episodeId, speaker: "expert", utterance: latestText },
      // The deployed configuration is the full gate.
      deterministicIds: true,
      temporalContradictions: true,
      resolveEntities: true
    });

    // An admitted-but-unprovenanced fact is worth less than a grounded one: the
    // score subtracts heavily for each soft evidence gap, so a smaller fully
    // grounded attempt beats a larger flagged one.
    const evidenceGaps = result.findings.filter(
      (finding) => finding.severity === "soft" && finding.ruleId === "HR006"
    ).length;
    const candidate = {
      delta: result.delta,
      warnings: warningsFrom(result.findings),
      score: result.delta.vertices.length + result.delta.edges.length - 10 * evidenceGaps,
      attempt
    };
    if (!best || candidate.score > best.score) best = candidate;

    const proposed = merged as { vertices: unknown[]; edges: unknown[] };
    const report: GateAttemptReport = {
      attempt,
      // Proposal counts exclude the deterministic scaffold: they measure the model.
      proposedVertices: proposed.vertices.length - scaffold.vertices.length,
      proposedEdges: proposed.edges.length - scaffold.edges.length,
      admittedVertices: result.delta.vertices.length,
      admittedEdges: result.delta.edges.length,
      score: candidate.score,
      findings: result.findings
    };
    attempts.push(report);

    if (result.retryFeedback) {
      feedback = `${result.retryFeedback}\n\nSchema:\n${schemaReference(domainId)}`;
      report.retryFeedback = result.retryFeedback;
      continue;
    }
    // Soft findings never block admission, but they are still worth one retry:
    // the flagged run is kept as `best`, so a failed retry costs nothing.
    if (evidenceGaps > 0 && attempt < MAX_ATTEMPTS) {
      feedback =
        `${evidenceGaps} admitted item(s) lacked an evidence object. Re-emit the same delta, ` +
        `attaching evidence.traceText (the expert's exact words from the latest utterance) ` +
        `to every knowledge vertex and every knowledge-to-knowledge edge.`;
      report.retryFeedback = feedback;
      continue;
    }
    break;
  }

  if (!best) {
    return {
      delta: { vertices: [], edges: [] },
      warnings: ["Graph extraction failed for this turn."],
      gate: { attempts, chosenAttempt: 0 }
    };
  }
  return {
    delta: best.delta,
    warnings: best.warnings,
    gate: { attempts, chosenAttempt: best.attempt }
  };
}

const driftReported = new Set<string>();

/**
 * Schema/spec disagreement is an operator concern, not something to put in front
 * of the interviewee, so it is logged once per process rather than warned per turn.
 */
function reportDriftOnce(domainId: string): void {
  if (driftReported.has(domainId)) return;
  driftReported.add(domainId);
  for (const item of gateContract(domainId).drift) {
    console.warn(`[chatgraph] contract drift (${domainId}) ${item.ruleId}: ${item.message}`);
  }
}

/** Only soft and advisory findings reach the user; hard ones were already retried. */
function warningsFrom(findings: GateFinding[]): string[] {
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const finding of findings) {
    if (finding.severity !== "soft") continue;
    const message = `${finding.ruleId}: ${finding.message}`;
    if (seen.has(message)) continue;
    seen.add(message);
    warnings.push(message);
  }
  return warnings;
}

type Scaffold = {
  episodeId: string;
  vertices: GraphDelta["vertices"];
  edges: GraphDelta["edges"];
};

/**
 * The session/section/episode chain is structural, not knowledge, so it is built
 * deterministically rather than asked of the model. The section is classified
 * from the interviewer's question by keyword match against the domain's declared
 * interview structure; a question that matches nothing stays in the furthest
 * section the interview has already reached (interviews move forward). The
 * attachment is therefore reproducible from the transcript alone.
 */
function episodeScaffold(
  domainId: string,
  graph: GraphState,
  latestText: string,
  previousQuestion: string,
  messageId?: string
): Scaffold {
  const sessionId = Object.values(graph.vertices).find((vertex) => vertex.label === "KnowledgeSession")?.id
    ?? "session:hospitality:default";
  const section = classifySection(domainId, graph, previousQuestion);
  const sectionId = `section:${sessionId}:${section.order}`;
  // The episode id derives from the message id, not from a count: two voice
  // turns extracted concurrently once counted the same graph snapshot and minted
  // the same episode id, overwriting one turn's episode with the other's.
  const sequence = messageId
    ? `m${messageId.replace(/-/g, "").slice(0, 10)}`
    : String(Object.values(graph.vertices).filter((vertex) => vertex.label === "TranscriptEpisode").length + 1).padStart(3, "0");
  const episodeId = `ep:${sessionId}:${sequence}`;

  return {
    episodeId,
    vertices: [
      {
        id: sectionId,
        label: "SessionSection",
        properties: { sectionType: section.key, title: section.title, order: section.order }
      },
      {
        id: episodeId,
        label: "TranscriptEpisode",
        properties: { verbatimText: latestText, speaker: "expert" }
      }
    ],
    edges: [
      { id: `${sessionId}--hasSection-->${sectionId}`, label: "hasSection", out: sessionId, in: sectionId, properties: {} },
      { id: `${sectionId}--hasEpisode-->${episodeId}`, label: "hasEpisode", out: sectionId, in: episodeId, properties: {} }
    ]
  };
}

function classifySection(
  domainId: string,
  graph: GraphState,
  previousQuestion: string
): { key: string; title: string; order: number } {
  const sections = getDomain(domainId).interviewSections;
  if (!sections || sections.length === 0) return { key: "session", title: "Session", order: 1 };

  const question = previousQuestion.toLowerCase();
  let best: { section: (typeof sections)[number]; hits: number } | null = null;
  for (const section of sections) {
    const hits = section.keywords.filter((keyword) => question.includes(keyword)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { section, hits };
  }

  // Interviews move forward: an unmatched question stays in the furthest
  // section already reached rather than snapping back to the introduction.
  const reached = Math.max(
    1,
    ...Object.values(graph.vertices)
      .filter((vertex) => vertex.label === "SessionSection")
      .map((vertex) => (typeof vertex.properties.order === "number" ? vertex.properties.order : 1))
  );
  const chosen = best && best.section.order >= reached
    ? best.section
    : sections.find((section) => section.order === reached) ?? sections[0];
  return { key: chosen.key, title: chosen.title, order: chosen.order };
}

function withScaffold(raw: unknown, scaffold: Scaffold): unknown {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const vertices = Array.isArray(record.vertices) ? record.vertices : [];
  const edges = Array.isArray(record.edges) ? record.edges : [];
  return {
    vertices: [...scaffold.vertices, ...vertices],
    edges: [...scaffold.edges, ...edges]
  };
}

async function callExtractor(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest,
  domainId: string,
  feedback: string
): Promise<unknown> {
  const domain = getDomain(domainId);
  const system = [
    domain.extractorIntro,
    provenanceInstructions(domainId),
    schemaReference(domainId)
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: process.env.CHATGRAPH_EXTRACTOR_MODEL || DEFAULT_EXTRACTOR_MODEL,
    max_completion_tokens: 1600,
    // A governed pipeline should make the same admission decision twice.
    temperature: 0,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Latest expert utterance (the only evidence for new facts):\n${latestText}\n\n` +
          `Conversation window:\n${body.messages
            .slice(-8)
            .map((message) => `${message.role}: ${message.content}`)
            .join("\n")}\n\n` +
          `${knownEntitiesSummary(domainId, body.graph)}` +
          (feedback ? `\n\nCORRECTION REQUIRED:\n${feedback}` : "")
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "emit_graph_delta",
          description: "Emit the knowledge the latest expert utterance adds, with evidence attached to every knowledge vertex.",
          parameters: extractionToolSchema(domainId)
        }
      }
    ],
    tool_choice: { type: "function", function: { name: "emit_graph_delta" } }
  });

  const call = response.choices[0]?.message?.tool_calls?.[0];
  if (!call || !("function" in call)) return null;
  try {
    return JSON.parse(call.function.arguments);
  } catch {
    return null;
  }
}
