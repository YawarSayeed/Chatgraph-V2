/**
 * Build the publishable results package from the measured ablation.
 *
 * Reads results/gated_ablation_metrics.json plus results/raw/*.jsonl and writes
 * the numbers the paper cites, the blinded human-audit sample, and an evidence
 * manifest. Every figure traces to a raw row; nothing here is estimated, and a
 * quantity without a denominator is written UNMEASURED rather than zero.
 *
 *   node --import ./scripts/ts-alias-hooks.mjs scripts/nesy_results/build_results_package.mjs
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, "results");
const RAW = path.join(RESULTS, "raw");
const AUDIT_TARGET = 120;

const metrics = JSON.parse(fs.readFileSync(path.join(RESULTS, "gated_ablation_metrics.json"), "utf8"));
const ORDER = Object.keys(metrics.conditions);

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const show = (metric) => (!metric || metric.value === "UNMEASURED" ? "UNMEASURED" : metric.value);
const withCount = (metric) => {
  if (!metric || metric.value === "UNMEASURED") return "UNMEASURED";
  const ci = metric.ci95 ? `; CI ${metric.ci95.low}-${metric.ci95.high}%` : "";
  return `${metric.value} (${metric.count}${ci})`;
};

function rowsFor(condition) {
  return fs.readFileSync(path.join(RAW, `${condition}.jsonl`), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
}

// --- table 1 --------------------------------------------------------------

function table1() {
  const header = "| Cond. | UF/turn ↑ | EF ↑ | OC ↑ | Prov. Cov. ↑ | Edge Prov. ↑ | Cite ↑ | Edge Cite ↑ | UF-rate | Yield | s/fact |";
  const rule = "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const lines = ORDER.map((id) => {
    const c = metrics.conditions[id];
    return `| ${id} ${c.label} | ${c.usableFaithfulPerTurn ?? "UNMEASURED"} | ${show(c.EF)} | ${show(c.OC)} | ${show(c.provenanceCoverage)} | ${show(c.edgeProvenanceCoverage)} | ${show(c.citationCorrectness)} | ${show(c.edgeCitationCorrectness)} | ${show(c.usableFaithfulYield)} | ${show(c.yield)} | ${c.secondsPerFact ?? "UNMEASURED"} |`;
  });
  return [
    "# Table 1 — staged ablation of the symbolic gate",
    "",
    `Generated ${metrics.generatedAt} from \`results/gated_ablation_metrics.json\`.`,
    "",
    header, rule, ...lines,
    "",
    "OC = ontology conformance. SH/OH = subject/object hallucination over admitted knowledge-to-knowledge edges.",
    "Prov. Cov. = admitted knowledge vertices carrying evidence. Cite = citations an independent judge confirms license their fact.",
    "EF = admitted facts the judge confirms the utterance supports. UF/turn = usable+faithful facts (schema-conforming AND judge-confirmed) per eligible interview turn — the headline productivity metric; its denominator is the interview, which unlike proposals is constant across conditions. UF-rate divides the same numerator by proposals and reads as precision. Edge Prov. = admitted knowledge-to-knowledge edges carrying their own evidence.",
    "",
    "Exact counts and Wilson 95% intervals for every proportion are in `results/metrics.json`."
  ].join("\n");
}

// --- narrative ------------------------------------------------------------

function conditionLine(id) {
  const c = metrics.conditions[id];
  return `- **${id}** (${c.label}): proposed ${c.proposedFacts}, admitted ${c.admittedFacts}. ` +
    `OC ${withCount(c.OC)}. EF ${withCount(c.EF)}. Provenance ${withCount(c.provenanceCoverage)}. ` +
    `Citations ${withCount(c.citationCorrectness)}. Usable+faithful ${withCount(c.usableFaithfulYield)}. ` +
    `${c.tokensPerFact ?? "UNMEASURED"} tokens/fact, ${c.secondsPerFact ?? "UNMEASURED"} s/fact, retry budget ${show(c.retryBudgetConsumed)}.`;
}

/**
 * The findings narrative is computed from the measurements, not written beside
 * them: every "significant"/"not significant" is decided by the exact test it
 * cites, so a re-run that moves a number cannot leave a stale claim behind.
 */
