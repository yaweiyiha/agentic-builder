// Step: Initial — Brief input, no separate snapshot (brief is saved in step-store)
import type { StepSnapshot } from "../../../_shared/types";

export const initialSnapshot: StepSnapshot = {
  async load() { return null; },
  async save() {},
  getContextFromPrevious() { return {}; },
};
