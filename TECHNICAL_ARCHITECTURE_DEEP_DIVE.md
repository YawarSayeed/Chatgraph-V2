# Technical Architecture Deep Dive

> **SUPERSEDED (2026-07-21).** This document describes an earlier iteration and is kept
> for history. Hospitality extraction is no longer keyword-based; both domains now run an
> LLM extractor behind the symbolic gate in `lib/gate/`. For current behaviour see
> `README.md`, `IN_DEPTH_ARCHITECTURE.md` (read its amendment header first), and
> `results/results.md` for measured evaluation numbers.


This document explains the current chatgraph architecture in detail for a developer continuing the project in a new Codespace or a fresh chat.

It focuses on the actual browser app that exists now, not the older Python/Gremlin CLI architecture described by some legacy files.

## High-Level System

chatgraph is a Next.js application that runs an interview UI and builds a live graph from user answers.

The system has four main runtime responsibilities:

1. Run a domain-specific conversation.
2. Capture user turns through typing, browser dictation, or OpenAI Realtime voice.
3. Extract graph facts from each user turn.
4. Render the evolving graph in the browser.

The current runtime does not require Gremlin Server or a server-side graph database. The graph lives in browser session state and IndexedDB.

## Runtime Stack

From `package.json`:

- `next`: app framework
- `react` and `react-dom`: UI
- `typescript`: static types
- `openai`: OpenAI API client
- `d3-force`: graph layout simulation
- `lucide-react`: toolbar icons
- `react-force-graph-2d`: installed dependency, but the current graph view is a custom SVG renderer in `components/GraphView.tsx`
- `@anthropic-ai/sdk`: installed legacy/unused dependency in the current browser path

Main scripts:

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

## Runtime File Map

```text
app/
  api/
    chat/route.ts
    extract/route.ts
    realtime/token/route.ts
    tts/route.ts
  globals.css
  layout.tsx
  page.tsx

components/
  GraphView.tsx

lib/
  domains.ts
  export.ts
  prompts.ts
  realtime.ts
  schema.ts
  server/extract.ts
  speech.ts
  storage.ts
  types.ts

src/main/json/
  medical.json
  hospitality.json

src/main/python/chatgraph/
  ...
```

## Core Data Types

The shared app types live in `lib/types.ts`.

The important conceptual types are:

- `DomainId`: currently `medical` or `hospitality`.
- `ChatMessage`: one transcript message.
- `ChatSession`: active domain, messages, graph, and settings.
- `GraphVertex`: a property-graph vertex.
- `GraphEdge`: a property-graph edge.
- `GraphState`: full current graph.
- `GraphDelta`: incremental graph update extracted from a turn.
- `ChatRequest`: API request payload containing messages, domain id, and current graph.
- `ChatResponse`: assistant message plus graph delta and warnings.

The app is intentionally simple: there is no server-side session table. The browser owns the current `ChatSession`.

## Domain System

Domain configuration lives in `lib/domains.ts`.

Each domain config includes:

- `id`: stable domain id.
- `label`: dropdown label.
- `subtitle`: header subtitle.
- `openingLine`: first assistant message.
- `composerPlaceholder`: input placeholder.
- `userLabel`: displayed speaker label for user messages.
- `agentPrompt`: system prompt for assistant generation.
- `extractorIntro`: prompt guidance for graph extraction.
- `schema`: imported JSON graph schema.
- `initialVertices`: graph roots for a new session.
- `initialEdges`: optional root edges.
- `graphDisplay`: display configuration for graph renderer.

### Medical Domain

Runtime schema:

```text
src/main/json/medical.json
```

Prompt source:

```text
lib/prompts.ts
```

Initial graph:

- `Person:patient` with label `Person`

Display override:

- `Person` is shown as `Patient`

The medical extractor uses OpenAI tool calling and `sanitizeDelta`.

### Hospitality Domain

Runtime schema:

```text
src/main/json/hospitality.json
```

Prompt source:

```text
lib/domains.ts
```

Initial graph:

- `person:expert` with label `Person`
- `session:hospitality:default` with label `KnowledgeSession`
- `person:expert --hasSession--> session:hospitality:default`

Display override:

- `Person` is shown as `Expert`
- `KnowledgeSession` is shown as `Session`

Hidden from graph display:

- `KnowledgeSession`
- `SessionSection`
- `TranscriptEpisode`
- `ProvenanceEvidence`
- infrastructure edges like `hasSession`, `hasSection`, `hasEpisode`, `discusses`, `supportedBy`, `principleSupportedBy`, and old generic `appliesToPersona`

