/**
 * DeepSeek V4 Pro direct API provider.
 *
 * Set DEEPSEEK_API_KEY to activate. The codegen routing layer (providers/codegen.ts)
 * calls this first and falls back to the OpenRouter chain only after
 * DEEPSEEK_V4_MAX_ATTEMPTS consecutive failures.
 *
 * Env vars (all optional except DEEPSEEK_API_KEY):
 *   DEEPSEEK_API_KEY            – required to enable this provider
 *   DEEPSEEK_V4_BASE_URL        – default: https://api.deepseek.com
 *   DEEPSEEK_V4_MODEL           – default: deepseek-v4-pro
 *   DEEPSEEK_V4_TIMEOUT_MS      – per-attempt timeout in ms (default: 300 000)
 *   DEEPSEEK_V4_ENABLE_THINKING – send thinking:{type:enabled} (default: true)
 *   DEEPSEEK_V4_REASONING_EFFORT – low | medium | high (default: high)
 */
import type {
  ChatMessage,
  OpenRouterResponse,
  OpenRouterToolDefinition,
  OpenRouterOptions,
  OpenRouterToolCall,
} from "@/lib/llm-types";

export const DEEPSEEK_V4_DEFAULT_BASE = "https://api.deepseek.com";
export const DEEPSEEK_V4_DEFAULT_MODEL = "deepseek-v4-pro";

/** Max consecutive attempts before giving up and letting the caller fall through. */
const DEEPSEEK_V4_MAX_ATTEMPTS = 3;
const DEEPSEEK_V4_RETRY_DELAY_MS = 5_000;
const DEEPSEEK_V4_TIMEOUT_MS = Number(
  process.env.DEEPSEEK_V4_TIMEOUT_MS ?? "300000",
);

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function normalizeBaseUrl(base: string): string {
  return base.replace(/\/$/, "");
}

/** Returns true when DEEPSEEK_API_KEY is set, activating this provider. */
export function isDeepSeekV4Provider(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

/**
 * Call DeepSeek V4 Pro directly at api.deepseek.com.
 * Retries up to DEEPSEEK_V4_MAX_ATTEMPTS times on transient errors (network / 429 / 5xx).
 * Throws on exhaustion so the caller can fall through to the OpenRouter chain.
 */
export async function chatCompletionsDeepSeekV4(
  messages: ChatMessage[],
  options: {
    temperature: number;
    max_tokens: number;
    tools?: OpenRouterToolDefinition[];
    tool_choice?: OpenRouterOptions["tool_choice"];
  },
): Promise<OpenRouterResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY!.trim();
  const base = normalizeBaseUrl(
    process.env.DEEPSEEK_V4_BASE_URL?.trim() || DEEPSEEK_V4_DEFAULT_BASE,
  );
  const model =
    process.env.DEEPSEEK_V4_MODEL?.trim() || DEEPSEEK_V4_DEFAULT_MODEL;
  const url = `${base}/chat/completions`;

  const enableThinking = isTruthyEnvFlag(
    process.env.DEEPSEEK_V4_ENABLE_THINKING ?? "true",
  );
  const reasoningEffort = (
    process.env.DEEPSEEK_V4_REASONING_EFFORT?.trim() || "high"
  ) as "low" | "medium" | "high";

  const payload = JSON.stringify({
    model,
    messages,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
    ...(enableThinking
      ? { thinking: { type: "enabled" }, reasoning_effort: reasoningEffort }
      : {}),
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
  });

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < DEEPSEEK_V4_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      console.log(
        `[DeepSeek V4] Retry ${attempt}/${DEEPSEEK_V4_MAX_ATTEMPTS - 1} after ${DEEPSEEK_V4_RETRY_DELAY_MS}ms...`,
      );
      await new Promise((r) => setTimeout(r, DEEPSEEK_V4_RETRY_DELAY_MS));
    }

    let res: Response;
    let raw = "";

    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        DEEPSEEK_V4_TIMEOUT_MS,
      );
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
        `[DeepSeek V4] Attempt ${attempt + 1} network error: ${lastErr.message}`,
      );
      continue;
    }

    if (!res.ok) {
      lastErr = new Error(
        `DeepSeek V4 API error: ${res.status} — ${raw.slice(0, 400)}`,
      );
      if (res.status === 429 || res.status >= 500) {
        console.warn(
          `[DeepSeek V4] Attempt ${attempt + 1} got ${res.status}, will retry...`,
        );
        continue;
      }
      // 4xx permanent errors — no point retrying
      throw lastErr;
    }

    let json: {
      id?: string;
      model?: string;
      choices?: Array<{
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: OpenRouterToolCall[];
          /** Thinking mode: DeepSeek returns the chain-of-thought here. Must be echoed back. */
          reasoning_content?: string | null;
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
      lastErr = new Error(
        `DeepSeek V4 returned non-JSON (${raw.length} chars): ${raw.slice(0, 300)}`,
      );
      continue;
    }

    const finishReason = json.choices?.[0]?.finish_reason ?? "stop";
    if (finishReason === "length") {
      throw new Error(
        `DeepSeek V4 model ${json.model ?? model} hit max_tokens limit (output truncated)`,
      );
    }

    const content = json.choices?.[0]?.message?.content ?? "";
    const reasoningContent =
      json.choices?.[0]?.message?.reasoning_content ?? undefined;
    const usage = json.usage ?? {};
    const pt = usage.prompt_tokens ?? 0;
    const ct = usage.completion_tokens ?? 0;

    console.log(
      `[DeepSeek V4] attempt=${attempt + 1} model=${json.model ?? model} tokens=${pt}+${ct}${reasoningContent ? " (thinking)" : ""}`,
    );

    return {
      id: json.id ?? "deepseek-v4",
      model: json.model ?? model,
      choices: [
        {
          message: {
            role: "assistant",
            content,
            tool_calls: json.choices?.[0]?.message?.tool_calls,
            // Must be echoed back in subsequent turns when thinking mode is on.
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
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

  throw lastErr ??
    new Error(`DeepSeek V4 failed after ${DEEPSEEK_V4_MAX_ATTEMPTS} attempt(s)`);
}
