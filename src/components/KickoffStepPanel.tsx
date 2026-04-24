"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ResourceRequirementsPanel from "@/components/ResourceRequirementsPanel";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import { useCodingStore } from "@/store/coding-store";
import { usePipelineStore } from "@/store/pipeline-store";
import type { KickoffWorkItem, StepResult } from "@/lib/pipeline/types";

type KickoffSubTab = "summary" | "tasks";

type TaskBreakdownReviewSuggestion = {
  id: string;
  title: string;
  reason: string;
  instruction: string;
  severity: "high" | "medium" | "low";
};

export default function KickoffStepPanel({
  result,
  onStartCoding,
  commandBarStartsCoding = false,
}: {
  result: StepResult;
  onStartCoding?: () => void;
  /** When true, hide the in-panel start button; user confirms via the command bar. */
  commandBarStartsCoding?: boolean;
}) {
  const [subTab, setSubTab] = useState<KickoffSubTab>("summary");
  const tasks = parseKickoffTaskBreakdownFromMetadata(result.metadata);
  const codingStatus = useCodingStore((s) => s.status);
  const startCoding = useCodingStore((s) => s.startCoding);
  const codeOutputDir = usePipelineStore((s) => s.codeOutputDir);
  const steps = usePipelineStore((s) => s.steps);
  const updateSteps = usePipelineStore((s) => s.updateSteps);
  const isRunning = usePipelineStore((s) => s.isRunning);
  const currentStep = usePipelineStore((s) => s.currentStep);
  const parseFailed = result.metadata?.taskBreakdownParseFailed === true;
  const parseError =
    typeof result.metadata?.taskBreakdownParseError === "string"
      ? result.metadata.taskBreakdownParseError
      : "";
  const rawTaskBreakdownOutput =
    typeof result.metadata?.taskBreakdownRawOutput === "string"
      ? result.metadata.taskBreakdownRawOutput
      : "";
  const [retryingBreakdown, setRetryingBreakdown] = useState(false);
  const [retryBreakdownError, setRetryBreakdownError] = useState<string | null>(
    null,
  );
  const [reviewingBreakdown, setReviewingBreakdown] = useState(false);
  const [reviewBreakdownError, setReviewBreakdownError] = useState<string | null>(
    null,
  );
  const [regeneratingWithSuggestions, setRegeneratingWithSuggestions] =
    useState(false);

  const kickoffMetadata = (result.metadata ?? {}) as Record<string, unknown>;
  const reviewSuggestions = Array.isArray(kickoffMetadata.taskBreakdownReviewSuggestions)
    ? (kickoffMetadata.taskBreakdownReviewSuggestions as TaskBreakdownReviewSuggestion[])
    : [];
  const taskBreakdownConfirmed = kickoffMetadata.taskBreakdownConfirmed === true;

  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>(
    [],
  );

  useEffect(() => {
    const defaultSelected = reviewSuggestions.map((s) => s.id);
    setSelectedSuggestionIds(defaultSelected);
  }, [result.timestamp, reviewSuggestions.length]);

  const handleConfirmAndCode = () => {
    if (!taskBreakdownConfirmed) return;
    const runId =
      typeof result.metadata?.runId === "string"
        ? result.metadata.runId
        : "run-" + Date.now();
    startCoding(runId, tasks, codeOutputDir, undefined, steps.prd?.content);
    onStartCoding?.();
  };

  const totalHours = tasks.reduce((s, t) => s + t.estimatedHours, 0);
  const aiHours = tasks
    .filter((t) => t.executionKind === "ai_autonomous")
    .reduce((s, t) => s + t.estimatedHours, 0);
  const humanHours = tasks
    .filter((t) => t.executionKind === "human_confirm_after")
    .reduce((s, t) => s + t.estimatedHours, 0);

  const totalTokens = tasks.reduce(
    (s, t) => s + (t.tokenEstimate?.totalTokens ?? 0),
    0,
  );
  const totalCost = tasks.reduce(
    (s, t) => s + (t.tokenEstimate?.estimatedCostUsd ?? 0),
    0,
  );

  const phases = Array.from(new Set(tasks.map((t) => t.phase)));
  const priorities = { P0: 0, P1: 0, P2: 0 };
  tasks.forEach((t) => {
    const p = t.priority ?? "P1";
    if (p in priorities) priorities[p as keyof typeof priorities]++;
  });

  const handleRetryKickoffBreakdown = async () => {
    const ok = window.confirm(
      "Retry task breakdown now? This re-runs only the task breakdown step using existing preparation context.",
    );
    if (!ok) return;
    setRetryBreakdownError(null);
    setRetryingBreakdown(true);
    try {
      const tierRaw = (steps.intent?.metadata as Record<string, unknown> | undefined)
        ?.classification as { tier?: string } | undefined;
      const resp = await fetch("/api/agents/task-breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prd: steps.prd?.content ?? "",
          trd: steps.trd?.content ?? "",
          sysdesign: steps.sysdesign?.content ?? "",
          implguide: steps.implguide?.content ?? "",
          design: steps.design?.content ?? "",
          prdSpec: steps.prd?.metadata?.prdSpec,
          sessionId:
            typeof result.metadata?.runId === "string"
              ? result.metadata.runId
              : undefined,
          tier: tierRaw?.tier ?? "M",
        }),
      });
      const data = (await resp.json()) as {
        error?: string;
        taskBreakdown?: KickoffWorkItem[];
        taskBreakdownParseFailed?: boolean;
        taskBreakdownParseError?: string;
        taskBreakdownRawOutput?: string;
        model?: string;
      };
      if (!resp.ok) {
        throw new Error(data.error || "Task breakdown retry failed");
      }

      const retryTime = new Date().toISOString();
      const nextMetadata = {
        ...(result.metadata ?? {}),
        taskBreakdown: data.taskBreakdown ?? [],
        taskBreakdownSimulated: false,
        taskBreakdownConfirmed: false,
        taskBreakdownReviewSuggestions: [],
        taskBreakdownParseFailed: data.taskBreakdownParseFailed === true,
        ...(data.taskBreakdownParseError
          ? { taskBreakdownParseError: data.taskBreakdownParseError }
          : {}),
        ...(data.taskBreakdownRawOutput
          ? { taskBreakdownRawOutput: data.taskBreakdownRawOutput }
          : {}),
        taskBreakdownRetryAt: retryTime,
        taskBreakdownRetryModel: data.model ?? "unknown",
      };

      const nextContent = [
        result.content ?? "",
        "",
        "### Task Breakdown Retry",
        "",
        `- Retry at: ${retryTime}`,
        `- Model: \`${data.model ?? "unknown"}\``,
        `- Tasks: **${(data.taskBreakdown ?? []).length}**`,
        `- Parse failed: ${data.taskBreakdownParseFailed === true ? "yes" : "no"}`,
      ].join("\n");

      updateSteps({
        kickoff: {
          ...result,
          stepId: "kickoff",
          status: "completed",
          content: nextContent,
          metadata: nextMetadata,
          timestamp: retryTime,
          costUsd: 0,
          durationMs: result.durationMs,
        },
      });
    } catch (err) {
      setRetryBreakdownError(
        err instanceof Error ? err.message : "Task breakdown retry failed",
      );
    } finally {
      setRetryingBreakdown(false);
    }
  };

  const handleAnalyzeTaskBreakdown = async () => {
    if (tasks.length === 0 || reviewingBreakdown) return;
    setReviewBreakdownError(null);
    setReviewingBreakdown(true);
    try {
      const tierRaw = (steps.intent?.metadata as Record<string, unknown> | undefined)
        ?.classification as { tier?: string } | undefined;
      const resp = await fetch("/api/agents/task-breakdown-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prd: steps.prd?.content ?? "",
          trd: steps.trd?.content ?? "",
          sysdesign: steps.sysdesign?.content ?? "",
          implguide: steps.implguide?.content ?? "",
          design: steps.design?.content ?? "",
          taskBreakdown: tasks,
          tier: tierRaw?.tier ?? "M",
        }),
      });
      const data = (await resp.json()) as {
        error?: string;
        suggestions?: TaskBreakdownReviewSuggestion[];
        model?: string;
      };
      if (!resp.ok) {
        throw new Error(data.error || "Task breakdown review failed");
      }
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      const nextMetadata = {
        ...(result.metadata ?? {}),
        taskBreakdownReviewSuggestions: suggestions,
        taskBreakdownReviewModel: data.model ?? "unknown",
        taskBreakdownReviewAt: new Date().toISOString(),
        taskBreakdownConfirmed: false,
      };
      updateSteps({
        kickoff: {
          ...result,
          stepId: "kickoff",
          status: "completed",
          metadata: nextMetadata,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      setReviewBreakdownError(
        err instanceof Error ? err.message : "Task breakdown review failed",
      );
    } finally {
      setReviewingBreakdown(false);
    }
  };

  const handleRegenerateWithSelectedSuggestions = async () => {
    const selected = reviewSuggestions.filter((s) =>
      selectedSuggestionIds.includes(s.id),
    );
    if (selected.length === 0 || regeneratingWithSuggestions) return;
    setReviewBreakdownError(null);
    setRegeneratingWithSuggestions(true);
    try {
      const tierRaw = (steps.intent?.metadata as Record<string, unknown> | undefined)
        ?.classification as { tier?: string } | undefined;
      const resp = await fetch("/api/agents/task-breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prd: steps.prd?.content ?? "",
          trd: steps.trd?.content ?? "",
          sysdesign: steps.sysdesign?.content ?? "",
          implguide: steps.implguide?.content ?? "",
          design: steps.design?.content ?? "",
          prdSpec: steps.prd?.metadata?.prdSpec,
          sessionId:
            typeof result.metadata?.runId === "string"
              ? result.metadata.runId
              : undefined,
          tier: tierRaw?.tier ?? "M",
          improvementNotes: selected.map((s) => s.instruction),
        }),
      });
      const data = (await resp.json()) as {
        error?: string;
        taskBreakdown?: KickoffWorkItem[];
        taskBreakdownParseFailed?: boolean;
        taskBreakdownParseError?: string;
        taskBreakdownRawOutput?: string;
        model?: string;
      };
      if (!resp.ok) {
        throw new Error(data.error || "Task breakdown regeneration failed");
      }
      const retryTime = new Date().toISOString();
      const nextMetadata = {
        ...(result.metadata ?? {}),
        taskBreakdown: data.taskBreakdown ?? [],
        taskBreakdownSimulated: false,
        taskBreakdownParseFailed: data.taskBreakdownParseFailed === true,
        taskBreakdownConfirmed: false,
        taskBreakdownReviewSuggestions: [],
        taskBreakdownRegeneratedAt: retryTime,
        ...(data.taskBreakdownParseError
          ? { taskBreakdownParseError: data.taskBreakdownParseError }
          : {}),
        ...(data.taskBreakdownRawOutput
          ? { taskBreakdownRawOutput: data.taskBreakdownRawOutput }
          : {}),
      };
      const nextContent = [
        result.content ?? "",
        "",
        "### Task Breakdown Regeneration",
        "",
        `- Regenerated at: ${retryTime}`,
        `- Model: \`${data.model ?? "unknown"}\``,
        `- Selected suggestions: ${selected.length}`,
      ].join("\n");
      updateSteps({
        kickoff: {
          ...result,
          stepId: "kickoff",
          status: "completed",
          content: nextContent,
          metadata: nextMetadata,
          timestamp: retryTime,
        },
      });
    } catch (err) {
      setReviewBreakdownError(
        err instanceof Error ? err.message : "Task breakdown regeneration failed",
      );
    } finally {
      setRegeneratingWithSuggestions(false);
    }
  };

  const handleConfirmTaskBreakdown = () => {
    if (tasks.length === 0) return;
    const nextMetadata = {
      ...(result.metadata ?? {}),
      taskBreakdownConfirmed: true,
      taskBreakdownConfirmedAt: new Date().toISOString(),
    };
    updateSteps({
      kickoff: {
        ...result,
        stepId: "kickoff",
        status: "completed",
        metadata: nextMetadata,
        timestamp: new Date().toISOString(),
      },
    });
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
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
          {result.metadata?.taskBreakdownSimulated === false && tasks.length > 0 && (
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

      <div className="flex h-12 gap-1 border-b border-zinc-200">
        <button
          type="button"
          onClick={() => setSubTab("summary")}
          className={`relative px-4 text-[13px] font-medium transition-colors ${
            subTab === "summary"
              ? "text-zinc-900"
              : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          Summary
          {subTab === "summary" && (
            <motion.span
              layoutId="kickoff-tab-underline"
              className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => setSubTab("tasks")}
          className={`relative px-4 text-[13px] font-medium transition-colors ${
            subTab === "tasks"
              ? "text-zinc-900"
              : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          Task breakdown ({tasks.length})
          {subTab === "tasks" && (
            <motion.span
              layoutId="kickoff-tab-underline"
              className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {subTab === "summary" && result.content && (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            <div className="rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)] [&_.prose]:max-w-none">
              <MarkdownRenderer content={result.content} />
            </div>
            {tasks.length > 0 && codingStatus === "idle" && commandBarStartsCoding && (
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
            <PushGeneratedCodeSection codeOutputDir={codeOutputDir} />
          </motion.div>
        )}

        {subTab === "tasks" && (
          <motion.div
            key="tasks"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
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
                  disabled={taskBreakdownConfirmed || reviewingBreakdown || regeneratingWithSuggestions}
                  className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {taskBreakdownConfirmed ? "Task breakdown confirmed" : "Confirm task breakdown"}
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
            <div className="mt-6 flex items-center justify-center">
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
            </div>
          )}
          {codingStatus !== "idle" && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-4 text-center text-[13px] text-indigo-900 shadow-sm">
              Coding session is {codingStatus}. Switch to the Coding tab to see
              agent progress.
            </div>
          )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function TaskBreakdownSection({
  tasks,
  totalHours,
  aiHours,
  humanHours,
  totalTokens,
  totalCost,
  phases,
  priorities,
}: {
  tasks: KickoffWorkItem[];
  totalHours: number;
  aiHours: number;
  humanHours: number;
  totalTokens: number;
  totalCost: number;
  phases: string[];
  priorities: Record<string, number>;
}) {
  const [phaseFilter, setPhaseFilter] = useState<string>("all");

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-zinc-600">
          No task breakdown available from the latest model response.
        </p>
      </div>
    );
  }

  const filtered =
    phaseFilter === "all"
      ? tasks
      : tasks.filter((t) => t.phase === phaseFilter);

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 text-center text-xs sm:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Total tasks" value={String(tasks.length)} />
        <StatCard
          label="Total estimate"
          value={`${totalHours}h`}
          accent="zinc"
        />
        <StatCard label="AI-autonomous" value={`${aiHours}h`} accent="indigo" />
        <StatCard
          label="Human gates"
          value={`${humanHours}h`}
          accent="amber"
        />
        {totalTokens > 0 && (
          <StatCard
            label="Est. tokens"
            value={formatTokenCount(totalTokens)}
            accent="indigo"
          />
        )}
        <StatCard
          label="P0 / P1 / P2"
          value={`${priorities.P0} / ${priorities.P1} / ${priorities.P2}`}
          accent="zinc"
        />
      </div>

      {/* Legend */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
        <div className="flex flex-wrap gap-4">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-500" />
            AI-autonomous
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />
            Human confirmation
          </span>
          <span>
            <PriorityBadge priority="P0" /> Must have
          </span>
          <span>
            <PriorityBadge priority="P1" /> Should have
          </span>
          <span>
            <PriorityBadge priority="P2" /> Nice to have
          </span>
        </div>
      </div>

      {/* Phase filter */}
      {phases.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <FilterButton
            active={phaseFilter === "all"}
            onClick={() => setPhaseFilter("all")}
          >
            All ({tasks.length})
          </FilterButton>
          {phases.map((p) => {
            const count = tasks.filter((t) => t.phase === p).length;
            return (
              <FilterButton
                key={p}
                active={phaseFilter === p}
                onClick={() => setPhaseFilter(p)}
              >
                {p} ({count})
              </FilterButton>
            );
          })}
        </div>
      )}

      {/* Task table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-2">
        <table className="w-full min-w-[820px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2 w-[60px]">ID</th>
              <th className="px-3 py-2 w-[100px]">Phase</th>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2 w-[50px]">Est.</th>
              <th className="px-3 py-2 w-[40px]">Pri</th>
              <th className="px-3 py-2 w-[120px]">Type</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskRow({ task: t }: { task: KickoffWorkItem }) {
  const [expanded, setExpanded] = useState(false);
  const fileInfo = summarizeTaskFiles(t.files);

  return (
    <>
      <tr
        className="border-b border-zinc-100 align-top cursor-pointer hover:bg-zinc-50/80 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-zinc-500">
          <div className="flex items-center gap-1.5">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={`shrink-0 text-zinc-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            {t.id}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600">
          {t.phase}
        </td>
        <td className="px-3 py-2.5">
          <p className="font-medium text-zinc-900">{t.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 line-clamp-2">
            {t.description}
          </p>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-800">
          {t.estimatedHours}h
        </td>
        <td className="px-3 py-2.5">
          <PriorityBadge priority={t.priority} />
        </td>
        <td className="px-3 py-2.5">
          {t.executionKind === "ai_autonomous" ? (
            <span className="inline-flex rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
              AI-autonomous
            </span>
          ) : (
            <span className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              Human confirm
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-100 bg-zinc-50/30">
          <td colSpan={6} className="px-4 py-4">
            <div className="space-y-4 text-xs">
              {/* Description */}
              <p className="text-zinc-600 leading-relaxed">{t.description}</p>

              {/* Sub-steps */}
              {t.subSteps && t.subSteps.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-800">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                    </svg>
                    Implementation Steps
                  </h4>
                  <div className="space-y-0 rounded-lg border border-zinc-200 bg-white overflow-hidden">
                    {t.subSteps.map((ss) => (
                      <div
                        key={ss.step}
                        className="flex gap-3 border-b border-zinc-100 last:border-b-0 px-3 py-2.5"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
                          {ss.step}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-zinc-800">{ss.action}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                            {ss.detail}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Acceptance Criteria */}
              {t.acceptanceCriteria && t.acceptanceCriteria.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-800">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                      <path d="M22 4L12 14.01l-3-3" />
                    </svg>
                    Acceptance Criteria
                  </h4>
                  <ul className="space-y-1 rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
                    {t.acceptanceCriteria.map((ac, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] text-zinc-600">
                        <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-zinc-300 bg-zinc-50">
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-zinc-400">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </span>
                        {ac}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Token estimate */}
              {t.tokenEstimate && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-800">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    Token Estimate
                  </h4>
                  <div className="flex flex-wrap gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-400">Input</p>
                      <p className="font-mono font-semibold text-zinc-700">
                        {formatTokenCount(t.tokenEstimate.inputTokens)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-400">Output</p>
                      <p className="font-mono font-semibold text-zinc-700">
                        {formatTokenCount(t.tokenEstimate.outputTokens)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-400">Total</p>
                      <p className="font-mono font-bold text-indigo-700">
                        {formatTokenCount(t.tokenEstimate.totalTokens)}
                      </p>
                    </div>
                    {t.tokenEstimate.estimatedCostUsd > 0 && (
                      <div className="text-center">
                        <p className="text-[10px] uppercase tracking-wide text-zinc-400">Cost</p>
                        <p className="font-mono font-semibold text-emerald-700">
                          ${t.tokenEstimate.estimatedCostUsd.toFixed(4)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Files & Dependencies */}
              <div className="flex flex-wrap gap-4">
                {fileInfo && (
                  <div>
                    <span className="font-semibold text-zinc-700">Files: </span>
                    <span className="font-mono text-zinc-500">
                      {fileInfo}
                    </span>
                  </div>
                )}
                {t.dependencies && t.dependencies.length > 0 && (
                  <div>
                    <span className="font-semibold text-zinc-700">
                      Dependencies:{" "}
                    </span>
                    <span className="font-mono text-zinc-500">
                      {t.dependencies.join(", ")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function summarizeTaskFiles(files: KickoffWorkItem["files"]): string {
  if (!files) return "";
  if (Array.isArray(files)) return files.join(", ");
  const groups: string[] = [];
  if (files.creates.length > 0) groups.push(`create(${files.creates.length})`);
  if (files.modifies.length > 0)
    groups.push(`modify(${files.modifies.length})`);
  if (files.reads.length > 0) groups.push(`read(${files.reads.length})`);
  return groups.join(" · ");
}

type PushInfo = {
  available: boolean;
  hasToken: boolean;
  repo: {
    name?: string;
    htmlUrl?: string;
    cloneUrl?: string;
    savedAt?: string;
  } | null;
};

function PushGeneratedCodeSection({
  codeOutputDir,
}: {
  codeOutputDir: string;
}) {
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents/push-generated-code")
      .then((r) => r.json())
      .then((data: PushInfo) => setInfo(data))
      .catch(() => setInfo(null));
  }, []);

  const handlePush = async () => {
    setPushing(true);
    setMessage(null);
    try {
      const r = await fetch("/api/agents/push-generated-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codeOutputDir }),
      });
      const data = (await r.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        detail?: string;
      };
      if (!r.ok) {
        setMessage(
          [data.error, data.detail].filter(Boolean).join("\n") ||
            "Push failed",
        );
        return;
      }
      setMessage(data.message ?? "Done.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setPushing(false);
    }
  };

  if (info === null) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 text-[13px] text-zinc-500 shadow-sm">
        Checking GitHub push configuration…
      </div>
    );
  }

  if (!info.available) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 p-5 text-[13px] leading-relaxed text-zinc-600 shadow-sm">
        <p className="font-semibold text-zinc-900">Push generated code</p>
        <p className="mt-2">
          After kick-off creates a GitHub repo (direct API with{" "}
          <code className="rounded bg-zinc-200/80 px-1">GITHUB_TOKEN</code>),
          this panel can push{" "}
          <code className="rounded bg-zinc-200/80 px-1">{codeOutputDir}</code>{" "}
          to that repository. Re-run kick-off once with token configured, or add{" "}
          <code className="rounded bg-zinc-200/80 px-1">.blueprint/kickoff-repo.json</code>{" "}
          manually.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.06)]">
      <p className="text-[15px] font-semibold text-zinc-900">
        Push generated code to kick-off repo
      </p>
      {info.repo?.htmlUrl && (
        <p className="mt-1 text-xs text-zinc-500">
          Target:{" "}
          <a
            href={info.repo.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-600 underline"
          >
            {info.repo.name ?? info.repo.htmlUrl}
          </a>
        </p>
      )}
      {!info.hasToken && (
        <p className="mt-2 text-xs text-amber-800">
          Set{" "}
          <code className="rounded bg-amber-100 px-1">GITHUB_TOKEN</code> (or{" "}
          <code className="rounded bg-amber-100 px-1">
            PROJECT_KICKOFF_GITHUB_TOKEN
          </code>
          ) in <code className="rounded bg-amber-100 px-1">.env.local</code>{" "}
          on the machine running the app, then click Push.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pushing || !info.hasToken}
          onClick={handlePush}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pushing ? "Pushing…" : `Push ${codeOutputDir} → GitHub`}
        </button>
        <span className="text-[11px] text-zinc-400">
          Clones the kick-off repo, copies your output folder, commits, and pushes.
        </span>
      </div>
      {message && (
        <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-zinc-100 bg-zinc-50 p-2 text-[11px] whitespace-pre-wrap text-zinc-700 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
          {message}
        </pre>
      )}
    </div>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  const p = priority ?? "P1";
  const styles: Record<string, string> = {
    P0: "bg-red-50 text-red-700 border-red-200",
    P1: "bg-blue-50 text-blue-700 border-blue-200",
    P2: "bg-zinc-100 text-zinc-600 border-zinc-200",
  };
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${styles[p] ?? styles.P1}`}
    >
      {p}
    </span>
  );
}

function StatCard({
  label,
  value,
  accent = "zinc",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  const border =
    accent === "indigo"
      ? "border-indigo-100"
      : accent === "amber"
        ? "border-amber-100"
        : "border-zinc-200";
  const bg =
    accent === "indigo"
      ? "bg-indigo-50/50"
      : accent === "amber"
        ? "bg-amber-50/50"
        : "bg-white";
  const textColor =
    accent === "indigo"
      ? "text-indigo-800"
      : accent === "amber"
        ? "text-amber-900"
        : "text-zinc-900";
  const labelColor =
    accent === "indigo"
      ? "text-indigo-700"
      : accent === "amber"
        ? "text-amber-800"
        : "text-zinc-500";

  return (
    <div className={`rounded-lg border ${border} ${bg} p-3`}>
      <p className={`text-[11px] ${labelColor}`}>{label}</p>
      <p className={`mt-1 text-lg font-bold ${textColor}`}>{value}</p>
    </div>
  );
}

function FilterButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-indigo-100 text-indigo-800"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
