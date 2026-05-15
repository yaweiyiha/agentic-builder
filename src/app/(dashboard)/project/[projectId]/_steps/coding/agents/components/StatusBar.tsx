"use client";

import { Pause, StopCircle } from "lucide-react";

interface StatusBarProps {
  isRunning: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  onPause?: () => void;
  onAbort?: () => void;
}

export function StatusBar({
  isRunning,
  isCompleted,
  isFailed,
  onPause,
  onAbort,
}: StatusBarProps) {
  const systemStatus = isFailed
    ? "ERROR"
    : isCompleted
      ? "COMPLETE"
      : isRunning
        ? "STABLE"
        : "IDLE";

  const dotColor = isFailed
    ? "bg-red-500"
    : isCompleted
      ? "bg-green-500"
      : isRunning
        ? "bg-green-500 animate-pulse"
        : "bg-slate-300";

  return (
    <div className="shrink-0 flex items-center justify-between px-6 py-2.5 bg-white border-t border-slate-200">
      {/* System status */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="text-[11px] font-semibold text-slate-600 tracking-wide">
          SYSTEM STATUS:{" "}
          <span
            className={
              isFailed
                ? "text-red-600"
                : isCompleted
                  ? "text-green-600"
                  : isRunning
                    ? "text-green-600"
                    : "text-slate-500"
            }
          >
            {systemStatus}
          </span>
        </span>
      </div>

      {/* Actions */}
      {isRunning && (
        <div className="flex items-center gap-2">
          {onPause && (
            <button
              onClick={onPause}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
            >
              <Pause size={12} />
              Pause Build
            </button>
          )}
          {onAbort && (
            <button
              onClick={onAbort}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
            >
              <StopCircle size={12} />
              Abort Process
            </button>
          )}
        </div>
      )}
    </div>
  );
}
