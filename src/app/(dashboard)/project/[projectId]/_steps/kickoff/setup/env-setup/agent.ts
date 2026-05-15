// Step: Env Setup — Environment scaffolding and kickoff
import type { StepAgent, StepAgentContext, StepResultData, SseEvent, StepAgentState } from "../../../_shared/types";

export const envSetupAgent: StepAgent = {
  async execute(ctx: StepAgentContext): Promise<StepResultData> {
    ctx.emitState({ isRunning: true, error: null });
    // The kickoff is triggered from the UI via the "Run Kick-off" button
    // which calls /api/agents/kickoff SSE endpoint directly.
    return { stepId: "env-setup", status: "completed", timestamp: new Date().toISOString() };
  },
  handleEvent(_event: SseEvent, _ctx: StepAgentContext): Partial<StepAgentState> { return {}; },
  async retry(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "env-setup", status: "completed", timestamp: new Date().toISOString() };
  },
};
