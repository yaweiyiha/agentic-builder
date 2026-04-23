import {
  GPT5_MODEL_ID,
  gpt5ChatCompletion,
  gpt5StreamChatCompletion,
} from "./gpt5";
import {
  isGeminiProvider,
  geminiChatCompletion,
  geminiStreamChatCompletion,
} from "./gemini";
import type {
  ChatMessage,
  VisionChatMessage,
  OpenRouterOptions,
  OpenRouterResponse,
  OpenRouterToolDefinition,
  OpenRouterToolCall,
  OpenRouterUsage,
} from "./llm-types";

export type {
  ChatMessage,
  VisionContentPart,
  VisionChatMessage,
  OpenRouterOptions,
  OpenRouterUsage,
  OpenRouterResponse,
  OpenRouterToolDefinition,
  OpenRouterToolCall,
} from "./llm-types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_CHAT_TIMEOUT_MS = Number(
  process.env.OPENROUTER_CHAT_TIMEOUT_MS ?? "600000",
);

const OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o";

function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://agentic-builder.app",
    "X-OpenRouter-Title": "Agentic Builder",
  };
}

export const MODELS = {
  "gpt-5.4": GPT5_MODEL_ID,
  "gpt-5.3-codex": "openai/gpt-5.3-codex",
  "gpt-5-mini": "openai/gpt-5-mini",
  "gemini-3-pro-preview": "google/gemini-2.5-pro",
  "claude-sonnet": "anthropic/claude-sonnet-4",
  "claude-opus": "anthropic/claude-opus-4",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gemini-pro": "google/gemini-2.5-pro",
  "gemini-flash": "google/gemini-2.0-flash-exp:free",
  /** Cheap image generation via OpenRouter (FLUX Klein). */
  "flux-klein": "black-forest-labs/flux.2-klein-4b",
} as const;

export type ModelAlias = keyof typeof MODELS;

export const DEFAULT_MODEL_ALIAS: ModelAlias = "gpt-4o";

export const MODEL_PRICING: Record<string, { input: number; output: number }> =
  {
    [GPT5_MODEL_ID]: { input: 2.5, output: 10 },
    "openai/gpt-5.3-codex": { input: 1.75, output: 14 },
    "openai/gpt-5-mini": { input: 0.3, output: 1.2 },
    "qwen/qwen3.6-plus": { input: 0.325, output: 1.95 },
    "anthropic/claude-sonnet-4": { input: 3, output: 15 },
    "anthropic/claude-opus-4": { input: 15, output: 75 },
    "openai/gpt-4o": { input: 2.5, output: 10 },
    "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
    "google/gemini-2.5-pro": { input: 1.25, output: 10 },
    "google/gemini-2.0-flash-exp:free": { input: 0, output: 0 },
    /** ~$0.014 per MP first tile; treat as low-cost image gen (approximate). */
    "black-forest-labs/flux.2-klein-4b": { input: 0.1, output: 0.4 },
  };

export function resolveModel(alias: ModelAlias | string): string {
  return (MODELS as Record<string, string>)[alias] ?? alias;
}

export function resolvePricedModelId(model: string): string {
  if (MODEL_PRICING[model]) return model;
  if (model.includes(":free")) return model;

  const normalized = model
    .replace(/-\d{8}$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{2}-\d{2}$/, "");

  return MODEL_PRICING[normalized] ? normalized : model;
}

export function estimateCost(model: string, usage: OpenRouterUsage): number {
  const pricing = MODEL_PRICING[resolvePricedModelId(model)];
  if (!pricing) return 0;
  return (
    (usage.prompt_tokens / 1_000_000) * pricing.input +
    (usage.completion_tokens / 1_000_000) * pricing.output
  );
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: OpenRouterOptions = {},
): Promise<OpenRouterResponse> {
  const requestedModel = options.model ?? OPENROUTER_DEFAULT_MODEL;

  if (isGeminiProvider()) {
    const geminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    console.log(
      `[LLM] provider=gemini  model=${geminiModel}  (requested=${requestedModel})`,
    );
    return geminiChatCompletion(messages, options);
  }
  if (options.model === GPT5_MODEL_ID) {
    console.log(`[LLM] provider=gpt5-gateway  model=${GPT5_MODEL_ID}`);
    return gpt5ChatCompletion(messages, {
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      response_format: options.response_format,
      thinking: options.thinking,
    });
  }
  console.log(`[LLM] provider=openrouter  model=${requestedModel}`);
  return openRouterChatCompletion(messages, options);
}

const FALLBACK_RETRY_DELAY_MS = 2_000;

/**
 * Try an ordered list of models; on LLM-level failure (API error, timeout, empty response)
 * fall through to the next model. Non-LLM errors (e.g. AbortError) are re-thrown immediately.
 */
