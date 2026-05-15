// Coding agents state is managed by coding-store — the UI calls startCoding
// directly and saves the result via setStepResult on completion.
import type { StepAgent, StepAgentContext, StepResultData, StepAgentState } from "../../_shared/types";

export const agentsAgent: StepAgent = {
  async execute(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "agents", status: "completed", timestamp: new Date().toISOString() };
  },
  handleEvent(_event, _ctx): Partial<StepAgentState> {
    return {};
  },
  async retry(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "agents", status: "completed", timestamp: new Date().toISOString() };
  },
};
