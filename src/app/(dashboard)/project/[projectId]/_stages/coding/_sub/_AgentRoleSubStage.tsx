"use client";

/**
 * Shared layout for agent-role sub-stage pages (architect, backend, frontend, test).
 * Displays real-time agent logs and task status for the given role.
 */

import { useCodingStore } from "@/store/coding-store";
import { useStageStore } from "@/store/stage-store";
import type { CodingAgentRole } from "@/lib/pipeline/types";
import type { CodingSubStageId } from "@/store/stage-store";

interface Props {
  role: CodingAgentRole;
  title: string;
  description: string;
  nextSubStage?: CodingSubStageId;
}

const STATUS_COLOR: Record<string, { dot: string; label: string; badge: string }> = {
  idle:      { dot: "bg-[#e2e8f0]",   label: "Idle",    badge: "text-[#94a3b8] bg-[#f8fafc] border-[#e2e8f0]" },
  working:   { dot: "bg-[#712ae2] animate-pulse", label: "Running", badge: "text-[#712ae2] bg-[rgba(113,42,226,0.06)] border-[rgba(113,42,226,0.2)]" },
  completed: { dot: "bg-[#22c55e]",   label: "Done",    badge: "text-[#16a34a] bg-[#f0fdf4] border-[#bbf7d0]" },
  failed:    { dot: "bg-[#ef4444]",   label: "Failed",  badge: "text-[#dc2626] bg-[#fef2f2] border-[#fecaca]" },
};

export default function AgentRoleSubStage({ role, title, description, nextSubStage }: Props) {
  const agents       = useCodingStore((s) => s.agents);
  const tasks        = useCodingStore((s) => s.tasks);
  const goToSubStage = useStageStore((s) => s.goToSubStage);

  const agent    = agents.find((a) => a.role === role);
  const roleTasks = tasks.filter((t) => {
    // KickoffWorkItem doesn't have role directly; match via assignedAgentId
    return agent ? t.assignedAgentId === agent.id || agent.completedTaskIds.includes(t.id) || agent.failedTaskIds.includes(t.id) : false;
  });

  const agentStatus = agent?.status ?? "idle";
  const colors      = STATUS_COLOR[agentStatus] ?? STATUS_COLOR.idle;

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-[#0b1c30]">{title}</h2>
            <p className="text-[13px] text-[#94a3b8] mt-0.5">{description}</p>
          </div>
          <span className={`flex items-center gap-1.5 text-[12px] font-medium border px-3 py-1 rounded-full shrink-0 ${colors.badge}`}>
            <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
            {colors.label}
          </span>
        </div>

        {/* Agent stats */}
        {agent && (
          <div className="flex items-center gap-5 mt-3">
            <span className="text-[11px] text-[#94a3b8]">
              Completed: <span className="text-[#64748b] font-medium">{agent.completedTaskIds.length}</span>
            </span>
            <span className="text-[11px] text-[#94a3b8]">
              Failed: <span className="text-[#64748b] font-medium">{agent.failedTaskIds.length}</span>
            </span>
            {agent.totalCostUsd > 0 && (
              <span className="text-[11px] text-[#94a3b8]">
                Cost: <span className="text-[#64748b] font-medium">${agent.totalCostUsd.toFixed(4)}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body: agent logs */}
      <div className="flex-1 overflow-auto px-8 py-5">
        {!agent && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
              </svg>
            </div>
            <p className="text-[14px] text-[#94a3b8] max-w-xs">
              The {title.toLowerCase()} agent will start automatically when coding begins.
            </p>
          </div>
        )}

        {agent && agent.logs.length === 0 && (
          <p className="text-[13px] text-[#94a3b8]">No logs yet…</p>
        )}

        {agent && agent.logs.length > 0 && (
          <div className="flex flex-col gap-1.5 font-mono text-[12px]">
            {agent.logs.map((log, i) => (
              <div
                key={i}
                className={`flex gap-3 ${
                  log.type === "task_error" ? "text-[#ef4444]"
                  : log.type === "task_complete" ? "text-[#22c55e]"
                  : "text-[#64748b]"
                }`}
              >
                <span className="shrink-0 text-[#94a3b8]">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className="break-all">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer CTA */}
      {agent?.status === "completed" && nextSubStage && (
        <div className="shrink-0 flex justify-end px-8 py-4 border-t border-[#f1f5f9]">
          <button
            onClick={() => goToSubStage(nextSubStage, "coding")}
            className="flex items-center gap-2 px-5 py-2 text-[13px] font-semibold text-[#712ae2] border border-[rgba(113,42,226,0.3)] rounded-md hover:bg-[rgba(113,42,226,0.05)] transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
