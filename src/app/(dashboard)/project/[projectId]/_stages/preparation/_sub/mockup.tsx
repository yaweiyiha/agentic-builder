"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function MockupSubStage() {
  const step             = usePipelineStore((s) => s.steps.mockup);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "mockup";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";
  const artifactUrls = (step?.metadata?.artifactUrls as string[]) ?? [];

  return (
    <DocViewerSubStage
      title="Hi-fi Mockup"
      subtitle="High-fidelity screen designs produced from the wireframe and design spec"
      generatingLabel="RENDERING..."
      editPlaceholder="Ask AgenticBuilder to refine this mockup..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      extraContent={
        artifactUrls.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 mt-4">
            {artifactUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={"Mockup " + (i + 1)}
                className="w-full rounded-lg border border-[#e2e8f0] shadow-sm"
              />
            ))}
          </div>
        ) : undefined
      }
      confirmLabel="View QA Plan"
      onConfirm={() => goToSubStage("qa", "preparation")}
    />
  );
}
