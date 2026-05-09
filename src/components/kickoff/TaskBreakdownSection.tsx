"use client";

import { useState } from "react";
import type { KickoffWorkItem } from "@/lib/pipeline/types";

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function summarizeTaskFiles(files: KickoffWorkItem["files"]): string {
  if (!files) return "";
  if (Array.isArray(files)) return files.join(", ");
  const groups: string[] = [];
  if (files.creates.length > 0) groups.push(`create(${files.creates.length})`);
  if (files.modifies.length > 0)
    groups.push(`modify(${files.modifies.length})`);
  if (files.reads.length > 0) groups.push(`read(${files.reads.length})`);
  return groups.join(" · ");
}

export function PriorityBadge({ priority }: { priority?: string }) {
  const p = priority ?? "P1";
  const styles: Record<string, string> = {
    P0: "bg-red-50 text-red-700 border-red-200",
    P1: "bg-blue-50 text-blue-700 border-blue-200",
    P2: "bg-zinc-100 text-zinc-600 border-zinc-200",
  };
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${styles[p] ?? styles.P1}`}
    >
      {p}
    </span>
  );
}

function StatCard({
  label,
  value,
  accent = "zinc",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  const border =
    accent === "indigo"
      ? "border-indigo-100"
      : accent === "amber"
        ? "border-amber-100"
        : "border-zinc-200";
  const bg =
    accent === "indigo"
      ? "bg-indigo-50/50"
      : accent === "amber"
        ? "bg-amber-50/50"
        : "bg-white";
  const textColor =
    accent === "indigo"
      ? "text-indigo-800"
      : accent === "amber"
        ? "text-amber-900"
        : "text-zinc-900";
  const labelColor =
    accent === "indigo"
      ? "text-indigo-700"
      : accent === "amber"
        ? "text-amber-800"
        : "text-zinc-500";

  return (
    <div className={`rounded-lg border ${border} ${bg} p-3`}>
      <p className={`text-[11px] ${labelColor}`}>{label}</p>
      <p className={`mt-1 text-lg font-bold ${textColor}`}>{value}</p>
    </div>
  );
}

function FilterButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-indigo-100 text-indigo-800"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function TaskRow({ task: t }: { task: KickoffWorkItem }) {
  const [expanded, setExpanded] = useState(false);
  const fileInfo = summarizeTaskFiles(t.files);

  return (
    <>
      <tr
        className="border-b border-zinc-100 align-top cursor-pointer hover:bg-zinc-50/80 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-zinc-500">
          <div className="flex items-center gap-1.5">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={`shrink-0 text-zinc-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            {t.id}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600">
          {t.phase}
        </td>
        <td className="px-3 py-2.5">
          <p className="font-medium text-zinc-900">{t.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 line-clamp-2">
            {t.description}
          </p>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-800">
          {t.estimatedHours}h
        </td>
        <td className="px-3 py-2.5">
          <PriorityBadge priority={t.priority} />
        </td>
        <td className="px-3 py-2.5">
          {t.executionKind === "ai_autonomous" ? (
            <span className="inline-flex rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
              AI-autonomous
            </span>
          ) : (
            <span className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              Human confirm
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-100 bg-zinc-50/30">
          <td colSpan={6} className="px-4 py-4">
            <div className="space-y-4 text-xs">
              <p className="text-zinc-600 leading-relaxed">{t.description}</p>

              {t.subSteps && t.subSteps.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-800">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                    </svg>
                    Implementation Steps
                  </h4>
                  <div className="space-y-0 rounded-lg border border-zinc-200 bg-white overflow-hidden">
                    {t.subSteps.map((ss) => (
                      <div
                        key={ss.step}
                        className="flex gap-3 border-b border-zinc-100 last:border-b-0 px-3 py-2.5"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
                          {ss.step}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-zinc-800">{ss.action}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                            {ss.detail}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {t.acceptanceCriteria && t.acceptanceCriteria.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-800">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                      <path d="M22 4L12 14.01l-3-3" />
                    </svg>
                    Acceptance Criteria
                  </h4>
                  <ul className="space-y-1 rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
                    {t.acceptanceCriteria.map((ac, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] text-zinc-600">
                        <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-zinc-300 bg-zinc-50">
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-zinc-400">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </span>
                        {ac}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {t.tokenEstimate && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-800">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    Token Estimate
                  </h4>
                  <div className="flex flex-wrap gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-400">Input</p>
                      <p className="font-mono font-semibold text-zinc-700">
                        {formatTokenCount(t.tokenEstimate.inputTokens)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-400">Output</p>
                      <p className="font-mono font-semibold text-zinc-700">
                        {formatTokenCount(t.tokenEstimate.outputTokens)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-400">Total</p>
                      <p className="font-mono font-bold text-indigo-700">
                        {formatTokenCount(t.tokenEstimate.totalTokens)}
                      </p>
                    </div>
                    {t.tokenEstimate.estimatedCostUsd > 0 && (
                      <div className="text-center">
                        <p className="text-[10px] uppercase tracking-wide text-zinc-400">Cost</p>
                        <p className="font-mono font-semibold text-emerald-700">
                          ${t.tokenEstimate.estimatedCostUsd.toFixed(4)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {fileInfo && (
                <div>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-800">
                    Files
                  </h4>
                  <p className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 font-mono text-[11px] text-zinc-600">
                    {fileInfo}
                  </p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function TaskBreakdownSection({
  tasks,
  totalHours,
  aiHours,
  humanHours,
  totalTokens,
  totalCost: _totalCost,
  phases,
  priorities,
}: {
  tasks: KickoffWorkItem[];
  totalHours: number;
  aiHours: number;
  humanHours: number;
  totalTokens: number;
  totalCost: number;
  phases: string[];
  priorities: Record<string, number>;
}) {
  const [phaseFilter, setPhaseFilter] = useState<string>("all");

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-zinc-600">
          No task breakdown available from the latest model response.
        </p>
      </div>
    );
  }

  const filtered =
    phaseFilter === "all"
      ? tasks
      : tasks.filter((t) => t.phase === phaseFilter);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 text-center text-xs sm:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Total tasks" value={String(tasks.length)} />
        <StatCard label="Total estimate" value={`${totalHours}h`} accent="zinc" />
        <StatCard label="AI-autonomous" value={`${aiHours}h`} accent="indigo" />
        <StatCard label="Human gates" value={`${humanHours}h`} accent="amber" />
        {totalTokens > 0 && (
          <StatCard
            label="Est. tokens"
            value={formatTokenCount(totalTokens)}
            accent="indigo"
          />
        )}
        <StatCard
          label="P0 / P1 / P2"
          value={`${priorities.P0} / ${priorities.P1} / ${priorities.P2}`}
          accent="zinc"
        />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
        <div className="flex flex-wrap gap-4">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-500" />
            AI-autonomous
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />
            Human confirmation
          </span>
          <span>
            <PriorityBadge priority="P0" /> Must have
          </span>
          <span>
            <PriorityBadge priority="P1" /> Should have
          </span>
          <span>
            <PriorityBadge priority="P2" /> Nice to have
          </span>
        </div>
      </div>

      {phases.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <FilterButton
            active={phaseFilter === "all"}
            onClick={() => setPhaseFilter("all")}
          >
            All ({tasks.length})
          </FilterButton>
          {phases.map((p) => {
            const count = tasks.filter((t) => t.phase === p).length;
            return (
              <FilterButton
                key={p}
                active={phaseFilter === p}
                onClick={() => setPhaseFilter(p)}
              >
                {p} ({count})
              </FilterButton>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-2">
        <table className="w-full min-w-[820px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2 w-[60px]">ID</th>
              <th className="px-3 py-2 w-[100px]">Phase</th>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2 w-[50px]">Est.</th>
              <th className="px-3 py-2 w-[40px]">Pri</th>
              <th className="px-3 py-2 w-[120px]">Type</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
