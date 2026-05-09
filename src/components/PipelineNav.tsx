"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { StageId } from "@/store/stage-store";

const NAV_STAGES = ["PREPARATION", "KICK-OFF", "CODING", "PREVIEW"] as const;
export type NavStage = (typeof NAV_STAGES)[number];

/** Maps nav label → store StageId */
const NAV_TO_STAGE_ID: Record<NavStage, StageId> = {
  PREPARATION: "preparation",
  "KICK-OFF":  "kickoff",
  CODING:      "coding",
  PREVIEW:     "preview",
};

/** Maps nav label → URL search-param value (legacy pipeline route) */
const STAGE_PARAM: Record<NavStage, string> = {
  PREPARATION: "preparation",
  "KICK-OFF":  "kick-off",
  CODING:      "coding",
  PREVIEW:     "preview",
};

interface PipelineNavProps {
  /**
   * Base path for URL-based navigation (legacy pipeline page).
   * Defaults to "/dashboard/pipeline".
   * Ignored when `activeStage` / `onStageChange` are provided.
   */
  basePath?: string;

  /**
   * When provided, the nav reads active state from the store (project page mode)
   * instead of the URL ?stage= param.
   */
  activeStage?: StageId;

  /**
   * Called when the user clicks a nav item in store-driven mode.
   * Ignored when `activeStage` is not provided.
   */
  onStageChange?: (stage: StageId) => void;
}

export default function PipelineNav({
  basePath = "/dashboard/pipeline",
  activeStage: controlledStage,
  onStageChange,
}: PipelineNavProps) {
  const searchParams = useSearchParams();

  // Store-driven mode: use the provided activeStage prop.
  // URL-driven mode (legacy): derive active stage from ?stage= search param.
  const activeStage: NavStage = controlledStage
    ? ((Object.entries(NAV_TO_STAGE_ID).find(([, id]) => id === controlledStage)?.[0] as NavStage) ?? "PREPARATION")
    : ((Object.entries(STAGE_PARAM).find(([, v]) => v === (searchParams?.get("stage") ?? "preparation"))?.[0] as NavStage) ?? "PREPARATION");

  return (
    <nav className="flex items-start h-[54px]">
      {NAV_STAGES.map((stage) => {
        const isActive = stage === activeStage;

        const inner = (
          <div
            className={`flex flex-col flex-1 justify-start min-h-0 pb-[18px] ${
              isActive ? "border-b-2 border-[#000000]" : ""
            }`}
          >
            <span
              className={`text-[14px] font-semibold tracking-[0.7px] uppercase leading-5 ${
                isActive ? "text-[#000000]" : "text-[#94a3b8]"
              }`}
            >
              {stage}
            </span>
          </div>
        );

        if (controlledStage !== undefined) {
          return (
            <button
              key={stage}
              type="button"
              onClick={() => onStageChange?.(NAV_TO_STAGE_ID[stage])}
              className="flex flex-col justify-center pt-4 h-full mr-6 bg-transparent border-0 cursor-pointer"
            >
              {inner}
            </button>
          );
        }

        return (
          <Link
            key={stage}
            href={`${basePath}?stage=${STAGE_PARAM[stage]}`}
            className="flex flex-col justify-center pt-4 h-full mr-6"
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
