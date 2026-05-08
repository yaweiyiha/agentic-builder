"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const NAV_STAGES = ["PREPARATION", "KICK-OFF", "CODING", "PREVIEW"] as const;
export type NavStage = (typeof NAV_STAGES)[number];

/** Maps stage → URL search-param value */
const STAGE_PARAM: Record<NavStage, string> = {
  PREPARATION: "preparation",
  "KICK-OFF": "kick-off",
  CODING: "coding",
  PREVIEW: "preview",
};

interface PipelineNavProps {
  /**
   * Base path for stage navigation.
   * Defaults to "/dashboard/pipeline".
   */
  basePath?: string;
}

export default function PipelineNav({ basePath = "/dashboard/pipeline" }: PipelineNavProps) {
  const searchParams = useSearchParams();
  const currentParam = searchParams?.get("stage") ?? "preparation";

  const activeStage: NavStage =
    (Object.entries(STAGE_PARAM).find(([, v]) => v === currentParam)?.[0] as NavStage) ??
    "PREPARATION";

  return (
    <nav className="flex items-start h-[54px]">
      {NAV_STAGES.map((stage) => {
        const isActive = stage === activeStage;
        const href = `${basePath}?stage=${STAGE_PARAM[stage]}`;

        return (
          <Link
            key={stage}
            href={href}
            className="flex flex-col justify-center pt-4 h-full mr-6"
          >
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
          </Link>
        );
      })}
    </nav>
  );
}
