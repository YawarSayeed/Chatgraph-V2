/**
 * Aggregate the live-session audit: cross-family (Claude) judge verdicts over the
 * DEPLOYED pipeline's own output, plus deterministic integrity checks.
 *
 *   node scripts/nesy_results/aggregate_live_audit.mjs <verdicts.json> <facts.json> <session.json>
 *
 * Writes results/live_session_audit.json — summary metrics only, no verbatim
 * interview content, so it is committable. Per-fact verdicts stay beside the
 * (gitignored) inputs.
 */

import fs from "node:fs";
import path from "node:path";

const [verdictsPath, factsPath, sessionPath] = process.argv.slice(2);
const verdicts = JSON.parse(fs.readFileSync(verdictsPath, "utf8"));
const audit = JSON.parse(fs.readFileSync(factsPath, "utf8"));
const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
const users = session.messages.filter((m) => m.role === "user").map((m) => m.content);

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

function wilson(n, d) {
  if (!d) return null;
  const z = 1.959963984540054;
  const p = n / d;
  const denom = 1 + (z * z) / d;
  const centre = p + (z * z) / (2 * d);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * d)) / d);
  return { low: Number((100 * Math.max(0, (centre - spread) / denom)).toFixed(1)), high: Number((100 * Math.min(1, (centre + spread) / denom)).toFixed(1)) };
}
const prop = (n, d) => (d ? { value: `${((100 * n) / d).toFixed(1)}%`, count: `${n}/${d}`, numerator: n, denominator: d, ci95: wilson(n, d) } : { value: "UNMEASURED", reason: "no denominator" });

// --- deterministic layer ---------------------------------------------------
let spanOk = 0, grounded = 0;
for (const f of audit.facts) {
  if (!f.trace) continue;
  grounded += 1;
  if (norm(users[f.uttIdx - 1]).includes(norm(f.trace))) spanOk += 1;
}
let eSpanOk = 0, eGrounded = 0;
for (const e of audit.edges) {
  if (!e.trace) continue;
  eGrounded += 1;
  if (norm(users[e.uttIdx - 1]).includes(norm(e.trace))) eSpanOk += 1;
}
const dupKeys = new Map();
let duplicates = 0;
for (const f of audit.facts) {
  const name = norm(f.props.name ?? f.props.ruleText ?? f.props.constraintType ?? f.props.duration ?? "");
  if (!name) continue;
  const key = `${f.label}|${name}`;
  if (dupKeys.has(key)) duplicates += 1; else dupKeys.set(key, true);
}

// --- judged layer ----------------------------------------------------------
const fv = new Map(verdicts.factVerdicts.map((v) => [v.id, v]));
let efGood = 0, citeGood = 0, citeJudged = 0, padded = 0, paddedPropsTotal = 0, judged = 0;
for (const f of audit.facts) {
  const v = fv.get(f.id);
  if (!v) continue;
  judged += 1;
  if (v.factSupported) efGood += 1;
  if (f.trace) { citeJudged += 1; if (v.citationSupports) citeGood += 1; }
  if (v.paddedProps.length > 0) { padded += 1; paddedPropsTotal += v.paddedProps.length; }
}
const ev = new Map(verdicts.edgeVerdicts.map((v) => [v.index, v]));
let eSupported = 0, eCiteGood = 0, eCiteJudged = 0, eIncoherent = 0, eJudged = 0;
audit.edges.forEach((e, i) => {
  const v = ev.get(i);
  if (!v) return;
  eJudged += 1;
  if (v.relationshipSupported) eSupported += 1;
  if (e.trace) { eCiteJudged += 1; if (v.citationSupports) eCiteGood += 1; }
  if (!v.coherent) eIncoherent += 1;
});

const out = {
  generatedAt: new Date().toISOString(),
  status: "MEASURED_LIVE_SESSION_AUDIT",
  session: audit.session,
  judge: "claude (cross-family; extractor is gpt-4o-mini, so judge and extractor share no model family)",
  deployedPipeline: "full gate (A5 configuration) as served by the production app",
  corpus: { userTurns: users.length, knowledgeFacts: audit.facts.length, semanticEdges: audit.edges.length },
  deterministic: {
    vertexProvenanceCoverage: prop(grounded, audit.facts.length),
    edgeProvenanceCoverage: prop(eGrounded, audit.edges.length),
    spanRuleHeldVertices: prop(spanOk, grounded),
    spanRuleHeldEdges: prop(eSpanOk, eGrounded),
    duplicateConceptNames: prop(duplicates, audit.facts.length),
    supersededFacts: audit.exportStats.supersededFacts
  },
  judged: {
    factsJudged: judged,
    evidentialFaithfulness: prop(efGood, judged),
    citationCorrectness: prop(citeGood, citeJudged),
    factsWithPaddedProperties: prop(padded, judged),
    paddedPropertyValuesTotal: paddedPropsTotal,
    edgesJudged: eJudged,
    edgeRelationshipSupported: prop(eSupported, eJudged),
    edgeCitationCorrectness: prop(eCiteGood, eCiteJudged),
    edgesSemanticallyIncoherent: prop(eIncoherent, eJudged)
  },
  conversation: verdicts.conversation,
  graphCoherence: {
    incoherentFactCount: verdicts.coherence.incoherentFacts.length,
    bySeverity: verdicts.coherence.incoherentFacts.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc; }, {}),
    summary: verdicts.coherence.summary
  }
};

fs.writeFileSync(path.join("results", "live_session_audit.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out.deterministic, null, 1));
console.log(JSON.stringify(out.judged, null, 1));
console.log("Wrote results/live_session_audit.json");
