"use client";

import { DocViewerUi } from "../../../_shared/doc-viewer-ui";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import type { StepUIProps } from "../../../_shared/types";

export function SysDesignUI(props: StepUIProps) {
  const step = useStepStore((s) => s.steps.sysdesign);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("sysdesign", tier);

  const isThisRunning = isRunning && currentStep === "sysdesign";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed";

  return (
    <DocViewerUi
      onNavigate={props.onNavigate}
      title="System Design"
      subtitle="Architecture diagrams, service topology, and infrastructure decisions"
      editPlaceholder="Ask AgenticBuilder to edit this System Design..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="View Impl Guide"
      onConfirm={() => { if (nextStep) props.onNavigate(nextStep); }}
      showDownload
    />
  );
}
