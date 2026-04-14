import { NextRequest, NextResponse } from "next/server";
import { chatCompletion, streamChatCompletion } from "@/lib/openrouter";
import type { ChatMessage } from "@/lib/openrouter";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, model, stream = true } = body as {
      messages: ChatMessage[];
      model?: string;
      stream?: boolean;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    if (stream) {
      const readableStream = await streamChatCompletion(messages, { model });
      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const result = await chatCompletion(messages, { model, stream: false });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
