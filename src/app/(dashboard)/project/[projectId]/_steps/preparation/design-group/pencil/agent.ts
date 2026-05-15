// Step: Pencil — AI-generated wireframe design
// Category: doc-viewer
import { createParallelGenerateAgent } from "../../../_shared/pipeline-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const pencilAgent: StepAgent = createParallelGenerateAgent({
  stepId: "pencil",
  docId: "pencil",
  buildPayload: (ctx) => ({
    prdContent: ctx.previousSteps.prd?.content ?? ctx.featureBrief,
    selectedDocs: ["pencil"],
    sessionId: ctx.sessionId,
    codeOutputDir: ctx.codeOutputDir,
    tier: ctx.tier,
    designStyleId: (ctx.previousSteps.design?.metadata as Record<string, unknown> | undefined)?.designStyleId,
    designSpecContent: ctx.previousSteps.design?.content ?? "",
  }),
});