The hospitality extractor is deterministic in `lib/server/extract.ts`.

## Schema System

Runtime schemas are JSON files:

```text
src/main/json/medical.json
src/main/json/hospitality.json
```

`lib/schema.ts` converts these JSON schemas into runtime specs.

### Schema Runtime Cache

`schemaRuntime(domain)` builds and caches:

- `vertexSpecs`: map from vertex label to allowed properties.
- `edgeSpecs`: map from edge label to allowed endpoint labels and properties.

The cache key is `domain.id`.

### Empty Graph

`emptyGraph(domainId)`:

1. Loads the domain config.
2. Copies `domain.initialVertices`.
3. Copies `domain.initialEdges`.
4. Returns a `GraphState`.

This is used by new/reset sessions.

### Schema Reference

`schemaReference(domainId)` returns a text list of:

- vertex labels and allowed properties
- edge labels, source labels, target labels, and allowed properties

Medical extraction uses this text in retry feedback so the model can correct invalid labels and edges.

### Graph Summary

`graphSummary(graph)` creates a text summary of current vertices and edges.

Medical extraction sends this to the extractor prompt so it can reuse existing ids instead of duplicating facts.

### Merge Delta

`mergeDelta(graph, delta)`:

- Upserts vertices by id.
- Merges vertex properties with existing properties.
- Upserts edges by id.
- Merges edge properties with existing properties.

This makes deterministic ids important. If the same id is emitted again, the existing graph is updated instead of duplicated.

### Sanitize Delta

`sanitizeDelta(input, graph, domainId)` is the schema gate.

It:

- rejects non-object input
- rejects non-object vertices/edges
- rejects vertices without id or label
- rejects unknown vertex labels
- filters vertex properties to schema-allowed keys
- builds a label lookup from existing graph plus accepted new vertices
- rejects unknown edge labels
- rejects edges whose endpoints do not match the schema's source/target labels
- filters edge properties to schema-allowed keys
- generates a fallback edge id when needed

This function is why the extractor must emit exact schema labels and directions.

## Conversation UI

Main file:

```text
app/page.tsx
```

`Home()` is a client component.

Important state:

- `session`: current `ChatSession`
- `selectedDomainId`: selected use case
- `input`: composer text
- `isSending`: text chat request in progress
- `isListening`: browser speech recognition in progress
- `speechAvailable`: whether browser speech recognition exists
- `realtimeStatus`: `idle`, `connecting`, or `connected`
- `warnings`: graph/voice warning strip text

Important refs:

- `recognitionRef`: browser speech recognition instance
- `realtimeRef`: `OpenAIRealtimeSession`
- `sessionRef`: current session mirror for async callbacks
- `bottomRef`: scroll target

### Session Loading

When `selectedDomainId` changes:

1. `setSession(null)` shows the loading panel.
2. `loadSession(selectedDomainId)` reads IndexedDB.
3. If no saved session exists, it returns `defaultSession(domainId)`.

When `session` changes:

1. `saveSession(session)` writes to IndexedDB.
2. `sessionRef.current` is updated for realtime callbacks.

### Text Submit Flow

`submit(text)`:

1. Trims text.
2. Rejects empty text or concurrent sends.
3. Creates a user message.
4. Optimistically appends it to the session.
5. Sends POST `/api/chat` with:
   - `messages`
   - `domainId`
   - `graph`
6. Receives:
   - assistant message
   - graph delta
   - warnings
7. Merges graph delta.
8. Appends assistant message.
9. Speaks assistant message if `autoSpeak` is enabled.

Failure behavior:

- Appends a fallback assistant message:
  `I couldn't reach the assistant service. Please try again in a moment.`

### Voice Transcript Extraction Flow

`extractVoiceTurn(text, baseSession)`:

1. Sends POST `/api/extract`.
2. Includes the voice transcript text, messages, domain id, and graph.
3. Receives graph delta and warnings.
4. Merges graph delta into the latest session.
5. Shows warnings if no graph delta was produced.

This is separate from `/api/chat` because Realtime handles assistant generation directly. The app only needs graph extraction for voice user turns.

### Domain Switch Flow

`changeDomain(domainId)`:

1. Ignores invalid or same domain ids.
2. Stops Realtime.
3. Stops local speech playback.
4. Clears warnings/input.
5. Resets realtime status.
6. Updates selected domain.

The domain dropdown is disabled while Realtime is active or a text request is sending.

### Reset Flow

`reset()`:

