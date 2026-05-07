"use client";

import { useMemoryStore } from "@/store/memory-store";
import type { MemoryListItem } from "@/store/memory-store";

function StatusBadge({ item }: { item: MemoryListItem }) {
  const text = item.approved
    ? "approved"
    : item.status === "active"
      ? "active"
      : item.status === "shadow"
        ? "shadow"
        : "deprecated";
  const cls =
    text === "approved" || text === "active"
      ? "bg-emerald-100 text-emerald-700"
      : text === "shadow"
        ? "bg-amber-100 text-amber-700"
        : "bg-rose-100 text-rose-700";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {text}
    </span>
  );
}

export default function MemoryListSidebar() {
  const items = useMemoryStore((s) => s.items);
  const loading = useMemoryStore((s) => s.loading);
  const error = useMemoryStore((s) => s.error);
  const activeId = useMemoryStore((s) => s.activeId);
  const setActive = useMemoryStore((s) => s.setActive);

  if (loading && items.length === 0) {
    return <SidebarMessage>Loading records…</SidebarMessage>;
  }
  if (error) {
    return <SidebarMessage tone="error">{error}</SidebarMessage>;
  }
  if (items.length === 0) {
    return (
      <SidebarMessage>
        <div className="space-y-2">
          <p className="font-medium text-[var(--foreground)]">No records yet.</p>
          <p>
            Run <code className="rounded bg-gray-100 px-1 py-0.5 text-[12px]">npm run memory:mine-patterns</code>{" "}
            to seed L1 from <code className="rounded bg-gray-100 px-1 py-0.5 text-[12px]">.ralph/repair-log.jsonl</code>.
          </p>
        </div>
      </SidebarMessage>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border)] overflow-y-auto">
      {items.map((it) => {
        const active = it.id === activeId;
        return (
          <li key={it.id}>
            <button
              onClick={() => setActive(it.id)}
              className={`w-full px-4 py-3 text-left transition-colors ${
                active ? "bg-[var(--accent)]/5" : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-medium text-[var(--foreground)]">
                  {it.title}
                </span>
                <StatusBadge item={it} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-secondary)]">
                <span className="font-mono">{it.id}</span>
                <span>·</span>
                <span>{it.kind}</span>
                {typeof it.occurrences === "number" && (
                  <>
                    <span>·</span>
                    <span>{it.occurrences}× obs</span>
                  </>
                )}
                <span>·</span>
                <span>hits {it.metrics.hits ?? 0}</span>
                <span>·</span>
                <span>score {(it.metrics.score ?? 0).toFixed(2)}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={`px-4 py-6 text-sm ${
        tone === "error" ? "text-rose-600" : "text-[var(--muted-secondary)]"
      }`}
    >
      {children}
    </div>
  );
}
