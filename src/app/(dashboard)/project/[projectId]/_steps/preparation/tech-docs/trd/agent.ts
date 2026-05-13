// Step: TRD — Technical Requirements Document
// Category: doc-viewer
import { createParallelGenerateAgent } from "../../../_shared/pipeline-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const trdAgent: StepAgent = createParallelGenerateAgent({
  stepId: "trd",
  docId: "trd",
  buildPayload: (ctx) => ({
    prdContent: ctx.previousSteps.prd?.content ?? ctx.featureBrief,
    selectedDocs: ["trd"],
    sessionId: ctx.sessionId,
    codeOutputDir: ctx.codeOutputDir,
    tier: ctx.tier,
  }),
});