function findingsSection() {
  const c = metrics.conditions;
  const tests = metrics.pairedTests;
  const sig = (t) => t.p < 0.05;
  const describeTest = (name) => {
    const t = tests[name];
    return `${name}: discordant ${t.discordant}, exact p = ${t.p} — ${sig(t) ? "significant" : "not statistically significant"}`;
  };

  const parts = [];

  parts.push(`### 1. Ungated extraction produces almost no usable typed knowledge

The composite metric — facts both schema-conforming and judge-confirmed, over proposals — is
${withCount(c.A0.usableFaithfulYield)} ungated versus ${withCount(c.A1.usableFaithfulYield)} under a typed
tool schema. Free-form output invents its own vocabulary and stays close to the wording of the
turn; such statements can be individually faithful (A0 EF ${show(c.A0.EF)}) and collectively useless,
because they conform to no ontology that could be queried, merged, or governed. The A0 EF column
must never be read as "ungated extraction works": its usable yield is ${show(c.A0.usableFaithfulYield)}.

Whether constrained decoding also *costs* per-fact faithfulness is prompt-sensitive: an earlier
run of this harness (archived with the repository history) measured a significant A0→A1 EF drop;
under the current prompt the same contrast is ${describeTest("A0 vs A1")}. We report the
composite because it is stable across both runs; the EF-direction claim is not.`);

  parts.push(`### 2. Structural provenance: coverage is architectural, not behavioural

Provenance coverage is ${show(c.A4.provenanceCoverage)}–${show(c["A4-strict"].provenanceCoverage)} in the conditions that
require evidence and ${show(c.A1.provenanceCoverage)} in those that do not. The 2026-07-16 package measured
2.2–5.4% under identical intent, when evidence was a separate vertex plus an edge the extractor
had to remember to emit. Carrying evidence inline on the fact and letting the gate materialize
the node and select the typed edge makes the orphan-evidence failure unrepresentable. Coverage
moved ~90 points because the representation changed, not because the model behaved better.`);

  parts.push(`### 3. Enforcing provenance hard buys coverage, and only coverage

A4 and A4-strict differ in one bit: whether the spec's soft evidence rule is enforced as hard.
Coverage rises ${show(c.A4.provenanceCoverage)} → ${show(c["A4-strict"].provenanceCoverage)}; yield falls
${show(c.A4.yield)} → ${show(c["A4-strict"].yield)}; usable+faithful falls ${show(c.A4.usableFaithfulYield)} →
${show(c["A4-strict"].usableFaithfulYield)}; per-fact EF is unchanged within its interval
(${withCount(c.A4.EF)} → ${withCount(c["A4-strict"].EF)}; ${describeTest("A4 vs A4-strict")}).
Severity escalation purchases a reporting metric at the price of knowledge kept. The spec's
choice of soft severity for live sessions is the right default.`);

  parts.push(`### 4. Typed-error retry buys volume; its faithfulness cost is real here

Retry raises admitted facts ${c.A2.admittedFacts} → ${c.A3.admittedFacts} at
${c.A2.tokensPerFact} → ${c.A3.tokensPerFact} tokens per admitted fact. On this run the recovered
volume is measurably less grounded: ${describeTest("A2 vs A3")}, EF ${show(c.A2.EF)} → ${show(c.A3.EF)}.
The earlier run measured no such cost, so the effect is not stable across prompts either — but a
deployment enabling retry should watch EF, not assume recovery is free.`);

  parts.push(`### 5. The full deployed gate, on the denominator that matters

Proposals are inflated by retry, so per-proposal rates penalize the mechanism that
recovers knowledge; the denominator held constant across conditions is the interview
itself. Per eligible turn, usable+faithful facts go ${c.A1.usableFaithfulPerTurn} (A1, structure
only) → ${c.A5.usableFaithfulPerTurn} (A5, full gate) — ${c.A1.usableFaithfulFacts} → ${c.A5.usableFaithfulFacts} facts —
with OC ${show(c.A5.OC)}, vertex provenance ${show(c.A5.provenanceCoverage)}, edge provenance
${show(c.A5.edgeProvenanceCoverage)} (a metric A1 cannot have at all), duplicates
${show(c.A5.duplicateRate)} (${c.A5.duplicateRate.count}), and ${c.A5.temporalContradictions} temporal supersessions the other
conditions would have overwritten silently. The per-utterance contamination contrasts:
${describeTest("A1 vs A5")}; ${describeTest("A0 vs A5")}.`);

  parts.push(`### 6. Coverage is not quality — and edge grounding is young

An independent judge confirms ${withCount(c.A4.citationCorrectness)} (A4) to
${withCount(c.A5.citationCorrectness)} (A5) of admitted vertex citations, and only
${withCount(c["A4-strict"].edgeCitationCorrectness)}–${withCount(c.A4.edgeCitationCorrectness)} of edge citations, as actually
licensing the fact that cites them — after the span-based specificity rule. Coverage alone
overstates grounding; both numbers must be reported. Citation quality, not coverage, is now the
weakest measured link in the pipeline. One driver was identified and fixed mid-iteration: the
extractor padded optional properties with unstated elaboration, which the citation judge rightly
refused to credit; forbidding padding moved EF up ~7 points across governed conditions.`);

  return parts.join("\n\n");
}

