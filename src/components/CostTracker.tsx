"use client";

import { motion } from "motion/react";
import type { PipelineRun } from "@/lib/pipeline/types";

interface CostTrackerProps {
  run: PipelineRun | null;
}

export default function CostTracker({ run }: CostTrackerProps) {
  if (!run) return null;

  const stepEntries = Object.values(run.steps).filter(Boolean);
  const completedSteps = stepEntries.filter((s) => s?.status === "completed");
  const totalTokens = completedSteps.reduce(
    (sum, s) => sum + (s?.tokenUsage?.totalTokens ?? 0),
    0
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border-[1.5px] border-[var(--border)] bg-[var(--card)] p-5"
    >
      <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
        OpenRouter Cost Tracking
      </h3>

      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          label="Total Cost"
          value={`$${run.totalCostUsd.toFixed(4)}`}
          color="text-emerald-700"
        />
        <MetricCard
          label="Total Tokens"
          value={totalTokens.toLocaleString()}
          color="text-blue-600"
        />
        <MetricCard
          label="Steps Done"
          value={`${completedSteps.length} / ${stepEntries.length}`}
          color="text-violet-600"
        />
      </div>

      {completedSteps.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
          {completedSteps.map((step) =>
            step ? (
              <div
                key={step.stepId}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-[var(--muted)] capitalize">
                  {step.stepId}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[var(--muted)]">
                    {step.model?.split("/").pop()}
                  </span>
                  <span className="font-mono font-medium text-emerald-700">
                    ${step.costUsd?.toFixed(4)}
                  </span>
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="text-center">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}
