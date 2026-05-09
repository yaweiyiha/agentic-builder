"use client";

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Monitor, Bell, HelpCircle } from "lucide-react";
import PipelineNav from "@/components/PipelineNav";
import { useStageStore, type StageId } from "@/store/stage-store";
import { usePipelineStore } from "@/store/pipeline-store";
import { Button } from "@/components/ui/button";
import PreparationStage from "./_stages/preparation";
import KickoffStage     from "./_stages/kickoff";
import CodingStage      from "./_stages/coding";
import PreviewStage     from "./_stages/preview";

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
  const goToStage              = useStageStore((s) => s.goToStage);
  const stageLoadFromServer    = useStageStore((s) => s.loadFromServer);
  const pipelineLoadFromServer = usePipelineStore((s) => s.loadFromServer);
  const setProjectSlugForSync  = usePipelineStore((s) => s.setProjectSlugForSync);

  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!projectId || hydratedRef.current) return;
    hydratedRef.current = true;
    setProjectSlugForSync(projectId);
    Promise.all([
      pipelineLoadFromServer(projectId),
      stageLoadFromServer(projectId),
    ]).catch((err) => console.error("[ProjectPage] hydration error:", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const StageView = STAGE_VIEWS[activeStage];

  return (
    <div className="flex flex-col min-h-screen h-screen! relative bg-[#f8f9ff]">
      {/* ── Header ── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#e2e8f0] bg-white/90 backdrop-blur-sm px-6 relative z-10">
        <div className="flex items-center gap-6">
          <PipelineNav activeStage={activeStage} onStageChange={goToStage} />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#64748b]">
            <Monitor className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#64748b]">
            <Bell className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#64748b]">
            <HelpCircle className="size-4" />
          </Button>
        </div>
      </header>

      {/* ── Active Stage View ── */}
      <main className="flex flex-1 flex-col relative z-0 overflow-hidden">
        <StageView />
      </main>
    </div>
  );
}
