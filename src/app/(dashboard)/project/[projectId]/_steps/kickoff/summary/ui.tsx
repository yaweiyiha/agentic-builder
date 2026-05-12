"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ResourceRequirementsPanel from "@/components/ResourceRequirementsPanel";
import type { StepUIProps } from "../../_shared/types";

export function SummaryUI({ onNavigate }: StepUIProps) {
  const featureBrief = useStepStore((s) => s.featureBrief);
  const codeOutputDir = useStepStore((s) => s.codeOutputDir);
  const steps = useStepStore((s) => s.steps);
  const setStepResult = useStepStore((s) => s.setStepResult);
  const isRunning = useStepStore((s) => s.isRunning);
  const currentStep = useStepStore((s) => s.currentStep);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("summary", tier);

  const [error, setError] = useState<string | null>(null);

  const summaryResult = steps.summary;
  const isThisRunning = isRunning && currentStep === "summary";
  const isCompleted = summaryResult?.status === "completed";
  const content = isThisRunning ? streamingContent : (summaryResult?.content ?? "");
  const metadata = summaryResult?.metadata;
  const tasks = parseKickoffTaskBreakdownFromMetadata(metadata);

  const totalHours = tasks.reduce((s, t) => s + t.estimatedHours, 0);
  const phases = Array.from(new Set(tasks.map((t) => t.phase)));
  const aiCount = tasks.filter((t) => t.executionKind === "ai_autonomous").length;

  // Auto-scroll streaming content
  const contentEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isThisRunning) {
      contentEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [streamingContent, isThisRunning]);

  // Auto-trigger kickoff on mount if not yet completed and not already running
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
    // Mark summary as running in step-store so isRunning/currentStep are set
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
              setStepResult("summary", {
                stepId: "summary",
                status: "completed",
                content: kickoffContent,
                costUsd,
                durationMs,
                metadata: kickoffMetadata,
                timestamp: now,
              });
              setStepResult("task-breakdown", {
                stepId: "task-breakdown",
                status: "completed",
                content: kickoffContent,
                costUsd: 0,
                durationMs: 0,
                metadata: kickoffMetadata,
                timestamp: now,
              });
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
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-6 space-y-6">
          {/* Running state */}
          {isThisRunning && (
            <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/60 px-5 py-4">
              <Loader2 size={16} className="text-[#712ae2] animate-spin shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-violet-900">Generating Kick-off Plan…</p>
                <p className="text-[12px] text-violet-600 mt-0.5">
                  Analysing your PRD, design spec, TRD and QA plan to build the task breakdown.
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && !isThisRunning && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
              <p className="text-[13px] font-semibold text-red-700">Kick-off failed</p>
              <p className="text-[12px] text-red-600 mt-1">{error}</p>
              <button
                onClick={() => { triggeredRef.current = false; void runKickoff(); }}
                className="mt-3 px-4 py-1.5 text-[12px] font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Completed banner */}
          {isCompleted && !isThisRunning && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 flex items-start gap-3">
              <CheckCircle2 size={18} className="text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-emerald-900">Kick-off Complete</p>
                <p className="text-[12px] text-emerald-700 mt-0.5">
                  Task plan generated. Review the summary and proceed to the task breakdown.
                </p>
              </div>
            </div>
          )}

          {/* Stats */}
          {isCompleted && tasks.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-center">
                <p className="text-2xl font-bold text-[#0b1c30]">{tasks.length}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Tasks</p>
              </div>
              <div className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-center">
                <p className="text-2xl font-bold text-[#0b1c30]">{totalHours}h</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Est. Hours</p>
              </div>
              <div className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-center">
                <p className="text-2xl font-bold text-violet-600">{aiCount}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">AI Autonomous</p>
              </div>
            </div>
          )}

          {/* Phases */}
          {isCompleted && phases.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {phases.map((phase) => (
                <span
                  key={phase}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#712ae2]" />
                  {phase}
                </span>
              ))}
            </div>
          )}

          {/* Streaming / final content */}
          {content && (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-7 shadow-sm">
              {isThisRunning && (
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#712ae2] animate-pulse" />
                  <span className="text-[12px] font-semibold text-slate-500">Generating…</span>
                </div>
              )}
              <MarkdownRenderer content={content} />
              <div ref={contentEndRef} />
            </div>
          )}

          {/* Resource requirements (shown after completion) */}
          {isCompleted && (
            <ResourceRequirementsPanel
              prdContent={steps.prd?.content ?? ""}
              trdContent={steps.trd?.content}
              sysdesignContent={steps.sysdesign?.content}
              implguideContent={steps.implguide?.content}
              runId={typeof metadata?.runId === "string" ? metadata.runId : undefined}
            />
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

