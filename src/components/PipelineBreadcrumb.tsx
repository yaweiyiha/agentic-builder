"use client";

import React, { useMemo, useRef, useEffect, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  getStagesForTier,
  getNodePath,
  areDependenciesMet,
  STAGE_LABELS,
  GROUP_LABELS,
  STEP_LABELS,
} from "@/_config/pipeline-flow";
import type { StepId, StageId, ProjectTier } from "@/_config/pipeline-flow";
import type { StepStatus } from "@/app/(dashboard)/project/[projectId]/_steps/_shared/types";

// ── Status Dot ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: StepStatus }) {
  const colors: Record<StepStatus, string> = {
    idle: "bg-gray-300",
    running: "bg-blue-500 animate-pulse",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
  };
  return <span className={`inline-block size-2 rounded-full shrink-0 ${colors[status]}`} />;
}

// ── Dropdown ────────────────────────────────────────────────────────────────

function BreadcrumbDropdown({
  items,
  activeId,
  onSelect,
  showStatus,
}: {
  items: { id: string; label: string; disabled?: boolean; status?: StepStatus; parallelHint?: boolean }[];
  activeId: string;
  onSelect: (id: string) => void;
  showStatus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeItem = items.find((i) => i.id === activeId);
  const label = activeItem?.label ?? activeId;

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-1 -mx-1 rounded-md text-sm font-medium transition-colors hover:bg-[#f1f5f9] text-[#334155]"
      >
        {label}
        <ChevronDown size={12} className={`text-[#94a3b8] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[180px] bg-white rounded-lg shadow-lg border border-[#e2e8f0] z-50 py-1 overflow-hidden">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => { onSelect(item.id); setOpen(false); }}
              className={[
                "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                item.id === activeId
                  ? "bg-[#4f46e5]/10 text-[#4f46e5] font-medium"
                  : item.disabled
                    ? "text-gray-300 cursor-not-allowed"
                    : "text-[#334155] hover:bg-[#f8fafc]",
              ].join(" ")}
            >
              {showStatus && item.status && <StatusDot status={item.status} />}
              <span className="flex-1 truncate">{item.label}</span>
              {item.parallelHint && <span className="text-[10px] text-[#94a3b8] shrink-0">∥</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════════

export interface PipelineBreadcrumbProps {
  /** Currently active step — controlled by parent */
  activeStep: StepId;
  /** Called when user clicks a breadcrumb item */
  onStepChange: (stepId: StepId) => void;
  /** Project tier for filtering visible steps */
  tier: ProjectTier;
  /** Step execution state for status dots (from pipeline-store) */
  stepStates: Partial<Record<string, { status: string } | null>>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function PipelineBreadcrumb({
  activeStep,
  onStepChange,
  tier,
  stepStates,
}: PipelineBreadcrumbProps) {
  const currentPath = useMemo(() => getNodePath(activeStep), [activeStep]);
  const stages = useMemo(() => getStagesForTier(tier), [tier]);

  // ── Build L1 items (stages) ──
  const l1Items = useMemo(
    () =>
      stages.map((s) => ({
        id: s.id,
        label: `${STAGE_LABELS[s.id as StageId]?.num ?? ""} ${STAGE_LABELS[s.id as StageId]?.name ?? s.label}`,
      })),
    [stages],
  );

  const activeStageId = currentPath?.stage.id ?? "preparation";

  // ── Build L2 items (groups) ──
  const l2Items = useMemo(() => {
    const stage = stages.find((s) => s.id === activeStageId);
    if (!stage?.children) return [];
    return stage.children
      .filter((g) => !g.tiers || g.tiers.includes(tier))
      .map((g) => ({
        id: g.id,
        label: GROUP_LABELS[g.id as keyof typeof GROUP_LABELS] ?? g.label,
        parallelHint: g.parallel && (g.children?.length ?? 0) > 1,
      }));
  }, [stages, activeStageId, tier]);

  const activeGroupId = currentPath?.group.id ?? (l2Items[0]?.id ?? null);

  // ── Build L3 items (steps) ──
  const completedStepIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, r] of Object.entries(stepStates)) {
      if (r && r.status === "completed") ids.add(id);
    }
    return ids;
  }, [stepStates]);

  const l3Items = useMemo(() => {
    const stage = stages.find((s) => s.id === activeStageId);
    const group = stage?.children?.find((g) => g.id === activeGroupId);
    if (!group?.children) return [];
    return group.children
      .filter((s) => !s.tiers || s.tiers.includes(tier))
      .map((s) => {
        const stepId = s.id as StepId;
        const result = stepStates[stepId];
        const depsMet = areDependenciesMet(stepId, completedStepIds);
        return {
          id: s.id,
          label: STEP_LABELS[stepId] ?? s.label,
          status: ((result as { status?: string } | null)?.status ?? "idle") as StepStatus,
          disabled: !depsMet && stepId !== activeStep,
        };
      });
  }, [stages, activeStageId, activeGroupId, tier, stepStates, completedStepIds, activeStep]);

  // ── Handlers ──
  const handleL1Select = (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId);
    const firstGroup = stage?.children?.[0];
    const firstStep = firstGroup?.children?.[0];
    if (firstStep) onStepChange(firstStep.id as StepId);
  };

  const handleL2Select = (groupId: string) => {
    const stage = stages.find((s) => s.id === activeStageId);
    const group = stage?.children?.find((g) => g.id === groupId);
    const firstStep = group?.children?.find((s) => !s.tiers || s.tiers.includes(tier));
    if (firstStep) onStepChange(firstStep.id as StepId);
  };

  const handleL3Select = (stepId: string) => {
    onStepChange(stepId as StepId);
  };

  return (
    <div className="flex items-center gap-1 text-sm py-3 select-none">
      <BreadcrumbDropdown items={l1Items} activeId={activeStageId} onSelect={handleL1Select} />
      {activeGroupId && l2Items.length > 0 && (
        <>
          <ChevronRight size={14} className="text-[#cbd5e1] shrink-0 mx-0.5" />
          <BreadcrumbDropdown items={l2Items} activeId={activeGroupId} onSelect={handleL2Select} />
        </>
      )}
      {activeStep && l3Items.length > 0 && (
        <>
          <ChevronRight size={14} className="text-[#cbd5e1] shrink-0 mx-0.5" />
          <BreadcrumbDropdown items={l3Items} activeId={activeStep} onSelect={handleL3Select} showStatus />
        </>
      )}
    </div>
  );
}
