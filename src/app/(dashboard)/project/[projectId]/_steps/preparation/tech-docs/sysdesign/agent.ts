// Step: System Design — Architecture overview and component design
// Category: doc-viewer
import { createParallelGenerateAgent } from "../../../_shared/pipeline-sse-helpers";
import type { StepAgent } from "../../../_shared/types";

export const sysdesignAgent: StepAgent = createParallelGenerateAgent({
  stepId: "sysdesign",
  docId: "sysdesign",
  buildPayload: (ctx) => ({
    prdContent: ctx.previousSteps.prd?.content ?? ctx.featureBrief,
    selectedDocs: ["sysdesign"],
    sessionId: ctx.sessionId,
    codeOutputDir: ctx.codeOutputDir,
    tier: ctx.tier,
  }),
});
