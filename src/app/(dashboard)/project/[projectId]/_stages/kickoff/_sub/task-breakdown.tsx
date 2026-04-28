"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import { useCodingStore } from "@/store/coding-store";
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
            </svg>
          </div>
          <p className="text-[14px] text-[#94a3b8]">
            Task breakdown will be available once environment setup completes.
          </p>
          <button
            onClick={() => goToSubStage("env-setup", "kickoff")}
            className="text-[13px] font-semibold text-[#712ae2] hover:underline"
          >
            ← Back to Env Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <KickoffStepPanel
        result={kickoffResult}
        onStartCoding={() => {
          // Move to the coding stage
          advanceStage();
        }}
      />
    </div>
  );
}
