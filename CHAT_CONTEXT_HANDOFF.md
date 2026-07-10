# Chat Context Handoff

This document preserves the working context from the long build/debug session for anyone continuing the project in a new Codespace or a fresh chat.

It is not a full verbatim transcript. It is the practical memory that matters: what we built, what broke, what we fixed, what decisions were made, what is still imperfect, and how to keep working without repeating the same loops.

## Current State

The project is a Next.js browser prototype called chatgraph.

It now supports two parallel use cases:

- Headache / medical interview
- Hospitality expert knowledge-capture interview

Both use cases share the same product workflow:

1. User selects a use case from the dropdown.
2. Assistant opens the interview with the domain-specific first line.
3. User responds by typing, browser dictation, or OpenAI Realtime voice.
4. Assistant asks follow-up questions.
5. A live graph is built beside the transcript.
6. The session can be reset or exported.

The app was tested locally on `http://localhost:3000`. Before the last README/context work, the user had confirmed that the current hospitality version was good enough to deploy, with the understanding that the graph can be improved later.

## Important Product Expectations

The user cares most about these behaviors:

- The first assistant message must be spoken when voice is connected, not only shown in the transcript.
- After speaking the first message, the assistant must wait for the user. It must not assume a reply and continue by itself.
- Assistant transcript entries must appear once, not duplicated.
- Assistant responses must not overlap, stammer, or replace themselves mid-speech.
- The graph should be domain-specific. It should not fill with generic transcript nodes or generic relationships when a schema-specific relationship exists.
- The hospitality use case should work like the headache use case from a product perspective: same interface, same interaction model, different prompt and graph schema.

## Iteration History

### 1. Initial Voice Bug: First Dialogue Was Silent

Original issue:

- The first assistant message appeared in the transcript:
  `Hello. Please tell me what's been bothering you, health-wise.`
- But it was not spoken when live voice connected.
- Voice began only after the user's first reply.

Desired behavior:

- On live voice connect, the already-visible opening line should be spoken aloud.
- Then the app should wait for the user.

Resolution:

- The opening assistant message remains stored as the first session message.
- When Realtime connects, `app/page.tsx` checks whether the session contains only the opening assistant message.
- If so, it speaks that text through the app's TTS helper.
- While that opening line is being spoken, the Realtime assistant is blocked and the microphone is muted.
- When TTS finishes, microphone is unmuted and Realtime assistant responses are unblocked.

Important files:

- `app/page.tsx`
- `lib/realtime.ts`
- `lib/speech.ts`

### 2. Duplicate Assistant Transcript Bug

Original issue:

- The assistant spoke once, but each assistant reply appeared twice in the transcript window.

Likely cause:

- Realtime emitted assistant text through multiple completion-style events.
- The app appended more than one transcript for the same assistant response.

Resolution:

- `lib/realtime.ts` accumulates assistant transcript deltas.
- It emits the final assistant transcript only on `response.done`.
- It deduplicates repeated assistant transcripts by normalized text within a short time window.

Important guard:

```ts
if (normalized === this.lastAssistantTranscript && now - this.lastAssistantTranscriptAt < 2000) {
  return;
}
```

### 3. Overlapping / Multiple Assistant Dialogues

Original issue:

- After the user replied, the assistant sometimes produced one dialogue, then another one for the same user turn.
- The second response interrupted or replaced the first.
- The transcript showed stacked assistant messages for the same turn.

Resolution:

- `lib/realtime.ts` tracks `responseInFlight`.
- If Realtime creates a new response while another response is in flight, the new response is cancelled.
- If assistant responses are blocked during opening-line playback, any response created during that period is also cancelled.

Key idea:

- One user turn should produce one assistant turn.
- Realtime can be eager, but the app must enforce turn boundaries.

### 4. First Turn Deadlock After Fixing Auto-Advance

Original issue after the previous fix:

- The assistant no longer auto-advanced after the opening line.
- But after the user's first reply, the assistant sometimes did not respond until the user spoke a second time.

Resolution:

- The app removed overly strict pending-user-turn gating.
- Realtime is allowed to respond after each finalized user transcript.
- The opening-line block is temporary and only active while TTS plays the first assistant message.

Important principle:

- Block assistant responses only during local playback of the stored opening line.
- Do not keep a global "waiting for user" gate that prevents the first real answer.

### 5. Adding Hospitality As A Parallel Use Case

Goal:

