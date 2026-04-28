"use client";

import { useStageStore, type CodingSubStageId } from "@/store/stage-store";
import ArchitectSubStage from "./_sub/architect";
import BackendSubStage from "./_sub/backend";
import FrontendSubStage from "./_sub/frontend";
import TestSubStage from "./_sub/test";
import VerifySubStage from "./_sub/verify";
import type React from "react";

const SUB_VIEWS: Record<CodingSubStageId, React.ComponentType> = {
  architect: ArchitectSubStage,
  backend: BackendSubStage,
  frontend: FrontendSubStage,
  test: TestSubStage,
  verify: VerifySubStage,
};

export default function CodingStage() {
  const activeSubStages = useStageStore((s) => s.activeSubStages);
  const activeSubStage = activeSubStages.coding as CodingSubStageId;
  const SubView = SUB_VIEWS[activeSubStage] ?? ArchitectSubStage;

  return (
    <div className="flex flex-1 overflow-hidden">
      <SubView />
    </div>
  );
}
