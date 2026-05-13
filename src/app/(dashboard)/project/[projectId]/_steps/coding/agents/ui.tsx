"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  ReactFlowProvider,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Play, Clock } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { useCodingStore } from "@/store/coding-store";
import { useStepStore } from "@/store/step-store";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import type { StepUIProps } from "../../_shared/types";
import type { CodingTask, KickoffWorkItem } from "@/lib/pipeline/types";

import { TaskNode, type TaskNodeData } from "./components/TaskNode";
import { TaskDetailPanel } from "./components/TaskDetailPanel";
import { AgentBubbles } from "./components/AgentBubbles";
import { StatusBar } from "./components/StatusBar";
import { useElapsedTimer } from "./use-elapsed-timer";

// ─── React Flow node type registry ───────────────────────────────────────────

const nodeTypes = { taskNode: TaskNode };

// ─── DAG layout: assign each node a level = max(dep levels) + 1 ──────────────
// Produces a left-to-right flow: level 0 at x=0, level 1 at x=COL_GAP, etc.

const NODE_W = 240;
const NODE_H = 120;
const COL_GAP = 310;
const ROW_GAP = 148;

function computeTopoLevels(
  tasks: (KickoffWorkItem | CodingTask)[],
): Map<string, number> {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();

  function getLevel(id: string, visiting: Set<string>): number {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    const next = new Set(visiting);
    next.add(id);
    const deps = (taskMap.get(id)?.dependencies ?? []).filter((d) =>
      taskMap.has(d),
    );
    const level =
      deps.length === 0
        ? 0
        : Math.max(...deps.map((d) => getLevel(d, next))) + 1;
    memo.set(id, level);
    return level;
  }

  for (const t of tasks) getLevel(t.id, new Set());
  return memo;
}

function buildFlowGraph(
  tasks: (KickoffWorkItem | CodingTask)[],
  selectedId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  if (tasks.length === 0) return { nodes: [], edges: [] };

  const levels = computeTopoLevels(tasks);

  // Group by level
  const levelMap = new Map<number, string[]>();
  for (const [id, lvl] of levels) {
    if (!levelMap.has(lvl)) levelMap.set(lvl, []);
    levelMap.get(lvl)!.push(id);
  }

  const sortedLevels = Array.from(levelMap.entries()).sort(([a], [b]) => a - b);
  const maxPerLevel = Math.max(...sortedLevels.map(([, ids]) => ids.length));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const nodes: Node[] = [];
  const posMap = new Map<string, { x: number; y: number }>();

  for (const [lvl, ids] of sortedLevels) {
    const vertOffset = ((maxPerLevel - ids.length) * ROW_GAP) / 2;
    ids.forEach((id, rowIdx) => {
      const x = lvl * COL_GAP;
      const y = vertOffset + rowIdx * ROW_GAP;
      posMap.set(id, { x, y });
      nodes.push({
        id,
        type: "taskNode",
        position: { x, y },
        selected: id === selectedId,
        data: { task: taskMap.get(id)! } satisfies TaskNodeData,
        style: { width: NODE_W, height: NODE_H },
      });
    });
  }

  // Collect active task ids so edges leading INTO them can be animated
  const activeIds = new Set(
    tasks
      .filter(
        (t) =>
          "codingStatus" in t &&
          (t as CodingTask).codingStatus === "in_progress",
      )
      .map((t) => t.id),
  );

  // Build edges from dependency graph
  const edges: Edge[] = [];
  for (const task of tasks) {
    for (const depId of task.dependencies ?? []) {
      if (!posMap.has(depId) || !posMap.has(task.id)) continue;

      // Animate the edge when the TARGET node is actively running
      // (i.e. data is flowing from the completed dep into the active task)
      const flowing = activeIds.has(task.id);

      // Get the phase accent color of the target task for the flowing edge
      const targetTask = taskMap.get(task.id);
      const edgeColor = flowing && targetTask
        ? "#8b5cf6"
        : "#94a3b8";

      edges.push({
        id: `e-${depId}-${task.id}`,
        source: depId,
        target: task.id,
        // "default" = cubic bezier in React Flow
        type: "default",
        animated: flowing,
        style: {
          stroke: edgeColor,
          strokeWidth: flowing ? 2 : 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 12,
          height: 12,
        },
      });
    }
  }

  return { nodes, edges };
}

