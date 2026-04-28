"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useMemoryStore } from "@/store/memory-store";
import { getKindSpec } from "@/lib/memory/schemas";
import type { MemoryRecord } from "@/lib/memory/types";
import SuggestionBanner from "./SuggestionBanner";

export default function MemoryRecordDetail() {
  const activeId = useMemoryStore((s) => s.activeId);
  const record = useMemoryStore((s) => s.activeRecord);
  const loading = useMemoryStore((s) => s.detailLoading);
  const error = useMemoryStore((s) => s.detailError);

  if (!activeId) {
    return (
      <Empty>
        Select a record on the left to view its details.
      </Empty>
    );
  }
  if (loading && !record) return <Empty>Loading…</Empty>;
  if (error) return <Empty tone="error">{error}</Empty>;
  if (!record) return <Empty>(no record)</Empty>;
  return <Detail record={record} />;
}

function Detail({ record }: { record: MemoryRecord }) {
  const approve = useMemoryStore((s) => s.approve);
  const disapprove = useMemoryStore((s) => s.disapprove);
  const patchRecord = useMemoryStore((s) => s.patchRecord);
  const deleteRecord = useMemoryStore((s) => s.deleteRecord);

  const [editMode, setEditMode] = useState(false);
  const [draftBody, setDraftBody] = useState(record.body);
  const [busy, setBusy] = useState<string | null>(null);

  // Reset draft when active record changes.
  useEffect(() => {
    setEditMode(false);
    setDraftBody(record.body);
  }, [record.id, record.body]);

  const spec = getKindSpec(record.kind);
  const isMarkdown = spec.format === "markdown";
  const approved = record.tags.includes("manual:approved");
  const score = record.metrics.score ?? 0;

  async function withBusy(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-[var(--border)] bg-white px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-[var(--foreground)] line-clamp-2">
              {record.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-secondary)]">
              <span className="font-mono">{record.id}</span>
              <span>·</span>
              <span>
                {record.layer} / {record.kind}
              </span>
              <span>·</span>
              <span>source: {record.source}</span>
              <span>·</span>
              <span>hits {record.metrics.hits ?? 0}</span>
              {record.metrics.lastHitAt && (
                <>
                  <span>·</span>
                  <span title={new Date(record.metrics.lastHitAt).toISOString()}>
                    last hit {timeAgo(record.metrics.lastHitAt)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <SuggestionBanner record={record} />

        <ScoreRow
          score={score}
          approved={approved}
          onChange={(next) =>
            withBusy("score", async () => {
              await patchRecord(record.id, { score: next });
            })
          }
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ActionBtn
            onClick={() =>
              withBusy("approve", async () => {
                await approve(record.id);
              })
            }
            disabled={!!busy || approved}
            tone="primary"
          >
            {busy === "approve" ? "Approving…" : approved ? "Approved ✓" : "Approve"}
          </ActionBtn>
          <ActionBtn
            onClick={() =>
              withBusy("disapprove", async () => {
                await disapprove(record.id);
              })
            }
            disabled={!!busy || (!approved && score === 0)}
          >
            {busy === "disapprove" ? "Disapproving…" : "Disapprove"}
          </ActionBtn>
          <ActionBtn
            onClick={() => setEditMode((m) => !m)}
            disabled={!!busy}
          >
            {editMode ? "Cancel" : "Edit"}
          </ActionBtn>
          {editMode && (
            <ActionBtn
              tone="primary"
              disabled={busy === "save" || draftBody === record.body}
              onClick={() =>
                withBusy("save", async () => {
                  const ok = await patchRecord(record.id, { body: draftBody });
                  if (ok) setEditMode(false);
                })
              }
            >
              {busy === "save" ? "Saving…" : "Save"}
            </ActionBtn>
          )}
          <ActionBtn
            tone="danger"
            disabled={!!busy}
            onClick={() => {
              if (!confirm(`Delete ${record.id}? This cannot be undone.`)) return;
              void withBusy("delete", async () => {
                await deleteRecord(record.id);
              });
            }}
          >
            Delete
          </ActionBtn>
        </div>

        <TagChips tags={record.tags} />
      </header>

      <div className="flex-1 overflow-y-auto bg-[#fbfbfb] px-6 py-6">
        {editMode ? (
          <EditPane value={draftBody} onChange={setDraftBody} isMarkdown={isMarkdown} />
        ) : isMarkdown ? (
          <article className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{record.body}</ReactMarkdown>
          </article>
        ) : (
          <JsonView body={record.body} />
        )}
      </div>
    </div>
  );
}

function ScoreRow({
  score,
  approved,
  onChange,
}: {
  score: number;
  approved: boolean;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState(score);
  useEffect(() => {
    setDraft(score);
  }, [score]);
  const layer =
    approved || draft >= 0.3
      ? { name: "active", cls: "bg-emerald-100 text-emerald-700" }
      : draft < 0
        ? { name: "deprecated", cls: "bg-rose-100 text-rose-700" }
        : { name: "shadow", cls: "bg-amber-100 text-amber-700" };
  return (
    <div className="mt-3 flex items-center gap-3">
      <span className="text-xs font-medium text-[var(--muted-secondary)] w-12">Score</span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.1}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onMouseUp={() => {
          if (draft !== score) onChange(draft);
        }}
        onTouchEnd={() => {
          if (draft !== score) onChange(draft);
        }}
        className="flex-1 max-w-md"
      />
      <span className="font-mono text-xs tabular-nums w-10 text-[var(--foreground)]">
        {draft.toFixed(2)}
      </span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${layer.cls}`}>
        {approved ? "approved" : layer.name}
      </span>
    </div>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
            t === "manual:approved"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function EditPane({
  value,
  onChange,
  isMarkdown,
}: {
  value: string;
  onChange: (v: string) => void;
  isMarkdown: boolean;
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab("edit")}
          className={`rounded-md px-3 py-1 text-xs font-medium ${
            tab === "edit"
              ? "bg-[var(--foreground)] text-white"
              : "bg-gray-100 text-[var(--muted-secondary)]"
          }`}
        >
          Edit
        </button>
        <button
          onClick={() => setTab("preview")}
          className={`rounded-md px-3 py-1 text-xs font-medium ${
            tab === "preview"
              ? "bg-[var(--foreground)] text-white"
              : "bg-gray-100 text-[var(--muted-secondary)]"
          }`}
        >
          Preview
        </button>
        <span className="ml-auto text-xs text-[var(--muted-secondary)]">
          {isMarkdown ? "Markdown body" : "JSON body (raw text)"}
        </span>
      </div>
      {tab === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block h-[60vh] w-full rounded-md border border-[var(--border)] bg-white p-3 font-mono text-sm leading-relaxed focus:border-[var(--accent)] focus:outline-none"
          spellCheck={false}
        />
      ) : isMarkdown ? (
        <article className="prose prose-sm max-w-none rounded-md border border-[var(--border)] bg-white p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </article>
      ) : (
        <JsonView body={value} />
      )}
    </div>
  );
}

function JsonView({ body }: { body: string }) {
  let pretty = body;
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* keep raw */
  }
  return (
    <pre className="overflow-auto rounded-md border border-[var(--border)] bg-white p-4 font-mono text-xs leading-relaxed text-[var(--foreground)]">
      {pretty}
    </pre>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "danger";
}) {
  const base =
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const cls =
    tone === "primary"
      ? "bg-[var(--accent)] text-white hover:opacity-90"
      : tone === "danger"
        ? "border border-rose-300 text-rose-700 hover:bg-rose-50"
        : "border border-[var(--border)] text-[var(--foreground)] hover:bg-gray-50";
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${cls}`}>
      {children}
    </button>
  );
}

function Empty({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={`flex h-full items-center justify-center px-6 py-12 text-sm ${
        tone === "error" ? "text-rose-600" : "text-[var(--muted-secondary)]"
      }`}
    >
      {children}
    </div>
  );
}

function timeAgo(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
