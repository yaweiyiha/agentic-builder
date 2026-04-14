import { v4 as uuidv4 } from "uuid";
import {
  chatCompletion,
  chatCompletionWithFallback,
  streamChatCompletion,
  resolveModel,
  estimateCost,
} from "@/lib/openrouter";
import type {
  ChatMessage,
  OpenRouterOptions,
  OpenRouterResponse,
  OpenRouterUsage,
} from "@/lib/llm-types";

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  defaultModel: string | readonly string[];
  temperature?: number;
  maxTokens?: number;
  customChatCompletion?: (
    messages: ChatMessage[],
    opts: OpenRouterOptions,
  ) => Promise<OpenRouterResponse>;
  /** When set, streamRun bypasses OpenRouter SSE and uses this implementation (e.g. Anthropic Messages API). */
  customStreamRun?: (
    messages: ChatMessage[],
    opts: Omit<OpenRouterOptions, "stream">,
    onChunk: (chunk: string, type: "thinking" | "content") => void,
    ctx: { traceId: string },
  ) => Promise<AgentResult>;
}

export interface AgentResult {
  content: string;
  model: string;
  costUsd: number;
  durationMs: number;
  usage: OpenRouterUsage;
  traceId?: string;
}

export class BaseAgent {
  protected config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  protected buildMessages(
    userMessage: string,
    additionalContext?: string,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
    ];

    if (additionalContext?.trim()) {
      messages.push({
        role: "user",
        content: `${additionalContext}\n\n${userMessage}`,
      });
    } else {
      messages.push({ role: "user", content: userMessage });
    }

    return messages;
  }

  async run(
    userMessage: string,
    additionalContext?: string,
    stepId?: string,
    sessionId?: string,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const traceId = `${stepId ?? "agent"}-${sessionId ?? uuidv4()}`;

    const messages = this.buildMessages(userMessage, additionalContext);
    const opts: OpenRouterOptions = {
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
    };

    let response: OpenRouterResponse;

    if (this.config.customChatCompletion) {
      const modelChain = Array.isArray(this.config.defaultModel)
        ? (this.config.defaultModel as string[])
        : [this.config.defaultModel as string];
      response = await this.config.customChatCompletion(messages, {
        ...opts,
        model: modelChain[0],
      });
    } else if (Array.isArray(this.config.defaultModel)) {
      const modelChain = (this.config.defaultModel as string[]).map(
        resolveModel,
      );
      response = await chatCompletionWithFallback(messages, modelChain, opts);
    } else {
      const model = resolveModel(this.config.defaultModel as string);
      response = await chatCompletion(messages, { ...opts, model });
    }

    const durationMs = Date.now() - startTime;
    const content = response.choices[0]?.message?.content ?? "";
    const model = response.model;
    const usage: OpenRouterUsage = response.usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
    const costUsd = estimateCost(model, usage);

    return { content, model, costUsd, durationMs, usage, traceId };
  }

  async streamRun(
    userMessage: string,
    onChunk: (chunk: string, type: "thinking" | "content") => void,
    additionalContext?: string,
    stepId?: string,
    sessionId?: string,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const traceId = `${stepId ?? "agent"}-${sessionId ?? uuidv4()}`;

    const messages = this.buildMessages(userMessage, additionalContext);
    const rawModel = Array.isArray(this.config.defaultModel)
      ? (this.config.defaultModel as string[])[0]
      : (this.config.defaultModel as string);

    const streamOpts: Omit<OpenRouterOptions, "stream"> = {
      model: rawModel,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
    };

    if (this.config.customStreamRun) {
      return this.config.customStreamRun(messages, streamOpts, onChunk, {
        traceId,
      });
    }

    const model = resolveModel(rawModel);

    const stream = await streamChatCompletion(messages, {
      ...streamOpts,
      model,
    });

    let fullContent = "";
    let responseModel = model;
    let usage: OpenRouterUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.model) responseModel = parsed.model;
            if (parsed.usage) usage = parsed.usage;

            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.reasoning_content) {
              onChunk(delta.reasoning_content, "thinking");
            }

            if (delta.content) {
              fullContent += delta.content;
              onChunk(delta.content, "content");
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const durationMs = Date.now() - startTime;
    const costUsd = estimateCost(responseModel, usage);

    return { content: fullContent, model: responseModel, costUsd, durationMs, usage, traceId };
  }
}
