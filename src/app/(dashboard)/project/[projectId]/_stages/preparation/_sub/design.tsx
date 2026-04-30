"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import StageInputBar from "@/components/StageInputBar";
import DesignReferencesDialog from "@/components/DesignReferencesDialog";
import { ArrowRight, ImageIcon } from "lucide-react";

// ─── Icon helpers ────────────────────────────────────────────────────────────

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

function DownloadIcon() {
  return (
    <svg width="11.667" height="11.667" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

// ─── Doc tab bar config ──────────────────────────────────────────────────────

type DocTab = "prd" | "design" | "trd" | "qa";

const DOC_TABS: { id: DocTab; label: string }[] = [
  { id: "prd",    label: "PRD" },
  { id: "design", label: "Design Document" },
  { id: "trd",    label: "Technical Specs" },
  { id: "qa",     label: "QA Plan" },
];

// ─── Main component ──────────────────────────────────────────────────────────

export default function DesignSubStage() {
  const step             = usePipelineStore((s) => s.steps.design);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const prdStep          = usePipelineStore((s) => s.steps.prd);
  const runDesignDoc     = usePipelineStore((s) => s.runDesignDoc);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);
  const isStageHydrated  = useStageStore((s) => s.isStageHydrated);

  const [editInput, setEditInput]               = useState("");
  const [isPrinting, setIsPrinting]             = useState(false);
  const [designDialogOpen, setDesignDialogOpen] = useState(false);

  const isThisRunning = isRunning && currentStep === "design";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  // Auto-start design generation when navigated here after PRD confirmation
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!isStageHydrated) return;
    if (autoStartedRef.current) return;
    if (isRunning) return;
    if (step) return; // already has content or was previously run
    if (prdStep?.status !== "completed" || !prdStep.content?.trim()) return;
    autoStartedRef.current = true;
    runDesignDoc();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStageHydrated, isRunning, step, prdStep]);

  const handleTabChange = (tab: DocTab) => {
    if (tab !== "design") goToSubStage(tab, "preparation");
  };

  const handleDownloadPdf = () => {
    if (!content || isPrinting) return;
    setIsPrinting(true);
    import("marked").then(({ marked }) => {
      const htmlBody = marked.parse(content) as string;
      const printWindow = window.open("", "_blank");
      if (!printWindow) { setIsPrinting(false); return; }
      printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Design Document</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.75; color: #1f2328; max-width: 860px; margin: 0 auto; padding: 48px 56px; }
    h1 { font-size: 2em; font-weight: 600; border-bottom: 1px solid #d0d7de; padding-bottom: .3em; margin: 1.5em 0 .75em; }
    h2 { font-size: 1.5em; font-weight: 600; border-bottom: 1px solid #d0d7de; padding-bottom: .3em; margin: 1.5em 0 .75em; }
    h3 { font-size: 1.25em; font-weight: 600; margin: 1.5em 0 .5em; }
    p { margin: 0 0 1em; } ul, ol { padding-left: 1.5em; margin: 0 0 1em; }
    code { font-family: monospace; font-size: .85em; background: #f6f8fa; border: 1px solid rgba(175,184,193,.2); border-radius: 6px; padding: .2em .4em; }
    pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 16px; overflow-x: auto; margin: 0 0 1em; }
    pre code { background: none; border: none; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 1em; }
    th, td { border: 1px solid #d0d7de; padding: 8px 16px; text-align: left; }
    thead { background: #f6f8fa; font-weight: 600; }
    @media print { body { padding: 0; } @page { margin: 20mm 18mm; } }
  </style>
</head>
<body><h1 style="margin-top:0">Design Document</h1>${htmlBody}</body>
</html>`);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
        printWindow.onafterprint = () => { printWindow.close(); setIsPrinting(false); };
        setTimeout(() => setIsPrinting(false), 5000);
      };
    }).catch(() => setIsPrinting(false));
  };

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* ── Doc Tab Bar ── */}
      <div className="shrink-0 bg-white border-b border-[#e2e8f0] flex items-center justify-between px-8">
        <div className="flex gap-8">
          {DOC_TABS.map((tab) => {
            const isActive = tab.id === "design";
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
                {tab.id === "design" && isDone && (
                  <span className="text-[#712ae2]"><CheckCircleIcon size={15} /></span>
                )}
              </button>
            );
          })}
        </div>

        {/* Upload design references */}
        <button
          onClick={() => setDesignDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[#64748b] hover:bg-slate-100 transition-colors"
        >
          <ImageIcon size={13} />
          Upload Design
        </button>
      </div>

      {/* ── Design Content Canvas ── */}
      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="w-full h-full">
          <div className="bg-white border border-[#e2e8f0] rounded-[4px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] overflow-hidden">

            {/* Document Header */}
            <div className="bg-[rgba(248,250,252,0.5)] border-b border-[#f1f5f9] px-8 pt-8 pb-[33px] flex items-start justify-between">
              <div className="flex flex-col gap-1">
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
                <h2 className="text-[30px] font-semibold text-[#0f172a] tracking-[-0.3px] leading-[36px]">
                  Design Document
                </h2>
                <p className="text-[14px] text-[#64748b] leading-[21px]">
                  {step?.model
                    ? <>Generated by <span className="font-medium">{step.model}</span></>
                    : "Visual system: color tokens, typography, component library, and layout patterns"}
                </p>
                {isDone && step?.costUsd != null && (
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-[11px] text-[#94a3b8]">
                      Cost: <span className="font-medium text-[#64748b]">${step.costUsd.toFixed(4)}</span>
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button className="p-2 rounded hover:bg-[#f1f5f9] transition-colors" title="Share">
                  <ShareIcon />
                </button>
                <button className="p-2 rounded hover:bg-[#f1f5f9] transition-colors" title="More">
                  <MoreVertIcon />
                </button>
              </div>
            </div>

            {/* Document Body */}
            <div className="p-8">
              {!content && !isThisRunning ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#94a3b8]">
                  <span className="text-[13px]">Waiting for pipeline to start…</span>
                </div>
              ) : isThisRunning && !content ? (
                <div className="flex items-center gap-2 text-[#712ae2] text-[13px]">
                  <SpinnerIcon /> Generating Design Document…
                </div>
              ) : (
                <MarkdownRenderer content={content} variant="default" />
              )}
            </div>

          </div>
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
          runDesignDoc(instruction);
        }}
        placeholder="Ask AgenticBuilder to edit this Design Document…"
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
              onClick={() => goToSubStage("pencil", "preparation")}
              className="flex items-center gap-2 text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg h-10 px-4 shrink-0 text-sm font-semibold shadow-md hover:shadow-indigo-200 hover:shadow-lg transition-all hover:scale-105 active:scale-95"
            >
              Confirm Design
              <ArrowRight size={16} color="white" />
            </button>
          </div>
        }
      />

      <DesignReferencesDialog
        isOpen={designDialogOpen}
        onClose={() => setDesignDialogOpen(false)}
      />
    </div>
  );
}
