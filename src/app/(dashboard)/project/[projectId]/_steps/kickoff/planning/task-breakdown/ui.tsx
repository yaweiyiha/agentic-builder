"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Download, ExternalLink, ListChecks, Zap, User } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { getNextStep, getPrevStep } from "@/_config/pipeline-flow";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import type { StepUIProps } from "../../../_shared/types";

const PHASE_COLORS: Record<string, string> = {
  backend: "bg-blue-50 text-blue-700",
  frontend: "bg-indigo-50 text-indigo-700",
  infra: "bg-slate-100 text-slate-600",
  data: "bg-emerald-50 text-emerald-700",
  integration: "bg-violet-50 text-violet-700",
  design: "bg-pink-50 text-pink-700",
};

function phaseColor(phase: string): string {
  const key = phase.toLowerCase();
  for (const [k, v] of Object.entries(PHASE_COLORS)) {
    if (key.includes(k)) return v;
  }
  return "bg-slate-100 text-slate-600";
}

const PRIORITY_STYLE: Record<string, string> = {
  P0: "bg-red-50 text-red-700 border border-red-200",
  P1: "bg-amber-50 text-amber-700 border border-amber-200",
  P2: "bg-sky-50 text-sky-700 border border-sky-200",
  critical: "bg-red-50 text-red-700 border border-red-200",
  high: "bg-amber-50 text-amber-700 border border-amber-200",
  medium: "bg-sky-50 text-sky-700 border border-sky-200",
  low: "bg-slate-50 text-slate-500 border border-slate-200",
};

function priorityStyle(p?: string): string {
  if (!p) return "bg-slate-50 text-slate-500 border border-slate-200";
  return PRIORITY_STYLE[p] ?? PRIORITY_STYLE[p.toLowerCase()] ?? "bg-slate-50 text-slate-500 border border-slate-200";
}

function priorityLabel(p?: string): string {
  if (!p) return "—";
  const map: Record<string, string> = { P0: "CRITICAL", P1: "HIGH", P2: "MEDIUM", critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW" };
  return map[p] ?? p.toUpperCase();
}

export function TaskBreakdownUI({ onNavigate }: StepUIProps) {
  const summaryResult = useStepStore((s) => s.steps.summary);
  const taskBreakdownResult = useStepStore((s) => s.steps["task-breakdown"]);
  const tier = useStepStore((s) => s.tier);
  const nextStep = getNextStep("task-breakdown", tier);
  const prevStep = getPrevStep("task-breakdown", tier);

  console.log("[TaskBreakdownUI] summaryResult:", summaryResult, "taskBreakdownResult:", taskBreakdownResult);

  const metadata = taskBreakdownResult?.metadata ?? summaryResult?.metadata;
  console.log("[TaskBreakdownUI] metadata:", metadata, "taskBreakdown from metadata:", metadata?.taskBreakdown);
  const tasks = parseKickoffTaskBreakdownFromMetadata(metadata);
  const isCompleted = summaryResult?.status === "completed";
  const pendingCount = tasks.filter((t) => t.executionKind === "ai_autonomous").length;

  const artifacts = [
    { name: "PRD.md", lines: 412, type: "doc" },
    { name: "Architecture.pdf", lines: 38, type: "pdf" },
  ];

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden bg-[#f8fafc]">
      {/* Header */}
      <div className="shrink-0 px-8 pt-6 pb-4 bg-white border-b border-[#f1f5f9]">
        <h2 className="text-xl font-bold text-[#0b1c30]">Pre-flight Checklist</h2>
        <p className="text-[13px] text-[#94a3b8] mt-0.5">
          Review all tasks and artifacts before starting the coding run
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {/* PROJECT TASKS */}
        <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f1f5f9] flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">Project Tasks</p>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#f1f5f9] text-[#64748b]">
              {pendingCount} PENDING STEPS
            </span>
          </div>

          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-slate-400">
              <ListChecks size={28} className="text-slate-300" />
              <p className="text-[13px]">
                {isCompleted ? "No tasks found in metadata." : "Run the kick-off in the Summary step first."}
              </p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#f1f5f9]">
                  {["TASK NAME", "PHASE", "ESTIMATE", "PRIORITY", "STATUS"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-[10px] font-bold tracking-widest text-[#94a3b8] uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, i) => (
                  <tr key={task.id ?? i} className="border-b border-[#f8fafc] hover:bg-[#fafbfc] transition-colors last:border-0">
                    <td className="px-4 py-3 max-w-70">
                      <p className="text-[13px] font-semibold text-[#1e293b] truncate">{task.title}</p>
                      {task.description && (
                        <p className="text-[11px] text-[#94a3b8] mt-0.5 line-clamp-1">{task.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${phaseColor(task.phase)}`}>
                        {task.phase}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[13px] font-medium text-[#475569]">
                      {task.estimatedHours}h
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${priorityStyle(task.priority)}`}>
                        {priorityLabel(task.priority)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {task.executionKind === "ai_autonomous" ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-violet-600">
                          <Zap size={12} /> AI Auto
                        </span>
                      ) : task.executionKind === "human_confirm_after" ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
                          <User size={12} /> Review
                        </span>
                      ) : (
                        <CheckCircle2 size={16} className="text-emerald-500" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* GENERATED ARTIFACTS */}
        <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f1f5f9]">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">Generated Artifacts</p>
          </div>
          <div className="px-5 py-4 grid grid-cols-2 gap-3">
            {artifacts.map((a) => (
              <div key={a.name} className="flex items-center justify-between p-3 rounded-lg border border-[#f1f5f9] bg-[#f8fafc]">
                <div>
                  <p className="text-[13px] font-semibold text-[#334155]">{a.name}</p>
                  <p className="text-[11px] text-[#94a3b8] mt-0.5">{a.lines} {a.type === "pdf" ? "pages" : "lines"}</p>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors text-[#94a3b8] hover:text-[#334155]">
                  <Download size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom row: Abilities + Project Links */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-[#f1f5f9] flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">Abilities</p>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">1 Configured</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#334155] uppercase tracking-wide">Vercel Integration</p>
                  <p className="text-[11px] text-[#94a3b8] mt-0.5">Deployment · API key configured</p>
                </div>
                <button className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded border border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc] transition-colors">
                  MANAGE
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-[#f1f5f9]">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">Project Links</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <a href="#" className="flex items-center gap-2.5 text-[13px] font-medium text-[#334155] hover:text-[#712ae2] transition-colors">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                GitHub Repository
              </a>
              <a href="#" className="flex items-center gap-2.5 text-[13px] font-medium text-[#334155] hover:text-[#712ae2] transition-colors">
                <ExternalLink size={15} className="shrink-0" /> Jira Board
              </a>
            </div>
          </div>
        </div>
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