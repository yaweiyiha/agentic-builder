"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  PipelineRun,
  PipelineStepId,
  StepResult,
} from "@/lib/pipeline/types";

const DEFAULT_CODE_OUTPUT_DIR = "generated-code";

const EMPTY_STEPS: Record<PipelineStepId, StepResult | null> = {
  intent: null,
  prd: null,
  trd: null,
  sysdesign: null,
  implguide: null,
  design: null,
  pencil: null,
  mockup: null,
  qa: null,
  verify: null,
  kickoff: null,
};

interface PipelineState {
  steps: Record<PipelineStepId, StepResult | null>;
  currentStep: PipelineStepId | null;
  activeTab: PipelineStepId;
  totalCostUsd: number;
  isRunning: boolean;
  error: string | null;
  featureBrief: string;
  /** Relative to app project root, or absolute path on the machine running the server. */
  codeOutputDir: string;
  /** Skip Design / Pencil / Mockup / QA / Verify; PRD → kick-off (PRD.md + README). */
  fastFromPrd: boolean;

  setCodeOutputDir: (value: string) => void;
  setFastFromPrd: (value: boolean) => void;
  startPipeline: (featureBrief: string) => void;
  setActiveTab: (tab: PipelineStepId) => void;
  /** Batch-update step results (e.g. from parallel generation). */
  updateSteps: (updates: Partial<Record<PipelineStepId, StepResult>>) => void;
  /** Run only the kick-off step after parallel generation is complete. */
  runKickoff: () => void;
  reset: () => void;
}

export const usePipelineStore = create<PipelineState>()(
  persist(
    (set, get) => ({
      steps: { ...EMPTY_STEPS },
      currentStep: null,
      activeTab: "intent",
      totalCostUsd: 0,
      isRunning: false,
      error: null,
      featureBrief: "",
      codeOutputDir: DEFAULT_CODE_OUTPUT_DIR,
      fastFromPrd: true,

      setCodeOutputDir: (value) => set({ codeOutputDir: value }),
      setFastFromPrd: (value) => set({ fastFromPrd: value }),

      setActiveTab: (tab) => set({ activeTab: tab }),

      updateSteps: (updates) => {
        const current = get().steps;
        const merged = { ...current };
        let addedCost = 0;
        for (const [key, val] of Object.entries(updates)) {
          if (val) {
            merged[key as PipelineStepId] = val;
            addedCost += val.costUsd ?? 0;
          }
        }
        set({ steps: merged, totalCostUsd: get().totalCostUsd + addedCost });
      },

      runKickoff: () => {
        const { codeOutputDir, steps, featureBrief } = get();
        set({ isRunning: true, error: null, currentStep: "kickoff", activeTab: "kickoff" });

        fetch("/api/agents/kickoff", {
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
          }),
        })
          .then(async (resp) => {
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({}));
              set({
                isRunning: false,
                error: (errData as { error?: string }).error || "Kick-off failed",
              });
              return;
            }

            const reader = resp.body?.getReader();
            if (!reader) {
              set({ isRunning: false, error: "No response body" });
              return;
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try {
                  handleEvent(JSON.parse(line.slice(6)), set, get);
                } catch { /* skip */ }
              }
            }

            if (buffer.startsWith("data: ")) {
              try {
                handleEvent(JSON.parse(buffer.slice(6)), set, get);
              } catch { /* skip */ }
            }

            if (get().isRunning) set({ isRunning: false });
          })
          .catch((err) => {
            set({
              isRunning: false,
              error: err instanceof Error ? err.message : "Unknown error",
            });
          });
      },

      startPipeline: (brief: string) => {
        const { codeOutputDir, fastFromPrd } = get();
        set({
          isRunning: true,
          error: null,
          steps: { ...EMPTY_STEPS },
          currentStep: null,
          totalCostUsd: 0,
          featureBrief: brief,
          activeTab: "intent",
        });

        fetch("/api/agents/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            featureBrief: brief,
            codeOutputDir,
            fastFromPrd,
            pauseAfterPrd: !fastFromPrd,
          }),
        })
          .then(async (resp) => {
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({}));
              set({
                isRunning: false,
                error:
                  (errData as { error?: string }).error ||
                  "Pipeline request failed",
              });
              return;
            }

            const reader = resp.body?.getReader();
            if (!reader) {
              set({ isRunning: false, error: "No response body" });
              return;
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try {
                  const payload = JSON.parse(line.slice(6));
                  handleEvent(payload, set, get);
                } catch {
                  // skip malformed lines
                }
              }
            }

            if (buffer.startsWith("data: ")) {
              try {
                handleEvent(JSON.parse(buffer.slice(6)), set, get);
              } catch {
                /* skip */
              }
            }

            if (get().isRunning) set({ isRunning: false });
          })
          .catch((err) => {
            set({
              isRunning: false,
              error: err instanceof Error ? err.message : "Unknown error",
            });
          });
      },

      reset: () => {
        set({
          steps: { ...EMPTY_STEPS },
          currentStep: null,
          activeTab: "intent",
          totalCostUsd: 0,
          isRunning: false,
          error: null,
          featureBrief: "",
        });
      },
    }),
    {
      name: "agentic-pipeline-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        codeOutputDir: state.codeOutputDir,
        fastFromPrd: state.fastFromPrd,
      }),
    },
  ),
);

type SsePayload = {
  type: string;
  run?: PipelineRun;
  error?: string;
  runId?: string;
  stepId?: PipelineStepId;
  data?: Partial<StepResult>;
};

function handleEvent(
  payload: SsePayload,
  set: (s: Partial<PipelineState>) => void,
  get: () => PipelineState,
) {
  if (payload.type === "done" && payload.run) {
    const run = payload.run;
    const kickoffStep = run.steps.kickoff;
    const nextTab: PipelineStepId =
      kickoffStep != null && kickoffStep.status === "completed"
        ? "kickoff"
        : run.steps.prd?.status === "completed"
          ? "prd"
          : "intent";
    set({
      steps: { ...run.steps },
      currentStep: null,
      totalCostUsd: run.totalCostUsd,
      isRunning: false,
      activeTab: nextTab,
    });
    return;
  }

  if (payload.type === "error") {
    set({ isRunning: false, error: payload.error ?? "Pipeline failed" });
    return;
  }

  if (!payload.stepId) return;
  const stepId = payload.stepId;

  if (payload.type === "step_start") {
    const steps = { ...get().steps };
    steps[stepId] = {
      stepId,
      status: "running",
      timestamp: new Date().toISOString(),
    };
    set({ steps, currentStep: stepId, activeTab: stepId });
  }

  if (payload.type === "step_complete") {
    const steps = { ...get().steps };
    const stepData = payload.data as StepResult;
    steps[stepId] = {
      ...stepData,
      stepId,
      status: "completed",
    };
    const cost = get().totalCostUsd + (stepData.costUsd ?? 0);
    set({ steps, totalCostUsd: cost });
  }

  if (payload.type === "step_error") {
    const steps = { ...get().steps };
    steps[stepId] = {
      stepId,
      status: "failed",
      error: (payload.data as { error?: string })?.error,
      timestamp: new Date().toISOString(),
    };
    set({ steps, error: (payload.data as { error?: string })?.error });
  }
}
