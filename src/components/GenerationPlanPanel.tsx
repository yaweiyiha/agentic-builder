"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import MarkdownRenderer from "./MarkdownRenderer";
import Loading from "./Loading";
import type { ProjectTier } from "@/lib/agents/project-classifier";
import type { PipelineStepId } from "@/lib/pipeline/types";
import {
  parallelDocBlueprintsForTier,
  SKIPPED_LABELS_BY_TIER,
} from "@/lib/pipeline/parallel-doc-plan";
import PrdSpecWireframesSection, {
  parsePrdStepMetadata,
} from "@/components/PrdSpecWireframesSection";
import { formatPrdSpecForContext } from "@/lib/requirements/prd-spec-extractor";

interface DocPlan {
  id: string;
  label: string;
  estimatedTokens: number;
  estimatedCost: number;
  selected: boolean;
}

export interface ParallelDocResult {
  content: string;
  costUsd: number;
  durationMs: number;
  tokens: number;
  error?: string;
  progressLog?: string[];
  artifactUrls?: string[];
}

type GenerationStatus = "planning" | "generating" | "completed";

interface GenerationPlanPanelProps {
  tier: ProjectTier;
  prdContent: string;
  sessionId: string;
  /** Document IDs selected for parallel generation (drives checkboxes and prep tabs). */
  selectedParallelDocIds: PipelineStepId[];
  onToggleParallelDoc: (id: PipelineStepId) => void;
  /** Increment to start parallel generation from the planning view (command bar). */
  startGenerationNonce: number;
  onBusyChange?: (busy: boolean) => void;
  /** Fired once when all streamed documents finish (before user continues to kick-off). */
  onGenerationStreamFinished?: (results: Record<string, ParallelDocResult>) => void;
  /** From `steps.prd.metadata` — shown after PRD confirmation, before the document plan. */
  prdMetadata?: Record<string, unknown>;
  /** Code output directory — forwarded to the API so Pencil can save .pen files to disk. */
  codeOutputDir?: string;
}

