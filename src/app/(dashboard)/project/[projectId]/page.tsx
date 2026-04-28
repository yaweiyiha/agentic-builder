"use client";

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import PipelineNav from "@/components/PipelineNav";
import { useStageStore, type StageId } from "@/store/stage-store";
import { usePipelineStore } from "@/store/pipeline-store";
import PreparationStage from "./_stages/preparation";
import KickoffStage     from "./_stages/kickoff";
import CodingStage      from "./_stages/coding";
import PreviewStage     from "./_stages/preview";

function MonitorIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 24 20" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="14" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="20" viewBox="0 0 20 24" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2.5" />
    </svg>
  );
}

// ─── Stage → view map ────────────────────────────────────────────────────────

const STAGE_VIEWS: Record<StageId, React.ComponentType> = {
  preparation: PreparationStage,
  kickoff:     KickoffStage,
  coding:      CodingStage,
  preview:     PreviewStage,
};

// ─── Page (thin shell) ────────────────────────────────────────────────────────

export default function ProjectPage() {
  const params      = useParams<{ projectId: string }>();
  const projectId   = params.projectId;

  const activeStage            = useStageStore((s) => s.activeStage);
  const stageLoadFromServer    = useStageStore((s) => s.loadFromServer);
  const pipelineLoadFromServer = usePipelineStore((s) => s.loadFromServer);
  const setProjectSlugForSync  = usePipelineStore((s) => s.setProjectSlugForSync);

  const hydratedRef = useRef(false);

  // On mount: tell both stores which project we're on, then restore from DB.
  useEffect(() => {
    if (!projectId || hydratedRef.current) return;
    hydratedRef.current = true;
    setProjectSlugForSync(projectId);
    // Load both stores in parallel; stageLoadFromServer also sets _stageProjectSlug.
    Promise.all([
      pipelineLoadFromServer(projectId),
      stageLoadFromServer(projectId),
    ]).catch((err) => console.error("[ProjectPage] hydration error:", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const StageView = STAGE_VIEWS[activeStage];

  return (
    <div
      className="flex flex-col min-h-screen h-screen! relative"
      style={{ background: "linear-gradient(90deg, rgb(248,249,255) 0%, rgb(248,249,255) 100%)" }}
    >
      {/* Decorative blurs */}
      {/* <div className="pointer-events-none absolute right-[-100px] top-[-200px] w-[600px] h-[600px] rounded-[300px] bg-[#dbeafe] blur-[40px] opacity-40" />
      <div className="pointer-events-none absolute bottom-[-100px] left-[-100px] w-[500px] h-[500px] rounded-[250px] bg-[#faf5ff] blur-[40px] opacity-40" /> */}

      {/* ── Header ── */}
      <header className="flex h-16 items-center justify-between border-b border-[#e2e8f0] bg-white/80 backdrop-blur-[6px] px-8 relative z-10">
        <div className="flex items-center gap-8">
          <span className="text-[18px] font-black text-[#0f172a] leading-7">Pipeline</span>
          <PipelineNav />
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <button className="p-2 hover:bg-slate-50 rounded transition-colors"><MonitorIcon /></button>
            <button className="p-2 hover:bg-slate-50 rounded transition-colors"><BellIcon /></button>
            <button className="p-2 hover:bg-slate-50 rounded transition-colors"><QuestionIcon /></button>
          </div>
        </div>
      </header>

      {/* ── Active Stage View ── */}
      <main className="flex flex-1 flex-col relative z-0 overflow-hidden">
        <StageView />
      </main>
    </div>
  );
}
