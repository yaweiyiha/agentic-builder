import { createCodingAgentLogAgent } from "../../../_shared/coding-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const testAgent: StepAgent = createCodingAgentLogAgent({
  stepId: "test",
  role: "test",
});
