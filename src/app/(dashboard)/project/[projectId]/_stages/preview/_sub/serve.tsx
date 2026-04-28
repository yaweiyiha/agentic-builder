"use client";

import { usePipelineStore } from "@/store/pipeline-store";
import PreviewPanel from "@/components/PreviewPanel";
import { useStageStore } from "@/store/stage-store";

export default function ServeSubStage() {
  const codeOutputDir = usePipelineStore((s) => s.codeOutputDir);
  const goToSubStage  = useStageStore((s) => s.goToSubStage);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[20px] font-bold text-[#0b1c30]">Dev Server</h2>
            <p className="text-[13px] text-[#94a3b8] mt-0.5">
              Start the development server and preview the generated application.
            </p>
          </div>
          <button
            onClick={() => goToSubStage("e2e", "preview")}
            className="flex items-center gap-2 px-5 py-2 text-[13px] font-semibold text-[#712ae2] border border-[rgba(113,42,226,0.3)] rounded-md hover:bg-[rgba(113,42,226,0.05)] transition-colors"
          >
            Run E2E Tests →
          </button>
        </div>
      </div>

      {/* Preview panel */}
      <div className="flex-1 overflow-hidden">
        <PreviewPanel codeOutputDir={codeOutputDir} />
      </div>
    </div>
  );
}
