"use client";

import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import KickoffStepPanel from "@/components/KickoffStepPanel";

export default function TaskBreakdownSubStage() {
  const steps        = usePipelineStore((s) => s.steps);
  const advanceStage = useStageStore((s) => s.advanceStage);
  const goToSubStage = useStageStore((s) => s.goToSubStage);

  const kickoffResult = steps.kickoff;

  if (!kickoffResult || kickoffResult.status !== "completed") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center">
            <Clock size={16} className="text-[#cbd5e1]" />
          </div>
          <p className="text-[14px] text-[#94a3b8]">
            Task breakdown will be available once environment setup completes.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => goToSubStage("env-setup", "kickoff")}
            className="text-[#712ae2]"
          >
            ← Back to Env Setup
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <KickoffStepPanel
        result={kickoffResult}
        onStartCoding={() => advanceStage()}
      />
    </div>
  );
}
