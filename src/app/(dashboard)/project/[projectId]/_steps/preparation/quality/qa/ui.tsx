"use client";

import { useEffect } from "react";
import { DocViewerUi } from "../../../_shared/doc-viewer-ui";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import type { StepUIProps } from "../../../_shared/types";

export function QaUI(props: StepUIProps) {
  const step = useStepStore((s) => s.steps.qa);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("qa", tier);

  const isThisRunning = isRunning && currentStep === "qa";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed";

  // Auto-trigger QA generation if not yet generated and nothing is running
  useEffect(() => {
    if (!step && !isRunning) {
      // Triggered by parent via auto-trigger mechanism
    }
  }, [step, isRunning]);

  return (
    <DocViewerUi
      onNavigate={props.onNavigate}
      activeTabId="qa"
      title="QA Plan"
      subtitle="Quality assurance checklist verifying all requirements are covered before kick-off"
      editPlaceholder="Ask AgenticBuilder to refine this QA plan..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="Proceed to Verify"
      onConfirm={() => { if (nextStep) props.onNavigate(nextStep); }}
    />
  );
}
