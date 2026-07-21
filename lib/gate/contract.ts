/**
 * The gate contract: one derived description of what may enter the graph.
 *
 * Everything structural (labels, edge endpoints, required properties) is derived
 * from the domain schema JSON. Everything governance-related (which labels carry
 * knowledge, which provenance edge each label uses, severities, vocabularies,
 * thresholds) is read from the authored specification files rather than restated
 * here. A rule this module cannot bind to the schema is reported as drift and
 * disabled — never silently reinterpreted.
 *
 * This is the artifact the paper's Lesson 1 asks for: the extractor prompt, the
 * gate, and the schema all read from it, so they cannot disagree.
 */

import { getDomain, type DomainSchema } from "@/lib/domains";
import hospitalityRulesRaw from "@/hopitality files/validation rules.json";
import hospitalityProvenanceRaw from "@/hopitality files/provenance spec.json";

export type Severity = "hard" | "soft" | "advisory";

export type VertexSpec = {
  label: string;
  properties: Set<string>;
  requiredProperties: Set<string>;
};

export type EdgeSpec = {
  label: string;
  /** One relation may accept several source or target labels. */
  out: Set<string>;
  in: Set<string>;
};

function endpointSet(value: string | string[] | undefined): Set<string> {
  if (Array.isArray(value)) return new Set(value);
  return new Set(value ? [value] : []);
}

/** A rule the spec declares but the contract could not bind to the schema. */
export type DriftFinding = {
  ruleId: string;
  message: string;
};

/** A "<Label>.<property> must be specific" rule, e.g. HR014 / HR015. */
export type TextQualityRule = {
  ruleId: string;
  severity: Severity;
  label: string;
  property: string;
  bannedPatterns: string[];
};

export type GateContract = {
  domainId: string;
  vertexSpecs: Map<string, VertexSpec>;
  edgeSpecs: Map<string, EdgeSpec>;
  /** Empty when the domain has no authored governance spec. */
  governed: boolean;
  knowledgeLabels: Set<string>;
  /** Labels that carry no knowledge and therefore need no evidence. */
  infrastructureLabels: Set<string>;
  evidenceLabel: string | null;
  provenanceEdgeByLabel: Map<string, string>;
  provenanceEdgeLabels: Set<string>;
  speakerValues: Set<string>;
  confidenceValues: Set<string>;
  bannedTracePatterns: string[];
  textQualityRules: TextQualityRule[];
  singletonLabels: Set<string>;
  severities: Map<string, Severity>;
  drift: DriftFinding[];
};

type RawRule = {
  rule_id?: unknown;
  severity?: unknown;
  description?: unknown;
  banned_patterns?: unknown;
  allowed_values?: unknown;
  singleton_labels?: unknown;
  knowledge_vertex_labels?: unknown;
  provenance_edge_by_label?: unknown;
  target_property?: unknown;
};

const contractCache = new Map<string, GateContract>();

export function gateContract(domainId: string): GateContract {
  const cached = contractCache.get(domainId);
  if (cached) return cached;
  const built = buildContract(domainId);
  contractCache.set(domainId, built);
  return built;
}

