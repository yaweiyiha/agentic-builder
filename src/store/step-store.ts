"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StepId, ProjectTier } from "@/_config/pipeline-flow";
import { getNodePath } from "@/_config/pipeline-flow";
import type { StepResultData, StepSnapshot, SnapshotData } from "@/app/(dashboard)/project/[projectId]/_steps/_shared/types";

// ── DB Sync ───────────────────────────────────────────────────────────────────
let _stepProjectSlug = "";

// ── New Session ID ────────────────────────────────────────────────────────────
function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "ses-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Empty Step State ──────────────────────────────────────────────────────────
const ALL_STEP_IDS: StepId[] = [
  "initial", "intent", "prd", "trd", "sysdesign", "implguide",
  "design", "pencil", "mockup", "qa", "verify",
  "env-setup", "task-breakdown",
  "architect", "backend", "frontend", "test", "coding-verify",
  "serve", "e2e",
];

function emptySteps(): Record<StepId, StepResultData | null> {
  const rec = {} as Record<StepId, StepResultData | null>;
  for (const id of ALL_STEP_IDS) rec[id] = null;
  return rec;
}

// ── Snapshot Save Helper ──────────────────────────────────────────────────────
function saveStepSnapshot(
  get: () => StepStoreState,
  stepId: StepId,
): void {
  if (!_stepProjectSlug) return;
  const path = getNodePath(stepId);
  if (!path) return;
  const s = get();
  const snapshot = {
    featureBrief: s.featureBrief,
    currentStep: s.currentStep,
    totalCostUsd: s.totalCostUsd,
    isRunning: false,
    fastFromPrd: s.fastFromPrd,
    codeOutputDir: s.codeOutputDir,
    steps: s.steps as Record<string, unknown>,
    intentMessages: s.intentMessages,
    intentEnrichedBrief: s.intentEnrichedBrief,
  };
  fetch(`/api/projects/${_stepProjectSlug}/substage-snapshot`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stageId: path.stage.id,
      subStageId: path.step.id,
      snapshot,
    }),
  }).catch((err) => console.error(`[step-store] snapshot error (${stepId}):`, err));
}

// ── Store Interface ───────────────────────────────────────────────────────────

export interface StepStoreState {
  // ── Step results ──
  steps: Record<StepId, StepResultData | null>;

  // ── Execution state ──
  currentStep: StepId | null;
  isRunning: boolean;
  error: string | null;
  totalCostUsd: number;

  // ── Streaming ──
  streamingContent: string;
  streamingThinking: string;

  // ── Configuration persisted to DB ──
  featureBrief: string;
  codeOutputDir: string;
  fastFromPrd: boolean;
  tier: ProjectTier;

  // ── Intent conversation ──
  intentMessages: unknown[];
  intentEnrichedBrief: string;

  // ── Kickoff ──
  kickoffSessionId: string | null;

  // ── Hydration ──
  isHydrated: boolean;

  // ── Actions ──
  setFeatureBrief: (brief: string) => void;
  setCodeOutputDir: (dir: string) => void;
  setFastFromPrd: (fast: boolean) => void;
  setTier: (tier: ProjectTier) => void;

  /** Set a single step result */
  setStepResult: (stepId: StepId, result: StepResultData) => void;
  /** Mark a step as running */
  setStepRunning: (stepId: StepId) => void;
  /** Mark a step as completed with content */
  setStepCompleted: (stepId: StepId, content: string, costUsd?: number, durationMs?: number) => void;
  /** Mark a step as failed */
  setStepFailed: (stepId: StepId, error: string) => void;

  /** Set the project slug for DB sync */
  setProjectSlug: (slug: string) => void;
  /** Load all state from DB */
  loadFromServer: (slug: string) => Promise<void>;
  /** Load snapshot for a specific step */
  loadStepSnapshot: (stepId: StepId) => Promise<boolean>;

  /** Save intent conversation snapshot */
  saveIntentSnapshot: (messages: unknown[], enrichedBrief: string) => void;

