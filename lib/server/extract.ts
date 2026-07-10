import OpenAI from "openai";
import { graphSummary, sanitizeDelta, schemaReference } from "@/lib/schema";
import type { ChatRequest, GraphDelta } from "@/lib/types";
import { getDomain } from "@/lib/domains";

const DEFAULT_EXTRACTOR_MODEL = "gpt-4o-mini";

export async function extractGraphDelta(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest
): Promise<{ delta: GraphDelta; warnings: string[] }> {
  if (body.domainId === "hospitality") {
    return { delta: hospitalityFallbackDelta(latestText, body), warnings: [] };
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
    const rawSanitized = sanitizeDelta(rawInput, body.graph, body.domainId);
    const sanitized = body.domainId === "medical"
      ? polishMedicalExtraction(rawSanitized, latestText, body)
      : rawSanitized;
    if (!best || scoreDelta(sanitized) > scoreDelta(best)) best = sanitized;
    if (sanitized.warnings.length === 0) {
      return sanitized;
    }
    feedback =
      `The previous graph delta failed validation and was sanitized with these problems:\n` +
      sanitized.warnings.join("\n") +
      "\n\nRe-emit the entire corrected delta. Valid schema labels and edge directions:\n" +
      schemaReference(body.domainId);
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

function hospitalityFallbackDelta(latestText: string, body: ChatRequest): GraphDelta {
  const text = latestText.trim();
  if (text.length < 8) return { vertices: [], edges: [] };
  if (isNonKnowledgeHospitalityUtterance(text)) return { vertices: [], edges: [] };

  const sequence = String(
    Object.values(body.graph.vertices).filter((vertex) => vertex.label === "TranscriptEpisode").length + 1
  ).padStart(3, "0");
  const sectionId = "section:session:hospitality:default:1";
  const episodeId = `ep:session:hospitality:default:${sequence}`;
  const provenanceId = `prov:${episodeId}:01`;
  const conceptName = conceptNameForHospitality(text);
  const conceptSlug = slug(conceptName).slice(0, 48) || `turn-${sequence}`;
  const principleId = `principle:${conceptSlug}`;
  const personaId = "persona:hotel-guests";
  const businessId = existingHospitalityBusinessId(body) ?? "business:hotel-chain";

  const sessionPatch = sessionUpdateForHospitality(text);

  const vertices: GraphDelta["vertices"] = [
    ...(sessionPatch ? [sessionPatch] : []),
    {
      id: sectionId,
      label: "SessionSection",
      properties: {
        sectionType: "introduction",
        title: "Introduction",
        order: 1,
        purpose: "Capture expert background and initial hospitality knowledge"
      }
    },
    {
      id: episodeId,
      label: "TranscriptEpisode",
      properties: {
        verbatimText: text,
        speaker: "expert"
      }
    },
    {
      id: provenanceId,
      label: "ProvenanceEvidence",
      properties: {
        traceText: text,
        sourceEpisode: episodeId,
        speaker: "expert",
        confidence: "medium"
      }
    }
  ];

  const edges: GraphDelta["edges"] = [
    edge("session:hospitality:default", "hasSection", sectionId),
    edge(sectionId, "hasEpisode", episodeId)
  ];

  if (isProfileOnlyHospitalityUtterance(text)) {
    const roleTitle = expertRoleFromText(text);
    const tenure = operatingTenureFromText(text);
    const business = hospitalityBusinessFromText(text);
    if (roleTitle) {
      vertices.push({
        id: `role:${slug(roleTitle)}`,
        label: "ExpertRole",
        properties: {
          title: roleTitle,
          description: `${roleTitle} role in the hospitality business`
        }
      });
      edges.push(edge("person:expert", "hasRole", `role:${slug(roleTitle)}`));
    }
    if (business) {
      vertices.push({
        id: businessId,
        label: "HospitalityBusiness",
        properties: business
      });
      edges.push(edge("person:expert", "operatesBusiness", businessId));
    }
    if (business && tenure) {
      vertices.push({
        id: `tenure:${slug(tenure)}`,
        label: "OperatingTenure",
        properties: {
          duration: tenure,
          description: `Business has been operated for ${tenure}`
        }
      });
      edges.push(edge(businessId, "hasOperatingTenure", `tenure:${slug(tenure)}`));
    }
    return { vertices, edges };
  }

  vertices.push(
    ...(!body.graph.vertices[businessId]
      ? [
          {
            id: businessId,
            label: "HospitalityBusiness",
            properties: {
              name: "Hospitality business",
              businessType: "hospitality"
            }
          }
        ]
      : []),
    {
      id: principleId,
      label: "GuestExperiencePrinciple",
      properties: {
        name: conceptName,
        description: text,
        type: "operational"
      }
    },
    {
      id: personaId,
      label: "GuestPersona",
      properties: {
        name: "Hotel guests",
        description: "Guests served by the hospitality business"
      }
    }
  );

  edges.push(
    edge(episodeId, "discusses", principleId),
    edge(businessId, "businessDifferentiatedBy", principleId),
    edge(principleId, "experienceDesignedFor", personaId),
    edge(principleId, "principleSupportedBy", provenanceId)
  );

  if (/\b(if|when|whenever|decide|rule|usually|always|never)\b/i.test(text)) {
    const ruleId = `rule:${conceptSlug}`;
    vertices.push({
      id: ruleId,
      label: "DecisionRule",
      properties: {
        ruleText: text,
        ifCondition: text
      }
    });
    edges.push(edge(episodeId, "discussesRule", ruleId));
    edges.push(edge(ruleId, "supportedBy", provenanceId));
    edges.push(edge(ruleId, "leadsTo", outcomeVertex(vertices, "consistent-guest-experience")));
  }

  if (/\b(towel|welcome|drink|sit|relax|standard|staff|guest|check-?in|arrival|service)\b/i.test(text)) {
    const standardId = `standard:${conceptSlug}`;
    vertices.push({
      id: standardId,
      label: "ServiceStandard",
      properties: {
        name: serviceStandardName(text),
        standardText: text
      }
    });
    edges.push(edge(standardId, "standardEnforces", principleId));
    edges.push(edge(standardId, "standardDeliveredTo", personaId));
    edges.push(edge(standardId, "supportedBy", provenanceId));
  }

  return { vertices, edges };
}

function existingHospitalityBusinessId(body: ChatRequest): string | null {
  return Object.values(body.graph.vertices).find((vertex) => vertex.label === "HospitalityBusiness")?.id ?? null;
}

function expertRoleFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/\bceo\b/.test(lower)) return "CEO";
  const roleMatch = lower.match(/\b(owner|operator|manager|founder|director)\b/);
  return roleMatch ? roleMatch[1][0].toUpperCase() + roleMatch[1].slice(1) : "";
}

