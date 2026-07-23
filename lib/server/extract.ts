import OpenAI from "openai";
import { graphSummary } from "@/lib/schema";
import { runGate } from "@/lib/gate/gate";
import { schemaReference } from "@/lib/gate/prompt";
import type { ChatRequest, GraphDelta, TurnGateReport } from "@/lib/types";
import { getDomain } from "@/lib/domains";
import { extractGovernedDelta } from "./extract-governed";

const DEFAULT_EXTRACTOR_MODEL = "gpt-4o-mini";

export async function extractGraphDelta(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest
): Promise<{ delta: GraphDelta; warnings: string[]; gate?: TurnGateReport }> {
  if (body.domainId === "hospitality") {
    return extractGovernedDelta(openai, latestText, body);
  }

  let best: { delta: GraphDelta; warnings: string[] } | null = null;
  let feedback = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await callExtractor(openai, latestText, body, feedback);
    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      best ??= {
        delta: { vertices: [], edges: [] },
        warnings: ["Extractor returned no graph delta."]
      };
      feedback = "The previous attempt returned no tool output. Emit the graph delta using the tool.";
      continue;
    }

    const firstCall = toolCalls[0];
    if (!("function" in firstCall)) {
      best ??= {
        delta: { vertices: [], edges: [] },
        warnings: ["Extractor returned unexpected tool call type."]
      };
      feedback = "Emit the graph delta using the emit_graph_delta function tool.";
      continue;
    }
    let rawInput: unknown;
    try {
      rawInput = JSON.parse(firstCall.function.arguments);
    } catch {
      best ??= {
        delta: { vertices: [], edges: [] },
        warnings: ["Extractor returned invalid JSON."]
      };
      feedback = "The previous attempt returned invalid JSON. Emit valid JSON using the emit_graph_delta function.";
      continue;
    }
    // The same gate serves both domains. Without a governance spec a domain gets
    // schema-mode admission only, which is what the medical schema declares.
    const gated = runGate(rawInput, body.graph, body.domainId ?? "medical", { mode: "schema" });
    const rawSanitized = {
      delta: gated.delta,
      warnings: gated.findings.filter((item) => item.action === "dropped").map((item) => `${item.ruleId}: ${item.message}`)
    };
    const sanitized = body.domainId === "medical"
      ? polishMedicalExtraction(rawSanitized, latestText, body)
      : rawSanitized;
    if (!best || scoreDelta(sanitized) > scoreDelta(best)) best = sanitized;
    if (!gated.retryFeedback) {
      return sanitized;
    }
    feedback = `${gated.retryFeedback}\n\nValid schema labels and edge directions:\n${schemaReference(body.domainId ?? "medical")}`;
  }

  const result = best ?? {
    delta: { vertices: [], edges: [] },
    warnings: ["Extractor did not run."]
  };
  return body.domainId === "medical"
    ? polishMedicalExtraction(result, latestText, body)
    : result;
}

function scoreDelta(result: { delta: GraphDelta; warnings: string[] }): number {
  const graphItems = result.delta.vertices.length + result.delta.edges.length;
  return graphItems * 100 - result.warnings.length;
}

function polishMedicalExtraction(
  result: { delta: GraphDelta; warnings: string[] },
  latestText: string,
  body: ChatRequest
): { delta: GraphDelta; warnings: string[] } {
  const cleaned = dropEmptyMedicalVertices(result.delta);
  const support = medicalSupportDelta(latestText, body, cleaned);
  if (support.vertices.length === 0 && support.edges.length === 0) {
    return { delta: cleaned, warnings: result.warnings };
  }

  return {
    delta: mergeDeltaArrays(cleaned, support),
    warnings: []
  };
}

function dropEmptyMedicalVertices(delta: GraphDelta): GraphDelta {
  const emptyIds = new Set(
    delta.vertices
      .filter((vertex) => vertex.label === "PainCharacter" && Object.keys(vertex.properties ?? {}).length === 0)
      .map((vertex) => vertex.id)
  );
  if (emptyIds.size === 0) return delta;
  return {
    vertices: delta.vertices.filter((vertex) => !emptyIds.has(vertex.id)),
    edges: delta.edges.filter((edgeItem) => !emptyIds.has(edgeItem.out) && !emptyIds.has(edgeItem.in))
  };
}

