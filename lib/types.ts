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

/** What extraction did with one user turn: the delta admitted and the warnings. */
export interface TurnRecord {
  userMessageId: string;
  userText: string;
  delta: GraphDelta;
  warnings: string[];
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
}
