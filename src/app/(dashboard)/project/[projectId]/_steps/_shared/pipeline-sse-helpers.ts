// ── Pipeline SSE Helpers ─────────────────────────────────────────────────────
//
// Factory functions that create StepAgent implementations for steps that
// communicate via SSE (Server-Sent Events) with the pipeline API endpoints.
//
// Two SSE patterns are supported:
//   1. Pipeline SSE  – standard step_start / step_stream / step_complete / done
//   2. Parallel SSE  – doc_stream / doc_complete / generation_complete

import type { StepAgent, StepAgentContext, SseEvent, StepAgentState, StepResultData } from "./types";
import type { StepId } from "@/_config/pipeline-flow";

// ── Generic SSE stream reader ─────────────────────────────────────────────────

async function readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (payload: Record<string, unknown>) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        /* skip malformed */
      }
    }
  }

  // Process final line
  if (buffer.startsWith("data: ")) {
    try {
      onEvent(JSON.parse(buffer.slice(6)));
    } catch {
      /* skip */
    }
  }
}

// ── Factory: Pipeline SSE Agent ───────────────────────────────────────────────

interface PipelineSseOptions {
  stepId: StepId;
  apiEndpoint: string;
  /** Build the POST body from the context */
  buildPayload: (ctx: StepAgentContext) => Record<string, unknown>;
  /** Optional custom event handler for step-specific events */
  onCustomEvent?: (
    event: SseEvent,
    set: (s: Partial<StepAgentState>) => void,
    get: () => StepAgentState,
  ) => boolean; // returns true if event was handled
}

export function createPipelineSseAgent(options: PipelineSseOptions): StepAgent {
  const { stepId, apiEndpoint, buildPayload, onCustomEvent } = options;

  return {
    async execute(ctx: StepAgentContext): Promise<StepResultData> {
      ctx.emitState({ isRunning: true, error: null, streamingContent: "", streamingThinking: "" });

      let resultContent = "";
      let resultCost = 0;
      let resultDuration = 0;
      let resultError: string | undefined;

      try {
        const resp = await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(ctx)),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          const msg = (errData as { error?: string }).error || `${stepId} request failed`;
          ctx.emitState({ isRunning: false, error: msg });
          return {
            stepId,
            status: "failed",
            error: msg,
            timestamp: new Date().toISOString(),
          };
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          ctx.emitState({ isRunning: false, error: "No response body" });
          return { stepId, status: "failed", error: "No response body", timestamp: new Date().toISOString() };
        }

        await readSseStream(reader, (payload) => {
          const event = payload as SseEvent;
          const type = event.type;

          // Custom handler first
          if (onCustomEvent) {
            const state = ctx.getState();
            const handled = onCustomEvent(event, (s) => ctx.emitState(s), () => state);
            if (handled) return;
          }

          // Only process events for this agent's stepId
          if (stepId && (type === "step_stream" || type === "step_complete" || type === "step_start") && event.stepId && event.stepId !== stepId) {
            return;
          }

          switch (type) {
            case "step_start":
              ctx.emitState({ streamingContent: "", streamingThinking: "" });
              break;

            case "step_stream": {
              const chunk = event.chunk ?? (event.data as { chunk?: string } | undefined)?.chunk ?? "";
              const chunkType = event.chunkType ?? (event.data as { chunkType?: string } | undefined)?.chunkType;
              if (chunkType === "thinking") {
                const current = ctx.getState().streamingThinking;
                ctx.emitState({ streamingThinking: current + chunk });
              } else {
                const current = ctx.getState().streamingContent;
                ctx.emitState({ streamingContent: current + chunk });
              }
              break;
            }

            case "step_complete": {
              const data = (event.data ?? event) as Record<string, unknown>;
              resultContent = (data.content as string) || resultContent;
              resultCost = (data.costUsd as number) || resultCost;
              resultDuration = (data.durationMs as number) || resultDuration;
              ctx.emitState({ isRunning: false, streamingContent: "", streamingThinking: "" });
              break;
            }

            case "done":
              ctx.emitState({ isRunning: false });
              break;

            case "error":
              resultError = event.error || "Pipeline error";
              ctx.emitState({ isRunning: false, error: resultError });
              break;
          }
        });

      } catch (err) {
        resultError = err instanceof Error ? err.message : "Unknown error";
        ctx.emitState({ isRunning: false, error: resultError });
      }

      if (resultError) {
        return { stepId, status: "failed", error: resultError, timestamp: new Date().toISOString() };
      }

      return {
        stepId,
        status: "completed",
        content: resultContent,
        costUsd: resultCost,
        durationMs: resultDuration,
        timestamp: new Date().toISOString(),
      };
    },

    handleEvent(event: SseEvent, ctx: StepAgentContext): Partial<StepAgentState> {
      if (event.type === "step_stream") {
        const chunk = event.chunk ?? "";
        if (event.chunkType === "thinking") {
          return { streamingThinking: ctx.getState().streamingThinking + chunk };
        }
        return { streamingContent: ctx.getState().streamingContent + chunk };
      }
      return {};
    },

    async retry(ctx: StepAgentContext): Promise<StepResultData> {
      return this.execute(ctx);
    },
  };
}

