"use client";

import { useState } from "react";
import { Paperclip, Zap, ArrowRight, Info } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { STAGE_ORDER, STAGE_META } from "@/store/stage-store";
import ImportPrdDialog from "@/components/ImportPrdDialog";
import type { StepUIProps } from "../../../_shared/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function StageProgressBar() {
  return (
    <div className="w-full max-w-180 grid grid-cols-4 gap-6">
      {STAGE_ORDER.map((stageId, i) => {
        const meta = STAGE_META[stageId];
        const isFirst = i === 0;
        return (
          <div key={stageId} className="relative flex flex-col items-start">
            <div className={`absolute -left-1 top-0 bottom-0 w-0.75 rounded-xl ${isFirst ? "bg-[#712ae2] shadow-[0px_0px_8px_0px_rgba(113,42,226,0.5)]" : "bg-[#e2e8f0]"}`} />
            <div className={`flex flex-col gap-[3.5px] pl-4 ${!isFirst ? "opacity-40" : ""}`}>
              <span className={`text-[10px] font-bold uppercase leading-3.75 ${isFirst ? "text-[#712ae2]" : "text-[#94a3b8]"}`}>STAGE {meta.id}</span>
              <span className="text-sm font-bold text-[#0b1c30] leading-5">{meta.name}</span>
              <p className="text-xs text-[#64748b] leading-4">{meta.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function InitialUI(props: StepUIProps) {
  const [prompt, setPrompt] = useState("");
  const [prdDialogOpen, setPrdDialogOpen] = useState(false);

  const setFeatureBrief = useStepStore((s) => s.setFeatureBrief);
  const isRunning       = useStepStore((s) => s.isRunning);

  function handleInitialize() { if (!prompt.trim() || isRunning) return; setFeatureBrief(prompt.trim()); props.onNavigate("intent"); }

  return (
    <>
      <div className="flex flex-col justify-center items-center flex-1 h-full px-8 pt-8 pb-12 gap-10 overflow-auto">
        <div className="flex flex-col items-center w-full max-w-230 gap-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-[#0b1c30] leading-tight">Ready to build</h1>
            <p className="text-[15px] text-[#7c839b] max-w-120 leading-7">Describe the objective of your autonomous agent. The pipeline will handle orchestration, coding, and deployment automatically.</p>
          </div>
          <Card className="w-full shadow-[0_10px_40px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <CardContent className="p-0">
              <div className="px-6 pt-6 pb-3">
                <Textarea rows={5} placeholder={"Describe what your agent should do…\ne.g. 'Build a market research agent that scrapes top tech news and summarizes them into a Slack report every morning.'"} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={isRunning} className="border-0 focus-visible:ring-0 text-[15px] text-[#0b1c30] placeholder:text-[#94a3b8] leading-6 min-h-30 px-0 py-0 shadow-none" />
              </div>
              <Separator />
              <div className="flex items-center justify-between bg-[#fafbfc] px-4 py-3">
                <div />
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setPrdDialogOpen(true)} className="text-xs text-[#64748b] h-7 px-2.5"><Paperclip className="size-3" /> PRD</Button>
                  </div>
                  <Button disabled={!prompt.trim() || isRunning} onClick={handleInitialize} size="sm" className="text-[13px] font-bold px-5 h-9">{isRunning ? "Starting…" : "Start Generation"}<ArrowRight className="size-3" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="max-w-180 w-full shadow-sm bg-white/70">
            <CardContent className="flex items-center gap-3 px-5 py-3">
              <Info className="size-4 text-[#712ae2] shrink-0" />
              <p className="text-sm text-[#7c839b] leading-5">Upload existing project docs to accelerate the <strong className="font-semibold text-[#475569]">Preparation</strong> phase.</p>
            </CardContent>
          </Card>
        </div>
      </div>
      <ImportPrdDialog isOpen={prdDialogOpen} onClose={() => setPrdDialogOpen(false)} />
    </>
  );
}
