// Step: Design — DB Snapshot
// Design metadata (selectedStyleId, designStyles, stitchResult, designSourceMode)
// is stored in steps.design.metadata via patchStepMeta — the standard helper
// persists metadata automatically.
import { createStepDataSnapshot } from "../../../_shared/snapshot-context";
import type { StepSnapshot } from "../../../_shared/types";

export const designSnapshot: StepSnapshot = createStepDataSnapshot("design");
