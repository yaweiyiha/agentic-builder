"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import StageInputBar from "@/components/StageInputBar";
import { ArrowRight, History, X, ChevronLeft, ChevronRight } from "lucide-react";

// ─── In-memory PRD history (never persisted to DB) ───────────────────────────
export interface PrdSnapshot {
  content: string;
  savedAt: Date;
  /** Human-readable label, e.g. "v1 · Initial", "v2 · After edit" */
  label: string;
}

// Module-level store so history survives hot-reload but resets on page reload.
const _prdHistoryStore: PrdSnapshot[] = [];

// ─── Word-level inline diff ──────────────────────────────────────────────────
type WordDiff =
  | { type: "equal" | "added" | "removed"; text: string };

function diffWords(oldLine: string, newLine: string): { old: WordDiff[]; new: WordDiff[] } {
  const a = oldLine.split(/(\s+)/);
  const b = newLine.split(/(\s+)/);
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const oldTokens: WordDiff[] = [], newTokens: WordDiff[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      oldTokens.push({ type: "equal", text: a[i] });
      newTokens.push({ type: "equal", text: b[j] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      newTokens.push({ type: "added", text: b[j] });
      j++;
    } else {
      oldTokens.push({ type: "removed", text: a[i] });
      i++;
    }
  }
  return { old: oldTokens, new: newTokens };
}

function InlineDiffLine({ tokens }: { tokens: WordDiff[] }) {
  return (
    <span>
      {tokens.map((t, i) => {
        if (t.type === "equal") return <span key={i}>{t.text}</span>;
        if (t.type === "added")
          return <span key={i} className="bg-[#abf2bc] text-[#1a7f37] rounded-[2px]">{t.text}</span>;
        return <span key={i} className="bg-[#ff818266] text-[#cf222e] rounded-[2px] line-through">{t.text}</span>;
      })}
    </span>
  );
}


type DiffLine =
  | { type: "equal";   text: string }
  | { type: "added";   text: string }
  | { type: "removed"; text: string };

function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length, n = b.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      result.push({ type: "equal", text: a[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: "added", text: b[j] });
      j++;
    } else {
      result.push({ type: "removed", text: a[i] });
      i++;
    }
  }
  return result;
}

