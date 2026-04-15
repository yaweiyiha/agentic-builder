"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CodingLogLine,
  type CodingLogDisplayEntry,
} from "@/components/CodingLogLine";
import type {
  CodingAgentInstance,
  CodingTask,
  TaskSubStep,
} from "@/lib/pipeline/types";
import {
  formatTaskStatus,
  isCompletedTask,
  resolveTaskRole,
} from "@/lib/coding-task-ui";
import type { CodingAgentRole } from "@/lib/pipeline/types";

function filterDeps(task: CodingTask, idSet: Set<string>): string[] {
  const raw = task.dependencies ?? [];
  const out: string[] = [];
  for (const d of raw) {
    if (d === task.id) continue;
    if (idSet.has(d)) out.push(d);
  }
  return out;
}

/**
 * Topological layers left → right: layer = 1 + max(layer(dep)) for known deps (DAG).
 * Tasks not reachable in topo order (cycles) are placed in the last layer together.
 */
function computeLayers(tasks: CodingTask[]): {
  layers: string[][];
  cycleIds: Set<string>;
} {
  const idSet = new Set(tasks.map((t) => t.id));
  const taskMap = new Map(tasks.map((t) => [t.id, t] as const));

  const indegree = new Map<string, number>();
  const successors = new Map<string, string[]>();

  for (const t of tasks) {
    indegree.set(t.id, filterDeps(t, idSet).length);
  }
  for (const t of tasks) {
    for (const d of filterDeps(t, idSet)) {
      if (!successors.has(d)) successors.set(d, []);
      successors.get(d)!.push(t.id);
    }
  }

  const order: string[] = [];
  const q: string[] = tasks
    .filter((t) => (indegree.get(t.id) ?? 0) === 0)
    .map((t) => t.id);
  while (q.length > 0) {
    const id = q.shift()!;
    order.push(id);
    for (const s of successors.get(id) ?? []) {
      const next = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, next);
      if (next === 0) q.push(s);
    }
  }

  const cycleIds = new Set<string>();
  if (order.length < tasks.length) {
    for (const t of tasks) {
      if (!order.includes(t.id)) cycleIds.add(t.id);
    }
  }

  const level = new Map<string, number>();
  for (const id of order) {
    const t = taskMap.get(id);
    if (!t) continue;
    const deps = filterDeps(t, idSet);
    const base =
      deps.length === 0
        ? 0
        : Math.max(...deps.map((d) => level.get(d) ?? 0)) + 1;
    level.set(id, base);
  }

  let maxL = 0;
  for (const v of level.values()) maxL = Math.max(maxL, v);
  const cycleLayer = maxL + 1;
  for (const id of cycleIds) level.set(id, cycleLayer);

  const layerBuckets = new Map<number, string[]>();
  for (const t of tasks) {
    const lv = level.get(t.id) ?? 0;
    if (!layerBuckets.has(lv)) layerBuckets.set(lv, []);
    layerBuckets.get(lv)!.push(t.id);
  }

  const sortedLayerKeys = [...layerBuckets.keys()].sort((a, b) => a - b);
  const layers = sortedLayerKeys.map((k) =>
    (layerBuckets.get(k) ?? []).sort((a, b) => {
      const ta = taskMap.get(a)!;
      const tb = taskMap.get(b)!;
      return ta.title.localeCompare(tb.title) || a.localeCompare(b);
    }),
  );

  return { layers, cycleIds };
}

function taskLogEntries(
  task: CodingTask,
  agents: CodingAgentInstance[],
): CodingLogDisplayEntry[] {
  if (!task.assignedAgentId) return [];
  const agent = agents.find((a) => a.id === task.assignedAgentId);
  if (!agent) return [];
  return agent.logs
    .filter((e) => e.taskId === task.id)
    .map((e) => ({ ...e, agentLabel: agent.label }))
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
}

function isSupplementaryTask(task: CodingTask): boolean {
  return task.id.startsWith("SUP-");
}

