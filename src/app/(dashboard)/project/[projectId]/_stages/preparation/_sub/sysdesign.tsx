"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function SysdesignSubStage() {
  const step             = usePipelineStore((s) => s.steps.sysdesign);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "sysdesign";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  return (
    <DocViewerSubStage
      title="System Design"
      subtitle="Architecture diagrams, service topology, and infrastructure decisions"
      editPlaceholder="Ask AgenticBuilder to edit this System Design..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="View Impl Guide"
      onConfirm={() => goToSubStage("implguide", "preparation")}
      showDownload
    />
  );
}
