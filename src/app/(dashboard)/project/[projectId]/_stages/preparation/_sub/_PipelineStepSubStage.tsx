"use client";

/**
 * Shared layout for all pipeline-step sub-stage pages (intent, prd, trd, …).
 * Each page imports this and passes its stepId + display metadata.
 */

import { Loader2, CheckCircle2, AlertCircle, Clock, ArrowRight } from "lucide-react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PipelineStepId } from "@/lib/pipeline/types";
import type { PreparationSubStageId } from "@/store/stage-store";

interface Props {
  stepId: PipelineStepId;
  title: string;
  description: string;
  /** ID of the next sub-stage to jump to on completion (optional) */
  nextSubStage?: PreparationSubStageId;
}

export default function PipelineStepSubStage({ stepId, title, description, nextSubStage }: Props) {
  const steps            = usePipelineStore((s) => s.steps);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const step          = steps[stepId];
  const isThisRunning = isRunning && currentStep === stepId;

  // Content to display: use streaming buffer while running, committed content when done
  const content = isThisRunning
    ? streamingContent
    : step?.content ?? "";

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden bg-white">
      {/* Header */}
      <div className="shrink-0 px-8 pt-6 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-[#0b1c30] leading-tight">{title}</h2>
            <p className="text-sm text-[#94a3b8] mt-0.5">{description}</p>
          </div>

          {/* Status badge */}
          {!step && (
            <Badge variant="muted" className="shrink-0">
              <Clock className="size-3" />
              Waiting
            </Badge>
          )}
          {isThisRunning && (
            <Badge variant="warning" className="shrink-0">
              <Loader2 className="size-3 animate-spin" />
              Generating
            </Badge>
          )}
          {step?.status === "completed" && (
            <Badge variant="success" className="shrink-0">
              <CheckCircle2 className="size-3" />
              Done
            </Badge>
          )}
          {step?.status === "failed" && (
            <Badge variant="destructive" className="shrink-0">
              <AlertCircle className="size-3" />
              Failed
            </Badge>
          )}
        </div>

        {/* Meta: model / cost / duration */}
        {step?.status === "completed" && (
          <div className="flex items-center gap-4 mt-3">
            {step.model && (
              <span className="text-xs text-[#94a3b8]">
                Model: <span className="text-[#64748b] font-medium">{step.model}</span>
              </span>
            )}
            {step.costUsd != null && (
              <span className="text-xs text-[#94a3b8]">
                Cost: <span className="text-[#64748b] font-medium">${step.costUsd.toFixed(4)}</span>
              </span>
            )}
            {step.durationMs != null && (
              <span className="text-xs text-[#94a3b8]">
                Time: <span className="text-[#64748b] font-medium">{(step.durationMs / 1000).toFixed(1)}s</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="px-8 py-6">
          {/* Idle state */}
          {!step && !isThisRunning && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
              <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center text-[#cbd5e1]">
                <Clock className="size-4" />
              </div>
              <p className="text-sm text-[#94a3b8] max-w-70">
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
            <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] p-5 text-sm text-[#dc2626] leading-6">
              <strong className="font-semibold block mb-1">Step failed</strong>
              {step.error ?? "An unknown error occurred."}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer: Next step CTA */}
      {step?.status === "completed" && nextSubStage && (
        <>
          <Separator />
          <div className="shrink-0 flex justify-end px-8 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToSubStage(nextSubStage, "preparation")}
              className="text-[#712ae2] border-[rgba(113,42,226,0.3)] hover:bg-[rgba(113,42,226,0.05)] hover:text-[#712ae2]"
            >
              Next
              <ArrowRight className="size-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
