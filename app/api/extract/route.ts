import OpenAI from "openai";
import { NextResponse } from "next/server";
import { extractGraphDelta } from "@/lib/server/extract";
import type { ChatRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ExtractRequest = ChatRequest & {
  text?: string;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  let body: ExtractRequest;
  try {
    body = (await request.json()) as ExtractRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.text?.trim() || !Array.isArray(body.messages) || !body.graph?.vertices) {
    return NextResponse.json({ error: "Invalid extraction request." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey });
  return NextResponse.json(await extractGraphDelta(openai, body.text, body));
}
