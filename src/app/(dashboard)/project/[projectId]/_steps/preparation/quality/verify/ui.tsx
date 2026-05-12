"use client";

import { useEffect } from "react";
import { DocViewerUi } from "../../../_shared/doc-viewer-ui";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import type { StepUIProps } from "../../../_shared/types";

export function VerifyUI(props: StepUIProps) {
  const step = useStepStore((s) => s.steps.verify);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("verify", tier);

  const isThisRunning = isRunning && currentStep === "verify";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed";

  // Auto-trigger Verify generation if not yet generated and nothing is running
  useEffect(() => {
    if (!step && !isRunning) {
      // Triggered by parent via auto-trigger mechanism
    }
  }, [step, isRunning]);

  return (
    <DocViewerUi
      onNavigate={props.onNavigate}
      title="Pre-Kickoff Verification"
      subtitle="Final review checklist — confirm all documents are ready before starting code generation"
      editPlaceholder="Ask AgenticBuilder to refine the verification checklist..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="Proceed to Kick-off"
      onConfirm={() => { if (nextStep) props.onNavigate(nextStep); }}
    />
  );
}
