"use client";
import { ArrowRight, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStepStore } from "@/store/step-store";
import type { StepUIProps } from "../../../_shared/types";

export function TaskBreakdownUI({ onNavigate, isHydrated }: StepUIProps) {
  const envSetupResult = useStepStore((s) => s.steps["env-setup"]);

  // Try to parse the kickoff result as task breakdown JSON
  let tasks: Array<{ title: string; phase: string; estimatedHours: number }> = [];
  try {
    if (envSetupResult?.content) {
      const parsed = JSON.parse(envSetupResult.content);
      tasks = parsed.tasks ?? parsed.workItems ?? [];
    }
  } catch {
    // Content may not be JSON; it could be markdown
  }

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      <div className="shrink-0 px-8 pt-6 pb-4 border-b border-[#f1f5f9]">
        <h2 className="text-xl font-bold text-[#0b1c30]">Task Breakdown</h2>
        <p className="text-[13px] text-[#94a3b8] mt-0.5">Review the AI-generated coding tasks before starting</p>
      </div>

      <div className="flex-1 overflow-auto px-8 py-5">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-[#94a3b8]">
            <ListChecks size={24} className="text-[#cbd5e1]" />
            <p className="text-sm">
              {envSetupResult?.status === "completed"
                ? "Task breakdown loaded. Review and proceed."
                : "Run the kick-off first to generate the task breakdown."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[#f8fafc] border border-[#f1f5f9]">
                <span className="text-[10px] font-bold text-[#94a3b8] mt-0.5 w-5 shrink-0">{i + 1}.</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#334155]">{task.title}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] text-[#94a3b8]">{task.phase}</span>
                    <span className="text-[11px] text-[#94a3b8]">{task.estimatedHours}h estimated</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-8 py-4 border-t border-[#f1f5f9] bg-white flex justify-end">
        <Button size="sm" onClick={() => onNavigate("architect")}>
          <ArrowRight size={14} className="mr-1.5" />
          Confirm & Start Coding
        </Button>
      </div>
    </div>
  );
}
