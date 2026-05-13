import type { StepAgent } from "../../_shared/types";

export const agentsAgent: StepAgent = {
  async execute(params) {
    return { success: true };
  },
};
