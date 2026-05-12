"use client";

import { DocViewerUi } from "../../../_shared/doc-viewer-ui";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import type { StepUIProps } from "../../../_shared/types";

export function ImplGuideUI(props: StepUIProps) {
  const step = useStepStore((s) => s.steps.implguide);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("implguide", tier);

  const isThisRunning = isRunning && currentStep === "implguide";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed";

  return (
    <DocViewerUi
      onNavigate={props.onNavigate}
      title="Implementation Guide"
      subtitle="Step-by-step coding roadmap with file structure, dependencies, and milestones"
      editPlaceholder="Ask AgenticBuilder to edit this Implementation Guide..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="View Design Spec"
      onConfirm={() => { if (nextStep) props.onNavigate(nextStep); }}
      showDownload
    />
  );
}