function calcProgress(tasks: CodingTask[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter(
    (t) =>
      t.codingStatus === "completed" ||
      t.codingStatus === "completed_with_warnings",
  ).length;
  return Math.round((done / tasks.length) * 100);
}

function useMergedTasks(
  kickoffTasks: KickoffWorkItem[],
  codingTasks: CodingTask[],
): (KickoffWorkItem | CodingTask)[] {
  return useMemo(() => {
    if (codingTasks.length === 0) return kickoffTasks;
    const map = new Map(codingTasks.map((t) => [t.id, t]));
    return kickoffTasks.map((t) => map.get(t.id) ?? t);
  }, [kickoffTasks, codingTasks]);
}

// ─── Inner component (needs to be inside ReactFlowProvider) ──────────────────

function AgentsFlowInner({ onNavigate }: StepUIProps) {
  const steps = useStepStore((s) => s.steps);
  const codeOutputDir = useStepStore((s) => s.codeOutputDir);
  const setStepResult = useStepStore((s) => s.setStepResult);

  const codingState = useCodingStore();
  const { startCoding } = useCodingStore();

  const isIdle = codingState.status === "idle";
  const isRunning = codingState.status === "running";
  const isDone = codingState.status === "completed";
  const isFailed = codingState.status === "failed";
  const hasStarted = !isIdle;

  // ── Data from step-store (pre-hydrated by parent page) ─────────────────────
  const prdContent = steps.prd?.content ?? "";

  const taskMeta = useMemo(
    () =>
      (steps["task-breakdown"]?.metadata ??
        steps.summary?.metadata) as Record<string, unknown> | undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps["task-breakdown"]?.metadata, steps.summary?.metadata],
  );

  const kickoffTasks = useMemo(
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

  // ── Merge kickoff + live coding tasks ──────────────────────────────────────
  const mergedTasks = useMergedTasks(kickoffTasks, codingState.tasks);

  // ── Selected task ──────────────────────────────────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedTask = useMemo(
    () => mergedTasks.find((t) => t.id === selectedTaskId) ?? null,
    [mergedTasks, selectedTaskId],
  );

  // ── React Flow state ───────────────────────────────────────────────────────
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const { nodes: n, edges: e } = buildFlowGraph(mergedTasks, selectedTaskId);
    setNodes(n);
    setEdges(e);
  }, [mergedTasks, selectedTaskId, setNodes, setEdges]);

  // ── Timer ──────────────────────────────────────────────────────────────────
  const { formatted: elapsed } = useElapsedTimer(isRunning);

  // ── Progress ───────────────────────────────────────────────────────────────
  const progress = calcProgress(codingState.tasks);

  // ── Persist result when done ───────────────────────────────────────────────
  useEffect(() => {
    if (!isDone && !isFailed) return;
    setStepResult("agents", {
      stepId: "agents",
      status: isDone ? "completed" : "failed",
      content: JSON.stringify({
        agentsCompleted: codingState.agents.filter(
          (a) => a.status === "completed",
        ).length,
        totalCostUsd: codingState.totalCostUsd,
        tasksCompleted: codingState.tasks.filter(
          (t) => t.codingStatus === "completed",
        ).length,
        totalTasks: codingState.tasks.length,
      }),
      costUsd: codingState.totalCostUsd,
      error: codingState.error ?? undefined,
      metadata: {
        agentCount: codingState.agents.length,
        taskCount: codingState.tasks.length,
      },
      timestamp: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone, isFailed]);

  // ── Agent logs (flat, all agents) ──────────────────────────────────────────
  const allAgentLogs = useMemo(
    () => codingState.agents.flatMap((a) => a.logs),
    [codingState.agents],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    setSelectedTaskId((prev) => (prev === node.id ? null : node.id));
  }, []);

  const handleStart = useCallback(() => {
    if (!isIdle || kickoffTasks.length === 0) return;
    startCoding(runId, kickoffTasks, codeOutputDir, projectTier, prdContent);
  }, [isIdle, kickoffTasks, runId, codeOutputDir, projectTier, prdContent, startCoding]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (isIdle && kickoffTasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 text-center max-w-sm"
        >
          <div className="w-12 h-12 rounded-full border-2 border-slate-200 flex items-center justify-center">
            <Clock size={18} className="text-slate-300" />
          </div>
          <p className="text-[14px] text-slate-400 leading-relaxed">
            Complete the Kick-off stage first to generate the task breakdown
            before starting coding.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f8fafc]">
      {/* ─── Top bar ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-6 px-6 py-3 bg-white border-b border-slate-200">
        {/* Overall progress */}
        <div className="flex items-center gap-3 min-w-45">
          <div className="flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              OVERALL PROGRESS
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-violet-500 rounded-full"
                  animate={{ width: `${hasStarted ? progress : 0}%` }}
                  transition={{ duration: 0.6 }}
                />
              </div>
              <span className="text-[12px] font-bold text-slate-700 w-8 text-right">
                {hasStarted ? `${progress}%` : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Time elapsed */}
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            TIME ELAPSED
          </p>
          <span className="text-[14px] font-mono font-bold text-slate-700">
            {isRunning || isDone || isFailed ? elapsed : "00:00:00"}
          </span>
        </div>

        {/* Active agents */}
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            ACTIVE AGENTS
          </p>
          <AgentBubbles agents={codingState.agents} />
        </div>

        {/* Cost */}
        {codingState.totalCostUsd > 0 && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              COST
            </p>
            <span className="text-[12px] font-mono font-bold text-slate-600">
              ${codingState.totalCostUsd.toFixed(4)}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* CTA buttons */}
        {isIdle && kickoffTasks.length > 0 && (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-5 py-2 bg-[#712ae2] hover:bg-[#5f24c2] text-white text-[12px] font-bold rounded-lg transition-colors shadow-sm"
          >
            <Play size={13} />
            Start Coding
          </button>
        )}

        {isDone && (
          <button
            onClick={() => onNavigate("serve")}
            className="flex items-center gap-2 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[12px] font-bold rounded-lg transition-colors"
          >
            Continue to Preview →
          </button>
        )}
      </div>

      {/* ─── Main: flow canvas + detail panel ───────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* React Flow canvas */}
        <div className="flex-1 relative overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
            minZoom={0.3}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            className="bg-[#f8fafc]"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#e2e8f0"
            />
            <Controls
              showInteractive={false}
              className="border-slate-200! shadow-sm!"
            />
          </ReactFlow>
        </div>

        {/* Task detail panel — slides in from right */}
        <AnimatePresence>
          {selectedTask && (
            <motion.div
              key="detail-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="shrink-0 overflow-hidden border-l border-slate-200 bg-white"
            >
              <div className="w-95 h-full">
                <TaskDetailPanel
                  task={selectedTask}
                  allAgentLogs={allAgentLogs}
                  supervisorLogs={codingState.supervisorLogs}
                  onClose={() => setSelectedTaskId(null)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Bottom status bar ──────────────────────────────────────────────── */}
      <StatusBar
        isRunning={isRunning}
        isCompleted={isDone}
        isFailed={isFailed}
        onAbort={() => codingState.reset()}
      />
    </div>
  );
}

// ─── Exported wrapper (provides ReactFlow context) ────────────────────────────

export function AgentsUI(props: StepUIProps) {
  return (
    <ReactFlowProvider>
      <AgentsFlowInner {...props} />
    </ReactFlowProvider>
  );
}
