"use client";

import { motion } from "motion/react";
import type { StepResult, PipelineStepId } from "@/lib/pipeline/types";

const STEP_META: Record<
  PipelineStepId,
  { label: string; icon: string; description: string }
> = {
  intent: {
    label: "Intent",
    icon: "💡",
    description: "Feature brief input",
  },
  prd: {
    label: "PRD Generation",
    icon: "📋",
    description: "PM Agent → Product Requirements",
  },
  trd: {
    label: "Technical Requirements",
    icon: "🏗️",
    description: "TRD Agent → Technology Stack & Architecture",
  },
  sysdesign: {
    label: "System Design",
    icon: "🔧",
    description: "System Design Agent → Architectural Decisions",
  },
  implguide: {
    label: "Implementation Guide",
    icon: "📐",
    description: "Impl Guide Agent → Phased Execution Plan",
  },
  design: {
    label: "Design Spec",
    icon: "🎨",
    description: "Design Agent → UI Specification",
  },
  pencil: {
    label: "Pencil Design",
    icon: "✏️",
    description: "Pencil MCP → .pen design file + PNG export",
  },
  mockup: {
    label: "Mockup Build",
    icon: "🖥️",
    description: "Mockup Agent → Static React pages",
  },
  qa: {
    label: "QA Audit",
    icon: "🧪",
    description: "QA Agent → Test Plan & Audit",
  },
  verify: {
    label: "Verification",
    icon: "✅",
    description: "Verifier → Drift Detection",
  },
  kickoff: {
    label: "Project Kick-off",
    icon: "🚀",
    description: "Write scaffold, optional Git/Jira webhooks, local Git hints",
  },
};

const STATUS_STYLES: Record<string, string> = {
  idle: "border-[1.5px] border-[var(--border)] bg-[var(--card)]",
  running:
    "border-[1.5px] border-[var(--accent)] bg-[var(--accent-muted)] ring-1 ring-[var(--accent)]/20",
  completed: "border-[1.5px] border-emerald-200 bg-green-50/80",
  failed: "border-[1.5px] border-red-200 bg-red-50/80",
};

interface PipelineStepCardProps {
  stepId: PipelineStepId;
  result: StepResult | null;
  isActive: boolean;
  onViewDetails?: () => void;
  onViewMockup?: () => void;
}

export default function PipelineStepCard({
  stepId,
  result,
  isActive,
  onViewDetails,
  onViewMockup,
}: PipelineStepCardProps) {
  const meta = STEP_META[stepId];
  const status = result?.status ?? "idle";
  const mockupFileCount =
    stepId === "mockup" && status === "completed"
      ? (result?.metadata?.fileCount as number | undefined) ?? 0
      : 0;
  const hasMockupFiles = mockupFileCount > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl p-4 transition-all ${STATUS_STYLES[status] ?? STATUS_STYLES.idle}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">{meta.icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              {meta.label}
            </h3>
            <p className="text-xs text-[var(--muted)]">{meta.description}</p>
          </div>
        </div>

        <StatusBadge status={status} isActive={isActive} />
      </div>

      {result && status !== "idle" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-3 space-y-2 border-t border-[var(--border)] pt-3"
        >
          {result.model && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">Model</span>
              <span className="font-mono text-[var(--foreground)]">
                {result.model}
              </span>
            </div>
          )}

          {result.costUsd !== undefined && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">Cost</span>
              <span className="font-mono font-medium text-emerald-700">
                ${result.costUsd.toFixed(4)}
              </span>
            </div>
          )}

          {result.durationMs !== undefined && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">Duration</span>
              <span className="font-mono text-[var(--foreground)]">
                {(result.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          )}

          {result.tokenUsage && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">Tokens</span>
              <span className="font-mono text-[var(--foreground)]">
                {result.tokenUsage.totalTokens.toLocaleString()}
              </span>
            </div>
          )}

          {hasMockupFiles && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">Files generated</span>
              <span className="font-mono font-medium text-indigo-700">
                {mockupFileCount}
              </span>
            </div>
          )}

          {result.error && (
            <p className="text-xs text-[var(--destructive)]">{result.error}</p>
          )}

          {result.content && onViewDetails && (
            <button
              onClick={onViewDetails}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-zinc-50 px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-zinc-100"
            >
              View Output
            </button>
          )}

          {hasMockupFiles && onViewMockup && (
            <button
              onClick={onViewMockup}
              className="mt-1 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              Browse Mockup Files
            </button>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

function StatusBadge({
  status,
  isActive,
}: {
  status: string;
  isActive: boolean;
}) {
  if (isActive && status === "running") {
    return (
      <motion.div
        className="flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-2.5 py-1"
        animate={{ opacity: [1, 0.5, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        <span className="text-xs font-medium text-[var(--accent)]">
          Running
        </span>
      </motion.div>
    );
  }

  const badgeStyles: Record<string, string> = {
    idle: "bg-zinc-100 text-[var(--muted)]",
    completed: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-700",
  };

  const labels: Record<string, string> = {
    idle: "Pending",
    completed: "Done",
    failed: "Failed",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeStyles[status] ?? badgeStyles.idle}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
