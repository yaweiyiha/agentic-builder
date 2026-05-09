"use client";

import { Clock } from "lucide-react";

import KickoffTasksView from "@/components/kickoff/KickoffTasksView";
import { useKickoffStepData } from "@/components/kickoff/useKickoffStepData";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";

/**
 * Kickoff · Task-breakdown sub-stage.
 *
 * Renders the tasks half of the kickoff result: parsed task list,
 * confirm/review/regenerate controls, and the start-coding handoff.
 * `KickoffTasksView` itself owns all the rich UI; this sub-stage is a
 * thin route shim that gates on completion and wires up the start-coding
 * action via `advanceStage()`.
 */
export default function TaskBreakdownSubStage() {
  const kickoffResult = usePipelineStore((s) => s.steps.kickoff);
  const advanceStage = useStageStore((s) => s.advanceStage);
  const goToSubStage = useStageStore((s) => s.goToSubStage);

  if (!kickoffResult || kickoffResult.status !== "completed") {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
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
    <KickoffTaskBreakdownContent onStartCoding={() => advanceStage()} />
  );
}

function KickoffTaskBreakdownContent({
  onStartCoding,
}: {
  onStartCoding: () => void;
}) {
  const result = usePipelineStore((s) => s.steps.kickoff)!;
  const data = useKickoffStepData(result, { onStartCoding });

  return (
    <div className="flex flex-1 flex-col h-full overflow-auto bg-white">
      <div className="flex flex-col gap-6 px-5 py-6 w-full">
        <div className="flex items-center justify-between pb-2">
          <h1 className="text-2xl font-semibold text-[#0b1c30] tracking-tight">
            Task Breakdown
          </h1>
        </div>
        <Separator />

        <KickoffTasksView result={result} data={data} />
      </div>
    </div>
  );
}
