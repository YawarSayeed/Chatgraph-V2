import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TTS_VOICE = "nova";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  let text: string;
  try {
    const body = (await request.json()) as { text: string };
    text = body.text?.trim();
    if (!text) throw new Error("empty");
  } catch {
    return NextResponse.json({ error: "Missing or invalid text." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: (process.env.CHATGRAPH_TTS_VOICE || DEFAULT_TTS_VOICE) as
      | "alloy"
      | "echo"
      | "fable"
      | "onyx"
      | "nova"
      | "shimmer",
    input: text,
    response_format: "mp3",
    speed: 1.0
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