export async function chatCompletionWithFallback(
  messages: ChatMessage[],
  modelChain: string[],
  options: Omit<OpenRouterOptions, "model"> = {},
): Promise<OpenRouterResponse> {
  let lastErr: Error | null = null;

  for (let i = 0; i < modelChain.length; i++) {
    const model = modelChain[i];
    try {
      const resp = await chatCompletion(messages, { ...options, model });

      const content = resp.choices?.[0]?.message?.content ?? "";
      const finishReason = resp.choices?.[0]?.finish_reason;

      if (!content.trim() && finishReason !== "tool_calls") {
        throw new Error(`Model ${model} returned empty content`);
      }
      // Output was cut off at token limit — treat as transient failure and try next model
      if (finishReason === "length") {
        throw new Error(
          `Model ${model} hit max_tokens limit (output truncated)`,
        );
      }

      return resp;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));

      if (lastErr.name === "AbortError") throw lastErr;

      const isLast = i === modelChain.length - 1;
      if (isLast) {
        console.error(
          `[LLM Fallback] All ${modelChain.length} model(s) failed. Last: ${model} — ${lastErr.message.slice(0, 200)}`,
        );
        throw lastErr;
      }

      console.warn(
        `[LLM Fallback] model=${model} failed (${lastErr.message.slice(0, 150)}), trying next: ${modelChain[i + 1]}`,
      );
      await new Promise((r) => setTimeout(r, FALLBACK_RETRY_DELAY_MS));
    }
  }

  throw lastErr ?? new Error("No models in fallback chain");
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  options: Omit<OpenRouterOptions, "stream"> = {},
) {
  if (isGeminiProvider()) {
    return geminiStreamChatCompletion(messages, options);
  }
  if (options.model === GPT5_MODEL_ID) {
    return gpt5StreamChatCompletion(messages, {
      temperature: options.temperature,
      max_tokens: options.max_tokens,
    });
  }
  return openRouterStreamChatCompletion(messages, options);
}

export async function openRouterChatCompletion(
  messages: ChatMessage[],
  options: OpenRouterOptions = {},
): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const {
    model = OPENROUTER_DEFAULT_MODEL,
    temperature = 0.7,
    max_tokens = 4096,
    stream = false,
    tools,
    tool_choice,
    modalities,
    image_config,
    response_format,
    reasoning,
    thinking,
  } = options;

  const controller = new AbortController();
  const timeoutMs =
    Number.isFinite(OPENROUTER_CHAT_TIMEOUT_MS) &&
    OPENROUTER_CHAT_TIMEOUT_MS > 0
      ? OPENROUTER_CHAT_TIMEOUT_MS
      : 90_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        stream,
        ...(tools?.length ? { tools } : {}),
        ...(tool_choice ? { tool_choice } : {}),
        ...(modalities?.length ? { modalities } : {}),
        ...(image_config ? { image_config } : {}),
        ...(response_format ? { response_format } : {}),
        ...(reasoning && reasoning.enabled !== false ? { reasoning } : {}),
        ...(thinking ? { thinking } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      throw new Error(
        `OpenRouter request timeout after ${timeoutMs}ms (model=${model})`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try {
      detail = JSON.stringify(JSON.parse(raw));
    } catch {
      /* keep raw */
    }
    const creditHint =
      response.status === 402
        ? " If this mentions max_tokens vs credits: lower max_tokens in the caller (e.g. PENCIL_LIVE_COMPLETION_MAX_TOKENS for Pencil Live) or add credits at https://openrouter.ai/settings/credits"
        : "";
    throw new Error(
      `OpenRouter API error: ${response.status} - ${detail}${creditHint}`,
    );
  }

  const raw = await response.text();
  try {
    return JSON.parse(raw) as OpenRouterResponse;
  } catch {
    throw new Error(
      `OpenRouter returned non-JSON response (${raw.length} chars): ${raw.slice(0, 300)}`,
    );
  }
}

/**
 * Vision-aware completion — accepts messages with array content (text + image parts).
 * Routes directly to OpenRouter; bypasses Gemini and GPT-5 gateways.
 */
export async function openRouterVisionChatCompletion(
  messages: VisionChatMessage[],
  options: OpenRouterOptions = {},
): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const {
    model = OPENROUTER_DEFAULT_MODEL,
    temperature = 0.7,
    max_tokens = 4096,
  } = options;
  const controller = new AbortController();
  const timeoutMs =
    Number.isFinite(OPENROUTER_CHAT_TIMEOUT_MS) &&
    OPENROUTER_CHAT_TIMEOUT_MS > 0
      ? OPENROUTER_CHAT_TIMEOUT_MS
      : 90_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({ model, messages, temperature, max_tokens }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      throw new Error(
        `OpenRouter vision request timeout after ${timeoutMs}ms (model=${model})`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(
      `OpenRouter vision API error: ${response.status} - ${raw.slice(0, 300)}`,
    );
  }
  return JSON.parse(await response.text()) as OpenRouterResponse;
}

export async function openRouterStreamChatCompletion(
  messages: ChatMessage[],
  options: Omit<OpenRouterOptions, "stream"> = {},
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const model = options.model ?? OPENROUTER_DEFAULT_MODEL;

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      stream: true,
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
      ...(options.reasoning && options.reasoning.enabled !== false
        ? { reasoning: options.reasoning }
        : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Stream error: ${response.status} - ${detail}`);
  }

  if (!response.body) {
    throw new Error("Stream error: empty body");
  }

  return response.body;
}

// ── Preserved: GPT-5.4 gateway direct wrappers (used externally) ──

export async function gpt5ChatCompletionDirect(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number } = {},
): Promise<OpenRouterResponse> {
  return gpt5ChatCompletion(messages, options);
}

export async function gpt5StreamChatCompletionDirect(
  messages: ChatMessage[],
  options: { temperature?: number; max_tokens?: number } = {},
) {
  return gpt5StreamChatCompletion(messages, options);
}
