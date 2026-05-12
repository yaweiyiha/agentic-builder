// Step: Summary — Kickoff summary (run kickoff API via UI, display result)
// The actual API call is made directly in the UI component (like env-setup).
import type { StepAgent, StepAgentContext, StepResultData, SseEvent, StepAgentState } from "../../_shared/types";

export const summaryAgent: StepAgent = {
  async execute(_ctx: StepAgentContext): Promise<StepResultData> {
    // Kickoff is triggered via the UI button; agent is a no-op.
    return { stepId: "summary", status: "completed", timestamp: new Date().toISOString() };
  },
  handleEvent(_event: SseEvent, _ctx: StepAgentContext): Partial<StepAgentState> { return {}; },
  async retry(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "summary", status: "completed", timestamp: new Date().toISOString() };
  },
};
