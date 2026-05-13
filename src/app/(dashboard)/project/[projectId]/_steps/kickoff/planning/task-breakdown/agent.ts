// Step: Task Breakdown — Review and confirm coding tasks
import type { StepAgent, StepAgentContext, StepResultData, SseEvent, StepAgentState } from "../../../_shared/types";

export const taskBreakdownAgent: StepAgent = {
  async execute(_ctx: StepAgentContext): Promise<StepResultData> {
    // Task breakdown data comes from the kickoff step in env-setup.
    // No separate agent call needed.
    return { stepId: "task-breakdown", status: "completed", timestamp: new Date().toISOString() };
  },
  handleEvent(_event: SseEvent, _ctx: StepAgentContext): Partial<StepAgentState> { return {}; },
  async retry(_ctx: StepAgentContext): Promise<StepResultData> {
    return { stepId: "task-breakdown", status: "completed", timestamp: new Date().toISOString() };
  },
};
