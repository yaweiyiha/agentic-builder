// Step: Intent — Intent recheck Q&A
import type { StepAgent, StepAgentContext, StepResultData, SseEvent, StepAgentState } from "../../../_shared/types";

export const intentAgent: StepAgent = {
  async execute(ctx: StepAgentContext): Promise<StepResultData> {
    ctx.emitState({ isRunning: true, error: null });
    // The intent step uses a specialized multi-turn Q&A flow.
    // Actual implementation delegates to the intent chat UI which calls
    // /api/agents/intent-recheck directly.
    return { stepId: "intent", status: "completed", timestamp: new Date().toISOString() };
  },
  handleEvent(_event: SseEvent, _ctx: StepAgentContext): Partial<StepAgentState> { return {}; },
  async retry(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "intent", status: "completed", timestamp: new Date().toISOString() };
  },
};
