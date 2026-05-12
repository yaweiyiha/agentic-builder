// Step: Intent — Intent conversation snapshot
import type { StepSnapshot } from "../../../_shared/types";
import { useStepStore } from "@/store/step-store";

export const intentSnapshot: StepSnapshot = {
  async load(projectSlug: string) {
    // Loading is handled by step-store.loadStepSnapshot
    return null;
  },
  async save(projectSlug: string, data: Record<string, unknown>) {
    // Handled by step-store.saveIntentSnapshot
  },
  getContextFromPrevious(previousSnapshot: unknown) {
    const snap = previousSnapshot as Record<string, unknown> | null;
    return { featureBrief: snap?.featureBrief };
  },
};
