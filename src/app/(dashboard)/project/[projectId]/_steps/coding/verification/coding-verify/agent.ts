// Step: Coding Verify — Integration verification after coding
import type { StepAgent, StepAgentContext, StepResultData, SseEvent, StepAgentState } from "../../../_shared/types";

export const codingVerifyAgent: StepAgent = {
  async execute(_ctx: StepAgentContext): Promise<StepResultData> {
    // Integration verification is managed by the coding-store.
    // No separate agent call needed.
    return { stepId: "coding-verify", status: "completed", timestamp: new Date().toISOString() };
  },
  handleEvent(_event: SseEvent, _ctx: StepAgentContext): Partial<StepAgentState> { return {}; },
  async retry(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "coding-verify", status: "completed", timestamp: new Date().toISOString() };
  },
};
