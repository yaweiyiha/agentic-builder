"use client";

import { useCodingStore } from "@/store/coding-store";
import { useStageStore } from "@/store/stage-store";

export default function VerifySubStage() {
  const integrationVerify = useCodingStore((s) => s.integrationVerify);
  const supervisorLogs    = useCodingStore((s) => s.supervisorLogs);
  const advanceStage      = useStageStore((s) => s.advanceStage);

  const status = integrationVerify?.status;

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-[#0b1c30]">Integration Verify</h2>
            <p className="text-[13px] text-[#94a3b8] mt-0.5">
              Runs the full build, lints and integration tests to catch errors before preview.
            </p>
          </div>
          <VerifyBadge status={status} />
        </div>

        {integrationVerify && (
          <div className="flex items-center gap-5 mt-3">
            <span className="text-[11px] text-[#94a3b8]">
              Fix attempts: <span className="text-[#64748b] font-medium">{integrationVerify.fixAttempts}/{integrationVerify.maxFixAttempts}</span>
            </span>
            {integrationVerify.errorCount != null && (
              <span className="text-[11px] text-[#94a3b8]">
                Errors: <span className="text-[#64748b] font-medium">{integrationVerify.errorCount}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-8 py-5">
        {!integrationVerify && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
              </svg>
            </div>
            <p className="text-[14px] text-[#94a3b8] max-w-xs">
              Integration verification starts after all agent tasks are complete.
            </p>
          </div>
        )}

        {integrationVerify?.errors && (
          <div className="mb-5 rounded-lg border border-[#fecaca] bg-[#fef2f2] p-4 text-[12px] text-[#dc2626] font-mono leading-5 whitespace-pre-wrap overflow-auto max-h-48">
            {integrationVerify.errors}
          </div>
        )}

        {supervisorLogs.length > 0 && (
          <div className="flex flex-col gap-1.5 font-mono text-[12px]">
            {supervisorLogs.map((log, i) => (
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

      {/* Footer: advance to preview when passed */}
      {status === "passed" && (
        <div className="shrink-0 flex justify-end px-8 py-4 border-t border-[#f1f5f9]">
          <button
            onClick={advanceStage}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#712ae2] text-white text-[13px] font-bold rounded-md hover:bg-[#5b22b8] transition-colors"
          >
            Go to Preview →
          </button>
        </div>
      )}
    </div>
  );
}

function VerifyBadge({ status }: { status?: string }) {
  if (!status || status === undefined) return (
    <span className="text-[12px] font-medium text-[#94a3b8] bg-[#f8fafc] border border-[#e2e8f0] px-3 py-1 rounded-full shrink-0">Waiting</span>
  );
  if (status === "verifying") return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#712ae2] bg-[rgba(113,42,226,0.06)] border border-[rgba(113,42,226,0.2)] px-3 py-1 rounded-full shrink-0">
      <span className="w-2 h-2 rounded-full bg-[#712ae2] animate-pulse" /> Verifying
    </span>
  );
  if (status === "fixing") return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#f59e0b] bg-[#fffbeb] border border-[#fde68a] px-3 py-1 rounded-full shrink-0">
      <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" /> Fixing
    </span>
  );
  if (status === "passed") return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#16a34a] bg-[#f0fdf4] border border-[#bbf7d0] px-3 py-1 rounded-full shrink-0">
      ✓ Passed
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] px-3 py-1 rounded-full shrink-0">
      ✗ Failed
    </span>
  );
}
