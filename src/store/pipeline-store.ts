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
  /** User-uploaded design references. Copied to `<outputRoot>/.design-references/` at kickoff. */
  designReferences: DesignReferenceSummary[];
  designReferencesLoading:
    | "idle"
    | "loading"
    | "uploading"
    | "updating"
    | "deleting";
  designReferencesError: string | null;

  setCodeOutputDir: (value: string) => void;
  setFastFromPrd: (value: boolean) => void;
  startPipeline: (featureBrief: string) => void;
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
      designReferences: [],
      designReferencesLoading: "idle",
      designReferencesError: null,

      setCodeOutputDir: (value) => {
        const next = value.trim();
        set({
          codeOutputDir: next.length > 0 ? next : DEFAULT_CODE_OUTPUT_DIR,
        });
      },
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
            pencil: steps.pencil?.content ?? "",
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
  data?: Partial<StepResult> & { chunk?: string; chunkType?: "thinking" | "content" };
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
