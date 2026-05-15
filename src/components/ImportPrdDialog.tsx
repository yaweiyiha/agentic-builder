"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Loading from "@/components/Loading";
import { usePipelineStore } from "@/store/pipeline-store";

interface ImportPrdDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ACCEPTED_EXTS = [".md", ".markdown", ".txt", ".pdf"];
const MAX_BYTES = 500_000;
const MAX_PDF_BYTES = 20_000_000;

function isAcceptedFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function parsePdfToText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
    .promise;

  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Group text items into lines by their Y coordinate.
    // transform[5] is the Y position in PDF coordinate space.
    const lineMap = new Map<number, { x: number; text: string }[]>();
    const Y_THRESHOLD = 2;

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const rawY = (item.transform as number[])[5];
      // Round Y to nearest threshold bucket so near-same-line items merge.
      const bucketY = Math.round(rawY / Y_THRESHOLD) * Y_THRESHOLD;
      const x = (item.transform as number[])[4];
      if (!lineMap.has(bucketY)) lineMap.set(bucketY, []);
      lineMap.get(bucketY)!.push({ x, text: item.str });
    }

    // Sort lines top-to-bottom (PDF Y goes bottom-up, so descending).
    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

    const lines: string[] = [];
    let prevY: number | null = null;

    for (const y of sortedYs) {
      const chunks = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      const lineText = chunks.map((c) => c.text).join("").replace(/ +/g, " ").trim();
      if (!lineText) continue;

      // Insert blank line between paragraphs (large Y gap between lines).
      if (prevY !== null && prevY - y > 20) {
        lines.push("");
      }
      lines.push(lineText);
      prevY = y;
    }

    const pageText = lines.join("\n").trim();
    if (pageText) pageTexts.push(pageText);
  }

  return pageTexts.join("\n\n---\n\n");
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
  const [parsingPdf, setParsingPdf] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    void refreshImportedPrdStatus();
    setLocalError(null);
    setDraft("");
  }, [isOpen, refreshImportedPrdStatus]);

  const isBusy = loading === "saving" || loading === "clearing" || parsingPdf;

  const readFile = useCallback(async (file: File) => {
    if (!isAcceptedFile(file)) {
      setLocalError(
        `Only .md / .markdown / .txt / .pdf files are supported (got "${file.name}").`,
      );
      return;
    }
    const sizeLimit = isPdfFile(file) ? MAX_PDF_BYTES : MAX_BYTES;
    if (file.size > sizeLimit) {
      setLocalError(
        `File is ${formatBytes(file.size)} — larger than the ${formatBytes(sizeLimit)} import limit.`,
      );
      return;
    }
    try {
      let text: string;
      if (isPdfFile(file)) {
        setParsingPdf(true);
        try {
          text = await parsePdfToText(file);
        } finally {
          setParsingPdf(false);
        }
        if (!text.trim()) {
          setLocalError(
            "Could not extract text from this PDF. It may be image-based or encrypted.",
          );
          return;
        }
      } else {
        text = await file.text();
      }
      setDraft(text);
      setLocalError(null);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    } catch (err) {
      setParsingPdf(false);
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/30 p-8 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-[#e2e8f0] bg-white shadow-[0_20px_60px_-12px_rgba(11,28,48,0.14)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="flex items-start justify-between border-b border-[#e2e8f0] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-[#0b1c30]">
                  Import PRD
                </h2>
                <p className="mt-0.5 text-xs leading-snug text-[#64748b]">
                  Provide an existing PRD (paste or upload) to skip the PRD
                  generation step. Stored at{" "}
                  <code className="rounded bg-[#f1f5f9] px-1 py-0.5 font-mono text-[11px] text-[#475569]">
                    .blueprint/PRD.md
                  </code>{" "}
                  and reused by every run until cleared.
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="ml-4 shrink-0 rounded-lg p-1.5 text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0b1c30]"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            {/* ── Active PRD status bar ── */}
            {statusLine && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e2e8f0] bg-emerald-50/70 px-6 py-2.5">
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

            {/* ── Body ── */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
              {/* Drop zone */}
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
                className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 transition-colors ${
                  dragActive
                    ? "border-[#0f172a]/40 bg-[#0f172a]/3"
                    : "border-[#e2e8f0] bg-[#f8f9ff]"
                }`}
              >
                <div className="flex items-center gap-2 text-xs text-[#64748b]">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={dragActive ? "text-[#0f172a]" : "text-[#94a3b8]"}
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {parsingPdf ? (
                    <span className="text-indigo-600">Parsing PDF…</span>
                  ) : (
                    <span>
                      Drop a{" "}
                      <span className="font-mono text-[11px] text-[#475569]">
                        .md / .markdown / .txt / .pdf
                      </span>{" "}
                      file here, or
                    </span>
                  )}
                </div>
                <label
                  className={`cursor-pointer rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-[11px] font-medium text-[#475569] shadow-sm transition-colors hover:bg-[#f8f9ff] hover:text-[#0b1c30] ${parsingPdf ? "pointer-events-none opacity-50" : ""}`}
                >
                  Choose file
                  <input
                    type="file"
                    accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
                    onChange={handleFileInput}
                    disabled={parsingPdf}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Textarea */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="prd-import-textarea"
                  className="text-[10.5px] font-bold uppercase tracking-widest text-[#94a3b8]"
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
                  className="min-h-65 resize-y rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-3 font-mono text-[12px] leading-relaxed text-[#0b1c30] placeholder:text-[#94a3b8] transition-colors focus:border-[#0f172a]/30 focus:outline-none focus:ring-2 focus:ring-[#0f172a]/8"
                />
                <p className="text-[10.5px] text-[#94a3b8]">
                  Max {formatBytes(MAX_BYTES)} for text files, {formatBytes(MAX_PDF_BYTES)} for PDF.
                  PDF text will be extracted automatically. The next pipeline run
                  will reuse this PRD verbatim and skip PM generation.
                </p>
              </div>

              {/* Preview */}
              {importedPrd?.exists && previewHasContent && (
                <details className="rounded-xl border border-[#e2e8f0] bg-[#f8f9ff] px-4 py-2.5 text-xs">
                  <summary className="cursor-pointer select-none font-semibold text-[#475569]">
                    Preview current imported PRD <span className="font-normal text-[#94a3b8]">(first 400 chars)</span>
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap wrap-break-word font-mono text-[11px] leading-relaxed text-[#64748b]">
                    {importedPrd.preview}
                    {importedPrd.bytes > 400 ? "\n…" : ""}
                  </pre>
                </details>
              )}

              {/* Error */}
              {(localError || error) && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600">
                  {localError || error}
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between gap-2 border-t border-[#e2e8f0] bg-[#fafbfc] px-6 py-3">
              <div className="flex items-center gap-2 text-[11px] text-[#94a3b8]">
                {parsingPdf && (
                  <Loading size="sm" text="Extracting text from PDF..." />
                )}
                {!parsingPdf && loading === "loading" && (
                  <Loading size="sm" text="Loading status..." />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className="rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#f8f9ff] hover:text-[#0b1c30] disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isBusy || draft.trim().length === 0}
                  className="rounded-lg bg-[#0f172a] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-50"
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