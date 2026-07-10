import type { ChatSession } from "./types";

export function exportTranscriptTxt(session: ChatSession): void {
  const lines = session.messages.map((message) => {
    const speaker = message.role === "assistant" ? "agent" : "patient";
    return `${speaker}: ${message.content}`;
  });
  downloadText(`chatgraph-${stamp()}.txt`, lines.join("\n\n"));
}

export function exportTranscriptJsonl(session: ChatSession): void {
  const lines = session.messages.map((message) =>
    JSON.stringify({
      speaker: message.role === "assistant" ? "agent" : "patient",
      text: message.content,
      ts: new Date(message.createdAt).toISOString()
    })
  );
  downloadText(`chatgraph-${stamp()}.jsonl`, lines.join("\n"));
}

export function exportSessionJson(session: ChatSession): void {
  downloadText(`chatgraph-${stamp()}.json`, JSON.stringify(session, null, 2));
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}
