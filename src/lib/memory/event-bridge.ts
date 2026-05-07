/**
 * Event bridge — wraps a PipelineEvent handler so memory writes happen as a
 * side effect of pipeline events. The wrapped engine is unchanged: we only
 * intercept the onEvent callback path.
 *
 * Lifecycle per runId:
 *   - First step_complete for "intent": capture brief + classification,
 *     write project-card.
 *   - Each step_start: stamp startedAt for the step.
 *   - Each step_complete / step_error: write task-history.
 *
 * All writes are fire-and-forget — the wrapped handler always invokes the
 * original synchronously so the SSE stream is not delayed.
 */

import type { PipelineEvent } from "@/lib/pipeline/types";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";

import { recordProjectCard, recordTaskHistory } from "./recorders";
import { memoryEnabled } from "./env";

interface RunState {
  brief?: string;
  outputDir: string;
  cardWritten: boolean;
  startedAt: Map<string, number>;
  /** stepIds that have already received step_complete; engine sometimes
   *  re-emits step_complete (e.g. emitPrdStepCompleteRefresh) and we don't
   *  want to write the same task-history twice. */
  completed: Set<string>;
}

export interface BridgeOptions {
  /** Root of the AgenticBuilder repo (passed to PipelineEngine constructor). */
  projectRoot: string;
  /** Optional override for code output root (per-call). */
  codeOutputDir?: string;
  /** Optional brief — if provided up front, skips waiting for intent step. */
  featureBrief?: string;
  /**
   * Stable session id that survives across pipeline-route → kickoff-route
   * transitions. When provided, all memory records use this id as their
   * kickoffId instead of `event.runId`, so records from both API calls
   * link to the same session.
   */
  kickoffIdOverride?: string;
}

export type EventHandler = (event: PipelineEvent) => void;

export function wrapPipelineEventHandler(
  inner: EventHandler,
  opts: BridgeOptions,
): EventHandler {
  if (!memoryEnabled()) return inner;
  const states = new Map<string, RunState>();
  const outputDir = resolveCodeOutputRoot(opts.projectRoot, opts.codeOutputDir);

  return (event: PipelineEvent) => {
    // Always invoke the inner handler first so SSE stream is preserved.
    try {
      inner(event);
    } finally {
      try {
        handle(event, states, outputDir, opts);
      } catch {
        // Bridge must never throw into the engine.
      }
    }
  };
}

function handle(
  event: PipelineEvent,
  states: Map<string, RunState>,
  outputDir: string,
  opts: BridgeOptions,
): void {
  const kickoffId = opts.kickoffIdOverride ?? event.runId;
  const state =
    states.get(event.runId) ??
    states.set(event.runId, {
      brief: opts.featureBrief,
      outputDir,
      cardWritten: false,
      startedAt: new Map(),
      completed: new Set(),
    }).get(event.runId)!;

  const tokenUsage = event.data.tokenUsage;
  const totalTokens =
    tokenUsage && typeof tokenUsage.totalTokens === "number"
      ? tokenUsage.totalTokens
      : undefined;

  switch (event.type) {
    case "step_start":
      state.startedAt.set(event.stepId, Date.now());
      // Fire-and-forget: best-effort task-history(in_progress).
      void recordTaskHistory({
        outputDir: state.outputDir,
        kickoffId,
        taskId: event.stepId,
        status: "in_progress",
        attempts: 1,
        startedAt: state.startedAt.get(event.stepId),
        tags: [`step:${event.stepId}`],
      });
      break;

    case "step_complete": {
      // Dedup: engine occasionally re-emits step_complete for the same
      // (runId, stepId) (e.g. emitPrdStepCompleteRefresh). Honor only the
      // first; idempotent save would still produce the right end state but
      // we avoid the wasted disk write + duplicate trace line.
      if (state.completed.has(event.stepId)) break;
      state.completed.add(event.stepId);

      const startedAt = state.startedAt.get(event.stepId);
      const endedAt = Date.now();
      const durationMs =
        typeof event.data.durationMs === "number"
          ? event.data.durationMs
          : startedAt
            ? endedAt - startedAt
            : undefined;

      // Capture brief from intent step if not already set.
      if (event.stepId === "intent" && typeof event.data.content === "string") {
        state.brief = state.brief ?? event.data.content;
      }

      // Project card: written once after intent (which carries the
      // classification metadata in event.data.metadata).
      if (!state.cardWritten && event.stepId === "intent") {
        const cls = (event.data.metadata as Record<string, unknown> | undefined)
          ?.classification as ProjectCardClassification | undefined;
        void recordProjectCard({
          outputDir: state.outputDir,
          kickoffId,
          brief: state.brief ?? "",
          classification: cls,
        });
        state.cardWritten = true;
      }

      void recordTaskHistory({
        outputDir: state.outputDir,
        kickoffId,
        taskId: event.stepId,
        status: "completed",
        attempts: 1,
        costUsd: typeof event.data.costUsd === "number" ? event.data.costUsd : undefined,
        durationMs,
        totalTokens,
        startedAt,
        endedAt,
        tags: [`step:${event.stepId}`],
      });
      break;
    }

    case "step_error": {
      const startedAt = state.startedAt.get(event.stepId);
      const endedAt = Date.now();
      void recordTaskHistory({
        outputDir: state.outputDir,
        kickoffId,
        taskId: event.stepId,
        status: "failed",
        attempts: 1,
        durationMs: startedAt ? endedAt - startedAt : undefined,
        totalTokens,
        errorMessage: event.data.error,
        startedAt,
        endedAt,
        tags: [`step:${event.stepId}`],
      });
      break;
    }

    case "pipeline_complete":
      states.delete(event.runId);
      break;

    case "step_stream":
      // streaming chunks — not recorded
      break;
  }
}

interface ProjectCardClassification {
  tier?: "S" | "M" | "L";
  type?: string;
  needsBackend?: boolean;
  needsDatabase?: boolean;
  needsAuth?: boolean;
  reasoning?: string;
}
