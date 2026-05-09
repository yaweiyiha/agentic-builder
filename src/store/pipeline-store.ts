"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  PipelineRun,
  PipelineStepId,
  StepResult,
} from "@/lib/pipeline/types";

// ── DB sync helpers ────────────────────────────────────────────────────────
// Debounce timer for batching rapid state changes into one PUT call.
let _syncTimer: ReturnType<typeof setTimeout> | null = null;
let _currentProjectSlug = "";

function scheduleSync(getState: () => PipelineState) {
  // NOTE: project_pipeline_state is deprecated. We no longer push to it here.
  // All persistent state is captured via saveSubStageSnapshot / saveIntentSnapshot.
  // This function is kept as a no-op stub so call-sites don't need updating.
  void getState;
}

/**
 * Maps a pipeline step ID to the (stage, subStage) it belongs to.
 * Used to determine where to file a substage snapshot when a step completes.
 */
const STEP_TO_STAGE_SUBSTAGE: Partial<Record<PipelineStepId, { stage: string; subStage: string }>> = {
  intent:    { stage: "preparation", subStage: "intent" },
  prd:       { stage: "preparation", subStage: "prd" },
  trd:       { stage: "preparation", subStage: "trd" },
  sysdesign: { stage: "preparation", subStage: "sysdesign" },
  implguide: { stage: "preparation", subStage: "implguide" },
  design:    { stage: "preparation", subStage: "design" },
  pencil:    { stage: "preparation", subStage: "pencil" },
  mockup:    { stage: "preparation", subStage: "mockup" },
  qa:        { stage: "preparation", subStage: "qa" },
  kickoff:   { stage: "kickoff",     subStage: "task-breakdown" },
  verify:    { stage: "coding",      subStage: "verify" },
};

/** Fire-and-forget: save substage status (idle|running|completed|error) to DB. */
function saveSubStageStatus(
  slug: string,
  stageId: string,
  subStageId: string,
  status: "idle" | "running" | "completed" | "error",
  opts?: { contextRefs?: Record<string, unknown>; stepIds?: string[] },
): void {
  fetch(`/api/projects/${slug}/substage-status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stageId, subStageId, status, ...opts }),
  }).catch((err) => console.error(`[pipeline-store] substage-status error (${stageId}/${subStageId}):`, err));
}

/** Saves a full pipeline snapshot for the given step's (stage, subStage). */
function saveSubStageSnapshot(getState: () => PipelineState, stepId: PipelineStepId): void {
  if (!_currentProjectSlug) return;
  const mapping = STEP_TO_STAGE_SUBSTAGE[stepId];
  if (!mapping) return;
  const s = getState();
  const snapshotBase = {
    featureBrief:  s.featureBrief,
    currentStep:   s.currentStep,
    activeTab:     s.activeTab,
    totalCostUsd:  s.totalCostUsd,
    isRunning:     false,
    fastFromPrd:   s.fastFromPrd,
    codeOutputDir: s.codeOutputDir,
    steps:         s.steps as Record<string, unknown>,
    designStyles:  s.designStyles,
    designStylesLoading: false,
    designStylesError: s.designStylesError,
    designStylesPrdHash: s.designStylesPrdHash,
    selectedDesignStyleId: s.selectedDesignStyleId,
    stitchResult:  s.stitchResult,
  };

  // For the intent substage, also persist the conversation from stage-store.
  if (stepId === "intent") {
    import("@/store/stage-store").then(({ useStageStore }) => {
      const ss = useStageStore.getState();
      const snapshot = {
        ...snapshotBase,
        intentMessages:      ss.intentMessages,
        intentEnrichedBrief: ss.intentEnrichedBrief,
      };
      fetch(`/api/projects/${_currentProjectSlug}/substage-snapshot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: mapping.stage, subStageId: mapping.subStage, snapshot }),
      }).catch((err) => console.error(`[pipeline-store] substage snapshot error (intent):`, err));
    }).catch(() => {/* ignore */});
    return;
  }

  fetch(`/api/projects/${_currentProjectSlug}/substage-snapshot`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stageId:    mapping.stage,
      subStageId: mapping.subStage,
      snapshot:   snapshotBase,
    }),
  }).catch((err) => console.error(`[pipeline-store] substage snapshot error (${stepId}):`, err));
}

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

export interface ImportedPrdStatus {
  exists: boolean;
  bytes: number;
  updatedAt: string | null;
  preview: string;
}

/** Mirrors `DesignReferenceEntry` from `@/lib/pipeline/design-references`. */
export interface DesignReferenceSummary {
  id: string;
  fileName: string;
  storedFileName: string;
  mime: string;
  bytes: number;
  /**
   * `"image"` for png/jpg/webp/gif screenshots, `"html"` for self-contained
   * page references. Older persisted manifests may omit this — the server
   * back-fills `"image"` when serving the manifest.
   */
  kind: "image" | "html";
  label: string;
  pageHint: string;
  uploadedAt: string;
}

