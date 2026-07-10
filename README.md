# chatgraph

chatgraph is a browser-based prototype for guided interviews that build a live knowledge graph as the conversation unfolds.

The app pairs a conversational assistant with a graph extractor. The assistant asks domain-specific follow-up questions, while the extractor turns the user's answers into typed vertices and edges. The result is a transcript on the left and a live graph on the right, updating turn by turn.

Current use cases:

- **Headache / medical**: a medical-style interview focused on headache symptoms, location, pain character, frequency, triggers, and related clinical context.
- **Hospitality expert**: a knowledge-capture interview for hospitality operators, focused on role, business type, operating tenure, service standards, guest experience principles, decision rules, practices, outcomes, and evidence.

This is a demo/prototype. It is not a medical device, not clinical advice, and not production hardened for sensitive data.

## Product Overview

chatgraph is designed to make domain knowledge visible while it is being collected.

Instead of storing only a plain transcript, each user answer is interpreted against a domain schema. Important concepts become graph nodes, and relationships become graph edges. For example:

- In the headache use case, a patient can report headaches, describe forehead location, and characterize pain as sharp. The graph can connect `Patient -> reports -> Headache`, `Headache -> locatedAt -> forehead`, and `Headache -> classifiedAs -> migraine`.
- In the hospitality use case, an expert can say they are a CEO, run a hotel chain, have operated for 10 years, and succeed through customer service. The graph can connect `Expert -> hasRole -> CEO`, `Expert -> operatesBusiness -> Hotel chain`, `Expert -> hasOperatingTenure -> 10 years`, and `Hotel chain -> businessDifferentiatedBy -> Customer service`.

The goal is not only to chat. The goal is to capture structured knowledge as the interview happens.

## User Experience

The main screen has two working areas.

**Conversation pane**

- Shows the interview transcript.
- Uses separate visual styles for the assistant and the user.
- Supports typed input through the composer.
- Supports voice input and live voice conversations when browser permissions and API keys are available.
- Starts each domain with its own opening line.
- Lets the user switch between supported use cases from the dropdown.

**Graph pane**

- Shows the current graph for the selected session.
- Updates as new graph deltas are extracted.
- Uses domain-specific colors and labels.
- Supports drag, pan, zoom, and automatic layout through a D3 force simulation.
- Hides noisy infrastructure nodes and edges when a domain marks them as display-only internals.

**Toolbar controls**

- Connect or disconnect live voice.
- Toggle spoken assistant output.
- Use browser mic dictation for a single text turn.
- Export the current session.
- Reset the current session.

## Technical Stack

Runtime stack:

- **Next.js 15** with the App Router.
- **React 19** for the client UI.
- **TypeScript** across the app, API routes, schema utilities, and graph rendering.
- **OpenAI SDK** for chat completions, Realtime WebRTC sessions, and TTS.
- **D3 force** for graph layout.
- **SVG** for the graph renderer.
- **IndexedDB** for local browser session persistence.
- **JSON graph schemas** under `src/main/json`.

Useful scripts:

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

## Architecture

At a high level, chatgraph has five layers:

1. **Domain registry**
   `lib/domains.ts` defines the available use cases. Each domain includes display labels, opening text, prompts, graph schema, root graph, placeholder text, and graph display configuration.

2. **Conversation UI**
   `app/page.tsx` owns the active domain, transcript, voice state, graph state, session persistence, export/reset actions, and API calls.

3. **Assistant generation**
   `app/api/chat/route.ts` receives the current transcript and selected domain. It calls OpenAI for the assistant's next reply using the selected domain prompt.

4. **Graph extraction**
   `lib/server/extract.ts` converts user turns into graph deltas. The medical use case uses a schema-aware OpenAI tool call. The hospitality use case uses deterministic extraction rules for the current structured concepts so the graph stays domain-specific and avoids generic transcript nodes.

5. **Graph validation, merge, and render**
   `lib/schema.ts` derives allowed labels, properties, and edge endpoints from the domain JSON schema. It sanitizes extracted deltas, merges them into the existing graph, and passes the result to `components/GraphView.tsx` for rendering.

## Request Flow

Text chat flow:

1. The user sends a message from the composer.
2. The message is appended to the transcript.
3. The app posts to `/api/chat`.
4. The API route generates the assistant reply and extracts a graph delta from the user turn.
5. The client appends the assistant reply.
6. The graph delta is sanitized and merged into the current graph.
7. The graph view rerenders.

Voice flow:

1. The user connects live voice.
2. The app requests an ephemeral Realtime token from `/api/realtime/token`.
3. `lib/realtime.ts` creates a WebRTC session with OpenAI Realtime.
4. User speech transcripts are emitted back to the app.
5. User transcripts are sent to `/api/extract` for graph extraction.
6. Assistant audio and text are streamed through the realtime session.
7. The app guards against overlapping assistant responses so the assistant does not stammer or replace itself mid-turn.

Fallback speech flow:

- `lib/speech.ts` supports browser speech recognition for single-turn dictation.
- `/api/tts` can synthesize assistant text when spoken output is enabled outside a full realtime session.

## Graph Model

The graph is represented in TypeScript as:

- `GraphVertex`: an id, label, and properties.
- `GraphEdge`: an id, label, out vertex id, in vertex id, and properties.
- `GraphState`: the full current graph.
- `GraphDelta`: the incremental vertices and edges extracted from a turn.

The schema controls what can enter the graph:

- Vertex labels must exist in the selected domain schema.
- Edge labels must exist in the selected domain schema.
- Edge endpoints must match the schema's allowed source and target labels.
- Unknown labels, invalid endpoints, empty nodes, and duplicate facts are filtered before merge.