function hospitalityBusinessFromText(text: string): { name: string; businessType: string; scale?: string; description: string } | null {
  const lower = text.toLowerCase();
  if (!/\b(hotel|hotels|resort|restaurant|chain|hospitality business)\b/.test(lower)) return null;
  const isHotel = /\bhotel|hotels\b/.test(lower);
  const isChain = /\b(chain|multiple|large|line)\b/.test(lower);
  return {
    name: isChain && isHotel ? "Hotel chain" : isHotel ? "Hotel business" : "Hospitality business",
    businessType: isHotel ? "hotel" : lower.includes("restaurant") ? "restaurant" : "hospitality",
    ...(isChain ? { scale: "chain" } : {}),
    description: text
  };
}

function operatingTenureFromText(text: string): string {
  const match = text.match(/\b(\d+)\s+(year|years|yr|yrs)\b/i);
  return match ? `${match[1]} years` : "";
}

function outcomeVertex(vertices: GraphDelta["vertices"], slugPart: string): string {
  const id = `outcome:${slugPart}`;
  vertices.push({
    id,
    label: "Outcome",
    properties: {
      outcomeType: "guest-experience",
      description: "Consistent, positive guest experience",
      loyaltyAchieved: false
    }
  });
  return id;
}

function isProfileOnlyHospitalityUtterance(text: string): boolean {
  const lower = text.toLowerCase();
  const hasRoleOrTenure = /\b(ceo|owner|manager|operator|role|run|running|operate|operating|years?)\b/.test(lower);
  const hasHospitalityType = /\b(hotel|hotels|resort|restaurant|chain|business)\b/.test(lower);
  const hasServiceKnowledge = /\b(guest|customer service|service standard|guest experience|staff|check-?in|welcome|towel|policy|rule|when|if|recover|loyalty|successful|success)\b/.test(lower);
  return hasHospitalityType && (hasRoleOrTenure || !hasServiceKnowledge);
}

