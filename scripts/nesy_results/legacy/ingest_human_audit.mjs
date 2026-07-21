import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESULTS = path.join(ROOT, "results");
const COMPLETED = path.join(RESULTS, "audit_completed");
const ALLOWED = new Set(["yes", "no", "unclear"]);
const UNMEASURED = "UNMEASURED";

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  if (!lines.length) throw new Error("CSV is empty");
  const rows = lines.map(parseLine);
  const header = rows.shift();
  return rows.map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""])));
}

function parseLine(line) {
  const cells = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { cells.push(current); current = ""; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

function validateRows(rows, expectedIds, name) {
  const byId = new Map();
  for (const row of rows) {
    const id = row.fact_id;
    const verdict = String(row.human_verdict ?? "").trim().toLowerCase();
    if (!expectedIds.has(id)) throw new Error(`${name}: unknown fact_id ${id}`);
    if (!ALLOWED.has(verdict)) throw new Error(`${name}: ${id} must be yes, no, or unclear`);
    if (byId.has(id)) throw new Error(`${name}: duplicate fact_id ${id}`);
    byId.set(id, verdict);
  }
  if (byId.size !== expectedIds.size) throw new Error(`${name}: expected ${expectedIds.size} rows, found ${byId.size}`);
  return byId;
}

function kappa(left, right, ids) {
  const labels = [...ALLOWED];
  let agreement = 0;
  const leftCounts = Object.fromEntries(labels.map((label) => [label, 0]));
  const rightCounts = Object.fromEntries(labels.map((label) => [label, 0]));
  for (const id of ids) {
    const a = left.get(id); const b = right.get(id);
    if (a === b) agreement += 1;
    leftCounts[a] += 1; rightCounts[b] += 1;
  }
  const n = ids.length;
  const observed = agreement / n;
  const expected = labels.reduce((sum, label) => sum + (leftCounts[label] / n) * (rightCounts[label] / n), 0);
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

function summarizeAdjudicated(verdicts, key) {
  const conditions = {};
  for (const [id, verdict] of verdicts) {
    const condition = key.rows[id].condition;
    const row = conditions[condition] ?? { yes: 0, no: 0, unclear: 0 };
    row[verdict] += 1; conditions[condition] = row;
  }
  for (const row of Object.values(conditions)) {
    const denominator = row.yes + row.no;
    row.EF = denominator ? `${(100 * row.yes / denominator).toFixed(1)}%` : UNMEASURED;
    row.EF_count = `${row.yes}/${denominator}`;
  }
  return conditions;
}

function selfTest() {
  const ids = ["a", "b", "c", "d"];
  const left = new Map([["a", "yes"], ["b", "yes"], ["c", "no"], ["d", "unclear"]]);
  const right = new Map([["a", "yes"], ["b", "no"], ["c", "no"], ["d", "unclear"]]);
  const value = kappa(left, right, ids);
  if (Math.abs(value - 0.6363636364) > 1e-8) throw new Error(`Kappa self-test failed: ${value}`);
  const summary = summarizeAdjudicated(left, { rows: Object.fromEntries(ids.map((id) => [id, { condition: "A0" }])) });
  if (summary.A0.EF !== "66.7%" || summary.A0.unclear !== 1) throw new Error("EF self-test failed");
  console.log("Human-audit ingestion self-test passed.");
}

function findFile(names) {
  return names.map((name) => path.join(COMPLETED, name)).find((file) => fs.existsSync(file));
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const key = JSON.parse(fs.readFileSync(path.join(RESULTS, "audit_key.json"), "utf8"));
  const expectedIds = new Set(Object.keys(key.rows));
  const aFile = findFile(["annotator_A.csv", "human_audit_annotator_A.csv"]);
  const bFile = findFile(["annotator_B.csv", "human_audit_annotator_B.csv"]);
  const adjudicatedFile = findFile(["adjudicated.csv", "human_audit_adjudicated.csv"]);
  if (!aFile || !bFile || !adjudicatedFile) {
    const pending = { status: "pending", cohensKappa: UNMEASURED, EF: UNMEASURED, expectedDirectory: "results/audit_completed", requiredFiles: ["annotator_A.csv", "annotator_B.csv", "adjudicated.csv"] };
    fs.mkdirSync(COMPLETED, { recursive: true });
    fs.writeFileSync(path.join(RESULTS, "human_audit_metrics.json"), `${JSON.stringify(pending, null, 2)}\n`);
    console.log("Human audit remains pending; wrote results/human_audit_metrics.json.");
    return;
  }
  const a = validateRows(parseCsv(fs.readFileSync(aFile, "utf8")), expectedIds, "annotator A");
  const b = validateRows(parseCsv(fs.readFileSync(bFile, "utf8")), expectedIds, "annotator B");
  const adjudicated = validateRows(parseCsv(fs.readFileSync(adjudicatedFile, "utf8")), expectedIds, "adjudicated");
  const output = {
    status: "complete", rows: expectedIds.size,
    cohensKappa: Number(kappa(a, b, [...expectedIds]).toFixed(3)),
    kappaBasis: "Two annotators' pre-adjudication yes/no/unclear labels.",
    conditions: summarizeAdjudicated(adjudicated, key),
    EFDefinition: "yes / (yes + no); unclear excluded and reported separately."
  };
  fs.writeFileSync(path.join(RESULTS, "human_audit_metrics.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Human audit ingested: kappa=${output.cohensKappa}`);
}

main();