export default function GenerationPlanPanel({
  tier,
  prdContent,
  sessionId,
  selectedParallelDocIds,
  onToggleParallelDoc,
  startGenerationNonce,
  onBusyChange,
  onGenerationStreamFinished,
  prdMetadata,
  codeOutputDir,
}: GenerationPlanPanelProps) {
  const docs: DocPlan[] = parallelDocBlueprintsForTier(tier).map((b) => ({
    ...b,
    selected: selectedParallelDocIds.includes(b.id),
  }));
  const [status, setStatus] = useState<GenerationStatus>("planning");
  const [docStatuses, setDocStatuses] = useState<Record<string, "pending" | "generating" | "completed" | "error">>({});
  const [docResults, setParallelDocResults] = useState<Record<string, ParallelDocResult>>({});
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const docResultsRef = useRef(docResults);
  const finishedEmittedRef = useRef(false);
  const lastNonceHandledRef = useRef(0);
  /** Synchronously merged during SSE so generation_complete sees the full map before React re-renders. */
  const streamResultsRef = useRef<Record<string, ParallelDocResult>>({});

  docResultsRef.current = docResults;

  const toggleDoc = (id: string) => {
    onToggleParallelDoc(id as PipelineStepId);
  };

  const selectedDocs = docs.filter((d) => d.selected);
  const estTotalTokens = selectedDocs.reduce((s, d) => s + d.estimatedTokens, 0);
  const estTotalCost = selectedDocs.reduce((s, d) => s + d.estimatedCost, 0);

  const handleStreamEvent = useCallback(
    (payload: Record<string, unknown>) => {
      const type = payload.type as string;

      if (type === "doc_start") {
        const docId = payload.docId as string;
        setDocStatuses((prev) => ({ ...prev, [docId]: "generating" }));
      }

      if (type === "doc_complete") {
        const docId = payload.docId as string;
        const entry: ParallelDocResult = {
          content: payload.content as string,
          costUsd: payload.costUsd as number,
          durationMs: payload.durationMs as number,
          tokens: payload.tokens as number,
          progressLog: docResultsRef.current[docId]?.progressLog ?? [],
          artifactUrls: docResultsRef.current[docId]?.artifactUrls ?? [],
        };
        streamResultsRef.current = { ...streamResultsRef.current, [docId]: entry };
        setDocStatuses((prev) => ({ ...prev, [docId]: "completed" }));
        setParallelDocResults((prev) => ({ ...prev, [docId]: entry }));
      }

      if (type === "doc_error") {
        const docId = payload.docId as string;
        const entry: ParallelDocResult = {
          content: "",
          costUsd: 0,
          durationMs: 0,
          tokens: 0,
          error: payload.error as string,
          progressLog: docResultsRef.current[docId]?.progressLog ?? [],
          artifactUrls: docResultsRef.current[docId]?.artifactUrls ?? [],
        };
        streamResultsRef.current = { ...streamResultsRef.current, [docId]: entry };
        setDocStatuses((prev) => ({ ...prev, [docId]: "error" }));
        setParallelDocResults((prev) => ({ ...prev, [docId]: entry }));
      }

      if (type === "doc_progress") {
        const docId = payload.docId as string;
        const event = (payload.event ?? {}) as {
          type?: string;
          message?: string;
          toolName?: string;
          result?: string;
          artifactUrl?: string;
          artifactUrls?: string[];
        };
        const line =
          event.type === "tool_call_start"
            ? `→ ${event.toolName}: ${JSON.stringify((payload.event as { args?: unknown })?.args ?? {})}`
            : event.type === "tool_call_result"
              ? `${event.toolName} ${event.result ? `· ${event.result}` : ""}`
              : event.message || event.result || event.type || "progress";
        setParallelDocResults((prev) => {
          const current = prev[docId] ?? {
            content: "",
            costUsd: 0,
            durationMs: 0,
            tokens: 0,
            progressLog: [],
            artifactUrls: [],
          };
          const next: ParallelDocResult = {
            ...current,
            progressLog: [...(current.progressLog ?? []), line].slice(-80),
            artifactUrls: [
              ...new Set([
                ...(current.artifactUrls ?? []),
                ...(event.artifactUrl ? [event.artifactUrl] : []),
                ...((event.artifactUrls ?? []).filter(Boolean) as string[]),
              ]),
            ],
          };
          streamResultsRef.current = { ...streamResultsRef.current, [docId]: next };
          return { ...prev, [docId]: next };
        });
      }

      if (type === "generation_complete") {
        setStatus("completed");
        setTotalCost(payload.totalCostUsd as number);
        setTotalTokens(payload.totalTokens as number);
        onBusyChange?.(false);
        if (!finishedEmittedRef.current) {
          finishedEmittedRef.current = true;
          onGenerationStreamFinished?.({ ...streamResultsRef.current });
        }
      }
    },
    [onBusyChange, onGenerationStreamFinished],
  );

  const startGeneration = useCallback(async () => {
    const selected = [...selectedParallelDocIds];
    if (selected.length === 0) return;

    finishedEmittedRef.current = false;
    streamResultsRef.current = {};
    onBusyChange?.(true);
    setStatus("generating");

    const initialStatuses: Record<string, "pending"> = {};
    for (const id of selected) initialStatuses[id] = "pending";
    setDocStatuses(initialStatuses);

    try {
      let pencilAugmentMarkdown: string | undefined;
      if (selected.includes("pencil")) {
        const { prdSpec } = parsePrdStepMetadata(prdMetadata);
        if (prdSpec?.pages?.length) {
          pencilAugmentMarkdown = formatPrdSpecForContext(prdSpec);
        }
      }

      const resp = await fetch("/api/agents/parallel-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prdContent,
          selectedDocs: selected,
          sessionId,
          codeOutputDir,
          pencilAugmentMarkdown,
        }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error("Generation request failed");
      }

      const reader = resp.body.getReader();
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
            handleStreamEvent(payload);
          } catch {
            // skip malformed
          }
        }
      }

      if (buffer.startsWith("data: ")) {
        try {
          handleStreamEvent(JSON.parse(buffer.slice(6)));
        } catch { /* skip */ }
      }

      if (!finishedEmittedRef.current) {
        finishedEmittedRef.current = true;
        setStatus("completed");
        onBusyChange?.(false);
        onGenerationStreamFinished?.({ ...streamResultsRef.current });
      }
    } catch {
      setStatus("completed");
      onBusyChange?.(false);
      if (!finishedEmittedRef.current) {
        finishedEmittedRef.current = true;
        onGenerationStreamFinished?.({ ...streamResultsRef.current });
      }
    }
  }, [
    selectedParallelDocIds,
    prdContent,
    sessionId,
    codeOutputDir,
    prdMetadata,
    handleStreamEvent,
    onBusyChange,
    onGenerationStreamFinished,
  ]);

  useEffect(() => {
    if (startGenerationNonce === 0) {
      lastNonceHandledRef.current = 0;
    }
  }, [startGenerationNonce]);

  useEffect(() => {
    if (startGenerationNonce <= 0) return;
    if (startGenerationNonce === lastNonceHandledRef.current) return;
    if (status !== "planning") return;
    lastNonceHandledRef.current = startGenerationNonce;
    void startGeneration();
  }, [startGenerationNonce, status, startGeneration]);

  const completedCount = Object.values(docStatuses).filter((s) => s === "completed").length;
  const totalCount = Object.keys(docStatuses).length;
  const allDone = status === "completed";
  const previewContent = previewDocId
    ? docResults[previewDocId]?.content ||
      (docResults[previewDocId]?.progressLog?.length
        ? ["# Live Progress", "", ...(docResults[previewDocId]?.progressLog ?? []).map((line) => `- ${line}`)].join("\n")
        : null)
    : null;

  const { prdSpec } = parsePrdStepMetadata(prdMetadata);

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6">
      <PrdSpecWireframesSection
        prdSpec={prdSpec}
        intro="Shown after PRD confirmation. Use pages and CMP-* IDs to align parallel docs and coding tasks."
      />
      {status === "planning" && (
        <PlanView
          docs={docs}
          tier={tier}
          skippedLabels={SKIPPED_LABELS_BY_TIER[tier]}
          estTotalTokens={estTotalTokens}
          estTotalCost={estTotalCost}
          onToggle={toggleDoc}
        />
      )}

      {(status === "generating" || status === "completed") && (
        <ProgressView
          docs={docs.filter((d) => d.selected)}
          docStatuses={docStatuses}
          docResults={docResults}
          completedCount={completedCount}
          totalCount={totalCount}
          totalCost={totalCost}
          totalTokens={totalTokens}
          allDone={allDone}
          previewDocId={previewDocId}
          previewContent={previewContent}
          onSelectPreview={setPreviewDocId}
        />
      )}
    </div>
  );
}

