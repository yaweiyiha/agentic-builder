// Step: Mockup — AI-generated visual mockup
// Category: doc-viewer
import { createParallelGenerateAgent } from "../../../_shared/pipeline-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const mockupAgent: StepAgent = createParallelGenerateAgent({
  stepId: "mockup",
  docId: "mockup",
  buildPayload: (ctx) => ({
    prdContent: ctx.previousSteps.prd?.content ?? ctx.featureBrief,
    selectedDocs: ["mockup"],
    sessionId: ctx.sessionId,
    codeOutputDir: ctx.codeOutputDir,
    tier: ctx.tier,
  }),
});
