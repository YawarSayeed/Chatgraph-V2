# Iteration 06 — First deployed-product trial: findings and pre-corpus fixes

**Date:** 2026-07-22
**Metrics snapshot:** pending — this iteration's measured run happens when the
multi-session trial corpus is collected. This file records the deployed trial's
findings and the fixes made before that corpus is built, so the causal chain from
observation to change stays auditable.

## Method: a live trial on the deployed app

One voice-mode hospitality session was run against the production deployment
(chatgraph-v2.vercel.app) by the project owner acting as expert. Artifacts: the
exported transcript and seven UI screenshots. Five defect classes were observed.

## Findings from the trial

### 1. The interview stalled until the expert said "continue" — and then the agent skipped its own question

Transcript: the agent asked "What would you say makes the business especially
successful?"; the session went silent; the expert typed "Continue"; the agent
treated that as an answer and moved on to the *next* scripted item, only asking
the skipped question again later by luck.

**Root cause (stall):** the OpenAI Realtime server auto-creates a response on
voice-activity detection, but the user-transcript event arrives *after* that
auto-response starts. The client's gating logic, seeing a response with no
pending transcript, cancelled it — cancelling legitimate answers. The
subsequent "Cancellation failed: no active response found" errors visible in the
UI were the same race from the other side: cancels landing after the response
had already finished.

**Fix (architectural):** the server no longer creates responses at all
(`create_response: false`); the client's transcript-settle logic is the only
requester. The cancel war is structurally impossible now, not patched. Harmless
"no active response" bookkeeping errors are logged, not shown to the expert.

**Root cause (skip):** the agent prompt handled "continue" only in the
section-transition case. Fixed: "continue" without an answer re-asks the pending
question; filler is never treated as an answer.

### 2. The agent answered mid-sentence fragments

"All that needs to be done in a" and "And apart from that" were answered as if
complete. **Root causes:** default VAD eagerness ends turns at natural pauses,
and the 700 ms transcript-settle window was shorter than a thinking pause.
**Fixes:** `eagerness: "low"`, settle window 1200 ms (fragments that resume
merge into one turn), and an agent-prompt rule to ask the expert to finish a
visibly cut-off thought rather than answer it.

### 3. The graph read as generic and disconnected

Four distinct causes, from screenshots:

- **Nodes captioned with their type** ("DecisionRule"): the display's naming
  logic predated the hospitality schema and did not know `ruleText`,
  `heuristic`, or `standardText`. It now uses the same `keyText` priority the
  gate itself resolves identity with — one naming convention everywhere.
- **12-character label truncation** made even well-named nodes cryptic
  ("Understandi…"). Now 24 characters with a wider label pill.
- **Near-duplicate concepts survived** ("Body Language Cues" vs "body
  language"): Jaccard 0.67 missed the 0.6→ threshold ordering… investigating
  exposed a *latent false-merge* instead: at threshold 0.6, "early check policy
  applies" and "late check policy applies" (3 of 4 tokens shared) would merge.
  Fix: threshold raised to 0.7 **plus** a subset-containment rule — a name fully
  contained in an existing name (≥2 matched tokens) is the same concept. Both
  the trial's dupes and the opposite-qualifier guard are now unit-tested.
- **Isolated vertices**: the extractor emitted few semantic edges. The
  connectivity instruction was strengthened from "should carry" to a MUST with
  the reuse-existing-ids path spelled out. Connectivity will be *measured* in
  the iteration-06 run (grounded semantic edges and isolated-vertex counts are
  now in the session export's stats block).

### 4. The download was a transcript, not data

The export was the raw session object; per-turn extraction results were not even
recorded client-side. Now every extracted turn is recorded
(`ChatSession.turnRecords`) and the download produces `chatgraph-session/v1`:
transcript, **per-dialogue admitted deltas with warnings**, the full graph, a
knowledge view (each fact with its evidence quote, confidence, source episode,
and relations with *their* citations), and summary stats including grounded-edge
and superseded-fact counts. The top level keeps `domainId` + `messages`, so the
same file drops into `data/session/` as harness corpus unchanged.

## Judgment on the "below par numbers" hypothesis

The owner's hypothesis — that product defects, not the gate, depress the
numbers — is partially supported by this trial. The voice-loop race discarded
or fragmented expert answers (lost knowledge before extraction ever ran), and
weak edge emission left knowledge unconnected (each isolated vertex forfeits the
edge facts that carry relationship knowledge). Neither defect is visible to the
ablation, which replays clean text turns. The corpus built after these fixes
should carry more complete turns and denser relation structure; whether that
moves EF/citation quality is an empirical question for the iteration-06 run.

## Evidence

- Trial transcript and screenshots: supplied by the owner (verbatim content not
  committed, per privacy rules).
- Fixes: `app/api/realtime/token/route.ts`, `lib/realtime.ts` (voice loop);
  `lib/domains.ts` (agent + extractor prompts); `components/GraphView.tsx`
  (naming, labels); `lib/gate/gate.ts` (resolution threshold + subset rule);
  `lib/export.ts`, `lib/types.ts`, `lib/storage.ts`, `app/page.tsx` (turn
  records + research export). Conformance suite: 42 checks.
- **Deployment note:** these fixes are local; the Vercel deployment must be
  updated before the next trial or the trial re-tests the old build.
