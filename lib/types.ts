export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ChatRole = "user" | "assistant";
export type DomainId = "medical" | "hospitality";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export interface GraphVertex {
  id: string;
  label: string;
  properties: Record<string, JsonValue>;
}

export interface GraphEdge {
  id: string;
  label: string;
  out: string;
  in: string;
  properties: Record<string, JsonValue>;
}

export interface GraphState {
  vertices: Record<string, GraphVertex>;
  edges: Record<string, GraphEdge>;
}

export interface GraphDelta {
  vertices: GraphVertex[];
  edges: GraphEdge[];
}

export interface ClientSettings {
  voiceEnabled: boolean;
  autoSpeak: boolean;
}

/** One gate finding, as reported to the client. Mirrors lib/gate GateFinding. */
export interface TurnGateFinding {
  ruleId: string;
  severity: string;
  message: string;
  subjectId?: string | null;
  action: string;
}

/** One extraction attempt as the gate saw it. */
export interface GateAttemptReport {
  attempt: number;
  proposedVertices: number;
  proposedEdges: number;
  admittedVertices: number;
  admittedEdges: number;
  score: number;
  findings: TurnGateFinding[];
  /** The correction echoed back to the extractor, when this attempt triggered a retry. */
  retryFeedback?: string;
}

/** The gate's full account of one turn — every attempt, every finding. */
export interface TurnGateReport {
  attempts: GateAttemptReport[];
  /** 1-based attempt whose delta was admitted; 0 when nothing was extracted. */
  chosenAttempt: number;
  skippedAsFiller?: boolean;
}

/** What extraction did with one user turn: the delta admitted and the warnings. */
export interface TurnRecord {
  userMessageId: string;
  userText: string;
  delta: GraphDelta;
  warnings: string[];
  /** Full gate report for the turn, including rejected attempts. */
  gate?: TurnGateReport;
  createdAt: number;
}

export interface ChatSession {
  domainId: DomainId;
  messages: ChatMessage[];
  graph: GraphState;
  settings: ClientSettings;
  /** One record per extracted user turn, in order. The export builds from these. */
  turnRecords?: TurnRecord[];
}

export interface ChatRequest {
  domainId?: DomainId;
  messages: ChatMessage[];
  graph: GraphState;
}

export interface ChatResponse {
  assistantMessage: ChatMessage;
  delta: GraphDelta;
  warnings: string[];
  gate?: TurnGateReport;
}
