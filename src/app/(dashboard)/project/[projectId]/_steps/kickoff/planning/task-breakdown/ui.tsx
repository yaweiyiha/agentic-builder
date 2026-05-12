"use client";

import { ArrowLeft, ArrowRight, Clock, ListChecks, Zap, User } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep, getPrevStep } from "@/_config/pipeline-flow";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import type { StepUIProps } from "../../../_shared/types";

export function TaskBreakdownUI({ onNavigate }: StepUIProps) {
  // Read metadata from the summary step (which runs the kickoff and stores results)
  const summaryResult = useStepStore((s) => s.steps.summary);
  const taskBreakdownResult = useStepStore((s) => s.steps["task-breakdown"]);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("task-breakdown", tier);
  const prevStep = getPrevStep("task-breakdown", tier);

  const metadata = taskBreakdownResult?.metadata ?? summaryResult?.metadata;
  const tasks = parseKickoffTaskBreakdownFromMetadata(metadata);

  // Fallback: try to parse content as JSON if no metadata tasks
  const fallbackTasks: Array<{ title: string; phase: string; estimatedHours: number }> =
    tasks.length === 0 ? (() => {
      try {
        const parsed = JSON.parse(summaryResult?.content ?? "");
        return parsed.tasks ?? parsed.workItems ?? [];
      } catch { return []; }
    })() : [];

  const isCompleted = summaryResult?.status === "completed";

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-6 pb-4 border-b border-[#f1f5f9]">
        <h2 className="text-xl font-bold text-[#0b1c30]">Task Breakdown</h2>
        <p className="text-[13px] text-[#94a3b8] mt-0.5">
          Review the AI-generated coding tasks before starting
        </p>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-8 py-5 space-y-3">
        {tasks.length === 0 && fallbackTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-slate-400">
            <ListChecks size={24} className="text-slate-300" />
            <p className="text-sm">
              {isCompleted
                ? "Task breakdown loaded. Proceed to start coding."
                : "Run the kick-off in the Summary step first."}
            </p>
          </div>
        )}

        {/* Full structured tasks */}
        {tasks.map((task, i) => (
          <div key={task.id} className="rounded-xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="text-[11px] font-bold text-slate-400 mt-0.5 w-5 shrink-0">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold text-[#334155]">{task.title}</p>
                  {task.priority && (
                    <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      task.priority === "P0" ? "bg-red-100 text-red-700" :
                      task.priority === "P1" ? "bg-amber-100 text-amber-700" :
                      "bg-slate-100 text-slate-600"
                    }`}>{task.priority}</span>
                  )}
                </div>
                <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">{task.description}</p>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock size={11} />{task.estimatedHours}h
                  </span>
                  <span className="text-[11px] text-slate-400">{task.phase}</span>
                  <span className={`flex items-center gap-1 text-[11px] ${
                    task.executionKind === "ai_autonomous" ? "text-violet-600" : "text-amber-600"
                  }`}>
                    {task.executionKind === "ai_autonomous"
                      ? <><Zap size={11} /> AI</>
                      : <><User size={11} /> Human review</>
                    }
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Fallback simple tasks */}
        {tasks.length === 0 && fallbackTasks.map((task, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[#f8fafc] border border-[#f1f5f9]">
            <span className="text-[10px] font-bold text-slate-400 mt-0.5 w-5 shrink-0">{i + 1}.</span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[#334155]">{task.title}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[11px] text-slate-400">{task.phase}</span>
                <span className="text-[11px] text-slate-400">{task.estimatedHours}h estimated</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom navigation */}
      <div className="shrink-0 border-t border-[#e2e8f0] bg-white px-8 py-3 flex items-center justify-between">
        <button
          onClick={() => prevStep && onNavigate(prevStep)}
          className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft size={14} /> Previous
        </button>
        <button
          onClick={() => nextStep && onNavigate(nextStep)}
          disabled={!isCompleted}
          className="flex items-center gap-2 px-6 py-2.5 bg-[#712ae2] text-white text-[13px] font-semibold rounded-lg hover:bg-[#6b24da] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Confirm &amp; Start Coding <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
