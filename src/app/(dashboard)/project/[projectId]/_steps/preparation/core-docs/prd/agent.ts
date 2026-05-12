// Step: PRD — Product Requirements Document
// Category: doc-viewer
import { createPipelineSseAgent } from "../../../_shared/pipeline-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const prdAgent: StepAgent = createPipelineSseAgent({
  stepId: "prd",
  apiEndpoint: "/api/agents/pipeline",
  buildPayload: (ctx) => ({
    featureBrief: ctx.featureBrief,
    codeOutputDir: ctx.codeOutputDir,
    sessionId: ctx.sessionId,
    ...(ctx.editInstruction ? {
      prdEditInstruction: ctx.editInstruction,
      existingPrd: ctx.previousSteps.prd?.content ?? "",
    } : {}),
  }),
});
