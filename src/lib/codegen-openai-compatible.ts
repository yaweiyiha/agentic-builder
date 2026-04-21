import { chatCompletionWithFallback, resolveModel } from "@/lib/openrouter";
import type {
  ChatMessage,
  OpenRouterResponse,
  OpenRouterToolDefinition,
  OpenRouterToolCall,
  OpenRouterOptions,
} from "@/lib/llm-types";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";

const DEFAULT_CODEGEN_BASE = "https://api.gptsapi.net/v1";
const DEFAULT_CODEGEN_MODEL = "claude-opus-4-6";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;
const FETCH_TIMEOUT_MS = 300_000;

type ReasoningEffort = "low" | "medium" | "high";
type ThinkingVerbosity = "low" | "medium" | "high";

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function parseEffort(value: string | undefined): ReasoningEffort {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "low" || normalized === "high") return normalized;
  return "medium";
}

function parseVerbosity(value: string | undefined): ThinkingVerbosity {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "low" || normalized === "high") return normalized;
  return "medium";
}

function buildCodegenReasoningOptions(
  variant: CodegenOpenRouterVariant,
): Pick<OpenRouterOptions, "reasoning" | "thinking"> {
  const prefix = variant === "codeFix" ? "CODEFIX" : "CODEGEN";
  const enableReasoning = isTruthyEnvFlag(
    process.env[`${prefix}_ENABLE_REASONING`],
  );
  const enableThinking = isTruthyEnvFlag(
    process.env[`${prefix}_ENABLE_THINKING`],
  );

  const out: Pick<OpenRouterOptions, "reasoning" | "thinking"> = {};
  if (enableReasoning) {
    out.reasoning = {
      enabled: true,
      effort: parseEffort(process.env[`${prefix}_REASONING_EFFORT`]),
    };
  }
  if (enableThinking) {
    out.thinking = {
      thinking_effort: parseEffort(process.env[`${prefix}_THINKING_EFFORT`]),
      verbosity: parseVerbosity(process.env[`${prefix}_THINKING_VERBOSITY`]),
    };
  }
  return out;
}

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
  options: {
    temperature: number;
    max_tokens: number;
    tools?: OpenRouterToolDefinition[];
    tool_choice?: OpenRouterOptions["tool_choice"];
  },
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
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
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

    throw new Error(`Codegen API error: ${res.status} — ${raw.slice(0, 800)}`);
  }

  if (!res || !res.ok) {
    throw lastErr ?? new Error("Codegen API failed after all retries");
  }

  let json: {
    id?: string;
    model?: string;
    choices?: Array<{
      message?: {
        role?: string;
        content?: string | null;
        tool_calls?: OpenRouterToolCall[];
      };
      finish_reason?: string | null;
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

  const finishReason = json.choices?.[0]?.finish_reason ?? "stop";
  const content = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage ?? {};
  const pt = usage.prompt_tokens ?? 0;
  const ct = usage.completion_tokens ?? 0;

  if (finishReason === "length") {
    throw new Error(
      `Codegen API model ${json.model ?? model} hit max_tokens limit (output truncated)`,
    );
  }

  return {
    id: json.id ?? "codegen",
    model: json.model ?? model,
    choices: [
      {
        message: {
          role: "assistant",
          content,
          tool_calls: json.choices?.[0]?.message?.tool_calls,
        },
        finish_reason: finishReason,
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
    tools?: OpenRouterToolDefinition[];
    tool_choice?: OpenRouterOptions["tool_choice"];
  },
): Promise<OpenRouterResponse> {
  const key = options.openRouterVariant ?? "codeGen";
  const reasoningOptions = buildCodegenReasoningOptions(key);

  if (isCodegenCustomProvider()) {
    const customModel =
      process.env.CODEGEN_MODEL?.trim() || DEFAULT_CODEGEN_MODEL;
    const customBase =
      process.env.CODEGEN_OPENAI_BASE_URL?.trim() || DEFAULT_CODEGEN_BASE;
    console.log(
      `[LLM] provider=codegen-custom  model=${customModel}  base=${customBase}`,
    );
    if (reasoningOptions.reasoning || reasoningOptions.thinking) {
      console.log(
        `[LLM] codegen-custom ignores reasoning/thinking options (variant=${key})`,
      );
    }
    return chatCompletionsOpenAICompatible(messages, options);
  }
  const configValue = MODEL_CONFIG[key] ?? "gpt-4o";
  const chain = resolveModelChain(configValue, resolveModel);
  console.log(
    `[LLM] invokeCodegenOrOpenRouter  variant=${key}  chain=[${chain.join(" → ")}]`,
  );
  return chatCompletionWithFallback(messages, chain, {
    temperature: options.temperature,
    max_tokens: options.max_tokens,
    ...reasoningOptions,
  });
}
