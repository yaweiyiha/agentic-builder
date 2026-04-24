"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type {
  ResourceCategory,
  ResourceRequirement,
} from "@/lib/pipeline/resource-requirements";

const CATEGORY_LABEL: Record<ResourceCategory, string> = {
  auth: "Auth",
  payment: "Payment",
  email: "Email",
  storage: "Storage",
  ai: "AI / LLM",
  analytics: "Analytics",
  messaging: "Messaging / SMS",
  maps: "Maps / Geocoding",
  other: "Other",
};

const CATEGORY_BADGE: Record<ResourceCategory, string> = {
  auth: "bg-violet-50 text-violet-800 border-violet-200",
  payment: "bg-emerald-50 text-emerald-800 border-emerald-200",
  email: "bg-amber-50 text-amber-800 border-amber-200",
  storage: "bg-sky-50 text-sky-800 border-sky-200",
  ai: "bg-indigo-50 text-indigo-800 border-indigo-200",
  analytics: "bg-pink-50 text-pink-800 border-pink-200",
  messaging: "bg-orange-50 text-orange-800 border-orange-200",
  maps: "bg-teal-50 text-teal-800 border-teal-200",
  other: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

type Props = {
  prdContent: string;
  trdContent?: string;
  sysdesignContent?: string;
  implguideContent?: string;
  /** Optional id of the current pipeline run, threaded into the LLM session id. */
  runId?: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ResourceRequirementsPanel({
  prdContent,
  trdContent,
  sysdesignContent,
  implguideContent,
  runId,
}: Props) {
  const [items, setItems] = useState<ResourceRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/agents/pipeline/resource-requirements")
      .then((r) => r.json())
      .then((data: { requirements?: ResourceRequirement[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        setItems(Array.isArray(data.requirements) ? data.requirements : []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load requirements.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDetect = useCallback(async () => {
    if (detecting || !prdContent.trim()) return;
    setDetectError(null);
    setDetecting(true);
    try {
      const resp = await fetch(
        "/api/agents/pipeline/resource-requirements/detect",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prd: prdContent,
            trd: trdContent,
            sysdesign: sysdesignContent,
            implguide: implguideContent,
            sessionId: runId,
          }),
        },
      );
      const data = (await resp.json()) as {
        requirements?: ResourceRequirement[];
        error?: string;
        parseError?: string;
      };
      if (!resp.ok) {
        throw new Error(data.error || "Detection failed.");
      }
      setItems(Array.isArray(data.requirements) ? data.requirements : []);
      if (data.parseError) {
        setDetectError(`LLM output parse warning: ${data.parseError}`);
      }
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : "Detection failed.");
    } finally {
      setDetecting(false);
    }
  }, [detecting, prdContent, trdContent, sysdesignContent, implguideContent, runId]);

  const persistItems = useCallback(
    async (next: ResourceRequirement[]) => {
      setSaveState("saving");
      try {
        const resp = await fetch(
          "/api/agents/pipeline/resource-requirements",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requirements: next }),
          },
        );
        if (!resp.ok) {
          const data = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Save failed.");
        }
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1200);
      } catch (e) {
        setSaveState("error");
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    },
    [],
  );

  const handleValueChange = (envKey: string, value: string) => {
    setItems((prev) => {
      const next = prev.map((it) =>
        it.envKey === envKey ? { ...it, value } : it,
      );
      void persistItems(next);
      return next;
    });
  };

  const handleClear = async () => {
    const ok = window.confirm(
      "Clear all detected resources? Saved values will be lost.",
    );
    if (!ok) return;
    setItems([]);
    void persistItems([]);
  };

  const handleAddBlank = () => {
    const envKey = window.prompt(
      "Env var name (UPPER_SNAKE_CASE):",
      "MY_API_KEY",
    );
    if (!envKey) return;
    const cleaned = envKey
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_");
    if (!cleaned) return;
    if (items.some((it) => it.envKey === cleaned)) {
      window.alert(`${cleaned} already exists.`);
      return;
    }
    const next: ResourceRequirement[] = [
      ...items,
      {
        envKey: cleaned,
        label: cleaned,
        description: "Manually added by user.",
        category: "other",
        required: false,
        value: "",
      },
    ];
    setItems(next);
    void persistItems(next);
  };

  const stats = useMemo(() => {
    const total = items.length;
    const filled = items.filter((it) => (it.value ?? "").trim().length > 0).length;
    const requiredMissing = items.filter(
      (it) => it.required && !(it.value ?? "").trim(),
    ).length;
    return { total, filled, requiredMissing };
  }, [items]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-zinc-900">
            External resources &amp; credentials
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
            Provide the API keys and secrets your generated app will need at
            runtime. Values are written to{" "}
            <code className="rounded bg-zinc-100 px-1 font-mono text-[11px]">
              backend/.env
            </code>{" "}
            during the coding phase. Stored locally under{" "}
            <code className="rounded bg-zinc-100 px-1 font-mono text-[11px]">
              .blueprint/resource-requirements.json
            </code>{" "}
            (gitignored).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDetect}
            disabled={detecting || !prdContent.trim()}
            className="rounded-md bg-zinc-900 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {detecting
              ? "Analyzing PRD..."
              : items.length === 0
                ? "Detect from PRD"
                : "Re-detect from PRD"}
          </button>
          {items.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleAddBlank}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-[12px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Add manually
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-md border border-red-200 bg-white px-3 py-2 text-[12px] font-semibold text-red-700 transition-colors hover:bg-red-50"
              >
                Clear all
              </button>
            </>
          )}
        </div>
      </div>

      {detectError && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {detectError}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900">
          {error}
        </p>
      )}

      {!loading && items.length === 0 && !detecting && (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 p-4 text-[12.5px] leading-relaxed text-zinc-600">
          <p>
            No resources detected yet. Click{" "}
            <span className="font-semibold text-zinc-800">Detect from PRD</span>{" "}
            to scan the PRD for required API keys and credentials. If your app
            doesn&apos;t use any third-party services, you can skip this step.
          </p>
        </div>
      )}

      {loading && (
        <div className="mt-4 text-[12px] text-zinc-500">Loading saved resources…</div>
      )}

      {items.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            <span>
              <span className="font-semibold text-zinc-800">{stats.total}</span>{" "}
              total
            </span>
            <span>·</span>
            <span>
              <span className="font-semibold text-emerald-700">{stats.filled}</span>{" "}
              filled
            </span>
            {stats.requiredMissing > 0 && (
              <>
                <span>·</span>
                <span>
                  <span className="font-semibold text-red-700">
                    {stats.requiredMissing}
                  </span>{" "}
                  required still missing
                </span>
              </>
            )}
            {saveState === "saving" && (
              <span className="ml-auto text-zinc-400">Saving…</span>
            )}
            {saveState === "saved" && (
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="ml-auto text-emerald-600"
              >
                Saved
              </motion.span>
            )}
          </div>

          <div className="mt-3 space-y-2">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.div
                  key={item.envKey}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="rounded-lg border border-zinc-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-zinc-900">
                          {item.envKey}
                        </span>
                        <span
                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            CATEGORY_BADGE[item.category] ??
                            CATEGORY_BADGE.other
                          }`}
                        >
                          {CATEGORY_LABEL[item.category] ?? "Other"}
                        </span>
                        {item.required ? (
                          <span className="inline-flex rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                            Required
                          </span>
                        ) : (
                          <span className="inline-flex rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600">
                            Optional
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
                        {item.label}
                        {item.label !== item.description && (
                          <> — <span className="text-zinc-500">{item.description}</span></>
                        )}
                      </p>
                      {item.docsUrl && (
                        <a
                          href={item.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-[11px] text-indigo-600 underline hover:text-indigo-800"
                        >
                          Where do I get this? →
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type={showSecrets[item.envKey] ? "text" : "password"}
                      value={item.value}
                      onChange={(e) =>
                        handleValueChange(item.envKey, e.target.value)
                      }
                      placeholder={item.example ?? "Paste value here…"}
                      autoComplete="off"
                      spellCheck={false}
                      className="flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowSecrets((prev) => ({
                          ...prev,
                          [item.envKey]: !prev[item.envKey],
                        }))
                      }
                      className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      {showSecrets[item.envKey] ? "Hide" : "Show"}
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}
