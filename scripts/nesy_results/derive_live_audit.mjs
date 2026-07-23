/**
 * CLI wrapper for the shared audit deriver (lib/audit.ts) — the browser's
 * download bundle uses the same implementation, so a re-derivation here always
 * reproduces the file the session exported.
 *
 * Usage:
 *   npm run audit:derive -- <session-export.json> [out.json]
 */

import fs from "node:fs";
import path from "node:path";
import { deriveAuditInput } from "../../lib/audit.ts";

const [exportPath, outArg] = process.argv.slice(2);
if (!exportPath) {
  console.error("usage: derive_live_audit.mjs <session-export.json> [out.json]");
  process.exit(1);
}

const session = JSON.parse(fs.readFileSync(exportPath, "utf8"));
if (session.format !== "chatgraph-session/v1") {
  console.error(`unexpected export format: ${session.format ?? "(none)"}`);
  process.exit(1);
}

const sessionName = path.basename(exportPath).replace(/\.json$/, "");
let out;
try {
  out = deriveAuditInput(session, sessionName);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const outPath = outArg ?? path.join("data", "live_audit", `facts-${sessionName.replace(/^chatgraph-/, "")}.json`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`wrote ${outPath}`);
console.log(
  `  facts: ${out.facts.length} (${out.exportStats.groundedKnowledgeVertices} grounded), ` +
  `edges: ${out.edges.length} (${out.exportStats.groundedSemanticEdges} grounded)`
);
console.log(`  span pre-check: ${out.spanPreCheck.ok} ok, ${out.spanPreCheck.fail} fail (of grounded+attributed)`);
if (out.attribution.episodeCollisions.length) console.log(`  episode-id collisions: ${out.attribution.episodeCollisions.join(", ")}`);
if (out.attribution.turnVsEpisodeDisagreements.length) console.log(`  turn-vs-episode disagreements: ${out.attribution.turnVsEpisodeDisagreements.join(", ")}`);
if (out.attribution.unattributed) console.log(`  unattributed facts: ${out.attribution.unattributed}`);