function SubStepList({
  subSteps,
  taskStatus,
}: {
  subSteps: TaskSubStep[];
  taskStatus: string;
}) {
  const isCompleted =
    taskStatus === "completed" || taskStatus === "completed_with_warnings";

  return (
    <div className="flex flex-col gap-1 py-1.5">
      {subSteps.map((step, idx) => {
        const isDone = isCompleted;
        const isCurrent = taskStatus === "in_progress";

        return (
          <div key={step.step} className="flex items-start gap-2">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              {isDone ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-emerald-500"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : isCurrent && idx === 0 ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`text-[11px] ${
                  isDone
                    ? "text-zinc-700"
                    : isCurrent && idx === 0
                      ? "text-zinc-800 font-medium"
                      : "text-zinc-400"
                }`}
              >
                <span className="mr-1 font-mono text-[9px] text-zinc-400">
                  {step.step}.
                </span>
                {step.action}
              </p>
              {step.detail && (
                <p className="ml-4 text-[10px] text-zinc-400">{step.detail}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskStatusIcon({ task }: { task: CodingTask }) {
  const done = isCompletedTask(task);
  const isWarning = task.codingStatus === "completed_with_warnings";
  const isRunning = task.codingStatus === "in_progress";
  const isFailed = task.codingStatus === "failed";

  if (isWarning) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 text-amber-500"
      >
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
    );
  }
  if (done) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="shrink-0 text-emerald-500"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }
  if (isRunning) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 animate-spin text-zinc-900"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (isFailed) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 text-red-500"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="shrink-0 text-zinc-300"
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

const ROLE_CARD_META: Record<
  CodingAgentRole,
  { label: string; badgeBg: string; badgeText: string; stripe: string }
> = {
  architect: {
    label: "Architect",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-700",
    stripe: "bg-amber-500",
  },
  backend: {
    label: "Backend",
    badgeBg: "bg-blue-100",
    badgeText: "text-blue-700",
    stripe: "bg-blue-600",
  },
  frontend: {
    label: "Frontend",
    badgeBg: "bg-violet-100",
    badgeText: "text-violet-700",
    stripe: "bg-violet-600",
  },
  test: {
    label: "Test",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-700",
    stripe: "bg-emerald-600",
  },
};

const STAGE_BADGE: Record<string, { label: string; cls: string }> = {
  generating: { label: "GENERATING", cls: "bg-emerald-500 text-white" },
  verifying: { label: "VERIFYING", cls: "bg-blue-500 text-white" },
  fixing: { label: "FIXING", cls: "bg-amber-500 text-white" },
};

function taskNodeBorderClass(task: CodingTask, selected: boolean): string {
  if (selected) return "border-zinc-900 ring-1 ring-zinc-900";
  if (task.codingStatus === "completed") return "border-emerald-300";
  if (task.codingStatus === "completed_with_warnings")
    return "border-amber-300";
  if (task.codingStatus === "in_progress")
    return "border-zinc-400 ring-1 ring-zinc-300/60";
  if (task.codingStatus === "failed") return "border-red-300";
  return "border-zinc-200 hover:border-zinc-300";
}

function taskNodeBgClass(task: CodingTask): string {
  if (task.codingStatus === "completed") return "bg-emerald-50/40";
  if (task.codingStatus === "completed_with_warnings") return "bg-amber-50/40";
  if (task.codingStatus === "failed") return "bg-red-50/40";
  return "bg-white";
}

function TaskNodeCard({
  task,
  agentById,
  selected,
  onSelect,
  nodeRef,
}: {
  task: CodingTask;
  agentById: Map<string, CodingAgentInstance>;
  selected: boolean;
  onSelect: () => void;
  nodeRef: (el: HTMLDivElement | null) => void;
}) {
  const role = resolveTaskRole(task, agentById);
  const roleMeta = ROLE_CARD_META[role];
  const isRunning = task.codingStatus === "in_progress";
  const stageBadge = task.progressStage
    ? STAGE_BADGE[task.progressStage]
    : null;
  const isSup = isSupplementaryTask(task);
  const subStepCount = task.subSteps?.length ?? 0;

  return (
    <div ref={nodeRef} className="relative w-[210px] shrink-0">
      <motion.div
        layout
        className={`overflow-hidden rounded-xl border shadow-sm transition-all ${taskNodeBgClass(task)} ${taskNodeBorderClass(task, selected)} ${isSup ? "ring-1 ring-orange-200" : ""}`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full items-stretch text-left"
        >
          {/* Left role stripe */}
          <div
            className={`w-[3px] shrink-0 ${isSup ? "bg-orange-500" : roleMeta.stripe}`}
          />

          <div className="min-w-0 flex-1 px-2.5 py-2.5">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1">
              <span
                className={`inline-flex items-center rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${roleMeta.badgeBg} ${roleMeta.badgeText}`}
              >
                {roleMeta.label}
              </span>
              {isRunning && (
                <span className="inline-flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-px text-[9px] font-bold tracking-wide text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  running
                </span>
              )}
              {isSup && (
                <span className="inline-flex items-center rounded bg-orange-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-orange-700">
                  GAP FIX
                </span>
              )}
            </div>

            {/* Title */}
            <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-zinc-900">
              {task.title}
            </p>

            {/* Status line: role · stage */}
            <div className="mt-1 flex items-center gap-1.5">
              <TaskStatusIcon task={task} />
              <span
                className={`font-mono text-[9px] ${
                  task.codingStatus === "completed"
                    ? "text-emerald-600 font-medium"
                    : task.codingStatus === "completed_with_warnings"
                      ? "text-amber-600 font-medium"
                      : task.codingStatus === "failed"
                        ? "text-red-500 font-medium"
                        : task.progressStage === "fixing"
                          ? "text-amber-700 font-semibold"
                          : task.progressStage === "verifying"
                            ? "text-blue-600 font-medium"
                            : task.progressStage === "generating"
                              ? "text-emerald-700 font-semibold"
                              : task.codingStatus === "in_progress"
                                ? "text-zinc-600 font-medium"
                                : "text-zinc-400"
                }`}
              >
                {roleMeta.label} · {formatTaskStatus(task)}
              </span>
            </div>

            {/* Sub-step micro progress */}
            {subStepCount > 0 && (
              <p className="mt-1 font-mono text-[9px] text-zinc-400">
                {subStepCount} sub-step{subStepCount === 1 ? "" : "s"}
              </p>
            )}

            {/* Stage badge when in_progress */}
            {isRunning && stageBadge && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-2"
              >
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-bold ${stageBadge.cls}`}
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/80" />
                  {stageBadge.label}
                </span>
              </motion.div>
            )}
          </div>
        </button>
      </motion.div>
    </div>
  );
}

export default function CodingTaskTopologyView({
  tasks,
  agents,
  agentById,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: CodingTask[];
  agents: CodingAgentInstance[];
  agentById: Map<string, CodingAgentInstance>;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [edges, setEdges] = useState<{ path: string; key: string }[]>([]);

  const { layers, cycleIds } = useMemo(() => computeLayers(tasks), [tasks]);
  const taskMap = useMemo(
    () => new Map(tasks.map((t) => [t.id, t] as const)),
    [tasks],
  );
  const idSet = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);

  const selectedTask = selectedTaskId
    ? (taskMap.get(selectedTaskId) ?? null)
    : null;
  const selectedTaskLogs = useMemo(
    () => (selectedTask ? taskLogEntries(selectedTask, agents) : []),
    [selectedTask, agents],
  );

  const redraw = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;

    const rootRect = root.getBoundingClientRect();
    const w = root.scrollWidth;
    const h = root.scrollHeight;
    setSvgSize({ w, h });

    const nextEdges: { path: string; key: string }[] = [];
    for (const t of tasks) {
      const deps = filterDeps(t, idSet);
      for (const depId of deps) {
        const fromEl = nodeRefs.current[depId];
        const toEl = nodeRefs.current[t.id];
        if (!fromEl || !toEl) continue;

        const a = fromEl.getBoundingClientRect();
        const b = toEl.getBoundingClientRect();

        const x1 = a.right - rootRect.left + root.scrollLeft;
        const y1 = a.top - rootRect.top + root.scrollTop + a.height / 2;
        const x2 = b.left - rootRect.left + root.scrollLeft;
        const y2 = b.top - rootRect.top + root.scrollTop + b.height / 2;

        const mid = x1 + (x2 - x1) * 0.5;
        const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
        nextEdges.push({ path: d, key: `${depId}->${t.id}` });
      }
    }
    setEdges(nextEdges);
  }, [tasks, idSet]);

  useLayoutEffect(() => {
    redraw();
    const ro = new ResizeObserver(() => redraw());
    const root = scrollRef.current;
    if (root) ro.observe(root);
    window.addEventListener("resize", redraw);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", redraw);
    };
  }, [redraw, layers]);

  useLayoutEffect(() => {
    const id = requestAnimationFrame(redraw);
    return () => cancelAnimationFrame(id);
  }, [redraw, tasks, selectedTaskId]);

  if (tasks.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-zinc-50">
        <p className="text-sm text-zinc-400">No tasks to display.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          ref={scrollRef}
          className="relative min-h-[240px] min-w-0 flex-1 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2"
        >
          {svgSize.w > 0 && svgSize.h > 0 && (
            <svg
              className="pointer-events-none absolute left-0 top-0 text-zinc-300"
              width={svgSize.w}
              height={svgSize.h}
              aria-hidden
            >
              {edges.map((e) => (
                <path
                  key={e.key}
                  d={e.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.25}
                />
              ))}
            </svg>
          )}

          <div className="relative z-[1] flex min-w-max gap-10 p-6">
            {layers.map((col, colIdx) => (
              <div key={colIdx} className="flex flex-col gap-4">
                <div className="text-center">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                    Stage {colIdx + 1}
                  </span>
                  {colIdx === layers.length - 1 && cycleIds.size > 0 && (
                    <p className="mt-0.5 font-mono text-[9px] text-amber-600">
                      Cycle / unresolved deps
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  {col.map((id) => {
                    const task = taskMap.get(id);
                    if (!task) return null;
                    return (
                      <TaskNodeCard
                        key={id}
                        task={task}
                        agentById={agentById}
                        selected={selectedTaskId === id}
                        onSelect={() =>
                          onSelectTask(selectedTaskId === id ? null : id)
                        }
                        nodeRef={(el) => {
                          nodeRefs.current[id] = el;
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="flex max-h-[min(85vh,920px)] min-h-0 w-full min-w-0 shrink-0 flex-col rounded-xl border border-zinc-200 bg-white lg:max-w-[min(440px,44vw)] lg:min-w-[320px] lg:w-[38%]">
        <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5">
          <p className="text-xs font-semibold text-zinc-500">Inspector</p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
            {selectedTask ? selectedTask.title : "Select a node"}
          </p>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 max-h-[min(40vh,320px)] shrink-0 overflow-y-auto px-3 py-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
            <AnimatePresence mode="wait">
              {selectedTask ? (
                <motion.div
                  key={selectedTask.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col gap-3"
                >
                  {/* Supplementary task badge */}
                  {isSupplementaryTask(selectedTask) && (
                    <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/80 px-2.5 py-2">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="shrink-0 text-orange-600"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="16" />
                        <line x1="8" y1="12" x2="16" y2="12" />
                      </svg>
                      <div>
                        <p className="text-[11px] font-semibold text-orange-900">
                          Supplementary Task
                        </p>
                        <p className="font-mono text-[10px] text-orange-800/90">
                          {(
                            selectedTask as unknown as {
                              gapDescription?: string;
                            }
                          ).gapDescription ??
                            "Auto-generated from gap analysis after integration verification."}
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                      Status
                    </p>
                    <p className="font-mono text-[11px] text-zinc-800">
                      {formatTaskStatus(selectedTask)}
                    </p>
                    {selectedTask.codingStatus === "in_progress" && (
                      <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                        <div>
                          <p className="text-[11px] font-semibold text-zinc-900">
                            running
                          </p>
                          <p className="font-mono text-[10px] text-zinc-500">
                            The assigned agent is actively working on this task.
                          </p>
                        </div>
                      </div>
                    )}
                    {isCompletedTask(selectedTask) && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-2">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          className="shrink-0 text-emerald-600"
                        >
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <div>
                          <p className="text-[11px] font-semibold text-emerald-900">
                            Completed
                          </p>
                          <p className="font-mono text-[10px] text-emerald-800/90">
                            Same explicit-done signal as the task list and
                            Ralph-style runs.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  {selectedTask.dependencies &&
                    selectedTask.dependencies.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                          Depends on
                        </p>
                        <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-zinc-600">
                          {selectedTask.dependencies.map((dep) => (
                            <li key={dep}>
                              {idSet.has(dep) ? (
                                <button
                                  type="button"
                                  className="text-left text-blue-600 underline decoration-blue-600/30 hover:decoration-blue-600"
                                  onClick={() => onSelectTask(dep)}
                                >
                                  {taskMap.get(dep)?.title ?? dep}
                                </button>
                              ) : (
                                <span>{dep}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {/* Acceptance criteria */}
                  {selectedTask.acceptanceCriteria &&
                    selectedTask.acceptanceCriteria.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                          Acceptance Criteria
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {selectedTask.acceptanceCriteria.map((ac, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-1.5 text-[10px] text-zinc-600"
                            >
                              <span className="mt-0.5 text-zinc-400">•</span>
                              <span>{ac}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                      Implementation Plan
                    </p>
                    {selectedTask.subSteps &&
                    selectedTask.subSteps.length > 0 ? (
                      <SubStepList
                        subSteps={selectedTask.subSteps}
                        taskStatus={selectedTask.codingStatus}
                      />
                    ) : selectedTask.codingStatus === "in_progress" ? (
                      <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-zinc-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
                        Generating plan...
                      </p>
                    ) : (
                      <p className="mt-1 font-mono text-[10px] text-zinc-400">
                        No sub-steps for this task.
                      </p>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="font-mono text-[11px] text-zinc-400"
                >
                  Click a task node to inspect sub-tasks, dependencies, and the
                  full task log.
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-zinc-200 bg-zinc-50/90">
            <p className="shrink-0 px-3 py-2 text-xs font-semibold text-zinc-500">
              Task log (full)
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {!selectedTask ? (
                <p className="font-mono text-[10px] text-zinc-400">
                  Select a task to load its log entries.
                </p>
              ) : selectedTaskLogs.length === 0 ? (
                <p className="font-mono text-[10px] text-zinc-400">
                  No log lines tagged for this task yet. Streamed entries appear
                  as the agent runs.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {selectedTaskLogs.map((entry, idx) => (
                    <CodingLogLine
                      key={`${entry.timestamp}-${idx}`}
                      entry={entry}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
