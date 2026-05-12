import { createCodingAgentLogAgent } from "../../../_shared/coding-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const architectAgent: StepAgent = createCodingAgentLogAgent({
  stepId: "architect",
  role: "architect",
});