1. Stops Realtime.
2. Clears Realtime ref.
3. Stops local speech.
4. Clears warnings/input.
5. Calls `clearSession(selectedDomainId)`.
6. Sets the new default session.

## Session Storage

File:

```text
lib/storage.ts
```

Storage uses IndexedDB:

- database: `chatgraph-browser`
- version: `1`
- object store: `sessions`

Session key:

```text
default:<domainId>
```

This means medical and hospitality sessions persist separately in the same browser.

`defaultSession(domainId)` creates:

- the opening assistant message
- the domain's empty graph
- settings:
  - `voiceEnabled: true`
  - `autoSpeak: true`

## API Routes

### `/api/chat`

File:

```text
app/api/chat/route.ts
```

Purpose:

- Generate assistant response for typed chat.
- Extract graph delta for latest user message.

Important settings:

- `runtime = "nodejs"`
- `dynamic = "force-dynamic"`
- `maxDuration = 60`
- default agent model: `gpt-4o`
- override with `CHATGRAPH_AGENT_MODEL`

Flow:

1. Validate `OPENAI_API_KEY`.
2. Parse `ChatRequest`.
3. Find latest user message.
4. Load domain config.
5. Run assistant generation and graph extraction in parallel:
   - `runAgent(...)`
   - `extractGraphDelta(...)`
6. Return assistant message, delta, and warnings.

`runAgent(...)`:

- filters the transcript so it begins at the first user message
- sends the last 14 user/assistant messages
- uses the domain's `agentPrompt`
- caps response tokens at 420

### `/api/extract`

File:

```text
app/api/extract/route.ts
```

Purpose:

- Extract graph delta from a voice user transcript.
- Does not generate assistant text.

Flow:

1. Validate `OPENAI_API_KEY`.
2. Parse request.
3. Require `text`, `messages`, and graph vertices.
4. Call `extractGraphDelta(openai, body.text, body)`.
5. Return delta and warnings.

### `/api/realtime/token`

File:

```text
app/api/realtime/token/route.ts
```

Purpose:

- Create an ephemeral OpenAI Realtime client secret for browser WebRTC.

Expected behavior:

- Uses `OPENAI_API_KEY`.
- Uses domain id to apply the correct realtime instructions.
- Returns client secret shape accepted by `lib/realtime.ts`.

### `/api/tts`

File:

```text
app/api/tts/route.ts
```

Purpose:

- Generate spoken audio for assistant text outside a full Realtime response.
- Used for the stored opening line and auto-speak fallback.

Expected behavior:

- Uses OpenAI TTS.
- Voice can be configured with `CHATGRAPH_TTS_VOICE`.

## Realtime Voice

File:

```text
lib/realtime.ts
```

`OpenAIRealtimeSession` wraps the browser WebRTC connection to OpenAI Realtime.

### Start Flow

`start()`:

1. Sets status to `connecting`.
2. Fetches `/api/realtime/token?domain=<domainId>`.
3. Extracts the client secret.
4. Creates an `RTCPeerConnection`.
5. Creates an autoplay audio element.
6. Requests microphone audio with `navigator.mediaDevices.getUserMedia`.
7. Adds mic tracks to the peer connection.
8. Creates data channel `oai-events`.
9. Creates local SDP offer.
10. POSTs the SDP to `https://api.openai.com/v1/realtime/calls`.
11. Applies remote SDP answer.

### Stop Flow

`stop()`:

- closes channel and peer
- stops mic tracks
- clears audio source
- clears transcript buffers
- resets response guards
- sets status to `idle`

### Event Handling

Important event types:

- `conversation.item.input_audio_transcription.completed`
  - emits user transcript to the app
- `response.created`
  - starts assistant response guard
  - cancels response if blocked or already in flight
- `response.output_audio_transcript.delta`
  - accumulates assistant transcript
- `response.output_text.delta`
  - accumulates assistant transcript
- `response.output_audio_transcript.done`
  - finalizes assistant transcript text
- `response.output_text.done`
  - finalizes assistant transcript text
- `response.content_part.done`
  - fallback final text source
- `response.done`
  - emits assistant transcript if response completed and not blocked

### Important Voice Guards

`assistantResponsesBlocked`:

- Used while the app is locally speaking the stored opening line.
- Any Realtime assistant response created during this period is cancelled.

`responseInFlight`:

- Prevents overlapping assistant responses.
- If a second response is created while one is active, it is cancelled.

Duplicate transcript guard:

- `lastAssistantTranscript`
- `lastAssistantTranscriptAt`
- suppresses same normalized assistant text within two seconds.

