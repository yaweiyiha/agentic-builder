"use client";

import { useCodingStore } from "@/store/coding-store";
import { useStageStore } from "@/store/stage-store";

export default function E2eSubStage() {
  const e2eVerify    = useCodingStore((s) => s.e2eVerify);
  const goToSubStage = useStageStore((s) => s.goToSubStage);
  const supervisorLogs = useCodingStore((s) => s.supervisorLogs);

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[20px] font-bold text-[#0b1c30]">E2E Smoke Test</h2>
            <p className="text-[13px] text-[#94a3b8] mt-0.5">
              End-to-end tests run against the live preview server to validate the full flow.
            </p>
          </div>
          <E2eBadge status={e2eVerify?.status} />
        </div>

        {e2eVerify && (
          <div className="flex items-center gap-5 mt-3">
            <span className="text-[11px] text-[#94a3b8]">
              Fix attempts: <span className="text-[#64748b] font-medium">{e2eVerify.fixAttempts}/{e2eVerify.maxFixAttempts}</span>
            </span>
            {e2eVerify.errorCount != null && (
              <span className="text-[11px] text-[#94a3b8]">
                Errors: <span className="text-[#64748b] font-medium">{e2eVerify.errorCount}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-8 py-5">
        {!e2eVerify && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
              </svg>
            </div>
            <p className="text-[14px] text-[#94a3b8] max-w-xs">
              E2E tests haven't run yet. Start the dev server and trigger the test run.
            </p>
            <button
              onClick={() => goToSubStage("serve", "preview")}
              className="text-[13px] font-semibold text-[#712ae2] hover:underline"
            >
              ← Back to Dev Server
            </button>
          </div>
        )}

        {e2eVerify?.errors && (
          <div className="mb-5 rounded-lg border border-[#fecaca] bg-[#fef2f2] p-4 text-[12px] text-[#dc2626] font-mono leading-5 whitespace-pre-wrap overflow-auto max-h-48">
            {e2eVerify.errors}
          </div>
        )}

        {supervisorLogs.filter((l) => l.type === "task_verify" || l.type === "task_fix").length > 0 && (
          <div className="flex flex-col gap-1.5 font-mono text-[12px]">
            {supervisorLogs
              .filter((l) => l.type === "task_verify" || l.type === "task_fix")
              .map((log, i) => (
                <div key={i} className="flex gap-3 text-[#64748b]">
                  <span className="shrink-0 text-[#94a3b8]">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function E2eBadge({ status }: { status?: string }) {
  if (!status) return (
    <span className="text-[12px] font-medium text-[#94a3b8] bg-[#f8fafc] border border-[#e2e8f0] px-3 py-1 rounded-full shrink-0">Not started</span>
  );
  if (status === "verifying") return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#712ae2] bg-[rgba(113,42,226,0.06)] border border-[rgba(113,42,226,0.2)] px-3 py-1 rounded-full shrink-0">
      <span className="w-2 h-2 rounded-full bg-[#712ae2] animate-pulse" /> Running
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