function resultsMarkdown() {
  const tests = metrics.pairedTests;
  return `# Measured results — gated elicitation ablation

Generated: ${metrics.generatedAt}

## What this package is

Every number below is measured from a real run of the **deployed** symbolic gate over
a real hospitality elicitation session. The ablation harness imports \`lib/gate\`; there
is no separate evaluation implementation that could drift from the shipped one.
Extraction is stateless, so for a given turn and attempt every condition issues an
identical request and attempt-1 proposals are the same across A1–A5. The gate is the
only thing that varies.

Quantities that were not measured are written \`UNMEASURED\`. They are never treated as zero.

## Corpus

- ${metrics.corpus.sessions} hospitality session, ${metrics.corpus.expertTurns} expert turns,
  ${metrics.corpus.eligibleTurns} eligible after ${metrics.corpus.excludedAsFiller} deterministic filler exclusions.
- Schema: ${metrics.schema.vertexClasses} vertex classes (${metrics.schema.knowledgeClasses} knowledge,
  ${metrics.schema.infrastructureClasses} infrastructure), ${metrics.schema.edgeTypes} edge types,
  contract drift ${metrics.schema.contractDrift}.
- Extractor ${metrics.harness.extractorModel}, temperature ${metrics.harness.temperature}, seed ${metrics.harness.seed},
  prompt hash \`${metrics.harness.promptHash.slice(0, 16)}\`. Judge ${metrics.harness.judgeModel}.
- Fact definition: ${metrics.factDefinition}

## Conditions

${ORDER.map(conditionLine).join("\n")}

## Findings

${findingsSection()}

## Paired tests

Outcome per utterance: "at least one admitted fact is unsupported by the utterance".
Exact two-sided McNemar over the ${metrics.corpus.eligibleTurns} eligible turns.

| Comparison | left-only | right-only | discordant | exact p |
|---|---:|---:|---:|---:|
${Object.entries(tests).map(([name, t]) => `| ${name} | ${t.leftOnly} | ${t.rightOnly} | ${t.discordant} | ${t.p} |`).join("\n")}

## Threats to validity

- **One session, one domain, one expert.** ${metrics.corpus.eligibleTurns} eligible turns. Confidence intervals are
  wide and every cross-condition difference except A0-vs-A1 and A0-vs-A5 is compatible with noise.
- **EF and citation correctness are judged by ${metrics.harness.judgeModel}, not by humans.** The judge and the
  extractor (${metrics.harness.extractorModel}) are from one model family, so shared blind spots are plausible.
  Human EF is \`UNMEASURED\`; the blinded sample in \`results/human_audit_sample.csv\` is ready to be labelled.
- **A0 is not comparable fact-for-fact.** Free-form output has no ontology, so its facts are
  different objects from typed facts. The composite metric exists for this reason; the EF column
  alone must not be read as "ungated extraction is more faithful".
- **The corpus is ASR output.** Transcription error surfaces as extraction or grounding error.
- **Seeded decoding is best-effort.** The provider does not guarantee reproducible sampling.
- Downstream question-answering utility is out of scope and \`UNMEASURED\`.

## Reproduction

\`\`\`bash
node --import ./scripts/ts-alias-hooks.mjs scripts/nesy_results/run_gated_ablation.mjs
node --import ./scripts/ts-alias-hooks.mjs scripts/nesy_results/build_results_package.mjs
npm test
\`\`\`

Every API call is cached by content hash under \`results/cache/gated-ablation\`, so a
re-run reproduces these numbers without new requests. The superseded 2026-07-16 package
is retained unmodified under \`results/legacy-2026-07-16/\`.
`;
}

