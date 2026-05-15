"use client";

import type { AgentLogEntry } from "@/lib/pipeline/types";

export type CodingLogDisplayEntry = AgentLogEntry & { agentLabel?: string };

export function CodingLogLine({ entry }: { entry: CodingLogDisplayEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const isSupervisor = entry.agentLabel === "Supervisor";
  const color = isSupervisor
    ? entry.message.includes("passed") || entry.message.includes("complete") || entry.message.includes("OK")
      ? "text-emerald-600"
      : entry.message.includes("error") || entry.message.includes("FAILED")
        ? "text-red-500"
        : "text-indigo-500"
    : entry.type === "task_error"
      ? "text-red-500"
      : entry.type === "task_fix"
        ? "text-zinc-800"
        : entry.type === "task_verify"
          ? entry.message.includes("FAILED")
            ? "text-red-600"
            : entry.message.includes("passed")
              ? "text-emerald-600"
              : "text-zinc-500"
          : entry.type === "task_complete"
            ? "text-zinc-500"
            : entry.type === "task_progress"
              ? "text-zinc-500"
              : "text-zinc-400";

  return (
    <div className="space-y-1 rounded-md border border-zinc-200 bg-white px-2.5 py-2">
      <p className="font-mono text-[11px]">
        <span className="text-zinc-400">[{time}]</span>{" "}
        {entry.agentLabel && <span className="text-zinc-500">[{entry.agentLabel}] </span>}
        <span className={color}>{entry.message}</span>
      </p>
      {entry.details && (
        <pre className="whitespace-pre-wrap break-words rounded bg-zinc-900 px-2 py-1.5 font-mono text-[10px] leading-5 text-zinc-200">
          {entry.details}
        </pre>
      )}
    </div>
  );
}
