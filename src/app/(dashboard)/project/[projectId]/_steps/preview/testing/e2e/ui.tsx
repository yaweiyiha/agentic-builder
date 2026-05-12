"use client";

import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCodingStore } from "@/store/coding-store";
import type { StepUIProps } from "../../../_shared/types";

function E2eBadge({ status }: { status?: string }) {
  if (!status) return <Badge variant="muted">Not started</Badge>;
  if (status === "verifying") return <Badge variant="warning">Running</Badge>;
  if (status === "fixing") return <Badge variant="warning" className="bg-amber-50 text-amber-600 border-amber-200">Fixing</Badge>;
  if (status === "passed") return <Badge variant="success">Passed</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}

export function E2eUI(props: StepUIProps) {
  const e2eVerify = useCodingStore((s) => s.e2eVerify);
  const supervisorLogs = useCodingStore((s) => s.supervisorLogs);

  return (
    <div className="flex flex-1 flex-col h-full overflow-hidden">
      <div className="shrink-0 px-8 pt-8 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#0b1c30]">E2E Smoke Test</h2>
            <p className="text-[13px] text-[#94a3b8] mt-0.5">End-to-end tests run against the live preview server to validate the full flow.</p>
          </div>
          <E2eBadge status={e2eVerify?.status} />
        </div>
        {e2eVerify && (
          <div className="flex items-center gap-5 mt-3">
            <span className="text-[11px] text-[#94a3b8]">Fix attempts: <span className="text-[#64748b] font-medium">{e2eVerify.fixAttempts}/{e2eVerify.maxFixAttempts}</span></span>
            {e2eVerify.errorCount != null && <span className="text-[11px] text-[#94a3b8]">Errors: <span className="text-[#64748b] font-medium">{e2eVerify.errorCount}</span></span>}
          </div>
        )}
      </div>
      <ScrollArea className="flex-1 px-8 py-5">
        {!e2eVerify && (
          <div className="flex flex-col items-center justify-center h-40 gap-4 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-[#e2e8f0] flex items-center justify-center"><Clock size={16} className="text-[#cbd5e1]" /></div>
            <p className="text-[14px] text-[#94a3b8] max-w-xs">E2E tests haven't run yet. Start the dev server and trigger the test run.</p>
            <Button variant="ghost" size="sm" onClick={() => props.onNavigate("serve")} className="text-[#712ae2]">← Back to Dev Server</Button>
          </div>
        )}
        {e2eVerify?.errors && (
          <div className="mb-5 rounded-lg border border-[#fecaca] bg-[#fef2f2] p-4 text-[12px] text-[#dc2626] font-mono leading-5 whitespace-pre-wrap overflow-auto max-h-48">{e2eVerify.errors}</div>
        )}
        {supervisorLogs.filter((l) => l.type === "task_verify" || l.type === "task_fix").length > 0 && (
          <div className="flex flex-col gap-1.5 font-mono text-[12px]">
            {supervisorLogs.filter((l) => l.type === "task_verify" || l.type === "task_fix").map((log, i) => (
              <div key={i} className="flex gap-3 text-[#64748b]">
                <span className="shrink-0 text-[#94a3b8]">{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className="break-all">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
