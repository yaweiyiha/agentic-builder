"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { getNextStep } from "@/_config/pipeline-flow";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import StageInputBar from "@/components/StageInputBar";
import type { StepUIProps } from "../../../_shared/types";

// ─── Icons ─────────────────────────────────────────────────────────────────
function SpinnerIcon() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="11.667"
      height="11.667"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#334155"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export function TrdUI(props: StepUIProps) {
  // All state from step-store (single source of truth)
  const step = useStepStore((s) => s.steps.trd);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const currentStep = useStepStore((s) => s.currentStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const featureBrief = useStepStore((s) => s.featureBrief);
  const steps = useStepStore((s) => s.steps);
  const isHydrated = useStepStore((s) => s.isHydrated);
  const executeStep = useStepStore((s) => s.executeStep);

  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("trd", tier);

  const [editInput, setEditInput] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);
  const autoStartedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-start: when both PRD and design spec are available and TRD hasn't been generated yet
  useEffect(() => {
    console.log("[TrdUI] auto-start effect running", { isHydrated, autoStarted: autoStartedRef.current, isRunning, hasContent: !!step?.content, hasPrd: !!steps.prd?.content, hasDesign: !!steps.design?.content, prdStatus: steps.prd?.status, designStatus: steps.design?.status });
    if (!isHydrated) { console.log("[TrdUI] skip: not hydrated"); return; }
    if (autoStartedRef.current) { console.log("[TrdUI] skip: already started"); return; }
    if (isRunning) { console.log("[TrdUI] skip: isRunning is true"); return; }
    if (step?.content) { console.log("[TrdUI] skip: already has content"); return; }
    const prdContent = steps.prd?.content ?? featureBrief;
    if (!prdContent.trim()) { console.log("[TrdUI] skip: no prd content"); return; }
    const designContent = steps.design?.content ?? "";
    if (!designContent.trim()) { console.log("[TrdUI] skip: no design content"); return; }
    console.log("[TrdUI] ALL CHECKS PASSED, starting executeStep");
    autoStartedRef.current = true;
    void executeStep("trd");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, steps.prd?.content, steps.design?.content, step?.content]);

  const isThisRunning = isRunning && currentStep === "trd";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone = step?.status === "completed";

  // Auto-scroll to bottom during SSE streaming
  useEffect(() => {
    if (isThisRunning && content) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [content, isThisRunning]);

  const handleDownloadPdf = () => {
    if (!content || isPrinting) return;
    setIsPrinting(true);
    import("marked")
      .then(({ marked }) => {
        const htmlBody = marked.parse(content) as string;
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          setIsPrinting(false);
          return;
        }
        printWindow.document.write(
          `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Technical Requirements Document</title><style>*,*::before,*::after{box-sizing:border-box}html{font-size:16px}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.75;color:#1f2328;background:#fff;max-width:860px;margin:0 auto;padding:48px 56px}h1{font-size:2em;font-weight:600;border-bottom:1px solid #d0d7de;padding-bottom:.3em;margin:1.5em 0 .75em}h2{font-size:1.5em;font-weight:600;border-bottom:1px solid #d0d7de;padding-bottom:.3em;margin:1.5em 0 .75em}h3{font-size:1.25em;font-weight:600;margin:1.5em 0 .5em}h4{font-size:1em;font-weight:600;margin:1.25em 0 .4em}h5{font-size:.875em;font-weight:600;margin:1em 0 .3em}h6{font-size:.85em;font-weight:600;color:#57606a;margin:1em 0 .3em}p{margin:0 0 1em}ul,ol{padding-left:1.5em;margin:0 0 1em}li+li{margin-top:.25em}a{color:#0969da;text-decoration:underline}strong{font-weight:600}em{font-style:italic}code{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:.85em;background:#f6f8fa;border:1px solid rgba(175,184,193,.2);border-radius:6px;padding:.2em .4em}pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:16px;overflow-x:auto;margin:0 0 1em}pre code{background:none;border:none;padding:0;font-size:13px}blockquote{border-left:4px solid #d0d7de;color:#57606a;margin:0 0 1em;padding:0 1em}table{border-collapse:collapse;width:100%;margin:0 0 1em;font-size:14px}th,td{border:1px solid #d0d7de;padding:8px 16px;text-align:left}thead{background:#f6f8fa;font-weight:600}tbody tr:nth-child(even){background:#f6f8fa}hr{border:none;border-top:1px solid #d0d7de;margin:1.5em 0}@media print{body{padding:0}@page{margin:20mm 18mm}}</style></head><body><h1 style="margin-top:0">Technical Requirements Document</h1>${htmlBody}</body></html>`,
        );
        printWindow.document.close();
        printWindow.onload = () => {
          printWindow.focus();
          printWindow.print();
          printWindow.onafterprint = () => {
            printWindow.close();
            setIsPrinting(false);
          };
          setTimeout(() => setIsPrinting(false), 5000);
        };
      })
      .catch(() => setIsPrinting(false));
  };

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="w-full h-full">
          <div className="bg-white border border-[#e2e8f0] rounded-[4px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] overflow-hidden">
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
                  Technical Requirements Document
                </h2>
                <p className="text-[14px] text-[#64748b] leading-[21px]">
                  {step?.model ? (
                    <>
                      Generated by{" "}
                      <span className="font-medium">{step.model}</span>
                    </>
                  ) : (
                    "API contracts, data models, service boundaries, and non-functional constraints"
                  )}
                </p>
                {isDone && (
                  <div className="flex items-center gap-4 mt-1">
                    {step?.costUsd != null && (
                      <span className="text-[11px] text-[#94a3b8]">
                        Cost:{" "}
                        <span className="font-medium text-[#64748b]">
                          ${step.costUsd.toFixed(4)}
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={handleDownloadPdf}
                  disabled={!isDone || isPrinting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Download PDF"
                >
                  {isPrinting ? <SpinnerIcon /> : <DownloadIcon />}
                  {isPrinting ? "Preparing…" : "Download PDF"}
                </button>
              </div>
            </div>
            <div className="p-8">
              {!content && !isThisRunning ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#94a3b8]">
                  <span className="text-[13px]">
                    Waiting for pipeline to start…
                  </span>
                </div>
              ) : isThisRunning && !content ? (
                <div className="flex items-center gap-2 text-[#712ae2] text-[13px]">
                  <SpinnerIcon /> Generating TRD…
                </div>
              ) : (
                <MarkdownRenderer content={content} variant="default" />
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        </div>
      </div>

      <StageInputBar
        value={editInput}
        onChange={setEditInput}
        onSubmit={() => {
          const instruction = editInput.trim();
          if (!instruction || isThisRunning) return;
          setEditInput("");
          void executeStep("trd", instruction);
        }}
        placeholder="Ask AgenticBuilder to edit this TRD…"
        disabled={isThisRunning}
        actions={
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                if (nextStep) props.onNavigate(nextStep);
              }}
              className="flex items-center gap-2 text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg h-10 px-4 shrink-0 text-sm font-semibold shadow-md hover:shadow-indigo-200 hover:shadow-lg transition-all hover:scale-105 active:scale-95"
            >
              Confirm TRD
              <ArrowRight size={16} color="white" />
            </button>
          </div>
        }
      />
    </div>
  );
}
