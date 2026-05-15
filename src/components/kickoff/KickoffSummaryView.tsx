"use client";

import MarkdownRenderer from "@/components/MarkdownRenderer";
import ResourceRequirementsPanel from "@/components/ResourceRequirementsPanel";
import { usePipelineStore } from "@/store/pipeline-store";
import type { StepResult } from "@/lib/pipeline/types";

import PushGeneratedCodeSection from "./PushGeneratedCodeSection";
import type { KickoffStepData } from "./types";

interface Props {
  result: StepResult;
  data: KickoffStepData;
  /** When true, skip the in-panel "Start coding agents" hint (the legacy
   *  pipeline page had a command-bar that already prompted for it). */
  commandBarStartsCoding?: boolean;
}

export default function KickoffSummaryView({
  result,
  data,
  commandBarStartsCoding = false,
}: Props) {
  const steps = usePipelineStore((s) => s.steps);
  const {
    tasks,
    parseFailed,
    parseError,
    retryingBreakdown,
    retryBreakdownError,
    handleRetryKickoffBreakdown,
    isRunning,
    currentStep,
    codingStatus,
    codeOutputDir,
  } = data;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {/* ─── AI-generated header ─── */}
      <div className="overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50/90 via-white to-zinc-50/40 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-100/90 px-5 py-3">
          <span className="rounded-md bg-amber-200/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-950">
            AI-generated
          </span>
          {result.model && (
            <span className="text-[12px] text-zinc-600">
              Model{" "}
              <span className="font-mono font-semibold text-zinc-900">
                {result.model}
              </span>
            </span>
          )}
          {result.metadata?.taskBreakdownSimulated === true && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              Simulated breakdown
            </span>
          )}
          {result.metadata?.taskBreakdownSimulated === false &&
            tasks.length > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
                From parallel documents
              </span>
            )}
        </div>
        <p className="px-5 py-3 text-[13px] leading-relaxed text-zinc-600">
          Review the kick-off summary and task breakdown. When ready, use{" "}
          <span className="font-semibold text-zinc-800">Start coding</span> in
          the command bar to run agents against this plan.
        </p>
      </div>

      {/* ─── Parse-failed banner (shared with tasks view) ─── */}
      {parseFailed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-[13px] text-amber-900 shadow-sm">
          <p className="font-semibold">
            Task breakdown parse failed (LLM output was not valid JSON).
          </p>
          {parseError && (
            <p className="mt-1 text-[12px] text-amber-800">
              Parse error: <span className="font-mono">{parseError}</span>
            </p>
          )}
          <div className="mt-3">
            <button
              type="button"
              onClick={handleRetryKickoffBreakdown}
              disabled={retryingBreakdown || isRunning || currentStep === "kickoff"}
              className="rounded-md bg-amber-600 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retryingBreakdown
                ? "Retrying task breakdown..."
                : "Retry task breakdown only"}
            </button>
          </div>
          {retryBreakdownError && (
            <p className="mt-2 text-[12px] text-red-700">{retryBreakdownError}</p>
          )}
        </div>
      )}

      {/* ─── Markdown brief ─── */}
      {result.content && (
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)] [&_.prose]:max-w-none">
          <MarkdownRenderer content={result.content} />
        </div>
      )}

      {/* ─── Start coding hint card ─── */}
      {tasks.length > 0 &&
        codingStatus === "idle" &&
        commandBarStartsCoding && (
          <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-[13px] font-semibold text-zinc-900">
              Start coding agents
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600">
              Open the{" "}
              <span className="font-semibold text-zinc-800">
                Task breakdown
              </span>{" "}
              tab to review tasks, or type{" "}
              <span className="rounded bg-zinc-100 px-1.5 font-mono font-semibold text-zinc-900">
                continue
              </span>{" "}
              in the command bar ({tasks.length} tasks).
            </p>
          </div>
        )}

      {/* ─── Resource requirements (API keys etc.) ─── */}
      <ResourceRequirementsPanel
        prdContent={steps.prd?.content ?? ""}
        trdContent={steps.trd?.content}
        sysdesignContent={steps.sysdesign?.content}
        implguideContent={steps.implguide?.content}
        runId={
          typeof result.metadata?.runId === "string"
            ? result.metadata.runId
            : undefined
        }
      />

      {/* ─── Push generated code to GitHub ─── */}
      <PushGeneratedCodeSection codeOutputDir={codeOutputDir} />
    </div>
  );
}
