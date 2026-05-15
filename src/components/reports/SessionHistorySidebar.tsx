"use client";

import { motion } from "motion/react";

export interface HistoryEntry {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  status: string;
  score: number;
  grade: string;
  archiveMdFile: string;
}

interface SessionHistorySidebarProps {
  history: HistoryEntry[];
  activeSessionId: string | null;
  onSelect: (sessionId: string | null) => void;
  loading: boolean;
}

function gradeColor(grade: string): string {
  if (grade === "A") return "text-emerald-600";
  if (grade === "B") return "text-sky-600";
  if (grade === "C") return "text-amber-600";
  if (grade === "D") return "text-orange-500";
  return "text-red-500";
}

function statusDot(status: string): string {
  if (status === "pass") return "bg-emerald-500";
  if (status === "aborted") return "bg-amber-400";
  return "bg-red-400";
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SessionHistorySidebar({
  history,
  activeSessionId,
  onSelect,
  loading,
}: SessionHistorySidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
      <div className="border-b border-zinc-200 px-4 py-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
          Session History
        </h2>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1">
        {/* Latest shortcut */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] transition-colors ${
            activeSessionId === null
              ? "bg-white shadow-sm ring-1 ring-zinc-200 text-zinc-900"
              : "text-zinc-500 hover:bg-white hover:text-zinc-800"
          }`}
        >
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
          <span className="font-medium">Latest</span>
        </button>

        {loading && (
          <div className="px-3 py-4 text-[11px] text-zinc-400">Loading…</div>
        )}

        {!loading && history.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-zinc-400">
            No sessions yet.
          </div>
        )}

        {history.map((entry, i) => {
          const isActive = activeSessionId === entry.sessionId;
          return (
            <motion.button
              key={entry.sessionId}
              type="button"
              onClick={() => onSelect(entry.sessionId)}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
                isActive
                  ? "bg-white shadow-sm ring-1 ring-zinc-200 text-zinc-900"
                  : "text-zinc-500 hover:bg-white hover:text-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(entry.status)}`}
                  />
                  <span className={`text-[12px] font-bold ${gradeColor(entry.grade)}`}>
                    {entry.score}/{entry.grade}
                  </span>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    entry.status === "pass"
                      ? "bg-emerald-50 text-emerald-600"
                      : entry.status === "aborted"
                        ? "bg-amber-50 text-amber-600"
                        : "bg-red-50 text-red-500"
                  }`}
                >
                  {entry.status}
                </span>
              </div>
              <span className="truncate text-[10px] text-zinc-400">
                {fmtDate(entry.endedAt)}
              </span>
            </motion.button>
          );
        })}
      </nav>
    </aside>
  );
}
