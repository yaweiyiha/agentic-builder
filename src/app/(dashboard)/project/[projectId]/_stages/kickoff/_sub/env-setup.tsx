"use client";

import { Clock, ArrowRight } from "lucide-react";

import KickoffSummaryView from "@/components/kickoff/KickoffSummaryView";
import { useKickoffStepData } from "@/components/kickoff/useKickoffStepData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";

/**
 * Kickoff · Env-setup sub-stage.
 *
 * Surfaces the kickoff result's summary half: AI-generated brief,
 * resource-requirement detection (API keys / OAuth secrets), and the
 * push-generated-code panel. The "tasks" half lives in the sibling
 * task-breakdown sub-stage.
 */
export default function EnvSetupSubStage() {
  const isRunning = usePipelineStore((s) => s.isRunning);
  const currentStep = usePipelineStore((s) => s.currentStep);
  const kickoffResult = usePipelineStore((s) => s.steps.kickoff);
  const goToSubStage = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "kickoff";
  const isCompleted = kickoffResult?.status === "completed";

  if (!kickoffResult || !isCompleted) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center">
            <Clock size={16} className="text-[#cbd5e1]" />
          </div>
          <p className="text-[14px] text-[#94a3b8]">
            {isThisRunning
              ? "Kick-off is running — environment requirements will appear here when it completes."
              : "Kick-off has not run yet. Complete the preparation stage first."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <KickoffEnvSetupContent
      onGoToTaskBreakdown={() => goToSubStage("task-breakdown", "kickoff")}
    />
  );
}

function KickoffEnvSetupContent({
  onGoToTaskBreakdown,
}: {
  onGoToTaskBreakdown: () => void;
}) {
  // Re-narrow to non-null inside the inner component so the hook only runs
  // when we know there's a kickoff result.
  const result = usePipelineStore((s) => s.steps.kickoff)!;
  const data = useKickoffStepData(result);

  return (
    <div className="flex flex-1 flex-col h-full overflow-auto bg-white">
      <div className="flex flex-col gap-6 px-5 py-6 w-full">
        <div className="flex items-center justify-between pb-2">
          <h1 className="text-2xl font-semibold text-[#0b1c30] tracking-tight">
            Environment & Resources
          </h1>
          <Badge variant="success" className="rounded text-[11px] font-bold">
            Kick-off ready
          </Badge>
        </div>
        <Separator />

        <KickoffSummaryView result={result} data={data} />

        <div className="flex justify-end pt-4">
          <Button
            onClick={onGoToTaskBreakdown}
            className="bg-[#712ae2] hover:bg-[#5f24c2] font-bold px-6"
          >
            Continue to Task breakdown
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
