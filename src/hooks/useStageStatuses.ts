"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import { useCodingStore } from "@/store/coding-store";
import { PREPARATION_STEP_IDS, type StageId, type StageStatus } from "@/store/stage-store";
import type { PipelineStepId } from "@/lib/pipeline/types";

/**
 * Derives the current status of every stage by reading pipeline-store
 * and coding-store. No extra state to synchronise — just selectors.
 *
 * Rules:
 *  preparation  active    → pipeline is running and current step is a prep step
 *               completed → at least one prep step completed, pipeline no longer running those steps
 *               error     → any prep step failed
 *
 *  kickoff      active    → pipeline currentStep === "kickoff" and isRunning
 *               completed → steps.kickoff?.status === "completed"
 *               error     → steps.kickoff?.status === "failed"
 *
 *  coding       active    → codingStore.status === "running"
 *               completed → codingStore.status === "completed"
 *               error     → codingStore.status === "failed"
 *
 *  preview      active    → coding completed (ready to preview)
 *               completed → (no hard signal; kept "active" until user manually finishes)
 *               error     → (not modelled yet)
 */
export function useStageStatuses(): Record<StageId, StageStatus> {
  const steps = usePipelineStore((s) => s.steps);
  const isPipelineRunning = usePipelineStore((s) => s.isRunning);
  const currentStep = usePipelineStore((s) => s.currentStep);
  const pipelineError = usePipelineStore((s) => s.error);
  const codingStatus = useCodingStore((s) => s.status);

  // ── preparation ──────────────────────────────────────────────────────────
  const prepStepIds = PREPARATION_STEP_IDS as readonly PipelineStepId[];
  const anyPrepCompleted = prepStepIds.some((id) => steps[id]?.status === "completed");
  const anyPrepFailed    = prepStepIds.some((id) => steps[id]?.status === "failed");
  const isPrepCurrentStep =
    currentStep !== null && (prepStepIds as readonly string[]).includes(currentStep);

  let preparation: StageStatus = "idle";
  if (isPipelineRunning && isPrepCurrentStep) {
    preparation = "active";
  } else if (anyPrepFailed && !!pipelineError) {
    preparation = "error";
  } else if (anyPrepCompleted) {
    preparation = "completed";
  }

  // ── kickoff ───────────────────────────────────────────────────────────────
  const kickoffStep = steps.kickoff;
  let kickoff: StageStatus = "idle";
  if (isPipelineRunning && currentStep === "kickoff") {
    kickoff = "active";
  } else if (kickoffStep?.status === "failed") {
    kickoff = "error";
  } else if (kickoffStep?.status === "completed") {
    kickoff = "completed";
  }

  // ── coding ────────────────────────────────────────────────────────────────
  let coding: StageStatus = "idle";
  if (codingStatus === "running")   coding = "active";
  else if (codingStatus === "failed")    coding = "error";
  else if (codingStatus === "completed") coding = "completed";

  // ── preview ───────────────────────────────────────────────────────────────
  let preview: StageStatus = "idle";
  if (coding === "completed") preview = "active";

  return { preparation, kickoff, coding, preview };
}
