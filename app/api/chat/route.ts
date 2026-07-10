import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getDomain } from "@/lib/domains";
import { extractGraphDelta } from "@/lib/server/extract";
import type { ChatMessage, ChatRequest, GraphDelta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_AGENT_MODEL = "gpt-4o";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || !body.graph?.vertices || !body.graph?.edges) {
    return NextResponse.json({ error: "Invalid chat request." }, { status: 400 });
  }

  const latestUser = [...body.messages].reverse().find((message) => message.role === "user");
  if (!latestUser?.content.trim()) {
    return NextResponse.json({ error: "No user message found." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey });
  const domain = getDomain(body.domainId);
  const agentPromise = runAgent(openai, body.messages, domain.agentPrompt);
  const extractorPromise = extractGraphDelta(openai, latestUser.content, body);
  const [agentResult, extractorResult] = await Promise.allSettled([
    agentPromise,
    extractorPromise
  ]);

  if (agentResult.status === "rejected") {
    return NextResponse.json(
      { error: "Assistant generation failed." },
      { status: 502 }
    );
  }

  const warnings: string[] = [];
  let delta: GraphDelta = { vertices: [], edges: [] };
  if (extractorResult.status === "fulfilled") {
    delta = extractorResult.value.delta;
    warnings.push(...extractorResult.value.warnings);
  } else {
    warnings.push("Graph extraction failed for this turn.");
  }

  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: agentResult.value,
    createdAt: Date.now()
  };

  return NextResponse.json({ assistantMessage, delta, warnings });
}

async function runAgent(openai: OpenAI, messages: ChatMessage[], systemPrompt: string): Promise<string> {
  const normalizedMessages = normalizeOpenAIMessages(messages);
  const response = await openai.chat.completions.create({
    model: process.env.CHATGRAPH_AGENT_MODEL || DEFAULT_AGENT_MODEL,
    max_completion_tokens: 420,
    messages: [
      { role: "system", content: systemPrompt },
      ...normalizedMessages.slice(-14).map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content
      }))
    ]
  });
  return response.choices[0].message.content?.trim() || "I hear you. Could you tell me a little more?";
}

function normalizeOpenAIMessages(messages: ChatMessage[]): ChatMessage[] {
  const nonEmpty = messages.filter((message) => message.content.trim());
  const firstUserIndex = nonEmpty.findIndex((message) => message.role === "user");
  if (firstUserIndex < 0) return [];
  return nonEmpty.slice(firstUserIndex);
}
