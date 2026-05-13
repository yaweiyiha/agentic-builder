// Step: TRD — DB Snapshot
import { createStepSnapshot } from "../../../_shared/snapshot-context";
import type { StepSnapshot } from "../../../_shared/types";
import { useStepStore } from "@/store/step-store";

export const trdSnapshot: StepSnapshot = createStepSnapshot({
  stepId: "trd",
  serialize: () => {
    const s = useStepStore.getState();
    return {
      featureBrief: s.featureBrief,
      steps: s.steps as Record<string, unknown>,
      totalCostUsd: s.totalCostUsd,
      codeOutputDir: s.codeOutputDir,
    };
  },
  deserialize: (snapshot) => {
    const s = useStepStore.getState();
    if (snapshot.steps) {
      // Merge snapshot steps without clobbering existing non-null step data.
      // This prevents a stale TRD snapshot (saved before design was complete)
      // from overwriting the design step when the user navigates to TRD.
      const mergedSteps = { ...s.steps };
      const snapSteps = snapshot.steps as Record<string, unknown>;
      for (const key of Object.keys(snapSteps)) {
        const snapVal = snapSteps[key];
        const curVal = (s.steps as Record<string, unknown>)[key];
        // Only override if snapshot has actual data or current value is null
        if (snapVal != null || curVal == null) {
          (mergedSteps as Record<string, unknown>)[key] = snapVal;
        }
      }
      useStepStore.setState({
        steps: mergedSteps as typeof s.steps,
        featureBrief: snapshot.featureBrief as string ?? s.featureBrief,
        totalCostUsd: snapshot.totalCostUsd as number ?? s.totalCostUsd,
        codeOutputDir: snapshot.codeOutputDir as string ?? s.codeOutputDir,
      });
    }
  },
});
