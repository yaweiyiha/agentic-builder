"use client";

import type { StepResult } from "@/lib/pipeline/types";

import TaskBreakdownSection from "./TaskBreakdownSection";
import type { KickoffStepData } from "./types";

interface Props {
  result: StepResult;
  data: KickoffStepData;
  /** When true, hide the in-panel "Confirm & Start Coding" button — the
   *  legacy pipeline page exposes start-coding via the bottom command bar. */
  commandBarStartsCoding?: boolean;
}

export default function KickoffTasksView({
  result,
  data,
  commandBarStartsCoding = false,
}: Props) {
  // result is reserved for future per-result UI (e.g. running model badge);
  // currently not consumed but kept in the interface for parity with summary.
  void result;

  const {
    tasks,
    taskBreakdownConfirmed,
    parseFailed,
    parseError,
    rawTaskBreakdownOutput,
    reviewSuggestions,
    selectedSuggestionIds,
    setSelectedSuggestionIds,
    retryingBreakdown,
    retryBreakdownError,
    reviewingBreakdown,
    reviewBreakdownError,
    regeneratingWithSuggestions,
    isRunning,
    currentStep,
    codingStatus,
    matchingFailedIds,
    hasFailedTasks,
    totalHours,
    aiHours,
    humanHours,
    totalTokens,
    totalCost,
    phases,
    priorities,
    handleRetryKickoffBreakdown,
    handleAnalyzeTaskBreakdown,
    handleRegenerateWithSelectedSuggestions,
    handleConfirmTaskBreakdown,
    handleConfirmAndCode,
    handleRetryFailed,
  } = data;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {parseFailed && (
        <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 text-[12px] text-red-900 shadow-sm">
          <p className="text-[13px] font-semibold">JSON parse error</p>
          {parseError && (
            <p className="mt-1">
              <span className="font-medium">Reason:</span>{" "}
              <span className="font-mono">{parseError}</span>
            </p>
          )}
          {rawTaskBreakdownOutput && (
            <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-red-100 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-800 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {rawTaskBreakdownOutput}
            </pre>
          )}
          <div className="mt-3">
            <button
              type="button"
              onClick={handleRetryKickoffBreakdown}
              disabled={
                retryingBreakdown || isRunning || currentStep === "kickoff"
              }
              className="rounded-md bg-zinc-900 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retryingBreakdown
                ? "Retrying task breakdown..."
                : "Retry task breakdown only"}
            </button>
          </div>
          {retryBreakdownError && (
            <p className="mt-2 text-[12px] text-red-700">
              {retryBreakdownError}
            </p>
          )}
        </div>
      )}

      {!parseFailed && tasks.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAnalyzeTaskBreakdown}
              disabled={reviewingBreakdown || regeneratingWithSuggestions || isRunning}
              className="rounded-md border border-zinc-300 bg-zinc-900 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reviewingBreakdown
                ? "Analyzing task breakdown..."
                : "Review with second model"}
            </button>
            <button
              type="button"
              onClick={handleConfirmTaskBreakdown}
              disabled={
                taskBreakdownConfirmed ||
                reviewingBreakdown ||
                regeneratingWithSuggestions
              }
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {taskBreakdownConfirmed
                ? "Task breakdown confirmed"
                : "Confirm task breakdown"}
            </button>
          </div>
          {reviewBreakdownError && (
            <p className="mt-2 text-[12px] text-red-700">{reviewBreakdownError}</p>
          )}

          {reviewSuggestions.length > 0 && (
            <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
              <p className="mb-2 text-[12px] font-semibold text-indigo-900">
                Improvement suggestions ({reviewSuggestions.length})
              </p>
              <div className="space-y-2">
                {reviewSuggestions.map((s) => (
                  <label
                    key={s.id}
                    className="block rounded border border-indigo-100 bg-white px-3 py-2"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedSuggestionIds.includes(s.id)}
                        onChange={(e) => {
                          setSelectedSuggestionIds((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, s.id])]
                              : prev.filter((id) => id !== s.id),
                          );
                        }}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-zinc-900">
                          {s.title}{" "}
                          <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-600">
                            {s.severity}
                          </span>
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-600">{s.reason}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRegenerateWithSelectedSuggestions}
                  disabled={
                    regeneratingWithSuggestions ||
                    reviewingBreakdown ||
                    selectedSuggestionIds.length === 0
                  }
                  className="rounded-md border border-indigo-300 bg-indigo-600 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {regeneratingWithSuggestions
                    ? "Regenerating task breakdown..."
                    : `Regenerate with selected suggestions (${selectedSuggestionIds.length})`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <TaskBreakdownSection
        tasks={tasks}
        totalHours={totalHours}
        aiHours={aiHours}
        humanHours={humanHours}
        totalTokens={totalTokens}
        totalCost={totalCost}
        phases={phases}
        priorities={priorities}
      />

      {tasks.length > 0 && codingStatus === "idle" && commandBarStartsCoding && (
        <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 text-center shadow-sm">
          <p className="text-[13px] font-semibold text-zinc-900">
            Start coding agents
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600">
            {taskBreakdownConfirmed
              ? "Press Start coding in the command bar to start the session."
              : "Confirm task breakdown first, then press Start coding in the command bar."}{" "}
            ({tasks.length} tasks).
          </p>
        </div>
      )}

      {tasks.length > 0 && codingStatus === "idle" && !commandBarStartsCoding && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleConfirmAndCode}
            disabled={!taskBreakdownConfirmed}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Confirm &amp; Start Coding ({tasks.length} tasks)
          </button>
          {hasFailedTasks && (
            <button
              type="button"
              onClick={handleRetryFailed}
              className="flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-6 py-3 text-sm font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100"
              title={`Re-run only the ${matchingFailedIds.length} failed task(s) from the last session: ${matchingFailedIds.join(", ")}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
              </svg>
              Retry Failed Tasks ({matchingFailedIds.length})
            </button>
          )}
        </div>
      )}

      {codingStatus !== "idle" && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-4 text-center text-[13px] text-indigo-900 shadow-sm">
          Coding session is {codingStatus}. Switch to the Coding tab to see
          agent progress.
        </div>
      )}
    </div>
  );
}
