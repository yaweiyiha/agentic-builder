"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import KickoffSummaryView from "@/components/kickoff/KickoffSummaryView";
import KickoffTasksView from "@/components/kickoff/KickoffTasksView";
import { useKickoffStepData } from "@/components/kickoff/useKickoffStepData";
import type { StepResult } from "@/lib/pipeline/types";

type KickoffSubTab = "summary" | "tasks";

/**
 * Legacy single-page kickoff panel. The view body has been split into
 * `KickoffSummaryView` and `KickoffTasksView`; this wrapper keeps the
 * old API stable for `pipeline/page.tsx` while the new project page
 * routes directly to the views per sub-stage.
 */
export default function KickoffStepPanel({
  result,
  onStartCoding,
  commandBarStartsCoding = false,
}: {
  result: StepResult;
  onStartCoding?: () => void;
  /** When true, hide the in-panel start button; user confirms via the command bar. */
  commandBarStartsCoding?: boolean;
}) {
  const [subTab, setSubTab] = useState<KickoffSubTab>("summary");
  const data = useKickoffStepData(result, { onStartCoding });
  const tasksCount = data.tasks.length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex h-12 gap-1 border-b border-zinc-200">
        <button
          type="button"
          onClick={() => setSubTab("summary")}
          className={`relative px-4 text-[13px] font-medium transition-colors ${
            subTab === "summary"
              ? "text-zinc-900"
              : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          Summary
          {subTab === "summary" && (
            <motion.span
              layoutId="kickoff-tab-underline"
              className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => setSubTab("tasks")}
          className={`relative px-4 text-[13px] font-medium transition-colors ${
            subTab === "tasks"
              ? "text-zinc-900"
              : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          Task breakdown ({tasksCount})
          {subTab === "tasks" && (
            <motion.span
              layoutId="kickoff-tab-underline"
              className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {subTab === "summary" && (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <KickoffSummaryView
              result={result}
              data={data}
              commandBarStartsCoding={commandBarStartsCoding}
            />
          </motion.div>
        )}

        {subTab === "tasks" && (
          <motion.div
            key="tasks"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <KickoffTasksView
              result={result}
              data={data}
              commandBarStartsCoding={commandBarStartsCoding}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
