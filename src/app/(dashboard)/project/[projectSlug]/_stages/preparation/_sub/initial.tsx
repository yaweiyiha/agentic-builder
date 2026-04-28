"use client";

import { useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore, STAGE_ORDER, STAGE_META } from "@/store/stage-store";
import ImportPrdDialog from "@/components/ImportPrdDialog";
import DesignReferencesDialog from "@/components/DesignReferencesDialog";

// ─── Decorative Stage Progress Bar (display-only) ────────────────────────────

function StageProgressBar() {
  return (
    <div className="w-full max-w-[720px] grid grid-cols-4 gap-6">
      {STAGE_ORDER.map((stageId, i) => {
        const meta = STAGE_META[stageId];
        const isFirst = i === 0;
        return (
          <div key={stageId} className="relative flex flex-col items-start">
            {/* Left accent bar */}
            <div
              className={`absolute left-[-4px] top-0 bottom-0 w-[3px] rounded-xl ${
                isFirst
                  ? "bg-[#712ae2] shadow-[0px_0px_8px_0px_rgba(113,42,226,0.5)]"
                  : "bg-[#e2e8f0]"
              }`}
            />
            <div
              className={`flex flex-col gap-[3.5px] pl-4 ${!isFirst ? "opacity-40" : ""}`}
            >
              <span
                className={`text-[10px] font-bold uppercase leading-[15px] ${
                  isFirst ? "text-[#712ae2]" : "text-[#94a3b8]"
                }`}
              >
                STAGE {meta.id}
              </span>
              <span className="text-[14px] font-bold text-[#0b1c30] leading-5">
                {meta.name}
              </span>
              <p className="text-[12px] text-[#64748b] leading-4">
                {meta.desc}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function ArrowRightIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 5h8M5 1l4 4-4 4" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg
      width="9"
      height="14"
      viewBox="0 0 12 18"
      fill="none"
      stroke="#94a3b8"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 7V13a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v8a1 1 0 0 1-2 0V7" />
    </svg>
  );
}

function DesignIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#94a3b8"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="#94a3b8"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13 2L4.09 12.36A1 1 0 0 0 5 14h6l-1 6 8.91-10.36A1 1 0 0 0 18 8h-6l1-6z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#712ae2"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="8.5" strokeWidth="2.5" />
      <line x1="12" y1="11" x2="12" y2="16" />
    </svg>
  );
}

export default function InitialSubStage() {
  const [mode, setMode] = useState<"Quick" | "Advanced">("Quick");
  const [prompt, setPrompt] = useState("");
  const [prdDialogOpen, setPrdDialogOpen] = useState(false);
  const [designDialogOpen, setDesignDialogOpen] = useState(false);

  const setPendingBrief = usePipelineStore((s) => s.setPendingBrief);
  const setFastFromPrd  = usePipelineStore((s) => s.setFastFromPrd);
  const isRunning       = usePipelineStore((s) => s.isRunning);
  const goToSubStage    = useStageStore((s) => s.goToSubStage);

  function handleModeChange(m: "Quick" | "Advanced") {
    setMode(m);
    setFastFromPrd(m === "Quick");
  }

  function handleInitialize() {
    if (!prompt.trim() || isRunning) return;
    // Save the brief without starting the full pipeline yet.
    // Intent Q&A runs first; "Start Generation" in intent.tsx fires startPipeline.
    setPendingBrief(prompt.trim());
    goToSubStage("intent", "preparation");
  }

  return (
    <>
    <div className="flex flex-col items-center flex-1 px-8 pt-8 pb-12 gap-10">
      <div className="flex flex-col items-center w-full max-w-[920px] gap-8">
        {/* Heading */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="inline-flex items-center px-3 py-1 rounded-xl bg-[rgba(113,42,226,0.08)] border border-[rgba(113,42,226,0.18)]">
            <span className="text-[12px] font-semibold tracking-[3px] uppercase text-[#712ae2]">
              PHASE 01 · INITIAL
            </span>
          </div>
          <h1 className="text-[40px] font-bold tracking-[-0.8px] text-[#0b1c30] leading-tight">
            Ready to build
          </h1>
          <p className="text-[15px] text-[#7c839b] max-w-[480px] leading-7">
            Describe the objective of your autonomous agent. The pipeline will
            handle orchestration, coding, and deployment automatically.
          </p>
        </div>

        {/* Prompt card */}
        <div className="w-full rounded-lg border border-[#e2e8f0] bg-white shadow-[0_10px_40px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="px-6 pt-6 pb-3">
            <textarea
              className="w-full resize-none bg-transparent text-[15px] text-[#0b1c30] placeholder-[#94a3b8] leading-6 outline-none min-h-[120px]"
              rows={5}
              placeholder="Describe what your agent should do…&#10;e.g. 'Build a market research agent that scrapes top tech news and summarizes them into a Slack report every morning.'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRunning}
            />
          </div>

          <div className="flex items-center justify-between border-t border-[#f1f5f9] bg-[#fafbfc] px-4 py-3">
            {/* Mode toggle */}
            <div className="flex items-center gap-1 bg-[rgba(226,232,240,0.6)] rounded p-1">
              {(["Quick", "Advanced"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  className={`px-3.5 py-1.5 text-[11px] font-semibold rounded-sm transition-all ${
                    mode === m
                      ? "bg-white text-[#0f172a] shadow-sm"
                      : "text-[#64748b] hover:text-[#334155]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPrdDialogOpen(true)}
                  title="Import PRD"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-[#f1f5f9] transition-colors text-[11px] font-medium text-[#64748b] hover:text-[#334155]"
                >
                  <AttachIcon />
                  <span>PRD</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDesignDialogOpen(true)}
                  title="Upload design references"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded hover:bg-[#f1f5f9] transition-colors text-[11px] font-medium text-[#64748b] hover:text-[#334155]"
                >
                  <DesignIcon />
                  <span>Design</span>
                </button>
                <button className="p-1.5 rounded hover:bg-[#f1f5f9] transition-colors">
                  <BoltIcon />
                </button>
              </div>
              <button
                disabled={!prompt.trim() || isRunning}
                onClick={handleInitialize}
                className="flex items-center gap-2 px-6 py-2.5 bg-[#131b2e] text-white text-[13px] font-bold rounded-md hover:bg-[#1e2d47] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isRunning ? "Starting…" : "Initialize Pipeline"}
                <ArrowRightIcon />
              </button>
            </div>
          </div>
        </div>

        {/* Decorative stage progress */}
        <StageProgressBar />

        {/* Hint */}
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-white/70 max-w-[720px] border border-[#e2e8f0] shadow-sm w-full">
          <InfoIcon />
          <p className="text-[13px] text-[#7c839b] leading-5">
            Upload existing project docs to accelerate the{" "}
            <strong className="font-semibold text-[#475569]">
              Preparation
            </strong>{" "}
            phase.
          </p>
        </div>
      </div>
    </div>

      <ImportPrdDialog
        isOpen={prdDialogOpen}
        onClose={() => setPrdDialogOpen(false)}
      />
      <DesignReferencesDialog
        isOpen={designDialogOpen}
        onClose={() => setDesignDialogOpen(false)}
      />
    </>
  );
}
