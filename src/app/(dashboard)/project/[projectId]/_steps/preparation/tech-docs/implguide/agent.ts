// Step: Implementation Guide — Step-by-step implementation instructions
// Category: doc-viewer
import { createParallelGenerateAgent } from "../../../_shared/pipeline-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const implguideAgent: StepAgent = createParallelGenerateAgent({
  stepId: "implguide",
  docId: "implguide",
  buildPayload: (ctx) => ({
    prdContent: ctx.previousSteps.prd?.content ?? ctx.featureBrief,
    selectedDocs: ["implguide"],
    sessionId: ctx.sessionId,
    codeOutputDir: ctx.codeOutputDir,
    tier: ctx.tier,
  }),
});
