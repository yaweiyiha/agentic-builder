"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import Loading from "@/components/Loading";

type Tab = "session" | "scorecard" | "leaderboard";

interface TabDef {
  id: Tab;
  label: string;
  icon: React.ReactNode;
}

function ClipboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

interface ReportTabViewProps {
  sessionMarkdown: string | null;
  scorecardMarkdown: string | null;
  leaderboardMarkdown: string | null;
  loading: boolean;
  error: string | null;
}

const TABS: TabDef[] = [
  { id: "session",      label: "Session Report",  icon: <ClipboardIcon /> },
  { id: "scorecard",   label: "Model Scorecard",  icon: <StarIcon /> },
  { id: "leaderboard", label: "Leaderboard",      icon: <TrophyIcon /> },
];

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-zinc-300">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" />
        </svg>
      </div>
      <p className="text-[13px] text-zinc-400">{message}</p>
    </div>
  );
}

export default function ReportTabView({
  sessionMarkdown,
  scorecardMarkdown,
  leaderboardMarkdown,
  loading,
  error,
}: ReportTabViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("session");

  const contentMap: Record<Tab, string | null> = {
    session: sessionMarkdown,
    scorecard: scorecardMarkdown,
    leaderboard: leaderboardMarkdown,
  };

  const currentContent = contentMap[activeTab];

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-4">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const hasContent = !!contentMap[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-4 py-3 text-[12px] font-medium transition-colors ${
                isActive
                  ? "text-zinc-900"
                  : hasContent
                    ? "text-zinc-400 hover:text-zinc-700"
                    : "cursor-default text-zinc-300"
              }`}
              disabled={!hasContent && !loading}
              title={!hasContent ? "Not available for this session" : undefined}
            >
              <span className={isActive ? "text-indigo-500" : ""}>{tab.icon}</span>
              {tab.label}
              {!hasContent && !loading && (
                <span className="ml-1 text-[9px] text-zinc-300">—</span>
              )}
              {isActive && (
                <motion.span
                  layoutId="report-tab-underline"
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-indigo-500"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-8 py-6 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
        {loading && (
          <div className="flex justify-center py-20">
            <Loading size="sm" text="Loading report…" />
          </div>
        )}
        {!loading && error && (
          <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-red-50 p-6">
            <p className="text-sm font-semibold text-red-600">Could not load report</p>
            <p className="mt-1 text-xs text-red-500">{error}</p>
          </div>
        )}
        <AnimatePresence mode="wait">
          {!loading && !error && (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="mx-auto max-w-4xl"
            >
              {currentContent ? (
                <MarkdownRenderer content={currentContent} />
              ) : (
                <EmptyState
                  message={
                    activeTab === "scorecard"
                      ? "Model scorecard not available. Run a coding session first."
                      : activeTab === "leaderboard"
                        ? "Leaderboard not available. Run at least one coding session first."
                        : "No session report available yet."
                  }
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
