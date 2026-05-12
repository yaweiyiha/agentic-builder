// Coding verification state is managed by coding-store. No independent snapshot.
import type { StepSnapshot } from "../../../_shared/types";

export const codingVerifySnapshot: StepSnapshot = {
  async load() { return null; },
  async save() {},
  getContextFromPrevious() { return {}; },
};