function PlanView({
  docs,
  tier,
  skippedLabels,
  estTotalTokens,
  estTotalCost,
  onToggle,
}: {
  docs: DocPlan[];
  tier: ProjectTier;
  skippedLabels: string[];
  estTotalTokens: number;
  estTotalCost: number;
  onToggle: (id: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]">
        <div className="mb-6">
          <h2 className="text-[22px] font-semibold tracking-tight text-zinc-900">
            Generation Plan
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
            Based on your PRD (Tier {tier}), the following documents will be
            generated in parallel.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Document
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Est. tokens
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Est. cost
                </th>
                <th className="w-[100px] px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Include
                </th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr
                  key={doc.id}
                  className={`border-b border-zinc-100 transition-colors last:border-b-0 ${doc.selected ? "bg-white" : "bg-zinc-50/40"}`}
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex min-w-[52px] justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          doc.selected
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-zinc-200 text-zinc-600"
                        }`}
                        aria-hidden
                      >
                        {doc.selected ? "On" : "Off"}
                      </span>
                      <label
                        htmlFor={`plan-include-${doc.id}`}
                        className={`cursor-pointer font-medium ${doc.selected ? "text-zinc-900" : "text-zinc-400"}`}
                      >
                        {doc.label}
                      </label>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-zinc-600">
                    ~{doc.estimatedTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-zinc-600">
                    ~${doc.estimatedCost.toFixed(4)}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <input
                      id={`plan-include-${doc.id}`}
                      type="checkbox"
                      checked={doc.selected}
                      onChange={() => onToggle(doc.id)}
                      className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                      aria-label={`Include ${doc.label}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-emerald-50/90">
                <td className="px-4 py-3.5 text-[13px] font-semibold text-emerald-900">
                  Total (selected)
                </td>
                <td className="px-4 py-3.5 text-right text-[13px] font-semibold tabular-nums text-emerald-900">
                  ~{estTotalTokens.toLocaleString()} tok
                </td>
                <td className="px-4 py-3.5 text-right text-[13px] font-semibold tabular-nums text-emerald-800">
                  ~${estTotalCost.toFixed(2)}
                </td>
                <td className="px-4 py-3.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {skippedLabels.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="mt-0.5 shrink-0 text-zinc-400"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span className="text-[13px] leading-relaxed text-zinc-600">
            {skippedLabels.join(", ")} skipped for Tier {tier} projects.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
        <p className="text-[13px] font-semibold text-zinc-900">Start generation</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600">
          Type{" "}
          <span className="rounded bg-zinc-100 px-1.5 font-mono font-semibold text-zinc-900">
            continue
          </span>{" "}
          in the command bar (with at least one document included). Toggle rows
          in the table first if needed.
        </p>
      </div>
    </motion.div>
  );
}

