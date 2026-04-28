"use client";

/**
 * Shared layout for all pipeline-step sub-stage pages (intent, prd, trd, …).
 * Each page imports this and passes its stepId + display metadata.
 */

import MarkdownRenderer from "@/components/MarkdownRenderer";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import type { PipelineStepId } from "@/lib/pipeline/types";
import type { PreparationSubStageId } from "@/store/stage-store";

interface Props {
  stepId: PipelineStepId;
  title: string;
  description: string;
  /** ID of the next sub-stage to jump to on completion (optional) */
  nextSubStage?: PreparationSubStageId;
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export default function PipelineStepSubStage({ stepId, title, description, nextSubStage }: Props) {
  const steps           = usePipelineStore((s) => s.steps);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep     = usePipelineStore((s) => s.currentStep);
  const isRunning       = usePipelineStore((s) => s.isRunning);
  const goToSubStage    = useStageStore((s) => s.goToSubStage);

  const step          = steps[stepId];
  const isThisRunning = isRunning && currentStep === stepId;

  // Content to display: use streaming buffer while running, committed content when done
  const content = isThisRunning
    ? streamingContent
    : step?.content ?? "";

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-[#0b1c30] leading-tight">{title}</h2>
            <p className="text-[13px] text-[#94a3b8] mt-0.5">{description}</p>
          </div>

          {/* Status badge */}
          {!step && (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#94a3b8] bg-[#f8fafc] border border-[#e2e8f0] px-3 py-1 rounded-full shrink-0">
              Waiting
            </span>
          )}
          {isThisRunning && (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#712ae2] bg-[rgba(113,42,226,0.06)] border border-[rgba(113,42,226,0.2)] px-3 py-1 rounded-full shrink-0">
              <SpinnerIcon /> Generating
            </span>
          )}
          {step?.status === "completed" && (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#16a34a] bg-[#f0fdf4] border border-[#bbf7d0] px-3 py-1 rounded-full shrink-0">
              <CheckCircleIcon /> Done
            </span>
          )}
          {step?.status === "failed" && (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] px-3 py-1 rounded-full shrink-0">
              <ErrorIcon /> Failed
            </span>
          )}
        </div>

        {/* Meta: model / cost / duration */}
        {step?.status === "completed" && (
          <div className="flex items-center gap-4 mt-3">
            {step.model && (
              <span className="text-[11px] text-[#94a3b8]">
                Model: <span className="text-[#64748b] font-medium">{step.model}</span>
              </span>
            )}
            {step.costUsd != null && (
              <span className="text-[11px] text-[#94a3b8]">
                Cost: <span className="text-[#64748b] font-medium">${step.costUsd.toFixed(4)}</span>
              </span>
            )}
            {step.durationMs != null && (
              <span className="text-[11px] text-[#94a3b8]">
                Time: <span className="text-[#64748b] font-medium">{(step.durationMs / 1000).toFixed(1)}s</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Idle state */}
        {!step && !isThisRunning && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4l3 3" />
              </svg>
            </div>
            <p className="text-[14px] text-[#94a3b8] max-w-[280px]">
              This step will run automatically as part of the pipeline.
            </p>
          </div>
        )}

        {/* Streaming / content */}
        {content && (
          <div className="prose prose-sm max-w-none">
            <MarkdownRenderer content={content} />
          </div>
        )}

        {/* Error state */}
        {step?.status === "failed" && (
          <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] p-5 text-[13px] text-[#dc2626] leading-6">
            <strong className="font-semibold block mb-1">Step failed</strong>
            {step.error ?? "An unknown error occurred."}
          </div>
        )}
      </div>

      {/* Footer: Next step CTA */}
      {step?.status === "completed" && nextSubStage && (
        <div className="shrink-0 flex justify-end px-8 py-4 border-t border-[#f1f5f9]">
          <button
            onClick={() => goToSubStage(nextSubStage, "preparation")}
            className="flex items-center gap-2 px-5 py-2 text-[13px] font-semibold text-[#712ae2] border border-[rgba(113,42,226,0.3)] rounded-md hover:bg-[rgba(113,42,226,0.05)] transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
