"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStepStore } from "@/store/step-store";
import PreviewPanel from "@/components/PreviewPanel";
import type { StepUIProps } from "../../../_shared/types";

export function ServeUI(props: StepUIProps) {
  const codeOutputDir = useStepStore((s) => s.codeOutputDir);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#0b1c30]">Dev Server</h2>
            <p className="text-[13px] text-[#94a3b8] mt-0.5">Start the development server and preview the generated application.</p>
          </div>
          <Button variant="outline" onClick={() => props.onNavigate("e2e")} className="gap-2 text-[#712ae2] border-[rgba(113,42,226,0.3)] hover:bg-[rgba(113,42,226,0.05)]">
            <FlaskConical size={14} /> Run E2E Tests
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <PreviewPanel codeOutputDir={codeOutputDir} />
      </div>
    </div>
  );
}
