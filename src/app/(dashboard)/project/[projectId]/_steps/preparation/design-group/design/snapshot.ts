// Step: Design — DB Snapshot
// Design metadata (selectedStyleId, designStyles, stitchResult, designSourceMode)
// is now stored in steps.design.metadata via patchStepMeta in the UI,
// so it flows through the standard step-store snapshot without any special override.
import { createStepSnapshot } from "../../../_shared/snapshot-context";
import type { StepSnapshot } from "../../../_shared/types";
import { useStepStore } from "@/store/step-store";

export const designSnapshot: StepSnapshot = createStepSnapshot<Record<string, unknown>>({
  stepId: "design",
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
      useStepStore.setState({
        steps: { ...s.steps, ...(snapshot.steps as typeof s.steps) },
        featureBrief: (snapshot.featureBrief as string) ?? s.featureBrief,
        totalCostUsd: (snapshot.totalCostUsd as number) ?? s.totalCostUsd,
        codeOutputDir: (snapshot.codeOutputDir as string) ?? s.codeOutputDir,
      });
    }
  },
});
