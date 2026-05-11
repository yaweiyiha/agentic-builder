"use client";

import { useStageStore, type PreparationSubStageId } from "@/store/stage-store";

import InitialSubStage    from "./_sub/initial";
import IntentSubStage     from "./_sub/intent";
import PrdSubStage        from "./_sub/prd";
import TrdSubStage        from "./_sub/trd";
import SysdesignSubStage  from "./_sub/sysdesign";
import ImplguideSubStage  from "./_sub/implguide";
import DesignSubStage     from "./_sub/design";
import MockupSubStage     from "./_sub/mockup";
import QaSubStage         from "./_sub/qa";
import VerifySubStage     from "./_sub/verify";
import type React from "react";

const SUB_VIEWS: Record<PreparationSubStageId, React.ComponentType> = {
  initial:   InitialSubStage,
  intent:    IntentSubStage,
  prd:       PrdSubStage,
  trd:       TrdSubStage,
  sysdesign: SysdesignSubStage,
  implguide: ImplguideSubStage,
  design:    DesignSubStage,
  mockup:    MockupSubStage,
  qa:        QaSubStage,
  verify:    VerifySubStage,
};

export default function PreparationStage() {
  const activeSubStages = useStageStore((s) => s.activeSubStages);
  const activeSubStage  = activeSubStages.preparation as PreparationSubStageId;
  const SubView         = SUB_VIEWS[activeSubStage] ?? InitialSubStage;

  return (
    <div className="flex flex-col h-full w-full">
      <SubView />
    </div>
  );
}
