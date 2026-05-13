import type { StepSnapshot } from "../../_shared/types";

export const agentsSnapshot: StepSnapshot = {
  async load() { return null; },
  async save() {},
  getContextFromPrevious() { return {}; },
};
