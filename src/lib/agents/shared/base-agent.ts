import { v4 as uuidv4 } from "uuid";
import {
  chatCompletion,
  estimateCost,
  resolveModel,
  type ChatMessage,
  type ModelAlias,
  type OpenRouterResponse,
} from "@/lib/openrouter";
import {
  createTrace,
  logGeneration,
  flushLangfuse,
} from "@/lib/observability/langfuse";

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  defaultModel: ModelAlias | string;
  temperature?: number;
  maxTokens?: number;
  /**
   * When set, `run()` uses this instead of OpenRouter `chatCompletion`.
   * Used by `CodeGenAgent` to route to `CODEGEN_*` OpenAI-compatible endpoints.
   */
  customChatCompletion?: (
    messages: ChatMessage[],
    options: { temperature: number; max_tokens: number },
  ) => Promise<OpenRouterResponse>;
}

export interface AgentResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd: number;
  durationMs: number;
  traceId: string;
}

export class BaseAgent {
  protected config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async run(
    userMessage: string,
    context?: string,
    pipelineStep?: string,
    sessionId?: string
  ): Promise<AgentResult> {
    const traceId = uuidv4();
    const model =
      this.config.customChatCompletion && process.env.CODEGEN_API_KEY?.trim()
        ? (process.env.CODEGEN_MODEL?.trim() || "claude-opus-4-6")
        : resolveModel(this.config.defaultModel);

    createTrace({
      traceId,
      sessionId,
      agentName: this.config.name,
      pipelineStep: pipelineStep ?? "standalone",
      model,
    });

    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
    ];

    if (context) {
      messages.push({
        role: "system",
        content: `## Additional Context\n${context}`,
      });
    }

    messages.push({ role: "user", content: userMessage });

    const startTime = Date.now();
    const temp = this.config.temperature ?? 0.7;
    const maxTok = this.config.maxTokens ?? 4096;
    const response: OpenRouterResponse = this.config.customChatCompletion
      ? await this.config.customChatCompletion(messages, {
          temperature: temp,
          max_tokens: maxTok,
        })
      : await chatCompletion(messages, {
          model: resolveModel(this.config.defaultModel),
          temperature: temp,
          max_tokens: maxTok,
        });
    const durationMs = Date.now() - startTime;

    const content = response.choices[0]?.message?.content ?? "";
    const usage = response.usage;
    const modelUsed = response.model;
    const costUsd = estimateCost(modelUsed, usage);

    logGeneration({
      traceId,
      name: `${this.config.name}::${pipelineStep ?? "run"}`,
      model: modelUsed,
      input: messages,
      output: content,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
      costUsd,
      durationMs,
    });

    await flushLangfuse();

    return {
      content,
      model: modelUsed,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
      costUsd,
      durationMs,
      traceId,
    };
  }

  getName(): string {
    return this.config.name;
  }

  getRole(): string {
    return this.config.role;
  }
}
