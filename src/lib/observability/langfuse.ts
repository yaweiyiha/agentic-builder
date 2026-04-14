import { Langfuse } from "langfuse";

let langfuseInstance: Langfuse | null = null;

/** EU Cloud default. US Cloud must use https://us.cloud.langfuse.com (keys are region-bound). */
const LANGFUSE_DEFAULT_BASE_URL = "https://cloud.langfuse.com";

function isEnabled(): boolean {
  return process.env.LANGFUSE_ENABLED === "true";
}

export function getLangfuse(): Langfuse | null {
  if (!isEnabled()) return null;
  if (langfuseInstance) return langfuseInstance;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrlRaw = process.env.LANGFUSE_BASE_URL?.trim();

  if (!publicKey || !secretKey) {
    return null;
  }

  const baseUrl = baseUrlRaw || LANGFUSE_DEFAULT_BASE_URL;

  langfuseInstance = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
  });

  return langfuseInstance;
}

export interface TraceContext {
  traceId: string;
  sessionId?: string;
  agentName: string;
  pipelineStep: string;
  model: string;
  metadata?: Record<string, unknown>;
}

export function createTrace(ctx: TraceContext) {
  const lf = getLangfuse();
  if (!lf) return null;

  return lf.trace({
    id: ctx.traceId,
    sessionId: ctx.sessionId,
    name: `${ctx.pipelineStep}::${ctx.agentName}`,
    metadata: {
      model: ctx.model,
      pipelineStep: ctx.pipelineStep,
      ...ctx.metadata,
    },
  });
}

export interface GenerationEvent {
  traceId: string;
  name: string;
  model: string;
  input: unknown;
  output: unknown;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd: number;
  durationMs: number;
}

export function logGeneration(event: GenerationEvent) {
  const lf = getLangfuse();
  if (!lf) return;

  const trace = lf.trace({ id: event.traceId });
  trace.generation({
    name: event.name,
    model: event.model,
    input: event.input,
    output: event.output,
    usage: {
      promptTokens: event.usage.promptTokens,
      completionTokens: event.usage.completionTokens,
      totalTokens: event.usage.totalTokens,
    },
    metadata: {
      costUsd: event.costUsd,
      durationMs: event.durationMs,
    },
  });
}

export async function flushLangfuse() {
  const lf = getLangfuse();
  if (lf) await lf.flushAsync();
}