function isNonKnowledgeHospitalityUtterance(text: string): boolean {
  const lower = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!lower) return true;
  if (isFillerText(lower)) return true;
  if (lower.length < 18 && /^(yes|yeah|yep|ok|okay|sure|fine|cool|go ahead|continue|let'?s go)[.! ]*$/.test(lower)) return true;
  return false;
}

function isFillerText(text: string): boolean {
  return /^(okay|ok|sure|yes|yeah|yep|great|thanks?|thank you|cool|fine)(\b|[.!,'-])/.test(text) ||
    /^let'?s\s+(go|continue|start)/.test(text);
}

function sessionUpdateForHospitality(text: string): GraphDelta["vertices"][number] | null {
  const lower = text.toLowerCase();
  const properties: Record<string, string> = {};
  const roleMatch = lower.match(/\b(owner|operator|manager)\b/);
  if (/\bceo\b/.test(lower)) properties.expertRole = "CEO";
  else if (roleMatch) properties.expertRole = roleMatch[1];
  if (Object.keys(properties).length === 0) return null;
  return {
    id: "session:hospitality:default",
    label: "KnowledgeSession",
    properties
  };
}

function conceptNameForHospitality(text: string): string {
  const lower = text.toLowerCase();
  if (/\bhot towels?\b/.test(lower)) return "Hot towel welcome ritual";
  if (/\bcheck-?in\b/.test(lower) && /\b(relax|sit|seated|welcome)\b/.test(lower)) return "Relaxed check-in experience";
  if (/\bcustomer experience\b/.test(lower)) return "Customer experience excellence";
  if (/\bcustomer service\b/.test(lower)) return "Customer service excellence";
  if (/\bguest(s)?\b/.test(lower) && /\b(success|successful|love|experience|care|happy|satisfaction)\b/.test(lower)) {
    return "Guest-centered experience";
  }
  if (/\bguest(s)?\b/.test(lower)) return "Guest-centered service";
  if (/\bservice\b/.test(lower)) return "Service quality practice";
  return shortConceptTitle(text);
}

function serviceStandardName(text: string): string {
  const lower = text.toLowerCase();
  if (/\bhot towels?\b/.test(lower)) return "Offer hot towels on arrival";
  if (/\bcheck-?in\b/.test(lower) && /\b(relax|sit|seated)\b/.test(lower)) return "Seat guests during check-in";
  if (/\bwelcome\b/.test(lower)) return "Warm arrival welcome";
  if (/\bcustomer service\b/.test(lower)) return "Customer service standard";
  return shortConceptTitle(text);
}

function shortConceptTitle(text: string): string {
  const cleaned = text
    .replace(/\b(i think|i feel|what makes it|especially successful|kind of stuff|that we do|with our)\b/gi, " ")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean);
  const title = words.slice(0, 5).join(" ");
  return title ? title[0].toUpperCase() + title.slice(1) : "Hospitality practice";
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
