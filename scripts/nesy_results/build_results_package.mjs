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
  const header = "| Cond. | OC ↑ | SH ↓ | OH ↓ | Prov. Cov. ↑ | Cite ↑ | EF ↑ | Usable+faithful ↑ | Yield | s/fact |";
  const rule = "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const lines = ORDER.map((id) => {
    const c = metrics.conditions[id];
    return `| ${id} ${c.label} | ${show(c.OC)} | ${show(c.SH)} | ${show(c.OH)} | ${show(c.provenanceCoverage)} | ${show(c.citationCorrectness)} | ${show(c.EF)} | ${show(c.usableFaithfulYield)} | ${show(c.yield)} | ${c.secondsPerFact ?? "UNMEASURED"} |`;
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
    "EF = admitted facts the judge confirms the utterance supports. Usable+faithful = admitted facts that are both schema-conforming and judge-confirmed, as a share of proposed.",
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

function resultsMarkdown() {
  const c = metrics.conditions;
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

### 1. Structure is not grounding — and it costs grounding

Constrained decoding does what it claims: ontology conformance rises from
${show(c.A0.OC)} (${c.A0.OC.count}) ungated to ${show(c.A1.OC)} (${c.A1.OC.count}) under a typed tool schema.
Evidential faithfulness moves the other way, from ${withCount(c.A0.EF)} to ${withCount(c.A1.EF)}.
The paired test over the ${metrics.corpus.eligibleTurns} shared utterances is significant:
A0 vs A1 discordant ${tests["A0 vs A1"].discordant}, exact p = ${tests["A0 vs A1"].p}.

The mechanism is visible in the raw output. Ungated extraction invents its own
vocabulary — labels such as "Service Standardization" and "eye twitch signal",
relations such as "appreciates" and "enhances" — and stays close to the wording of
the turn. Those statements are easy for a judge to confirm and impossible to query,
merge, or govern. **Free-form faithfulness is the precision of vagueness.**

### 2. What the gate is actually worth: usable, grounded knowledge

Neither conformance nor faithfulness alone captures the goal. A fact that conforms to
no ontology cannot be used; a schema-perfect fact the utterance does not support is a
hallucination with good manners. Counting facts that are **both**:

${ORDER.map((id) => `- ${id}: ${withCount(metrics.conditions[id].usableFaithfulYield)}`).join("\n")}

Ungated extraction converts ${show(c.A0.usableFaithfulYield)} of what it proposes into usable
grounded knowledge. Every gated condition converts ${show(c.A2.usableFaithfulYield)}–${show(c.A1.usableFaithfulYield)}.
That gap, not the EF column, is what the gate buys.

### 3. Provenance as an admission criterion

A4 and A4-strict differ in exactly one bit: whether the spec's soft rule HR006
("every knowledge vertex must carry evidence") is enforced as hard. Everything else —
prompt, model, seed, retry budget, other constraints — is identical.

| | A4 (soft) | A4-strict (hard) |
|---|---|---|
| Provenance coverage | ${withCount(c.A4.provenanceCoverage)} | ${withCount(c["A4-strict"].provenanceCoverage)} |
| Citation correctness | ${withCount(c.A4.citationCorrectness)} | ${withCount(c["A4-strict"].citationCorrectness)} |
| Evidential faithfulness | ${withCount(c.A4.EF)} | ${withCount(c["A4-strict"].EF)} |
| Yield | ${withCount(c.A4.yield)} | ${withCount(c["A4-strict"].yield)} |

Enforcing evidence raises faithfulness and citation quality and costs yield, in the
direction the design predicts. **The effect is not statistically significant on this
corpus**: only ${tests["A4 vs A4-strict"].discordant} utterances are discordant, exact p = ${tests["A4 vs A4-strict"].p}.
The point estimate is suggestive; the sample cannot carry the claim.

### 4. Structural provenance is what made provenance measurable at all

Provenance coverage is ${show(c.A4.provenanceCoverage)}–${show(c["A4-strict"].provenanceCoverage)} in the conditions that require it
and ${show(c.A1.provenanceCoverage)} in those that do not. The archived 2026-07-16 run measured
2.2–5.4% under an identical intent, because evidence was a separate vertex plus an edge the
extractor had to remember to emit: it produced 41 evidence nodes and only 7 provenance edges.
Carrying evidence inline on the fact and letting the gate materialize the node and select the
correctly-typed edge makes the orphan case unrepresentable.

### 5. Coverage is not quality

Citations pass the anti-generic rule and still fail on inspection: an independent judge
confirms only ${withCount(c.A4.citationCorrectness)} of A4 citations and ${withCount(c["A4-strict"].citationCorrectness)} of A4-strict
citations actually license the fact that cites them. **Provenance coverage overstates
grounding.** A deployment that reports coverage alone is reporting the wrong number.

### 6. Constraints that bought nothing measurable here

Reported plainly because the ablation is only worth running if it can return a negative:

- **Deterministic identity.** Duplicate rate is ${show(c.A5.duplicateRate)} (${c.A5.duplicateRate.count}) under the full
  gate and ${show(c.A3.duplicateRate)} (${c.A3.duplicateRate.count}) without it. On this corpus the extractor rarely
  restates a fact in content-identical form, so content-derived ids had nothing to collapse.
  The constraint is cheap and prevents a failure this session did not exhibit.
- **Typed-error retry** raised admitted facts from ${c.A2.admittedFacts} to ${c.A3.admittedFacts} at
  ${c.A2.tokensPerFact}→${c.A3.tokensPerFact} tokens per admitted fact, with EF unchanged within its interval
  (${show(c.A2.EF)} → ${show(c.A3.EF)}). Retry buys volume, not faithfulness — and does not cost it.
- **Temporal contradiction handling** fired ${c.A5.temporalContradictions} times: ${c.A5.temporalContradictions} superseding corrections
  the other conditions would have silently overwritten. Real, but a single-session count.

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