// ── Factory: Parallel Generate Agent ──────────────────────────────────────────

interface ParallelGenerateOptions {
  stepId: StepId;
  docId: string; // The doc identifier used in parallel-generate (e.g. "trd", "design", "qa")
  buildPayload: (ctx: StepAgentContext) => Record<string, unknown>;
}

export function createParallelGenerateAgent(options: ParallelGenerateOptions): StepAgent {
  const { stepId, docId, buildPayload } = options;

  return {
    async execute(ctx: StepAgentContext): Promise<StepResultData> {
      ctx.emitState({ isRunning: true, error: null, streamingContent: "", streamingThinking: "" });

      let resultContent = "";
      let resultCost = 0;
      let resultDuration = 0;
      let resultError: string | undefined;

      try {
        const resp = await fetch("/api/agents/parallel-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(ctx)),
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          const msg = (errData as { error?: string }).error || `${stepId} generation failed`;
          ctx.emitState({ isRunning: false, error: msg });
          return { stepId, status: "failed", error: msg, timestamp: new Date().toISOString() };
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          ctx.emitState({ isRunning: false, error: "No response body" });
          return { stepId, status: "failed", error: "No response body", timestamp: new Date().toISOString() };
        }

        await readSseStream(reader, (payload) => {
          const event = payload as SseEvent;
          const type = event.type;

          switch (type) {
            case "doc_stream": {
              const chunk = (event.chunk as string) ?? "";
              if (chunk) {
                resultContent += chunk;
                ctx.emitState({ streamingContent: resultContent });
              }
              break;
            }

            case "doc_complete":
              if (event.docId === docId || (payload as Record<string, unknown>).docId === docId) {
                resultContent = (event.content as string) || resultContent;
                resultCost = (event.costUsd as number) || resultCost;
                resultDuration = (event.durationMs as number) || resultDuration;
                ctx.emitState({ streamingContent: "" });
              }
              break;

            case "generation_complete":
              ctx.emitState({ isRunning: false });
              break;

            case "error":
              resultError = event.error || "Parallel generation error";
              ctx.emitState({ isRunning: false, error: resultError });
              break;
          }
        });

      } catch (err) {
        resultError = err instanceof Error ? err.message : "Unknown error";
        ctx.emitState({ isRunning: false, error: resultError });
      }

      if (resultError) {
        return { stepId, status: "failed", error: resultError, timestamp: new Date().toISOString() };
      }

      return {
        stepId,
        status: "completed",
        content: resultContent,
        costUsd: resultCost,
        durationMs: resultDuration,
        timestamp: new Date().toISOString(),
      };
    },

    handleEvent(event: SseEvent, _ctx: StepAgentContext): Partial<StepAgentState> {
      if (event.type === "doc_stream") {
        return {}; // handled in execute() streaming loop
      }
      return {};
    },

    async retry(ctx: StepAgentContext): Promise<StepResultData> {
      return this.execute(ctx);
    },
  };
}