function mergeDeltaArrays(base: GraphDelta, extra: GraphDelta): GraphDelta {
  const vertices = new Map(base.vertices.map((vertex) => [vertex.id, vertex]));
  const edges = new Map(base.edges.map((edgeItem) => [edgeItem.id, edgeItem]));
  for (const vertex of extra.vertices) {
    const existing = vertices.get(vertex.id);
    vertices.set(vertex.id, {
      ...vertex,
      properties: {
        ...(existing?.properties ?? {}),
        ...(vertex.properties ?? {})
      }
    });
  }
  for (const edgeItem of extra.edges) {
    const existing = edges.get(edgeItem.id);
    edges.set(edgeItem.id, {
      ...edgeItem,
      properties: {
        ...(existing?.properties ?? {}),
        ...(edgeItem.properties ?? {})
      }
    });
  }
  return { vertices: [...vertices.values()], edges: [...edges.values()] };
}

function medicalSupportDelta(latestText: string, body: ChatRequest, currentDelta: GraphDelta): GraphDelta {
  const text = latestText.trim();
  if (!text) return { vertices: [], edges: [] };

  const facts = [
    medicalLocationFact(text),
    medicalDurationFact(text),
    medicalFrequencyFact(text, body),
    medicalQualityFact(text)
  ].filter((fact): fact is MedicalFact => Boolean(fact));

  if (facts.length === 0) return { vertices: [], edges: [] };

  const headacheId = findMedicalHeadacheId(body, currentDelta) ?? "Headache:headaches";
  const vertices: GraphDelta["vertices"] = [];
  const edges: GraphDelta["edges"] = [];

  if (!findMedicalHeadacheId(body, currentDelta)) {
    vertices.push({
      id: headacheId,
      label: "Headache",
      properties: { description: "headaches" }
    });
    edges.push(edge("Person:patient", "reports", headacheId));
  }

  for (const fact of facts) {
    vertices.push(fact.vertex);
    edges.push(edge(headacheId, fact.edgeLabel, fact.vertex.id));
  }

  return { vertices, edges };
}

type MedicalFact = {
  vertex: GraphDelta["vertices"][number];
  edgeLabel: string;
};

function findMedicalHeadacheId(body: ChatRequest, delta: GraphDelta): string | null {
  const fromDelta = delta.vertices.find((vertex) => vertex.label === "Headache")?.id;
  if (fromDelta) return fromDelta;
  return Object.values(body.graph.vertices).find((vertex) => vertex.label === "Headache")?.id ?? null;
}

function medicalLocationFact(text: string): MedicalFact | null {
  const lower = text.toLowerCase();
  const locations: Array<[RegExp, string]> = [
    [/\bforehead\b/, "forehead"],
    [/\bbetween (my )?(eye ?brows|brows)\b/, "between eyebrows"],
    [/\btemples?\b/, "temple"],
    [/\bbehind (my )?(eye|eyes)\b/, "behind eye"],
    [/\bback of (my )?head\b|\boccipital\b/, "back of head"],
    [/\bwhole head\b|\ball over (my )?head\b/, "whole head"]
  ];
  const match = locations.find(([pattern]) => pattern.test(lower));
  if (!match) return null;
  const value = match[1];
  return {
    vertex: {
      id: `BodyLocation:${slug(value)}`,
      label: "BodyLocation",
      properties: { value }
    },
    edgeLabel: "locatedAt"
  };
}

function medicalDurationFact(text: string): MedicalFact | null {
  const match = text.match(/\b(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)\b/i);
  if (!match) return null;
  const count = Number(match[1]);
  const unit = normalizeMedicalUnit(match[2]);
  const value = `${count} ${unit}`;
  return {
    vertex: {
      id: `Duration:${slug(value)}`,
      label: "Duration",
      properties: { value, count, unit }
    },
    edgeLabel: "hasDuration"
  };
}

