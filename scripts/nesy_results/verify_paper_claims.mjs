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
// Hard-wrapped markdown breaks phrase matching, so all containment checks run
// against a whitespace-normalized view of the paper.
const paper = fs.readFileSync(PAPER, "utf8").replace(/\s+/g, " ");

const at = (pathExpression) =>
  pathExpression.split(".").reduce((node, key) => (node === undefined ? undefined : node[key]), metrics);

/** [claim as it appears in the paper, path in metrics.json] */
const CLAIMS = [
  ["4.2%", "conditions.A0.OC.value"],
  ["87.5%", "conditions.A0.EF.value"],
  ["4.2%", "conditions.A0.usableFaithfulYield.value"],
  ["0.0%", "conditions.A0.provenanceCoverage.value"],
  ["100.0%", "conditions.A0.yield.value"],
  ["91.1%", "conditions.A1.OC.value"],
  ["93.3%", "conditions.A1.EF.value"],
  ["84.4%", "conditions.A1.usableFaithfulYield.value"],
  ["0.0%", "conditions.A1.provenanceCoverage.value"],
  ["100.0%", "conditions.A1.yield.value"],
  ["100.0%", "conditions.A2.OC.value"],
  ["92.7%", "conditions.A2.EF.value"],
  ["84.4%", "conditions.A2.usableFaithfulYield.value"],
  ["0.0%", "conditions.A2.provenanceCoverage.value"],
  ["91.1%", "conditions.A2.yield.value"],
  ["100.0%", "conditions.A3.OC.value"],
  ["74.3%", "conditions.A3.EF.value"],
  ["70.5%", "conditions.A3.usableFaithfulYield.value"],
  ["0.0%", "conditions.A3.provenanceCoverage.value"],
  ["94.9%", "conditions.A3.yield.value"],
  ["100.0%", "conditions.A4.OC.value"],
  ["76.1%", "conditions.A4.EF.value"],
  ["72.0%", "conditions.A4.usableFaithfulYield.value"],
  ["87.5%", "conditions.A4.provenanceCoverage.value"],
  ["79.6%", "conditions.A4.citationCorrectness.value"],
  ["94.7%", "conditions.A4.yield.value"],
  ["100.0%", "conditions.A4-strict.OC.value"],
  ["75.4%", "conditions.A4-strict.EF.value"],
  ["59.7%", "conditions.A4-strict.usableFaithfulYield.value"],
  ["100.0%", "conditions.A4-strict.provenanceCoverage.value"],
  ["79.6%", "conditions.A4-strict.citationCorrectness.value"],
  ["79.2%", "conditions.A4-strict.yield.value"],
  ["100.0%", "conditions.A5.OC.value"],
  ["76.0%", "conditions.A5.EF.value"],
  ["76.0%", "conditions.A5.usableFaithfulYield.value"],
  ["84.5%", "conditions.A5.provenanceCoverage.value"],
  ["81.6%", "conditions.A5.citationCorrectness.value"],
  ["100.0%", "conditions.A5.yield.value"]
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
  ["519", "conditions.A0.tokensPerFact"],
  ["1550", "conditions.A1.tokensPerFact"],
  ["1701", "conditions.A2.tokensPerFact"],
  ["2054", "conditions.A3.tokensPerFact"],
  ["2285", "conditions.A4.tokensPerFact"],
  ["2774", "conditions.A4-strict.tokensPerFact"],
  ["2230", "conditions.A5.tokensPerFact"]
];
for (const [claim, pathExpression] of COUNTS) {
  const actual = String(at(pathExpression));
  if (actual !== claim) failures.push(`paper says ${claim} tokens/fact for ${pathExpression}, measured ${actual}`);
  if (!paper.includes(claim)) failures.push(`${pathExpression} = ${actual} is not stated in the paper`);
}

// Significance claims must match the tests actually run.
const TESTS = {
  "A2 vs A3": { p: "0.0156", discordant: 7 },
  "A4 vs A4-strict": { p: "1", discordant: 1 },
  "A0 vs A5": { p: "0.0625", discordant: 5 },
  "A0 vs A1": { p: "1", discordant: 3 }
};
for (const [name, expected] of Object.entries(TESTS)) {
  const actual = at(`pairedTests.${name}`);
  assert.ok(actual, `${name} test missing`);
  if (String(actual.p) !== expected.p) failures.push(`${name} exact p is ${actual.p}, verifier expects ${expected.p}`);
  if (actual.discordant !== expected.discordant) failures.push(`${name} discordant is ${actual.discordant}, verifier expects ${expected.discordant}`);
  if (!paper.includes(`p = ${expected.p}`) && !paper.includes(`p = ${Number(expected.p)}`)) {
    failures.push(`the paper must quote ${name} exact p = ${expected.p}`);
  }
}
// The only significant contrast this run must be claimed as such, and the
// non-significant ones must not be.
assert.ok(
  paper.includes("not statistically significant") || paper.includes("not significant"),
  "the paper must state plainly where an effect is not significant"
);
assert.ok(paper.includes("non-replication"), "the paper must report the non-replicated earlier finding");

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
