/**
 * Single source of truth for kickoff-step state, derived stats, and the
 * handler set shared between KickoffSummaryView and KickoffTasksView.
 *
 * Lifts every piece of state that used to live inline in KickoffStepPanel
 * so the views can be split into separate sub-stage routes without
 * losing behavior. The wrapper (KickoffStepPanel) calls this once and
 * threads the result through both views; standalone sub-stages each call
 * it once for their own view.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import { useCodingStore } from "@/store/coding-store";
import { usePipelineStore } from "@/store/pipeline-store";
import type { KickoffWorkItem, StepResult } from "@/lib/pipeline/types";
import type { SessionCheckpoint } from "@/lib/pipeline/session-checkpoint";

import type {
  KickoffStepData,
  TaskBreakdownReviewSuggestion,
} from "./types";

interface UseKickoffStepDataOptions {
  /** Called once after a successful confirm-and-start-coding action. */
  onStartCoding?: () => void;
}

export function useKickoffStepData(
  result: StepResult,
  opts: UseKickoffStepDataOptions = {},
): KickoffStepData {
  const codingStatus = useCodingStore((s) => s.status);
  const startCoding = useCodingStore((s) => s.startCoding);
  const retryFailedTasks = useCodingStore((s) => s.retryFailedTasks);
  const codeOutputDir = usePipelineStore((s) => s.codeOutputDir);
  const steps = usePipelineStore((s) => s.steps);
  const updateSteps = usePipelineStore((s) => s.updateSteps);
  const isRunning = usePipelineStore((s) => s.isRunning);
  const currentStep = usePipelineStore((s) => s.currentStep);

  // ─── Parsed from metadata ────────────────────────────────────────────────
  const tasks = useMemo(
    () => parseKickoffTaskBreakdownFromMetadata(result.metadata),
    [result.metadata],
  );

  const kickoffMetadata = (result.metadata ?? {}) as Record<string, unknown>;
  const taskBreakdownConfirmed = kickoffMetadata.taskBreakdownConfirmed === true;
  const parseFailed = kickoffMetadata.taskBreakdownParseFailed === true;
  const parseError =
    typeof kickoffMetadata.taskBreakdownParseError === "string"
      ? (kickoffMetadata.taskBreakdownParseError as string)
      : "";
  const rawTaskBreakdownOutput =
    typeof kickoffMetadata.taskBreakdownRawOutput === "string"
      ? (kickoffMetadata.taskBreakdownRawOutput as string)
      : "";
  const reviewSuggestions: TaskBreakdownReviewSuggestion[] = Array.isArray(
    kickoffMetadata.taskBreakdownReviewSuggestions,
  )
    ? (kickoffMetadata.taskBreakdownReviewSuggestions as TaskBreakdownReviewSuggestion[])
    : [];

  // ─── Local UI state ──────────────────────────────────────────────────────
  const [checkpoint, setCheckpoint] = useState<SessionCheckpoint | null>(null);
  const [retryingBreakdown, setRetryingBreakdown] = useState(false);
  const [retryBreakdownError, setRetryBreakdownError] = useState<string | null>(
    null,
  );
  const [reviewingBreakdown, setReviewingBreakdown] = useState(false);
  const [reviewBreakdownError, setReviewBreakdownError] = useState<
    string | null
  >(null);
  const [regeneratingWithSuggestions, setRegeneratingWithSuggestions] =
    useState(false);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>(
    [],
  );

  // Reset suggestion selection whenever the underlying result changes.
  useEffect(() => {
    setSelectedSuggestionIds(reviewSuggestions.map((s) => s.id));
    // result.timestamp + suggestions.length form a sufficient invalidation key.
  }, [result.timestamp, reviewSuggestions.length]);

  // Load last session checkpoint to enable "Retry Failed Tasks".
  useEffect(() => {
    fetch("/api/agents/coding/checkpoint")
      .then((r) => r.json())
      .then((data: { checkpoint: SessionCheckpoint | null }) => {
        setCheckpoint(data.checkpoint);
      })
      .catch(() => setCheckpoint(null));
  }, []);

  // ─── Derived stats ───────────────────────────────────────────────────────
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
  for (const t of tasks) {
    const p = t.priority ?? "P1";
    if (p in priorities) priorities[p as keyof typeof priorities]++;
  }

  // ─── Failure-task retry support ──────────────────────────────────────────
  const currentTaskIds = new Set(tasks.map((t) => t.id));
  const matchingFailedIds =
    checkpoint?.failedTaskIds.filter((id) => currentTaskIds.has(id)) ?? [];
  const hasFailedTasks =
    checkpoint !== null &&
    matchingFailedIds.length > 0 &&
    (codingStatus === "completed" || codingStatus === "failed");

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleConfirmAndCode = useCallback(() => {
    if (!taskBreakdownConfirmed) return;
    const runId =
      typeof result.metadata?.runId === "string"
        ? (result.metadata.runId as string)
        : "run-" + Date.now();
    startCoding(runId, tasks, codeOutputDir, undefined, steps.prd?.content);
    opts.onStartCoding?.();
  }, [
    taskBreakdownConfirmed,
    result.metadata,
    tasks,
    codeOutputDir,
    steps.prd?.content,
    startCoding,
    opts,
  ]);

  const handleRetryFailed = useCallback(() => {
    if (matchingFailedIds.length === 0) return;
    const runId =
      typeof result.metadata?.runId === "string"
        ? (result.metadata.runId as string)
        : "run-" + Date.now();
    retryFailedTasks(
      runId,
      tasks,
      matchingFailedIds,
      codeOutputDir,
      undefined,
      steps.prd?.content,
    );
    opts.onStartCoding?.();
  }, [
    matchingFailedIds,
    result.metadata,
    tasks,
    codeOutputDir,
    steps.prd?.content,
    retryFailedTasks,
    opts,
  ]);

  const handleRetryKickoffBreakdown = useCallback(async () => {
    const ok = window.confirm(
      "Retry task breakdown now? This re-runs only the task breakdown step using existing preparation context.",
    );
    if (!ok) return;
    setRetryBreakdownError(null);
    setRetryingBreakdown(true);
    try {
      const tierRaw = (steps.intent?.metadata as
        | Record<string, unknown>
        | undefined)?.classification as { tier?: string } | undefined;
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
      if (!resp.ok) throw new Error(data.error || "Task breakdown retry failed");

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
  }, [result, steps, updateSteps]);

  const handleAnalyzeTaskBreakdown = useCallback(async () => {
    if (tasks.length === 0 || reviewingBreakdown) return;
    setReviewBreakdownError(null);
    setReviewingBreakdown(true);
    try {
      const tierRaw = (steps.intent?.metadata as
        | Record<string, unknown>
        | undefined)?.classification as { tier?: string } | undefined;
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
      if (!resp.ok)
        throw new Error(data.error || "Task breakdown review failed");
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
  }, [tasks, reviewingBreakdown, result, steps, updateSteps]);

  const handleRegenerateWithSelectedSuggestions = useCallback(async () => {
    const selected = reviewSuggestions.filter((s) =>
      selectedSuggestionIds.includes(s.id),
    );
    if (selected.length === 0 || regeneratingWithSuggestions) return;
    setReviewBreakdownError(null);
    setRegeneratingWithSuggestions(true);
    try {
      const tierRaw = (steps.intent?.metadata as
        | Record<string, unknown>
        | undefined)?.classification as { tier?: string } | undefined;
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
      if (!resp.ok)
        throw new Error(data.error || "Task breakdown regeneration failed");
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
        err instanceof Error
          ? err.message
          : "Task breakdown regeneration failed",
      );
    } finally {
      setRegeneratingWithSuggestions(false);
    }
  }, [
    reviewSuggestions,
    selectedSuggestionIds,
    regeneratingWithSuggestions,
    result,
    steps,
    updateSteps,
  ]);

  const handleConfirmTaskBreakdown = useCallback(() => {
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
  }, [tasks, result, updateSteps]);

  return {
    tasks,
    taskBreakdownConfirmed,
    parseFailed,
    parseError,
    rawTaskBreakdownOutput,
    reviewSuggestions,

    totalHours,
    aiHours,
    humanHours,
    totalTokens,
    totalCost,
    phases,
    priorities,

    checkpoint,
    matchingFailedIds,
    hasFailedTasks,

    codingStatus,
    isRunning,
    currentStep,
    codeOutputDir,

    retryingBreakdown,
    retryBreakdownError,
    reviewingBreakdown,
    reviewBreakdownError,
    regeneratingWithSuggestions,
    selectedSuggestionIds,
    setSelectedSuggestionIds,

    handleConfirmAndCode,
    handleRetryFailed,
    handleRetryKickoffBreakdown,
    handleAnalyzeTaskBreakdown,
    handleRegenerateWithSelectedSuggestions,
    handleConfirmTaskBreakdown,
  };
}
