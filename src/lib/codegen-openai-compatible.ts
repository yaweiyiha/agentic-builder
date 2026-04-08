import { chatCompletionWithFallback, resolveModel } from "@/lib/openrouter";
import type { ChatMessage, OpenRouterResponse } from "@/lib/llm-types";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";

const DEFAULT_CODEGEN_BASE = "https://api.gptsapi.net/v1";
const DEFAULT_CODEGEN_MODEL = "claude-opus-4-6";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;
const FETCH_TIMEOUT_MS = 300_000;

/** When set, coding agents use this OpenAI-compatible API instead of OpenRouter. */
export function isCodegenCustomProvider(): boolean {
  return Boolean(process.env.CODEGEN_API_KEY?.trim());
}

function normalizeBaseUrl(base: string): string {
  return base.replace(/\/$/, "");
}

/**
 * OpenAI-compatible POST /v1/chat/completions (e.g. gptsapi.net Claude proxies).
 */
async function chatCompletionsOpenAICompatible(
  messages: ChatMessage[],
  options: { temperature: number; max_tokens: number },
): Promise<OpenRouterResponse> {
  const apiKey = process.env.CODEGEN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CODEGEN_API_KEY is not configured");
  }
  const base = normalizeBaseUrl(
    process.env.CODEGEN_OPENAI_BASE_URL?.trim() || DEFAULT_CODEGEN_BASE,
  );
  const model = process.env.CODEGEN_MODEL?.trim() || DEFAULT_CODEGEN_MODEL;
  const url = `${base}/chat/completions`;

  const payload = JSON.stringify({
    model,
    messages,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
  });

  let res: Response | null = null;
  let raw = "";
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(
        `[Codegen] Retry ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms...`,
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
        `[Codegen] Attempt ${attempt + 1} network error: ${lastErr.message}`,
      );
      continue;
    }

    if (res.ok) break;

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      console.warn(
        `[Codegen] Attempt ${attempt + 1} got ${res.status}, will retry...`,
      );
      lastErr = new Error(
        `Codegen API error: ${res.status} — ${raw.slice(0, 400)}`,
      );
      continue;
    }

    throw new Error(
      `Codegen API error: ${res.status} — ${raw.slice(0, 800)}`,
    );
  }

  if (!res || !res.ok) {
    throw (
      lastErr ??
      new Error("Codegen API failed after all retries")
    );
  }

  let json: {
    id?: string;
    model?: string;
    choices?: Array<{
      message?: { role?: string; content?: string | null };
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
      `Codegen API returned non-JSON response (${raw.length} chars): ${raw.slice(0, 300)}`,
    );
  }

  const content = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage ?? {};
  const pt = usage.prompt_tokens ?? 0;
  const ct = usage.completion_tokens ?? 0;

  return {
    id: json.id ?? "codegen",
    model: json.model ?? model,
    choices: [
      {
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: pt,
      completion_tokens: ct,
      total_tokens: usage.total_tokens ?? pt + ct,
    },
  };
}

export type CodegenOpenRouterVariant = "codeGen" | "codeFix";

/**
 * Custom Claude (OpenAI-compatible) when `CODEGEN_API_KEY` is set; else OpenRouter.
 * `openRouterVariant` selects MODEL_CONFIG when falling back to OpenRouter (ignored for custom API).
 */
export async function invokeCodegenOrOpenRouter(
  messages: ChatMessage[],
  options: {
    temperature: number;
    max_tokens: number;
    openRouterVariant?: CodegenOpenRouterVariant;
  },
): Promise<OpenRouterResponse> {
  if (isCodegenCustomProvider()) {
    const customModel =
      process.env.CODEGEN_MODEL?.trim() || DEFAULT_CODEGEN_MODEL;
    const customBase =
      process.env.CODEGEN_OPENAI_BASE_URL?.trim() || DEFAULT_CODEGEN_BASE;
    console.log(
      `[LLM] provider=codegen-custom  model=${customModel}  base=${customBase}`,
    );
    return chatCompletionsOpenAICompatible(messages, options);
  }
  const key = options.openRouterVariant ?? "codeGen";
  const configValue = MODEL_CONFIG[key] ?? "gpt-4o";
  const chain = resolveModelChain(configValue, resolveModel);
  console.log(
    `[LLM] invokeCodegenOrOpenRouter  variant=${key}  chain=[${chain.join(" → ")}]`,
  );
  return chatCompletionWithFallback(messages, chain, {
    temperature: options.temperature,
    max_tokens: options.max_tokens,
  });
}
