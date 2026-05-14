"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, History, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import StageInputBar from "@/components/StageInputBar";
import type { StepUIProps } from "../../../_shared/types";
import type { ProjectTier } from "@/_config/pipeline-flow";

// ─── In-memory PRD history ────────────────────────────────────────────────
export interface PrdSnapshot { content: string; savedAt: Date; label: string; }
const _prdHistoryStore: PrdSnapshot[] = [];

// ─── Word-level inline diff ────────────────────────────────────────────────
type WordDiff = { type: "equal" | "added" | "removed"; text: string };

function diffWords(oldLine: string, newLine: string): { old: WordDiff[]; new: WordDiff[] } {
  const a = oldLine.split(/(\s+)/); const b = newLine.split(/(\s+)/);
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const oldTokens: WordDiff[] = [], newTokens: WordDiff[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { oldTokens.push({ type: "equal", text: a[i] }); newTokens.push({ type: "equal", text: b[j] }); i++; j++; }
    else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) { newTokens.push({ type: "added", text: b[j] }); j++; }
    else { oldTokens.push({ type: "removed", text: a[i] }); i++; }
  }
  return { old: oldTokens, new: newTokens };
}

function InlineDiffLine({ tokens }: { tokens: WordDiff[] }) {
  return <span>{tokens.map((t, i) => {
    if (t.type === "equal") return <span key={i}>{t.text}</span>;
    if (t.type === "added") return <span key={i} className="bg-[#abf2bc] text-[#1a7f37] rounded-[2px]">{t.text}</span>;
    return <span key={i} className="bg-[#ff818266] text-[#cf222e] rounded-[2px] line-through">{t.text}</span>;
  })}</span>;
}

type DiffLine = { type: "equal"; text: string } | { type: "added"; text: string } | { type: "removed"; text: string };

function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n"); const b = newText.split("\n");
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) { if (a[i] === b[j]) dp[i][j] = 1 + dp[i + 1][j + 1]; else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]); }
  const result: DiffLine[] = []; let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { result.push({ type: "equal", text: a[i] }); i++; j++; }
    else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) { result.push({ type: "added", text: b[j] }); j++; }
    else { result.push({ type: "removed", text: a[i] }); i++; }
  }
  return result;
}

