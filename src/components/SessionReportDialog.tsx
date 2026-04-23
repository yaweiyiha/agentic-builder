"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import Loading from "@/components/Loading";

interface ReportHistoryEntry {
  sessionId: string;
  endedAt: string;
  status: string;
  score: number;
  grade: string;
  archiveMdFile: string;
}

interface ReportPayload {
  markdown: string;
  source: "latest" | "session";
  sessionId: string | null;
  outputDir: string;
  history: ReportHistoryEntry[];
}

interface SessionReportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Absolute or relative output dir. Forwarded to the API. */
  outputDir?: string | null;
}

export default function SessionReportDialog({
  isOpen,
  onClose,
  outputDir,
}: SessionReportDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (outputDir) params.set("outputDir", outputDir);
    if (activeSessionId) params.set("sessionId", activeSessionId);

    fetch(`/api/agents/coding/report?${params.toString()}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? `Failed to load report (${res.status})`);
          setReport(null);
          return;
        }
        setReport(data as ReportPayload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setReport(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, outputDir, activeSessionId]);

  // Reset active session when dialog closes so reopening lands on "latest".
  useEffect(() => {
    if (!isOpen) setActiveSessionId(null);
  }, [isOpen]);

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
            className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-2xl border-[1.5px] border-[var(--border)] bg-[var(--card)] shadow-lg shadow-zinc-900/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  Coding Session Report
                </h2>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
                  {report?.outputDir ?? outputDir ?? "(unknown output dir)"}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
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

            {report && report.history.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-6 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Sessions
                </span>
                <button
                  type="button"
                  onClick={() => setActiveSessionId(null)}
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    activeSessionId === null
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                  }`}
                >
                  Latest
                </button>
                {report.history.slice(0, 8).map((entry) => {
                  const label = `${entry.endedAt.replace(/\..*$/, "").replace("T", " ")} · ${entry.status.toUpperCase()} · ${entry.score}/${entry.grade}`;
                  const selected = activeSessionId === entry.sessionId;
                  return (
                    <button
                      key={entry.sessionId}
                      type="button"
                      onClick={() => setActiveSessionId(entry.sessionId)}
                      title={entry.sessionId}
                      className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                        selected
                          ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                          : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex min-h-0 flex-1 overflow-y-auto p-6">
              {loading && (
                <div className="flex w-full justify-center py-12">
                  <Loading size="sm" text="Loading report..." />
                </div>
              )}
              {!loading && error && (
                <div className="w-full rounded-md border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-medium text-red-700">
                    Could not load report
                  </p>
                  <p className="mt-1 text-xs text-red-600">{error}</p>
                </div>
              )}
              {!loading && !error && report && (
                <MarkdownRenderer
                  content={report.markdown}
                  className="w-full"
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
