import { emptyGraph } from "./schema";
import type { ChatSession, DomainId } from "./types";
import { getDomain } from "./domains";

const DB_NAME = "chatgraph-browser";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

function sessionKey(domainId: DomainId): string {
  return `default:${domainId}`;
}

export function defaultSession(domainId: DomainId = "medical"): ChatSession {
  const domain = getDomain(domainId);
  return {
    domainId,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: domain.openingLine,
        createdAt: Date.now()
      }
    ],
    graph: emptyGraph(domainId),
    settings: {
      voiceEnabled: true,
      autoSpeak: true
    }
  };
}

export async function loadSession(domainId: DomainId = "medical"): Promise<ChatSession> {
  const db = await openDb();
  const value = await requestToPromise<ChatSession | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(sessionKey(domainId))
  );
  db.close();
  return value?.domainId === domainId ? value : defaultSession(domainId);
}

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await openDb();
  await requestToPromise(
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(session, sessionKey(session.domainId))
  );
  db.close();
}

export async function clearSession(domainId: DomainId = "medical"): Promise<ChatSession> {
  const session = defaultSession(domainId);
  await saveSession(session);
  return session;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