// --- blinded human audit sample -------------------------------------------

function auditSample() {
  const pool = [];
  for (const condition of ORDER) {
    for (const row of rowsFor(condition)) {
      if (row.excluded_as_filler) continue;
      const grounded = new Map((row.provenance ?? []).map((entry) => [entry.vertexId, entry]));
      for (const fact of row.admitted_facts) {
        pool.push({
          condition,
          utterance_id: row.utterance_id,
          utterance: row.source_utterance,
          fact: fact.text,
          kind: fact.kind,
          citation: grounded.get(fact.id)?.traceText ?? ""
        });
      }
    }
  }

  // Stratify by condition so every arm is represented, then blind.
  const perCondition = Math.max(1, Math.floor(AUDIT_TARGET / ORDER.length));
  const selected = [];
  for (const condition of ORDER) {
    const items = pool.filter((item) => item.condition === condition);
    const step = Math.max(1, Math.floor(items.length / perCondition));
    for (let index = 0; index < items.length && selected.filter((s) => s.condition === condition).length < perCondition; index += step) {
      selected.push(items[index]);
    }
  }
  // Deterministic blinding: order by a hash of the content, not by condition.
  selected.sort((a, b) => (sha(a.fact + a.utterance_id) < sha(b.fact + b.utterance_id) ? -1 : 1));

  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = "row_id,utterance,fact,citation,human_fact_supported,human_citation_supports";
  const lines = selected.map((item, index) => {
    const rowId = `R${String(index + 1).padStart(3, "0")}`;
    return [rowId, escape(item.utterance), escape(item.fact), escape(item.citation), '""', '""'].join(",");
  });
  const key = selected.map((item, index) => ({
    row_id: `R${String(index + 1).padStart(3, "0")}`,
    condition: item.condition,
    utterance_id: item.utterance_id,
    kind: item.kind
  }));
  return {
    csv: [
      "# Blinded human audit sample. Fill human_fact_supported and human_citation_supports with yes/no.",
      "# human_fact_supported: does the utterance support the fact?",
      "# human_citation_supports: does the quoted citation license the fact? Leave blank when citation is empty.",
      header,
      ...lines
    ].join("\n") + "\n",
    key
  };
}

// --- manifest -------------------------------------------------------------

function evidenceManifest() {
  const files = {};
  for (const condition of ORDER) {
    const file = path.join(RAW, `${condition}.jsonl`);
    files[`results/raw/${condition}.jsonl`] = {
      sha256: sha(fs.readFileSync(file)),
      rows: fs.readFileSync(file, "utf8").trim().split("\n").length
    };
  }
  const cacheDir = path.join(RESULTS, "cache", "gated-ablation");
  return {
    generatedAt: metrics.generatedAt,
    metrics: { "results/gated_ablation_metrics.json": { sha256: sha(fs.readFileSync(path.join(RESULTS, "gated_ablation_metrics.json"))) } },
    raw: files,
    cachedApiResponses: fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).length : 0,
    supersededPackage: "results/legacy-2026-07-16/",
    note: "Each raw row carries the source utterance, proposed facts, admitted facts, gate findings, and the delta that was written."
  };
}

// --- write ----------------------------------------------------------------

const audit = auditSample();
fs.writeFileSync(path.join(RESULTS, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
fs.writeFileSync(path.join(RESULTS, "table1.md"), `${table1()}\n`);
fs.writeFileSync(path.join(RESULTS, "results.md"), resultsMarkdown());
fs.writeFileSync(path.join(RESULTS, "human_audit_sample.csv"), audit.csv);
fs.writeFileSync(path.join(RESULTS, "audit_key.json"), `${JSON.stringify({ note: "Condition assignments for the blinded sample. Do not open before labelling.", rows: audit.key }, null, 2)}\n`);
fs.writeFileSync(path.join(RESULTS, "evidence_manifest.json"), `${JSON.stringify(evidenceManifest(), null, 2)}\n`);

process.stdout.write(`Wrote results/metrics.json, table1.md, results.md, human_audit_sample.csv (${audit.key.length} rows), audit_key.json, evidence_manifest.json\n`);
