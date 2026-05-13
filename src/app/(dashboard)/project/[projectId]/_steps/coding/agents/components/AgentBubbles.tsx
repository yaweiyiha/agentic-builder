"use client";

import type { CodingAgentInstance } from "@/lib/pipeline/types";

const ROLE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  architect: { bg: "bg-amber-100",  text: "text-amber-700",  label: "A" },
  backend:   { bg: "bg-blue-100",   text: "text-blue-700",   label: "B" },
  frontend:  { bg: "bg-violet-100", text: "text-violet-700", label: "F" },
  test:      { bg: "bg-green-100",  text: "text-green-700",  label: "T" },
};

interface AgentBubblesProps {
  agents: CodingAgentInstance[];
}

export function AgentBubbles({ agents }: AgentBubblesProps) {
  if (agents.length === 0) {
    return (
      <div className="flex items-center gap-1">
        {["A", "B", "F"].map((l) => (
          <div
            key={l}
            className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400"
          >
            {l}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {agents.map((agent) => {
        const cfg = ROLE_COLORS[agent.role] ?? { bg: "bg-slate-100", text: "text-slate-600", label: "?" };
        const isWorking = agent.status === "working";
        return (
          <div key={agent.id} className="relative">
            <div
              className={`w-7 h-7 rounded-full ${cfg.bg} ${cfg.text} flex items-center justify-center text-[10px] font-bold transition-all`}
              title={agent.label}
            >
              {cfg.label}
            </div>
            {isWorking && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-violet-500 border-2 border-white" />
            )}
          </div>
        );
      })}
    </div>
  );
}
