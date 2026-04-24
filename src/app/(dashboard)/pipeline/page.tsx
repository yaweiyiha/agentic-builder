"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useCodingStore } from "@/store/coding-store";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import KickoffStepPanel from "@/components/KickoffStepPanel";
import CodingAgentGraph from "@/components/CodingAgentGraph";
import PreviewPanel from "@/components/PreviewPanel";
import PrdReviewPanel, {
  type PrdReviewChatMsg,
} from "@/components/PrdReviewPanel";
import GenerationPlanPanel, {
  type ParallelDocResult,
  type ParallelGenLiveSnapshot,
} from "@/components/GenerationPlanPanel";
import PrdSpecWireframesSection, {
  parsePrdStepMetadata,
} from "@/components/PrdSpecWireframesSection";
import DocReviewPanel from "@/components/DocReviewPanel";
import PencilEditPanel from "@/components/PencilEditPanel";
import {
  PrepStyleChatTranscript,
  type PrepDocChatMsg,
} from "@/components/PrepStyleChatPanel";
import Loading from "@/components/Loading";
import ImportPrdDialog from "@/components/ImportPrdDialog";
import DesignReferencesDialog from "@/components/DesignReferencesDialog";
import type { PipelineStepId, StepResult } from "@/lib/pipeline/types";
import type { ProjectTier } from "@/lib/agents/project-classifier";
import { DEBUG_SAMPLE_KICKOFF_TASKS } from "@/lib/pipeline/debug-sample-tasks";
import { DEBUG_CRITICAL_ILLNESS_KICKOFF_TASKS } from "@/lib/pipeline/debug-critical-illness-tasks";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import { isKickoffTaskBreakdownConfirmed } from "@/lib/pipeline/kickoff-task-breakdown";
import {
  isContinueCommand,
  isRegenerateCommand,
} from "@/lib/pipeline/command-bar-gates";
import {
  defaultSelectedParallelDocIds,
  parallelDocBlueprintsForTier,
} from "@/lib/pipeline/parallel-doc-plan";
import {
  defaultDesignStyleId,
  type DesignStyleId,
} from "@/lib/pipeline/design-style-presets";
import { MODEL_CONFIG, primaryModel } from "@/lib/model-config";
import { resolveModel } from "@/lib/openrouter";

const PREP_STEPS: { id: PipelineStepId; label: string }[] = [
  { id: "intent", label: "Intent" },
  { id: "prd", label: "PRD" },
  { id: "trd", label: "TRD" },
  { id: "sysdesign", label: "System Design" },
  { id: "implguide", label: "Impl Guide" },
  { id: "design", label: "Design" },
  { id: "pencil", label: "Pencil Design" },
  { id: "qa", label: "QA" },
  { id: "verify", label: "Verify" },
];

type TopPhase = "preparation" | "kickoff" | "coding" | "preview";

const TOP_PHASES: { id: TopPhase; label: string }[] = [
  { id: "preparation", label: "Preparation" },
  { id: "kickoff", label: "Kick-off" },
  { id: "coding", label: "Coding" },
  { id: "preview", label: "Preview" },
];

const DEFAULT_CODE_OUTPUT_DIR = "generated-code";

const PREP_STEP_IDS = new Set(PREP_STEPS.map((s) => s.id));

function phaseForStep(stepId: PipelineStepId): TopPhase {
  if (PREP_STEP_IDS.has(stepId)) return "preparation";
  return "kickoff";
}

function stepIdForPhase(phase: TopPhase): PipelineStepId {
  if (phase === "kickoff" || phase === "coding" || phase === "preview")
    return "kickoff";
  return "intent";
}

