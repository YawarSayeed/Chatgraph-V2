# Iteration 07 — System hardening against the live-audit defect inventory

**Date:** 2026-07-23
**Status:** Method complete and tested; **outcome pending** the multi-session
corpus (blocked on OpenAI credit; the user is recording new sessions on the
redeployed build).

## Method

Iteration 06's live audit produced a machine-readable defect inventory
(`iteration-06-defects.json`, D-06-1..5). This iteration converts every defect
into a deployed mechanism, states the associated research claims in
`results/claims.md` (C1–C9), and builds the tooling that will measure the next
corpus turnkey. No measured numbers change in this iteration — `metrics.json`
still carries the iteration-05 run — so no metrics snapshot is frozen here; the
next measured run freezes `iteration-07-metrics.json` (or 08, if numbering has
moved) per the standing rule.

### D-06-1 → identity-consistent id reuse (`lib/gate/gate.ts`)

The blanket "protect any reused id from re-hashing" rule from iteration 05 was
the mutation channel: reusing an existing id for a *different* concept
overwrote the stored vertex ("loyalty program" → "theft"). Now a reused id is
protected only when its content names the same concept as the stored vertex
(exact / ≥0.7 token-overlap / subset match on the declared key property);
otherwise the candidate is de-collided onto its own content-derived id and the
repair is reported (HR009 advisory). Entity resolution also now keys on
schema-declared properties only, so an undeclared property the gate would later
strip can no longer block a merge (the duplicate-"demographic" case).

### D-06-2 → HR026, the cross-turn edge witness rule

Authored in `hopitality files/validation rules.json` (rule 26, hard), bound by
the contract, enforced in the gate: a knowledge-knowledge edge whose endpoints
*both* pre-exist in the graph (neither re-asserted this turn) must carry its own
span-valid evidence, else it is rejected with typed retry feedback. An edge with
a freshly-asserted endpoint is exempt — the endpoint's own evidence witnesses
the turn. Extractor prompt now instructs that edge evidence must quote the span
asserting the *relationship*, not a span naming one endpoint.

### D-06-3 → type-derived assertion-only properties (`lib/gate/prompt.ts`)

The live audit found 58 padded property values (33/57 facts), dominated by
booleans stamped `true`. The contract now exposes each vertex property's
declared value type; the prompt derives the list of optional boolean/integer
properties from the schema itself and instructs: set only when the expert
explicitly asserts that judgment, otherwise omit. Nothing is hand-listed, so
the rule cannot drift from the schema. An echo guard adds: when the expert
merely agrees with the interviewer, extract only what the expert adds.

### D-06-4 → conversation conduct rules (`lib/domains.ts`)

The agent prompt now ends every reply with exactly one question, never answers
its own question or supplies candidate answers (agreement is not the expert's
knowledge), and never speaks its planning aloud. Filler handling moved into a
shared module `lib/filler.ts`: the product skips extraction entirely on filler
turns (no episode, no tokens — the first live session's identity mutations all
occurred on filler turns), and the harness imports the *same* classifier, so
eligible-turn counts stay comparable between product and evaluation.

### D-06-5 → deployment and reproducibility

Episode ids now derive from the message id (`ep:<session>:m<10 hex>`), not a
vertex count, eliminating the concurrent-turn collision that corrupted
iteration 06's episode attribution. The session export remains the harness
corpus format. **The fix requires a redeploy; the 2026-07-22 live session ran a
stale build** (its export predates the research export and carries only the
transcript).

### Retry economics (`lib/server/extract-governed.ts`)

Attempt scoring now subtracts 10 per soft missing-evidence finding, so a
smaller fully-grounded attempt beats a larger flagged one, and a delta that is
clean except for missing evidence gets one soft retry (the flagged attempt is
kept, so a failed retry costs nothing).

### One-click analysis bundle (`lib/export.ts`, added 2026-07-23 after the initial commit)

The download button now produces the complete input set for analysis under one
timestamp: the session export, the human-readable transcript, the audit input
(derived in the browser by the same `lib/audit.ts` the CLI uses), and a **gate
log**. The gate log is new evidence the pipeline previously discarded: every
extraction attempt per turn with its full findings — hard rejections that never
reached the graph, retry feedback echoed to the extractor, HR026 drops,
identity de-collisions, filler skips — plus an aggregate summary (findings by
rule/severity/action, retry counts, proposed-vs-admitted totals). The export
also records which build (commit sha) produced it, so a stale deployment like
D-06-5 is self-identifying in the data.

### Turnkey audit (`scripts/nesy_results/derive_live_audit.mjs`)

`npm run audit:derive <export.json>` now derives the live-audit input
(facts/edges with traces and utterance indices) mechanically from a session
export. Attribution goes through the admitting turn record
(`turns[].userMessageId` → position among user messages), which is
collision-proof; the evidence episode is only a cross-check, with
disagreements and episode-id collisions reported in the output. This automates
the step whose manual execution produced iteration 06's one audit error, and
refuses legacy transcript-only exports with an explanatory message.

## Outcome (this iteration)

- Gate conformance: **50/50 checks pass** (8 new: identity de-collision and
  its same-concept guard, HR026 witnessless/witnessed/exempt, within-delta
  singleton dedup, filler skip, message-id episode ids, schema-derived
  assertion-only list).
- Contract drift: 0 with HR026 added (26 rules bound).
- Frozen replay unchanged: A3 47/48, A5 60/61 per-fact admission.
- Deriver verified end-to-end on a synthetic export, including a deliberate
  episode-id collision, which it detected and attributed correctly.
- Measured corpus numbers: **none this iteration** — pending sessions +
  restored OpenAI credit.

## Reasoning

Iteration 06 established that grounding and coherence are different properties
(span rule 100% while 30% of edges were incoherent). Each mechanism above
targets a specific measured failure population rather than a hunch, and each
carries its falsifiable prediction in `results/claims.md`: padded properties
materially below 57.9%, edge incoherence below 30.0%, edge citation
correctness above 30.0%, no regression in usable-faithful yield. If the next
corpus does not move these numbers, the mechanisms — not the measurements —
are wrong, and that result goes in this folder too.

## Evidence

- Code: `lib/gate/gate.ts`, `lib/gate/contract.ts`, `lib/gate/prompt.ts`,
  `lib/domains.ts`, `lib/filler.ts`, `lib/server/extract-governed.ts`,
  `hopitality files/validation rules.json`.
- Tests: `src/test/js/gate_conformance.mjs` (50 checks).
- Tooling: `scripts/nesy_results/derive_live_audit.mjs`.
- Claims: `results/claims.md`.
