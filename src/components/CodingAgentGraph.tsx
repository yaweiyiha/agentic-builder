"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useCodingStore, type IntegrationVerifyState } from "@/store/coding-store";
import Loading from "@/components/Loading";
import type {
  AgentLogEntry,
  CodingAgentInstance,
  CodingAgentRole,
  CodingTask,
  TaskSubStep,
} from "@/lib/pipeline/types";

const STATUS_DOT: Record<string, string> = {
  working: "bg-emerald-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  idle: "bg-zinc-300",
};

const ROLE_ORDER: CodingAgentRole[] = ["architect", "backend", "frontend", "test"];

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

const PHASE_TO_ROLE: Record<string, CodingAgentRole> = {
  Scaffolding: "architect",
  "Data Layer": "architect",
  Infrastructure: "architect",
  "Auth & Gateway": "backend",
  "Backend Services": "backend",
  Integration: "backend",
  Frontend: "frontend",
  Testing: "test",
};

type ExpandedRole = CodingAgentRole | "none" | null;
type DisplayLogEntry = AgentLogEntry & { agentLabel?: string };

type AgentGroup = {
  role: CodingAgentRole;
  label: string;
  agents: CodingAgentInstance[];
  tasks: CodingTask[];
  doneCount: number;
  failedCount: number;
  aggregateStatus: CodingAgentInstance["status"];
};

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

