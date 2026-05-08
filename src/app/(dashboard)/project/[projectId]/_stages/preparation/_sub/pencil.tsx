"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function PencilSubStage() {
  const step             = usePipelineStore((s) => s.steps.pencil);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "pencil";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";
  const artifactUrls = (step?.metadata?.artifactUrls as string[]) ?? [];

  return (
    <DocViewerSubStage
      title="Pencil Wireframe"
      subtitle="Low-fidelity layout sketches generated from the design spec"
      generatingLabel="SKETCHING..."
      editPlaceholder="Ask AgenticBuilder to refine these wireframes..."
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
                alt={"Wireframe " + (i + 1)}
                className="w-full rounded-lg border border-[#e2e8f0] shadow-sm"
              />
            ))}
          </div>
        ) : undefined
      }
      confirmLabel="View Mockup"
      onConfirm={() => goToSubStage("mockup", "preparation")}
    />
  );
}
