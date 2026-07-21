/**
 * Verify that every quantitative claim in the paper is present in the measured
 * results, and that the paper does not assert human labels it does not have.
 *
 * Each claim names the exact path in results/metrics.json it must equal, so a
 * re-run that moves a number fails here instead of shipping a stale figure.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PAPER = path.join(ROOT, "NeSy2026_Paper_DRAFT_LaTeX_preview.md");
const metrics = JSON.parse(fs.readFileSync(path.join(ROOT, "results", "metrics.json"), "utf8"));
const paper = fs.readFileSync(PAPER, "utf8");

const at = (pathExpression) =>
  pathExpression.split(".").reduce((node, key) => (node === undefined ? undefined : node[key]), metrics);

/** [claim as it appears in the paper, path in metrics.json] */
const CLAIMS = [
  ["2.1%", "conditions.A0.OC.value"],
  ["1/48", "conditions.A0.OC.count"],
  ["95.8%", "conditions.A0.EF.value"],
  ["46/48", "conditions.A0.EF.count"],
  ["95.6%", "conditions.A1.OC.value"],
  ["43/45", "conditions.A1.OC.count"],
  ["82.2%", "conditions.A1.EF.value"],
  ["37/45", "conditions.A1.EF.count"],
  ["80.0%", "conditions.A1.usableFaithfulYield.value"],
  ["83.3%", "conditions.A2.EF.value"],
  ["77.8%", "conditions.A2.usableFaithfulYield.value"],
  ["85.5%", "conditions.A3.EF.value"],
  ["78.7%", "conditions.A3.usableFaithfulYield.value"],
  ["92.7%", "conditions.A4.provenanceCoverage.value"],
  ["70.6%", "conditions.A4.citationCorrectness.value"],
  ["81.1%", "conditions.A4.EF.value"],
  ["74.1%", "conditions.A4.usableFaithfulYield.value"],
  ["91.4%", "conditions.A4.yield.value"],
  ["98.1%", "conditions.A4-strict.provenanceCoverage.value"],
  ["78.4%", "conditions.A4-strict.citationCorrectness.value"],
  ["86.4%", "conditions.A4-strict.EF.value"],
  ["73.1%", "conditions.A4-strict.usableFaithfulYield.value"],
  ["84.6%", "conditions.A4-strict.yield.value"],
  ["76.5%", "conditions.A5.citationCorrectness.value"],
  ["80.0%", "conditions.A5.EF.value"],
  ["75.0%", "conditions.A5.usableFaithfulYield.value"],
  ["93.8%", "conditions.A5.yield.value"]
];

const failures = [];

for (const [claim, pathExpression] of CLAIMS) {
  const actual = at(pathExpression);
  if (actual === undefined) {
    failures.push(`${pathExpression} is missing from metrics.json`);
    continue;
  }
  if (String(actual) !== claim) {
    failures.push(`paper says ${claim} for ${pathExpression}, measured ${actual}`);
    continue;
  }
  if (!paper.includes(claim)) {
    failures.push(`measured ${pathExpression} = ${actual} is not stated in the paper`);
  }
}

// Token costs and counts quoted in prose.
const COUNTS = [
  ["476", "conditions.A0.tokensPerFact"],
  ["1510", "conditions.A1.tokensPerFact"],
  ["1618", "conditions.A2.tokensPerFact"],
  ["2300", "conditions.A3.tokensPerFact"],
  ["2244", "conditions.A4.tokensPerFact"],
  ["2597", "conditions.A4-strict.tokensPerFact"],
  ["2212", "conditions.A5.tokensPerFact"]
];
for (const [claim, pathExpression] of COUNTS) {
  const actual = String(at(pathExpression));
  if (actual !== claim) failures.push(`paper says ${claim} tokens/fact for ${pathExpression}, measured ${actual}`);
  if (!paper.includes(claim)) failures.push(`${pathExpression} = ${actual} is not stated in the paper`);
}

// Significance claims must match the tests actually run.
const a0a1 = at("pairedTests.A0 vs A1");
assert.ok(a0a1, "A0 vs A1 test missing");
if (String(a0a1.p) !== "0.0313" || !paper.includes("0.031")) {
  failures.push(`A0 vs A1 exact p is ${a0a1.p}; the paper must quote it`);
}
if (String(a0a1.discordant) !== "6" || !paper.includes("discordant 6")) {
  failures.push(`A0 vs A1 discordant is ${a0a1.discordant}; the paper must quote it`);
}
const provTest = at("pairedTests.A4 vs A4-strict");
if (String(provTest.p) !== "0.5" || !paper.includes("p = 0.5")) {
  failures.push(`A4 vs A4-strict exact p is ${provTest.p}; the paper must quote it`);
}
assert.ok(
  paper.includes("not statistically significant"),
  "the paper must state plainly where an effect is not significant"
);

// Corpus and schema facts.
for (const [claim, pathExpression] of [
  ["45", "corpus.expertTurns"],
  ["32", "corpus.eligibleTurns"],
  ["13", "corpus.excludedAsFiller"],
  ["24", "schema.vertexClasses"],
  ["19", "schema.knowledgeClasses"],
  ["5", "schema.infrastructureClasses"],
  ["33", "schema.edgeTypes"]
]) {
  const actual = String(at(pathExpression));
  if (actual !== claim) failures.push(`paper says ${claim} for ${pathExpression}, measured ${actual}`);
}

// The paper must not claim human adjudication it does not have.
assert.equal(at("humanAudit.status"), "UNMEASURED");
assert.ok(
  paper.includes("UNMEASURED") && /human labels remain UNMEASURED|Human EF is UNMEASURED/.test(paper),
  "the paper must mark human faithfulness labels as UNMEASURED"
);
assert.ok(
  !/human-verified|human annotators confirm|verified by human/i.test(paper),
  "the paper must not claim human verification"
);

if (failures.length > 0) {
  console.error(`Paper claim verification FAILED (${failures.length}):\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Paper claim verification passed: ${CLAIMS.length + COUNTS.length} figures match results/metrics.json, significance claims match the paired tests, no human-verification claim.`);
}
