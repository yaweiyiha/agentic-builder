"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  useCodingStore,
  type IntegrationVerifyState,
  type E2EVerifyState,
} from "@/store/coding-store";
import { usePipelineStore } from "@/store/pipeline-store";
import Loading from "@/components/Loading";
import {
  CodingLogLine,
  type CodingLogDisplayEntry,
} from "@/components/CodingLogLine";
import CodingTaskTopologyView from "@/components/CodingTaskTopologyView";
import SessionReportDialog from "@/components/SessionReportDialog";
import { isCompletedTask, resolveTaskRole } from "@/lib/coding-task-ui";
import type {
  CodingAgentInstance,
  CodingAgentRole,
  CodingTask,
} from "@/lib/pipeline/types";

/** Roles shown in task topology and agent progress. */
const TASK_UI_ROLE_ORDER: CodingAgentRole[] = [
  "architect",
  "backend",
  "frontend",
  "test",
];

const ROLE_META: Record<
  CodingAgentRole,
  {
    label: string;
    stripe: string;
    tint: string;
    tintText: string;
    selectedRing: string;
    selectedBg: string;
    hoverBg: string;
    subSelectedBg: string;
    subSelectedBorder: string;
    subHoverBg: string;
    barColor: string;
  }
> = {
  architect: {
    label: "Architect",
    stripe: "bg-amber-500",
    tint: "bg-amber-50",
    tintText: "text-amber-700",
    selectedRing: "ring-amber-300",
    selectedBg: "bg-amber-50",
    hoverBg: "hover:bg-amber-50/70",
    subSelectedBg: "bg-amber-50",
    subSelectedBorder: "border-amber-300",
    subHoverBg: "hover:bg-amber-50/60",
    barColor: "bg-amber-500",
  },
  backend: {
    label: "Backend Dev",
    stripe: "bg-blue-600",
    tint: "bg-blue-50",
    tintText: "text-blue-700",
    selectedRing: "ring-blue-300",
    selectedBg: "bg-blue-50",
    hoverBg: "hover:bg-blue-50/70",
    subSelectedBg: "bg-blue-100",
    subSelectedBorder: "border-blue-500",
    subHoverBg: "hover:bg-blue-50",
    barColor: "bg-blue-500",
  },
  frontend: {
    label: "Frontend Dev",
    stripe: "bg-violet-600",
    tint: "bg-violet-50",
    tintText: "text-violet-700",
    selectedRing: "ring-violet-300",
    selectedBg: "bg-violet-50",
    hoverBg: "hover:bg-violet-50/70",
    subSelectedBg: "bg-violet-100",
    subSelectedBorder: "border-violet-500",
    subHoverBg: "hover:bg-violet-50",
    barColor: "bg-violet-500",
  },
  test: {
    label: "Test Engineer",
    stripe: "bg-emerald-600",
    tint: "bg-emerald-50",
    tintText: "text-emerald-700",
    selectedRing: "ring-emerald-300",
    selectedBg: "bg-emerald-50",
    hoverBg: "hover:bg-emerald-50/70",
    subSelectedBg: "bg-emerald-100",
    subSelectedBorder: "border-emerald-500",
    subHoverBg: "hover:bg-emerald-50",
    barColor: "bg-emerald-500",
  },
};

type AgentGroup = {
  role: CodingAgentRole;
  label: string;
  agents: CodingAgentInstance[];
  tasks: CodingTask[];
  doneCount: number;
  failedCount: number;
  aggregateStatus: CodingAgentInstance["status"];
};

function logScopeSelectValue(
  selectedAgent: CodingAgentInstance | null,
  selectedRole: CodingAgentRole | null,
): string {
  if (selectedAgent) return `agent:${selectedAgent.id}`;
  if (selectedRole) return `role:${selectedRole}`;
  return "all";
}

