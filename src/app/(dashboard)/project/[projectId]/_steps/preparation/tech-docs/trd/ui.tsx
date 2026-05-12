"use client";

import { DocViewerUi } from "../../../_shared/doc-viewer-ui";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import type { StepUIProps } from "../../../_shared/types";

export function TrdUI(props: StepUIProps) {
  const step = useStepStore((s) => s.steps.trd);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("trd", tier);

  const isThisRunning = isRunning && currentStep === "trd";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed";

  return (
    <DocViewerUi
      onNavigate={props.onNavigate}
      activeTabId="trd"
      title="Technical Requirements Document"
      subtitle="API contracts, data models, service boundaries, and non-functional constraints"
      editPlaceholder="Ask AgenticBuilder to edit this TRD..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="Confirm TRD"
      onConfirm={() => { if (nextStep) props.onNavigate(nextStep); }}
      showDownload
    />
  );
}
