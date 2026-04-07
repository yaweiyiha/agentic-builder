import type { ChatMessage, OpenRouterResponse } from "@/lib/llm-types";

export const GEMINI_MODEL_ID = "gemini-3-pro-preview";

const DEFAULT_GEMINI_BASE_URL = "https://geminicode.net/v1";

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return key;
}

function getChatCompletionsUrl(): string {
  const base = (
    process.env.GEMINI_BASE_URL ?? DEFAULT_GEMINI_BASE_URL
  ).replace(/\/$/, "");
  return `${base}/chat/completions`;
}

function openAiCompatibleHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 120_000;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err : new Error(String(err));
      const isAbort =
        lastError.name === "AbortError" ||
        lastError.message.includes("aborted");
      const isTransient =
        isAbort || lastError.message.toLowerCase().includes("fetch failed");

      if (!isTransient || attempt === MAX_RETRIES - 1) break;

      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[Gemini] fetch attempt ${attempt + 1} failed (${lastError.message}), retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(
    `Gemini gateway fetch failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}

/**
 * OpenAI-compatible chat completions (e.g. geminicode.net /v1).
 * Not Google Generative Language API and not OpenRouter.
 */
export async function geminiChatCompletion(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number } = {},
): Promise<OpenRouterResponse> {
  const apiKey = getGeminiApiKey();
  const url = getChatCompletionsUrl();

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: openAiCompatibleHeaders(apiKey),
    body: JSON.stringify({
      model: GEMINI_MODEL_ID,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      stream: false,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    let detail = raw;
    try {
      detail = JSON.stringify(JSON.parse(raw));
    } catch {
      /* keep raw */
    }
    throw new Error(`Gemini gateway error: ${response.status} - ${detail}`);
  }

  const data = JSON.parse(raw) as {
    id?: string;
    model?: string;
    choices?: {
      message?: ChatMessage;
      finish_reason?: string;
    }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? "stop";
  const usage = data.usage ?? {};

  return {
    id: data.id ?? `gemini-${Date.now()}`,
    model: data.model ?? GEMINI_MODEL_ID,
    choices: [
      {
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
  };
}

/** Same gateway, streaming SSE (OpenAI-compatible chunks). */
export async function geminiStreamChatCompletion(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number } = {},
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = getGeminiApiKey();
  const url = getChatCompletionsUrl();

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: openAiCompatibleHeaders(apiKey),
    body: JSON.stringify({
      model: GEMINI_MODEL_ID,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      stream: true,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Gemini gateway stream error: ${response.status} - ${detail}`,
    );
  }

  if (!response.body) {
    throw new Error("Gemini gateway stream error: empty body");
  }

  return response.body;
}