function SubStepList({ subSteps, taskStatus }: { subSteps: TaskSubStep[]; taskStatus: string }) {
  return (
    <div className="flex flex-col gap-1 py-1.5 pl-8 pr-3">
      {subSteps.map((step, idx) => {
        const isDone = taskStatus === "completed" || (taskStatus === "in_progress" && idx === 0);
        const isCurrent = taskStatus === "in_progress" && idx === 0;

        return (
          <div key={step.step} className="flex items-start gap-2">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              {isDone && !isCurrent ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-500">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : isCurrent ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] ${isDone ? "text-zinc-700" : "text-zinc-400"}`}>
                {step.action}
              </p>
              {step.detail && (
                <p className="text-[10px] text-zinc-400">{step.detail}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CodingAgentGraph() {
  const { status, agents, tasks, selectedAgentId, totalCostUsd, error, selectAgent, reset, integrationVerify } =
    useCodingStore();

  const [selectedRole, setSelectedRole] = useState<CodingAgentRole | null>(null);
  const [expandedRole, setExpandedRole] = useState<ExpandedRole>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent] as const)),
    [agents],
  );

  const groups = useMemo<AgentGroup[]>(() => {
    return ROLE_ORDER.map((role) => {
      const roleAgents = agents.filter((agent) => agent.role === role);
      if (roleAgents.length === 0) return null;

      const roleTasks = tasks.filter((task) => resolveTaskRole(task, agentById) === role);
      const doneCount = roleTasks.filter((task) => isCompletedTask(task)).length;
      const failedCount = roleTasks.filter((task) => task.codingStatus === "failed").length;
      const hasWorking = roleAgents.some((agent) => agent.status === "working");
      const hasFailed = roleAgents.some((agent) => agent.status === "failed") || failedCount > 0;
      const allCompleted =
        roleTasks.length > 0 && doneCount === roleTasks.length && !hasWorking && !hasFailed;

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
  }, [agentById, agents, tasks]);

  const defaultExpandedRole = groups.find((group) => group.agents.length > 1)?.role ?? null;
  const effectiveExpandedRole =
    expandedRole === "none"
      ? null
      : expandedRole ?? selectedAgent?.role ?? selectedRole ?? defaultExpandedRole;

  const visibleTasks = useMemo(() => {
    if (selectedAgent) {
      return tasks.filter((task) => task.assignedAgentId === selectedAgent.id);
    }
    if (selectedRole) {
      return tasks.filter((task) => resolveTaskRole(task, agentById) === selectedRole);
    }
    return tasks;
  }, [agentById, selectedAgent, selectedRole, tasks]);

  const visibleLogs = useMemo<DisplayLogEntry[]>(() => {
    if (selectedAgent) return selectedAgent.logs;
    if (!selectedRole) return [];

    return agents
      .filter((agent) => agent.role === selectedRole)
      .flatMap((agent) => agent.logs.map((log) => ({ ...log, agentLabel: agent.label })))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [agents, selectedAgent, selectedRole]);

  const selectedGroup = selectedRole ? groups.find((group) => group.role === selectedRole) ?? null : null;

  const scopeLabel = selectedAgent
    ? `${selectedAgent.label} — ${visibleTasks.length} tasks`
    : selectedGroup
      ? `${selectedGroup.label} — all workers · ${visibleTasks.length} tasks`
      : `All agents · ${visibleTasks.length} tasks`;

  const logPanelLabel = selectedAgent
    ? selectedAgent.label
    : selectedGroup
      ? `${selectedGroup.label} · All workers`
      : null;

  const completedTasks = tasks.filter((task) => isCompletedTask(task)).length;
  const failedTasks = tasks.filter((task) => task.codingStatus === "failed").length;
  const verifyingTasks = tasks.filter(
    (task) =>
      task.codingStatus === "in_progress" && task.progressStage === "verifying",
  ).length;
  const fixingTasks = tasks.filter(
    (task) =>
      task.codingStatus === "in_progress" && task.progressStage === "fixing",
  ).length;
  const totalTasks = tasks.length;

  if (status === "idle") {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center">
        <p className="text-sm text-zinc-400">Confirm the task breakdown to start multi-agent coding.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* ── Sidebar ── */}
      <aside className="flex w-[260px] flex-shrink-0 flex-col gap-2.5 border-r border-zinc-200 p-3.5">
        <p className="text-xs font-semibold text-zinc-500">Agents</p>

        {groups.map((group) => {
          const meta = ROLE_META[group.role];
          const isRoleSelected = selectedRole === group.role && !selectedAgent;
          const isExpanded = effectiveExpandedRole === group.role && group.agents.length > 1;
          const groupStatusLabel = formatGroupStatus(group);

          return (
            <div key={group.role} className="rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-stretch overflow-hidden rounded-xl">
                <div className={`w-1 ${meta.stripe}`} />
                <button
                  type="button"
                  onClick={() => {
                    selectAgent(null);
                    setSelectedRole((current) => (current === group.role && !selectedAgent ? null : group.role));
                    if (group.agents.length > 1) setExpandedRole(group.role);
                  }}
                  className={`flex flex-1 items-center justify-between px-3 py-2.5 text-left transition-colors ${
                    isRoleSelected
                      ? `${meta.selectedBg} ring-1 ${meta.selectedRing}`
                      : `${meta.tint} ${meta.hoverBg}`
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-zinc-900">{group.label}</p>
                    <p
                      className={`font-mono text-[10px] ${
                        group.aggregateStatus === "completed"
                          ? "text-emerald-600"
                          : group.aggregateStatus === "working"
                            ? "text-zinc-900"
                            : group.aggregateStatus === "failed"
                              ? "text-red-500"
                              : meta.tintText
                      }`}
                    >
                      {groupStatusLabel}
                    </p>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    {group.agents.length > 1 && (
                      <span className={`font-mono text-[10px] ${meta.tintText}`}>
                        {group.agents.length} workers
                      </span>
                    )}
                    {group.agents.length === 1 && (
                      <span className="font-mono text-[10px] text-zinc-400">All tasks</span>
                    )}
                  </div>
                </button>
                {group.agents.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedRole((current) => (current === group.role ? "none" : group.role));
                    }}
                    className={`flex w-9 items-center justify-center border-l border-zinc-200 ${meta.tint} ${meta.hoverBg}`}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.label}`}
                  >
                    <motion.span
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.16 }}
                      className={`text-xs ${meta.tintText}`}
                    >
                      ▾
                    </motion.span>
                  </button>
                )}
              </div>

              {/* Group progress bar */}
              {group.tasks.length > 0 && (
                <ProgressBar
                  completed={group.doneCount}
                  failed={group.failedCount}
                  total={group.tasks.length}
                  barColorClass={meta.barColor}
                  className="px-3 pb-2"
                />
              )}

              <AnimatePresence initial={false}>
                {group.agents.length > 1 && isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-col gap-1 border-t border-zinc-200 bg-zinc-50 px-2 py-2">
                      {group.agents.map((agent) => {
                        const isAgentSelected = selectedAgent?.id === agent.id;
                        const agentTasks = tasks.filter((task) => task.assignedAgentId === agent.id);
                        const doneCount = agentTasks.filter(
                          (task) => isCompletedTask(task),
                        ).length;

                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => {
                              setSelectedRole(group.role);
                              selectAgent(isAgentSelected ? null : agent.id);
                              setExpandedRole(group.role);
                            }}
                            className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors ${
                              isAgentSelected
                                ? `${meta.subSelectedBg} ${meta.subSelectedBorder} ring-1 ${meta.selectedRing}`
                                : `border-zinc-200 bg-white ${meta.subHoverBg}`
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[agent.status] ?? STATUS_DOT.idle}`}
                              />
                              <div className="min-w-0">
                                <p className="truncate text-[11px] font-semibold text-zinc-900">
                                  {agent.label}
                                </p>
                                <p className="font-mono text-[10px] text-zinc-500">
                                  {formatWorkerStatus(agent, agentTasks.length, doneCount)}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`ml-2 shrink-0 text-[10px] font-medium ${
                                isAgentSelected ? meta.tintText : "text-zinc-400"
                              }`}
                            >
                              {isAgentSelected ? "Selected" : "Open"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {status === "running" && agents.length === 0 && (
          <div className="flex items-center justify-center py-6">
            <Loading size="sm" text="Allocating..." />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2">
            <p className="text-[10px] text-red-600">{error}</p>
          </div>
        )}

        <div className="mt-auto" />

        {status === "completed" && (
          <button
            onClick={reset}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
          >
            Reset
          </button>
        )}
      </aside>

      {/* ── Main panel ── */}
      <main className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
        {/* Header + overall progress */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[15px] font-semibold text-zinc-900">Task Progress</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">{scopeLabel}</p>
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
              <span className="font-mono text-[11px] text-emerald-600">${totalCostUsd.toFixed(4)}</span>
            </div>
          </div>

          {/* Overall progress bar */}
          {totalTasks > 0 && (
            <ProgressBar
              completed={completedTasks}
              failed={failedTasks}
              total={totalTasks}
              barColorClass="bg-emerald-500"
            />
          )}
        </div>

        {/* Task list */}
        <div className="flex flex-col gap-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
          {visibleTasks.length === 0 ? (
            <div className="flex min-h-[160px] items-center justify-center rounded-lg bg-zinc-50">
              <p className="text-sm text-zinc-400">No tasks in this scope yet.</p>
            </div>
          ) : (
            visibleTasks.map((task) => {
              const isRunning = task.codingStatus === "in_progress";
              const isDone = isCompletedTask(task);
              const isWarning = task.codingStatus === "completed_with_warnings";
              const isFailed = task.codingStatus === "failed";
              const agent = task.assignedAgentId ? agentById.get(task.assignedAgentId) ?? null : null;
              const role = resolveTaskRole(task, agentById);
              const meta = ROLE_META[role];
              const hasSubSteps = task.subSteps && task.subSteps.length > 0;
              const isTaskExpanded = expandedTaskId === task.id;

              const taskSubStepTotal = task.subSteps?.length ?? 0;
              const taskSubStepDone = isDone
                ? taskSubStepTotal
                : isRunning
                  ? 1
                  : 0;

              return (
                <div key={task.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (hasSubSteps) {
                        setExpandedTaskId(isTaskExpanded ? null : task.id);
                      }
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3.5 py-2.5 text-left transition-colors ${
                      isRunning
                        ? "bg-white ring-1 ring-zinc-900"
                        : "bg-zinc-50 hover:bg-zinc-100/70"
                    }`}
                  >
                    {isWarning ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-amber-500">
                        <path d="M12 9v4" />
                        <path d="M12 17h.01" />
                        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      </svg>
                    ) : isDone ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0 text-emerald-500">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    ) : isRunning ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 animate-spin text-zinc-900">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    ) : isFailed ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-red-500">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-zinc-300">
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p
                          className={`truncate text-xs font-medium ${
                            isDone || isRunning ? "text-zinc-900" : "text-zinc-400"
                          }`}
                        >
                          {task.title}
                        </p>
                        {hasSubSteps && (
                          <motion.span
                            animate={{ rotate: isTaskExpanded ? 180 : 0 }}
                            transition={{ duration: 0.12 }}
                            className="shrink-0 text-[10px] text-zinc-400"
                          >
                            ▾
                          </motion.span>
                        )}
                      </div>
                      <p
                        className={`font-mono text-[10px] ${taskMetaColorClass(task)}`}
                      >
                        {formatTaskMeta(task, agent?.label ?? meta.label, hasSubSteps ? `${taskSubStepDone}/${taskSubStepTotal} steps` : undefined)}
                      </p>
                      {isCompletedTask(task) && (
                        <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                          {formatTaskArtifacts(task)}
                        </p>
                      )}

                      {/* Per-task progress bar */}
                      {(isRunning || isDone) && taskSubStepTotal > 0 && (
                        <ProgressBar
                          completed={taskSubStepDone}
                          failed={0}
                          total={taskSubStepTotal}
                          barColorClass={meta.barColor}
                          className="mt-1.5"
                        />
                      )}
                    </div>

                    <span
                      className={`shrink-0 font-mono text-[10px] ${
                        isWarning
                          ? "text-amber-600"
                          : isDone
                          ? "text-emerald-600"
                          : isRunning
                            ? task.progressStage === "fixing"
                              ? "font-semibold text-amber-700"
                              : "font-semibold text-zinc-900"
                            : isFailed
                              ? "text-red-500"
                              : "text-zinc-400"
                      }`}
                    >
                      {formatTaskStatus(task)}
                    </span>
                  </button>

                  {/* Sub-steps expandable */}
                  <AnimatePresence initial={false}>
                    {isTaskExpanded && hasSubSteps && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                      >
                        <SubStepList subSteps={task.subSteps!} taskStatus={task.codingStatus} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>

        {/* Final Verification */}
        {integrationVerify && (
          <IntegrationVerifyCard verify={integrationVerify} />
        )}

        {/* Log panel */}
        <AnimatePresence mode="wait">
          {logPanelLabel && (
            <motion.div
              key={logPanelLabel}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.12 }}
              className="flex min-h-[220px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg bg-zinc-50 p-3.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-zinc-500">Agent Log</p>
                <p className="font-mono text-[11px] text-zinc-900">{logPanelLabel}</p>
              </div>
              <div className="h-px bg-zinc-200" />
              {visibleLogs.length === 0 ? (
                <p className="font-mono text-[11px] text-zinc-400">No activity yet.</p>
              ) : (
                visibleLogs.map((log, index) => <LogLine key={`${log.timestamp}-${index}`} entry={log} />)
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function resolveTaskRole(
  task: CodingTask,
  agentById: Map<string, CodingAgentInstance>,
): CodingAgentRole {
  if (task.assignedAgentId) {
    const assignedAgent = agentById.get(task.assignedAgentId);
    if (assignedAgent) return assignedAgent.role;
  }
  if (PHASE_TO_ROLE[task.phase]) return PHASE_TO_ROLE[task.phase];

  const lower = `${task.phase} ${task.title} ${task.description}`.toLowerCase();
  if (/test|spec|e2e|vitest|playwright|k6|coverage/.test(lower)) return "test";
  if (/scaffold|infra|docker|helm|ci\/cd|deploy|config|schema|migrat/.test(lower)) {
    return "architect";
  }
  if (/frontend|react|component|page|ui|css|tailwind|hook|store|next/.test(lower)) {
    return "frontend";
  }
  return "backend";
}

function formatGroupStatus(group: AgentGroup): string {
  if (group.aggregateStatus === "working") return "Working...";
  if (group.aggregateStatus === "failed") {
    return group.failedCount > 0 ? `${group.failedCount} failed` : "Failed";
  }
  if (group.tasks.length === 0) return "Idle";
  return `${group.doneCount}/${group.tasks.length} done`;
}

function formatWorkerStatus(
  agent: CodingAgentInstance,
  totalTasks: number,
  doneCount: number,
): string {
  if (agent.status === "working") return "Working...";
  if (agent.status === "failed") return "Failed";
  if (totalTasks === 0) return "Idle";
  return `${doneCount}/${totalTasks} done`;
}

function isCompletedTask(task: CodingTask): boolean {
  return (
    task.codingStatus === "completed" ||
    task.codingStatus === "completed_with_warnings"
  );
}

function countTaskTsFiles(task: CodingTask): number {
  return (task.generatedFiles ?? []).filter((file) => /\.(ts|tsx)$/.test(file))
    .length;
}

function formatTaskMeta(
  task: CodingTask,
  agentLabel: string,
  subStepSummary?: string,
): string {
  if (task.codingStatus === "failed") {
    return `${agentLabel} · ${task.error ?? "Error"}`;
  }

  if (task.codingStatus === "in_progress") {
    const tsFileCount = countTaskTsFiles(task);
    if (task.progressStage === "fixing") {
      return `${agentLabel} · verify failed · attempt ${task.fixAttempts ?? 1}/3 · ${tsFileCount} TS files`;
    }
    if (task.progressStage === "verifying") {
      return `${agentLabel} · verifying${tsFileCount > 0 ? ` · ${tsFileCount} TS files` : ""}`;
    }
    return `${agentLabel}${subStepSummary ? ` · ${subStepSummary}` : ""} · Generating...`;
  }

  if (task.codingStatus === "completed_with_warnings") {
    return `${agentLabel} · completed with warnings${task.fixAttempts ? ` · ${task.fixAttempts} fix attempt${task.fixAttempts === 1 ? "" : "s"}` : ""}`;
  }

  if (task.codingStatus === "completed") {
    const tokenText = task.tokenUsage?.totalTokens
      ? ` · ${task.tokenUsage.totalTokens.toLocaleString()} tokens`
      : "";
    const costText =
      task.taskCostUsd !== undefined ? ` · $${task.taskCostUsd.toFixed(4)}` : "";
    return `${agentLabel}${subStepSummary ? ` · ${subStepSummary}` : ""}${task.generatedFiles ? ` · ${task.generatedFiles.length} files` : ""}${tokenText}${costText}`;
  }

  return `${agentLabel}${subStepSummary ? ` · ${subStepSummary}` : ""} · Queued`;
}

function formatTaskArtifacts(task: CodingTask): string {
  const files = task.modifiedFiles ?? task.generatedFiles ?? [];
  const tokens = task.tokenUsage?.totalTokens ?? 0;
  const cost = task.taskCostUsd;
  const filesText = files.length > 0 ? `${files.length} files` : "0 files";
  const tokenText = tokens > 0 ? `${tokens.toLocaleString()} tokens` : "0 tokens";
  const costText = cost !== undefined ? `$${cost.toFixed(4)}` : "$0.0000";
  return `${filesText} · ${tokenText} · ${costText}`;
}

function formatTaskStatus(task: CodingTask): string {
  if (task.codingStatus === "completed_with_warnings") return "Warning";
  if (task.codingStatus === "completed") return "Done";
  if (task.codingStatus === "failed") return "Failed";
  if (task.progressStage === "fixing") return "Fixing";
  if (task.progressStage === "verifying") return "Verifying";
  if (task.codingStatus === "in_progress") return "Running";
  return "Pending";
}

function taskMetaColorClass(task: CodingTask): string {
  if (task.codingStatus === "failed") return "text-red-500";
  if (task.codingStatus === "completed_with_warnings") return "text-amber-600";
  if (task.progressStage === "fixing") return "text-amber-700";
  if (task.progressStage === "verifying") return "text-zinc-500";
  if (task.codingStatus === "in_progress") return "text-zinc-500";
  return "text-zinc-400";
}

function IntegrationVerifyCard({ verify }: { verify: IntegrationVerifyState }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig: Record<
    IntegrationVerifyState["status"],
    { icon: React.ReactNode; label: string; bg: string; text: string }
  > = {
    verifying: {
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin text-indigo-500">
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500">
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500">
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
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

function LogLine({ entry }: { entry: DisplayLogEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const color =
    entry.type === "task_error"
      ? "text-red-500"
      : entry.type === "task_fix"
        ? "text-zinc-800"
        : entry.type === "task_verify"
          ? entry.message.includes("FAILED")
            ? "text-red-600"
            : entry.message.includes("passed")
              ? "text-emerald-600"
              : "text-zinc-500"
          : entry.type === "task_complete"
            ? "text-zinc-500"
            : entry.type === "task_progress"
              ? "text-zinc-500"
              : "text-zinc-400";

  return (
    <div className="space-y-1 rounded-md border border-zinc-200 bg-white px-2.5 py-2">
      <p className="font-mono text-[11px]">
        <span className="text-zinc-400">[{time}]</span>{" "}
        {entry.agentLabel && <span className="text-zinc-500">[{entry.agentLabel}] </span>}
        <span className={color}>{entry.message}</span>
      </p>
      {entry.details && (
        <pre className="whitespace-pre-wrap break-words rounded bg-zinc-900 px-2 py-1.5 font-mono text-[10px] leading-5 text-zinc-200">
          {entry.details}
        </pre>
      )}
    </div>
  );
}
