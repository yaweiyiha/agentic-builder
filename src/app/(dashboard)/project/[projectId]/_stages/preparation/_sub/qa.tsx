"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function QaSubStage() {
  const step             = usePipelineStore((s) => s.steps.qa);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "qa";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

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
