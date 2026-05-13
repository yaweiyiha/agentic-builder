"use client";

import { useEffect } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function QaSubStage() {
  const step             = usePipelineStore((s) => s.steps.qa);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const runQa            = usePipelineStore((s) => s.runQa);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "qa";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  // Auto-trigger QA generation if not yet generated and nothing is running
  useEffect(() => {
    if (!step && !isRunning) {
      runQa();
    }
  }, [step, isRunning, runQa]);

  return (
    <DocViewerSubStage
      activeTabId="qa"
      title="QA Plan"
      subtitle="Quality assurance checklist verifying all requirements are covered before kick-off"
      editPlaceholder="Ask AgenticBuilder to refine this QA plan..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="Proceed to Verify"
      onConfirm={() => goToSubStage("verify", "preparation")}
    />
  );
}
