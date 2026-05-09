"use client";

import { useMemo } from "react";
import { Zap, Play, ListTodo, Clock, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import CodingAgentGraph from "@/components/CodingAgentGraph";
import { useCodingStore } from "@/store/coding-store";
import { usePipelineStore } from "@/store/pipeline-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import type { KickoffWorkItem } from "@/lib/pipeline/types";

// ─── Phase badge colours ────────────────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  backend:  "bg-blue-50  text-blue-700  border border-blue-200",
  frontend: "bg-violet-50 text-violet-700 border border-violet-200",
  test:     "bg-green-50 text-green-700  border border-green-200",
  architect:"bg-amber-50 text-amber-700  border border-amber-200",
};
function phaseBadge(phase: string) {
  const cls = PHASE_COLORS[phase.toLowerCase()] ?? "bg-slate-50 text-slate-600 border border-slate-200";
  return (
    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${cls}`}>
      {phase}
    </span>
  );
}

// ─── Task list row ───────────────────────────────────────────────────────────

function TaskRow({ task }: { task: KickoffWorkItem }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[#f1f5f9] last:border-0">
      <div className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[#f1f5f9] flex items-center justify-center">
        <ListTodo size={11} className="text-[#94a3b8]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-[#0b1c30] leading-5">{task.title}</span>
          {phaseBadge(task.phase)}
        </div>
        <p className="text-[12px] text-[#94a3b8] mt-0.5 leading-4 line-clamp-2">{task.description}</p>
      </div>
      <span className="shrink-0 text-[11px] text-[#94a3b8] mt-0.5">{task.estimatedHours}h</span>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function CodingStage() {
  const codingStatus  = useCodingStore((s) => s.status);
  const startCoding   = useCodingStore((s) => s.startCoding);

  const kickoffResult  = usePipelineStore((s) => s.steps.kickoff);
  const codeOutputDir  = usePipelineStore((s) => s.codeOutputDir);
  const prdContent     = usePipelineStore((s) => s.steps.prd?.content);
  const intentStep     = usePipelineStore((s) => s.steps.intent);

  const tasks = useMemo(
    () => parseKickoffTaskBreakdownFromMetadata(
      kickoffResult?.metadata as Record<string, unknown> | undefined
    ),
    [kickoffResult],
  );

  const runId = typeof kickoffResult?.metadata?.runId === "string"
    ? kickoffResult.metadata.runId
    : `coding-${Date.now()}`;

  const projectTier = (
    intentStep?.metadata as { classification?: { tier?: string } } | undefined
  )?.classification?.tier;

  const kickoffReady = kickoffResult?.status === "completed" && tasks.length > 0;

  // ── Running / completed / failed → delegate to CodingAgentGraph ────────────
  if (codingStatus !== "idle") {
    return (
      <div className="flex flex-1 overflow-hidden">
        <CodingAgentGraph />
      </div>
    );
  }

  // ── Idle: kickoff not ready ──────────────────────────────────────────────
  if (!kickoffReady) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-4 text-center max-w-sm"
        >
          <div className="w-12 h-12 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center">
            <Clock size={18} className="text-[#cbd5e1]" />
          </div>
          <p className="text-[14px] text-[#94a3b8] leading-6">
            Complete the Kick-off stage first to generate the task breakdown before starting coding.
          </p>
        </motion.div>
      </div>
    );
  }

  // ── Idle: kickoff done, tasks ready ─────────────────────────────────────
  const totalHours = tasks.reduce((s, t) => s + t.estimatedHours, 0);
  const phases = [...new Set(tasks.map((t) => t.phase.toLowerCase()))];

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden bg-white">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-5 border-b border-[#f1f5f9]">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-[#0b1c30]">Ready to Code</h2>
              <p className="text-[13px] text-[#94a3b8] mt-0.5">
                {tasks.length} tasks · ~{totalHours}h estimated · {phases.join(", ")}
              </p>
            </div>
            <Badge variant="success" className="rounded text-[11px] font-bold shrink-0">
              Kick-off complete
            </Badge>
          </div>
        </motion.div>
      </div>

      {/* Task list */}
      <ScrollArea className="flex-1 px-8 py-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </motion.div>
      </ScrollArea>

      {/* Start coding footer */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="shrink-0 flex items-center justify-between gap-4 px-8 py-4 border-t border-[#f1f5f9]"
      >
        <div className="flex items-center gap-1.5 text-[12px] text-[#94a3b8]">
          <AlertCircle size={13} className="text-[#cbd5e1]" />
          Agents will run in parallel once coding starts.
        </div>
        <Button
          onClick={() => startCoding(runId, tasks, codeOutputDir, projectTier, prdContent)}
          className="bg-[#712ae2] hover:bg-[#5f24c2] font-bold px-6 gap-2"
        >
          <Play size={14} />
          Start Coding
        </Button>
      </motion.div>
    </div>
  );
}
