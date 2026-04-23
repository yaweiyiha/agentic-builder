"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Loading from "@/components/Loading";
import {
  usePipelineStore,
  type DesignReferenceSummary,
} from "@/store/pipeline-store";

interface DesignReferencesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ACCEPTED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
];
const ACCEPTED_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const MAX_BYTES_PER_FILE = 6 * 1024 * 1024;
const MAX_TOTAL = 24;

function isAcceptedImage(file: File): boolean {
  if (ACCEPTED_MIMES.includes(file.type.toLowerCase())) return true;
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface PendingUpload {
  key: string;
  file: File;
  label: string;
  pageHint: string;
  previewUrl: string;
  error: string | null;
}

function makePreviewUrl(file: File): string {
  return typeof URL !== "undefined" && URL.createObjectURL
    ? URL.createObjectURL(file)
    : "";
}

function ReferenceCard({
  entry,
  onSaveMeta,
  onDelete,
  isBusy,
}: {
  entry: DesignReferenceSummary;
  onSaveMeta: (
    id: string,
    patch: { label?: string; pageHint?: string },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isBusy: boolean;
}) {
  const [label, setLabel] = useState(entry.label);
  const [pageHint, setPageHint] = useState(entry.pageHint);

  useEffect(() => {
    setLabel(entry.label);
    setPageHint(entry.pageHint);
  }, [entry.id, entry.label, entry.pageHint]);

  const dirty = label !== entry.label || pageHint !== entry.pageHint;

  return (
    <div className="flex gap-3 rounded-xl border border-zinc-200 bg-white p-3">
      <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/agents/pipeline/design-references/${entry.id}/file`}
          alt={entry.label || entry.fileName}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-medium text-zinc-800">
              {entry.fileName}
            </div>
            <div className="text-[10.5px] text-zinc-500">
              {formatBytes(entry.bytes)} · {entry.mime} ·{" "}
              {new Date(entry.uploadedAt).toLocaleString()}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onDelete(entry.id)}
            disabled={isBusy}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
          <label className="w-20 shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Login page"
            className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[12px] text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
          />
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
          <label className="w-20 shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">
            Target
          </label>
          <input
            type="text"
            value={pageHint}
            onChange={(e) => setPageHint(e.target.value)}
            placeholder="/login or PAGE-01"
            className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[12px] font-mono text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
          />
        </div>
        {dirty && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setLabel(entry.label);
                setPageHint(entry.pageHint);
              }}
              disabled={isBusy}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={() => void onSaveMeta(entry.id, { label, pageHint })}
              disabled={isBusy}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DesignReferencesDialog({
  isOpen,
  onClose,
}: DesignReferencesDialogProps) {
  const references = usePipelineStore((s) => s.designReferences);
  const loading = usePipelineStore((s) => s.designReferencesLoading);
  const storeError = usePipelineStore((s) => s.designReferencesError);
  const refresh = usePipelineStore((s) => s.refreshDesignReferences);
  const upload = usePipelineStore((s) => s.uploadDesignReferences);
  const updateMeta = usePipelineStore((s) => s.updateDesignReferenceMeta);
  const removeOne = usePipelineStore((s) => s.deleteDesignReference);
  const clearAll = usePipelineStore((s) => s.clearDesignReferences);

  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    setLocalError(null);
  }, [isOpen, refresh]);

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
    };
  }, []);

  const isBusy =
    loading === "uploading" ||
    loading === "updating" ||
    loading === "deleting";

  const addPending = useCallback(
    (files: File[]) => {
      const remainingSlots = Math.max(
        0,
        MAX_TOTAL - references.length - pendingRef.current.length,
      );
      const entries: PendingUpload[] = [];
      const issues: string[] = [];
      for (const file of files.slice(0, remainingSlots)) {
        if (!isAcceptedImage(file)) {
          issues.push(`${file.name}: unsupported type (${file.type || "?"}).`);
          continue;
        }
        if (file.size > MAX_BYTES_PER_FILE) {
          issues.push(
            `${file.name}: too large (${formatBytes(file.size)}, limit ${formatBytes(
              MAX_BYTES_PER_FILE,
            )}).`,
          );
          continue;
        }
        entries.push({
          key: `${file.name}-${file.size}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          file,
          label: "",
          pageHint: "",
          previewUrl: makePreviewUrl(file),
          error: null,
        });
      }
      if (files.length > remainingSlots) {
        issues.push(
          `Only ${remainingSlots} more reference(s) allowed (cap of ${MAX_TOTAL}).`,
        );
      }
      if (issues.length > 0) setLocalError(issues.join(" "));
      else setLocalError(null);
      if (entries.length > 0) {
        setPending((prev) => [...prev, ...entries]);
      }
    },
    [references.length],
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length > 0) addPending(files);
    },
    [addPending],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length > 0) addPending(files);
    },
    [addPending],
  );

  const updatePending = useCallback(
    (key: string, patch: Partial<Pick<PendingUpload, "label" | "pageHint">>) => {
      setPending((prev) =>
        prev.map((p) => (p.key === key ? { ...p, ...patch } : p)),
      );
    },
    [],
  );

  const removePending = useCallback((key: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }, []);

  const handleUploadAll = useCallback(async () => {
    if (pending.length === 0) return;
    const files = pending.map((p) => p.file);
    const labels = pending.map((p) => p.label);
    const hints = pending.map((p) => p.pageHint);
    const result = await upload(files, labels, hints);
    if (result && result.added.length > 0) {
      pending.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      setPending([]);
      setLocalError(null);
    }
  }, [pending, upload]);

  const handleSaveMeta = useCallback(
    async (id: string, patch: { label?: string; pageHint?: string }) => {
      await updateMeta(id, patch);
    },
    [updateMeta],
  );

  const handleDeleteOne = useCallback(
    async (id: string) => {
      await removeOne(id);
    },
    [removeOne],
  );

  const handleClearAll = useCallback(async () => {
    if (references.length === 0) return;
    if (
      !confirm(
        `Remove all ${references.length} design reference(s)? This cannot be undone.`,
      )
    ) {
      return;
    }
    await clearAll();
  }, [references.length, clearAll]);

  const statusLine = useMemo(() => {
    if (references.length === 0) return null;
    return `${references.length} reference(s) ready — will be copied to \`<output>/.design-references/\` on the next run.`;
  }, [references.length]);

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
            className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border-[1.5px] border-zinc-200 bg-white shadow-lg shadow-zinc-900/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-zinc-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">
                  Design references
                </h2>
                <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">
                  Upload screenshots or mockups. Each image is stored under{" "}
                  <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] text-zinc-700">
                    .blueprint/design-references/
                  </code>{" "}
                  and mirrored into{" "}
                  <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] text-zinc-700">
                    &lt;output&gt;/.design-references/
                  </code>{" "}
                  at kickoff so coding agents can match the visual layout for
                  the pages you tag.
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
                  onClick={() => void handleClearAll()}
                  disabled={isBusy}
                  className="rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading === "deleting" ? "Clearing…" : "Clear all"}
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
                onDrop={handleDrop}
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
                    Drop{" "}
                    <span className="font-mono text-[11px]">
                      .png / .jpg / .webp / .gif
                    </span>{" "}
                    files here or
                  </span>
                </div>
                <label className="cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100">
                  Choose files
                  <input
                    type="file"
                    accept={ACCEPTED_MIMES.join(",")}
                    multiple
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </label>
              </div>

              {pending.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                      Ready to upload ({pending.length})
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          pending.forEach((p) => {
                            if (p.previewUrl)
                              URL.revokeObjectURL(p.previewUrl);
                          });
                          setPending([]);
                        }}
                        disabled={isBusy}
                        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        Clear pending
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUploadAll()}
                        disabled={isBusy}
                        className="rounded-md bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {loading === "uploading"
                          ? "Uploading…"
                          : `Upload ${pending.length}`}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {pending.map((p) => (
                      <div
                        key={p.key}
                        className="flex gap-3 rounded-lg bg-white p-2 ring-1 ring-indigo-100"
                      >
                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                          {p.previewUrl && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={p.previewUrl}
                              alt={p.file.name}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-[12px] font-medium text-zinc-800">
                              {p.file.name}
                            </div>
                            <button
                              type="button"
                              onClick={() => removePending(p.key)}
                              className="text-[11px] text-zinc-400 hover:text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="text-[10.5px] text-zinc-500">
                            {formatBytes(p.file.size)} · {p.file.type || "?"}
                          </div>
                          <input
                            type="text"
                            value={p.label}
                            onChange={(e) =>
                              updatePending(p.key, { label: e.target.value })
                            }
                            placeholder="Label (e.g. Login page)"
                            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[12px] text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                          />
                          <input
                            type="text"
                            value={p.pageHint}
                            onChange={(e) =>
                              updatePending(p.key, {
                                pageHint: e.target.value,
                              })
                            }
                            placeholder="Target page / route (optional, e.g. /login)"
                            className="rounded-md border border-zinc-200 bg-white px-2 py-1 font-mono text-[12px] text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {references.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Saved references ({references.length})
                  </div>
                  {references.map((entry) => (
                    <ReferenceCard
                      key={entry.id}
                      entry={entry}
                      onSaveMeta={handleSaveMeta}
                      onDelete={handleDeleteOne}
                      isBusy={isBusy}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center text-[12px] text-zinc-500">
                  No references yet. Uploaded screenshots will be reused on
                  every run until you clear them.
                </div>
              )}

              {(localError || storeError) && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                  {localError || storeError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                {loading === "loading" && (
                  <Loading size="sm" text="Loading references..." />
                )}
                {loading === "idle" && references.length > 0 && (
                  <span>
                    Cap: {references.length}/{MAX_TOTAL} · Per-file limit:{" "}
                    {formatBytes(MAX_BYTES_PER_FILE)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
