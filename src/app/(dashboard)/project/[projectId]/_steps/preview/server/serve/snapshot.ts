import type { StepSnapshot } from "../../../_shared/types";

export const serveSnapshot: StepSnapshot = {
  async load() { return null; },
  async save() {},
  getContextFromPrevious() { return {}; },
};
