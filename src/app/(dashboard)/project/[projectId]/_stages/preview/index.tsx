"use client";

import { useStageStore, type PreviewSubStageId } from "@/store/stage-store";
import ServeSubStage from "./_sub/serve";
import E2eSubStage from "./_sub/e2e";
import type React from "react";

const SUB_VIEWS: Record<PreviewSubStageId, React.ComponentType> = {
  serve: ServeSubStage,
  e2e: E2eSubStage,
};

export default function PreviewStage() {
  const activeSubStages = useStageStore((s) => s.activeSubStages);
  const activeSubStage = activeSubStages.preview as PreviewSubStageId;
  const SubView = SUB_VIEWS[activeSubStage] ?? ServeSubStage;

  return (
    <div className="flex flex-1 overflow-hidden">
      <SubView />
    </div>
  );
}
