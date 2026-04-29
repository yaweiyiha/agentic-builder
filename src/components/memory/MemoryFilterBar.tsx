"use client";

import { useState } from "react";

import {
  SUPPORTED_KINDS,
  useMemoryStore,
  type StatusFilter,
} from "@/store/memory-store";
import type { MemoryKind } from "@/lib/memory/types";

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "shadow", label: "Shadow" },
  { key: "deprecated", label: "Deprecated" },
  { key: "approved", label: "Approved" },
];

export default function MemoryFilterBar() {
  const filterStatus = useMemoryStore((s) => s.filterStatus);
  const filterKind = useMemoryStore((s) => s.filterKind);
  const search = useMemoryStore((s) => s.search);
  const total = useMemoryStore((s) => s.total);
  const setFilterStatus = useMemoryStore((s) => s.setFilterStatus);
  const setFilterKind = useMemoryStore((s) => s.setFilterKind);
  const setSearch = useMemoryStore((s) => s.setSearch);
  const fetchList = useMemoryStore((s) => s.fetchList);
  const runAttribution = useMemoryStore((s) => s.runAttribution);
  const attributionRunning = useMemoryStore((s) => s.attributionRunning);
  const attributionResult = useMemoryStore((s) => s.attributionResult);
  const attributionError = useMemoryStore((s) => s.attributionError);
  const dismissAttribution = useMemoryStore((s) => s.dismissAttribution);

  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="border-b border-[var(--border)] bg-white">
      <div className="flex flex-wrap items-center gap-3 px-6 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilterStatus(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filterStatus === t.key
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "text-[var(--muted-secondary)] hover:bg-gray-100 hover:text-[var(--foreground)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={attributionRunning}
            onClick={() => {
              setConfirmReset(false);
              void runAttribution({ resetCursor: confirmReset });
            }}
            title="Apply outcome attribution: bump scores up/down based on which patterns were injected into completed/failed tasks."
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {attributionRunning ? "Running…" : "Run Attribution"}
          </button>
          <label className="flex items-center gap-1 text-xs text-[var(--muted-secondary)]">
            <input
              type="checkbox"
              checked={confirmReset}
              onChange={(e) => setConfirmReset(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            reset cursor
          </label>

          <select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as MemoryKind | "all")}
            className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--foreground)]"
          >
            <option value="all">All kinds</option>
            {SUPPORTED_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void fetchList();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title / body / tags…"
              className="w-64 rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm placeholder:text-[var(--muted-secondary)] focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Search
            </button>
          </form>

          <span className="text-xs text-[var(--muted-secondary)]">
            {total} record{total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {(attributionResult || attributionError) && (
        <AttributionResultBanner
          result={attributionResult}
          error={attributionError}
          onDismiss={dismissAttribution}
        />
      )}
    </div>
  );
}

function AttributionResultBanner({
  result,
  error,
  onDismiss,
}: {
  result: ReturnType<typeof useMemoryStore.getState>["attributionResult"];
  error: string | null;
  onDismiss: () => void;
}) {
  if (error) {
    return (
      <div className="flex items-start justify-between gap-4 border-t border-rose-200 bg-rose-50 px-6 py-2 text-sm text-rose-800">
        <div>
          <span className="font-medium">Attribution failed:</span> {error}
        </div>
        <button
          onClick={onDismiss}
          className="text-rose-700 hover:text-rose-900"
        >
          ✕
        </button>
      </div>
    );
  }
  if (!result) return null;
  const moved = result.attributions.filter((a) => !a.immune && a.delta !== 0).length;
  return (
    <div className="flex items-start justify-between gap-4 border-t border-emerald-200 bg-emerald-50 px-6 py-2 text-sm text-emerald-900">
      <div>
        <span className="font-medium">Attribution complete.</span>{" "}
        Considered {result.stats.taskHistoryConsidered} tasks · attributed{" "}
        {result.stats.newlyAttributedPairs} new pair(s) · touched{" "}
        {result.stats.patternsTouched} pattern(s) · applied{" "}
        <span className="font-mono">{result.applied}</span> score change(s).
        {moved > 0 && (
          <span className="ml-1 text-emerald-700">
            ({moved} moved, others were immune or net-zero.)
          </span>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-emerald-700 hover:text-emerald-900"
      >
        ✕
      </button>
    </div>
  );
}
