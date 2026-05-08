"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function ImplguideSubStage() {
  const step             = usePipelineStore((s) => s.steps.implguide);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "implguide";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  return (
    <DocViewerSubStage
      title="Implementation Guide"
      subtitle="Step-by-step coding roadmap with file structure, dependencies, and milestones"
      editPlaceholder="Ask AgenticBuilder to edit this Implementation Guide..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="View Design Spec"
      onConfirm={() => goToSubStage("design", "preparation")}
      showDownload
    />
  );
}