These guards came from hard-won debugging. Do not remove casually.

## First Spoken Opening Line

This behavior is implemented in `app/page.tsx` inside `toggleRealtime()`.

When Realtime connects:

1. The app checks whether the current session has exactly one assistant message.
2. If so, that message is the domain opening line.
3. The app blocks Realtime assistant responses.
4. The app mutes the microphone.
5. The app speaks the opening line through `speak(...)`.
6. After TTS finishes, it unmutes the microphone.
7. It unblocks Realtime assistant responses.

This prevents two previous bugs:

- opening line visible but silent
- assistant auto-advancing before the user answers

## Speech Helpers

File:

```text
lib/speech.ts
```

Responsibilities:

- Detect browser speech recognition support.
- Create a speech recognition instance for single-turn dictation.
- Speak text through the app's TTS endpoint.
- Stop current spoken audio.

There are two voice paths:

- Browser dictation button: one-off speech-to-text then text `/api/chat`.
- Realtime voice button: full duplex OpenAI Realtime session.

## Graph Extraction

File:

```text
lib/server/extract.ts
```

Entry point:

```ts
extractGraphDelta(openai, latestText, body)
```

### Medical Extraction

Medical uses:

- OpenAI chat completions
- function/tool call named like graph delta emission
- schema reference in prompt
- current graph summary in prompt
- retries up to 3 attempts
- `sanitizeDelta` feedback after failed validation

The goal is flexible schema-aware extraction.

### Hospitality Extraction

Hospitality currently bypasses the generic LLM extractor:

```ts
if (body.domainId === "hospitality") {
  return { delta: hospitalityFallbackDelta(latestText, body), warnings: [] };
}
```

Reason:

- The LLM extractor created generic transcript nodes and weak relationships.
- Deterministic extraction gives more reliable domain-specific graph facts for the current demo.

The hospitality fallback currently handles:

- non-knowledge/filler filtering
- profile/role/business/tenure extraction
- service or customer-experience concept extraction
- guest persona creation
- service standard creation
- decision rule creation
- outcome creation
- provenance support

Important generated concepts:

- `ExpertRole`
- `HospitalityBusiness`
- `OperatingTenure`
- `GuestExperiencePrinciple`
- `GuestPersona`
- `DecisionRule`
- `ServiceStandard`
- `Outcome`
- `ProvenanceEvidence`
- `TranscriptEpisode`
- `SessionSection`

Important visible relationships:

- `hasRole`
- `operatesBusiness`
- `hasOperatingTenure`
- `businessDifferentiatedBy`
- `experienceDesignedFor`
- `standardDeliveredTo`
- `standardEnforces`
- `leadsTo`

Important hidden/provenance relationships:

- `hasSection`
- `hasEpisode`
- `discusses`
- `discussesRule`
- `supportedBy`
- `principleSupportedBy`

### Deterministic IDs

The extractor uses deterministic ids such as:

- `role:ceo`
- `business:hotel-chain`
- `tenure:10-years`
- `persona:hotel-guests`
- `principle:<slug>`
- `standard:<slug>`
- `rule:<slug>`

Deterministic ids let `mergeDelta` update instead of duplicate nodes.

## Graph Rendering

File:

```text
components/GraphView.tsx
```

The graph renderer:

- receives `graph` and optional `display` config
- filters hidden labels and hidden edges
- filters nodes matching hidden text patterns
- builds D3 force nodes and links
- renders as SVG
- supports drag/pan/zoom interaction
- uses label overrides, colors, and radii from the domain config
- shows graph counts above the canvas

The visible graph can differ from the stored graph. This is intentional. Provenance/session nodes can remain in the data while being hidden from the user-facing visualization.

## Export

File:

```text
lib/export.ts
```

The export button calls:

- `exportTranscriptTxt(session)`
- `exportTranscriptJsonl(session)`
- `exportSessionJson(session)`

This gives:

- human-readable transcript
- machine-readable transcript
- full session including graph

## Styling

File:

```text
app/globals.css
```

The UI has:

- two-pane workspace
- left conversation card
- right graph card
- top toolbar
- message bubbles
- fixed composer
- warning strip
- responsive layout behavior

The visual style is intentionally quiet and operational, not a marketing page.

## Python Files

There are still Python files under:

```text
src/main/python/chatgraph
```

They include older chat runtime modules:

- `chat/agent.py`
- `chat/audio.py`
- `chat/extractor.py`
- `chat/graph_writer.py`
- `chat/main.py`
- `chat/stt.py`
- `chat/transcript.py`
- `chat/tts.py`
- `chat/validation.py`

