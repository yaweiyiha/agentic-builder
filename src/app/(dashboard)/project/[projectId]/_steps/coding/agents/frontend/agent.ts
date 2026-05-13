import { createCodingAgentLogAgent } from "../../../_shared/coding-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const frontendAgent: StepAgent = createCodingAgentLogAgent({
  stepId: "frontend",
  role: "frontend",
});
