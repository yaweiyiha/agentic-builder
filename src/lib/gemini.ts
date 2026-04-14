import type {
  ChatMessage,
  OpenRouterOptions,
  OpenRouterResponse,
} from "./llm-types";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;
const FETCH_TIMEOUT_MS = 300_000;

export function isGeminiProvider(): boolean {
  return process.env.LLM_PROVIDER?.trim().toLowerCase() === "gemini";
}

function getConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const baseUrl = (
    process.env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL
  ).replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  return { apiKey, baseUrl, model };
}

export async function geminiChatCompletion(
  messages: ChatMessage[],
  options: OpenRouterOptions = {},
): Promise<OpenRouterResponse> {
  const { apiKey, baseUrl, model } = getConfig();
  const url = `${baseUrl}/chat/completions`;

  const payload = JSON.stringify({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 4096,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
    ...(options.response_format ? { response_format: options.response_format } : {}),
  });

  let res: Response | null = null;
  let raw = "";
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(
        `[Gemini] Retry ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms...`,
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      raw = await res.text();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[Gemini] Attempt ${attempt + 1} network error: ${lastErr.message}`,
      );
      continue;
    }
    if (res.ok) break;
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      console.warn(
        `[Gemini] Attempt ${attempt + 1} got ${res.status}, will retry...`,
      );
      lastErr = new Error(
        `Gemini API error: ${res.status} — ${raw.slice(0, 400)}`,
      );
      continue;
    }
    throw new Error(`Gemini API error: ${res.status} — ${raw.slice(0, 800)}`);
  }

  if (!res || !res.ok) {
    throw lastErr ?? new Error("Gemini API failed after all retries");
  }

  let json: {
    id?: string;
    model?: string;
    choices?: Array<{
      message?: {
        role?: string;
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    throw new Error(
      `Gemini API returned non-JSON (${raw.length} chars): ${raw.slice(0, 300)}`,
    );
  }

  const choice = json.choices?.[0];
  const content = choice?.message?.content ?? "";
  const toolCalls =
    choice?.message?.tool_calls
      ?.filter((tc) => tc.id && tc.function?.name)
      .map((tc) => ({
        id: tc.id!,
        type: "function" as const,
        function: {
          name: tc.function!.name!,
          arguments: tc.function?.arguments ?? "{}",
        },
      })) ?? [];
  const usage = json.usage ?? {};
  const pt = usage.prompt_tokens ?? 0;
  const ct = usage.completion_tokens ?? 0;

  return {
    id: json.id ?? `gemini-${Date.now()}`,
    model: json.model ?? model,
    choices: [
      {
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: choice?.finish_reason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: pt,
      completion_tokens: ct,
      total_tokens: usage.total_tokens ?? pt + ct,
    },
  };
}

export async function geminiStreamChatCompletion(
  messages: ChatMessage[],
  options: Omit<OpenRouterOptions, "stream"> = {},
): Promise<ReadableStream<Uint8Array>> {
  const { apiKey, baseUrl, model } = getConfig();
  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      stream: true,
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini stream error: ${response.status} — ${detail}`);
  }

  if (!response.body) {
    throw new Error("Gemini stream error: empty body");
  }

  return response.body;
}
