"use client";

import { useRef, useEffect, useState } from "react";
import { X, ExternalLink, RefreshCw, Terminal } from "lucide-react";
import type { CodingTask, KickoffWorkItem, AgentLogEntry } from "@/lib/pipeline/types";

interface TaskDetailPanelProps {
  task: CodingTask | KickoffWorkItem | null;
  allAgentLogs: AgentLogEntry[];
  supervisorLogs: AgentLogEntry[];
  onClose: () => void;
  onRetry?: (taskId: string) => void;
}

type LogTab = "raw" | "filtered";

const LOG_TYPE_CONFIG: Record<
  string,
  { prefix: string; prefixColor: string; textColor: string }
> = {
  info:          { prefix: "[info]",  prefixColor: "text-emerald-400", textColor: "text-slate-300" },
  task_start:    { prefix: "[proc]",  prefixColor: "text-slate-400",   textColor: "text-slate-200" },
  task_progress: { prefix: "[proc]",  prefixColor: "text-slate-400",   textColor: "text-slate-200" },
  task_complete: { prefix: "[proc]",  prefixColor: "text-slate-400",   textColor: "text-slate-200" },
  task_verify:   { prefix: "[verify]",prefixColor: "text-sky-400",     textColor: "text-slate-300" },
  task_fix:      { prefix: "[fix]",   prefixColor: "text-amber-400",   textColor: "text-slate-300" },
  task_error:    { prefix: "[error]", prefixColor: "text-red-400",     textColor: "text-red-300" },
};

function getStatusLabel(task: CodingTask | KickoffWorkItem): string {
  if (!("codingStatus" in task)) return "Pending";
  const map: Record<string, string> = {
    pending: "Pending",
    queued: "Queued",
    in_progress: "In Progress",
    completed: "Completed",
    completed_with_warnings: "Done (with warnings)",
    failed: "Failed",
  };
  return map[(task as CodingTask).codingStatus] ?? "Unknown";
}

function getStatusDot(task: CodingTask | KickoffWorkItem): string {
  if (!("codingStatus" in task)) return "bg-slate-300";
  const map: Record<string, string> = {
    pending:   "bg-slate-300",
    queued:    "bg-yellow-400",
    in_progress: "bg-violet-500 animate-pulse",
    completed: "bg-green-500",
    completed_with_warnings: "bg-amber-400",
    failed:    "bg-red-500",
  };
  return map[(task as CodingTask).codingStatus] ?? "bg-slate-300";
}