// ─── DiffPanel component ─────────────────────────────────────────────────────
function DiffPanel({
  history,
  currentContent,
  onClose,
}: {
  history: PrdSnapshot[];
  currentContent: string;
  onClose: () => void;
}) {
  // All versions: history (oldest→newest) + current as the latest
  const allVersions: PrdSnapshot[] = [
    ...history,
    { content: currentContent, savedAt: new Date(), label: `v${history.length + 1} · Current` },
  ];

  const [leftIdx, setLeftIdx]   = useState(Math.max(0, allVersions.length - 2));
  const [rightIdx, setRightIdx] = useState(allVersions.length - 1);

  const leftContent  = allVersions[leftIdx]?.content  ?? "";
  const rightContent = allVersions[rightIdx]?.content ?? "";

  const diffResult = diffLines(leftContent, rightContent);

  // Stats
  const added   = diffResult.filter((l) => l.type === "added").length;
  const removed = diffResult.filter((l) => l.type === "removed").length;

  return (
    <div className="flex flex-col w-full h-full bg-white border border-[#e2e8f0] rounded-[4px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <History size={16} className="text-[#712ae2]" />
            <span className="font-semibold text-slate-900 text-sm">PRD Version Diff</span>
            <span className="text-xs text-slate-500">{allVersions.length} versions</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        {/* Version selectors + stats */}
        <div className="flex items-center gap-6 px-6 py-3 border-b border-slate-100 bg-slate-50 shrink-0 text-xs">
          {/* Left version picker */}
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
            <span className="text-slate-500 mr-1">Base:</span>
            <button
              disabled={leftIdx === 0}
              onClick={() => setLeftIdx((v) => Math.max(0, v - 1))}
              className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="bg-red-50 border border-red-200 text-red-700 px-2 py-0.5 rounded font-medium min-w-28 text-center">
              {allVersions[leftIdx]?.label}
            </span>
            <button
              disabled={leftIdx >= rightIdx - 1}
              onClick={() => setLeftIdx((v) => Math.min(rightIdx - 1, v + 1))}
              className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <ChevronRight size={14} className="text-slate-400" />

          {/* Right version picker */}
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
            <span className="text-slate-500 mr-1">Compare:</span>
            <button
              disabled={rightIdx <= leftIdx + 1}
              onClick={() => setRightIdx((v) => Math.max(leftIdx + 1, v - 1))}
              className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded font-medium min-w-28 text-center">
              {allVersions[rightIdx]?.label}
            </span>
            <button
              disabled={rightIdx >= allVersions.length - 1}
              onClick={() => setRightIdx((v) => Math.min(allVersions.length - 1, v + 1))}
              className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Diff stats */}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-green-600 font-medium">+{added}</span>
            <span className="text-red-500 font-medium">−{removed}</span>
          </div>
        </div>

        {/* Unified diff view */}
        <div className="flex-1 overflow-auto bg-white">
          {/* File header — GitHub style */}
          <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-[#f6f8fa] border-b border-[#d0d7de] text-xs font-mono text-[#57606a]">
            <span className="font-semibold text-[#24292f]">PRD.md</span>
            <span className="ml-auto text-green-600">+{added}</span>
            <span className="text-red-500">−{removed}</span>
            {/* mini bar chart */}
            <div className="flex h-2 w-20 rounded-sm overflow-hidden bg-slate-200">
              {added + removed > 0 && (
                <>
                  <div
                    className="bg-green-500 h-full"
                    style={{ width: `${Math.round((added / (added + removed)) * 100)}%` }}
                  />
                  <div
                    className="bg-red-400 h-full"
                    style={{ width: `${Math.round((removed / (added + removed)) * 100)}%` }}
                  />
                </>
              )}
            </div>
          </div>

          {/* Diff lines */}
          <div className="font-mono text-[12.5px] leading-5">
            {diffResult.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-slate-400 text-sm font-sans">
                No differences between these versions.
              </div>
            ) : (() => {
              // Group consecutive removed/added pairs for word-level diffing
              const rows: React.ReactNode[] = [];
              let idx = 0;
              while (idx < diffResult.length) {
                const cur = diffResult[idx];
                const next = diffResult[idx + 1];
                if (cur.type === "removed" && next?.type === "added") {
                  // Paired change: show word-level diff in both lines
                  const wordDiff = diffWords(cur.text, next.text);
                  rows.push(
                    <div key={`r${idx}`} className="flex min-w-0 bg-[#ffebe9]">
                      <span className="select-none shrink-0 w-8 text-center border-r text-red-500 bg-[#ffd7d5] border-[#ffb3af]">−</span>
                      <span className="flex-1 pl-4 pr-4 whitespace-pre-wrap break-words text-[#cf222e]">
                        <InlineDiffLine tokens={wordDiff.old} />
                      </span>
                    </div>,
                    <div key={`a${idx}`} className="flex min-w-0 bg-[#e6ffec]">
                      <span className="select-none shrink-0 w-8 text-center border-r text-green-600 bg-[#ccffd8] border-[#b0efbc]">+</span>
                      <span className="flex-1 pl-4 pr-4 whitespace-pre-wrap break-words text-[#1a7f37]">
                        <InlineDiffLine tokens={wordDiff.new} />
                      </span>
                    </div>,
                  );
                  idx += 2;
                } else {
                  const isAdded   = cur.type === "added";
                  const isRemoved = cur.type === "removed";
                  rows.push(
                    <div
                      key={idx}
                      className={[
                        "flex min-w-0",
                        isAdded   ? "bg-[#e6ffec]" : "",
                        isRemoved ? "bg-[#ffebe9]" : "",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "select-none shrink-0 w-8 text-center border-r",
                          isAdded   ? "text-green-600 bg-[#ccffd8] border-[#b0efbc]" : "",
                          isRemoved ? "text-red-500  bg-[#ffd7d5] border-[#ffb3af]" : "",
                          !isAdded && !isRemoved ? "text-slate-300 bg-[#f6f8fa] border-[#d0d7de]" : "",
                        ].join(" ")}
                      >
                        {isAdded ? "+" : isRemoved ? "−" : " "}
                      </span>
                      <span
                        className={[
                          "flex-1 pl-4 pr-4 whitespace-pre-wrap break-words",
                          isAdded   ? "text-[#1a7f37]" : "",
                          isRemoved ? "text-[#cf222e]" : "",
                          !isAdded && !isRemoved ? "text-[#24292f]" : "",
                        ].join(" ")}
                      >
                        {cur.text || "\u00a0"}
                      </span>
                    </div>,
                  );
                  idx++;
                }
              }
              return rows;
            })()}
          </div>
        </div>

    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function CheckCircleIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  );
}

