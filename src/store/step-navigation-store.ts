"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StepId, ProjectTier } from "@/_config/pipeline-flow";
import { getStepsForTier, getNextStep, getPrevStep, getNodePath } from "@/_config/pipeline-flow";

// ── DB Sync ───────────────────────────────────────────────────────────────────
let _navSyncTimer: ReturnType<typeof setTimeout> | null = null;
let _navProjectSlug = "";

function scheduleNavSync(get: () => StepNavigationState) {
  if (!_navProjectSlug) return;
  if (_navSyncTimer) clearTimeout(_navSyncTimer);
  _navSyncTimer = setTimeout(() => {
    _navSyncTimer = null;
    const s = get();
    fetch(`/api/projects/${_navProjectSlug}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stageState: {
          activeStep: s.activeStep,
          projectName: s.projectName,
          intentMessages: s.intentMessages,
          intentEnrichedBrief: s.intentEnrichedBrief,
        },
      }),
    }).catch((err) => console.error("[step-nav-store] sync error:", err));
  }, 600);
}

// ── Store Interface ───────────────────────────────────────────────────────────

export interface StepNavigationState {
  /** Currently active step */
  activeStep: StepId;
  /** Project name (for sidebar) */
  projectName: string;
  /** Current project ID */
  projectId: string;
  /** Project tier — determines visible steps */
  tier: ProjectTier;
  /** Intent conversation messages */
  intentMessages: unknown[];
  /** Accumulated enriched brief */
  intentEnrichedBrief: string;
  /** True after loadFromServer completes */
  isHydrated: boolean;

  // ── Navigation ──
  goToStep: (stepId: StepId) => void;
  advanceStep: () => void;
  prevStep: () => void;
  resetNavigation: () => void;

  // ── Data setters ──
  setProjectName: (name: string) => void;
  setProjectId: (id: string) => void;
  setTier: (tier: ProjectTier) => void;
  setIntentConversation: (messages: unknown[], enrichedBrief: string) => void;
  setProjectSlug: (slug: string) => void;
  loadFromServer: (slug: string) => Promise<void>;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_ACTIVE_STEP: StepId = "initial";

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStepNavigationStore = create<StepNavigationState>()(
  persist(
    (set, get) => ({
      activeStep: DEFAULT_ACTIVE_STEP,
      projectName: "New Project",
      projectId: "",
      tier: "M",
      intentMessages: [],
      intentEnrichedBrief: "",
      isHydrated: false,

      // ── Navigation ──

      goToStep: (stepId) => {
        set({ activeStep: stepId });
        scheduleNavSync(get);
        // Restore step snapshot on navigation
        import("@/store/step-store").then(({ useStepStore }) => {
          useStepStore.getState().loadStepSnapshot(stepId);
        }).catch(() => {/* ignore */});
      },

      advanceStep: () => {
        const { activeStep, tier } = get();
        const next = getNextStep(activeStep, tier);
        if (next) {
          set({ activeStep: next });
          scheduleNavSync(get);
          import("@/store/step-store").then(({ useStepStore }) => {
            useStepStore.getState().loadStepSnapshot(next);
          }).catch(() => {/* ignore */});
        }
      },

      prevStep: () => {
        const { activeStep, tier } = get();
        const prev = getPrevStep(activeStep, tier);
        if (prev) {
          set({ activeStep: prev });
          scheduleNavSync(get);
          import("@/store/step-store").then(({ useStepStore }) => {
            useStepStore.getState().loadStepSnapshot(prev);
          }).catch(() => {/* ignore */});
        }
      },

      resetNavigation: () => {
        set({
          activeStep: DEFAULT_ACTIVE_STEP,
          projectName: "New Project",
          projectId: "",
          intentMessages: [],
          intentEnrichedBrief: "",
          isHydrated: false,
        });
      },

      // ── Data Setters ──

      setProjectName: (name) => {
        set({ projectName: name });
        scheduleNavSync(get);
      },

      setProjectId: (id) => set({ projectId: id }),

      setTier: (tier) => set({ tier }),

      setIntentConversation: (messages, enrichedBrief) => {
        set({ intentMessages: messages, intentEnrichedBrief: enrichedBrief });
        scheduleNavSync(get);
        // Also persist to step snapshot
        import("@/store/step-store").then(({ useStepStore }) => {
          useStepStore.getState().saveIntentSnapshot(messages, enrichedBrief);
        }).catch(() => {/* ignore */});
      },

      setProjectSlug: (slug) => {
        _navProjectSlug = slug;
        set({ projectId: slug });
      },

      loadFromServer: async (slug: string) => {
        _navProjectSlug = slug;
        try {
          const resp = await fetch(`/api/projects/${slug}/state`, { cache: "no-store" });
          if (!resp.ok) return;
          const data = (await resp.json()) as {
            stageState?: {
              activeStage?: string;
              activeSubStages?: Record<string, string>;
              projectName?: string;
              intentMessages?: unknown[];
              intentEnrichedBrief?: string;
            } | null;
          };
          const ss = data.stageState;
          if (!ss) return;

          // Convert legacy (stage, subStage) → flat step ID
          let activeStep: StepId = DEFAULT_ACTIVE_STEP;
          if (ss.activeStage && ss.activeSubStages) {
            const subStageId = ss.activeSubStages[ss.activeStage];
            if (subStageId) {
              // The legacy subStage IDs map directly to our StepIds
              activeStep = subStageId as StepId;
            }
          }

          set({
            activeStep,
            projectName: ss.projectName ?? "New Project",
            projectId: slug,
            intentMessages: ss.intentMessages ?? [],
            intentEnrichedBrief: ss.intentEnrichedBrief ?? "",
          });
        } catch (err) {
          console.error("[step-nav-store] loadFromServer error:", err);
        } finally {
          set({ isHydrated: true });
        }
      },
    }),
    {
      name: "agentic-step-nav-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeStep: state.activeStep,
        projectId: state.projectId,
        projectName: state.projectName,
        tier: state.tier,
      }),
    },
  ),
);