They also include domain authoring files:

- `domains/medical/schema_build.py`
- `domains/medical/agent_prompt.py`
- `domains/medical/extractor_prompt.py`
- `domains/hospitality/schema_build.py`
- `domains/hospitality/agent_prompt.py`
- `domains/hospitality/extractor_prompt.py`

Current browser runtime does not import these Python files.

Do not delete them casually because:

- they document earlier architecture
- they may be useful for schema generation
- they preserve domain prompt/schema intent
- the user asked whether they were still required, and the answer was: they are not runtime-critical for the browser app, but they are still useful and should stay for now

## Environment Variables

Required:

```bash
OPENAI_API_KEY=...
```

Optional:

```bash
CHATGRAPH_AGENT_MODEL=...
CHATGRAPH_EXTRACTOR_MODEL=...
CHATGRAPH_REALTIME_MODEL=...
CHATGRAPH_REALTIME_VOICE=...
CHATGRAPH_TTS_VOICE=...
```

Defaults observed in code:

- assistant text route default: `gpt-4o`
- extractor default: `gpt-4o-mini`
- Realtime and TTS defaults should be checked in their API route files before changing deployment config

## Adding A New Domain

The expected route for a new domain:

1. Add `src/main/json/<domain>.json`.
2. Add a `DomainId` union member in `lib/types.ts`.
3. Add domain config in `lib/domains.ts`.
4. Add opening line, assistant prompt, and extractor intro.
5. Define initial graph roots.
6. Add display colors/radii/hidden infrastructure.
7. Add extraction behavior in `lib/server/extract.ts`.
8. Confirm `sanitizeDelta` accepts the emitted edges.
9. Test typed chat.
10. Test live voice.
11. Test reset and domain switch.
12. Test export.

Key rule:

The schema and extractor must agree on exact labels and exact edge directions.

If the schema says:

```text
hasRole: Person -> ExpertRole
```

then the extractor must emit:

```json
{
  "label": "hasRole",
  "out": "person:expert",
  "in": "role:ceo"
}
```

If direction or label is wrong, `sanitizeDelta` drops the edge.

## Known Fragile Areas

### Realtime Event Ordering

Small changes in `lib/realtime.ts` can recreate old bugs:

- first line not spoken
- assistant speaks second dialogue without user input
- assistant does not respond to first real user input
- duplicate assistant transcript
- overlapping responses

Keep these guards:

- `assistantResponsesBlocked`
- `responseInFlight`
- response cancellation
- duplicate transcript suppression
- local opening-line TTS mic mute/unmute

### Hospitality Graph Semantics

The current deterministic extractor is good enough for the demo but incomplete.

When improving it:

- prefer domain-specific edges over generic ones
- hide provenance clutter
- avoid full-transcript node labels
- use short semantic node names
- keep deterministic ids
- test with actual spoken phrases, including imperfect transcription

### Shared Code Changes

Changes in shared files can affect both use cases:

- `app/page.tsx`
- `lib/realtime.ts`
- `lib/schema.ts`
- `components/GraphView.tsx`
- `lib/storage.ts`

Always sanity-test both:

- Headache / medical
- Hospitality expert

## Recommended Debug Workflow

1. Run local server:

```bash
npm run dev
```

2. Open:

```text
http://localhost:3000
```

3. Test text flow first.
4. Reset session.
5. Test live voice.
6. Watch transcript for duplicates.
7. Watch graph counts and edges.
8. Switch domains and repeat.
9. Run checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Current Acceptance Level

As of the latest user confirmation:

- Hospitality use case works well enough to deploy.
- Graph construction is acceptable for now.
- Future work can improve hospitality extraction quality.
- README has been updated to match the current app.
- This handoff and architecture doc were created specifically because the user is moving the code to another Codespace.

## Fast Context For A New Assistant

If a new assistant only has five minutes:

1. This is a Next.js app, not the old Python runtime.
2. Main UI is `app/page.tsx`.
3. Domain switchboard is `lib/domains.ts`.
4. Runtime schemas are `src/main/json/*.json`.
5. Schema validation/merge is `lib/schema.ts`.
6. Graph extraction is `lib/server/extract.ts`.
7. Realtime voice is `lib/realtime.ts`.
8. Graph rendering is `components/GraphView.tsx`.
9. Preserve first-message voice playback and Realtime anti-overlap guards.
10. Hospitality graph quality depends on deterministic extraction plus domain-specific schema edges.
