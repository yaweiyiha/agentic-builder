"use client";

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

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-white px-6 py-3">
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
  );
}
