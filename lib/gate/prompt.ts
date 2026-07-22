/**
 * Extractor-facing views of the gate contract.
 *
 * The schema reference, the provenance instructions, and the tool parameter
 * schema are all generated from the same contract the gate enforces. Nothing
 * here restates a label, an endpoint, or a vocabulary by hand, so the extractor
 * cannot be told something the gate will then reject — the drift that the
 * ablation's own logs show as the dominant failure mode.
 */

import type { GraphState } from "@/lib/types";
import { gateContract, type GateContract } from "./contract";
import { keyText, SUPERSEDED_BY } from "./gate";

/** Vertex and edge inventory, with required properties marked by `!`. */
export function schemaReference(domainId: string): string {
  const contract = gateContract(domainId);
  const vertexLines = [...contract.vertexSpecs.values()].map((spec) => {
    const props = [...spec.properties]
      .sort()
      .map((prop) => (spec.requiredProperties.has(prop) ? `${prop}!` : prop));
    return props.length ? `${spec.label}: ${props.join(", ")}` : `${spec.label}: no properties`;
  });
  const vertexSet = new Set(contract.vertexSpecs.keys());
  const edgeLines = [...contract.edgeSpecs.values()]
    // Gate-authored edges are omitted: provenance and supersession are attached
    // by the gate, so offering them would invite the extractor to guess.
    .filter((spec) => !gateAuthored(contract, spec.label))
    .filter((spec) => [...spec.out].every((label) => vertexSet.has(label)) && [...spec.in].every((label) => vertexSet.has(label)))
    .map((spec) => `${spec.label}: ${[...spec.out].join(" | ")} -> ${[...spec.in].join(" | ")}`);
  return `VERTICES\n${vertexLines.join("\n")}\n\nEDGES\n${edgeLines.join("\n")}`;
}

/** How to ground each knowledge vertex, derived from the governance spec. */
export function provenanceInstructions(domainId: string): string {
  const contract = gateContract(domainId);
  if (!contract.governed || !contract.evidenceLabel) return "";
  const knowledge = [...contract.knowledgeLabels].sort().join(", ");
  const confidence = [...contract.confidenceValues].join(", ");
  const banned = contract.bannedTracePatterns.map((pattern) => `"${pattern}"`).join(", ");
  return [
    "GROUNDING",
    `These labels carry knowledge and must each carry an "evidence" object: ${knowledge}.`,
    'Set evidence.traceText to the expert\'s own words from the latest utterance — the specific span that licenses this fact, not a summary of the topic and not the whole turn.',
    confidence ? `Set evidence.confidence to one of: ${confidence}. Use "inferred" only for a fact synthesised across turns that no single quote states.` : "",
    banned ? `These traceText values are rejected: ${banned}.` : "",
    "A relationship between two knowledge entities is itself a claim: give each such edge an evidence object too, quoting the span that states the relationship, not just its endpoints.",
    "Do not emit evidence vertices or provenance edges yourself; they are attached for you from the evidence object.",
    "If the utterance does not support a fact, omit the fact rather than grounding it in something the expert did not say."
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tool parameters for the extraction call, including the inline evidence field. */
export function extractionToolSchema(domainId: string): Record<string, unknown> {
  const contract = gateContract(domainId);
  const vertexProperties: Record<string, unknown> = {
    id: { type: "string", description: "lowercase, hyphen-separated, colon-namespaced" },
    label: { type: "string", enum: [...contract.vertexSpecs.keys()] },
    properties: { type: "object", additionalProperties: true }
  };
  if (contract.governed && contract.evidenceLabel) {
    vertexProperties.evidence = evidenceSchema(contract);
  }

  return {
    type: "object",
    properties: {
      vertices: {
        type: "array",
        items: {
          type: "object",
          properties: vertexProperties,
          // `evidence` is required rather than optional: left optional, the model
          // intermittently omits it and authors orphan evidence vertices instead,
          // which the gate then discards as ungrounded.
          required: contract.governed && contract.evidenceLabel
            ? ["id", "label", "properties", "evidence"]
            : ["id", "label", "properties"]
        }
      },
      edges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: {
              type: "string",
              enum: [...contract.edgeSpecs.keys()].filter((label) => !gateAuthored(contract, label))
            },
            out: { type: "string" },
            in: { type: "string" },
            // A relationship claim is grounded exactly like a vertex claim.
            ...(contract.governed && contract.evidenceLabel ? { evidence: evidenceSchema(contract) } : {})
          },
          required: ["label", "out", "in"]
        }
      }
    },
    required: ["vertices", "edges"]
  };
}

