"use client";

import { useCallback, useEffect, useState } from "react";
import SessionHistorySidebar, {
  type HistoryEntry,
} from "@/components/reports/SessionHistorySidebar";
import ReportTabView from "@/components/reports/ReportTabView";

interface ReportPayload {
  markdown: string | null;
  scorecardMarkdown: string | null;
  leaderboardMarkdown: string | null;
  outputDir: string;
  history: HistoryEntry[];
}

export default function ReportsPage() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback((sessionId: string | null) => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (sessionId) params.set("sessionId", sessionId);

    fetch(`/api/agents/coding/report?${params.toString()}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = (await res.json()) as ReportPayload & { error?: string };
        if (!res.ok) {
          setError(data.error ?? `Failed to load report (${res.status})`);
          // Keep history from last successful load if available.
          setPayload((prev) =>
            prev ? { ...prev, markdown: null, scorecardMarkdown: null, leaderboardMarkdown: null } : null,
          );
          return;
        }
        setPayload(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchReport(null);
  }, [fetchReport]);

  const handleSelect = useCallback(
    (sessionId: string | null) => {
      setActiveSessionId(sessionId);
      fetchReport(sessionId);
    },
    [fetchReport],
  );

  const history = payload?.history ?? [];

  return (
    <div className="flex h-[calc(100vh-72px)] overflow-hidden bg-white">
      <SessionHistorySidebar
        history={history}
        activeSessionId={activeSessionId}
        onSelect={handleSelect}
        loading={loading && history.length === 0}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6 py-3">
          <div>
            <h1 className="text-[15px] font-semibold text-zinc-900">
              {activeSessionId ? "Session Report" : "Latest Report"}
            </h1>
            {payload?.outputDir && (
              <p className="mt-0.5 font-mono text-[10px] text-zinc-400 truncate max-w-xl">
                {payload.outputDir}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => fetchReport(activeSessionId)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
            Refresh
          </button>
        </div>

        <ReportTabView
          sessionMarkdown={payload?.markdown ?? null}
          scorecardMarkdown={payload?.scorecardMarkdown ?? null}
          leaderboardMarkdown={payload?.leaderboardMarkdown ?? null}
          loading={loading}
          error={error}
        />
      </main>
    </div>
  );
}