- Add a second use case for interviewing a hospitality expert.
- It should behave like the headache use case in the UI and interaction flow.
- It should have its own prompt, opening line, schema JSON, graph labels, and relationships.

User supplied files:

- `documentation (1).md`
- `ingestion config.json`
- `prompt Hospitality .docx`
- `prompt Hospitality .txt`
- `provenance spec.json`
- `schema hospitality.json`
- `section map.json`
- `validation rules.json`
- A folder named `hospitality files`

Implementation direction:

- Add `src/main/json/hospitality.json`.
- Add Python companion files under `src/main/python/chatgraph/domains/hospitality`.
- Register the domain in `lib/domains.ts`.
- Add a dropdown in the UI for use case selection.
- Store sessions per domain in IndexedDB.
- Give each domain its own opening line, participant label, placeholder text, and graph display config.

Important product copy:

- Headache participant label: `PATIENT`
- Hospitality participant label: `EXPERT`
- Hospitality subtitle: `hospitality knowledge session`
- Hospitality opening line:

```text
Hi, I'll conduct your knowledge session today on hospitality. The purpose of today's session is to extract explicit knowledge, tacit expertise, workflows, heuristics, rules, customer-experience judgment, and system-level insights from your hospitality business experience, so we can build a comprehensive hospitality knowledge base.
```

### 6. Hospitality Graph Did Not Build

Original issue:

- Hospitality conversation worked.
- Graph extraction did not run or did not produce visible graph facts.
- UI showed red warning like `Extractor did not run.`

Diagnosis:

- The initial hospitality schema and extraction prompt did not line up cleanly with runtime schema validation.
- The generic LLM extractor was producing labels, endpoints, or transcript structures that were not useful or valid.

Resolution direction:

- The app now special-cases hospitality in `lib/server/extract.ts`.
- Hospitality extraction uses deterministic fallback rules for the currently important concepts.
- This avoids broad LLM guesses and keeps generated relationships aligned with the schema.

### 7. Hospitality Graph Had Transcript Nodes And Generic Edges

Original issue:

- Graph created many nodes from transcript text.
- Edges included generic relationships like:
  - `hasEpisode`
  - `supportedBy`
  - `appliesToPersona`
- The user wanted graph semantics closer to headache:
  - real concept nodes
  - use-case-specific relationship labels
  - context-aware node labels

Iterative fixes:

- Added explicit hospitality domain vertices such as:
  - `ExpertRole`
  - `HospitalityBusiness`
  - `OperatingTenure`
  - `GuestExperiencePrinciple`
  - `ServiceStandard`
  - `GuestPersona`
  - `DecisionRule`
  - `Outcome`
- Added or emphasized domain-specific hospitality edges:
  - `hasRole`
  - `operatesBusiness`
  - `hasOperatingTenure`
  - `businessDifferentiatedBy`
  - `experienceDesignedFor`
  - `standardDeliveredTo`
  - `standardEnforces`
  - `leadsTo`
- Hid infrastructure labels and edges from display:
  - `KnowledgeSession`
  - `SessionSection`
  - `TranscriptEpisode`
  - `ProvenanceEvidence`
  - `hasSession`
  - `hasSection`
  - `hasEpisode`
  - `discusses`
  - `supportedBy`
  - `principleSupportedBy`
  - `appliesToPersona`

Important nuance:

- Some infrastructure can still exist internally for provenance.
- It should not dominate the visual graph.
- Visible graph should prioritize domain concepts and domain relationships.

### 8. Hospitality Graph Became "Good Enough For Now"

Final user status before this documentation task:

- The hospitality graph was "somewhat better" and then "seems good for now".
- The graph showed domain-specific concepts like:
  - `CEO`
  - `Hotel chain`
  - `10 years`
  - `Customer service`
  - `Hotel guests`
  - `DecisionRule`
  - `Outcome`
- It was accepted for deployment, with the plan to improve graph quality later.

Remaining improvement idea:

- Replace or supplement deterministic hospitality extraction with stricter schema-constrained LLM extraction.
- Keep the deterministic layer as guardrails.
- Continue to suppress generic transcript/provenance clutter from the visible graph.

## Current Mental Model Of The App

### The App Is Now Browser-First

The current deployed app is not the older Python/Gremlin CLI runtime.

Current runtime:

- Next.js app
- React UI
- TypeScript logic
- OpenAI API routes
- Browser IndexedDB
- In-browser SVG graph renderer
- JSON schemas under `src/main/json`

The old Python files still exist and are useful as schema-authoring or legacy context, but the live browser app does not import them.

