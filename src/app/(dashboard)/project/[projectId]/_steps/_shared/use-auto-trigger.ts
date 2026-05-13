"use client";

import { useEffect, useRef } from "react";
import { useStepStore } from "@/store/step-store";
import type { StepId } from "@/_config/pipeline-flow";

/**
 * Auto-triggers step generation when the user navigates to a step
 * that has `autoTrigger` enabled in the flow config, and the step
 * hasn't been generated yet.
 *
 * Usage: Call this in any step's ui.tsx component.
 *   useAutoTrigger(stepId, async () => { ... });
 */
export function useAutoTrigger(
  stepId: StepId,
  onTrigger: () => void | Promise<void>,
  opts?: { enabled?: boolean },
) {
  const triggeredRef = useRef(false);
  const stepResult = useStepStore((s) => s.steps[stepId]);
  const isRunning = useStepStore((s) => s.isRunning);
  const isHydrated = useStepStore((s) => s.isHydrated);

  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    if (!isHydrated) return;
    if (triggeredRef.current) return;
    if (isRunning) return;

    // Only auto-trigger if step hasn't been generated yet
    if (stepResult && stepResult.status !== "idle") return;

    triggeredRef.current = true;
    void onTrigger();
  }, [enabled, isHydrated, isRunning, stepResult, onTrigger]);
}
