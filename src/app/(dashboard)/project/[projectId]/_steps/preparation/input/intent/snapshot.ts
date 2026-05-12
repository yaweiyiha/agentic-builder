// Step: Intent — Intent conversation snapshot
import type { StepSnapshot } from "../../../_shared/types";
import { useStepStore } from "@/store/step-store";

export const intentSnapshot: StepSnapshot = {
  async load(projectSlug: string) {
    // Delegate to step-store which restores intentMessages + intentEnrichedBrief
    await useStepStore.getState().loadStepSnapshot("intent");
    return null;
  },
  async save(projectSlug: string, data: Record<string, unknown>) {
    // Delegate to step-store.saveIntentSnapshot which saves intentMessages
    const s = useStepStore.getState();
    s.saveIntentSnapshot(
      (data.intentMessages as unknown[]) ?? [],
      (data.intentEnrichedBrief as string) ?? "",
    );
  },
  getContextFromPrevious(previousSnapshot: unknown) {
    const snap = previousSnapshot as Record<string, unknown> | null;
    return { featureBrief: snap?.featureBrief };
  },
};
