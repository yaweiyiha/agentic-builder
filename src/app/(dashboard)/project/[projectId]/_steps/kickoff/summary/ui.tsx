"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, ChevronLeft, ChevronRight, ExternalLink, Zap, User } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { getNextStep } from "@/_config/pipeline-flow";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import type { StepUIProps } from "../../_shared/types";

const PAGE_SIZE = 8;

const PHASE_COLORS: Record<string, string> = {
  data:           "bg-blue-100 text-blue-700",
  integration:    "bg-purple-100 text-purple-700",
  backend:        "bg-orange-100 text-orange-700",
  infra:          "bg-green-100 text-green-700",
  infrastructure: "bg-green-100 text-green-700",
  frontend:       "bg-sky-100 text-sky-700",
  security:       "bg-red-100 text-red-700",
  optimization:   "bg-amber-100 text-amber-700",
};

function phaseColor(phase: string) {
  const key = phase.toLowerCase().split(" ")[0];
  return PHASE_COLORS[key] ?? "bg-slate-100 text-slate-600";
}

export function SummaryUI({ onNavigate }: StepUIProps) {
  const featureBrief = useStepStore((s) => s.featureBrief);
  const codeOutputDir = useStepStore((s) => s.codeOutputDir);
  const steps = useStepStore((s) => s.steps);
  const setStepResult = useStepStore((s) => s.setStepResult);
  const isRunning = useStepStore((s) => s.isRunning);
  const currentStep = useStepStore((s) => s.currentStep);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const tier = useStepStore((s) => s.tier);
  const nextStep = getNextStep("summary", tier);

  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const summaryResult = steps.summary;
  const isThisRunning = isRunning && currentStep === "summary";
  const isCompleted = summaryResult?.status === "completed";
  const metadata = summaryResult?.metadata;
  const tasks = parseKickoffTaskBreakdownFromMetadata(metadata);

  const totalHours = tasks.reduce((s, t) => s + t.estimatedHours, 0);
  const aiTasks = tasks.filter((t) => t.executionKind === "ai_autonomous");
  const humanTasks = tasks.filter((t) => t.executionKind === "human_confirm_after");
  const aiHours = aiTasks.reduce((s, t) => s + t.estimatedHours, 0);
  const humanHours = humanTasks.reduce((s, t) => s + t.estimatedHours, 0);
  const efficiencyPct = tasks.length > 0 ? Math.round((aiTasks.length / tasks.length) * 100) : 0;
  const estimatedCost = (totalHours * 8.5).toFixed(0);

  const totalPages = Math.ceil(tasks.length / PAGE_SIZE);
  const pageTasks = tasks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Auto-trigger
  const triggeredRef = useRef(false);
  useEffect(() => {
    if (triggeredRef.current) return;
    if (isCompleted || isRunning) return;
    triggeredRef.current = true;
    void runKickoff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runKickoff = async () => {
    setError(null);
    useStepStore.setState((s) => ({
      isRunning: true,
      currentStep: "summary",
      error: null,
      streamingContent: "",
      streamingThinking: "",
      steps: {
        ...s.steps,
        summary: { stepId: "summary", status: "running", timestamp: new Date().toISOString() },
      },
    }));
    try {
      const resp = await fetch("/api/agents/kickoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureBrief,
          codeOutputDir,
          prd: steps.prd?.content ?? "",
          trd: steps.trd?.content ?? "",
          sysdesign: steps.sysdesign?.content ?? "",
          implguide: steps.implguide?.content ?? "",
          design: steps.design?.content ?? "",
          pencil: steps.pencil?.content ?? "",
          qa: steps.qa?.content ?? "",
          sessionId: useStepStore.getState().kickoffSessionId ?? "",
        }),
      });
      if (!resp.ok) throw new Error("Kickoff request failed");
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      let kickoffContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "step_stream") {
              const chunk = event.data?.chunk ?? event.chunk ?? "";
              kickoffContent += chunk;
              useStepStore.setState((s) => ({ streamingContent: s.streamingContent + chunk }));
            } else if (event.type === "step_complete") {
              kickoffContent = event.data?.content ?? kickoffContent;
            } else if (event.type === "done") {
              const kickoffMeta = event.run?.steps?.kickoff;
              const costUsd = kickoffMeta?.costUsd ?? 0;
              const durationMs = kickoffMeta?.durationMs ?? 0;
              const kickoffMetadata = kickoffMeta?.metadata ?? {};
              const now = new Date().toISOString();
              setStepResult("summary", { stepId: "summary", status: "completed", content: kickoffContent, costUsd, durationMs, metadata: kickoffMetadata, timestamp: now });
              setStepResult("task-breakdown", { stepId: "task-breakdown", status: "completed", content: kickoffContent, costUsd: 0, durationMs: 0, metadata: kickoffMetadata, timestamp: now });
              useStepStore.setState({ isRunning: false, currentStep: null, streamingContent: "" });
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Kickoff failed";
      setError(msg);
      useStepStore.setState({ isRunning: false, currentStep: null, streamingContent: "" });
    }
  };

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto bg-[#f8f9ff]">
        <div className="max-w-5xl mx-auto px-8 py-7 space-y-5">

          {/* ── Header ── */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-[#0b1c30] leading-tight">Sprint Kick-off Summary</h1>
              <p className="text-[13px] text-[#94a3b8] mt-0.5">AI-generated task plan based on your PRD, TRD and Design Spec</p>
            </div>
            {isCompleted && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            )}
          </div>

          {/* ── Generating banner ── */}
          {isThisRunning && (
            <div className="rounded-xl border border-violet-200 bg-white px-5 py-4 flex items-center gap-3 shadow-sm">
              <Loader2 size={15} className="text-[#712ae2] animate-spin shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-violet-900">Generating Kick-off Plan…</p>
                {streamingContent && <p className="text-[11px] text-violet-500 mt-0.5 line-clamp-1">{streamingContent.slice(-120)}</p>}
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {error && !isThisRunning && (
            <div className="rounded-xl border border-red-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-[13px] font-semibold text-red-700">Kick-off failed</p>
              <p className="text-[12px] text-red-500 mt-1">{error}</p>
              <button onClick={() => { triggeredRef.current = false; void runKickoff(); }}
                className="mt-3 px-4 py-1.5 text-[12px] font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">
                Retry
              </button>
            </div>
          )}

          {/* ── Stats bar ── */}
          {isCompleted && tasks.length > 0 && (
            <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[#f1f5f9]">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">Project Stats</p>
              </div>
              <div className="grid grid-cols-6 divide-x divide-[#f1f5f9]">
                {[
                  { label: "TOTAL TASKS", value: String(tasks.length) },
                  { label: "AI ESTIMATE", value: `${aiHours}h` },
                  { label: "HUMAN ESTIMATE", value: `${humanHours}h` },
                  { label: "TOTAL HOURS", value: `${totalHours}h` },
                  { label: "EFFICIENCY", value: `${efficiencyPct}%`, highlight: true },
                  { label: "EST. COST", value: `$${estimatedCost}` },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="px-4 py-3 text-center">
                    <p className={`text-[17px] font-bold ${highlight ? "text-[#712ae2]" : "text-[#0b1c30]"}`}>{value}</p>
                    <p className="text-[10px] text-[#94a3b8] mt-0.5 font-medium">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Project Tasks table ── */}
          {isCompleted && tasks.length > 0 && (
            <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#f1f5f9] flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">Project Tasks</p>
                <span className="text-[11px] text-[#94a3b8]">Showing {Math.min((page + 1) * PAGE_SIZE, tasks.length)} of {tasks.length} tasks</span>
              </div>
              {/* Column headers */}
              <div className="grid grid-cols-[2fr_1fr_80px_72px_96px] gap-4 px-5 py-2.5 bg-[#fafbfc] border-b border-[#f1f5f9]">
                {["TASK DESCRIPTION", "PHASE", "AI EST.", "PRIORITY", "TYPE"].map((h) => (
                  <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">{h}</span>
                ))}
              </div>
              {/* Rows */}
              {pageTasks.map((task, i) => (
                <div key={task.id} className={`grid grid-cols-[2fr_1fr_80px_72px_96px] gap-4 items-center px-5 py-3.5 ${i < pageTasks.length - 1 ? "border-b border-[#f8fafc]" : ""} hover:bg-[#fafbff] transition-colors`}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#1e293b] truncate">{task.title}</p>
                    <p className="text-[11px] text-[#94a3b8] truncate mt-0.5">{task.description}</p>
                  </div>
                  <div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${phaseColor(task.phase)}`}>
                      {task.phase}
                    </span>
                  </div>
                  <div className="text-[13px] font-medium text-[#334155]">{task.estimatedHours}h</div>
                  <div>
                    {task.priority ? (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        task.priority === "P0" ? "bg-red-100 text-red-700" :
                        task.priority === "P1" ? "bg-orange-100 text-orange-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>{task.priority}</span>
                    ) : <span className="text-[11px] text-slate-300">—</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {task.executionKind === "ai_autonomous" ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                        <Zap size={10} className="shrink-0" /> Autonomous
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                        <User size={10} className="shrink-0" /> Manual Review
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#f1f5f9] bg-[#fafbfc]">
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                    className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft size={13} /> Previous
                  </button>
                  <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    Next <ChevronRight size={13} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Bottom row: Abilities + Project Links ── */}
          {isCompleted && (
            <div className="grid grid-cols-2 gap-4">
              {/* Abilities */}
              <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-[#f1f5f9] flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">Abilities</p>
                  <span className="text-[10px] font-bold text-[#712ae2] bg-violet-50 px-2 py-0.5 rounded-full">1 Configured</span>
                </div>
                <div className="px-5 py-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 76 65" fill="white"><path d="M37.532 16.87a9.963 9.963 0 00-7.07 2.928 9.963 9.963 0 00-2.93 7.065 9.963 9.963 0 002.93 7.066 9.963 9.963 0 007.07 2.929 9.963 9.963 0 007.071-2.929 9.963 9.963 0 002.929-7.066 9.963 9.963 0 00-2.929-7.065 9.963 9.963 0 00-7.071-2.928zm0 2.886a7.077 7.077 0 015.009 2.08 7.077 7.077 0 012.08 5.027 7.077 7.077 0 01-2.08 5.026 7.077 7.077 0 01-5.009 2.082 7.077 7.077 0 01-5.008-2.082 7.077 7.077 0 01-2.082-5.026 7.077 7.077 0 012.082-5.027 7.077 7.077 0 015.008-2.08z"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#1e293b]">Deployment</p>
                    <p className="text-[11px] text-[#94a3b8]">Vercel Integration</p>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#712ae2" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>

              {/* Project Links */}
              <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-[#f1f5f9]">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">Project Links</p>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <a href="#" className="flex items-center gap-2.5 text-[13px] font-medium text-[#334155] hover:text-[#712ae2] transition-colors">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-[#334155]"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg> GitHub Repository
                  </a>
                  <a href="#" className="flex items-center gap-2.5 text-[13px] font-medium text-[#334155] hover:text-[#712ae2] transition-colors">
                    <ExternalLink size={15} className="shrink-0 text-[#334155]" /> Jira Board
                  </a>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Bottom nav */}
      <div className="shrink-0 border-t border-[#e2e8f0] bg-white px-8 py-3 flex items-center justify-end">
        <button
          onClick={() => nextStep && onNavigate(nextStep)}
          disabled={!isCompleted}
          className="flex items-center gap-2 px-6 py-2.5 bg-[#712ae2] text-white text-[13px] font-semibold rounded-lg hover:bg-[#6b24da] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Task Breakdown <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
