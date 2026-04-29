"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function DesignSubStage() {
  const step             = usePipelineStore((s) => s.steps.design);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "design";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  return (
    <DocViewerSubStage
      activeTabId="design"
      title="Design Document"
      subtitle="Visual system: color tokens, typography, component library, and layout patterns"
      editPlaceholder="Ask AgenticBuilder to edit this Design Document..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="View Wireframe"
      onConfirm={() => goToSubStage("pencil", "preparation")}
      showDownload
    />
  );
}
