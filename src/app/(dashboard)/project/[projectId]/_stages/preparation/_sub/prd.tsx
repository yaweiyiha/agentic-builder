"use client";

import { useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function PrdSubStage() {
  const step             = usePipelineStore((s) => s.steps.prd);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);
  const [isPrinting, setIsPrinting] = useState(false);

  const isThisRunning = isRunning && currentStep === "prd";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  const handleDownloadPdf = () => {
    if (!content || isPrinting) return;
    setIsPrinting(true);
    import("marked").then(({ marked }) => {
      const htmlBody = marked.parse(content) as string;
      const printWindow = window.open("", "_blank");
      if (!printWindow) { setIsPrinting(false); return; }
      printWindow.document.write(
        "<!DOCTYPE html><html><head><title>PRD</title>" +
        "<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.7}h1,h2,h3{color:#0f172a}code{background:#f1f5f9;padding:.2em .4em;border-radius:4px}pre code{display:block;padding:1rem;overflow-x:auto}</style>" +
        "</head><body>" + htmlBody + "</body></html>"
      );
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
    <DocViewerSubStage
      activeTabId="prd"
      title="Product Requirements Document"
      subtitle="Full PRD — user stories, acceptance criteria, and scope"
      editPlaceholder="Ask AgenticBuilder to edit this PRD..."
      isRunning={isThisRunning}
      isDone={isDone}
      step={step}
      content={content}
      confirmLabel="Confirm PRD"
      onConfirm={() => goToSubStage("trd", "preparation")}
      showDownload
      onDownload={handleDownloadPdf}
      downloadLoading={isPrinting}
      markdownVariant="prd"
    />
  );
}
