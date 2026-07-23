"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Download,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  Send,
  Square,
  Volume2,
  VolumeX
} from "lucide-react";
import { GraphView } from "@/components/GraphView";
import { domainList, getDomain, isDomainId } from "@/lib/domains";
import { exportSessionBundle } from "@/lib/export";
import { OpenAIRealtimeSession, type RealtimeStatus } from "@/lib/realtime";
import { mergeDelta } from "@/lib/schema";
import { clearSession, loadSession, saveSession } from "@/lib/storage";
import { createSpeechRecognition, speak, speechRecognitionAvailable, stopSpeaking } from "@/lib/speech";
import type { ChatMessage, ChatResponse, ChatSession, DomainId } from "@/lib/types";

export default function Home() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [selectedDomainId, setSelectedDomainId] = useState<DomainId>("medical");
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("idle");
  const [warnings, setWarnings] = useState<string[]>([]);
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const realtimeRef = useRef<OpenAIRealtimeSession | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSpeechAvailable(speechRecognitionAvailable());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    void loadSession(selectedDomainId).then((loaded) => {
      if (!cancelled) setSession(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDomainId]);

  useEffect(() => {
    if (session) void saveSession(session);
    sessionRef.current = session;
  }, [session]);

  useEffect(() => () => realtimeRef.current?.stop(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length]);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !session || isSending) return;
    setInput("");
    setWarnings([]);
    setIsSending(true);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: Date.now()
    };
    const optimistic = {
      ...session,
      messages: [...session.messages, userMessage]
    };
    setSession(optimistic);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: optimistic.messages,
          domainId: optimistic.domainId,
          graph: optimistic.graph
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as ChatResponse;
      const nextGraph = mergeDelta(optimistic.graph, data.delta);
      const hasGraphDelta = data.delta.vertices.length > 0 || data.delta.edges.length > 0;
      setSession({
        ...optimistic,
        graph: nextGraph,
        messages: [...optimistic.messages, data.assistantMessage],
        turnRecords: [
          ...(optimistic.turnRecords ?? []),
          {
            userMessageId: userMessage.id,
            userText: trimmed,
            delta: data.delta,
            warnings: data.warnings ?? [],
            gate: data.gate,
            createdAt: Date.now()
          }
        ]
      });
      setWarnings(hasGraphDelta ? [] : (data.warnings ?? []));
      if (optimistic.settings.autoSpeak) speak(data.assistantMessage.content);
    } catch {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "I couldn't reach the assistant service. Please try again in a moment.",
        createdAt: Date.now()
      };
      setSession({
        ...optimistic,
        messages: [...optimistic.messages, assistantMessage]
      });
    } finally {
      setIsSending(false);
    }
  }

  function appendMessage(role: ChatMessage["role"], content: string): ChatSession | null {
    const current = sessionRef.current;
    if (!current) return null;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: Date.now()
    };
    const next = {
      ...current,
      messages: [...current.messages, message]
    };
    sessionRef.current = next;
    setSession(next);
    return next;
  }

  async function extractVoiceTurn(text: string, baseSession: ChatSession) {
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          messages: baseSession.messages,
          domainId: baseSession.domainId,
          graph: baseSession.graph
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as Pick<ChatResponse, "delta" | "warnings" | "gate">;
      const hasGraphDelta = data.delta.vertices.length > 0 || data.delta.edges.length > 0;
      const current = sessionRef.current;
      if (!current) return;
      const userMessage = [...current.messages].reverse().find(
        (message) => message.role === "user" && message.content === text
      );
      const next = {
        ...current,
        graph: mergeDelta(current.graph, data.delta),
        turnRecords: [
          ...(current.turnRecords ?? []),
          {
            userMessageId: userMessage?.id ?? "",
            userText: text,
            delta: data.delta,
            warnings: data.warnings ?? [],
            gate: data.gate,
            createdAt: Date.now()
          }
        ]
      };
      sessionRef.current = next;
      setSession(next);
      setWarnings(hasGraphDelta ? [] : (data.warnings ?? []));
    } catch {
      setWarnings(["Voice transcript saved, but graph extraction failed for that turn."]);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(input);
  }

  function toggleListening() {
    if (!speechAvailable || !session) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    stopSpeaking();
    const recognition = createSpeechRecognition(
      (text) => {
        setInput(text);
        void submit(text);
      },
      () => setIsListening(false)
    );
    recognitionRef.current = recognition;
    recognition?.start();
    setIsListening(Boolean(recognition));
  }

  function toggleAutoSpeak() {
    if (!session) return;
    stopSpeaking();
    setSession({
      ...session,
      settings: {
        ...session.settings,
        autoSpeak: !session.settings.autoSpeak
      }
    });
  }

  async function toggleRealtime() {
    if (realtimeStatus !== "idle") {
      realtimeRef.current?.stop();
      realtimeRef.current = null;
      return;
    }
    if (!session) return;
    const currentSession = session;
    const domain = getDomain(currentSession.domainId);
    const initialAssistantText =
      currentSession.messages.length === 1 && currentSession.messages[0]?.role === "assistant"
        ? currentSession.messages[0].content
        : undefined;
    let spokeInitialAssistantText = false;
    stopSpeaking();
    recognitionRef.current?.stop();
    setIsListening(false);
    setWarnings([]);

    const realtime = new OpenAIRealtimeSession({
      onStatus: (status) => {
        setRealtimeStatus(status);
        if (status === "connected" && initialAssistantText && !spokeInitialAssistantText) {
          spokeInitialAssistantText = true;
          realtime.setAssistantResponsesBlocked(true);
          realtime.setMicrophoneMuted(true);
          void speak(initialAssistantText).finally(() => {
            realtime.setMicrophoneMuted(false);
            realtime.setAssistantResponsesBlocked(false);
          });
        }
      },
      onError: (message) => setWarnings([message]),
      onUserTranscript: (text) => {
        const next = appendMessage("user", text);
        if (next) void extractVoiceTurn(text, next);
      },
      onAssistantTranscript: (text) => {
        appendMessage("assistant", text);
      },
      domainId: domain.id
    });
    realtimeRef.current = realtime;
    await realtime.start();
  }

  async function reset() {
    realtimeRef.current?.stop();
    realtimeRef.current = null;
    stopSpeaking();
    setWarnings([]);
    setInput("");
    setSession(await clearSession(selectedDomainId));
  }

  function changeDomain(domainId: string) {
    if (!isDomainId(domainId) || domainId === selectedDomainId) return;
    realtimeRef.current?.stop();
    realtimeRef.current = null;
    stopSpeaking();
    setWarnings([]);
    setInput("");
    setRealtimeStatus("idle");
    setSelectedDomainId(domainId);
  }

  function exportAll() {
    if (!session) return;
    // One click, four files under one timestamp: session export, transcript,
    // audit input, gate log — the complete input set for analysis.
    exportSessionBundle(session);
  }

  if (!session) {
    const domain = getDomain(selectedDomainId);
    return (
      <main className="app-frame">
        <div className="loading-panel">Loading {domain.label}…</div>
      </main>
    );
  }

  const domain = getDomain(session.domainId);

  return (
    <main className="app-frame">
      <section className="workspace">
        <div className="conversation-pane">
          <header className="topbar">
            <div>
              <h1>chatgraph</h1>
              <p>
                {domain.subtitle}
                {realtimeStatus !== "idle" ? ` · voice ${realtimeStatus}` : ""}
              </p>
            </div>
            <div className="toolbar">
              <select
                className="domain-select"
                value={session.domainId}
                onChange={(event) => changeDomain(event.target.value)}
                disabled={realtimeStatus !== "idle" || isSending}
                aria-label="Choose usecase"
                title="Choose usecase"
              >
                {domainList.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                onClick={toggleRealtime}
                disabled={isSending}
                title={realtimeStatus === "idle" ? "Start OpenAI live voice" : "Stop OpenAI live voice"}
                aria-label={realtimeStatus === "idle" ? "Start OpenAI live voice" : "Stop OpenAI live voice"}
              >
                {realtimeStatus === "idle" ? <PhoneCall size={18} /> : <PhoneOff size={18} />}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={toggleAutoSpeak}
                title={session.settings.autoSpeak ? "Mute replies" : "Speak replies"}
                aria-label={session.settings.autoSpeak ? "Mute replies" : "Speak replies"}
              >
                {session.settings.autoSpeak ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={toggleListening}
                disabled={!speechAvailable || isSending}
                title={isListening ? "Stop listening" : "Start listening"}
                aria-label={isListening ? "Stop listening" : "Start listening"}
              >
                {isListening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={exportAll}
                title="Download analysis bundle (session, transcript, audit, gate log)"
                aria-label="Download analysis bundle"
              >
                <Download size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={reset}
                title="Reset session"
                aria-label="Reset session"
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </header>

          <div className="message-list">
            {session.messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <span>{message.role === "assistant" ? "agent" : domain.userLabel}</span>
                <p>{message.content}</p>
              </article>
            ))}
            {isSending && (
              <article className="message assistant pending">
                <span>agent</span>
                <p>Thinking…</p>
              </article>
            )}
            <div ref={bottomRef} />
          </div>

          {warnings.length > 0 && (
            <div className="warning-strip">
              {warnings.slice(0, 2).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}

          <form className="composer" onSubmit={onSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={domain.composerPlaceholder}
              rows={2}
              disabled={isSending}
            />
            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() || isSending}
              title="Send"
              aria-label="Send"
            >
              {isSending ? <Square size={18} /> : <Send size={18} />}
            </button>
          </form>
        </div>

        <aside className="graph-pane">
          <header className="graph-header">
            <h2>graph</h2>
          </header>
          <GraphView graph={session.graph} display={domain.graphDisplay} />
        </aside>
      </section>
    </main>
  );
}
