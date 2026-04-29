"use client";

/**
 * Shared layout for agent-role sub-stage pages (architect, backend, frontend, test).
 * Displays real-time agent logs and task status for the given role.
 */

import { Clock, CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { useCodingStore } from "@/store/coding-store";
import { useStageStore } from "@/store/stage-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CodingAgentRole } from "@/lib/pipeline/types";
import type { CodingSubStageId } from "@/store/stage-store";

interface Props {
  role: CodingAgentRole;
  title: string;
  description: string;
  nextSubStage?: CodingSubStageId;
}

function statusBadge(status: string) {
  switch (status) {
    case "working":
      return <Badge variant="warning" className="gap-1.5"><Loader2 size={11} className="animate-spin" />Running</Badge>;
    case "completed":
      return <Badge variant="success" className="gap-1.5"><CheckCircle2 size={11} />Done</Badge>;
    case "failed":
      return <Badge variant="destructive" className="gap-1.5"><AlertCircle size={11} />Failed</Badge>;
    default:
      return <Badge variant="muted" className="gap-1.5"><Clock size={11} />Idle</Badge>;
  }
}

export default function AgentRoleSubStage({ role, title, description, nextSubStage }: Props) {
  const agents       = useCodingStore((s) => s.agents);
  const tasks        = useCodingStore((s) => s.tasks);
  const goToSubStage = useStageStore((s) => s.goToSubStage);

  const agent     = agents.find((a) => a.role === role);
  const agentStatus = agent?.status ?? "idle";

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#0b1c30]">{title}</h2>
            <p className="text-[13px] text-[#94a3b8] mt-0.5">{description}</p>
          </div>
          {statusBadge(agentStatus)}
        </div>

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
      <ScrollArea className="flex-1 px-8 py-5">
        {!agent && (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center">
              <Clock size={16} className="text-[#cbd5e1]" />
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
      </ScrollArea>

      {/* Footer CTA */}
      {agent?.status === "completed" && nextSubStage && (
        <div className="shrink-0 flex justify-end px-8 py-4 border-t border-[#f1f5f9]">
          <Button
            variant="outline"
            onClick={() => goToSubStage(nextSubStage, "coding")}
            className="gap-2 text-[#712ae2] border-[rgba(113,42,226,0.3)] hover:bg-[rgba(113,42,226,0.05)]"
          >
            Next <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
