"use client";

import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import type { StepId } from "@/_config/pipeline-flow";
import type { StepResultData } from "@/app/(dashboard)/project/[projectId]/_steps/_shared/types";

/**
 * Hook that derives the current state for a given step from the centralized stores.
 * Replaces the repetitive pattern of reading from pipeline-store per sub-stage.
 */
export function useStepState(stepId: StepId) {
  const stepResult = useStepStore((s) => s.steps[stepId]);
  const isRunning = useStepStore((s) => s.isRunning && s.currentStep === stepId);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const streamingThinking = useStepStore((s) => s.streamingThinking);
  const error = useStepStore((s) => s.error);
  const isHydrated = useStepStore((s) => s.isHydrated);
  const featureBrief = useStepStore((s) => s.featureBrief);
  const codeOutputDir = useStepStore((s) => s.codeOutputDir);
  const tier = useStepStore((s) => s.tier);
  const previousSteps = useStepStore((s) => s.steps);

  return {
    stepResult,
    isRunning,
    streamingContent,
    streamingThinking,
    error,
    isHydrated,
    featureBrief,
    codeOutputDir,
    tier,
    previousSteps,
  };
}
