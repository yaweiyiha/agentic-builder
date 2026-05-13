// ── Coding SSE Helpers ───────────────────────────────────────────────────────
//
// Factory for creating StepAgent instances for the coding stage agent-log steps
// (architect, backend, frontend, test). These steps observe the coding-store
// rather than managing their own SSE connection — the coding session is
// managed centrally by the CodingAgentGraph / coding-store.

import type { StepAgent, StepAgentContext, SseEvent, StepAgentState, StepResultData } from "./types";
import type { StepId } from "@/_config/pipeline-flow";
import type { CodingAgentRole } from "@/lib/pipeline/types";

interface CodingAgentLogOptions {
  stepId: StepId;
  role: CodingAgentRole;
}

/**
 * Creates a thin agent wrapper for coding agent-log steps.
 * These steps don't manage their own SSE — the coding-store handles that.
 * This agent provides the interface contract but delegates execution to
 * the shared coding infrastructure.
 */
export function createCodingAgentLogAgent(options: CodingAgentLogOptions): StepAgent {
  const { stepId, role } = options;

  // The coding-store module path — lazy-imported to avoid circular deps
  const CODING_STORE_PATH = "@/store/coding-store";

  return {
    async execute(ctx: StepAgentContext): Promise<StepResultData> {
      // Coding agents are started centrally via startCoding() in the coding-store,
      // not individually. This execute() is a no-op for individual agent-log steps.
      // The actual work happens when the user clicks "Start Coding" from the
      // task-breakdown step, which calls useCodingStore.startCoding().
      ctx.emitState({ isRunning: true, error: null });

      return {
        stepId,
        status: "completed",
        timestamp: new Date().toISOString(),
        metadata: { role, managedBy: "coding-store" },
      };
    },

    handleEvent(event: SseEvent, _ctx: StepAgentContext): Partial<StepAgentState> {
      // Events are handled centrally by coding-store.handleCodingEvent()
      return {};
    },

    async retry(_ctx: StepAgentContext): Promise<StepResultData> {
      // Retry is handled by coding-store.retryFailedTasks()
      return {
        stepId,
        status: "completed",
        timestamp: new Date().toISOString(),
        metadata: { role, retried: true, managedBy: "coding-store" },
      };
    },
  };
}
