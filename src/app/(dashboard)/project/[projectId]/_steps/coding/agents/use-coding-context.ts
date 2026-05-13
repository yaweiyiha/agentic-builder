"use client";

import { useMemo } from "react";
import { useStepStore } from "@/store/step-store";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";

/**
 * Aggregates all data needed to start the coding run from the step-store
 * (which is pre-hydrated from the project-step-snapshot API by the parent).
 */
export function useCodingContext() {
  const steps = useStepStore((s) => s.steps);
  const codeOutputDir = useStepStore((s) => s.codeOutputDir);

  const prdContent = steps.prd?.content ?? "";

  // Prefer task-breakdown snapshot metadata; fall back to summary
  const taskMeta = useMemo(
    () =>
      (steps["task-breakdown"]?.metadata ??
        steps.summary?.metadata) as Record<string, unknown> | undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps["task-breakdown"]?.metadata, steps.summary?.metadata],
  );

  const tasks = useMemo(
    () => parseKickoffTaskBreakdownFromMetadata(taskMeta),
    [taskMeta],
  );

  const runId =
    typeof taskMeta?.runId === "string"
      ? taskMeta.runId
      : `coding-${Date.now()}`;

  const intentMeta = steps.intent?.metadata as
    | { classification?: { tier?: string } }
    | undefined;
  const projectTier = intentMeta?.classification?.tier;

  return { prdContent, tasks, runId, codeOutputDir, projectTier };
}
