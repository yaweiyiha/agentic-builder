/**
 * DeepSeek V4 direct streaming provider. Returns OpenAI-compatible SSE chunks
 * so existing pipeline stream consumers can render content as it is generated.
 */
import type {
  ChatMessage,
  OpenRouterOptions,
  OpenRouterToolDefinition,
} from "@/lib/llm-types";
import {
  DEEPSEEK_V4_DEFAULT_BASE,
  DEEPSEEK_V4_DEFAULT_MODEL,
} from "./deepseek-v4";

const DEEPSEEK_V4_STREAM_TIMEOUT_MS = Number(
  process.env.DEEPSEEK_V4_STREAM_TIMEOUT_MS ??
    process.env.DEEPSEEK_V4_TIMEOUT_MS ??
    "300000",
);

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function normalizeBaseUrl(base: string): string {
  return base.replace(/\/$/, "");
}

export async function streamChatCompletionsDeepSeekV4(
  messages: ChatMessage[],
  options: {
    temperature: number;
    max_tokens: number;
    tools?: OpenRouterToolDefinition[];
    tool_choice?: OpenRouterOptions["tool_choice"];
    response_format?: OpenRouterOptions["response_format"];
    thinking?: OpenRouterOptions["thinking"];
  },
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  const base = normalizeBaseUrl(
    process.env.DEEPSEEK_V4_BASE_URL?.trim() || DEEPSEEK_V4_DEFAULT_BASE,
  );
  const model =
    process.env.DEEPSEEK_V4_MODEL?.trim() || DEEPSEEK_V4_DEFAULT_MODEL;
  const url = `${base}/chat/completions`;
  const enableThinking =
    options.thinking === false
      ? false
      : isTruthyEnvFlag(process.env.DEEPSEEK_V4_ENABLE_THINKING ?? "true");
  const reasoningEffort = (
    process.env.DEEPSEEK_V4_REASONING_EFFORT?.trim() || "high"
  ) as "low" | "medium" | "high";

  const controller = new AbortController();
  const timeoutMs =
    Number.isFinite(DEEPSEEK_V4_STREAM_TIMEOUT_MS) &&
    DEEPSEEK_V4_STREAM_TIMEOUT_MS > 0
      ? DEEPSEEK_V4_STREAM_TIMEOUT_MS
      : 300_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature,
        max_tokens: options.max_tokens,
        stream: true,
        ...(enableThinking
          ? { thinking: { type: "enabled" }, reasoning_effort: reasoningEffort }
          : {}),
        ...(options.tools?.length ? { tools: options.tools } : {}),
        ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
        ...(options.response_format
          ? { response_format: options.response_format }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === "AbortError") {
      throw new Error(`DeepSeek V4 stream timed out after ${timeoutMs}ms`);
    }
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timer);
    const raw = await response.text();
    throw new Error(
      `DeepSeek V4 stream API error: ${response.status} — ${raw.slice(0, 400)}`,
    );
  }

  if (!response.body) {
    clearTimeout(timer);
    throw new Error("DeepSeek V4 stream returned no response body");
  }

  const body = response.body;
  return new ReadableStream<Uint8Array>({
    async start(streamController) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamController.enqueue(value);
        }
        streamController.close();
      } catch (err) {
        streamController.error(err);
      } finally {
        clearTimeout(timer);
        reader.releaseLock();
      }
    },
    cancel() {
      clearTimeout(timer);
    },
  });
}
