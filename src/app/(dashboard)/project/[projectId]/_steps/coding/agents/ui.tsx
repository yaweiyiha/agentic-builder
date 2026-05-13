"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowRight, Loader2, Terminal } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import { useCodingStore } from "@/store/coding-store";
import { parseKickoffTaskBreakdownFromMetadata } from "@/lib/pipeline/kickoff-task-breakdown";
import type { StepUIProps } from "../../_shared/types";

export function AgentsUI({ onNavigate }: StepUIProps) {
  const steps = useStepStore((s) => s.steps);
  const codeOutputDir = useStepStore((s) => s.codeOutputDir);
  const setStepResult = useStepStore((s) => s.setStepResult);

  const codingState = useCodingStore();
  const { startCoding } = useCodingStore();

  const prdContent = steps.prd?.content ?? "";
  const summaryMeta = steps.summary?.metadata as Record<string, unknown> | undefined;
  const kickoffTasks = parseKickoffTaskBreakdownFromMetadata(summaryMeta);
  const isIdle = codingState.status === "idle";
  const isRunning = codingState.status === "running";
  const isDone = codingState.status === "completed";
  const isFailed = codingState.status === "failed";

  const autoStartedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Subscribe to coding completion to persist step result
  useEffect(() => {
    if (!isDone && !isFailed) return;
    const content = JSON.stringify({
      agentsCompleted: codingState.agents.filter((a) => a.status === "completed").length,
      totalCostUsd: codingState.totalCostUsd,
      tasksCompleted: codingState.tasks.filter((t) => t.status === "completed").length,
      totalTasks: codingState.tasks.length,
    });
    setStepResult("agents", {
      stepId: "agents",
      status: isDone ? "completed" : "failed",
      content,
      costUsd: codingState.totalCostUsd,
      error: codingState.error ?? undefined,
      metadata: {
        agentCount: codingState.agents.length,
        taskCount: codingState.tasks.length,
        supervisorLogCount: codingState.supervisorLogs.length,
      },
      timestamp: new Date().toISOString(),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone, isFailed]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [codingState.supervisorLogs, codingState.agents]);

  const handleStart = useCallback(() => {
    if (!isIdle) return;
    if (kickoffTasks.length === 0) return;
    const runId = "run-" + Date.now();
    startCoding(runId, kickoffTasks, codeOutputDir, undefined, prdContent);
  }, [isIdle, kickoffTasks, codeOutputDir, prdContent, startCoding]);

  const hasContent = !isIdle;

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
              <Terminal size={20} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Coding Agents</h2>
              <p className="text-sm text-slate-500">AI-powered code generation and orchestration</p>
            </div>
          </div>

          {!hasContent && (
            <div className="flex flex-col items-center gap-4 py-16">
              {kickoffTasks.length === 0 ? (
                <p className="text-slate-500 text-sm">No kickoff tasks found. Complete the preparation steps first.</p>
              ) : (
                <>
                  <p className="text-slate-500 text-sm">
                    {kickoffTasks.length} tasks ready — start the coding run
                  </p>
                  <button
                    onClick={handleStart}
                    className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-500 transition-colors"
                  >
                    Start Coding
                  </button>
                </>
              )}
            </div>
          )}

          {hasContent && (
            <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-800">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                <span className={`w-2.5 h-2.5 rounded-full ${isDone ? "bg-green-500" : "bg-green-500"}`} />
                <span className="text-xs text-slate-400 font-mono ml-2">coding-agents</span>
                <span className="ml-auto flex items-center gap-2">
                  {isRunning && <Loader2 size={12} className="text-emerald-400 animate-spin" />}
                  <span className={`text-[10px] font-mono ${isDone ? "text-emerald-400" : isFailed ? "text-red-400" : "text-slate-500"}`}>
                    {isRunning ? "RUNNING" : isDone ? "COMPLETED" : isFailed ? "FAILED" : "IDLE"}
                  </span>
                </span>
              </div>

              <div className="p-4 font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto space-y-1">
                {codingState.agents.map((agent) => (
                  <div key={agent.id} className="flex items-start gap-2 text-slate-300">
                    <span className="text-indigo-400 shrink-0">[{agent.role}]</span>
                    <span className="text-slate-400 truncate">{agent.name}</span>
                    <span className={`ml-auto shrink-0 text-[10px] ${
                      agent.status === "completed" ? "text-emerald-400" :
                      agent.status === "running" ? "text-amber-400" :
                      agent.status === "failed" ? "text-red-400" : "text-slate-600"
                    }`}>
                      {agent.status}
                    </span>
                  </div>
                ))}
                {codingState.supervisorLogs.map((log, i) => (
                  <div key={i} className={`flex items-start gap-2 ${
                    log.level === "error" ? "text-red-400" :
                    log.level === "warn" ? "text-amber-400" :
                    "text-slate-400"
                  }`}>
                    <span className="shrink-0 text-slate-600">{">"}</span>
                    <span>{log.message}</span>
                  </div>
                ))}
                {isRunning && (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 size={10} className="animate-spin" />
                    <span>Coding in progress...</span>
                  </div>
                )}
                {isFailed && codingState.error && (
                  <div className="text-red-400">Error: {codingState.error}</div>
                )}
                {isDone && (
                  <div className="text-emerald-400">All agents completed successfully.</div>
                )}
                <div ref={bottomRef} />
              </div>

              {codingState.totalCostUsd > 0 && (
                <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 text-[10px] text-slate-500 font-mono">
                  Cost: ${codingState.totalCostUsd.toFixed(4)} | Tasks: {codingState.tasks.filter((t) => t.status === "completed").length}/{codingState.tasks.length}
                </div>
              )}
            </div>
          )}

          {isDone && (
            <div className="flex justify-center mt-6">
              <button
                onClick={() => onNavigate("serve")}
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-500 transition-colors"
              >
                Continue to Preview <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