export default function PipelinePage() {
  const {
    steps,
    currentStep,
    activeTab,
    totalCostUsd,
    isRunning,
    error,
    codeOutputDir,
    fastFromPrd,
    streamingContent,
    streamingThinking,
    setCodeOutputDir,
    setFastFromPrd,
    startPipeline,
    setActiveTab,
    reset,
  } = usePipelineStore();

  const importedPrd = usePipelineStore((s) => s.importedPrd);
  const refreshImportedPrdStatus = usePipelineStore(
    (s) => s.refreshImportedPrdStatus,
  );
  const clearImportedPrd = usePipelineStore((s) => s.clearImportedPrd);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const designReferences = usePipelineStore((s) => s.designReferences);
  const refreshDesignReferences = usePipelineStore(
    (s) => s.refreshDesignReferences,
  );
  const clearDesignReferences = usePipelineStore(
    (s) => s.clearDesignReferences,
  );
  const [designReferencesDialogOpen, setDesignReferencesDialogOpen] =
    useState(false);

  useEffect(() => {
    void refreshImportedPrdStatus();
    void refreshDesignReferences();
  }, [refreshImportedPrdStatus, refreshDesignReferences]);

  const [featureBrief, setFeatureBrief] = useState("");
  const [activeOverridePhase, setActiveOverridePhase] = useState<
    "coding" | "preview" | null
  >(null);
  const codingStatus = useCodingStore((s) => s.status);
  const startCoding = useCodingStore((s) => s.startCoding);
  const retryE2eVerify = useCodingStore((s) => s.retryE2eVerify);

  const [prdConfirmed, setPrdConfirmed] = useState(false);
  const [genPhase, setGenPhase] = useState<
    "idle" | "planning" | "generating" | "awaiting_kickoff" | "done"
  >("idle");
  const [confirmedPrd, setConfirmedPrd] = useState<string>("");
  const [prdDraft, setPrdDraft] = useState("");
  const [prdChatHistory, setPrdChatHistory] = useState<PrdReviewChatMsg[]>([]);
  const [prdRefining, setPrdRefining] = useState(false);
  const [prdCommandFocused, setPrdCommandFocused] = useState(false);
  const prdBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prdRefinementEndRef = useRef<HTMLDivElement>(null);
  const [startGenNonce, setStartGenNonce] = useState(0);
  const [parallelGenBusy, setParallelGenBusy] = useState(false);
  const [parallelGenResults, setParallelGenResults] = useState<Record<
    string,
    ParallelDocResult
  > | null>(null);
  const [parallelGenLive, setParallelGenLive] =
    useState<ParallelGenLiveSnapshot | null>(null);
  const [selectedParallelDocIds, setSelectedParallelDocIds] = useState<
    PipelineStepId[]
  >([]);
  const [designStyleId, setDesignStyleId] =
    useState<DesignStyleId>(defaultDesignStyleId);
  const [styleReferenceImage, setStyleReferenceImage] = useState<string | null>(
    null,
  );
  const [prepDocChatHistory, setPrepDocChatHistory] = useState<
    PrepDocChatMsg[]
  >([]);
  /** False after a Design Spec is generated until the user explicitly confirms it (unlocks Pencil). */
  const [designSpecConfirmed, setDesignSpecConfirmed] = useState(true);
  /** False after Pencil output exists until the user confirms before kick-off. */
  const [pencilOutputConfirmed, setPencilOutputConfirmed] = useState(true);
  const lastRunBriefRef = useRef("");

  const activePhase: TopPhase = activeOverridePhase ?? phaseForStep(activeTab);
  const [prepSubTab, setPrepSubTab] = useState<PipelineStepId>("intent");

  const classification = (
    steps.intent?.metadata as Record<string, unknown> | undefined
  )?.classification as
    | {
        tier: string;
        type: string;
        needsBackend: boolean;
        needsDatabase: boolean;
        reasoning: string;
      }
    | undefined;
  const projectTier = (classification?.tier ?? "M") as ProjectTier;

  const visiblePrepTabs = useMemo(() => {
    const intentTab = PREP_STEPS[0];
    const prdTab = PREP_STEPS.find((s) => s.id === "prd")!;
    const tier = projectTier;

    if (fastFromPrd) {
      const out: typeof PREP_STEPS = [intentTab];
      if (steps.intent?.status === "completed" || steps.prd != null) {
        out.push(prdTab);
      }
      for (const id of parallelDocBlueprintsForTier(tier).map((b) => b.id)) {
        if (steps[id] != null || currentStep === id) {
          const m = PREP_STEPS.find((s) => s.id === id);
          if (m && !out.some((x) => x.id === m.id)) out.push(m);
        }
      }
      return out;
    }

    const out: typeof PREP_STEPS = [intentTab];
    const intentDone = steps.intent?.status === "completed";
    const prdReviewPending =
      steps.prd?.status === "completed" && !prdConfirmed && !isRunning;
    const showPrdTab =
      intentDone ||
      steps.prd != null ||
      currentStep === "prd" ||
      prdConfirmed ||
      genPhase !== "idle" ||
      prdReviewPending;

    if (showPrdTab) {
      out.push(prdTab);
    }

    if (prdConfirmed) {
      for (const id of selectedParallelDocIds) {
        const m = PREP_STEPS.find((s) => s.id === id);
        if (m && !out.some((x) => x.id === m.id)) out.push(m);
      }
    }

    return out;
  }, [
    fastFromPrd,
    projectTier,
    steps,
    currentStep,
    prdConfirmed,
    genPhase,
    selectedParallelDocIds,
    isRunning,
  ]);

  const visiblePrepTabIds = useMemo(
    () => new Set(visiblePrepTabs.map((t) => t.id)),
    [visiblePrepTabs],
  );

  const effectivePrepSub =
    activePhase === "preparation" && visiblePrepTabIds.has(activeTab)
      ? activeTab
      : prepSubTab;

  const handlePhaseClick = (phase: TopPhase) => {
    if (phase === "coding" || phase === "preview") {
      setActiveOverridePhase(phase);
      return;
    }
    setActiveOverridePhase(null);
    if (phase === "preparation") {
      setActiveTab(effectivePrepSub);
    } else {
      setActiveTab(stepIdForPhase(phase));
    }
  };

  const handlePrepSubClick = (stepId: PipelineStepId) => {
    setPrepSubTab(stepId);
    setActiveTab(stepId);
  };

  const { updateSteps, runKickoff } = usePipelineStore();

  const handleToggleParallelDoc = useCallback(
    (id: PipelineStepId) => {
      if (id === "pencil" && !designSpecConfirmed) return;
      setSelectedParallelDocIds((prev) => {
        const cls = usePipelineStore.getState().steps.intent?.metadata
          ?.classification as { tier?: ProjectTier } | undefined;
        const tier = (cls?.tier ?? "M") as ProjectTier;
        const order = parallelDocBlueprintsForTier(tier).map((b) => b.id);
        const sel = new Set(prev);
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
        return order.filter((x) => sel.has(x));
      });
    },
    [designSpecConfirmed],
  );

  const handlePrdConfirm = useCallback(
    (finalPrd: string) => {
      const cls = usePipelineStore.getState().steps.intent?.metadata
        ?.classification as { tier?: ProjectTier } | undefined;
      const t = (cls?.tier ?? "M") as ProjectTier;
      const quick = usePipelineStore.getState().fastFromPrd;
      setSelectedParallelDocIds(defaultSelectedParallelDocIds(t));
      setDesignStyleId(defaultDesignStyleId());
      setStyleReferenceImage(null);
      setPrepDocChatHistory([]);
      setDesignSpecConfirmed(true);
      setPencilOutputConfirmed(true);
      setPrdConfirmed(true);
      setConfirmedPrd(finalPrd);
      setGenPhase("planning");
      setStartGenNonce(0);
      setParallelGenResults(null);
      setParallelGenLive(null);
      const st = usePipelineStore.getState().steps;
      if (st.prd) {
        updateSteps({
          prd: { ...st.prd, content: finalPrd },
        });
      }
    },
    [updateSteps],
  );

  // When the PRD step is populated from an imported `.blueprint/PRD.md` file,
  // skip the review gate automatically — the user has already hand-authored
  // this PRD and does not need to re-approve it. Without this, the pipeline
  // appears "stuck" on the PRD review step after an imported run.
  useEffect(() => {
    const prd = steps.prd;
    if (!prd || prd.status !== "completed") return;
    if (prdConfirmed) return;
    if (isRunning || prdRefining) return;
    const source = (prd.metadata as { source?: string } | undefined)?.source;
    if (source !== "static-prd-file") return;
    const content = prd.content;
    if (!content || content.trim().length === 0) return;
    handlePrdConfirm(content);
  }, [steps.prd, prdConfirmed, isRunning, prdRefining, handlePrdConfirm]);

  const handlePrdRegenerate = useCallback(() => {
    setPrdConfirmed(false);
    setGenPhase("idle");
    setSelectedParallelDocIds([]);
    setPrdChatHistory([]);
    setPrepDocChatHistory([]);
    setStartGenNonce(0);
    setParallelGenResults(null);
    setParallelGenLive(null);
    const brief =
      lastRunBriefRef.current.trim() || "PRD-driven code generation.";
    startPipeline(brief);
  }, [startPipeline]);

  const handleParallelStreamFinished = useCallback(
    (results: Record<string, ParallelDocResult>) => {
      setParallelGenResults((prev) => ({ ...prev, ...results }));
      setGenPhase("awaiting_kickoff");
      if (results.design?.content?.trim()) {
        setDesignSpecConfirmed(false);
      }
      if (results.pencil?.content?.trim()) {
        setPencilOutputConfirmed(false);
      }
    },
    [],
  );

  const handleDocContentSaved = useCallback(
    (docId: string, newContent: string) => {
      setParallelGenResults((prev) => {
        if (!prev) return prev;
        const existing = prev[docId];
        if (!existing) return prev;
        return { ...prev, [docId]: { ...existing, content: newContent } };
      });
    },
    [],
  );

  const handleGenerationComplete = useCallback(
    (results: Record<string, ParallelDocResult>) => {
      if (!designSpecConfirmed || !pencilOutputConfirmed) {
        return;
      }
      setGenPhase("done");
      const stepUpdates: Partial<Record<PipelineStepId, StepResult>> = {};
      for (const [docId, result] of Object.entries(results)) {
        if (result.content) {
          const stepId = docId as PipelineStepId;
          stepUpdates[stepId] = {
            stepId,
            status: "completed",
            content: result.content,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            tokenUsage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: result.tokens,
            },
            model: "parallel-gen",
            timestamp: new Date().toISOString(),
            metadata: { source: "parallel-generation" },
          };
        }
      }
      const now = new Date().toISOString();
      if (!stepUpdates.pencil) {
        stepUpdates.pencil = {
          stepId: "pencil",
          status: "completed",
          content: "Pencil design was not selected.",
          timestamp: now,
          metadata: { skipped: true },
        };
      }
      if (!stepUpdates.mockup) {
        stepUpdates.mockup = {
          stepId: "mockup",
          status: "completed",
          content: "Mockup step disabled.",
          timestamp: now,
          metadata: { skipped: true },
        };
      }
      updateSteps(stepUpdates);
      setTimeout(() => {
        runKickoff();
      }, 300);
    },
    [updateSteps, runKickoff, designSpecConfirmed, pencilOutputConfirmed],
  );

  const handleSkipToKickoff = useCallback(async () => {
    if (isRunning) return;
    try {
      const resp = await fetch(
        `/api/agents/load-generated-docs?dir=${encodeURIComponent(codeOutputDir)}`,
      );
      if (!resp.ok) return;
      const { docs } = (await resp.json()) as { docs: Record<string, string> };
      const now = new Date().toISOString();
      const stepUpdates: Partial<Record<PipelineStepId, StepResult>> = {};
      stepUpdates.intent = {
        stepId: "intent",
        status: "completed",
        content: "Debug: skip to kickoff",
        timestamp: now,
        metadata: { source: "debug-skip" },
      };
      for (const [stepId, content] of Object.entries(docs)) {
        stepUpdates[stepId as PipelineStepId] = {
          stepId: stepId as PipelineStepId,
          status: "completed",
          content,
          timestamp: now,
          metadata: { source: "loaded-from-disk" },
        };
      }
      for (const stub of [
        "pencil",
        "mockup",
        "qa",
        "verify",
      ] as PipelineStepId[]) {
        if (!stepUpdates[stub]) {
          stepUpdates[stub] = {
            stepId: stub,
            status: "completed",
            content: `${stub} step skipped.`,
            timestamp: now,
          };
        }
      }
      updateSteps(stepUpdates);
      setTimeout(() => {
        runKickoff();
      }, 300);
    } catch (err) {
      console.error("Skip to kickoff failed:", err);
    }
  }, [isRunning, codeOutputDir, updateSteps, runKickoff]);

  const handleLoadSnapshot = useCallback(async () => {
    if (isRunning) return;
    try {
      const resp = await fetch("/api/agents/load-pipeline-snapshot");
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        console.error(
          "Load snapshot failed:",
          (err as { error?: string }).error,
        );
        return;
      }
      const { snapshot } = (await resp.json()) as {
        snapshot: {
          featureBrief: string;
          codeOutputDir: string;
          totalCostUsd: number;
          steps: Record<PipelineStepId, StepResult | null>;
        };
      };
      const stepUpdates: Partial<Record<PipelineStepId, StepResult>> = {};
      for (const [key, val] of Object.entries(snapshot.steps)) {
        if (val) stepUpdates[key as PipelineStepId] = val;
      }
      updateSteps(stepUpdates);
      if (snapshot.codeOutputDir) setCodeOutputDir(snapshot.codeOutputDir);
      setActiveTab("kickoff");
      setActiveOverridePhase(null);
    } catch (err) {
      console.error("Load snapshot failed:", err);
    }
  }, [isRunning, updateSteps, setCodeOutputDir, setActiveTab]);

  const handleDebugCodingAgents = useCallback(() => {
    if (isRunning || codingStatus === "running") return;
    const runId = `debug-coding-${Date.now()}`;
    setActiveOverridePhase("coding");
    startCoding(runId, DEBUG_SAMPLE_KICKOFF_TASKS, codeOutputDir);
  }, [isRunning, codingStatus, codeOutputDir, startCoding]);

  const handleDebugCodingCriticalIllness = useCallback(() => {
    if (isRunning || codingStatus === "running") return;
    const runId = `debug-coding-ci-${Date.now()}`;
    setActiveOverridePhase("coding");
    startCoding(runId, DEBUG_CRITICAL_ILLNESS_KICKOFF_TASKS, codeOutputDir);
  }, [isRunning, codingStatus, codeOutputDir, startCoding]);

  const handleDebugE2eVerify = useCallback(() => {
    if (isRunning || codingStatus === "running") return;
    const runId = `debug-e2e-${Date.now()}`;
    setActiveOverridePhase("coding");
    retryE2eVerify(runId, codeOutputDir, projectTier);
  }, [isRunning, codingStatus, codeOutputDir, projectTier, retryE2eVerify]);

  const displayedStepId: PipelineStepId =
    activePhase === "preparation" ? effectivePrepSub : activeTab;
  const activeResult: StepResult | null = steps[displayedStepId];

  const prdResult = steps.prd;
  const showPrdReview =
    displayedStepId === "prd" &&
    prdResult?.status === "completed" &&
    !prdConfirmed &&
    !isRunning;
  const showGenerationPlan =
    prdConfirmed &&
    (genPhase === "planning" ||
      genPhase === "generating" ||
      genPhase === "awaiting_kickoff") &&
    !isRunning;

  const showDocPlanWorkspace = showGenerationPlan;

  useEffect(() => {
    if (showPrdReview && prdResult?.content) {
      setPrdDraft(prdResult.content);
      setPrdChatHistory([]);
    }
  }, [showPrdReview, prdResult?.content]);

  useEffect(() => {
    if (!showPrdReview) setPrdCommandFocused(false);
  }, [showPrdReview]);

  useEffect(() => {
    return () => {
      if (prdBlurTimeoutRef.current) clearTimeout(prdBlurTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showPrdReview || (!prdCommandFocused && !prdRefining)) return;
    prdRefinementEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [showPrdReview, prdCommandFocused, prdRefining, prdChatHistory]);

  const handlePrdCommandFocus = useCallback(() => {
    if (prdBlurTimeoutRef.current) {
      clearTimeout(prdBlurTimeoutRef.current);
      prdBlurTimeoutRef.current = null;
    }
    setPrdCommandFocused(true);
  }, []);

  const handlePrdCommandBlur = useCallback(() => {
    prdBlurTimeoutRef.current = setTimeout(() => {
      setPrdCommandFocused(false);
      prdBlurTimeoutRef.current = null;
    }, 180);
  }, []);

  const showPrdRefinementStrip =
    showPrdReview && (prdCommandFocused || prdRefining);

  const kickoffTasks = steps.kickoff
    ? parseKickoffTaskBreakdownFromMetadata(steps.kickoff.metadata)
    : [];
  const kickoffTasksConfirmed = isKickoffTaskBreakdownConfirmed(
    steps.kickoff?.metadata as Record<string, unknown> | undefined,
  );
  const kickoffAwaitingCodingContinue =
    displayedStepId === "kickoff" &&
    steps.kickoff?.status === "completed" &&
    !activeOverridePhase &&
    codingStatus === "idle" &&
    kickoffTasks.length > 0 &&
    kickoffTasksConfirmed;

  const commandBarGateActive =
    showPrdReview || showGenerationPlan || kickoffAwaitingCodingContinue;

  const processCommandBarInput = useCallback(
    async (rawInput: string) => {
      const raw = rawInput.trim();
      const { steps: st, isRunning: running } = usePipelineStore.getState();

      if (
        displayedStepId === "kickoff" &&
        st.kickoff?.status === "completed" &&
        !activeOverridePhase &&
        codingStatus === "idle"
      ) {
        const tasks = parseKickoffTaskBreakdownFromMetadata(
          st.kickoff?.metadata,
        );
        if (tasks.length > 0) {
          const confirmed = isKickoffTaskBreakdownConfirmed(
            st.kickoff?.metadata as Record<string, unknown> | undefined,
          );
          if (!confirmed) return;
          if (!isContinueCommand(raw)) return;
          const runId =
            typeof st.kickoff.metadata?.runId === "string"
              ? st.kickoff.metadata.runId
              : "run-" + Date.now();
          startCoding(
            runId,
            tasks,
            codeOutputDir,
            undefined,
            steps.prd?.content,
          );
          setActiveOverridePhase("coding");
          setFeatureBrief("");
          return;
        }
      }

      if (showPrdReview) {
        if (prdRefining) return;
        if (!raw) return;
        if (isContinueCommand(raw)) {
          handlePrdConfirm(prdDraft);
          setFeatureBrief("");
          return;
        }
        if (isRegenerateCommand(raw)) {
          handlePrdRegenerate();
          setFeatureBrief("");
          return;
        }
        setPrdRefining(true);
        try {
          const resp = await fetch("/api/agents/prd-refine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currentPrd: prdDraft,
              userMessage: raw,
              chatHistory: prdChatHistory,
            }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(
              (err as { error?: string }).error || "Refinement failed",
            );
          }
          const data = await resp.json();
          const assistantMsg: PrdReviewChatMsg = {
            role: "assistant",
            content: `PRD updated. (${data.usage?.totalTokens?.toLocaleString() ?? "?"} tokens, $${data.costUsd?.toFixed(4) ?? "?"})`,
          };
          setPrdChatHistory((h) => [
            ...h,
            { role: "user", content: raw },
            assistantMsg,
          ]);
          setPrdDraft(data.updatedPrd as string);
        } catch (err) {
          setPrdChatHistory((h) => [
            ...h,
            { role: "user", content: raw },
            {
              role: "assistant",
              content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ]);
        } finally {
          setPrdRefining(false);
        }
        setFeatureBrief("");
        return;
      }

      if (showGenerationPlan) {
        if (parallelGenBusy || prdRefining) return;
        if (genPhase === "planning") {
          if (!isContinueCommand(raw)) return;
          setStartGenNonce((n) => n + 1);
          setGenPhase("generating");
          setFeatureBrief("");
          return;
        }
        if (genPhase === "awaiting_kickoff") {
          if (!parallelGenResults || !isContinueCommand(raw)) return;
          handleGenerationComplete(parallelGenResults);
          setParallelGenResults(null);
          setFeatureBrief("");
          return;
        }
        if (genPhase === "generating") {
          return;
        }
        return;
      }

      if (running) return;
      setPrdConfirmed(false);
      setGenPhase("idle");
      setConfirmedPrd("");
      setSelectedParallelDocIds([]);
      setPrdChatHistory([]);
      setStartGenNonce(0);
      setParallelGenResults(null);
      const brief = raw || "PRD-driven code generation.";
      lastRunBriefRef.current = brief;
      startPipeline(brief);
    },
    [
      displayedStepId,
      activeOverridePhase,
      codingStatus,
      codeOutputDir,
      startCoding,
      showPrdReview,
      prdRefining,
      prdDraft,
      prdChatHistory,
      handlePrdConfirm,
      handlePrdRegenerate,
      showGenerationPlan,
      parallelGenBusy,
      genPhase,
      parallelGenResults,
      handleGenerationComplete,
      startPipeline,
    ],
  );

  const handleCommandSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await processCommandBarInput(featureBrief);
    },
    [featureBrief, processCommandBarInput],
  );

  const totalTokens = Object.values(steps).reduce(
    (sum, s) => sum + (s?.tokenUsage?.totalTokens ?? 0),
    0,
  );

  const kickoffBlockedByConfirmations =
    !designSpecConfirmed || !pencilOutputConfirmed;

  const currentStageModel = useMemo(() => {
    if (activePhase === "coding") {
      if (codingStatus === "idle") return null;
      return {
        label: "Coding",
        model: resolveModel(primaryModel(MODEL_CONFIG.codeGen)),
        status:
          codingStatus === "running"
            ? "running"
            : codingStatus === "completed"
              ? "completed"
              : codingStatus === "failed"
                ? "failed"
                : "idle",
      };
    }

    if (activePhase === "kickoff") {
      const result = steps.kickoff;
      if (!result && currentStep !== "kickoff") return null;
      return {
        label: "Kick-off",
        model: displayModelLabelForStep("kickoff", result),
        status:
          result?.status ?? (currentStep === "kickoff" ? "running" : "idle"),
      };
    }

    const stepId = effectivePrepSub;
    const result = steps[stepId];
    if (!result && currentStep !== stepId) return null;
    const stepLabel =
      visiblePrepTabs.find((sub) => sub.id === stepId)?.label ?? stepId;
    return {
      label: stepLabel,
      model: displayModelLabelForStep(stepId, result),
      status: result?.status ?? (currentStep === stepId ? "running" : "idle"),
    };
  }, [
    activePhase,
    codingStatus,
    currentStep,
    effectivePrepSub,
    steps,
    visiblePrepTabs,
  ]);

  useEffect(() => {
    if (activePhase !== "preparation") return;
    const allowed = new Set(visiblePrepTabs.map((t) => t.id));
    if (!allowed.has(activeTab)) {
      const preferPrd =
        allowed.has("prd") &&
        steps.prd?.status === "completed" &&
        !prdConfirmed &&
        !isRunning;
      const next = preferPrd ? "prd" : (visiblePrepTabs[0]?.id ?? "intent");
      setActiveTab(next);
      setPrepSubTab(next);
    }
  }, [
    activePhase,
    activeTab,
    visiblePrepTabs,
    steps.prd?.status,
    prdConfirmed,
    isRunning,
    setActiveTab,
  ]);

  function phaseStatus(
    phase: TopPhase,
  ): "idle" | "running" | "completed" | "failed" {
    if (phase === "preview") {
      if (codingStatus === "completed") return "completed";
      return "idle";
    }
    if (phase === "coding") {
      if (codingStatus === "running") return "running";
      if (codingStatus === "completed") return "completed";
      if (codingStatus === "failed") return "failed";
      return "idle";
    }
    if (phase === "kickoff") {
      const s = steps.kickoff;
      if (!s) return "idle";
      return s.status === "running"
        ? "running"
        : s.status === "completed"
          ? "completed"
          : s.status === "failed"
            ? "failed"
            : "idle";
    }
    const prepResults = visiblePrepTabs.map((s) => steps[s.id]);
    if (prepResults.some((r) => r?.status === "failed")) return "failed";
    if (prepResults.some((r) => r?.status === "running")) return "running";
    if (
      prepResults.length > 0 &&
      prepResults.every((r) => r?.status === "completed")
    ) {
      return "completed";
    }
    if (prepResults.some((r) => r !== null)) return "running";
    return "idle";
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-white">
      {/* ─── Top Bar (Pencil-aligned: brand + phase pills + meta) ─── */}
      <header className="flex h-[72px] flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900">
            <span className="text-[11px] font-bold text-white">B</span>
          </div>
          <span className="text-[17px] font-semibold tracking-tight text-zinc-900">
            Blueprint
          </span>
          <div className="mx-1 hidden h-6 w-px bg-zinc-200 sm:block" />
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {TOP_PHASES.map((phase) => {
              const status = phaseStatus(phase.id);
              const isActive = activePhase === phase.id;
              return (
                <button
                  key={phase.id}
                  type="button"
                  onClick={() => handlePhaseClick(phase.id)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200/90"
                      : status === "completed"
                        ? "bg-zinc-100 text-zinc-600 hover:text-zinc-800"
                        : "bg-zinc-50/90 text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  <PhaseDot status={status} pillActive={isActive} />
                  {phase.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-2.5">
          {currentStageModel && (
            <div
              className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1 sm:flex ${
                activePhase === "kickoff" &&
                steps.kickoff?.status === "completed"
                  ? "border-emerald-200 bg-emerald-50/80"
                  : "border-zinc-200 bg-white"
              }`}
            >
              <SubStepDot status={currentStageModel.status} />
              <span className="text-[11px] font-medium text-zinc-600">
                {currentStageModel.label}
              </span>
              <span className="max-w-[140px] truncate font-mono text-[11px] text-zinc-800">
                {currentStageModel.model}
              </span>
            </div>
          )}
          <MetaBadge
            label="$"
            value={totalCostUsd.toFixed(4)}
            valueClass="text-emerald-600"
          />
          {totalTokens > 0 && (
            <MetaBadge icon="zap" value={totalTokens.toLocaleString("en-US")} />
          )}
          <MetaBadge
            icon="folder"
            value={codeOutputDir}
            editable
            onEdit={setCodeOutputDir}
            disabled={isRunning}
          />
        </div>
      </header>

      {/* ─── Sub-step bar (Preparation only) ─── */}
      {activePhase === "preparation" && (
        <div className="flex h-12 flex-shrink-0 items-stretch gap-1 border-b border-zinc-200 bg-zinc-50/90 px-6 lg:px-8">
          {visiblePrepTabs.map((sub) => {
            const isActive = effectivePrepSub === sub.id;
            const subResult = steps[sub.id];
            const subStatus = subResult?.status;
            const dotKind = resolvePrepSubTabDot(sub.id, {
              steps,
              parallelGenLive,
              genPhase,
              selectedParallelDocIds,
            });
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => handlePrepSubClick(sub.id)}
                className={`relative flex items-center gap-1.5 px-3 text-[12px] font-medium transition-colors ${
                  isActive
                    ? "text-zinc-900"
                    : subStatus
                      ? "text-zinc-500 hover:text-zinc-800"
                      : "text-zinc-400 hover:text-zinc-600"
                }`}
              >
                <PrepSubTabIndicator kind={dotKind} />
                {sub.label}
                {isActive && (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-indigo-500" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Main Content ─── */}
      <div
        className={`flex-1 overflow-y-auto ${activePhase === "coding" || activePhase === "preview" ? "" : "bg-zinc-50/50 px-6 py-6 lg:px-10 lg:py-8"} [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-200 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5`}
      >
        {activePhase === "preview" ? (
          <PreviewPanel codeOutputDir={codeOutputDir} />
        ) : activePhase === "coding" ? (
          <CodingAgentGraph />
        ) : showPrdReview ? (
          <PrdReviewPanel
            currentPrd={prdDraft}
            classification={classification}
          />
        ) : showGenerationPlan ? (
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6">
            {showDocPlanWorkspace && (
              <>
                {prepDocChatHistory.length > 0 && genPhase === "planning" && (
                  <PrepStyleChatTranscript messages={prepDocChatHistory} />
                )}
                <GenerationPlanPanel
                  tier={projectTier}
                  prdContent={confirmedPrd || prdResult?.content || ""}
                  sessionId={steps.intent?.timestamp ?? "session"}
                  selectedParallelDocIds={selectedParallelDocIds}
                  onToggleParallelDoc={handleToggleParallelDoc}
                  startGenerationNonce={startGenNonce}
                  onBusyChange={setParallelGenBusy}
                  onGenerationStreamFinished={handleParallelStreamFinished}
                  prdMetadata={
                    prdResult?.metadata as Record<string, unknown> | undefined
                  }
                  codeOutputDir={codeOutputDir}
                  showPlanTable={genPhase === "planning"}
                  showProgressList={false}
                  showPrdSpecSection={false}
                  onParallelStateChange={setParallelGenLive}
                  designStyleId={designStyleId}
                  onDesignStyleChange={setDesignStyleId}
                  allowPencilSelection={designSpecConfirmed}
                  mergedDesignSpecForPencil={
                    parallelGenResults?.design?.content ?? null
                  }
                  styleReferenceImage={styleReferenceImage}
                  onStyleReferenceImageChange={setStyleReferenceImage}
                />
              </>
            )}
            {/* After generation starts: show per-tab content, no plan table */}
            {(genPhase === "generating" || genPhase === "awaiting_kickoff") && (
              <>
                {parallelGenLive &&
                  (parallelGenLive.panelStatus === "generating" ||
                    parallelGenLive.panelStatus === "completed") && (
                    <ParallelGenSummaryStrip live={parallelGenLive} />
                  )}
                <ParallelGenerationTabBody
                  stepId={effectivePrepSub}
                  live={parallelGenLive}
                  fallbackResults={parallelGenResults}
                  confirmedPrd={confirmedPrd}
                  prdResult={prdResult}
                  steps={steps}
                  selectedParallelDocIds={selectedParallelDocIds}
                  codeOutputDir={codeOutputDir}
                  onDocContentSaved={handleDocContentSaved}
                  designStyleId={designStyleId}
                />
              </>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={displayedStepId}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {activeResult?.status === "running" &&
              displayedStepId === "prd" &&
              (streamingContent || streamingThinking) ? (
                <PrdStreamingPanel
                  thinking={streamingThinking}
                  content={streamingContent}
                />
              ) : activeResult?.status === "running" ? (
                <RunningState stepId={displayedStepId} />
              ) : null}
              {activeResult?.status === "completed" &&
                displayedStepId === "kickoff" && (
                  <KickoffStepPanel
                    result={activeResult}
                    onStartCoding={() => setActiveOverridePhase("coding")}
                    commandBarStartsCoding
                  />
                )}
              {activeResult?.status === "completed" &&
                displayedStepId !== "kickoff" && (
                  <CompletedStepContent result={activeResult} />
                )}
              {activeResult?.status === "failed" && (
                <FailedState result={activeResult} />
              )}
              {!activeResult && !isRunning && <EmptyState />}
              {!activeResult && isRunning && (
                <div className="flex h-full min-h-[300px] items-center justify-center">
                  <Loading size="lg" text="Waiting for this step..." />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* ─── Bottom Command Bar ─── */}
      {activePhase !== "coding" && activePhase !== "preview" && (
        <div className="flex flex-shrink-0 flex-col items-center gap-2.5 border-t border-zinc-200 px-6 pb-5 pt-3">
          {importedPrd?.exists && (
            <div className="flex w-full max-w-[760px] items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11.5px] text-emerald-800">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="truncate">
                  Using imported PRD — PM generation will be skipped on the next
                  run
                  {importedPrd.updatedAt
                    ? ` (updated ${new Date(importedPrd.updatedAt).toLocaleString()})`
                    : ""}
                  .
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setImportDialogOpen(true)}
                  className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                >
                  View / Edit
                </button>
                <button
                  type="button"
                  onClick={() => void clearImportedPrd()}
                  className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          {designReferences.length > 0 && (
            <div className="flex w-full max-w-[760px] items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[11.5px] text-indigo-800">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                <span className="truncate">
                  {designReferences.length} design reference
                  {designReferences.length === 1 ? "" : "s"} attached — will be
                  copied to{" "}
                  <code className="font-mono">.design-references/</code> and
                  injected into code-gen context.
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDesignReferencesDialogOpen(true)}
                  className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-50"
                >
                  View / Edit
                </button>
                <button
                  type="button"
                  onClick={() => void clearDesignReferences()}
                  className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          <form
            onSubmit={handleCommandSubmit}
            className={`flex w-full max-w-[760px] gap-2.5 ${showPrdReview ? "items-end" : "items-center"}`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {(showPrdReview ||
                (showGenerationPlan &&
                  (genPhase === "planning" ||
                    genPhase === "awaiting_kickoff")) ||
                kickoffAwaitingCodingContinue) && (
                <div className="flex w-full max-w-[680px] flex-wrap items-center gap-2">
                  {showPrdReview && (
                    <>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 28,
                        }}
                        disabled={isRunning || prdRefining || parallelGenBusy}
                        onClick={() => void processCommandBarInput("continue")}
                        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Approve &amp; continue
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 28,
                        }}
                        disabled={isRunning || prdRefining || parallelGenBusy}
                        onClick={() =>
                          void processCommandBarInput("regenerate")
                        }
                        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-xs font-semibold text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Regenerate PRD
                      </motion.button>
                    </>
                  )}
                  {showGenerationPlan && genPhase === "planning" && (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 28,
                      }}
                      disabled={parallelGenBusy || prdRefining}
                      onClick={() => void processCommandBarInput("continue")}
                      className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Generate documents
                    </motion.button>
                  )}
                  {showGenerationPlan && genPhase === "awaiting_kickoff" && (
                    <>
                      {parallelGenResults?.design?.content &&
                        !designSpecConfirmed && (
                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            transition={{
                              type: "spring",
                              stiffness: 420,
                              damping: 28,
                            }}
                            disabled={parallelGenBusy || prdRefining}
                            onClick={() => setDesignSpecConfirmed(true)}
                            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-950 shadow-sm transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Confirm Design Spec
                          </motion.button>
                        )}
                      {parallelGenResults?.pencil?.content &&
                        !pencilOutputConfirmed && (
                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            transition={{
                              type: "spring",
                              stiffness: 420,
                              damping: 28,
                            }}
                            disabled={parallelGenBusy || prdRefining}
                            onClick={() => setPencilOutputConfirmed(true)}
                            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2.5 text-xs font-semibold text-indigo-950 shadow-sm transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Confirm Pencil output
                          </motion.button>
                        )}
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 28,
                        }}
                        disabled={
                          !parallelGenResults ||
                          parallelGenBusy ||
                          prdRefining ||
                          kickoffBlockedByConfirmations
                        }
                        onClick={() => void processCommandBarInput("continue")}
                        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Run kick-off
                      </motion.button>
                    </>
                  )}
                  {kickoffAwaitingCodingContinue && (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 28,
                      }}
                      disabled={isRunning}
                      onClick={() => void processCommandBarInput("continue")}
                      className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Start coding
                    </motion.button>
                  )}
                </div>
              )}

              {showPrdReview ? (
                <div className="w-full max-w-[680px] overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm">
                  <AnimatePresence initial={false}>
                    {showPrdRefinementStrip && (
                      <motion.div
                        key="prd-refinement"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden border-b border-zinc-200 bg-zinc-50"
                      >
                        <div
                          role="region"
                          aria-label="Refinement thread"
                          className="max-h-[min(240px,32vh)] overflow-y-auto px-3 py-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400 [&::-webkit-scrollbar-track]:bg-zinc-100 [&::-webkit-scrollbar]:w-1.5"
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                            Refinement
                          </p>
                          {prdChatHistory.length === 0 && !prdRefining && (
                            <p className="text-center text-[11px] text-zinc-400">
                              Optional: describe edits below, or use Approve
                              &amp; continue.
                            </p>
                          )}
                          <AnimatePresence>
                            {prdChatHistory.map((msg, i) => (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.15 }}
                                className={`mb-2 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                              >
                                <div
                                  className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] leading-snug ${
                                    msg.role === "user"
                                      ? "bg-zinc-900 text-white"
                                      : "border border-zinc-200 bg-white text-zinc-700"
                                  }`}
                                >
                                  {msg.content}
                                </div>
                              </motion.div>
                            ))}
                          </AnimatePresence>
                          {prdRefining && (
                            <div className="flex justify-start pb-1">
                              <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5">
                                <Loading size="sm" text="Updating PRD..." />
                              </div>
                            </div>
                          )}
                          <div ref={prdRefinementEndRef} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="flex w-full min-w-0 items-center justify-between gap-3 pl-3.5 pr-2.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        type="text"
                        value={featureBrief}
                        onChange={(e) => setFeatureBrief(e.target.value)}
                        onFocus={handlePrdCommandFocus}
                        onBlur={handlePrdCommandBlur}
                        placeholder="Refinement notes (optional)…"
                        disabled={isRunning || prdRefining || parallelGenBusy}
                        className="h-[46px] min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-50"
                      />
                      <label
                        className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-zinc-400 ${commandBarGateActive ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
                      >
                        <input
                          type="checkbox"
                          checked={fastFromPrd}
                          onChange={(e) => setFastFromPrd(e.target.checked)}
                          disabled={isRunning || commandBarGateActive}
                          className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-700 focus:ring-zinc-500"
                        />
                        Quick
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={isRunning || prdRefining || parallelGenBusy}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-[18px] py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {prdRefining ? "Wait..." : "Send"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex w-full flex-1 items-center gap-2.5 rounded-[10px] border border-zinc-200 bg-white px-3.5 py-0 shadow-sm">
                  <input
                    type="text"
                    value={featureBrief}
                    onChange={(e) => setFeatureBrief(e.target.value)}
                    placeholder={
                      showGenerationPlan && genPhase === "planning"
                        ? "Or use Generate documents above…"
                        : showGenerationPlan && genPhase === "generating"
                          ? "Generation in progress..."
                          : showGenerationPlan &&
                              genPhase === "awaiting_kickoff"
                            ? "Or use Run kick-off above…"
                            : kickoffAwaitingCodingContinue
                              ? "Or use Start coding above…"
                              : "Describe a feature to build..."
                    }
                    disabled={
                      isRunning ||
                      prdRefining ||
                      parallelGenBusy ||
                      (showGenerationPlan && genPhase === "generating")
                    }
                    className="h-[46px] flex-1 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-50"
                  />
                  <label
                    className={`flex items-center gap-1.5 whitespace-nowrap text-[11px] text-zinc-400 ${commandBarGateActive ? "pointer-events-none opacity-40" : "cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      checked={fastFromPrd}
                      onChange={(e) => setFastFromPrd(e.target.checked)}
                      disabled={isRunning || commandBarGateActive}
                      className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-700 focus:ring-zinc-500"
                    />
                    Quick
                  </label>
                  <button
                    type="submit"
                    disabled={
                      isRunning ||
                      prdRefining ||
                      parallelGenBusy ||
                      (showGenerationPlan && genPhase === "generating")
                    }
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-[18px] py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    {commandBarGateActive
                      ? prdRefining ||
                        parallelGenBusy ||
                        (showGenerationPlan && genPhase === "generating")
                        ? "Wait..."
                        : "Send"
                      : isRunning
                        ? "Running..."
                        : "Run"}
                  </button>
                </div>
              )}
            </div>
            {Object.values(steps).some((s) => s !== null) && (
              <button
                type="button"
                onClick={() => {
                  reset();
                  setPrdConfirmed(false);
                  setGenPhase("idle");
                  setConfirmedPrd("");
                  setSelectedParallelDocIds([]);
                  setPrdChatHistory([]);
                  setPrdDraft("");
                  setStartGenNonce(0);
                  setParallelGenResults(null);
                  setParallelGenLive(null);
                  setParallelGenBusy(false);
                }}
                disabled={isRunning}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                Reset
              </button>
            )}
          </form>

          {/* Debug shortcuts */}
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-400">
            <button
              type="button"
              onClick={() => setImportDialogOpen(true)}
              disabled={isRunning}
              className={`flex items-center gap-1 transition-colors disabled:opacity-40 ${
                importedPrd?.exists
                  ? "text-emerald-600 hover:text-emerald-700"
                  : "hover:text-zinc-600"
              }`}
              title="Import an existing PRD to skip the PM step"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <polyline points="9 15 12 12 15 15" />
              </svg>
              {importedPrd?.exists ? "Imported PRD (active)" : "Import PRD"}
            </button>
            <span className="text-zinc-200">&middot;</span>
            <button
              type="button"
              onClick={() => setDesignReferencesDialogOpen(true)}
              disabled={isRunning}
              className={`flex items-center gap-1 transition-colors disabled:opacity-40 ${
                designReferences.length > 0
                  ? "text-indigo-600 hover:text-indigo-700"
                  : "hover:text-zinc-600"
              }`}
              title="Upload screenshots that coding agents will use as visual references"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              {designReferences.length > 0
                ? `Design refs (${designReferences.length})`
                : "Design refs"}
            </button>
            <span className="text-zinc-200">&middot;</span>
            <button
              type="button"
              onClick={handleLoadSnapshot}
              disabled={isRunning}
              className="flex items-center gap-1 transition-colors hover:text-emerald-600 disabled:opacity-40"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Load Snapshot
            </button>
            <span className="text-zinc-200">&middot;</span>
            <button
              type="button"
              onClick={handleSkipToKickoff}
              disabled={isRunning}
              className="flex items-center gap-1 transition-colors hover:text-zinc-600 disabled:opacity-40"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              Skip to Kick-off
            </button>
            <span className="text-zinc-200">&middot;</span>
            <button
              type="button"
              onClick={handleDebugCodingAgents}
              disabled={isRunning || codingStatus === "running"}
              className="flex items-center gap-1 transition-colors hover:text-zinc-600 disabled:opacity-40"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M16 18l2 2 4-4" />
                <path d="M21 12V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
              </svg>
              Debug Coding
            </button>
            <span className="text-zinc-200">&middot;</span>
            <button
              type="button"
              onClick={handleDebugCodingCriticalIllness}
              disabled={isRunning || codingStatus === "running"}
              className="flex items-center gap-1 transition-colors hover:text-zinc-600 disabled:opacity-40"
              title="23 tasks: critical illness portal (separate from minimal debug sample)"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Debug Coding · Critical Illness
            </button>
            <span className="text-zinc-200">&middot;</span>
            <button
              type="button"
              onClick={handleDebugE2eVerify}
              disabled={isRunning || codingStatus === "running"}
              className="flex items-center gap-1 text-purple-400 transition-colors hover:text-purple-600 disabled:opacity-40"
              title={`Skip coding — run E2E verify directly against ${codeOutputDir}`}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Debug E2E Verify
            </button>
          </div>

          {error && (
            <div className="w-full max-w-[680px] rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
        </div>
      )}

      <ImportPrdDialog
        isOpen={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
      />
      <DesignReferencesDialog
        isOpen={designReferencesDialogOpen}
        onClose={() => setDesignReferencesDialogOpen(false)}
      />
    </div>
  );
}

/* ─── Parallel generation: prep tab dot + tab bodies ─── */

type PrepTabDotKind =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "generating";

function resolvePrepSubTabDot(
  stepId: PipelineStepId,
  ctx: {
    steps: Record<PipelineStepId, StepResult | null>;
    parallelGenLive: ParallelGenLiveSnapshot | null;
    genPhase: "idle" | "planning" | "generating" | "awaiting_kickoff" | "done";
    selectedParallelDocIds: PipelineStepId[];
  },
): PrepTabDotKind {
  const { steps, parallelGenLive, genPhase, selectedParallelDocIds } = ctx;
  const r = steps[stepId];

  if (
    (genPhase === "generating" || genPhase === "awaiting_kickoff") &&
    selectedParallelDocIds.includes(stepId)
  ) {
    const st = parallelGenLive?.docStatuses[stepId];
    if (st === "generating") return "generating";
    if (st === "completed") return "completed";
    if (st === "error") return "failed";
    if (st === "pending") return "idle";
  }

  if (r?.status === "running") return "running";
  if (r?.status === "completed") return "completed";
  if (r?.status === "failed") return "failed";
  return "idle";
}

function PrepSubTabIndicator({ kind }: { kind: PrepTabDotKind }) {
  if (kind === "generating") {
    return (
      <span
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center"
        aria-hidden
      >
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
      </span>
    );
  }
  if (kind === "completed") {
    return (
      <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-emerald-500" />
    );
  }
  if (kind === "running") {
    return (
      <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-zinc-900 animate-pulse" />
    );
  }
  if (kind === "failed") {
    return (
      <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-red-500" />
    );
  }
  return <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-zinc-300" />;
}

function ParallelGenSummaryStrip({ live }: { live: ParallelGenLiveSnapshot }) {
  const done = Object.values(live.docStatuses).filter(
    (s) => s === "completed",
  ).length;
  const total = Object.keys(live.docStatuses).length;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200/90 bg-white px-4 py-3 text-[12px] text-zinc-600 shadow-sm">
      <span className="font-semibold text-zinc-800">
        {live.panelStatus === "generating"
          ? "Generating documents"
          : "Generation complete"}
      </span>
      {total > 0 && (
        <span className="tabular-nums">
          {done}/{total} documents
        </span>
      )}
      {live.totalTokens > 0 && (
        <span className="tabular-nums">
          {live.totalTokens?.toLocaleString()} tokens
        </span>
      )}
      {live.totalCostUsd > 0 && (
        <span className="tabular-nums text-emerald-700">
          ${live.totalCostUsd.toFixed(4)}
        </span>
      )}
    </div>
  );
}

const PARALLEL_TAB_LABELS: Partial<Record<PipelineStepId, string>> = {
  trd: "TRD",
  sysdesign: "System Design",
  implguide: "Implementation Guide",
  design: "Design Spec",
  pencil: "Pencil Design",
  qa: "QA Test Cases",
  verify: "Verification",
};

function ParallelGenerationTabBody({
  stepId,
  live,
  fallbackResults,
  confirmedPrd,
  prdResult,
  steps,
  selectedParallelDocIds,
  codeOutputDir,
  onDocContentSaved,
  designStyleId,
}: {
  stepId: PipelineStepId;
  live: ParallelGenLiveSnapshot | null;
  fallbackResults: Record<string, ParallelDocResult> | null;
  confirmedPrd: string;
  prdResult: StepResult | null;
  steps: Record<PipelineStepId, StepResult | null>;
  selectedParallelDocIds: PipelineStepId[];
  codeOutputDir?: string;
  onDocContentSaved?: (docId: string, newContent: string) => void;
  designStyleId: DesignStyleId;
}) {
  const resultFor = (id: PipelineStepId): ParallelDocResult | undefined =>
    live?.docResults[id] ?? fallbackResults?.[id];

  if (stepId === "intent") {
    const r = steps.intent;
    if (!r) {
      return <p className="text-[13px] text-zinc-500">No intent result yet.</p>;
    }
    if (r.status === "completed") {
      return <CompletedStepContent result={r} />;
    }
    return <RunningState stepId="intent" />;
  }

  if (stepId === "prd") {
    const { prdSpec } = parsePrdStepMetadata(prdResult?.metadata);
    const md = confirmedPrd || prdResult?.content || "";
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]">
          <h2 className="text-[18px] font-semibold tracking-tight text-zinc-900">
            PRD
          </h2>
          <div className="prose prose-sm prose-zinc mt-4 max-w-none">
            <MarkdownRenderer content={md} />
          </div>
        </div>
        <PrdSpecWireframesSection
          prdSpec={prdSpec}
          intro="Structured spec extracted from the PRD. Switch tabs to follow TRD, Design, and other parallel outputs."
        />
        {live?.panelStatus === "generating" && (
          <p className="text-[12px] text-zinc-500">
            Parallel documents are generating — follow progress on each tab.
          </p>
        )}
      </div>
    );
  }

  if (!selectedParallelDocIds.includes(stepId)) {
    return (
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-7 text-[13px] text-zinc-500 shadow-sm">
        {PARALLEL_TAB_LABELS[stepId] ?? stepId} was not included in this run.
        Toggle it in the Generation Plan on the Intent tab before starting.
      </div>
    );
  }

  const label = PARALLEL_TAB_LABELS[stepId] ?? stepId;
  const st = live?.docStatuses[stepId];
  const res = resultFor(stepId);

  if (st === "generating") {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-4">
        <Loading
          size="md"
          text={
            stepId === "pencil"
              ? "Drawing Pencil design…"
              : `Generating ${label}…`
          }
        />
        {res?.progressLog && res.progressLog.length > 0 && (
          <div className="max-h-36 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
            {res.progressLog.slice(-16).map((line, i) => (
              <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (st === "pending" && live?.panelStatus === "generating") {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loading size="md" text={`Waiting in queue · ${label}`} />
      </div>
    );
  }

  if (st === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/80 p-6 text-[13px] text-red-800">
        {res?.error ?? "Generation failed."}
      </div>
    );
  }

  if (st === "completed" && res?.content) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 text-[11px] text-zinc-500 px-1">
          {res.tokens > 0 && (
            <span className="tabular-nums">
              {res.tokens?.toLocaleString()} tok
            </span>
          )}
          {res.costUsd !== undefined && res.costUsd > 0 && (
            <span className="tabular-nums text-emerald-700">
              ${res.costUsd.toFixed(4)}
            </span>
          )}
          {res.durationMs !== undefined && res.durationMs > 0 && (
            <span className="tabular-nums">
              {(res.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        <DocReviewPanel
          docId={stepId}
          docLabel={label}
          content={res.content}
          codeOutputDir={codeOutputDir}
          onContentSaved={onDocContentSaved}
        />
        {stepId === "pencil" && (
          <PencilEditPanel
            content={res.content}
            codeOutputDir={codeOutputDir}
            prdContent={confirmedPrd}
            designStyleId={designStyleId}
          />
        )}
        {res.artifactUrls && res.artifactUrls.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-[12px] text-zinc-700">
            <p className="font-semibold text-zinc-900">Artifacts</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {res.artifactUrls.map((u) => (
                <li key={u}>
                  <a
                    href={u}
                    className="text-indigo-600 underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {u}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (st === "completed" && !res?.content && res?.progressLog?.length) {
    return (
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-7">
        <MarkdownRenderer
          content={["# Output", "", ...(res.progressLog ?? [])].join("\n")}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <Loading size="md" text={`Loading ${label}…`} />
    </div>
  );
}

/* ─── Phase dot in top bar (active pill = indigo; else status colors) ─── */
function PhaseDot({
  status,
  pillActive,
}: {
  status: string;
  pillActive?: boolean;
}) {
  const dot = (cls: string) => (
    <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />
  );
  if (pillActive) {
    if (status === "running") return dot("animate-pulse bg-indigo-500");
    if (status === "failed") return dot("bg-red-500");
    return dot("bg-indigo-500");
  }
  if (status === "running") return dot("animate-pulse bg-zinc-900");
  if (status === "completed") return dot("bg-emerald-500");
  if (status === "failed") return dot("bg-red-500");
  return dot("bg-zinc-300");
}

function displayModelLabelForStep(
  stepId: PipelineStepId,
  result: StepResult | null,
): string {
  const raw = result?.model?.trim();
  if (raw) {
    if (raw.startsWith("static:")) return "Static file";
    if (raw.startsWith("skipped:")) return "Skipped";
    if (raw === "parallel-gen") return "Parallel generation";
    if (raw === "kickoff") {
      return "filesystem + task-breakdown";
    }
    return raw;
  }

  const planned: Record<PipelineStepId, string> = {
    intent: resolveModel(MODEL_CONFIG.intent),
    prd: resolveModel(MODEL_CONFIG.prd),
    trd: resolveModel(MODEL_CONFIG.trd),
    sysdesign: resolveModel(MODEL_CONFIG.sysdesign),
    implguide: resolveModel(MODEL_CONFIG.implguide),
    design: resolveModel(MODEL_CONFIG.design),
    pencil: resolveModel(MODEL_CONFIG.pencil),
    mockup: "Disabled",
    qa: resolveModel(MODEL_CONFIG.qa),
    verify: resolveModel(MODEL_CONFIG.verify),
    kickoff: "filesystem + task-breakdown",
  };

  return planned[stepId];
}

/* ─── Sub-step dot ─── */
function SubStepDot({ status }: { status?: string }) {
  if (status === "running")
    return (
      <span className="h-[5px] w-[5px] rounded-full bg-zinc-900 animate-pulse" />
    );
  if (status === "completed")
    return <span className="h-[5px] w-[5px] rounded-full bg-emerald-500" />;
  if (status === "failed")
    return <span className="h-[5px] w-[5px] rounded-full bg-red-500" />;
  return <span className="h-[5px] w-[5px] rounded-full bg-zinc-300" />;
}

/* ─── Meta badge in top bar ─── */
function MetaBadge({
  label,
  icon,
  value,
  valueClass,
  editable,
  onEdit,
  disabled,
}: {
  label?: string;
  icon?: string;
  value: string;
  valueClass?: string;
  editable?: boolean;
  onEdit?: (val: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  const iconEl =
    icon === "zap" ? (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="text-zinc-400"
      >
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ) : icon === "folder" ? (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-zinc-400"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ) : null;

  if (editable && editing) {
    return (
      <div className="flex items-center gap-1 rounded-[10px] bg-zinc-100 px-2 py-0.5">
        {iconEl}
        <input
          type="text"
          defaultValue={value}
          autoFocus
          onBlur={(e) => {
            onEdit?.(e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onEdit?.((e.target as HTMLInputElement).value);
              setEditing(false);
            }
          }}
          disabled={disabled}
          className="w-28 bg-transparent font-mono text-[11px] text-zinc-600 outline-none"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={editable ? () => setEditing(true) : undefined}
      className={`flex max-w-[200px] items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 font-mono text-[11px] shadow-sm ${editable ? "cursor-pointer hover:border-zinc-300 hover:bg-zinc-50" : "cursor-default"}`}
    >
      {iconEl}
      {label && (
        <span className={`font-semibold ${valueClass ?? "text-zinc-500"}`}>
          {label}
        </span>
      )}
      <span className={valueClass ?? "text-zinc-500"}>{value}</span>
    </button>
  );
}

function OutputDirectoryField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const apply = () => {
    onChange(draft);
  };
}

/* ─── Running State ─── */
function RunningState({ stepId }: { stepId: PipelineStepId }) {
  const labels: Record<string, string> = {
    intent: "Intent",
    prd: "PRD Generation",
    trd: "Technical Requirements",
    sysdesign: "System Design",
    implguide: "Implementation Guide",
    design: "Design Specification",
    pencil: "Pencil Design",
    mockup: "Mockup Build",
    qa: "QA Audit",
    verify: "Verification",
    kickoff: "Project Kick-off",
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-zinc-900 animate-pulse" />
        <span className="text-sm font-medium text-zinc-700">
          {labels[stepId] ?? stepId} agent is generating...
        </span>
      </div>
      <Loading size="md" text="" />
    </div>
  );
}

/* ─── PRD Streaming Panel (live thinking chain + content) ─── */
function PrdStreamingPanel({
  thinking,
  content,
}: {
  thinking: string;
  content: string;
}) {
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const contentEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contentEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [content, thinking]);

  return (
    <div className="space-y-3">
      {thinking && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 overflow-hidden">
          <button
            onClick={() => setThinkingOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[12px] font-semibold text-zinc-600">
                思维链 · Thinking
              </span>
              <span className="text-[10px] text-zinc-400">
                {thinking.length?.toLocaleString()} chars
              </span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-zinc-400 transition-transform ${thinkingOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {thinkingOpen && (
            <div className="max-h-[240px] overflow-y-auto border-t border-zinc-200 px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-500 whitespace-pre-wrap [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {thinking}
            </div>
          )}
        </div>
      )}

      {content && (
        <div className="rounded-2xl border border-zinc-200/90 bg-white shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-6 py-3">
            <div className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[12px] font-semibold text-zinc-600">
              PRD · Generating…
            </span>
          </div>
          <div className="prose prose-sm prose-zinc max-w-none px-7 py-5">
            <MarkdownRenderer content={content} />
          </div>
        </div>
      )}

      {!content && !thinking && (
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-zinc-900 animate-pulse" />
          <span className="text-sm font-medium text-zinc-700">
            PRD Generation agent is generating...
          </span>
        </div>
      )}

      <div ref={contentEndRef} />
    </div>
  );
}

/* ─── Completed Step Content ─── */
function CompletedStepContent({ result }: { result: StepResult }) {
  const classification = (
    result.metadata as Record<string, unknown> | undefined
  )?.classification as
    | { tier: string; type: string; reasoning: string }
    | undefined;

  return (
    <div className="space-y-4">
      {classification && <TierBadge classification={classification} />}
      <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
        {result.model && (
          <span className="flex items-center gap-1.5">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-zinc-400"
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <path d="M9 9h6v6H9z" />
            </svg>
            <span className="font-medium text-zinc-600">{result.model}</span>
          </span>
        )}
        {result.costUsd !== undefined && (
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-400">$</span>
            <span className="font-semibold text-emerald-600">
              {result.costUsd.toFixed(4)}
            </span>
          </span>
        )}
        {result.durationMs !== undefined && (
          <span className="flex items-center gap-1.5">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-zinc-400"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="text-zinc-600">
              {(result.durationMs / 1000).toFixed(1)}s
            </span>
          </span>
        )}
        {result.tokenUsage && (
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-400">#</span>
            <span className="text-zinc-600">
              {result.tokenUsage?.totalTokens?.toLocaleString?.("en-US")} tokens
            </span>
          </span>
        )}
      </div>
      {result.content && <MarkdownRenderer content={result.content} />}
    </div>
  );
}

/* ─── Tier Badge ─── */
const TIER_STYLES: Record<string, { bg: string; text: string; label: string }> =
  {
    S: {
      bg: "bg-emerald-50 border-emerald-200",
      text: "text-emerald-700",
      label: "Simple",
    },
    M: {
      bg: "bg-amber-50 border-amber-200",
      text: "text-amber-700",
      label: "Standard",
    },
    L: {
      bg: "bg-zinc-100 border-zinc-300",
      text: "text-zinc-700",
      label: "Enterprise",
    },
  };

function TierBadge({
  classification,
}: {
  classification: { tier: string; type: string; reasoning: string };
}) {
  const style = TIER_STYLES[classification.tier] ?? TIER_STYLES.M;
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 ${style.bg}`}
    >
      <span className={`text-xs font-bold ${style.text}`}>
        Tier {classification.tier}
      </span>
      <span className="text-[10px] text-zinc-400">|</span>
      <span className={`text-[11px] font-medium ${style.text}`}>
        {style.label} &middot; {classification.type}
      </span>
      <span className="text-[10px] text-zinc-400">|</span>
      <span className="text-[10px] text-zinc-500">
        {classification.reasoning}
      </span>
    </div>
  );
}

/* ─── Failed State ─── */
function FailedState({ result }: { result: StepResult }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h3 className="text-sm font-semibold text-red-600">Step Failed</h3>
      <p className="mt-2 text-sm text-red-500">{result.error}</p>
    </div>
  );
}

/* ─── Empty State ─── */
function EmptyState() {
  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-zinc-200"
      >
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" x2="20" y1="19" y2="19" />
      </svg>
      <p className="text-lg font-semibold text-zinc-900">Ready to build</p>
      <p className="text-[13px] text-zinc-400">
        Enter a feature brief below to start the pipeline.
      </p>
    </div>
  );
}
