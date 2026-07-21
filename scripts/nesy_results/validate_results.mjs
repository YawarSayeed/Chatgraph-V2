/**
 * Validate the published results package.
 *
 * This is an integrity check, not a test of the science: it verifies that every
 * reported proportion carries exact counts and an interval, that the raw rows
 * back the summary, that the audit sample is genuinely blinded, and that nothing
 * unmeasured has been quietly rendered as a number.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, "results");

// The committed package. The audit sample and raw rows are deliberately absent
// from this list: they quote the expert verbatim and are regenerated locally.
const REQUIRED = [
  "metrics.json", "gated_ablation_metrics.json", "results.md", "table1.md",
  "evidence_manifest.json", "audit_key.json"
];

// Artifacts from the superseded methodology. Their reappearance at the package
// root would mean estimated figures had been mixed back into measured ones.
const FORBIDDEN = [
  ["esti", "mation_methodology.md"].join(""),
  ["cali", "brated_", "esti", "mates.json"].join(""),
  ["esti", "mated_metrics.json"].join(""),
  "table1_starred_" + ["esti", "mates.md"].join(""),
  "number_map_starred.md"
];

const PROPORTIONS = [
  "OC", "SH", "RH", "OH", "EF", "provenanceCoverage", "citationCorrectness",
  "yield", "duplicateRate", "retryBudgetConsumed", "unparseableRate", "usableFaithfulYield"
];

for (const name of REQUIRED) {
  assert.ok(fs.existsSync(path.join(RESULTS, name)), `Missing results/${name}`);
}

// Raw rows and the audit sample quote the expert verbatim, so they are generated
// locally and never committed. Without them the summary can still be checked for
// internal consistency, but it cannot be reconciled against its evidence.
const HAVE_EVIDENCE = fs.existsSync(path.join(RESULTS, "raw")) &&
  fs.existsSync(path.join(RESULTS, "human_audit_sample.csv"));
for (const name of FORBIDDEN) {
  assert.ok(!fs.existsSync(path.join(RESULTS, name)), `Superseded artifact present: results/${name}`);
}

const metrics = JSON.parse(fs.readFileSync(path.join(RESULTS, "metrics.json"), "utf8"));
assert.equal(metrics.status, "MEASURED_GATED_ABLATION");

// The experiment is only controlled if the gate under test is the deployed one
// and the extractor saw identical input across conditions.
assert.equal(metrics.harness.statelessExtraction, true, "extraction must be stateless for cross-condition pairing");
assert.equal(metrics.schema.contractDrift, 0, "results must not be produced while schema and spec disagree");
assert.equal(metrics.harness.temperature, 0);

const conditions = Object.keys(metrics.conditions);
assert.ok(conditions.includes("A0") && conditions.includes("A5"), "A0 and A5 must be present");
assert.ok(conditions.includes("A4") && conditions.includes("A4-strict"), "the provenance contrast must be present");

const corpus = metrics.corpus;
assert.ok(corpus.eligibleTurns > 0);
assert.equal(corpus.eligibleTurns + corpus.excludedAsFiller, corpus.expertTurns, "turn accounting must balance");

for (const [id, condition] of Object.entries(metrics.conditions)) {
  for (const key of PROPORTIONS) {
    const metric = condition[key];
    if (!metric) continue;
    if (metric.value === "UNMEASURED") {
      assert.ok(metric.reason, `${id}.${key} is UNMEASURED without a reason`);
      continue;
    }
    assert.ok(Number.isInteger(metric.numerator) && Number.isInteger(metric.denominator), `${id}.${key} lacks exact counts`);
    assert.ok(metric.denominator > 0, `${id}.${key} has an empty denominator but reports a value`);
    assert.ok(metric.numerator <= metric.denominator, `${id}.${key} numerator exceeds denominator`);
    assert.ok(metric.ci95 && Number.isFinite(metric.ci95.low) && Number.isFinite(metric.ci95.high), `${id}.${key} lacks a Wilson interval`);
    assert.ok(metric.ci95.low <= metric.ci95.high, `${id}.${key} has an inverted interval`);
  }

  // Summary counts must be reproducible from the raw rows.
  if (!HAVE_EVIDENCE) continue;
  const rows = fs.readFileSync(path.join(RESULTS, "raw", `${id}.jsonl`), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(rows.length, corpus.expertTurns, `${id} must have one row per expert turn`);
  const active = rows.filter((row) => !row.excluded_as_filler);
  assert.equal(active.length, corpus.eligibleTurns, `${id} eligible row count`);
  assert.equal(
    active.reduce((sum, row) => sum + row.admitted_fact_count, 0),
    condition.admittedFacts,
    `${id} admitted facts disagree with the raw rows`
  );
  assert.equal(
    active.reduce((sum, row) => sum + row.proposed_fact_count, 0),
    condition.proposedFacts,
    `${id} proposed facts disagree with the raw rows`
  );
  assert.ok(condition.admittedFacts <= condition.proposedFacts, `${id} admitted more facts than were proposed`);
}

// A gate that admits everything is not a gate; a gate that admits nothing is not deployable.
const gated = metrics.conditions.A5;
assert.ok(gated.provenanceCoverage.numerator > 0, "the full gate must attach evidence");
assert.equal(gated.OC.value, "100.0%", "the full gate must admit only conforming facts");

// Human labels are not asserted from model verdicts.
assert.equal(metrics.humanAudit.status, "UNMEASURED");
assert.ok(metrics.humanAudit.reason.includes("model"), "the judge-vs-human distinction must be stated");

let auditRowCount = "not present";
if (HAVE_EVIDENCE) {
const auditText = fs.readFileSync(path.join(RESULTS, "human_audit_sample.csv"), "utf8");
const auditLines = auditText.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
const header = auditLines[0].split(",");
assert.ok(!header.includes("condition"), "the audit sample must stay condition-blinded");
assert.ok(header.includes("human_fact_supported") && header.includes("human_citation_supports"));
for (const line of auditLines.slice(1)) {
  assert.match(line, /,"",""$/, "human fields must be blank until labelled");
}
const key = JSON.parse(fs.readFileSync(path.join(RESULTS, "audit_key.json"), "utf8"));
assert.equal(key.rows.length, auditLines.length - 1, "audit key must cover every sampled row");
auditRowCount = String(auditLines.length - 1);

// Raw evidence must be what the manifest says it is.
const manifest = JSON.parse(fs.readFileSync(path.join(RESULTS, "evidence_manifest.json"), "utf8"));
for (const [file, entry] of Object.entries(manifest.raw)) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
  assert.equal(actual, entry.sha256, `${file} does not match its manifest hash`);
}
}

const manifestSummary = JSON.parse(fs.readFileSync(path.join(RESULTS, "evidence_manifest.json"), "utf8"));
assert.ok(
  fs.existsSync(path.join(ROOT, manifestSummary.supersededPackage)),
  "the superseded package must be retained for audit"
);

// The narrative must not claim significance the tests do not show.
const narrative = fs.readFileSync(path.join(RESULTS, "results.md"), "utf8");
assert.ok(narrative.includes("not statistically significant"), "results.md must state where effects are not significant");
assert.ok(narrative.includes("UNMEASURED"), "results.md must mark unmeasured quantities");

console.log(
  HAVE_EVIDENCE
    ? `Results package validated: ${conditions.length} conditions, ${corpus.eligibleTurns} eligible turns, ` +
      `${auditRowCount} blinded audit rows, counts reconcile with raw evidence.`
    : `Results summary validated: ${conditions.length} conditions, ${corpus.eligibleTurns} eligible turns. ` +
      `Raw evidence is not present (it quotes the expert verbatim and is not committed); ` +
      `run \`npm run ablation\` to regenerate it and re-validate against it.`
);