function medicalFrequencyFact(text: string, body: ChatRequest): MedicalFact | null {
  const lower = text.toLowerCase();
  const context = body.messages.slice(-4).map((message) => message.content.toLowerCase()).join(" ");
  const numberWord = "(once|twice|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)";
  const explicit = lower.match(new RegExp(`\\b${numberWord}\\s*(?:times?\\s*)?(?:a|per)\\s*(day|week|month|year)\\b`, "i"));
  const contextual = !explicit && /\btwice\b/.test(lower) && /\b(per week|a week|weekly|times per week)\b/.test(context)
    ? ["twice", "twice", "week"]
    : null;
  const match = explicit ?? contextual;
  if (!match) {
    if (/\bdaily\b|\bevery day\b/.test(lower)) return frequencyFact("daily", 1, "day");
    if (/\bweekly\b|\bevery week\b/.test(lower)) return frequencyFact("weekly", 1, "week");
    if (/\bmonthly\b|\bevery month\b/.test(lower)) return frequencyFact("monthly", 1, "month");
    return null;
  }
  const count = countFromMedicalText(match[1]);
  const per = match[2].toLowerCase();
  if (!count || !per) return null;
  const value = `${count === 2 ? "twice" : count === 1 ? "once" : `${count} times`} a ${per}`;
  return frequencyFact(value, count, per);
}

function frequencyFact(value: string, count: number, per: string): MedicalFact {
  return {
    vertex: {
      id: `Frequency:${slug(value)}`,
      label: "Frequency",
      properties: {
        value,
        count,
        per,
        certainty: "patientReported"
      }
    },
    edgeLabel: "hasFrequency"
  };
}

function medicalQualityFact(text: string): MedicalFact | null {
  const lower = text.toLowerCase();
  const qualities = [
    "needle-like",
    "sharp",
    "throbbing",
    "pounding",
    "pressure",
    "tight band",
    "stabbing",
    "burning",
    "dull",
    "electric"
  ].filter((quality) => lower.includes(quality));
  if (qualities.length === 0) return null;
  const value = qualities.join(", ");
  return {
    vertex: {
      id: `Quality:${slug(value)}`,
      label: "Quality",
      properties: { value }
    },
    edgeLabel: "hasQuality"
  };
}

function normalizeMedicalUnit(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.startsWith("min")) return "minutes";
  if (lower.startsWith("hr") || lower.startsWith("hour")) return "hours";
  if (lower.startsWith("day")) return "days";
  return lower;
}

function countFromMedicalText(raw: string): number {
  const lower = raw.toLowerCase();
  const words: Record<string, number> = {
    once: 1,
    one: 1,
    twice: 2,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };
  return words[lower] ?? Number(lower);
}

function edge(out: string, label: string, incoming: string): GraphDelta["edges"][number] {
  return {
    id: `${out}--${label}-->${incoming}`,
    label,
    out,
    in: incoming,
    properties: {}
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function callExtractor(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest,
  feedback: string
) {
  const domain = getDomain(body.domainId);
  const speakerLabel = domain.userLabel === "expert" ? "expert" : "patient";
  return openai.chat.completions.create({
    model: process.env.CHATGRAPH_EXTRACTOR_MODEL || DEFAULT_EXTRACTOR_MODEL,
    max_completion_tokens: 1200,
    messages: [
      {
        role: "system",
        content: `${domain.extractorIntro}\n\n${schemaReference(domain.id)}`
      },
      {
        role: "user",
        content:
          `Latest ${speakerLabel} utterance:\n${latestText}\n\n` +
          `Conversation window:\n${body.messages
            .slice(-8)
            .map((message) => `${message.role}: ${message.content}`)
            .join("\n")}\n\n` +
          `Current graph:\n${graphSummary(body.graph)}` +
          (feedback ? `\n\nValidation feedback:\n${feedback}` : "")
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "emit_graph_delta",
          description: "Emit the new graph delta captured from the latest patient utterance.",
          parameters: {
            type: "object",
            properties: {
              vertices: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    properties: { type: "object" }
                  },
                  required: ["id", "label"]
                }
              },
              edges: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    out: { type: "string" },
                    in: { type: "string" },
                    properties: { type: "object" }
                  },
                  required: ["label", "out", "in"]
                }
              }
            },
            required: ["vertices", "edges"]
          }
        }
      }
    ],
    tool_choice: { type: "function", function: { name: "emit_graph_delta" } }
  });
}
