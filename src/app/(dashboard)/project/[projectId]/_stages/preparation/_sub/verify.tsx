"use client";

<<<<<<< HEAD
=======
import { useEffect } from "react";
>>>>>>> origin/pipeline-ui
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function VerifySubStage() {
  const step             = usePipelineStore((s) => s.steps.verify);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
<<<<<<< HEAD
=======
  const runVerify        = usePipelineStore((s) => s.runVerify);
>>>>>>> origin/pipeline-ui
  const goToStage        = useStageStore((s) => s.goToStage);

  const isThisRunning = isRunning && currentStep === "verify";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

<<<<<<< HEAD
  return (
    <DocViewerSubStage
      activeTabId="verify"
=======
  // Auto-trigger Verify generation if not yet generated and nothing is running
  useEffect(() => {
    if (!step && !isRunning) {
      runVerify();
    }
  }, [step, isRunning, runVerify]);

  return (
    <DocViewerSubStage
>>>>>>> origin/pipeline-ui
      title="Pre-Kickoff Verification"
      subtitle="Final review checklist — confirm all documents are ready before starting code generation"
      editPlaceholder="Ask AgenticBuilder to refine the verification checklist..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="Proceed to Kick-off"
      onConfirm={() => goToStage("kickoff")}
    />
  );
}