export interface DesignReferenceUploadResult {
  added: Array<{ id: string; fileName: string }>;
  skipped: Array<{ fileName: string; reason: string }>;
}

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
  /** Accumulates main content tokens streamed during generation */
  streamingContent: string;
  /** Accumulates thinking/reasoning tokens streamed during generation */
  streamingThinking: string;
  /**
   * Status of a user-imported PRD stored at `.blueprint/PRD.md`. When
   * `exists` is true, the pipeline skips PRD generation and uses the
   * imported content directly. Populated via `refreshImportedPrdStatus()`.
   */
  importedPrd: ImportedPrdStatus | null;
  /** Non-null while an import/clear request is in flight. */
  importedPrdLoading: "idle" | "loading" | "saving" | "clearing";
  importedPrdError: string | null;
  /**
   * Stable client-generated id that links the pipeline run and the
   * subsequent kickoff into one logical session for memory records.
   * Created in `startPipeline`, cleared in `reset`. Sent to both
   * `/api/agents/pipeline` and `/api/agents/kickoff` as `sessionId`.
   */
  kickoffSessionId: string | null;
  /** User-uploaded design references. Copied to `<outputRoot>/.design-references/` at kickoff. */
  designReferences: DesignReferenceSummary[];
  designReferencesLoading:
    | "idle"
    | "loading"
    | "uploading"
    | "updating"
    | "deleting";
  designReferencesError: string | null;
  /** Design styles generated from PRD */
  designStyles: Array<{ id: string; name: string; description: string; colors: { primary: string; secondary: string; tertiary: string; neutral: string }; typography: { headlineFont: string; bodyFont: string; labelFont: string }; fontSizes: { h1: number; h2: number; h3: number; body: number; label: number }; spacing: { xs: number; sm: number; md: number; lg: number; xl: number } }> | null;
  designStylesLoading: boolean;
  designStylesError: string | null;
  /** Lightweight fingerprint of the PRD content when designStyles was last generated.
   *  Used to detect PRD changes so styles are regenerated automatically. */
  designStylesPrdHash: string | null;
  selectedDesignStyleId: string | null;
  /** Result from a Stitch MCP generation run. */
  stitchResult: {
    projectId: string;
    screenId: string;
    projectUrl: string;
    screenshotUrl: string | null;
    htmlDownloadUrl: string | null;
  } | null;
  stitchGenerating: boolean;
  stitchError: string | null;

  setCodeOutputDir: (value: string) => void;
  setFastFromPrd: (value: boolean) => void;
  /** Save the brief without starting the pipeline — used by the initial stage before intent Q&A. */
  setPendingBrief: (brief: string) => void;
  startPipeline: (featureBrief: string) => void;
  /** Re-run the PRD step only, applying the given edit instruction to the current PRD content. */
  rerunPrd: (editInstruction: string) => void;
  /** Generate design styles from PRD content */
  generateDesignStyles: () => Promise<void>;
  /** Select a design style by ID */
  selectDesignStyle: (styleId: string) => void;
  /** Generate (or re-generate) the Design Document. Pass editInstruction to revise an existing draft. */
  runDesignDoc: (editInstruction?: string) => void;
  /** Generate (or re-generate) the TRD document. Pass editInstruction to revise an existing draft. */
  runTrd: (editInstruction?: string) => void;
  /** Generate (or re-generate) the Pencil wireframe from the PRD + chosen design style. */
  runPencilDoc: (styleId: string, styleReferenceImage?: string | null, editInstruction?: string) => void;
  /**
   * Generate Pencil design via the real Pencil MCP live session.
   * Streams PencilLiveEvent SSE events and saves the result to steps.pencil.
   */
  runPencilWithMcp: (editInstruction?: string) => void;
  /** Generate UI design via Google Stitch MCP, storing the result URL. */
  runStitchGenerate: (editInstruction?: string) => void;
  setActiveTab: (tab: PipelineStepId) => void;
  /** Batch-update step results (e.g. from parallel generation). */
  updateSteps: (updates: Partial<Record<PipelineStepId, StepResult>>) => void;
  /** Run only the kick-off step after parallel generation is complete. */
  runKickoff: () => void;
  /** Pull the current imported PRD status from the server. */
  refreshImportedPrdStatus: () => Promise<void>;
  /** Save the provided markdown to `.blueprint/PRD.md`. */
  importPrd: (content: string) => Promise<boolean>;
  /** Remove `.blueprint/PRD.md` so the next run regenerates the PRD. */
  clearImportedPrd: () => Promise<boolean>;
  /** Pull the design-references manifest from the server. */
  refreshDesignReferences: () => Promise<void>;
  /**
   * Upload one or more screenshots. `labels` / `pageHints` are aligned by
   * index (use empty string to omit). Returns the upload outcome.
   */
  uploadDesignReferences: (
    files: File[],
    labels?: string[],
    pageHints?: string[],
  ) => Promise<DesignReferenceUploadResult | null>;
  /** Patch metadata (label / pageHint) on a single reference. */
  updateDesignReferenceMeta: (
    id: string,
    patch: { label?: string; pageHint?: string },
  ) => Promise<boolean>;
  deleteDesignReference: (id: string) => Promise<boolean>;
  clearDesignReferences: () => Promise<boolean>;
  reset: () => void;
  /** Called by the project page on mount — sets the slug used for DB sync. */
  setProjectSlugForSync: (slug: string) => void;
  /**
   * Load pipeline state from the DB and hydrate this store.
   * Called once on page mount after setProjectSlugForSync.
   */
  loadFromServer: (slug: string) => Promise<void>;
  /**
   * Load and restore the pipeline state snapshot for the given
   * (stage, subStage). Called when the user clicks a sub-stage in the sidebar.
   * Returns `true` if a snapshot was found and applied, `false` otherwise.
   */
  loadSubStageSnapshot: (stageId: string, subStageId: string) => Promise<boolean>;
  /**
   * Save the intent conversation to the (preparation/intent) substage snapshot.
   * Called by stage-store whenever the intent conversation changes, so the
   * snapshot is always up-to-date even before the full pipeline starts.
   */
  saveIntentSnapshot: (messages: unknown[], enrichedBrief: string) => void;
  /**
   * Eagerly save the current pipeline state as the snapshot for the given
   * (stageId, subStageId). Useful when entering a substage before the
   * corresponding pipeline step has completed (e.g. design substage on mount).
   */
  saveSubStageSnapshotForSubStage: (stageId: string, subStageId: string) => void;
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
      streamingContent: "",
      streamingThinking: "",
      importedPrd: null,
      importedPrdLoading: "idle",
      importedPrdError: null,
      kickoffSessionId: null,
      designReferences: [],
      designReferencesLoading: "idle",
      designReferencesError: null,
      designStyles: null,
      designStylesLoading: false,
      designStylesError: null,
      designStylesPrdHash: null,
      selectedDesignStyleId: null,
      stitchResult: null,
      stitchGenerating: false,
      stitchError: null,

      setCodeOutputDir: (value) => {
        const next = value.trim();
        set({ codeOutputDir: next.length > 0 ? next : DEFAULT_CODE_OUTPUT_DIR });
        scheduleSync(get);
      },
      setFastFromPrd: (value) => { set({ fastFromPrd: value }); scheduleSync(get); },

      setPendingBrief: (brief) => { set({ featureBrief: brief.trim() }); scheduleSync(get); },

      setActiveTab: (tab) => { set({ activeTab: tab }); scheduleSync(get); },

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
        scheduleSync(get);
      },

      runKickoff: () => {
        const { codeOutputDir, steps, featureBrief, kickoffSessionId } = get();
        // Reuse the session id from startPipeline if present; otherwise mint
        // a fresh one so this stand-alone kickoff still gets its own.
        const sessionId = kickoffSessionId ?? newSessionId();
        set({
          isRunning: true,
          error: null,
          currentStep: "kickoff",
          activeTab: "kickoff",
          kickoffSessionId: sessionId,
        });

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
            pencil: steps.pencil?.content ?? "",
            sessionId,
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

      rerunPrd: (editInstruction: string) => {
        const { steps, featureBrief, codeOutputDir } = get();
        const existingPrd = steps.prd?.content ?? "";
        const updatedSteps = { ...steps, prd: { stepId: "prd" as PipelineStepId, status: "running" as const, timestamp: new Date().toISOString() } };
        set({
          isRunning: true,
          error: null,
          currentStep: "prd",
          streamingContent: "",
          streamingThinking: "",
          steps: updatedSteps,
        });
        scheduleSync(get);

        fetch("/api/agents/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            featureBrief,
            codeOutputDir,
            prdEditInstruction: editInstruction,
            existingPrd,
          }),
        })
          .then(async (resp) => {
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({}));
              set({
                isRunning: false,
                error:
                  (errData as { error?: string }).error ||
                  "PRD edit request failed",
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

            // For rerunPrd we intentionally skip the generic `done` handler.
            // The edit-only pipeline run only contains {intent, prd} in run.steps —
            // applying the full `done` replacement would wipe trd/sysdesign/design/etc.
            // that were completed in the original full pipeline run.
            // steps.prd is already up-to-date via step_complete events.
            const handleRerunEvent = (raw: unknown) => {
              const payload = raw as { type?: string };
              if (payload.type === "done") {
                set({ isRunning: false });
                scheduleSync(get);
                return;
              }
              handleEvent(payload as Parameters<typeof handleEvent>[0], set, get);
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try {
                  handleRerunEvent(JSON.parse(line.slice(6)));
                } catch { /* skip */ }
              }
            }

            if (buffer.startsWith("data: ")) {
              try {
                handleRerunEvent(JSON.parse(buffer.slice(6)));
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

      generateDesignStyles: async () => {
        const { steps } = get();
        const prdContent = steps.prd?.content ?? "";

        if (!prdContent.trim()) {
          set({ designStylesError: "PRD content is required" });
          return;
        }

        set({ designStylesLoading: true, designStylesError: null });

        try {
          const response = await fetch("/api/agents/generate-design-styles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prdContent }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            set({
              designStylesLoading: false,
              designStylesError: (errData as { error?: string }).error || "Failed to generate design styles",
            });
            return;
          }

          const data = await response.json();
          const prdHash = `${prdContent.length}:${prdContent.slice(0, 100)}`;
          set({
            designStyles: data.styles,
            designStylesLoading: false,
            designStylesError: null,
            designStylesPrdHash: prdHash,
          });
        } catch (error) {
          set({
            designStylesLoading: false,
            designStylesError: error instanceof Error ? error.message : "Unknown error",
          });
        }
      },

      selectDesignStyle: (styleId: string) => {
        set({ selectedDesignStyleId: styleId });
      },

      runDesignDoc: (editInstruction?: string) => {
        const { steps, featureBrief, codeOutputDir, selectedDesignStyleId } = get();
        const prdContent = steps.prd?.content ?? featureBrief;
        if (!prdContent.trim()) return;

        // Mark design as running
        const updatedSteps = {
          ...steps,
          design: {
            stepId: "design" as PipelineStepId,
            status: "running" as const,
            timestamp: new Date().toISOString(),
          },
        };
        set({
          isRunning: true,
          error: null,
          currentStep: "design",
          streamingContent: "",
          streamingThinking: "",
          steps: updatedSteps,
        });
        scheduleSync(get);

        const requestPayload = {
            prdContent,
            selectedDocs: ["design"],
            sessionId: steps.intent?.timestamp ?? "session",
            codeOutputDir,
            tier: (
              (steps.intent?.metadata as Record<string, unknown> | undefined)
                ?.classification as { tier?: string } | undefined
            )?.tier ?? "M",
            designStyleId: selectedDesignStyleId ?? undefined,
            ...(editInstruction?.trim() ? {
              editInstruction: editInstruction.trim(),
              existingDesign: steps.design?.content ?? "",
            } : {}),
          };
        console.log("[runDesignDoc] → request payload", {
          ...requestPayload,
          prdContent: requestPayload.prdContent.slice(0, 500) + (requestPayload.prdContent.length > 500 ? "…(truncated)" : ""),
        });

        fetch("/api/agents/parallel-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
        })
          .then(async (resp) => {
            console.log("[runDesignDoc] ← response status", resp.status, resp.statusText);
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({}));
              console.error("[runDesignDoc] ✗ error response", errData);
              set({
                isRunning: false,
                currentStep: null,
                steps: {
                  ...get().steps,
                  design: {
                    stepId: "design" as PipelineStepId,
                    status: "failed" as const,
                    error: (errData as { error?: string }).error || "Design generation failed",
                    timestamp: new Date().toISOString(),
                  },
                },
              });
              return;
            }

            const reader = resp.body?.getReader();
            if (!reader) {
              set({ isRunning: false, currentStep: null });
              return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let designContent = "";
            let designCost = 0;
            let designDuration = 0;

            const handleParallelEvent = (payload: Record<string, unknown>) => {
              const type = payload.type as string;
              console.log("[runDesignDoc] SSE event", type, payload.docId ?? "");
              if (type === "doc_stream") {
                const chunk = payload.chunk as string | undefined;
                if (chunk) {
                  designContent += chunk;
                  set({ streamingContent: designContent });
                }
              } else if (type === "doc_complete" && payload.docId === "design") {
                designContent = (payload.content as string) || designContent;
                designCost = (payload.costUsd as number) || 0;
                designDuration = (payload.durationMs as number) || 0;
                console.log("[runDesignDoc] ✓ doc_complete", {
                  contentLength: designContent.length,
                  costUsd: designCost,
                  durationMs: designDuration,
                  contentPreview: designContent.slice(0, 300) + (designContent.length > 300 ? "…" : ""),
                });
                const completedStep: StepResult = {
                  stepId: "design",
                  status: "completed",
                  content: designContent,
                  costUsd: designCost,
                  durationMs: designDuration,
                  timestamp: new Date().toISOString(),
                };
                set({
                  steps: { ...get().steps, design: completedStep },
                  totalCostUsd: get().totalCostUsd + designCost,
                  streamingContent: "",
                });
                scheduleSync(get);
                saveSubStageSnapshot(get, "design");
              } else if (type === "generation_complete") {
                set({ isRunning: false, currentStep: null });
                scheduleSync(get);
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try { handleParallelEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
              }
            }
            if (buffer.startsWith("data: ")) {
              try { handleParallelEvent(JSON.parse(buffer.slice(6))); } catch { /* skip */ }
            }
            if (get().isRunning) set({ isRunning: false, currentStep: null });
          })
          .catch((err) => {
            set({
              isRunning: false,
              currentStep: null,
              error: err instanceof Error ? err.message : "Unknown error",
            });
          });
      },

      runTrd: (editInstruction?: string) => {
        const { steps, featureBrief, codeOutputDir } = get();
        const prdContent = steps.prd?.content ?? featureBrief;
        if (!prdContent.trim()) return;

        const updatedSteps = {
          ...steps,
          trd: {
            stepId: "trd" as PipelineStepId,
            status: "running" as const,
            timestamp: new Date().toISOString(),
          },
        };
        set({
          isRunning: true,
          error: null,
          currentStep: "trd",
          streamingContent: "",
          streamingThinking: "",
          steps: updatedSteps,
        });
        scheduleSync(get);

        const requestPayload = {
          prdContent,
          selectedDocs: ["trd"],
          sessionId: steps.intent?.timestamp ?? "session",
          codeOutputDir,
          tier: (
            (steps.intent?.metadata as Record<string, unknown> | undefined)
              ?.classification as { tier?: string } | undefined
          )?.tier ?? "M",
          ...(editInstruction?.trim() ? {
            editInstruction: editInstruction.trim(),
            existingTrd: steps.trd?.content ?? "",
          } : {}),
        };

        fetch("/api/agents/parallel-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
        })
          .then(async (resp) => {
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({}));
              set({
                isRunning: false,
                currentStep: null,
                steps: {
                  ...get().steps,
                  trd: {
                    stepId: "trd" as PipelineStepId,
                    status: "failed" as const,
                    error: (errData as { error?: string }).error || "TRD generation failed",
                    timestamp: new Date().toISOString(),
                  },
                },
              });
              return;
            }

            const reader = resp.body?.getReader();
            if (!reader) {
              set({ isRunning: false, currentStep: null });
              return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let trdContent = "";
            let trdCost = 0;
            let trdDuration = 0;

            const handleParallelEvent = (payload: Record<string, unknown>) => {
              const type = payload.type as string;
              if (type === "doc_stream") {
                const chunk = payload.chunk as string | undefined;
                if (chunk) {
                  trdContent += chunk;
                  set({ streamingContent: trdContent });
                }
              } else if (type === "doc_complete" && payload.docId === "trd") {
                trdContent = (payload.content as string) || trdContent;
                trdCost = (payload.costUsd as number) || 0;
                trdDuration = (payload.durationMs as number) || 0;
                const completedStep: StepResult = {
                  stepId: "trd",
                  status: "completed",
                  content: trdContent,
                  costUsd: trdCost,
                  durationMs: trdDuration,
                  timestamp: new Date().toISOString(),
                };
                set({
                  steps: { ...get().steps, trd: completedStep },
                  totalCostUsd: get().totalCostUsd + trdCost,
                  streamingContent: "",
                });
                scheduleSync(get);
                saveSubStageSnapshot(get, "trd");
              } else if (type === "generation_complete") {
                set({ isRunning: false, currentStep: null });
                scheduleSync(get);
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try { handleParallelEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
              }
            }
            if (buffer.startsWith("data: ")) {
              try { handleParallelEvent(JSON.parse(buffer.slice(6))); } catch { /* skip */ }
            }
            if (get().isRunning) set({ isRunning: false, currentStep: null });
          })
          .catch((err) => {
            set({
              isRunning: false,
              currentStep: null,
              error: err instanceof Error ? err.message : "Unknown error",
            });
          });
      },

      runPencilDoc: (styleId: string, styleReferenceImage?: string | null, editInstruction?: string) => {
        const { steps, featureBrief, codeOutputDir } = get();
        const prdContent = steps.prd?.content ?? featureBrief;
        console.log("[runPencilDoc] called", {
          styleId,
          prdContentLength: prdContent.length,
          hasDesignContent: !!steps.design?.content,
          designContentLength: steps.design?.content?.length ?? 0,
          editInstruction,
          codeOutputDir,
        });
        if (!prdContent.trim()) {
          console.warn("[runPencilDoc] ⚠ No PRD content — aborting");
          return;
        }

        const updatedSteps = {
          ...steps,
          pencil: {
            stepId: "pencil" as PipelineStepId,
            status: "running" as const,
            timestamp: new Date().toISOString(),
          },
        };
        set({
          isRunning: true,
          error: null,
          currentStep: "pencil",
          streamingContent: "",
          streamingThinking: "",
          steps: updatedSteps,
        });
        scheduleSync(get);

        const pencilPayload = {
            prdContent,
            selectedDocs: ["pencil"],
            sessionId: steps.intent?.timestamp ?? "session",
            codeOutputDir,
            tier: (
              (steps.intent?.metadata as Record<string, unknown> | undefined)
                ?.classification as { tier?: string } | undefined
            )?.tier ?? "M",
            designStyleId: styleId,
            designSpecContent: steps.design?.content ?? "",
          };
        console.log("[runPencilDoc] → fetch /api/agents/parallel-generate", {
          ...pencilPayload,
          prdContent: pencilPayload.prdContent.slice(0, 200) + "…",
          designSpecContent: pencilPayload.designSpecContent.slice(0, 200) + "…",
        });
        fetch("/api/agents/parallel-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prdContent,
            selectedDocs: ["pencil"],
            sessionId: steps.intent?.timestamp ?? "session",
            codeOutputDir,
            tier: (
              (steps.intent?.metadata as Record<string, unknown> | undefined)
                ?.classification as { tier?: string } | undefined
            )?.tier ?? "M",
            designStyleId: styleId,
            designSpecContent: steps.design?.content ?? "",
            ...(styleReferenceImage ? { styleReferenceImageBase64: styleReferenceImage } : {}),
            ...(editInstruction?.trim() ? {
              editInstruction: editInstruction.trim(),
              existingDesign: steps.pencil?.content ?? "",
            } : {}),
          }),
        })
          .then(async (resp) => {
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({}));
              set({
                isRunning: false,
                currentStep: null,
                steps: {
                  ...get().steps,
                  pencil: {
                    stepId: "pencil" as PipelineStepId,
                    status: "failed" as const,
                    error: (errData as { error?: string }).error || "Pencil generation failed",
                    timestamp: new Date().toISOString(),
                  },
                },
              });
              return;
            }

            const reader = resp.body?.getReader();
            if (!reader) {
              set({ isRunning: false, currentStep: null });
              return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let pencilContent = "";
            let pencilCost = 0;
            let pencilDuration = 0;

            const handleEvent = (payload: Record<string, unknown>) => {
              const type = payload.type as string;
              console.log("[runPencilDoc] SSE", type, payload.docId ?? "");
              if (type === "doc_stream") {
                const chunk = payload.chunk as string | undefined;
                if (chunk) {
                  pencilContent += chunk;
                  set({ streamingContent: pencilContent });
                }
              } else if (type === "doc_complete" && payload.docId === "pencil") {
                console.log("[runPencilDoc] ✓ doc_complete pencil", { contentLength: ((payload.content as string) || pencilContent).length });
                pencilContent = (payload.content as string) || pencilContent;
                pencilCost = (payload.costUsd as number) || 0;
                pencilDuration = (payload.durationMs as number) || 0;
                const completedStep: StepResult = {
                  stepId: "pencil",
                  status: "completed",
                  content: pencilContent,
                  costUsd: pencilCost,
                  durationMs: pencilDuration,
                  timestamp: new Date().toISOString(),
                  metadata: { designStyleId: styleId },
                };
                set({
                  steps: { ...get().steps, pencil: completedStep },
                  totalCostUsd: get().totalCostUsd + pencilCost,
                  streamingContent: "",
                });
                scheduleSync(get);
                saveSubStageSnapshot(get, "pencil");
              } else if (type === "generation_complete") {
                set({ isRunning: false, currentStep: null });
                scheduleSync(get);
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try { handleEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
              }
            }
            if (buffer.startsWith("data: ")) {
              try { handleEvent(JSON.parse(buffer.slice(6))); } catch { /* skip */ }
            }
            if (get().isRunning) set({ isRunning: false, currentStep: null });
          })
          .catch((err) => {
            set({
              isRunning: false,
              currentStep: null,
              error: err instanceof Error ? err.message : "Unknown error",
            });
          });
      },

      runPencilWithMcp: (editInstruction?: string) => {
        const { steps, featureBrief, codeOutputDir, selectedDesignStyleId } = get();
        const prdContent = steps.prd?.content ?? featureBrief;
        const designSpecContent = steps.design?.content ?? "";

        console.log("[runPencilWithMcp] called", {
          selectedDesignStyleId,
          prdContentLength: prdContent.length,
          designSpecContentLength: designSpecContent.length,
          editInstruction,
        });

        if (!prdContent.trim()) {
          console.warn("[runPencilWithMcp] ⚠ No PRD content — aborting");
          return;
        }
        if (!designSpecContent.trim()) {
          console.warn("[runPencilWithMcp] ⚠ No Design Spec content — aborting");
          return;
        }

        set({
          isRunning: true,
          error: null,
          currentStep: "pencil",
          streamingContent: "",
          streamingThinking: "",
          steps: {
            ...steps,
            pencil: {
              stepId: "pencil" as PipelineStepId,
              status: "running" as const,
              timestamp: new Date().toISOString(),
            },
          },
        });
        scheduleSync(get);

        console.log("[runPencilWithMcp] → fetch /api/agents/pencil-generate");

        fetch("/api/agents/pencil-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prdContent,
            designSpecContent,
            designStyleId: selectedDesignStyleId ?? undefined,
            codeOutputDir,
            sessionId: steps.intent?.timestamp ?? "session",
            ...(editInstruction?.trim() ? { editInstruction: editInstruction.trim() } : {}),
          }),
        })
          .then(async (resp) => {
            console.log("[runPencilWithMcp] ← response status", resp.status);
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({}));
              set({
                isRunning: false,
                currentStep: null,
                steps: {
                  ...get().steps,
                  pencil: {
                    stepId: "pencil" as PipelineStepId,
                    status: "failed" as const,
                    error: (errData as { error?: string }).error || "Pencil MCP generation failed",
                    timestamp: new Date().toISOString(),
                  },
                },
              });
              return;
            }

            const reader = resp.body?.getReader();
            if (!reader) {
              set({ isRunning: false, currentStep: null });
              return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let progressLines: string[] = [];

            const handleEvent = (payload: Record<string, unknown>) => {
              const type = payload.type as string;
              console.log("[runPencilWithMcp] SSE", type);

              if (type === "session_start" || type === "assistant_message" || type === "tool_call_start" || type === "tool_call_result" || type === "session_complete") {
                // Accumulate progress messages for live display
                const msg = (payload.message as string) ?? (payload.toolName as string) ?? "";
                if (msg) {
                  progressLines = [...progressLines, msg];
                  set({ streamingContent: progressLines.join("\n\n---\n\n") });
                }
              } else if (type === "done") {
                const result = payload.result as { content?: string; costUsd?: number; durationMs?: number; tokens?: number } | undefined;
                const content = result?.content ?? "";
                console.log("[runPencilWithMcp] ✓ done", { contentLength: content.length });
                const completedStep: StepResult = {
                  stepId: "pencil",
                  status: "completed",
                  content,
                  costUsd: result?.costUsd ?? 0,
                  durationMs: result?.durationMs ?? 0,
                  timestamp: new Date().toISOString(),
                  metadata: { designStyleId: selectedDesignStyleId, source: "pencil-mcp" },
                };
                set({
                  isRunning: false,
                  currentStep: null,
                  steps: { ...get().steps, pencil: completedStep },
                  totalCostUsd: get().totalCostUsd + (result?.costUsd ?? 0),
                  streamingContent: "",
                });
                scheduleSync(get);
                saveSubStageSnapshot(get, "pencil");
              } else if (type === "error") {
                console.error("[runPencilWithMcp] ✗ error", payload.error);
                set({
                  isRunning: false,
                  currentStep: null,
                  steps: {
                    ...get().steps,
                    pencil: {
                      stepId: "pencil" as PipelineStepId,
                      status: "failed" as const,
                      error: (payload.error as string) || "Pencil MCP failed",
                      timestamp: new Date().toISOString(),
                    },
                  },
                  streamingContent: "",
                });
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                try { handleEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
              }
            }
            if (buffer.startsWith("data: ")) {
              try { handleEvent(JSON.parse(buffer.slice(6))); } catch { /* skip */ }
            }
            if (get().isRunning) set({ isRunning: false, currentStep: null });
          })
          .catch((err) => {
            set({
              isRunning: false,
              currentStep: null,
              error: err instanceof Error ? err.message : "Unknown error",
            });
          });
      },

      runStitchGenerate: (editInstruction?: string) => {
        const { steps, featureBrief, selectedDesignStyleId } = get();
        const prdContent = steps.prd?.content ?? featureBrief;
        const designSpecContent = steps.design?.content ?? "";

        if (!prdContent.trim()) {
          console.warn("[runStitchGenerate] ⚠ No PRD content — aborting");
          return;
        }

        set({ stitchGenerating: true, stitchError: null, stitchResult: null });

        fetch("/api/agents/stitch-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prdContent,
            designStyleId: selectedDesignStyleId ?? undefined,
            designSpecContent,
            editInstruction: editInstruction?.trim() || undefined,
          }),
        })
          .then(async (resp) => {
            const data = await resp.json();
            if (!resp.ok || data.error) {
              set({
                stitchGenerating: false,
                stitchError: data.error || "Stitch generation failed",
              });
              return;
            }
            set({
              stitchGenerating: false,
              stitchError: null,
              stitchResult: {
                projectId: data.projectId,
                screenId: data.screenId,
                projectUrl: data.projectUrl,
                screenshotUrl: data.screenshotUrl,
                htmlDownloadUrl: data.htmlDownloadUrl,
              },
            });
            // Persist the stitch result so it survives page refresh
            // Save to both substages: the user may refresh while on either one
            saveSubStageSnapshot(get, "pencil");
            saveSubStageSnapshot(get, "design");
          })
          .catch((err) => {
            set({
              stitchGenerating: false,
              stitchError: err instanceof Error ? err.message : "Stitch request failed",
            });
          });
      },

      startPipeline: (brief: string) => {
        const { codeOutputDir, fastFromPrd } = get();
        const sessionId = newSessionId();
        set({
          isRunning: true,
          error: null,
          steps: { ...EMPTY_STEPS },
          currentStep: null,
          totalCostUsd: 0,
          featureBrief: brief,
          activeTab: "intent",
          kickoffSessionId: sessionId,
        });
        scheduleSync(get);

        // Mark intent substage as running
        if (_currentProjectSlug) {
          saveSubStageStatus(_currentProjectSlug, "preparation", "intent", "running", {
            stepIds: ["intent"],
          });
        }

        fetch("/api/agents/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            featureBrief: brief,
            codeOutputDir,
            fastFromPrd,
            pauseAfterPrd: !fastFromPrd,
            sessionId,
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

      refreshImportedPrdStatus: async () => {
        set({ importedPrdLoading: "loading", importedPrdError: null });
        try {
          const resp = await fetch("/api/agents/pipeline/prd-import", {
            method: "GET",
            cache: "no-store",
          });
          if (!resp.ok) {
            const data = (await resp.json().catch(() => ({}))) as {
              error?: string;
            };
            set({
              importedPrdLoading: "idle",
              importedPrdError: data.error || "Failed to load imported PRD.",
            });
            return;
          }
          const status = (await resp.json()) as ImportedPrdStatus;
          set({ importedPrd: status, importedPrdLoading: "idle" });
        } catch (err) {
          set({
            importedPrdLoading: "idle",
            importedPrdError:
              err instanceof Error ? err.message : "Network error.",
          });
        }
      },

      importPrd: async (content: string) => {
        const trimmed = content.trim();
        if (trimmed.length === 0) {
          set({ importedPrdError: "PRD content is empty." });
          return false;
        }
        set({ importedPrdLoading: "saving", importedPrdError: null });
        try {
          const resp = await fetch("/api/agents/pipeline/prd-import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          });
          const data = (await resp.json().catch(() => ({}))) as {
            error?: string;
            status?: ImportedPrdStatus;
          };
          if (!resp.ok) {
            set({
              importedPrdLoading: "idle",
              importedPrdError: data.error || "Failed to save PRD.",
            });
            return false;
          }
          set({
            importedPrd: data.status ?? null,
            importedPrdLoading: "idle",
          });
          return true;
        } catch (err) {
          set({
            importedPrdLoading: "idle",
            importedPrdError:
              err instanceof Error ? err.message : "Network error.",
          });
          return false;
        }
      },

      refreshDesignReferences: async () => {
        set({
          designReferencesLoading: "loading",
          designReferencesError: null,
        });
        try {
          const resp = await fetch("/api/agents/pipeline/design-references", {
            method: "GET",
            cache: "no-store",
          });
          if (!resp.ok) {
            const data = (await resp.json().catch(() => ({}))) as {
              error?: string;
            };
            set({
              designReferencesLoading: "idle",
              designReferencesError:
                data.error || "Failed to load design references.",
            });
            return;
          }
          const data = (await resp.json()) as {
            references: DesignReferenceSummary[];
          };
          set({
            designReferences: Array.isArray(data.references)
              ? data.references
              : [],
            designReferencesLoading: "idle",
          });
        } catch (err) {
          set({
            designReferencesLoading: "idle",
            designReferencesError:
              err instanceof Error ? err.message : "Network error.",
          });
        }
      },

      uploadDesignReferences: async (files, labels, pageHints) => {
        if (!files || files.length === 0) {
          set({ designReferencesError: "No files selected." });
          return null;
        }
        set({
          designReferencesLoading: "uploading",
          designReferencesError: null,
        });
        try {
          const form = new FormData();
          files.forEach((file, idx) => {
            form.append("file", file, file.name);
            form.append("label", labels?.[idx] ?? "");
            form.append("pageHint", pageHints?.[idx] ?? "");
          });
          const resp = await fetch("/api/agents/pipeline/design-references", {
            method: "POST",
            body: form,
          });
          const data = (await resp.json().catch(() => ({}))) as {
            error?: string;
            added?: Array<{ id: string; fileName: string }>;
            skipped?: Array<{ fileName: string; reason: string }>;
            references?: DesignReferenceSummary[];
          };
          if (!resp.ok && !(data.added && data.added.length > 0)) {
            set({
              designReferencesLoading: "idle",
              designReferencesError: data.error || "Upload failed.",
            });
            return null;
          }
          set({
            designReferences: Array.isArray(data.references)
              ? data.references
              : [],
            designReferencesLoading: "idle",
            designReferencesError:
              data.skipped && data.skipped.length > 0
                ? `Some files were skipped: ${data.skipped
                    .map((s) => `${s.fileName} (${s.reason})`)
                    .join("; ")}`
                : null,
          });
          return {
            added: data.added ?? [],
            skipped: data.skipped ?? [],
          };
        } catch (err) {
          set({
            designReferencesLoading: "idle",
            designReferencesError:
              err instanceof Error ? err.message : "Network error.",
          });
          return null;
        }
      },

      updateDesignReferenceMeta: async (id, patch) => {
        set({
          designReferencesLoading: "updating",
          designReferencesError: null,
        });
        try {
          const resp = await fetch(
            `/api/agents/pipeline/design-references/${encodeURIComponent(id)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            },
          );
          const data = (await resp.json().catch(() => ({}))) as {
            error?: string;
            reference?: DesignReferenceSummary;
          };
          if (!resp.ok) {
            set({
              designReferencesLoading: "idle",
              designReferencesError: data.error || "Update failed.",
            });
            return false;
          }
          const updated = data.reference;
          if (!updated) {
            set({ designReferencesLoading: "idle" });
            return false;
          }
          set({
            designReferences: get().designReferences.map((r) =>
              r.id === updated.id ? updated : r,
            ),
            designReferencesLoading: "idle",
          });
          return true;
        } catch (err) {
          set({
            designReferencesLoading: "idle",
            designReferencesError:
              err instanceof Error ? err.message : "Network error.",
          });
          return false;
        }
      },

      deleteDesignReference: async (id: string) => {
        set({
          designReferencesLoading: "deleting",
          designReferencesError: null,
        });
        try {
          const resp = await fetch(
            `/api/agents/pipeline/design-references/${encodeURIComponent(id)}`,
            { method: "DELETE" },
          );
          const data = (await resp.json().catch(() => ({}))) as {
            error?: string;
            references?: DesignReferenceSummary[];
          };
          if (!resp.ok) {
            set({
              designReferencesLoading: "idle",
              designReferencesError: data.error || "Delete failed.",
            });
            return false;
          }
          set({
            designReferences: Array.isArray(data.references)
              ? data.references
              : [],
            designReferencesLoading: "idle",
          });
          return true;
        } catch (err) {
          set({
            designReferencesLoading: "idle",
            designReferencesError:
              err instanceof Error ? err.message : "Network error.",
          });
          return false;
        }
      },

      clearDesignReferences: async () => {
        set({
          designReferencesLoading: "deleting",
          designReferencesError: null,
        });
        try {
          const resp = await fetch(
            "/api/agents/pipeline/design-references?all=true",
            { method: "DELETE" },
          );
          if (!resp.ok) {
            const data = (await resp.json().catch(() => ({}))) as {
              error?: string;
            };
            set({
              designReferencesLoading: "idle",
              designReferencesError: data.error || "Clear failed.",
            });
            return false;
          }
          set({ designReferences: [], designReferencesLoading: "idle" });
          return true;
        } catch (err) {
          set({
            designReferencesLoading: "idle",
            designReferencesError:
              err instanceof Error ? err.message : "Network error.",
          });
          return false;
        }
      },

      clearImportedPrd: async () => {
        set({ importedPrdLoading: "clearing", importedPrdError: null });
        try {
          const resp = await fetch("/api/agents/pipeline/prd-import", {
            method: "DELETE",
          });
          const data = (await resp.json().catch(() => ({}))) as {
            error?: string;
            status?: ImportedPrdStatus;
          };
          if (!resp.ok) {
            set({
              importedPrdLoading: "idle",
              importedPrdError: data.error || "Failed to clear PRD.",
            });
            return false;
          }
          set({
            importedPrd: data.status ?? { exists: false, bytes: 0, updatedAt: null, preview: "" },
            importedPrdLoading: "idle",
          });
          return true;
        } catch (err) {
          set({
            importedPrdLoading: "idle",
            importedPrdError:
              err instanceof Error ? err.message : "Network error.",
          });
          return false;
        }
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
          streamingContent: "",
          streamingThinking: "",
          kickoffSessionId: null,
        });
      },

      setProjectSlugForSync: (slug: string) => {
        _currentProjectSlug = slug;
      },

      loadFromServer: async (slug: string) => {
        _currentProjectSlug = slug;
        try {
          // First, try to restore the active substage snapshot (has steps)
          const snapResp = await fetch(`/api/projects/${slug}/substage-snapshot`, { cache: "no-store" });
          if (snapResp.ok) {
            const snapData = (await snapResp.json()) as {
              snapshot?: {
                featureBrief?:  string;
                currentStep?:   string | null;
                activeTab?:     string;
                totalCostUsd?:  number;
                isRunning?:     boolean;
                fastFromPrd?:   boolean;
                codeOutputDir?: string;
                steps?:         Record<string, unknown>;
                designStyles?: Array<{ id: string; name: string; description: string; colors: { primary: string; secondary: string; tertiary: string; neutral: string }; typography: { headlineFont: string; bodyFont: string; labelFont: string }; fontSizes: { h1: number; h2: number; h3: number; body: number; label: number }; spacing: { xs: number; sm: number; md: number; lg: number; xl: number } }> | null;
                designStylesLoading?: boolean;
                designStylesError?: string | null;
                selectedDesignStyleId?: string | null;
                intentMessages?: unknown[];
                intentEnrichedBrief?: string;
              } | null;
            };
            if (snapData.snapshot) {
              const snap = snapData.snapshot;
              set({
                featureBrief:  snap.featureBrief  ?? "",
                currentStep:   (snap.currentStep  as PipelineStepId | null) ?? null,
                activeTab:     (snap.activeTab    as PipelineStepId) ?? "intent",
                totalCostUsd:  snap.totalCostUsd  ?? 0,
                isRunning:     false,
                fastFromPrd:   snap.fastFromPrd   ?? true,
                codeOutputDir: snap.codeOutputDir ?? "generated-code",
                steps:         snap.steps
                  ? { ...EMPTY_STEPS, ...(snap.steps as Record<PipelineStepId, StepResult | null>) }
                  : { ...EMPTY_STEPS },
                designStyles:         snap.designStyles ?? null,
                designStylesLoading:  false,
                designStylesError:    snap.designStylesError ?? null,
                designStylesPrdHash:  (snap as { designStylesPrdHash?: string | null }).designStylesPrdHash ?? null,
                selectedDesignStyleId: snap.selectedDesignStyleId ?? null,
              });
              // Push intent messages to stage-store if present in snapshot
              const intentMsgs  = snap.intentMessages;
              const enrichedBrf = snap.intentEnrichedBrief ?? "";
              if (intentMsgs?.length) {
                import("@/store/stage-store").then(({ useStageStore }) => {
                  useStageStore.getState().setIntentConversation(intentMsgs!, enrichedBrf);
                }).catch(() => {/* ignore */});
              }
              return;
            }
          }
          // Fallback: load base pipeline state (no steps)
          const resp = await fetch(`/api/projects/${slug}/state`, { cache: "no-store" });
          if (!resp.ok) return;
          const data = (await resp.json()) as {
            pipelineState?: {
              featureBrief?:  string;
              currentStep?:   string | null;
              activeTab?:     string;
              totalCostUsd?:  number;
              isRunning?:     boolean;
              fastFromPrd?:   boolean;
              codeOutputDir?: string;
            } | null;
          };
          const ps = data.pipelineState;
          if (!ps) return;
          set({
            featureBrief:  ps.featureBrief  ?? "",
            currentStep:   (ps.currentStep  as PipelineStepId | null) ?? null,
            activeTab:     (ps.activeTab    as PipelineStepId) ?? "intent",
            totalCostUsd:  ps.totalCostUsd  ?? 0,
            isRunning:     false,
            fastFromPrd:   ps.fastFromPrd   ?? true,
            codeOutputDir: ps.codeOutputDir ?? "generated-code",
            steps:         { ...EMPTY_STEPS },
          });
        } catch (err) {
          console.error("[pipeline-store] loadFromServer error:", err);
        }
      },

      loadSubStageSnapshot: async (stageId: string, subStageId: string): Promise<boolean> => {
        if (!_currentProjectSlug) return false;
        // If the pipeline is actively running, do not clobber in-flight state
        // with a stale DB snapshot (e.g. user just called startPipeline and
        // immediately navigated to the next sub-stage).
        if (get().isRunning) return false;
        try {
          const url = `/api/projects/${_currentProjectSlug}/substage-snapshot?stage=${encodeURIComponent(stageId)}&subStage=${encodeURIComponent(subStageId)}`;
          const resp = await fetch(url, { cache: "no-store" });
          if (!resp.ok) return false;
          const data = (await resp.json()) as {
            snapshot?: {
              featureBrief?:  string;
              currentStep?:   string | null;
              activeTab?:     string;
              totalCostUsd?:  number;
              isRunning?:     boolean;
              fastFromPrd?:   boolean;
              codeOutputDir?: string;
              steps?:         Record<string, unknown>;
              designStyles?: Array<{ id: string; name: string; description: string; colors: { primary: string; secondary: string; tertiary: string; neutral: string }; typography: { headlineFont: string; bodyFont: string; labelFont: string }; fontSizes: { h1: number; h2: number; h3: number; body: number; label: number }; spacing: { xs: number; sm: number; md: number; lg: number; xl: number } }> | null;
              designStylesLoading?: boolean;
              designStylesError?: string | null;
              selectedDesignStyleId?: string | null;
              stitchResult?: { projectId: string; screenId: string; projectUrl: string; screenshotUrl: string | null; htmlDownloadUrl: string | null } | null;
              intentMessages?: unknown[];
              intentEnrichedBrief?: string;
            } | null;
          };
          if (!data.snapshot) return false;
          const snap = data.snapshot;
          set({
            featureBrief:  snap.featureBrief  ?? "",
            currentStep:   (snap.currentStep  as PipelineStepId | null) ?? null,
            activeTab:     (snap.activeTab    as PipelineStepId) ?? "intent",
            totalCostUsd:  snap.totalCostUsd  ?? 0,
            isRunning:     false,
            fastFromPrd:   snap.fastFromPrd   ?? true,
            codeOutputDir: snap.codeOutputDir ?? "generated-code",
            steps:         snap.steps
              ? (() => {
                  const restored = { ...EMPTY_STEPS, ...(snap.steps as Record<PipelineStepId, StepResult | null>) };
                  // Clear any steps that were previously skipped (quick-start stub) so they
                  // show as "not generated" rather than displaying the skip placeholder text.
                  for (const key of Object.keys(restored) as PipelineStepId[]) {
                    const step = restored[key];
                    if (step?.metadata && (step.metadata as Record<string, unknown>)["skipped"] === true) {
                      restored[key] = null;
                    }
                  }
                  return restored;
                })()
              : { ...EMPTY_STEPS },
            designStyles: snap.designStyles ?? null,
            designStylesLoading: snap.designStylesLoading ?? false,
            designStylesError: snap.designStylesError ?? null,
            selectedDesignStyleId: snap.selectedDesignStyleId ?? null,
            stitchResult: snap.stitchResult ?? null,
            stitchGenerating: false,
            stitchError: null,
          });
          // Push intent fields back to stage-store if this is the intent substage
          if (subStageId === "intent" && snap.intentMessages?.length) {
            import("@/store/stage-store").then(({ useStageStore }) => {
              useStageStore.getState().setIntentConversation(
                snap.intentMessages!,
                snap.intentEnrichedBrief ?? "",
              );
            }).catch(() => {/* ignore */});
          }
          return true;
        } catch (err) {
          console.error(`[pipeline-store] loadSubStageSnapshot error (${stageId}/${subStageId}):`, err);
          return false;
        }
      },

      saveIntentSnapshot: (messages: unknown[], enrichedBrief: string) => {
        if (!_currentProjectSlug) return;
        const s = get();
        const snapshot = {
          featureBrief:         s.featureBrief,
          currentStep:          s.currentStep,
          activeTab:            s.activeTab,
          totalCostUsd:         s.totalCostUsd,
          isRunning:            false,
          fastFromPrd:          s.fastFromPrd,
          codeOutputDir:        s.codeOutputDir,
          steps:                s.steps as Record<string, unknown>,
          designStyles:         s.designStyles,
          designStylesLoading:  s.designStylesLoading,
          designStylesError:    s.designStylesError,
          selectedDesignStyleId: s.selectedDesignStyleId,
          stitchResult:         s.stitchResult,
          intentMessages:       messages,
          intentEnrichedBrief:  enrichedBrief,
        };
        fetch(`/api/projects/${_currentProjectSlug}/substage-snapshot`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stageId:    "preparation",
            subStageId: "intent",
            snapshot,
          }),
        }).catch((err) => console.error("[pipeline-store] intent snapshot error:", err));
      },

      saveSubStageSnapshotForSubStage: (stageId: string, subStageId: string) => {
        if (!_currentProjectSlug) return;
        const s = get();
        const snapshot = {
          featureBrief:         s.featureBrief,
          currentStep:          s.currentStep,
          activeTab:            s.activeTab,
          totalCostUsd:         s.totalCostUsd,
          isRunning:            false,
          fastFromPrd:          s.fastFromPrd,
          codeOutputDir:        s.codeOutputDir,
          steps:                s.steps as Record<string, unknown>,
          designStyles:         s.designStyles,
          designStylesLoading:  false,
          designStylesError:    s.designStylesError,
          selectedDesignStyleId: s.selectedDesignStyleId,
          stitchResult:         s.stitchResult,
        };
        fetch(`/api/projects/${_currentProjectSlug}/substage-snapshot`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId, subStageId, snapshot }),
        }).catch((err) => console.error(`[pipeline-store] eager snapshot error (${stageId}/${subStageId}):`, err));
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
  data?: Partial<StepResult> & { chunk?: string; chunkType?: "thinking" | "content" };
};

/** Stable session id linking pipeline + kickoff for memory records. */
function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "ses-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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
    scheduleSync(get);
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
    set({ steps, currentStep: stepId, activeTab: stepId, streamingContent: "", streamingThinking: "" });
  }

  if (payload.type === "step_stream") {
    const { chunk = "", chunkType } = payload.data ?? {};
    if (chunkType === "thinking") {
      set({ streamingThinking: get().streamingThinking + chunk });
    } else {
      set({ streamingContent: get().streamingContent + chunk });
    }
    return;
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
    console.log(`[SSE step_complete][${stepId}] full content:`, stepData.content);

    // Persist a full substage snapshot so the user can revisit this sub-stage later.
    saveSubStageSnapshot(get, stepId);

    // Mark substage as completed in status table
    const statusMapping = STEP_TO_STAGE_SUBSTAGE[stepId];
    if (statusMapping && _currentProjectSlug) {
      saveSubStageStatus(_currentProjectSlug, statusMapping.stage, statusMapping.subStage, "completed", {
        stepIds: [stepId],
      });
    }

    // When the intent step completes, extract AI-generated project_name and
    // update the stage store so the sidebar immediately reflects the name.
    if (stepId === "intent" && stepData.content) {
      try {
        const parsed = JSON.parse(stepData.content) as { project_name?: string };
        if (parsed.project_name && parsed.project_name.trim()) {
          // Lazy-import to avoid circular dependency
          import("@/store/stage-store").then(({ useStageStore }) => {
            useStageStore.getState().setProjectName(parsed.project_name!.trim());
          }).catch(() => {/* ignore */});
        }
      } catch {
        /* content may not be JSON during error scenarios */
      }
    }
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
