"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function TrdSubStage() {
  const step             = usePipelineStore((s) => s.steps.trd);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "trd";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  return (
    <DocViewerSubStage
      activeTabId="trd"
      title="Technical Requirements Document"
      subtitle="API contracts, data models, service boundaries, and non-functional constraints"
      editPlaceholder="Ask AgenticBuilder to edit this TRD..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="Confirm TRD"
      onConfirm={() => goToSubStage("qa", "preparation")}
      showDownload
    />
  );
}