### The JSON Schemas Are The Runtime Source

The TypeScript app imports:

- `src/main/json/medical.json`
- `src/main/json/hospitality.json`

`lib/schema.ts` reads the schema's vertex and edge definitions and builds runtime allow-lists. It validates graph deltas before merging them into state.

### Domain Registration Is Central

`lib/domains.ts` is the main switchboard.

It decides:

- Which schemas exist
- What labels appear in the dropdown
- Which opening line is used
- Which prompt is used
- Which user label appears in transcript cards
- Which initial graph roots exist
- Which graph labels/edges/text patterns are hidden
- Which graph colors and node sizes are used

### Graph Extraction Is Domain-Specific

`extractGraphDelta` in `lib/server/extract.ts` is the entry point.

- If `domainId === "hospitality"`, it uses deterministic hospitality extraction.
- Otherwise, medical uses the OpenAI tool-call extractor with schema validation and retries.

This split exists because hospitality needed more control to avoid generic graph facts.

## User Preferences And Working Style

The user prefers:

- Direct implementation over long planning.
- Localhost testing before committing/pushing/deploying.
- Fixing one visible issue at a time, then reloading and testing.
- Keeping the product behavior consistent across use cases.
- Practical graph quality over theoretical elegance.
- Normal explanatory mode, not caveman mode. The user explicitly said "normal mode".

When continuing:

- Do not assume the graph is "done forever"; it is accepted for now but expected to improve.
- Preserve headache behavior when changing shared code.
- Be careful with voice turn handling; many bugs came from small changes in Realtime response timing.
- Do not remove the Python files casually. They are not browser runtime files, but they carry schema context and may matter later.

## Checks That Passed Previously

After the latest code fixes before documentation:

```bash
npm run typecheck
npm run lint
npm run build
```

All passed.

Documentation-only changes after that were not checked with build because they do not affect runtime.

## Important Files To Read First In A New Chat

Start here:

1. `README.md`
2. `CHAT_CONTEXT_HANDOFF.md`
3. `TECHNICAL_ARCHITECTURE_DEEP_DIVE.md`
4. `app/page.tsx`
5. `lib/domains.ts`
6. `lib/server/extract.ts`
7. `lib/schema.ts`
8. `lib/realtime.ts`
9. `components/GraphView.tsx`
10. `src/main/json/medical.json`
11. `src/main/json/hospitality.json`

## Deployment Handoff

The project is intended to deploy on Vercel.

Required environment variable:

```bash
OPENAI_API_KEY=...
```

Optional variables:

```bash
CHATGRAPH_AGENT_MODEL=...
CHATGRAPH_EXTRACTOR_MODEL=...
CHATGRAPH_REALTIME_MODEL=...
CHATGRAPH_REALTIME_VOICE=...
CHATGRAPH_TTS_VOICE=...
```

Before deploy:

```bash
npm run typecheck
npm run lint
npm run build
```

Then commit and push to GitHub/Vercel.

## Open Threads For Future Improvement

### Hospitality Extraction Quality

The current deterministic extractor captures important early concepts but is not exhaustive. It should eventually handle all hospitality sections:

- Guest experience principles
- Arrival/check-in/timing
- Checkout rules
- Service recovery
- Exception handling
- Operating heuristics
- Customer psychology
- Loyalty moments
- Contextual constraints
- Staffing/training/system factors

Any expansion must keep the graph schema-specific. Avoid generic edges like `appliesToPersona` when a better edge exists.

### Graph Display Scaling

As the graph grows, the SVG/D3 force layout can get dense. Future improvements could include:

- Filter by section
- Hide/show provenance
- Focus on selected node neighborhood
- Pin roots
- Better label collision handling
- Export as image

### Voice Robustness

Voice is currently usable, but Realtime event timing can be fragile. Be careful when changing:

- `responseInFlight`
- `assistantResponsesBlocked`
- first-message TTS flow
- mic mute/unmute timing
- transcript deduplication

### Session Model

Sessions are stored in IndexedDB per domain. There is no server-side database or authentication.

Future production work may need:

- user accounts
- server persistence
- multi-session selection
- audit logs
- privacy controls
- health-data compliance review for medical use

## One-Sentence Summary

chatgraph is now a two-domain Next.js prototype where domain-specific interviews produce live schema-constrained graphs; the key hard-won fixes are first-message voice playback, Realtime turn control, transcript deduplication, use-case switching, and a hospitality extractor/display setup that avoids most generic transcript graph clutter.
