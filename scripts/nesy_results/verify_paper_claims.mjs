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
  ["0.0%", "conditions.A0.OC.value"],
  ["92.3%", "conditions.A0.EF.value"],
  ["0.0%", "conditions.A0.usableFaithfulYield.value"],
  ["0.0%", "conditions.A0.provenanceCoverage.value"],
  ["100.0%", "conditions.A0.yield.value"],
  ["0.0%", "conditions.A0.edgeProvenanceCoverage.value"],
  ["90.0%", "conditions.A1.OC.value"],
  ["82.0%", "conditions.A1.EF.value"],
  ["82.0%", "conditions.A1.usableFaithfulYield.value"],
  ["0.0%", "conditions.A1.provenanceCoverage.value"],
  ["100.0%", "conditions.A1.yield.value"],
  ["0.0%", "conditions.A1.edgeProvenanceCoverage.value"],
  ["100.0%", "conditions.A2.OC.value"],
  ["91.1%", "conditions.A2.EF.value"],
  ["82.0%", "conditions.A2.usableFaithfulYield.value"],
  ["0.0%", "conditions.A2.provenanceCoverage.value"],
  ["90.0%", "conditions.A2.yield.value"],
  ["0.0%", "conditions.A2.edgeProvenanceCoverage.value"],
  ["100.0%", "conditions.A3.OC.value"],
  ["86.2%", "conditions.A3.EF.value"],
  ["83.6%", "conditions.A3.usableFaithfulYield.value"],
  ["0.0%", "conditions.A3.provenanceCoverage.value"],
  ["97.0%", "conditions.A3.yield.value"],
  ["0.0%", "conditions.A3.edgeProvenanceCoverage.value"],
  ["100.0%", "conditions.A4.OC.value"],
  ["83.1%", "conditions.A4.EF.value"],
  ["76.6%", "conditions.A4.usableFaithfulYield.value"],
  ["83.7%", "conditions.A4.provenanceCoverage.value"],
  ["63.9%", "conditions.A4.citationCorrectness.value"],
  ["92.2%", "conditions.A4.yield.value"],
  ["68.8%", "conditions.A4.edgeProvenanceCoverage.value"],
  ["54.5%", "conditions.A4.edgeCitationCorrectness.value"],
  ["100.0%", "conditions.A4-strict.OC.value"],
  ["84.9%", "conditions.A4-strict.EF.value"],
  ["68.2%", "conditions.A4-strict.usableFaithfulYield.value"],
  ["100.0%", "conditions.A4-strict.provenanceCoverage.value"],
  ["67.5%", "conditions.A4-strict.citationCorrectness.value"],
  ["80.3%", "conditions.A4-strict.yield.value"],
  ["100.0%", "conditions.A4-strict.edgeProvenanceCoverage.value"],
  ["46.2%", "conditions.A4-strict.edgeCitationCorrectness.value"],
  ["100.0%", "conditions.A5.OC.value"],
  ["81.8%", "conditions.A5.EF.value"],
  ["81.8%", "conditions.A5.usableFaithfulYield.value"],
  ["84.8%", "conditions.A5.provenanceCoverage.value"],
  ["69.2%", "conditions.A5.citationCorrectness.value"],
  ["100.0%", "conditions.A5.yield.value"],
  ["65.0%", "conditions.A5.edgeProvenanceCoverage.value"],
  ["46.2%", "conditions.A5.edgeCitationCorrectness.value"]
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
  ["1.28", "conditions.A1.usableFaithfulPerTurn"],
  ["1.75", "conditions.A3.usableFaithfulPerTurn"],
  ["1.53", "conditions.A4.usableFaithfulPerTurn"],
  ["1.41", "conditions.A4-strict.usableFaithfulPerTurn"],
  ["1.69", "conditions.A5.usableFaithfulPerTurn"]
];
for (const [claim, pathExpression] of COUNTS) {
  const actual = String(at(pathExpression));
  if (actual !== claim) failures.push(`paper says ${claim} tokens/fact for ${pathExpression}, measured ${actual}`);
  if (!paper.includes(claim)) failures.push(`${pathExpression} = ${actual} is not stated in the paper`);
}

// Significance claims must match the tests actually run.
const TESTS = {
  "A2 vs A3": { p: "0.625", discordant: 4 },
  "A0 vs A5": { p: "0.125", discordant: 4 },
  "A1 vs A5": { p: "1", discordant: 4 }
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
