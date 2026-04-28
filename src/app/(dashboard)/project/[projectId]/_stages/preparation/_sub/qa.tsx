"use client";

import { useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import MarkdownRenderer from "@/components/MarkdownRenderer";

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
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

export default function QaSubStage() {
  const step             = usePipelineStore((s) => s.steps.qa);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);
  const goToStage        = useStageStore((s) => s.goToStage);

  const [editInput, setEditInput] = useState("");

  const isThisRunning = isRunning && currentStep === "qa";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">

      {/* ── Secondary Document Tab Bar ── */}
      <div className="shrink-0 bg-white border-b border-[#e2e8f0] flex items-center justify-between px-8">
        <div className="flex gap-8">
          {DOC_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => goToSubStage(tab.id, "preparation")}
              className={`relative flex items-center gap-2 py-[17px] text-[14px] font-semibold transition-colors ${
                tab.id === "qa"
                  ? "text-[#0f172a] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#712ae2] after:rounded-t-full"
                  : "text-[#94a3b8] hover:text-[#64748b]"
              }`}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => goToStage("kickoff")}
          className="flex items-center gap-2 border border-[rgba(113,42,226,0.2)] text-[#712ae2] text-[12px] font-bold px-[17px] py-[7px] rounded-[4px] hover:bg-[rgba(113,42,226,0.05)] transition-colors"
        >
          Proceed to Kick-off
          <ArrowRightIcon size={9.333} color="#712ae2" />
        </button>
      </div>

      {/* ── Content Canvas ── */}
      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="max-w-[1024px]">
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
                      {step?.durationMs != null ? `Generated in ${(step.durationMs / 1000).toFixed(1)}s` : "Just now"}
                    </span>
                  )}
                </div>
                <h2 className="text-[30px] font-semibold text-[#0f172a] tracking-[-0.3px] leading-[36px]">QA Plan</h2>
                <p className="text-[14px] text-[#64748b] leading-[21px]">
                  {step?.model
                    ? <>{`Generated by `}<span className="font-medium">{step.model}</span></>
                    : "Quality assurance checklist verifying all requirements are covered before kick-off"}
                </p>
                {isDone && step?.costUsd != null && (
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-[11px] text-[#94a3b8]">Cost: <span className="font-medium text-[#64748b]">${step.costUsd.toFixed(4)}</span></span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button className="p-2 rounded hover:bg-[#f1f5f9] transition-colors" title="Share"><ShareIcon /></button>
                <button className="p-2 rounded hover:bg-[#f1f5f9] transition-colors" title="More"><MoreVertIcon /></button>
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
                  <SpinnerIcon /> Generating QA plan…
                </div>
              ) : (
                <MarkdownRenderer content={content} />
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 backdrop-blur-[6px] bg-[rgba(255,255,255,0.8)] border-t border-[#e2e8f0] flex items-center justify-between px-8 py-4 gap-8">
        <div className="flex-1 min-w-0 relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"><SparkleIcon /></div>
          <input
            value={editInput}
            onChange={(e) => setEditInput(e.target.value)}
            placeholder="Ask AgenticBuilder to refine this QA plan..."
            className="w-full bg-[#f8fafc] border border-[#e2e8f0] rounded-[4px] pl-10 pr-12 py-[10px] text-[14px] text-[#0f172a] placeholder:text-[#6b7280] focus:outline-none focus:ring-1 focus:ring-[#712ae2] focus:border-[#712ae2] transition-colors"
          />
          {editInput && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:opacity-70 transition-opacity" title="Send">
              <SendIcon />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => goToStage("kickoff")}
            className="flex items-center gap-2 bg-[#712ae2] text-white text-[14px] font-bold px-6 py-2 rounded-[4px] hover:bg-[#5b22b8] transition-colors shadow-[0px_10px_15px_-3px_rgba(113,42,226,0.2),0px_4px_6px_-4px_rgba(113,42,226,0.2)]"
          >
            Proceed to Kick-off
            <ArrowRightIcon size={11.667} color="white" />
          </button>
        </div>
      </div>

    </div>
  );
}
