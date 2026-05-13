"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { Monitor, Bell, HelpCircle } from "lucide-react";
import PipelineBreadcrumb from "@/components/PipelineBreadcrumb";
import { Button } from "@/components/ui/button";
import { STEP_REGISTRY } from "./_steps/step-registry";
import { getStepConfig } from "@/_config/pipeline-flow";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { loadAllStepSnapshots } from "./_steps/_shared/snapshot-context";
import type { StepId, ProjectTier } from "@/_config/pipeline-flow";
import type { StepUIProps } from "./_steps/_shared/types";
import type { ComponentType } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch the project's persisted navigation state from backend */
async function fetchProjectNav(projectId: string) {
  const res = await fetch(`/api/projects/${projectId}/step-navigation`);
  if (!res.ok) return null;
  return res.json() as Promise<{ activeStep: StepId; tier: ProjectTier } | null>;
}

/** Persist activeStep to backend (debounced in caller) */
async function persistActiveStep(projectId: string, stepId: StepId) {
  await fetch(`/api/projects/${projectId}/step-navigation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeStep: stepId }),
  });
}

// ─── Page (thin shell, owns activeStep state from API) ────────────────────

export default function ProjectPage() {
  const params    = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  // ── Page-level state ──
  const [activeStep, setActiveStep] = useState<StepId>("initial");
  const [tier, setTier]             = useState<ProjectTier>("M");
  const [loading, setLoading]       = useState(true);
  const [stepResults, setStepResults] = useState<Record<string, StepUIProps["stepResult"]>>({});

  // Track previous projectId so we can detect changes and reset
  const prevProjectIdRef = useRef<string | null>(null);

  // Track activeStep in a ref so the snapshot save callback always sees the latest
  const activeStepRef = useRef<StepId>("initial");

  // ── Snapshot helpers ──────────────────────────────────────────────────────
  function saveCurrentSnapshot(slug: string, stepId: StepId) {
    const entry = STEP_REGISTRY[stepId];
    if (!entry?.snapshot?.save) return;
    const s = useStepStore.getState();
    const data: Record<string, unknown> = {
      featureBrief: s.featureBrief,
      steps: s.steps as Record<string, unknown>,
      totalCostUsd: s.totalCostUsd,
      codeOutputDir: s.codeOutputDir,
      currentStep: s.currentStep,
    };
    // Include intentMessages when saving the intent step
    if (stepId === "intent") {
      data.intentMessages = s.intentMessages;
      data.intentEnrichedBrief = s.intentEnrichedBrief;
    }
    entry.snapshot.save(slug, data).catch((err) =>
      console.error(`[ProjectPage] snapshot save error (${stepId}):`, err),
    );
  }

  // ── Hydration: fetch current step from backend on project change ──
  useEffect(() => {
    if (!projectId) return;

    // Reset state when switching projects
    if (prevProjectIdRef.current !== projectId) {
      setActiveStep("initial");
      activeStepRef.current = "initial";
      setStepResults({});
      setLoading(true);
      prevProjectIdRef.current = projectId;
    }

    // Hydrate the step-navigation store
    useStepNavigationStore.getState().loadFromServer(projectId);
    // Init step-store project slug (hydration happens via step-specific snapshot)
    useStepStore.getState().setProjectSlug(projectId);

    fetchProjectNav(projectId)
      .then(async (nav) => {
        if (nav) {
          setActiveStep(nav.activeStep);
          activeStepRef.current = nav.activeStep;
          setTier(nav.tier);
          // Load ALL step snapshots first, then mark hydrated — prevents auto-start racing
          await loadAllStepSnapshots(projectId);
        }
      })
      .catch((err) => console.error("[ProjectPage] hydration error:", err))
      .finally(() => {
        useStepStore.setState({ isHydrated: true });
        setLoading(false);
      });
  }, [projectId]);

  // ── Step change handler — save snapshot, update step, load all snapshots, persist ──
  const handleStepChange = useCallback(async (stepId: StepId) => {
    const prevStep = activeStepRef.current;

    // Save snapshot for the CURRENT step before navigating away
    if (prevStep !== stepId) {
      saveCurrentSnapshot(projectId, prevStep);
    }

    // Gate auto-start effects: reset isRunning/isHydrated so step components
    // don't auto-generate until all snapshots are restored.
    useStepStore.setState({ isHydrated: false, isRunning: false, currentStep: null });

    // Load ALL step snapshots at once — every step's data is available immediately.
    await loadAllStepSnapshots(projectId);

    // Now safe to render the new step with restored data
    setActiveStep(stepId);
    activeStepRef.current = stepId;
    useStepStore.setState({ isHydrated: true });

    // Persist activeStep to backend (fire-and-forget)
    persistActiveStep(projectId, stepId).catch(console.error);
  }, [projectId]);

  // ── Update step result (called by child step UIs) ──
  const handleStepResult = useCallback((stepId: StepId, result: StepUIProps["stepResult"]) => {
    setStepResults((prev) => ({ ...prev, [stepId]: result }));
  }, []);

  // ── Step registry ──
  const stepEntry = STEP_REGISTRY[activeStep];
  const StepViewComponent = (stepEntry?.component ?? null) as ComponentType<StepUIProps> | null;
  const stepConfig = getStepConfig(activeStep) ?? { uiKind: "custom" as const };

  // ── Build step UI props ──
  const stepUIProps: StepUIProps | null = useMemo(() => {
    if (!stepEntry) return null;
    // Read live agent state from step-store for reactive streaming UI
    const s = useStepStore.getState();
    return {
      agentState: {
        streamingContent: s.streamingContent,
        streamingThinking: s.streamingThinking,
        isRunning: s.isRunning,
        error: s.error,
        totalCostUsd: s.totalCostUsd,
      },
      stepResult: stepResults[activeStep] ?? null,
      stepConfig,
      onStart: (editInstruction?: string) => {
        void useStepStore.getState().executeStep(activeStep, editInstruction);
      },
      onNavigate: handleStepChange,
      isHydrated: !loading,
      projectSlug: projectId,
    };
  }, [stepEntry, stepResults, activeStep, stepConfig, loading, projectId, handleStepChange]);

  return (
    <div className="flex flex-col min-h-screen h-screen! relative bg-[#f8f9ff]">
      {/* ── Header with Breadcrumb ── */}
      <header className="flex shrink-0 items-start justify-between border-b border-[#e2e8f0] bg-white/90 backdrop-blur-sm px-4 relative z-10">
        <PipelineBreadcrumb
          activeStep={activeStep}
          onStepChange={handleStepChange}
          tier={tier}
          stepStates={{}}
        />
        <div className="flex items-center gap-1 pt-3 pr-2 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#64748b]">
            <Monitor className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#64748b]">
            <Bell className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#64748b]">
            <HelpCircle className="size-4" />
          </Button>
        </div>
      </header>

      {/* ── Active Step View ── */}
      <main className="flex flex-1 flex-col relative z-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[#94a3b8]">
            <p className="text-sm">Loading project...</p>
          </div>
        ) : StepViewComponent && stepUIProps ? (
          <StepViewComponent {...stepUIProps} />
        ) : (
          <div className="flex items-center justify-center h-full text-[#94a3b8]">
            <p className="text-sm">Step &quot;{activeStep}&quot; not found in registry.</p>
          </div>
        )}
      </main>
    </div>
  );
}
