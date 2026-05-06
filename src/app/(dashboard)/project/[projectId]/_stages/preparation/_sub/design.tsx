"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import StageInputBar from "@/components/StageInputBar";

// ─── Main component ───────────────────────────────────────────────────────────

export default function DesignSubStage() {
  const steps            = usePipelineStore(s => s.steps);
  const streamingContent = usePipelineStore(s => s.streamingContent);
  const currentStep      = usePipelineStore(s => s.currentStep);
  const isRunning        = usePipelineStore(s => s.isRunning);
  const runDesignDoc     = usePipelineStore(s => s.runDesignDoc);

  const prdContent       = steps.prd?.content ?? "";
  const isDesignRunning  = isRunning && currentStep === "design";
  const designContent    = isDesignRunning ? streamingContent : (steps.design?.content ?? "");
  const isDesignDone     = steps.design?.status === "completed";

  const hasStartedRef    = useRef(false);
  const [editInput, setEditInput] = useState("");

  // Auto-start generation once PRD is available
  useEffect(() => {
    if (hasStartedRef.current) return;
    if (!prdContent.trim()) return;
    if (isDesignDone || isDesignRunning) return;
    hasStartedRef.current = true;
    runDesignDoc();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prdContent]);

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* Empty canvas — UI to be designed */}
      <div className="flex-1" />

      <StageInputBar
        value={editInput}
        onChange={setEditInput}
        onSubmit={() => {
          const instruction = editInput.trim();
          if (!instruction || isDesignRunning) return;
          setEditInput("");
          runDesignDoc(instruction);
        }}
        placeholder="Ask AgenticBuilder to generate or revise the design spec…"
        disabled={isDesignRunning}
      />
    </div>
  );
}
