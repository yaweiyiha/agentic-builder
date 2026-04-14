/**
 * Optional Anthropic-compatible HTTP API for PRD generation (e.g. Claude Code / internal gateway).
 *
 * Set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN (and optionally ANTHROPIC_PRD_MODEL).
 * Never commit secrets — use .env.local only.
 */
import { estimateCost } from "@/lib/openrouter";
import type {
  ChatMessage,
  OpenRouterOptions,
  OpenRouterResponse,
  OpenRouterUsage,
} from "@/lib/llm-types";
import type { AgentResult } from "@/lib/agents/shared/base-agent";

const ANTHROPIC_VERSION = "2023-06-01";

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * When `ANTHROPIC_GATEWAY_DISABLED` is set to 1/true/yes, PRD never uses the Anthropic HTTP gateway,
 * even if `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are still present (e.g. from the shell or another env file).
 */
export function isAnthropicGatewayForPrdEnabled(): boolean {
  if (isTruthyEnvFlag(process.env.ANTHROPIC_GATEWAY_DISABLED)) {
    return false;
  }
  const base = process.env.ANTHROPIC_BASE_URL?.trim();
  const token = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  return Boolean(base && token);
}

function normalizeMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/messages")) return trimmed;
  return `${trimmed}/v1/messages`;
}

function buildAuthHeaders(): HeadersInit {
  const token = process.env.ANTHROPIC_AUTH_TOKEN!.trim();
  const scheme = (process.env.ANTHROPIC_AUTH_SCHEME ?? "x-api-key").toLowerCase();
  if (scheme === "bearer" || scheme === "authorization") {
    return {
      Authorization: `Bearer ${token}`,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    };
  }
  return {
    "x-api-key": token,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };
}

/**
 * Splits OpenAI-style messages into Anthropic system + user/assistant-only turns.
 */
function toAnthropicPayload(messages: ChatMessage[]): {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
} {
  let system = "";
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system = system ? `${system}\n\n${m.content}` : m.content;
      continue;
    }
    if (m.role === "tool") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content += `\n\n${m.content}`;
    } else {
      turns.push({ role, content: m.content });
    }
  }
  return { system: system || undefined, messages: turns };
}

function extractTextFromMessageJson(body: Record<string, unknown>): string {
  const content = body.content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: string }).text === "string"
    ) {
      texts.push((block as { text: string }).text);
    }
  }
  return texts.join("");
}

export async function anthropicGatewayChatCompletion(
  messages: ChatMessage[],
  opts: OpenRouterOptions,
): Promise<OpenRouterResponse> {
  const base = process.env.ANTHROPIC_BASE_URL!.trim();
  const model =
    opts.model?.trim() ||
    process.env.ANTHROPIC_PRD_MODEL?.trim() ||
    "claude-sonnet-4-20250514";
  const maxTokensCap =
    Number.parseInt(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS ?? "128000", 10) ||
    128000;
  const maxTokens = Math.min(opts.max_tokens ?? 4096, maxTokensCap);
  const { system, messages: anthropicMessages } = toAnthropicPayload(messages);
  const url = normalizeMessagesUrl(base);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: anthropicMessages,
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (system) body.system = system;

  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      `Anthropic gateway error: ${String(res.status)} — ${raw.slice(0, 2000)}`,
    );
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Anthropic gateway returned non-JSON (${raw.slice(0, 300)})`);
  }

  const text = extractTextFromMessageJson(json);
  const usageRaw = json.usage as Record<string, number> | undefined;
  const input = usageRaw?.input_tokens ?? 0;
  const output = usageRaw?.output_tokens ?? 0;
  const usage: OpenRouterUsage = {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
  };

  return {
    id: (json.id as string) ?? "anthropic-gateway",
    model: (json.model as string) ?? model,
    choices: [
      {
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage,
  };
}

type StreamCtx = { traceId: string };

/**
 * Streams Anthropic messages SSE; maps text deltas to the same onChunk contract as OpenRouter.
 */
export async function anthropicGatewayStreamRun(
  messages: ChatMessage[],
  opts: Omit<OpenRouterOptions, "stream">,
  onChunk: (chunk: string, type: "thinking" | "content") => void,
  ctx: StreamCtx,
): Promise<AgentResult> {
  const startedAt = Date.now();
  const base = process.env.ANTHROPIC_BASE_URL!.trim();
  const model =
    opts.model?.trim() ||
    process.env.ANTHROPIC_PRD_MODEL?.trim() ||
    "claude-sonnet-4-20250514";
  const maxTokensCap =
    Number.parseInt(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS ?? "128000", 10) ||
    128000;
  const maxTokens = Math.min(opts.max_tokens ?? 4096, maxTokensCap);
  const { system, messages: anthropicMessages } = toAnthropicPayload(messages);
  const url = normalizeMessagesUrl(base);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: anthropicMessages,
    stream: true,
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (system) body.system = system;

  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Anthropic gateway stream error: ${String(res.status)} — ${errText.slice(0, 2000)}`,
    );
  }

  if (!res.body) throw new Error("Anthropic gateway stream: empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let responseModel = model;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const block of parts) {
        if (!block.trim()) continue;
        let eventType = "";
        let dataLine = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
        }
        if (!dataLine || dataLine === "[DONE]") continue;

        try {
          const data = JSON.parse(dataLine) as Record<string, unknown>;
          if (data.type === "message_start") {
            const msg = data.message as Record<string, unknown> | undefined;
            if (msg && typeof msg.model === "string") responseModel = msg.model;
          }
          if (data.type === "message_delta") {
            const usage = data.usage as Record<string, number> | undefined;
            if (usage) {
              if (typeof usage.input_tokens === "number")
                inputTokens = usage.input_tokens;
              if (typeof usage.output_tokens === "number")
                outputTokens = usage.output_tokens;
            }
          }
          if (data.type === "content_block_delta") {
            const delta = data.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              fullContent += delta.text;
              onChunk(delta.text, "content");
            }
          }
        } catch {
          /* ignore partial JSON in buffer */
        }

        if (eventType === "error") {
          let payload = dataLine;
          try {
            payload = JSON.stringify(JSON.parse(dataLine));
          } catch {
            /* keep */
          }
          throw new Error(`Anthropic stream error event: ${payload}`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const durationMs = Date.now() - startedAt;
  const usage: OpenRouterUsage = {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens:
      inputTokens + outputTokens ||
      (fullContent.length > 0 ? Math.ceil(fullContent.length / 4) : 0),
  };
  const costUsd = estimateCost(responseModel, usage);

  return {
    content: fullContent,
    model: responseModel,
    costUsd,
    durationMs,
    usage,
    traceId: ctx.traceId,
  };
}