/** True for edges only the gate may write. */
export function gateAuthored(contract: GateContract, edgeLabel: string): boolean {
  return contract.provenanceEdgeLabels.has(edgeLabel) || edgeLabel === SUPERSEDED_BY;
}

const SUMMARY_MAX_VERTICES = 80;
const SUMMARY_MAX_EDGES = 60;
const SUMMARY_MAX_TEXT = 60;

/**
 * The graph as the extractor should see it: knowledge only, one short line per
 * entity, framed as ids to reuse.
 *
 * The previous summary rendered every vertex with full properties — including
 * transcript episodes and evidence nodes carrying whole quoted utterances — so by
 * mid-interview it dwarfed the schema reference and the model began imitating
 * the summary's prose instead of the schema's vocabulary. Everything the model
 * does not need to *reference* is omitted; everything included is something it
 * should reuse rather than restate.
 */
export function knownEntitiesSummary(domainId: string, graph: GraphState): string {
  const contract = gateContract(domainId);

  const superseded = new Set<string>();
  for (const edge of Object.values(graph.edges)) {
    if (edge.label === SUPERSEDED_BY) superseded.add(edge.out);
  }

  const referenceable = (label: string) =>
    contract.knowledgeLabels.has(label) ||
    (!contract.governed && Boolean(contract.vertexSpecs.get(label))) ||
    label === "Person" ||
    label === "KnowledgeSession";

  const vertices = Object.values(graph.vertices).filter(
    (vertex) => referenceable(vertex.label) && !superseded.has(vertex.id)
  );
  const shown = vertices.slice(-SUMMARY_MAX_VERTICES);
  const shownIds = new Set(shown.map((vertex) => vertex.id));
  const vertexLines = shown.map((vertex) => {
    const text = keyText(vertex.properties);
    const clipped = text.length > SUMMARY_MAX_TEXT ? `${text.slice(0, SUMMARY_MAX_TEXT - 1)}…` : text;
    return clipped ? `${vertex.id} (${vertex.label}) "${clipped}"` : `${vertex.id} (${vertex.label})`;
  });

  const edgeLines = Object.values(graph.edges)
    .filter(
      (edge) =>
        !gateAuthored(contract, edge.label) &&
        shownIds.has(edge.out) &&
        shownIds.has(edge.in)
    )
    .slice(-SUMMARY_MAX_EDGES)
    .map((edge) => `${edge.out} --${edge.label}--> ${edge.in}`);

  const omittedVertices = vertices.length - shown.length;
  return [
    "KNOWN ENTITIES — reuse these exact ids when the expert refers to the same concept again; never mint a second id for a concept listed here:",
    vertexLines.join("\n") || "(none yet)",
    "",
    "EXISTING RELATIONSHIPS (do not re-emit):",
    edgeLines.join("\n") || "(none yet)",
    omittedVertices > 0 ? `\n(${omittedVertices} older entities omitted)` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function evidenceSchema(contract: GateContract): Record<string, unknown> {
  const confidence = [...contract.confidenceValues];
  return {
    type: "object",
    description: "Required on every knowledge vertex. The expert's own words supporting this fact.",
    properties: {
      traceText: { type: "string", description: "Verbatim span from the latest utterance" },
      ...(confidence.length > 0 ? { confidence: { type: "string", enum: confidence } } : {})
    },
    required: ["traceText"]
  };
}
