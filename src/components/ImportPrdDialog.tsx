"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Loading from "@/components/Loading";
import { usePipelineStore } from "@/store/pipeline-store";

interface ImportPrdDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ACCEPTED_EXTS = [".md", ".markdown", ".txt"];
const MAX_BYTES = 500_000;

function isAcceptedFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ImportPrdDialog({
  isOpen,
  onClose,
}: ImportPrdDialogProps) {
  const importedPrd = usePipelineStore((s) => s.importedPrd);
  const loading = usePipelineStore((s) => s.importedPrdLoading);
  const error = usePipelineStore((s) => s.importedPrdError);
  const refreshImportedPrdStatus = usePipelineStore(
    (s) => s.refreshImportedPrdStatus,
  );
  const importPrd = usePipelineStore((s) => s.importPrd);
  const clearImportedPrd = usePipelineStore((s) => s.clearImportedPrd);

  const [draft, setDraft] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    void refreshImportedPrdStatus();
    setLocalError(null);
    setDraft("");
  }, [isOpen, refreshImportedPrdStatus]);

  const isBusy = loading === "saving" || loading === "clearing";

  const readFile = useCallback(async (file: File) => {
    if (!isAcceptedFile(file)) {
      setLocalError(
        `Only .md / .markdown / .txt files are supported (got "${file.name}").`,
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError(
        `File is ${formatBytes(file.size)} — larger than the ${formatBytes(
          MAX_BYTES,
        )} import limit.`,
      );
      return;
    }
    try {
      const text = await file.text();
      setDraft(text);
      setLocalError(null);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Failed to read the file.",
      );
    }
  }, []);

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) await readFile(file);
    },
    [readFile],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (file) await readFile(file);
    },
    [readFile],
  );

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setLocalError("Paste or upload PRD markdown first.");
      return;
    }
    const ok = await importPrd(draft);
    if (ok) {
      setDraft("");
      setLocalError(null);
    }
  }, [draft, importPrd]);

  const handleClear = useCallback(async () => {
    const ok = await clearImportedPrd();
    if (ok) {
      setDraft("");
      setLocalError(null);
    }
  }, [clearImportedPrd]);

  const statusLine = useMemo(() => {
    if (!importedPrd?.exists) return null;
    const updatedAt = importedPrd.updatedAt
      ? new Date(importedPrd.updatedAt).toLocaleString()
      : "—";
    return `Using imported PRD · ${formatBytes(importedPrd.bytes)} · updated ${updatedAt}`;
  }, [importedPrd]);

  const previewHasContent = (importedPrd?.preview?.length ?? 0) > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-8 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border-[1.5px] border-zinc-200 bg-white shadow-lg shadow-zinc-900/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-zinc-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">
                  Import PRD
                </h2>
                <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">
                  Provide an existing PRD (paste or upload) to skip the PRD
                  generation step. Stored at{" "}
                  <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] text-zinc-700">
                    .blueprint/PRD.md
                  </code>{" "}
                  and reused by every run until cleared.
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            {statusLine && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-emerald-50/60 px-6 py-2.5">
                <div className="flex items-center gap-2 text-[12px] text-emerald-800">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  <span>{statusLine}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleClear()}
                  disabled={isBusy}
                  className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading === "clearing" ? "Clearing…" : "Clear imported PRD"}
                </button>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => void handleDrop(e)}
                className={`flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors ${
                  dragActive
                    ? "border-indigo-400 bg-indigo-50/60"
                    : "border-zinc-300 bg-zinc-50"
                }`}
              >
                <div className="flex items-center gap-2 text-[12px] text-zinc-600">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>
                    Drop a{" "}
                    <span className="font-mono text-[11px]">
                      .md / .markdown / .txt
                    </span>{" "}
                    file here or
                  </span>
                </div>
                <label className="cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100">
                  Choose file
                  <input
                    type="file"
                    accept=".md,.markdown,.txt,text/markdown,text/plain"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="prd-import-textarea"
                  className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                >
                  Paste PRD markdown
                </label>
                <textarea
                  id="prd-import-textarea"
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                  placeholder="# PRD: ...\n\n## 1. Overview..."
                  spellCheck={false}
                  className="min-h-[260px] resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                />
                <p className="text-[10.5px] text-zinc-400">
                  Max {formatBytes(MAX_BYTES)}. Next pipeline run will reuse
                  this PRD verbatim and skip PM generation.
                </p>
              </div>

              {importedPrd?.exists && previewHasContent && (
                <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px]">
                  <summary className="cursor-pointer select-none font-medium text-zinc-700">
                    Preview current imported PRD (first 400 chars)
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-700">
                    {importedPrd.preview}
                    {importedPrd.bytes > 400 ? "\n…" : ""}
                  </pre>
                </details>
              )}

              {(localError || error) && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                  {localError || error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                {loading === "loading" && (
                  <Loading size="sm" text="Loading status..." />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isBusy || draft.trim().length === 0}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading === "saving" ? "Saving…" : "Save and use"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
