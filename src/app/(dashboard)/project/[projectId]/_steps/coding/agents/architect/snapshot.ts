// Coding agent-log steps are managed by coding-store. No independent snapshot.
import type { StepSnapshot } from "../../../_shared/types";

export const architectSnapshot: StepSnapshot = {
  async load() { return null; },
  async save() {},
  getContextFromPrevious() { return {}; },
};