  /** Start the full pipeline (preparation → kickoff) */
  startPipeline: (featureBrief: string) => void;
  /** Reset all state */
  reset: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStepStore = create<StepStoreState>()(
  persist(
    (set, get) => ({
      steps: emptySteps(),
      currentStep: null,
      isRunning: false,
      error: null,
      totalCostUsd: 0,
      streamingContent: "",
      streamingThinking: "",
      featureBrief: "",
      codeOutputDir: "generated-code",
      fastFromPrd: true,
      tier: "M",
      intentMessages: [],
      intentEnrichedBrief: "",
      kickoffSessionId: null,
      isHydrated: false,

      // ── Simple Setters ──
      setFeatureBrief: (brief) => set({ featureBrief: brief.trim() }),
      setCodeOutputDir: (dir) => {
        const trimmed = dir.trim();
        set({ codeOutputDir: trimmed.length > 0 ? trimmed : "generated-code" });
      },
      setFastFromPrd: (fast) => set({ fastFromPrd: fast }),
      setTier: (tier) => set({ tier }),

      // ── Step Result Mutations ──
      setStepResult: (stepId, result) => {
        set((s) => ({
          steps: { ...s.steps, [stepId]: result },
          totalCostUsd: s.totalCostUsd + (result.costUsd ?? 0),
        }));
      },

      setStepRunning: (stepId) => {
        set((s) => ({
          currentStep: stepId,
          isRunning: true,
          error: null,
          streamingContent: "",
          streamingThinking: "",
          steps: {
            ...s.steps,
            [stepId]: {
              stepId,
              status: "running",
              timestamp: new Date().toISOString(),
            },
          },
        }));
      },

      setStepCompleted: (stepId, content, costUsd = 0, durationMs = 0) => {
        set((s) => ({
          steps: {
            ...s.steps,
            [stepId]: {
              stepId,
              status: "completed",
              content,
              costUsd,
              durationMs,
              timestamp: new Date().toISOString(),
            },
          },
          totalCostUsd: s.totalCostUsd + costUsd,
          streamingContent: "",
          streamingThinking: "",
          isRunning: false,
          currentStep: null,
        }));
        saveStepSnapshot(get, stepId);
      },

      setStepFailed: (stepId, error) => {
        set((s) => ({
          steps: {
            ...s.steps,
            [stepId]: {
              stepId,
              status: "failed",
              error,
              timestamp: new Date().toISOString(),
            },
          },
          isRunning: false,
          currentStep: null,
          error,
        }));
      },

      // ── DB Sync ──
      setProjectSlug: (slug) => {
        _stepProjectSlug = slug;
      },

      loadFromServer: async (slug: string) => {
        _stepProjectSlug = slug;
        try {
          // Try to restore the active substage snapshot
          const snapResp = await fetch(`/api/projects/${slug}/substage-snapshot`, { cache: "no-store" });
          if (snapResp.ok) {
            const snapData = (await snapResp.json()) as {
              snapshot?: {
                featureBrief?: string;
                currentStep?: string | null;
                totalCostUsd?: number;
                isRunning?: boolean;
                fastFromPrd?: boolean;
                codeOutputDir?: string;
                steps?: Record<string, unknown>;
                intentMessages?: unknown[];
                intentEnrichedBrief?: string;
              } | null;
            };
            if (snapData.snapshot) {
              const snap = snapData.snapshot;
              set({
                featureBrief: snap.featureBrief ?? "",
                currentStep: (snap.currentStep as StepId | null) ?? null,
                totalCostUsd: snap.totalCostUsd ?? 0,
                isRunning: false,
                fastFromPrd: snap.fastFromPrd ?? true,
                codeOutputDir: snap.codeOutputDir ?? "generated-code",
                steps: snap.steps
                  ? { ...emptySteps(), ...(snap.steps as Record<StepId, StepResultData | null>) }
                  : emptySteps(),
                intentMessages: snap.intentMessages ?? [],
                intentEnrichedBrief: snap.intentEnrichedBrief ?? "",
              });
              set({ isHydrated: true });
              return;
            }
          }

        } catch (err) {
          console.error("[step-store] loadFromServer error:", err);
        } finally {
          set({ isHydrated: true });
        }
      },

      loadStepSnapshot: async (stepId: StepId): Promise<boolean> => {
        if (!_stepProjectSlug || get().isRunning) return false;
        const path = getNodePath(stepId);
        if (!path) return false;
        try {
          const url = `/api/projects/${_stepProjectSlug}/substage-snapshot?stage=${encodeURIComponent(path.stage.id)}&subStage=${encodeURIComponent(path.step.id)}`;
          const resp = await fetch(url, { cache: "no-store" });
          if (!resp.ok) return false;
          const data = (await resp.json()) as {
            snapshot?: {
              featureBrief?: string;
              currentStep?: string | null;
              totalCostUsd?: number;
              isRunning?: boolean;
              fastFromPrd?: boolean;
              codeOutputDir?: string;
              steps?: Record<string, unknown>;
              intentMessages?: unknown[];
              intentEnrichedBrief?: string;
            } | null;
          };
          if (!data.snapshot) return false;
          const snap = data.snapshot;
          set({
            featureBrief: snap.featureBrief ?? "",
            currentStep: (snap.currentStep as StepId | null) ?? null,
            totalCostUsd: snap.totalCostUsd ?? 0,
            isRunning: false,
            fastFromPrd: snap.fastFromPrd ?? true,
            codeOutputDir: snap.codeOutputDir ?? "generated-code",
            steps: snap.steps
              ? { ...emptySteps(), ...(snap.steps as Record<StepId, StepResultData | null>) }
              : emptySteps(),
          });
          if (stepId === "intent" && snap.intentMessages?.length) {
            set({
              intentMessages: snap.intentMessages ?? [],
              intentEnrichedBrief: snap.intentEnrichedBrief ?? "",
            });
          }
          return true;
        } catch (err) {
          console.error(`[step-store] loadStepSnapshot error (${stepId}):`, err);
          return false;
        }
      },

      saveIntentSnapshot: (messages, enrichedBrief) => {
        if (!_stepProjectSlug) return;
        const s = get();
        const path = getNodePath("intent");
        if (!path) return;
        const snapshot = {
          featureBrief: s.featureBrief,
          currentStep: s.currentStep,
          totalCostUsd: s.totalCostUsd,
          isRunning: false,
          fastFromPrd: s.fastFromPrd,
          codeOutputDir: s.codeOutputDir,
          steps: s.steps as Record<string, unknown>,
          intentMessages: messages,
          intentEnrichedBrief: enrichedBrief,
        };
        fetch(`/api/projects/${_stepProjectSlug}/substage-snapshot`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stageId: path.stage.id,
            subStageId: path.step.id,
            snapshot,
          }),
        }).catch((err) => console.error("[step-store] intent snapshot error:", err));
      },

      // ── Pipeline Start ──
      startPipeline: (featureBrief: string) => {
        const { codeOutputDir, fastFromPrd } = get();
        const sessionId = newSessionId();
        set({
          isRunning: true,
          error: null,
          steps: emptySteps(),
          currentStep: null,
          totalCostUsd: 0,
          featureBrief,
          kickoffSessionId: sessionId,
        });

        fetch("/api/agents/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            featureBrief,
            codeOutputDir,
            fastFromPrd,
            pauseAfterPrd: !fastFromPrd,
            sessionId,
          }),
        }).catch((err) => {
          set({
            isRunning: false,
            error: err instanceof Error ? err.message : "Pipeline request failed",
          });
        });
      },

      reset: () => {
        set({
          steps: emptySteps(),
          currentStep: null,
          totalCostUsd: 0,
          isRunning: false,
          error: null,
          featureBrief: "",
          streamingContent: "",
          streamingThinking: "",
          kickoffSessionId: null,
          intentMessages: [],
          intentEnrichedBrief: "",
        });
      },
    }),
    {
      name: "agentic-step-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        codeOutputDir: state.codeOutputDir,
        fastFromPrd: state.fastFromPrd,
        featureBrief: state.featureBrief,
      }),
    },
  ),
);
