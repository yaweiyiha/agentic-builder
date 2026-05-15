// Step: Initial — UI-only project brief input. No agent calls.
import type { StepAgent, StepAgentContext, StepResultData, SseEvent, StepAgentState } from "../../../_shared/types";

const EMPTY_STATE: StepAgentState = { streamingContent: "", streamingThinking: "", isRunning: false, error: null, totalCostUsd: 0 };

export const initialAgent: StepAgent = {
  async execute(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "initial", status: "completed", timestamp: new Date().toISOString() };
  },
  handleEvent(_event: SseEvent, _ctx: StepAgentContext): Partial<StepAgentState> { return EMPTY_STATE; },
  async retry(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "initial", status: "completed", timestamp: new Date().toISOString() };
  },
};
