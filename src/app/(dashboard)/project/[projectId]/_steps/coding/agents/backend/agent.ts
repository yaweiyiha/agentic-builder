import { createCodingAgentLogAgent } from "../../../_shared/coding-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const backendAgent: StepAgent = createCodingAgentLogAgent({
  stepId: "backend",
  role: "backend",
});