function ProgressBar({
  completed,
  failed,
  total,
  barColorClass,
  className = "",
}: {
  completed: number;
  failed: number;
  total: number;
  barColorClass: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const failPct = total > 0 ? Math.round((failed / total) * 100) : 0;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200">
        <div className="flex h-full">
          <motion.div
            className={`h-full ${barColorClass}`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
          {failPct > 0 && (
            <motion.div
              className="h-full bg-red-500"
              initial={{ width: 0 }}
              animate={{ width: `${failPct}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          )}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-zinc-400">
        {pct}%
      </span>
    </div>
  );
}

export default function CodingAgentGraph() {
  const {
    status,
    agents,
    tasks,
    selectedAgentId,
    totalCostUsd,
    error,
    selectAgent,
    reset,
    retryIntegrationVerify,
    retryE2eVerify,
    integrationVerify,
    e2eVerify,
    supervisorLogs,
  } = useCodingStore();
  const codeOutputDir = usePipelineStore((s) => s.codeOutputDir);
  const intentStep = usePipelineStore((s) => s.steps.intent);
  const kickoffStep = usePipelineStore((s) => s.steps.kickoff);

  const [selectedRole, setSelectedRole] = useState<CodingAgentRole | null>(
    null,
  );
  const [topologySelectedTaskId, setTopologySelectedTaskId] = useState<
    string | null
  >(null);
  const [reportOpen, setReportOpen] = useState(false);

  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? null;

  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent] as const)),
    [agents],
  );

  const visibleTasks = useMemo(() => tasks, [tasks]);

  const groups = useMemo<AgentGroup[]>(() => {
    return TASK_UI_ROLE_ORDER.map((role) => {
      const roleAgents = agents.filter((agent) => agent.role === role);
      if (roleAgents.length === 0) return null;

      const roleTasks = visibleTasks.filter(
        (task) => resolveTaskRole(task, agentById) === role,
      );
      const doneCount = roleTasks.filter((task) =>
        isCompletedTask(task),
      ).length;
      const failedCount = roleTasks.filter(
        (task) => task.codingStatus === "failed",
      ).length;
      const hasWorking = roleAgents.some((agent) => agent.status === "working");
      const hasFailed =
        roleAgents.some((agent) => agent.status === "failed") ||
        failedCount > 0;
      const allCompleted =
        roleTasks.length > 0 &&
        doneCount === roleTasks.length &&
        !hasWorking &&
        !hasFailed;

      return {
        role,
        label: ROLE_META[role].label,
        agents: roleAgents,
        tasks: roleTasks,
        doneCount,
        failedCount,
        aggregateStatus: hasWorking
          ? "working"
          : hasFailed
            ? "failed"
            : allCompleted
              ? "completed"
              : "idle",
      } satisfies AgentGroup;
    }).filter((group): group is AgentGroup => group !== null);
  }, [agentById, agents, visibleTasks]);

  useEffect(() => {
    if (
      topologySelectedTaskId &&
      !visibleTasks.some((t) => t.id === topologySelectedTaskId)
    ) {
      setTopologySelectedTaskId(null);
    }
  }, [topologySelectedTaskId, visibleTasks]);

  const visibleLogs = useMemo<CodingLogDisplayEntry[]>(() => {
    if (selectedAgent) {
      return selectedAgent.logs.map((log) => ({
        ...log,
        agentLabel: selectedAgent.label,
      }));
    }
    if (selectedRole) {
      return agents
        .filter((agent) => agent.role === selectedRole)
        .flatMap((agent) =>
          agent.logs.map((log) => ({ ...log, agentLabel: agent.label })),
        )
        .sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
    }
    // "All workers" view: merge agent logs + supervisor logs
    const agentLogs = agents.flatMap((agent) =>
      agent.logs.map((log) => ({ ...log, agentLabel: agent.label })),
    );
    const sysLogs: CodingLogDisplayEntry[] = supervisorLogs.map((log) => ({
      ...log,
      agentLabel: "Supervisor",
    }));
    return [...agentLogs, ...sysLogs].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }, [agents, selectedAgent, selectedRole, supervisorLogs]);

  const logPanelLabel = selectedAgent
    ? selectedAgent.label
    : selectedRole
      ? `${ROLE_META[selectedRole]?.label ?? selectedRole} · merged`
      : `All workers · ${supervisorLogs.length > 0 ? `${supervisorLogs.length} supervisor events` : "no supervisor events yet"}`;

  const logScopeValue = logScopeSelectValue(selectedAgent, selectedRole);

  const onLogScopeChange = (value: string) => {
    if (value === "all") {
      selectAgent(null);
      setSelectedRole(null);
      return;
    }
    if (value.startsWith("role:")) {
      selectAgent(null);
      setSelectedRole(value.slice(5) as CodingAgentRole);
      return;
    }
    if (value.startsWith("agent:")) {
      const id = value.slice(6);
      const agent = agents.find((a) => a.id === id);
      selectAgent(id);
      if (agent) setSelectedRole(agent.role);
    }
  };

  const completedTasks = visibleTasks.filter((task) =>
    isCompletedTask(task),
  ).length;
  const failedTasks = visibleTasks.filter(
    (task) => task.codingStatus === "failed",
  ).length;
  const verifyingTasks = visibleTasks.filter(
    (task) =>
      task.codingStatus === "in_progress" && task.progressStage === "verifying",
  ).length;
  const fixingTasks = visibleTasks.filter(
    (task) =>
      task.codingStatus === "in_progress" && task.progressStage === "fixing",
  ).length;
  const totalTasks = visibleTasks.length;
  const projectTier = (
    intentStep?.metadata as { classification?: { tier?: string } } | undefined
  )?.classification?.tier;
  const retryRunId =
    typeof kickoffStep?.metadata?.runId === "string"
      ? kickoffStep.metadata.runId
      : `integration-retry-${Date.now()}`;

  if (status === "idle") {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center">
        <p className="text-sm text-zinc-400">
          Confirm the task breakdown to start multi-agent coding.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
        {error && (
          <div className="shrink-0 rounded-md border border-red-200 bg-red-50 p-2">
            <p className="text-[10px] text-red-600">{error}</p>
          </div>
        )}
        {status === "running" && agents.length === 0 && (
          <div className="flex shrink-0 justify-center py-4">
            <Loading size="sm" text="Allocating..." />
          </div>
        )}

        {/* Header + overall progress */}
        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[15px] font-semibold text-zinc-900">
                Task Progress
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                All agents · {totalTasks} tasks
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 rounded-[10px] bg-emerald-50 px-2.5 py-0.5 font-mono text-[11px] text-emerald-600">
                <span className="h-[5px] w-[5px] rounded-full bg-emerald-500" />
                {completedTasks}/{totalTasks} completed
              </span>
              {(verifyingTasks > 0 || fixingTasks > 0) && (
                <span className="flex items-center gap-1 rounded-[10px] bg-amber-50 px-2.5 py-0.5 font-mono text-[11px] text-amber-700">
                  <span className="h-[5px] w-[5px] rounded-full bg-amber-500" />
                  {verifyingTasks} verifying · {fixingTasks} fix loop
                  {fixingTasks === 1 ? "" : "s"}
                </span>
              )}
              {failedTasks > 0 && (
                <span className="rounded-[10px] bg-red-50 px-2.5 py-0.5 font-mono text-[11px] text-red-500">
                  {failedTasks} failed
                </span>
              )}
              <span className="font-mono text-[11px] text-emerald-600">
                ${totalCostUsd.toFixed(4)}
              </span>
              {(status === "completed" || status === "failed") && (
                <button
                  type="button"
                  onClick={() => setReportOpen(true)}
                  className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-100"
                >
                  View Report
                </button>
              )}
              {status === "completed" && (
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {totalTasks > 0 && (
            <ProgressBar
              completed={completedTasks}
              failed={failedTasks}
              total={totalTasks}
              barColorClass="bg-emerald-500"
            />
          )}
        </div>

        {/* Topology graph */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CodingTaskTopologyView
            tasks={visibleTasks}
            agents={agents}
            agentById={agentById}
            selectedTaskId={topologySelectedTaskId}
            onSelectTask={setTopologySelectedTaskId}
          />
        </div>

        {/* Final Verification */}
        {integrationVerify && (
          <IntegrationVerifyCard
            verify={integrationVerify}
            retrying={
              status === "running" && integrationVerify.status !== "failed"
            }
            onRetry={() =>
              retryIntegrationVerify(retryRunId, codeOutputDir, projectTier)
            }
          />
        )}

        {e2eVerify && (
          <E2EVerifyCard
            verify={e2eVerify}
            retrying={status === "running" && e2eVerify.status !== "failed"}
            onRetry={() => retryE2eVerify(retryRunId, codeOutputDir, projectTier)}
          />
        )}

        {/* Agent log panel */}
        {agents.length > 0 && (
          <div className="flex shrink-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Agent logs
              </label>
              <select
                value={logScopeValue}
                onChange={(e) => onLogScopeChange(e.target.value)}
                className="max-w-[min(100%,420px)] rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-[10px] text-zinc-800 shadow-sm outline-none focus:ring-1 focus:ring-zinc-300"
              >
                <option value="all">All workers (merged)</option>
                {groups.map((g) => (
                  <optgroup key={g.role} label={g.label}>
                    <option value={`role:${g.role}`}>All in {g.label}</option>
                    {g.agents.map((a) => (
                      <option key={a.id} value={`agent:${a.id}`}>
                        {a.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="font-mono text-[11px] text-zinc-900">
                {logPanelLabel}
              </span>
            </div>
            <div className="max-h-[220px] overflow-y-auto rounded-lg bg-zinc-50 p-3.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {visibleLogs.length === 0 ? (
                <p className="font-mono text-[11px] text-zinc-400">
                  No activity yet.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {visibleLogs.map((log, index) => (
                    <CodingLogLine
                      key={`${log.timestamp}-${index}`}
                      entry={log}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <SessionReportDialog
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        outputDir={codeOutputDir}
      />
    </div>
  );
}


function IntegrationVerifyCard({
  verify,
  retrying,
  onRetry,
}: {
  verify: IntegrationVerifyState;
  retrying: boolean;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig: Record<
    IntegrationVerifyState["status"],
    { icon: React.ReactNode; label: string; bg: string; text: string }
  > = {
    verifying: {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="animate-spin text-indigo-500"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ),
      label:
        verify.fixAttempts > 0
          ? `Re-verifying after fix (attempt ${verify.fixAttempts}/${verify.maxFixAttempts})...`
          : "Running full project verification...",
      bg: "border-indigo-200 bg-indigo-50/60",
      text: "text-indigo-800",
    },
    fixing: {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-amber-500"
        >
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
      ),
      label: `${verify.errorCount ?? 0} error(s) found — fixing (attempt ${verify.fixAttempts + 1}/${verify.maxFixAttempts})...`,
      bg: "border-amber-200 bg-amber-50/60",
      text: "text-amber-800",
    },
    passed: {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-emerald-500"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
      label:
        verify.fixAttempts > 0
          ? `Passed after ${verify.fixAttempts} fix attempt${verify.fixAttempts === 1 ? "" : "s"}`
          : "All checks passed",
      bg: "border-emerald-200 bg-emerald-50/60",
      text: "text-emerald-800",
    },
    failed: {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-red-500"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
      label: `${verify.errorCount ?? 0} error(s) remaining after ${verify.fixAttempts} fix attempt${verify.fixAttempts === 1 ? "" : "s"}`,
      bg: "border-red-200 bg-red-50/60",
      text: "text-red-800",
    },
  };

  const cfg = statusConfig[verify.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-xl border ${cfg.bg} px-4 py-3`}
    >
      <button
        type="button"
        onClick={() => verify.errors && setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        {cfg.icon}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-zinc-900">
            Final Verification
          </p>
          <p className={`text-[11px] font-medium ${cfg.text}`}>{cfg.label}</p>
        </div>
        {verify.errors && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.12 }}
            className="shrink-0 text-[10px] text-zinc-400"
          >
            ▾
          </motion.span>
        )}
      </button>
      {verify.status === "failed" && (
        <div className="mt-2.5 flex items-center justify-end">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {retrying ? "Retrying..." : "Retry Final Verification"}
          </button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {expanded && verify.errors && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <pre className="mt-2.5 max-h-[200px] overflow-y-auto rounded-lg bg-zinc-900 p-3 font-mono text-[10px] leading-5 text-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {verify.errors}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function E2EVerifyCard({
  verify,
  retrying,
  onRetry,
}: {
  verify: E2EVerifyState;
  retrying: boolean;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig: Record<
    E2EVerifyState["status"],
    { icon: React.ReactNode; label: string; bg: string; text: string }
  > = {
    verifying: {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="animate-spin text-purple-500"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ),
      label: "Running E2E verification...",
      bg: "border-purple-200 bg-purple-50/60",
      text: "text-purple-800",
    },
    fixing: {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-amber-500"
        >
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
      ),
      label: `${verify.errorCount ?? 0} issue(s) found — auto-fixing in E2E stage (attempt ${verify.fixAttempts}/${verify.maxFixAttempts})...`,
      bg: "border-amber-200 bg-amber-50/60",
      text: "text-amber-800",
    },
    passed: {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-emerald-500"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
      label: `E2E passed${verify.fixAttempts > 0 ? ` after ${verify.fixAttempts} attempt${verify.fixAttempts === 1 ? "" : "s"}` : ""}`,
      bg: "border-emerald-200 bg-emerald-50/60",
      text: "text-emerald-800",
    },
    failed: {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-red-500"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
      label: `E2E failed after ${verify.fixAttempts} attempt${verify.fixAttempts === 1 ? "" : "s"}`,
      bg: "border-red-200 bg-red-50/60",
      text: "text-red-800",
    },
  };

  const cfg = statusConfig[verify.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-xl border ${cfg.bg} px-4 py-3`}
    >
      <button
        type="button"
        onClick={() => verify.errors && setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        {cfg.icon}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-zinc-900">
            E2E Verification
          </p>
          <p className={`text-[11px] font-medium ${cfg.text}`}>{cfg.label}</p>
        </div>
        {verify.errors && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.12 }}
            className="shrink-0 text-[10px] text-zinc-400"
          >
            ▾
          </motion.span>
        )}
      </button>
      {verify.status === "failed" && (
        <div className="mt-2.5 flex items-center justify-end">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {retrying ? "Retrying..." : "Retry E2E Verification"}
          </button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {expanded && verify.errors && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <pre className="mt-2.5 max-h-[200px] overflow-y-auto rounded-lg bg-zinc-900 p-3 font-mono text-[10px] leading-5 text-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {verify.errors}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
