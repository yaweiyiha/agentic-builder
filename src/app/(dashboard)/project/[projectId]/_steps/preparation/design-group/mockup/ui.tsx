"use client";

import { DocViewerUi } from "../../../_shared/doc-viewer-ui";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import type { StepUIProps } from "../../../_shared/types";

export function MockupUI(props: StepUIProps) {
  const step = useStepStore((s) => s.steps.mockup);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("mockup", tier);

  const isThisRunning = isRunning && currentStep === "mockup";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed";
  const artifactUrls = (step?.metadata?.artifactUrls as string[]) ?? [];

  return (
    <DocViewerUi
      onNavigate={props.onNavigate}
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
              <img key={i} src={url} alt={"Mockup " + (i + 1)} className="w-full rounded-lg border border-[#e2e8f0] shadow-sm" />
            ))}
          </div>
        ) : undefined
      }
      confirmLabel="View QA Plan"
      onConfirm={() => { if (nextStep) props.onNavigate(nextStep); }}
    />
  );
}
