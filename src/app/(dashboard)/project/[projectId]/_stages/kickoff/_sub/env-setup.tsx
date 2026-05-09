"use client";

import { Clock, ArrowRight, Zap, Loader2 } from "lucide-react";
import { motion } from "motion/react";

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
  const isRunning     = usePipelineStore((s) => s.isRunning);
  const currentStep   = usePipelineStore((s) => s.currentStep);
  const kickoffResult = usePipelineStore((s) => s.steps.kickoff);
  const runKickoff    = usePipelineStore((s) => s.runKickoff);
  const featureBrief  = usePipelineStore((s) => s.featureBrief);
  const goToSubStage  = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "kickoff";
  const isCompleted   = kickoffResult?.status === "completed";
  const canRun        = !isRunning && !!featureBrief.trim();

  if (!kickoffResult || !isCompleted) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-5 text-center max-w-sm"
        >
          {/* Icon */}
          <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${
            isThisRunning ? "border-[#712ae2]/30 bg-[#712ae2]/5" : "border-[#e2e8f0]"
          }`}>
            {isThisRunning
              ? <Loader2 size={18} className="text-[#712ae2] animate-spin" />
              : <Clock size={18} className="text-[#cbd5e1]" />
            }
          </div>

          {/* Message */}
          <p className="text-[14px] text-[#94a3b8] leading-6">
            {isThisRunning
              ? "Kick-off is running — environment requirements will appear here when it completes."
              : !featureBrief.trim()
                ? "Complete the preparation stage first to generate a feature brief, then run Kick-off."
                : "Preparation is ready. Run Kick-off to detect environment requirements and generate the task breakdown."}
          </p>

          {/* Run Kick-off button — shown only when kickoff hasn't run and not currently running */}
          {!isThisRunning && (
            <Button
              disabled={!canRun}
              onClick={runKickoff}
              className="bg-[#712ae2] hover:bg-[#5f24c2] font-bold px-6 gap-2 disabled:opacity-40"
            >
              <Zap size={15} />
              Run Kick-off
            </Button>
          )}
        </motion.div>
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
