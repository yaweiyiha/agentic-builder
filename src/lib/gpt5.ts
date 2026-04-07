import { v4 as uuidv4 } from "uuid";
import type { ChatMessage, OpenRouterResponse } from "@/lib/llm-types";

export const GPT5_MODEL_ID = "gpt-5.4-2026-03-05";

const DEFAULT_GPT5_BASE_URL =
  "https://aidp-i18ntt-sg.tiktok-row.net/api/modelhub/online";

function getApiKey(): string {
  const key = process.env.GPT5_API_KEY?.trim();
  if (!key) throw new Error("GPT5_API_KEY is not configured");
  return key;
}

function getBaseUrl(): string {
  return (process.env.GPT5_BASE_URL?.trim() ?? DEFAULT_GPT5_BASE_URL).replace(
    /\/$/,
    "",
  );
}

function buildHeaders(apiKey: string, sessionId: string, logId: string) {
  return {
    "api-key": apiKey,
    "Content-Type": "application/json",
    extra: JSON.stringify({ session_id: sessionId }),
    "x-client-request-id": logId,
    "x-tt-logid": logId,
  } as Record<string, string>;
}

function buildBody(
  messages: ChatMessage[],
  opts: {
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    response_format?: { type: string; json_schema?: Record<string, unknown> };
  },
  sessionId: string,
) {
  return {
    model: GPT5_MODEL_ID,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 4096,
    stream: opts.stream ?? false,
    prompt_cache_key: sessionId,
    user: sessionId,
    thinking: {
      thinking_effort: "medium",
      verbosity: "medium",
    },
    ...(opts.response_format ? { response_format: opts.response_format } : {}),
  };
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2_000;
const FETCH_TIMEOUT_MS = 180_000;

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

      if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
        const body = await res.text();
        lastError = new Error(`GPT5 server error ${res.status}: ${body}`);
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[GPT5] ${res.status} on attempt ${attempt + 1}, retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

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
        `[GPT5] fetch attempt ${attempt + 1} failed (${lastError.message}), retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(
    `GPT5 fetch failed after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}

export async function gpt5ChatCompletion(
  messages: ChatMessage[],
  options: {
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: string; json_schema?: Record<string, unknown> };
  } = {},
): Promise<OpenRouterResponse> {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/chat/completions`;

  const sessionId = uuidv4();
  const logId = uuidv4();

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(apiKey, sessionId, logId),
    body: JSON.stringify(
      buildBody(messages, { ...options, stream: false }, sessionId),
    ),
  });

  const raw = await response.text();
  if (!response.ok) {
    let detail = raw;
    try {
      detail = JSON.stringify(JSON.parse(raw));
    } catch {
      /* keep raw */
    }
    throw new Error(`GPT5 API error: ${response.status} - ${detail}`);
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
    id: data.id ?? `gpt5-${Date.now()}`,
    model: data.model ?? GPT5_MODEL_ID,
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

export async function gpt5StreamChatCompletion(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number } = {},
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/chat/completions`;

  const sessionId = uuidv4();
  const logId = uuidv4();

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(apiKey, sessionId, logId),
    body: JSON.stringify(
      buildBody(messages, { ...options, stream: true }, sessionId),
    ),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GPT5 stream error: ${response.status} - ${detail}`);
  }

  if (!response.body) {
    throw new Error("GPT5 stream error: empty body");
  }

  return response.body;
}
