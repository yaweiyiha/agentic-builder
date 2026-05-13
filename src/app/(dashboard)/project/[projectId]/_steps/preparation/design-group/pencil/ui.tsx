"use client";

import { DocViewerUi } from "../../../_shared/doc-viewer-ui";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import type { StepUIProps } from "../../../_shared/types";

export function PencilUI(props: StepUIProps) {
  const step = useStepStore((s) => s.steps.pencil);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("pencil", tier);

  const isThisRunning = isRunning && currentStep === "pencil";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed";
  const artifactUrls = (step?.metadata?.artifactUrls as string[]) ?? [];

  return (
    <DocViewerUi
      onNavigate={props.onNavigate}
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
              <img key={i} src={url} alt={"Wireframe " + (i + 1)} className="w-full rounded-lg border border-[#e2e8f0] shadow-sm" />
            ))}
          </div>
        ) : undefined
      }
      confirmLabel="View Mockup"
      onConfirm={() => { if (nextStep) props.onNavigate(nextStep); }}
    />
  );
}