// ─── DiffPanel ─────────────────────────────────────────────────────────────
function DiffPanel({ history, currentContent, onClose }: { history: PrdSnapshot[]; currentContent: string; onClose: () => void }) {
  const allVersions: PrdSnapshot[] = [...history, { content: currentContent, savedAt: new Date(), label: `v${history.length + 1} · Current` }];
  const [leftIdx, setLeftIdx] = useState(Math.max(0, allVersions.length - 2));
  const [rightIdx, setRightIdx] = useState(allVersions.length - 1);
  const leftContent = allVersions[leftIdx]?.content ?? "";
  const rightContent = allVersions[rightIdx]?.content ?? "";
  const diffResult = diffLines(leftContent, rightContent);
  const added = diffResult.filter((l) => l.type === "added").length;
  const removed = diffResult.filter((l) => l.type === "removed").length;

  return (
    <div className="flex flex-col w-full h-full bg-white border border-[#e2e8f0] rounded-[4px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3"><History size={16} className="text-[#712ae2]" /><span className="font-semibold text-slate-900 text-sm">PRD Version Diff</span><span className="text-xs text-slate-500">{allVersions.length} versions</span></div>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors"><X size={16} className="text-slate-500" /></button>
      </div>
      <div className="flex items-center gap-6 px-6 py-3 border-b border-slate-100 bg-slate-50 shrink-0 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" /><span className="text-slate-500 mr-1">Base:</span>
          <button disabled={leftIdx === 0} onClick={() => setLeftIdx((v) => Math.max(0, v - 1))} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <span className="bg-red-50 border border-red-200 text-red-700 px-2 py-0.5 rounded font-medium min-w-28 text-center">{allVersions[leftIdx]?.label}</span>
          <button disabled={leftIdx >= rightIdx - 1} onClick={() => setLeftIdx((v) => Math.min(rightIdx - 1, v + 1))} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronRight size={14} /></button>
        </div>
        <ChevronRight size={14} className="text-slate-400" />
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" /><span className="text-slate-500 mr-1">Compare:</span>
          <button disabled={rightIdx <= leftIdx + 1} onClick={() => setRightIdx((v) => Math.max(leftIdx + 1, v - 1))} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <span className="bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded font-medium min-w-28 text-center">{allVersions[rightIdx]?.label}</span>
          <button disabled={rightIdx >= allVersions.length - 1} onClick={() => setRightIdx((v) => Math.min(allVersions.length - 1, v + 1))} className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronRight size={14} /></button>
        </div>
        <div className="ml-auto flex items-center gap-3"><span className="text-green-600 font-medium">+{added}</span><span className="text-red-500 font-medium">−{removed}</span></div>
      </div>
      <div className="flex-1 overflow-auto bg-white">
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-[#f6f8fa] border-b border-[#d0d7de] text-xs font-mono text-[#57606a]">
          <span className="font-semibold text-[#24292f]">PRD.md</span><span className="ml-auto text-green-600">+{added}</span><span className="text-red-500">−{removed}</span>
          <div className="flex h-2 w-20 rounded-sm overflow-hidden bg-slate-200">{added + removed > 0 && <><div className="bg-green-500 h-full" style={{ width: `${Math.round((added / (added + removed)) * 100)}%` }} /><div className="bg-red-400 h-full" style={{ width: `${Math.round((removed / (added + removed)) * 100)}%` }} /></>}</div>
        </div>
        <div className="font-mono text-[12.5px] leading-5">
          {diffResult.length === 0 ? <div className="flex items-center justify-center py-16 text-slate-400 text-sm font-sans">No differences between these versions.</div> : (() => {
            const rows: React.ReactNode[] = []; let idx = 0;
            while (idx < diffResult.length) {
              const cur = diffResult[idx]; const next = diffResult[idx + 1];
              if (cur.type === "removed" && next?.type === "added") {
                const wd = diffWords(cur.text, next.text);
                rows.push(<div key={`r${idx}`} className="flex min-w-0 bg-[#ffebe9]"><span className="select-none shrink-0 w-8 text-center border-r text-red-500 bg-[#ffd7d5] border-[#ffb3af]">−</span><span className="flex-1 pl-4 pr-4 whitespace-pre-wrap break-words text-[#cf222e]"><InlineDiffLine tokens={wd.old} /></span></div>);
                rows.push(<div key={`a${idx}`} className="flex min-w-0 bg-[#e6ffec]"><span className="select-none shrink-0 w-8 text-center border-r text-green-600 bg-[#ccffd8] border-[#b0efbc]">+</span><span className="flex-1 pl-4 pr-4 whitespace-pre-wrap break-words text-[#1a7f37]"><InlineDiffLine tokens={wd.new} /></span></div>);
                idx += 2;
              } else {
                const isA = cur.type === "added"; const isR = cur.type === "removed";
                rows.push(<div key={idx} className={["flex min-w-0", isA ? "bg-[#e6ffec]" : "", isR ? "bg-[#ffebe9]" : ""].join(" ")}><span className={["select-none shrink-0 w-8 text-center border-r", isA ? "text-green-600 bg-[#ccffd8] border-[#b0efbc]" : "", isR ? "text-red-500 bg-[#ffd7d5] border-[#ffb3af]" : "", !isA && !isR ? "text-slate-300 bg-[#f6f8fa] border-[#d0d7de]" : ""].join(" ")}>{isA ? "+" : isR ? "−" : " "}</span><span className={["flex-1 pl-4 pr-4 whitespace-pre-wrap break-words", isA ? "text-[#1a7f37]" : "", isR ? "text-[#cf222e]" : "", !isA && !isR ? "text-[#24292f]" : ""].join(" ")}>{cur.text || "\u00a0"}</span></div>);
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

// ─── Icons ─────────────────────────────────────────────────────────────────
function SpinnerIcon() { return <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>; }
function CheckCircleIcon({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 10" /></svg>; }
function DownloadIcon() { return <svg width="11.667" height="11.667" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }

type DocTab = "prd" | "design" | "trd" | "qa";
const DOC_TABS: { id: DocTab; label: string }[] = [
  { id: "prd", label: "PRD" }, { id: "design", label: "Design Document" }, { id: "trd", label: "Technical Specs" }, { id: "qa", label: "QA Plan" },
];

// ─── Main Component ────────────────────────────────────────────────────────
export function PrdUI(props: StepUIProps) {
  // All state from step-store (single source of truth)
  const step = useStepStore((s) => s.steps.prd);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const featureBrief = useStepStore((s) => s.featureBrief);
  const isHydrated = useStepStore((s) => s.isHydrated);
  const executeStep = useStepStore((s) => s.executeStep);
  // Navigation
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("prd", tier);

  const [editInput, setEditInput] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSavingDoc, setIsSavingDoc] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const prdHistoryRef = useRef<PrdSnapshot[]>(_prdHistoryStore);
  const prevIsDoneRef = useRef(false);
  const autoStartedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isHydrated) return;
    if (autoStartedRef.current) return;
    if (isRunning) return;
    if (step?.content) return;
    if (!featureBrief.trim()) return;
    autoStartedRef.current = true;
    void executeStep("prd");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, featureBrief, step?.content]);

  const isThisRunning = isRunning && currentStep === "prd";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed" && Boolean(step?.content?.trim());
  const error = step?.status === "failed" ? step.error : null;

  // On hydration, if PRD already exists, sync tier to nav store in case it was
  // never persisted (e.g. projects created before this fix was deployed).
  useEffect(() => {
    if (!isHydrated || !isDone || isThisRunning) return;
    const existing = step?.content ?? "";
    if (!existing) return;
    const tierMatch = existing.match(/\*\*Project Tier:\s*([SML])\*\*/i);
    if (!tierMatch) return;
    const parsedTier = tierMatch[1].toUpperCase() as ProjectTier;
    const navStore = useStepNavigationStore.getState();
    if (navStore.tier !== parsedTier) {
      navStore.setTier(parsedTier);
      const slug = props.projectSlug;
      if (slug) {
        fetch(`/api/projects/${slug}/step-navigation`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier: parsedTier }),
        }).catch((err) => console.error("[PrdUI] hydration tier persist error:", err));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, isDone]);

  // Track whether this session freshly executed the step (vs restored from hydration)
  const wasRunningRef = useRef(false);
  if (isThisRunning) wasRunningRef.current = true;

  // Auto-scroll to bottom during SSE streaming
  useEffect(() => {
    if (isThisRunning && content) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [content, isThisRunning]);

  useEffect(() => {
    const justCompleted = isDone && !prevIsDoneRef.current;
    if (justCompleted) {
      const finalContent = step?.content ?? "";
      if (finalContent) {
        const versionNum = prdHistoryRef.current.length + 1;
        prdHistoryRef.current = [...prdHistoryRef.current, { content: finalContent, savedAt: new Date(), label: versionNum === 1 ? `v${versionNum} · Initial` : `v${versionNum} · Edited` }];

        // Parse Project Tier badge from PRD content and sync to navigation store + DB.
        // The PRD may contain "**Project Tier: S**" or "**Project Tier: M**" etc.
        const tierMatch = finalContent.match(/\*\*Project Tier:\s*([SML])\*\*/i);
        if (tierMatch) {
          const parsedTier = tierMatch[1].toUpperCase() as ProjectTier;
          const navStore = useStepNavigationStore.getState();
          if (navStore.tier !== parsedTier) {
            navStore.setTier(parsedTier);
            // Persist to DB so the tier survives page refresh
            const slug = props.projectSlug;
            if (slug) {
              fetch(`/api/projects/${slug}/step-navigation`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tier: parsedTier }),
              }).catch((err) => console.error("[PrdUI] tier persist error:", err));
            }
          }
        }
      }
    }
    prevIsDoneRef.current = isDone;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone]);

  // ── Persist PRD.md to disk immediately on completion ──────────────────
  useEffect(() => {
    if (!isDone || !step?.content) return;
    // Only save when this session actually ran the step (not on mount with old data)
    if (!wasRunningRef.current) {
      console.log("[PrdUI] Skipping save-doc — step was already completed before mount (restored from previous session).");
      return;
    }
    console.log("[PrdUI] PRD step completed. Saving PRD.md to generated-code...", {
      contentLength: step.content.length,
      codeOutputDir: useStepStore.getState().codeOutputDir,
    });
    setIsSavingDoc(true);
    const codeOutputDir = useStepStore.getState().codeOutputDir;
    fetch("/api/agents/save-doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "prd", content: step.content, codeOutputDir }),
    })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((data) => { console.log("[PrdUI] PRD.md saved to generated-code", data); })
      .catch((err) => { console.error("[PrdUI] Failed to save PRD.md", err); })
      .finally(() => {
        console.log("[PrdUI] PRD.md save complete, re-enabling Confirm PRD button");
        setIsSavingDoc(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone]);

  const handleDownloadPdf = () => {
    if (!content || isPrinting) return;
    setIsPrinting(true);
    import("marked").then(({ marked }) => {
      const htmlBody = marked.parse(content) as string;
      const printWindow = window.open("", "_blank");
      if (!printWindow) { setIsPrinting(false); return; }
      printWindow.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Product Requirements Document</title><style>*,*::before,*::after{box-sizing:border-box}html{font-size:16px}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.75;color:#1f2328;background:#fff;max-width:860px;margin:0 auto;padding:48px 56px}h1{font-size:2em;font-weight:600;border-bottom:1px solid #d0d7de;padding-bottom:.3em;margin:1.5em 0 .75em}h2{font-size:1.5em;font-weight:600;border-bottom:1px solid #d0d7de;padding-bottom:.3em;margin:1.5em 0 .75em}h3{font-size:1.25em;font-weight:600;margin:1.5em 0 .5em}h4{font-size:1em;font-weight:600;margin:1.25em 0 .4em}h5{font-size:.875em;font-weight:600;margin:1em 0 .3em}h6{font-size:.85em;font-weight:600;color:#57606a;margin:1em 0 .3em}p{margin:0 0 1em}ul,ol{padding-left:1.5em;margin:0 0 1em}li+li{margin-top:.25em}a{color:#0969da;text-decoration:underline}strong{font-weight:600}em{font-style:italic}code{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:.85em;background:#f6f8fa;border:1px solid rgba(175,184,193,.2);border-radius:6px;padding:.2em .4em}pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:16px;overflow-x:auto;margin:0 0 1em}pre code{background:none;border:none;padding:0;font-size:13px}blockquote{border-left:4px solid #d0d7de;color:#57606a;margin:0 0 1em;padding:0 1em}table{border-collapse:collapse;width:100%;margin:0 0 1em;font-size:14px}th,td{border:1px solid #d0d7de;padding:8px 16px;text-align:left}thead{background:#f6f8fa;font-weight:600}tbody tr:nth-child(even){background:#f6f8fa}hr{border:none;border-top:1px solid #d0d7de;margin:1.5em 0}@media print{body{padding:0}@page{margin:20mm 18mm}}</style></head><body><h1 style="margin-top:0">Product Requirements Document</h1>${htmlBody}</body></html>`);
      printWindow.document.close();
      printWindow.onload = () => { printWindow.focus(); printWindow.print(); printWindow.onafterprint = () => { printWindow.close(); setIsPrinting(false); }; setTimeout(() => setIsPrinting(false), 5000); };
    }).catch(() => setIsPrinting(false));
  };

  const handleTabChange = (tab: DocTab) => { if (tab !== "prd") props.onNavigate(tab); };

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="w-full h-full">
          {showDiff ? (
            <DiffPanel history={prdHistoryRef.current.slice(0, -1)} currentContent={prdHistoryRef.current[prdHistoryRef.current.length - 1]?.content ?? content} onClose={() => setShowDiff(false)} />
          ) : (
          <div className="bg-white border border-[#e2e8f0] rounded-[4px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] overflow-hidden">
            <div className="bg-[rgba(248,250,252,0.5)] border-b border-[#f1f5f9] px-8 pt-8 pb-[33px] flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-[rgba(113,42,226,0.1)] text-[#712ae2] text-[12px] font-normal px-2 py-[2px] rounded-[2px] font-['Space_Grotesk',sans-serif]">{isThisRunning ? "GENERATING…" : isDone ? "DRAFT V1.0" : "PENDING"}</span>
                  {isDone && tier && (
                    <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-[2px] ${
                      tier === "S" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                      tier === "M" ? "bg-blue-50 text-blue-700 border border-blue-200" :
                                     "bg-orange-50 text-orange-700 border border-orange-200"
                    }`}>
                      {tier === "S" ? "S · Simple Frontend" : tier === "M" ? "M · Full-Stack App" : "L · Enterprise"}
                    </span>
                  )}
                  {isDone && <span className="text-[#94a3b8] text-[12px]">{step?.durationMs != null ? `Generated in ${(step.durationMs / 1000).toFixed(1)}s` : "Just now"}</span>}
                </div>
                <h2 className="text-[30px] font-semibold text-[#0f172a] tracking-[-0.3px] leading-[36px]">Product Requirements Document</h2>
                <p className="text-[14px] text-[#64748b] leading-[21px]">{step?.model ? <>Generated by <span className="font-medium">{step.model}</span></> : "Full PRD — user stories, acceptance criteria, and scope"}</p>
                {isDone && <div className="flex items-center gap-4 mt-1">{step?.costUsd != null && <span className="text-[11px] text-[#94a3b8]">Cost: <span className="font-medium text-[#64748b]">${step.costUsd.toFixed(4)}</span></span>}</div>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {prdHistoryRef.current.length > 1 && <button onClick={() => setShowDiff(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[#712ae2] bg-[rgba(113,42,226,0.07)] hover:bg-[rgba(113,42,226,0.13)] transition-colors mr-1" title="View version history & diff"><History size={13} />{prdHistoryRef.current.length} versions</button>}
                <button onClick={handleDownloadPdf} disabled={!isDone || isPrinting} className="flex items-center justify-center p-1.5 rounded-md text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Download PDF">{isPrinting ? <SpinnerIcon /> : <DownloadIcon />}</button>
              </div>
            </div>
            <div className="p-8">
              {error ? <div className="flex flex-col items-center justify-center py-20 gap-3 text-red-500"><span className="text-[13px]">{error}</span></div>
              : !content && !isThisRunning ? <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#94a3b8]"><span className="text-[13px]">Waiting for pipeline to start…</span></div>
              : isThisRunning && !content ? <div className="flex items-center gap-2 text-[#712ae2] text-[13px]"><SpinnerIcon /> Generating PRD…</div>
              : <MarkdownRenderer content={content} variant="prd" />}
            <div ref={bottomRef} />
            </div>
          </div>
          )}
        </div>
      </div>

      <StageInputBar
        value={editInput} onChange={setEditInput}
        onSubmit={() => { const instruction = editInput.trim(); if (!instruction || isThisRunning) return; setEditInput(""); setShowDiff(false); void executeStep("prd", instruction); }}
        placeholder="Ask AgenticBuilder to edit this PRD…" disabled={isThisRunning}
        actions={<div className="flex items-center gap-3 shrink-0"><button disabled={isThisRunning || isSavingDoc} onClick={() => { if (nextStep) props.onNavigate(nextStep); }} className="flex items-center gap-2 text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg h-10 px-4 shrink-0 text-sm font-semibold shadow-md hover:shadow-indigo-200 hover:shadow-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:active:scale-100">{isSavingDoc ? "Saving PRD…" : "Confirm PRD"}{!isSavingDoc && <ArrowRight size={16} color="white" />}</button></div>}
      />
    </div>
  );
}
