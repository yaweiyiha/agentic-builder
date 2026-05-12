"use client";

import { useStageStore, type KickoffSubStageId } from "@/store/stage-store";
import EnvSetupSubStage from "./_sub/env-setup";
import SummarySubStage from "./_sub/summary";
import TaskBreakdownSubStage from "./_sub/task-breakdown";
import type React from "react";

const SUB_VIEWS: Record<KickoffSubStageId, React.ComponentType> = {
  "env-setup": EnvSetupSubStage,
  "summary": SummarySubStage,
  "task-breakdown": TaskBreakdownSubStage,
};

export default function KickoffStage() {
  const activeSubStages = useStageStore((s) => s.activeSubStages);
  const activeSubStage = activeSubStages.kickoff as KickoffSubStageId;
  const SubView = SUB_VIEWS[activeSubStage] ?? SummarySubStage;

  return (
    <div className="flex flex-1 overflow-hidden">
      <SubView />
    </div>
  );
}
