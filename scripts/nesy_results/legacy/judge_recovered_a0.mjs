import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, "results", "cache", "real-ablation");
const CONDITION = process.argv[2] ?? "A0";

function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function readRows() {
  return fs.readFileSync(path.join(ROOT, "results", "raw", `${CONDITION}.jsonl`), "utf8").trim().split("\n").map(JSON.parse).filter((row) => !row.excluded_as_filler);
}

async function main() {
  loadEnv();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is unavailable");
  const items = [];
  for (const row of readRows()) for (const fact of row.admitted_facts.filter((item) => item.kind === "edge")) {
    items.push({ id: `${row.utterance_id}:${fact.id}`, source: row.source_utterance, subject: fact.subject, relation: fact.relation, object: fact.object });
  }
  if (!items.length) throw new Error(`${CONDITION} has no admitted edges to judge`);
  const key = crypto.createHash("sha256").update(`judge-recovered-${CONDITION}-v1:${JSON.stringify(items)}`).digest("hex");
  const file = path.join(CACHE, `${key}.json`);
  if (fs.existsSync(file)) { console.log(`Using ${path.relative(ROOT, file)}`); return; }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const started = performance.now();
  const response = await openai.chat.completions.create({
    model: "gpt-4o", temperature: 0, response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Judge each graph edge against its expert utterance. Return JSON {verdicts:[{id,subject_supported,object_supported,reason}]}. Mark a concept supported when stated or clearly referred to by ordinary coreference. Return one verdict for every input id." },
      { role: "user", content: JSON.stringify(items) }
    ]
  });
  const payload = { response, latencyMs: Math.round(performance.now() - started), purpose: `${CONDITION} independent grounding judgment` };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  const parsed = JSON.parse(response.choices[0].message.content);
  if ((parsed.verdicts ?? []).length !== items.length) throw new Error(`Judge returned ${parsed.verdicts?.length ?? 0}/${items.length} verdicts`);
  console.log(`Wrote ${path.relative(ROOT, file)} with ${items.length} verdicts.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
