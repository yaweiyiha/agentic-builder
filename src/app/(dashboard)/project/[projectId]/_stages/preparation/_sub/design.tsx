"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import DesignReferencesDialog from "@/components/DesignReferencesDialog";
import { Button } from "@/components/ui/button";
import DocViewerSubStage from "./_DocViewerSubStage";

export default function DesignSubStage() {
  const [designDialogOpen, setDesignDialogOpen] = useState(false);

  const step             = usePipelineStore((s) => s.steps.design);
  const streamingContent = usePipelineStore((s) => s.streamingContent);
  const currentStep      = usePipelineStore((s) => s.currentStep);
  const isRunning        = usePipelineStore((s) => s.isRunning);
  const goToSubStage     = useStageStore((s) => s.goToSubStage);

  const isThisRunning = isRunning && currentStep === "design";
  const content = isThisRunning ? streamingContent : (step?.content ?? "");
  const isDone  = step?.status === "completed";

  return (
    <>
      <DocViewerSubStage
        activeTabId="design"
        title="Design Document"
        subtitle="Visual system: color tokens, typography, component library, and layout patterns"
        editPlaceholder="Ask AgenticBuilder to edit this Design Document..."
        isRunning={isThisRunning}
        isDone={isDone}
        step={step}
        content={content}
        confirmLabel="View Wireframe"
        onConfirm={() => goToSubStage("pencil", "preparation")}
        showDownload
      />

      <div className="absolute top-4 right-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDesignDialogOpen(true)}
          className="text-xs text-[#64748b] h-7 px-2.5"
        >
          <ImageIcon className="size-3" />
          Upload Design
        </Button>
      </div>

      <DesignReferencesDialog
        isOpen={designDialogOpen}
        onClose={() => setDesignDialogOpen(false)}
      />
    </>
  );
}