function buildContract(domainId: string): GateContract {
  const domain = getDomain(domainId);
  const schema = domain.schema as DomainSchema;
  const drift: DriftFinding[] = [];

  const vertexSpecs = new Map<string, VertexSpec>(
    schema.vertices.map((entry) => [
      entry["@key"],
      {
        label: entry["@key"],
        properties: new Set((entry["@value"].properties ?? []).map((prop) => prop.key)),
        requiredProperties: new Set(
          (entry["@value"].properties ?? []).filter((prop) => prop.required).map((prop) => prop.key)
        )
      }
    ])
  );

  const edgeSpecs = new Map<string, EdgeSpec>(
    schema.edges.map((entry) => [
      entry["@key"],
      {
        label: entry["@key"],
        out: endpointSet(entry["@value"].out ?? entry["@value"].outV),
        in: endpointSet(entry["@value"].in ?? entry["@value"].inV)
      }
    ])
  );

  const governance = governanceFor(domain.id);
  if (!governance) {
    return {
      domainId: domain.id,
      vertexSpecs,
      edgeSpecs,
      governed: false,
      knowledgeLabels: new Set(),
      infrastructureLabels: new Set(),
      evidenceLabel: null,
      provenanceEdgeByLabel: new Map(),
      provenanceEdgeLabels: new Set(),
      speakerValues: new Set(),
      confidenceValues: new Set(),
      bannedTracePatterns: [],
      textQualityRules: [],
      singletonLabels: new Set(),
      severities: new Map(),
      drift
    };
  }

  const rules = Array.isArray(governance.rules.rules) ? (governance.rules.rules as RawRule[]) : [];
  const byId = new Map<string, RawRule>();
  for (const rule of rules) {
    if (typeof rule.rule_id === "string") byId.set(rule.rule_id, rule);
  }

  const severities = new Map<string, Severity>();
  for (const [id, rule] of byId) {
    if (isSeverity(rule.severity)) severities.set(id, rule.severity);
  }

  // HR006 declares which labels carry knowledge and therefore require evidence.
  const knowledgeLabels = new Set(stringArray(byId.get("HR006")?.knowledge_vertex_labels));
  for (const label of knowledgeLabels) {
    if (!vertexSpecs.has(label)) {
      drift.push({ ruleId: "HR006", message: `knowledge label ${label} is not declared in the schema` });
    }
  }

  // HR007 and the provenance spec both map label -> provenance edge. They must agree.
  const fromRule = stringRecord(byId.get("HR007")?.provenance_edge_by_label);
  const fromSpec = stringRecord(
    isRecord(governance.provenance.attachment_rules)
      ? governance.provenance.attachment_rules.edge_label_by_vertex
      : undefined
  );
  const provenanceEdgeByLabel = new Map<string, string>();
  for (const [label, edgeLabel] of Object.entries({ ...fromSpec, ...fromRule })) {
    const specValue = fromSpec[label];
    const ruleValue = fromRule[label];
    if (specValue && ruleValue && specValue !== ruleValue) {
      drift.push({
        ruleId: "HR007",
        message: `provenance edge for ${label} disagrees: validation rules say ${ruleValue}, provenance spec says ${specValue}`
      });
      continue;
    }
    if (!edgeSpecs.has(edgeLabel)) {
      drift.push({ ruleId: "HR007", message: `provenance edge ${edgeLabel} is not declared in the schema` });
      continue;
    }
    provenanceEdgeByLabel.set(label, edgeLabel);
  }
  for (const label of knowledgeLabels) {
    if (!provenanceEdgeByLabel.has(label)) {
      drift.push({ ruleId: "HR007", message: `knowledge label ${label} has no provenance edge mapping` });
    }
  }

  const infrastructureLabels = new Set(
    stringArray(
      isRecord(governance.provenance.attachment_rules)
        ? governance.provenance.attachment_rules.exempt_vertex_labels
        : undefined
    )
  );
  for (const label of infrastructureLabels) {
    if (!vertexSpecs.has(label)) {
      drift.push({ ruleId: "HR006", message: `exempt label ${label} is not declared in the schema` });
    }
  }

  const provenanceEdgeLabels = new Set(provenanceEdgeByLabel.values());

  // The schema is authoritative for endpoints. The spec's label -> edge mapping is
  // checked against it, so a mapping the schema does not permit is drift rather
  // than a silent override.
  for (const [label, edgeLabel] of provenanceEdgeByLabel) {
    const declared = edgeSpecs.get(edgeLabel)?.out;
    if (declared && !declared.has(label)) {
      drift.push({
        ruleId: "HR007",
        message: `the spec attaches ${label} via ${edgeLabel}, but the schema does not permit ${label} as a source of ${edgeLabel}`
      });
    }
  }

  const evidenceLabel = [...provenanceEdgeLabels]
    .flatMap((edgeLabel) => [...(edgeSpecs.get(edgeLabel)?.in ?? [])])
    .find((label): label is string => Boolean(label)) ?? null;
  if (evidenceLabel && !vertexSpecs.has(evidenceLabel)) {
    drift.push({ ruleId: "HR007", message: `evidence label ${evidenceLabel} is not declared in the schema` });
  }

  const textQualityRules: TextQualityRule[] = [];
  for (const ruleId of ["HR014", "HR015"]) {
    const rule = byId.get(ruleId);
    if (!rule) continue;
    const target = targetProperty(rule);
    if (!target) {
      drift.push({ ruleId, message: "rule does not name a <Label>.<property> target" });
      continue;
    }
    const spec = vertexSpecs.get(target.label);
    if (!spec) {
      drift.push({ ruleId, message: `target label ${target.label} is not declared in the schema` });
      continue;
    }
    if (!spec.properties.has(target.property)) {
      // HR015 hits this: it requires OperatingHeuristic.heuristicText, which the
      // schema does not declare. Disabled rather than silently retargeted.
      drift.push({
        ruleId,
        message: `${target.label}.${target.property} is not declared in the schema (declared: ${[...spec.properties].join(", ")})`
      });
      continue;
    }
    textQualityRules.push({
      ruleId,
      severity: severities.get(ruleId) ?? "soft",
      label: target.label,
      property: target.property,
      bannedPatterns: stringArray(rule.banned_patterns).map((pattern) => pattern.toLowerCase())
    });
  }

  const singletonLabels = new Set(stringArray(byId.get("HR009")?.singleton_labels));
  for (const label of singletonLabels) {
    if (!vertexSpecs.has(label)) {
      drift.push({ ruleId: "HR009", message: `singleton label ${label} is not declared in the schema` });
    }
  }

  return {
    domainId: domain.id,
    vertexSpecs,
    edgeSpecs,
    governed: true,
    knowledgeLabels,
    infrastructureLabels,
    evidenceLabel,
    provenanceEdgeByLabel,
    provenanceEdgeLabels,
    speakerValues: new Set(stringArray(byId.get("HR010")?.allowed_values)),
    confidenceValues: new Set(stringArray(byId.get("HR011")?.allowed_values)),
    bannedTracePatterns: stringArray(byId.get("HR012")?.banned_patterns).map((pattern) => pattern.toLowerCase()),
    textQualityRules,
    singletonLabels,
    severities,
    drift
  };
}

function governanceFor(domainId: string): { rules: Record<string, unknown>; provenance: Record<string, unknown> } | null {
  if (domainId !== "hospitality") return null;
  return {
    rules: hospitalityRulesRaw as unknown as Record<string, unknown>,
    provenance: hospitalityProvenanceRaw as unknown as Record<string, unknown>
  };
}

/**
 * Rules declare their target as `target_property: "<Label>.<property>"`. The
 * prose description is used only as a fallback for rules written before that
 * field existed, and a rule naming neither is reported as drift.
 */
function targetProperty(rule: RawRule): { label: string; property: string } | null {
  const explicit = typeof rule.target_property === "string" ? rule.target_property : null;
  const source = explicit ?? (typeof rule.description === "string" ? rule.description : null);
  if (!source) return null;
  const match = source.match(/\b([A-Z][A-Za-z]+)\.([a-zA-Z][a-zA-Z0-9]*)\b/);
  return match ? { label: match[1], property: match[2] } : null;
}

export function severityOf(contract: GateContract, ruleId: string, fallback: Severity): Severity {
  return contract.severities.get(ruleId) ?? fallback;
}

function isSeverity(value: unknown): value is Severity {
  return value === "hard" || value === "soft" || value === "advisory";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
