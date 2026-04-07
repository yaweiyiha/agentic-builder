import {
  GPT5_MODEL_ID,
  gpt5ChatCompletion,
  gpt5StreamChatCompletion,
} from "./gpt5";
import type {
  ChatMessage,
  OpenRouterOptions,
  OpenRouterResponse,
  OpenRouterToolDefinition,
  OpenRouterToolCall,
  OpenRouterUsage,
} from "./llm-types";

export type {
  ChatMessage,
  OpenRouterOptions,
  OpenRouterUsage,
  OpenRouterResponse,
  OpenRouterToolDefinition,
  OpenRouterToolCall,
} from "./llm-types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

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

export function estimateCost(model: string, usage: OpenRouterUsage): number {
  const pricing = MODEL_PRICING[model];
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
  if (options.model === GPT5_MODEL_ID) {
    return gpt5ChatCompletion(messages, {
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      response_format: options.response_format,
    });
  }
  return openRouterChatCompletion(messages, options);
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  options: Omit<OpenRouterOptions, "stream"> = {},
) {
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
  } = options;

  const response = await fetch(OPENROUTER_API_URL, {
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
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try {
      detail = JSON.stringify(JSON.parse(raw));
    } catch {
      /* keep raw */
    }
    throw new Error(`OpenRouter API error: ${response.status} - ${detail}`);
  }

  return response.json() as Promise<OpenRouterResponse>;
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