function MoreVertIcon() {
  return (
    <svg width="4" height="16" viewBox="0 0 4 20" fill="#94a3b8">
      <circle cx="2" cy="2" r="2"/><circle cx="2" cy="10" r="2"/><circle cx="2" cy="18" r="2"/>
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="19" height="16" viewBox="0 0 24 20" fill="none" stroke="#712ae2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="11.667" height="11.667" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

function ArrowRightIcon({ size = 9.333, color = "#712ae2" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/>
    </svg>
  );
}

type DocTab = "prd" | "design" | "trd" | "qa";

const DOC_TABS: { id: DocTab; label: string }[] = [
  { id: "prd",    label: "PRD" },
  { id: "design", label: "Design Document" },
  { id: "trd",    label: "Technical Specs" },
  { id: "qa",     label: "QA Plan" },
];

export default function PrdSubStage() {
  const step             = usePipelineStore((s) => s.steps.prd);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const featureBrief     = usePipelineStore((s) => s.featureBrief);
  const startPipeline    = usePipelineStore((s) => s.startPipeline);
  const rerunPrd         = usePipelineStore((s) => s.rerunPrd);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);
  const goToStage        = useStageStore((s) => s.goToStage);
  const isStageHydrated  = useStageStore((s) => s.isStageHydrated);

  const [editInput, setEditInput] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // In-memory PRD history — not persisted to DB, only for diff within this session
  // We capture a snapshot every time the prd step transitions to "completed".
  const prdHistoryRef = useRef<PrdSnapshot[]>(_prdHistoryStore);
  const prevIsDoneRef = useRef(false);

  // Auto-start the pipeline when there is no snapshot (prd step is empty) and
  // the pipeline is not already running.  We wait for both stage hydration AND
  // featureBrief to be available (the two loadFromServer calls run in parallel,
  // so featureBrief may arrive after isStageHydrated becomes true).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!isStageHydrated) return;
    if (autoStartedRef.current) return;
    if (isRunning) return;
    if (step?.content) return; // already have content — nothing to do
    if (!featureBrief.trim()) return; // brief not yet loaded, wait for next tick
    autoStartedRef.current = true;
    startPipeline(featureBrief);
  // Re-run whenever featureBrief arrives or hydration completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStageHydrated, featureBrief]);

  const isThisRunning = isRunning && currentStep === "prd";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  // Capture PRD snapshot exactly once: when isDone transitions false → true,
  // i.e. the moment the SSE stream finishes and step_complete has been applied.
  // We deliberately do NOT depend on `content` here so we never fire mid-stream.
  useEffect(() => {
    const justCompleted = isDone && !prevIsDoneRef.current;
    if (justCompleted) {
      // Read the final content directly from the step (not from streaming state).
      const finalContent = step?.content ?? "";
      if (finalContent) {
        const versionNum = prdHistoryRef.current.length + 1;
        prdHistoryRef.current = [
          ...prdHistoryRef.current,
          {
            content: finalContent,
            savedAt: new Date(),
            label: versionNum === 1 ? `v${versionNum} · Initial` : `v${versionNum} · Edited`,
          },
        ];
      }
    }
    prevIsDoneRef.current = isDone;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone]);
  const handleDownloadPdf = () => {
    if (!content || isPrinting) return;
    setIsPrinting(true);

    // Dynamically import marked to convert markdown → HTML
    import("marked").then(({ marked }) => {
      const htmlBody = marked.parse(content) as string;

      const printWindow = window.open("", "_blank");
      if (!printWindow) { setIsPrinting(false); return; }

      printWindow.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Product Requirements Document</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html { font-size: 16px; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.75;
      color: #1f2328;
      background: #ffffff;
      max-width: 860px;
      margin: 0 auto;
      padding: 48px 56px;
    }
    h1 { font-size: 2em; font-weight: 600; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; margin: 1.5em 0 0.75em; }
    h2 { font-size: 1.5em; font-weight: 600; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; margin: 1.5em 0 0.75em; }
    h3 { font-size: 1.25em; font-weight: 600; margin: 1.5em 0 0.5em; }
    h4 { font-size: 1em; font-weight: 600; margin: 1.25em 0 0.4em; }
    h5 { font-size: 0.875em; font-weight: 600; margin: 1em 0 0.3em; }
    h6 { font-size: 0.85em; font-weight: 600; color: #57606a; margin: 1em 0 0.3em; }
    p { margin: 0 0 1em; }
    ul, ol { padding-left: 1.5em; margin: 0 0 1em; }
    li + li { margin-top: 0.25em; }
    a { color: #0969da; text-decoration: underline; }
    strong { font-weight: 600; }
    em { font-style: italic; }
    code {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.85em;
      background: #f6f8fa;
      border: 1px solid rgba(175,184,193,0.2);
      border-radius: 6px;
      padding: 0.2em 0.4em;
    }
    pre {
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      margin: 0 0 1em;
    }
    pre code { background: none; border: none; padding: 0; font-size: 13px; }
    blockquote {
      border-left: 4px solid #d0d7de;
      color: #57606a;
      margin: 0 0 1em;
      padding: 0 1em;
    }
    table { border-collapse: collapse; width: 100%; margin: 0 0 1em; font-size: 14px; }
    th, td { border: 1px solid #d0d7de; padding: 8px 16px; text-align: left; }
    thead { background: #f6f8fa; font-weight: 600; }
    tbody tr:nth-child(even) { background: #f6f8fa; }
    hr { border: none; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
    @media print {
      body { padding: 0; }
      @page { margin: 20mm 18mm; }
    }
  </style>
</head>
<body>
  <h1 style="margin-top:0">Product Requirements Document</h1>
  ${htmlBody}
</body>
</html>`);
      printWindow.document.close();

      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
        printWindow.onafterprint = () => { printWindow.close(); setIsPrinting(false); };
        // fallback: reset flag after 5s if onafterprint never fires
        setTimeout(() => setIsPrinting(false), 5000);
      };
    }).catch(() => setIsPrinting(false));
  };

  const handleTabChange = (tab: DocTab) => {
    if (tab !== "prd") {
      goToSubStage(tab, "preparation");
    }
  };

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* ── Secondary Document Tab Bar ── */}
      <div className="shrink-0 bg-white border-b border-[#e2e8f0] flex items-center justify-between px-8">
        {/* Tabs */}
        <div className="flex gap-8">
          {DOC_TABS.map((tab) => {
            const isActive = tab.id === "prd";
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={[
                  "relative flex items-center gap-2 py-[17px] text-[14px] font-semibold transition-colors",
                  isActive
                    ? "text-[#712ae2] border-b-2 border-[#712ae2]"
                    : "text-[#94a3b8] hover:text-[#64748b]",
                ].join(" ")}
              >
                <span>{tab.label}</span>
                {/* show checkmark for done tabs */}
                {tab.id === "prd" && isDone && (
                  <span className="text-[#712ae2]"><CheckCircleIcon size={15} /></span>
                )}
              </button>
            );
          })}
        </div>

        {/* Proceed to Kick-off */}
        {/* <button
          onClick={() => goToStage("kickoff")}
          className="flex items-center gap-2 border border-[rgba(113,42,226,0.2)] text-[#712ae2] text-[12px] font-bold px-[17px] py-[7px] rounded-[4px] hover:bg-[rgba(113,42,226,0.05)] transition-colors"
        >
          Proceed to Kick-off
          <ArrowRightIcon size={9.333} color="#712ae2" />
        </button> */}
      </div>

      {/* ── PRD Content Canvas ── */}
      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="w-full h-full">
          {showDiff ? (
            <DiffPanel
              history={prdHistoryRef.current.slice(0, -1)}
              currentContent={prdHistoryRef.current[prdHistoryRef.current.length - 1]?.content ?? content}
              onClose={() => setShowDiff(false)}
            />
          ) : (
          <div className="bg-white border border-[#e2e8f0] rounded-[4px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] overflow-hidden">

            {/* Document Header */}
            <div className="bg-[rgba(248,250,252,0.5)] border-b border-[#f1f5f9] px-8 pt-8 pb-[33px] flex items-start justify-between">
              <div className="flex flex-col gap-1">
                {/* Badge row */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-[rgba(113,42,226,0.1)] text-[#712ae2] text-[12px] font-normal px-2 py-[2px] rounded-[2px] font-['Space_Grotesk',sans-serif]">
                    {isThisRunning ? "GENERATING…" : isDone ? "DRAFT V1.0" : "PENDING"}
                  </span>
                  {isDone && (
                    <span className="text-[#94a3b8] text-[12px]">
                      {step?.durationMs != null
                        ? `Generated in ${(step.durationMs / 1000).toFixed(1)}s`
                        : "Just now"}
                    </span>
                  )}
                </div>
                {/* Title */}
                <h2 className="text-[30px] font-semibold text-[#0f172a] tracking-[-0.3px] leading-[36px]">
                  Product Requirements Document
                </h2>
                {/* Subtitle */}
                <p className="text-[14px] text-[#64748b] leading-[21px]">
                  {step?.model
                    ? <>Generated by <span className="font-medium">{step.model}</span></>
                    : "Full PRD — user stories, acceptance criteria, and scope"}
                </p>
                {/* Stats row */}
                {isDone && (
                  <div className="flex items-center gap-4 mt-1">
                    {step?.costUsd != null && (
                      <span className="text-[11px] text-[#94a3b8]">
                        Cost: <span className="font-medium text-[#64748b]">${step.costUsd.toFixed(4)}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-1 shrink-0">
                {prdHistoryRef.current.length > 1 && (
                  <button
                    onClick={() => setShowDiff(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[#712ae2] bg-[rgba(113,42,226,0.07)] hover:bg-[rgba(113,42,226,0.13)] transition-colors mr-1"
                    title="View version history & diff"
                  >
                    <History size={13} />
                    {prdHistoryRef.current.length} versions
                  </button>
                )}
                <button className="p-2 rounded hover:bg-[#f1f5f9] transition-colors" title="Share">
                  <ShareIcon />
                </button>
                <button className="p-2 rounded hover:bg-[#f1f5f9] transition-colors" title="More">
                  <MoreVertIcon />
                </button>
              </div>
            </div>

            {/* Document Body — markdown content */}
            <div className="p-8">
              {!content && !isThisRunning ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#94a3b8]">
                  <span className="text-[13px]">Waiting for pipeline to start…</span>
                </div>
              ) : isThisRunning && !content ? (
                <div className="flex items-center gap-2 text-[#712ae2] text-[13px]">
                  <SpinnerIcon /> Generating PRD…
                </div>
              ) : (
                <MarkdownRenderer content={content} variant="prd" />
              )}
            </div>

          </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <StageInputBar
        value={editInput}
        onChange={setEditInput}
        onSubmit={() => {
          const instruction = editInput.trim();
          if (!instruction || isThisRunning) return;
          setEditInput("");
          setShowDiff(false);
          rerunPrd(instruction);
        }}
        placeholder="Ask AgenticBuilder to edit this PRD…"
        disabled={isThisRunning}
        actions={
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleDownloadPdf}
              disabled={!isDone || isPrinting}
              className="flex items-center gap-2 text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg h-10 px-4 shrink-0 text-sm font-semibold shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isPrinting ? <SpinnerIcon /> : <DownloadIcon />}
              {isPrinting ? "Preparing…" : "Download PDF"}
            </button>
            <button
              onClick={() => goToSubStage("design", "preparation")}
              className="flex items-center gap-2 text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg h-10 px-4 shrink-0 text-sm font-semibold shadow-md hover:shadow-indigo-200 hover:shadow-lg transition-all hover:scale-105 active:scale-95"
            >
              Confirm PRD
              <ArrowRight size={16} color="white" />
            </button>
          </div>
        }
      />
    </div>
  );
}