function ProgressView({
  docs,
  docStatuses,
  docResults,
  completedCount,
  totalCount,
  totalCost,
  totalTokens,
  allDone,
  previewDocId,
  previewContent,
  onSelectPreview,
}: {
  docs: DocPlan[];
  docStatuses: Record<string, string>;
  docResults: Record<string, ParallelDocResult>;
  completedCount: number;
  totalCount: number;
  totalCost: number;
  totalTokens: number;
  allDone: boolean;
  previewDocId: string | null;
  previewContent: string | null | undefined;
  onSelectPreview: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-7 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]">
        <div className="mb-6">
          <h2 className="text-[22px] font-semibold tracking-tight text-zinc-900">
            {allDone ? "Generation complete" : "Generating documents"}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
            {allDone
              ? `${completedCount}/${totalCount} documents generated. Total: ${totalTokens.toLocaleString()} tokens · $${totalCost.toFixed(4)}`
              : `Progress: ${completedCount}/${totalCount} complete`}
          </p>
        </div>

        <div className="space-y-2.5">
          {docs.map((doc) => {
            const st = docStatuses[doc.id] ?? "pending";
            const result = docResults[doc.id];
            const isSelected = previewDocId === doc.id;

            return (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 shadow-sm transition-colors ${
                  isSelected
                    ? "border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-200/60"
                    : "border-zinc-200/90 bg-white"
                } ${st === "completed" || st === "generating" ? "cursor-pointer hover:border-indigo-200" : ""}`}
                onClick={() => {
                  if (st === "completed" || st === "generating") {
                    onSelectPreview(isSelected ? null : doc.id);
                  }
                }}
              >
                {st === "completed" && (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="shrink-0 text-emerald-500"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="9 12 11.5 14.5 15 10" />
                  </svg>
                )}
                {st === "generating" && (
                  <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
                )}
                {st === "pending" && (
                  <div className="h-4 w-4 shrink-0 rounded-full border-2 border-zinc-300" />
                )}
                {st === "error" && (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="shrink-0 text-red-500"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M15 9l-6 6M9 9l6 6" />
                  </svg>
                )}

                <span
                  className={`min-w-0 flex-1 text-[13px] font-medium ${st === "completed" ? "text-zinc-900" : "text-zinc-500"}`}
                >
                  {doc.label}
                </span>

                {st === "completed" && result && (
                  <div className="flex shrink-0 gap-3 tabular-nums text-[11px] text-zinc-500">
                    <span>{result.tokens.toLocaleString()} tok</span>
                    <span>${result.costUsd.toFixed(4)}</span>
                    <span>{(result.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
                {st === "generating" && (
                  <span className="shrink-0 text-[11px] font-medium text-indigo-600">
                    {doc.id === "pencil" ? "Drawing…" : "Generating…"}
                  </span>
                )}
                {st === "error" && result?.error && (
                  <span className="max-w-[200px] shrink-0 truncate text-[11px] text-red-600">
                    {result.error}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {previewContent && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-sm [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              <MarkdownRenderer content={previewContent} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {allDone && (
        <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[13px] font-semibold text-zinc-900">Continue to kick-off</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600">
            Type{" "}
            <span className="rounded bg-zinc-100 px-1.5 font-mono font-semibold text-zinc-900">
              continue
            </span>{" "}
            in the command bar to write artifacts and run the kick-off step.
          </p>
        </div>
      )}
    </div>
  );
}