function getDuration(task: CodingTask | KickoffWorkItem): string | null {
  if (!("codingStatus" in task)) return null;
  const t = task as CodingTask;
  if (t.startedAt && t.completedAt) {
    const ms = new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime();
    return `${(ms / 1000).toFixed(3)}s`;
  }
  if (t.startedAt && (t.codingStatus === "in_progress" || t.codingStatus === "failed")) {
    const ms = Date.now() - new Date(t.startedAt).getTime();
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return null;
}

export function TaskDetailPanel({
  task,
  allAgentLogs,
  supervisorLogs,
  onClose,
  onRetry,
}: TaskDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<LogTab>("raw");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Filter logs for this task
  const taskLogs = task
    ? allAgentLogs.filter((l) => l.taskId === task.id)
    : [];

  const filteredLogs = taskLogs.filter(
    (l) => l.type === "task_complete" || l.type === "task_error" || l.type === "task_fix" || l.type === "task_verify",
  );

  const displayedLogs = activeTab === "raw" ? taskLogs : filteredLogs;

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [displayedLogs.length, autoScroll]);

  if (!task) return null;

  const statusLabel = getStatusLabel(task);
  const statusDot = getStatusDot(task);
  const duration = getDuration(task);
  const isFailed = "codingStatus" in task && (task as CodingTask).codingStatus === "failed";
  const verifyErrors = "verifyErrors" in task ? (task as CodingTask).verifyErrors : undefined;
  const generatedFiles = "generatedFiles" in task ? (task as CodingTask).generatedFiles : undefined;

  return (
    <div className="flex flex-col h-full w-full bg-white border-l border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-start justify-between px-5 pt-5 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 shrink-0 w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center">
            <span className="text-violet-600 text-sm font-bold">{"{}"}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
              CURRENTLY SELECTING
            </p>
            <h3 className="text-[15px] font-bold text-slate-900 leading-tight">
              {task.title}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <div className="shrink-0 px-5 py-3 border-b border-slate-100">
          <p className="text-[12px] text-slate-500 leading-relaxed">
            {task.description}
          </p>
        </div>
      )}

      {/* Status + Duration */}
      <div className="shrink-0 grid grid-cols-2 gap-3 px-5 py-4 border-b border-slate-100">
        <div className="bg-slate-50 rounded-lg px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            STATUS
          </p>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
            <span className="text-[12px] font-semibold text-slate-700">
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            DURATION
          </p>
          <span className="text-[12px] font-semibold text-slate-700">
            {duration ?? "—"}
          </span>
        </div>
      </div>

      {/* Files generated */}
      {generatedFiles && generatedFiles.length > 0 && (
        <div className="shrink-0 px-5 py-3 border-b border-slate-100">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            GENERATED FILES ({generatedFiles.length})
          </p>
          <div className="space-y-0.5 max-h-20 overflow-y-auto">
            {generatedFiles.map((f) => (
              <p key={f} className="text-[11px] font-mono text-slate-500 truncate">
                {f}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Verify errors */}
      {isFailed && verifyErrors && (
        <div className="shrink-0 px-5 py-3 border-b border-slate-100">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-red-400 mb-2">
            ERRORS
          </p>
          <pre className="text-[10px] text-red-600 whitespace-pre-wrap max-h-24 overflow-y-auto font-mono bg-red-50 rounded p-2">
            {verifyErrors.slice(0, 400)}
          </pre>
        </div>
      )}

      {/* Logs section */}
      <div className="flex flex-col flex-1 overflow-hidden px-5 pt-3">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            REAL-TIME LOGS
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab("raw")}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-colors ${
                activeTab === "raw"
                  ? "text-slate-800 border-b-2 border-violet-500"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              RAW
            </button>
            <button
              onClick={() => setActiveTab("filtered")}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-colors ${
                activeTab === "filtered"
                  ? "text-slate-800 border-b-2 border-violet-500"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              FILTERED
            </button>
          </div>
        </div>

        {/* Log terminal */}
        <div
          className="flex-1 bg-[#0d1117] rounded-lg overflow-y-auto p-3 font-mono text-[11px] leading-5"
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
            setAutoScroll(atBottom);
          }}
        >
          {displayedLogs.length === 0 ? (
            <span className="text-slate-600 italic">
              {task && "codingStatus" in task && (task as CodingTask).codingStatus === "pending"
                ? "Waiting to start..."
                : "No logs yet..."}
            </span>
          ) : (
            displayedLogs.map((log, i) => {
              const cfg =
                LOG_TYPE_CONFIG[log.type] ?? LOG_TYPE_CONFIG.info;
              const isDone =
                log.type === "task_complete" && log.message.toLowerCase().includes("done");
              return (
                <div key={i} className="flex gap-2 items-start">
                  <span className="shrink-0 text-slate-600 w-5 text-right">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={`shrink-0 w-13 ${cfg.prefixColor}`}>
                    {cfg.prefix}
                  </span>
                  <span className={`${cfg.textColor} flex-1`}>
                    {log.message}
                    {isDone && (
                      <span className="text-emerald-400 font-bold ml-1">
                        DONE
                      </span>
                    )}
                  </span>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Auto-scroll indicator */}
        <div className="flex items-center justify-between py-1.5 shrink-0">
          <span className="text-[9px] text-slate-400">
            AUTO-SCROLL {autoScroll ? "ENABLED" : "PAUSED"}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-emerald-500 font-semibold">
              ● LIVESTREAM
            </span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="shrink-0 flex gap-2 px-5 pb-4 pt-2">
        <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-[12px] font-semibold rounded-lg hover:bg-slate-800 transition-colors">
          <Terminal size={13} />
          Open Terminal
        </button>
        {isFailed && onRetry && (
          <button
            onClick={() => onRetry(task.id)}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
            title="Retry task"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
