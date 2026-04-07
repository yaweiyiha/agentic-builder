import { NextRequest } from "next/server";
import {
  chatCompletion,
  resolveModel,
  estimateCost,
  type ChatMessage,
} from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";

export const maxDuration = 120;

const REFINE_SYSTEM_PROMPT = `You are a Product Manager Agent. You have previously generated a PRD.
The user wants to refine it. Apply the requested changes to the PRD and output the COMPLETE updated PRD in full.
Do NOT output only the diff or changed section — output the entire PRD with changes applied.
Maintain the same markdown structure and formatting.`;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { currentPrd, userMessage, chatHistory } = body as {
    currentPrd: string;
    userMessage: string;
    chatHistory?: { role: string; content: string }[];
  };

  if (!currentPrd || !userMessage) {
    return Response.json(
      { error: "currentPrd and userMessage are required" },
      { status: 400 },
    );
  }

  const model = resolveModel(MODEL_CONFIG.prdRefine);

  const messages: ChatMessage[] = [
    { role: "system", content: REFINE_SYSTEM_PROMPT },
    { role: "user", content: `Here is the current PRD:\n\n${currentPrd}` },
    { role: "assistant", content: "I have the current PRD. What changes would you like?" },
  ];

  if (chatHistory && chatHistory.length > 0) {
    for (const msg of chatHistory) {
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }
  }

  messages.push({ role: "user", content: userMessage });

  try {
    const startMs = Date.now();
    const response = await chatCompletion(messages, {
      model,
      temperature: 0.5,
      max_tokens: 16384,
    });
    const durationMs = Date.now() - startMs;

    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);

    return Response.json({
      updatedPrd: content,
      costUsd,
      durationMs,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "PRD refinement failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