This keeps the live graph closer to the use case schema instead of letting arbitrary LLM labels accumulate.

## Domains And Schemas

Runtime domain schemas live here:

```text
src/main/json/medical.json
src/main/json/hospitality.json
```

The active domains are registered here:

```text
lib/domains.ts
```

Each domain defines:

- Product label and subtitle.
- Participant label, such as `PATIENT` or `EXPERT`.
- Opening assistant message.
- Assistant prompt.
- Extractor prompt or extraction strategy.
- Initial graph roots.
- Schema JSON.
- Graph display preferences.

The Python files under `src/main/python/chatgraph/domains` are schema-authoring and legacy companion files. The deployed browser app uses the committed JSON schemas and TypeScript runtime directly. Keep the Python files when you want a source trail for schema generation or future schema-authoring work, but do not expect the browser runtime to import them directly.

## Current Use Cases

### Headache / Medical

Purpose: interview a patient about headache symptoms and build a symptom graph.

Representative graph concepts:

- `Patient`
- `Headache`
- `PainLocation`
- `PainCharacter`
- `FrequencyPattern`
- `Trigger`
- `AlleviatingFactor`
- `AssociatedSymptom`
- `Diagnosis`

Representative relationships:

- `reports`
- `locatedAt`
- `hasPainCharacter`
- `hasFrequency`
- `triggeredBy`
- `relievedBy`
- `associatedWith`
- `classifiedAs`

### Hospitality Expert

Purpose: interview a hospitality operator and build an operational knowledge graph.

Representative graph concepts:

- `Expert`
- `ExpertRole`
- `HospitalityBusiness`
- `OperatingTenure`
- `GuestPersona`
- `GuestExperiencePrinciple`
- `ServiceStandard`
- `DecisionRule`
- `OperationalPractice`
- `Outcome`
- `Evidence`

Representative relationships:

- `hasRole`
- `operatesBusiness`
- `hasOperatingTenure`
- `businessDifferentiatedBy`
- `experienceDesignedFor`
- `standardDeliveredTo`
- `standardEnforces`
- `principleSupportedBy`
- `practiceProduces`
- `leadsTo`
- `evidencedBy`

## Project Structure

```text
app/
  api/
    chat/route.ts              Assistant response + text-turn extraction
    extract/route.ts           Voice-turn graph extraction
    realtime/token/route.ts    OpenAI Realtime ephemeral token
    tts/route.ts               OpenAI TTS endpoint
  globals.css                  App styling
  layout.tsx                   Next.js root layout
  page.tsx                     Main client application

components/
  GraphView.tsx                SVG graph renderer with D3 force layout

lib/
  domains.ts                   Domain registry and prompts
  export.ts                    Transcript and graph export helpers
  prompts.ts                   Shared prompt helpers
  realtime.ts                  OpenAI Realtime WebRTC client
  schema.ts                    Schema parsing, validation, merge logic
  server/extract.ts            Domain-specific graph extraction
  speech.ts                    Browser speech recognition and TTS helper
  storage.ts                   IndexedDB session persistence
  types.ts                     Shared app types

src/main/json/
  medical.json                 Headache graph schema
  hospitality.json             Hospitality graph schema

src/main/python/chatgraph/
  domains/                     Schema-authoring and legacy companion modules
```

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env`:

```bash
OPENAI_API_KEY=your_openai_api_key
```

Optional model and voice settings:

```bash
CHATGRAPH_AGENT_MODEL=gpt-4.1-mini
CHATGRAPH_EXTRACTOR_MODEL=gpt-4.1-mini
CHATGRAPH_REALTIME_MODEL=gpt-4o-realtime-preview
CHATGRAPH_REALTIME_VOICE=alloy
CHATGRAPH_TTS_VOICE=alloy
```

Start the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Verification

Run these before committing or deploying:

```bash
npm run typecheck
npm run lint
npm run build
```

## Deployment

The app is designed to deploy cleanly on Vercel.

Deployment checklist:

- Set `OPENAI_API_KEY` in the deployment environment.
- Set optional model and voice environment variables if you do not want defaults.
- Run `npm run build` locally before pushing.
- Deploy through Vercel or any Next.js-compatible host.

Because sessions are stored in browser IndexedDB, there is no shared server-side database required for the current prototype.

## Adding Another Use Case

To add a new parallel use case:

1. Add a graph schema JSON file under `src/main/json/<domain>.json`.
2. Add the domain entry in `lib/domains.ts`.
3. Provide a domain opening line and assistant prompt.
4. Add graph display configuration for important labels and any hidden infrastructure labels.
5. Add extraction logic in `lib/server/extract.ts`.
6. Confirm extracted edge labels and endpoint labels match the schema.
7. Test typed chat, voice chat, export, reset, and graph rendering.

The most important rule is that the extractor and the schema must agree. If the extractor emits generic labels or relationships that are not in the schema, `sanitizeDelta` will reject them or the graph will become less useful.

## Known Limitations

- This is a prototype and has not been hardened for production traffic.
- Sessions are local to the user's browser.
- There is no authentication or server-side user management.
- The graph layout can become visually dense as the graph grows.
- Voice behavior depends on browser permissions, microphone quality, and OpenAI Realtime availability.
- The hospitality extractor currently favors deterministic domain rules for reliability. Expanding it with schema-constrained LLM extraction would make it broader, but needs careful validation to avoid generic or noisy graph facts.
- The medical workflow is a demo interview and must not be treated as diagnosis or medical advice.

## License

No license has been declared yet. Treat the code as private unless a license is added.
