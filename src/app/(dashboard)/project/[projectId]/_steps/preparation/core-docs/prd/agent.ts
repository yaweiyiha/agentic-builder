// Step: PRD — Product Requirements Document
// Category: doc-viewer
import { createPipelineSseAgent } from "../../../_shared/pipeline-sse-helpers";
import type { StepAgent } from "../../../_shared/types";
import type { ProjectTier } from "@/_config/pipeline-flow";

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
  onCustomEvent: (event) => {
    // Extract tier from the intent step_complete event that the pipeline emits
    // before the PRD step, so breadcrumb hides S-tier steps immediately.
    if (event.type === "step_complete" && event.stepId === "intent") {
      const data = (event.data ?? event) as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      const classif = meta?.classification as Record<string, unknown> | undefined;
      const rawTier = (classif?.tier ?? meta?.tier) as string | undefined;
      if (rawTier) {
        const tier = rawTier.toUpperCase() as ProjectTier;
        import("@/store/step-navigation-store").then(({ useStepNavigationStore }) => {
          const store = useStepNavigationStore.getState();
          if (store.tier !== tier) {
            store.setTier(tier);
          }
        }).catch(() => {/* ignore */});
      }
      return true;
    }
    return false;
  },
});
