"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Clock, Code2, Eye } from "lucide-react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "P0" | "P1" | "P2";
type Phase = "DATA" | "INTEGRATION" | "BACKEND" | "INFRA";
type TaskType = "Autonomous" | "Manual Review";

interface Task {
  id: string;
  title: string;
  description: string;
  phase: Phase;
  aiEstimate: string;
  humanEstimate: string;
  priority: Priority;
  type: TaskType;
}

// ─── Static data ─────────────────────────────────────────────────────────────

const STATS = [
  { label: "TOTAL TASKS", value: "142", unit: "" },
  { label: "ESTIMATE", value: "3.5", unit: "mo" },
  { label: "TOKENS USED", value: "1.2", unit: "M" },
  { label: "AI TOTAL ESTIMATE", value: "42", unit: "h", highlight: true },
  { label: "HUMAN TOTAL\nESTIMATE", value: "156", unit: "h" },
  { label: "EFFICIENCY RATIO", value: "84%", unit: "↑", green: true },
  { label: "ESTIMATED COST", value: "$1,200", unit: "" },
];

const TASKS: Task[] = [
  { id: "#01-22", title: "Define Schema Mapping", description: "Map dynamic JSON inputs to Postgres structured storage", phase: "DATA", aiEstimate: "2.5h", humanEstimate: "12.5h", priority: "P0", type: "Autonomous" },
  { id: "#02-14", title: "API Gateway Auth Bridge", description: "Connect Auth0 hooks with internal orchestration layer", phase: "INTEGRATION", aiEstimate: "4.0h", humanEstimate: "18h", priority: "P0", type: "Manual Review" },
  { id: "#03-01", title: "Configure Redis Caching Layer", description: "Implement TTL-based caching for frequent API lookups", phase: "BACKEND", aiEstimate: "1.2h", humanEstimate: "6h", priority: "P1", type: "Autonomous" },
  { id: "#03-02", title: "Implement OAuth2 Middleware", description: "Secure internal endpoints with standardized JWT validation", phase: "BACKEND", aiEstimate: "3.5h", humanEstimate: "14h", priority: "P1", type: "Manual Review" },
  { id: "#04-01", title: "Setup CI/CD Pipeline YAML", description: "Automated testing and deployment to staging environment", phase: "INFRA", aiEstimate: "1.5h", humanEstimate: "8h", priority: "P2", type: "Autonomous" },
  { id: "#01-23", title: "Design User Profile Schema", description: "Define relational model for complex user attributes", phase: "DATA", aiEstimate: "2.0h", humanEstimate: "10h", priority: "P1", type: "Manual Review" },
  { id: "#03-03", title: "Develop Notification Service", description: "Async event processor for email and push alerts", phase: "BACKEND", aiEstimate: "5.5h", humanEstimate: "22h", priority: "P1", type: "Autonomous" },
  { id: "#01-24", title: "Optimize Database Queries", description: "Index analysis and query refactoring for search module", phase: "DATA", aiEstimate: "3.0h", humanEstimate: "12h", priority: "P2", type: "Autonomous" },
];

const PHASE_STYLES: Record<Phase, { bg: string; dot: string; text: string }> = {
  DATA:        { bg: "bg-[#eff6ff]", dot: "bg-[#3b82f6]", text: "text-[#1d4ed8]" },
  INTEGRATION: { bg: "bg-[#faf5ff]", dot: "bg-[#a855f7]", text: "text-[#7e22ce]" },
  BACKEND:     { bg: "bg-[#fff7ed]", dot: "bg-[#f97316]", text: "text-[#c2410c]" },
  INFRA:       { bg: "bg-[#ecfdf5]", dot: "bg-[#10b981]", text: "text-[#047857]" },
};

const PRIORITY_STYLES: Record<Priority, string> = {
  P0: "text-[#ba1a1a]",
  P1: "text-[#475569]",
  P2: "text-[#475569]",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EnvSetupSubStage() {
  const isRunning   = usePipelineStore((s) => s.isRunning);
  const currentStep = usePipelineStore((s) => s.currentStep);
  const steps       = usePipelineStore((s) => s.steps);
  const goToSubStage = useStageStore((s) => s.goToSubStage);

  const step          = steps.kickoff;
  const isThisRunning = isRunning && currentStep === "kickoff";

  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  return (
    <div className="flex flex-1 flex-col h-full overflow-auto bg-white">
      <div className="flex flex-col gap-6 px-5 py-6 w-full">

        {/* ── Page Header ── */}
        <div className="flex items-center justify-between pb-4">
          <h1 className="text-2xl font-semibold text-[#0b1c30] tracking-tight">
            Sprint Kick-off Summary
          </h1>
          <div className="flex items-center gap-3">
            <StatusBadge running={isThisRunning} status={step?.status} />
            <Button variant="outline" size="sm">
              Export Report
            </Button>
          </div>
        </div>
        <Separator />

        {/* ── Project Stats ── */}
        <div className="bg-white border border-[#e2e8f0] rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] p-[25px] flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[24px] font-semibold text-[#0b1c30]">Project Stats</h2>
            <Badge variant="warning" className="rounded text-[11px] font-bold tracking-wide">
              Live Data
            </Badge>
          </div>
          <div className="grid grid-cols-7 gap-4">
            {STATS.map((stat, i) => (
              <div key={i} className="bg-[#eff4ff] border border-[#f1f5f9] rounded-[4px] px-[17px] pt-[17px] pb-[17px] flex flex-col gap-1">
                <p className="text-[#64748b] text-[10px] font-normal uppercase leading-[15px] whitespace-pre-line" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {stat.label}
                </p>
                <div className="flex items-baseline gap-1">
                  <span className={`text-[16px] leading-[24px] ${stat.highlight ? "text-[#4f46e5]" : stat.green ? "text-[#059669]" : "text-[#0b1c30]"}`}>
                    {stat.value}
                  </span>
                  {stat.unit && (
                    <span className={`text-[14px] leading-[21px] ${stat.green ? "text-[#059669]" : "text-[#94a3b8]"}`}>
                      {stat.unit}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Project Tasks ── */}
        <div className="bg-white border border-[#e2e8f0] rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] overflow-hidden">
          {/* Table header */}
          <div className="flex items-center justify-between px-6 py-4 bg-[rgba(248,250,252,0.5)] border-b border-[#f1f5f9]">
            <h2 className="text-[24px] font-semibold text-[#0b1c30]">Project Tasks</h2>
            <div className="flex items-center gap-2">
              <button className="text-[#64748b] hover:text-[#334155] transition-colors p-1">
                <IconFilter />
              </button>
              <button className="text-[#64748b] hover:text-[#334155] transition-colors p-1">
                <IconSettings />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-[rgba(248,250,252,0.3)]">
                  <th className="w-12 pl-6 pr-2 py-[17px] border-b border-[#f1f5f9] text-left">
                    <input type="checkbox" className="w-4 h-4 border border-[#cbd5e1] rounded-[2px]" />
                  </th>
                  <th className="px-4 py-[17px] border-b border-[#f1f5f9] text-left">
                    <span className="text-[10px] font-bold text-[#64748b]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ID</span>
                  </th>
                  <th className="px-6 py-[17px] border-b border-[#f1f5f9] text-left w-[280px]">
                    <span className="text-[10px] font-bold text-[#64748b]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>TASK DESCRIPTION</span>
                  </th>
                  <th className="px-6 py-[17px] border-b border-[#f1f5f9] text-left">
                    <span className="text-[10px] font-bold text-[#64748b]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>PHASE</span>
                  </th>
                  <th className="px-6 py-[12px] border-b border-[#f1f5f9] text-left">
                    <span className="text-[10px] font-bold text-[#64748b] leading-[13px] block" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>AI<br />ESTIMATE</span>
                  </th>
                  <th className="px-6 py-[12px] border-b border-[#f1f5f9] text-left">
                    <span className="text-[10px] font-bold text-[#64748b] leading-[13px] block" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>HUMAN<br />ESTIMATE</span>
                  </th>
                  <th className="px-6 py-[17px] border-b border-[#f1f5f9] text-left">
                    <span className="text-[10px] font-bold text-[#64748b]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>PRIORITY</span>
                  </th>
                  <th className="px-6 py-[17px] border-b border-[#f1f5f9] text-left">
                    <span className="text-[10px] font-bold text-[#64748b]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>TYPE</span>
                  </th>
                  <th className="px-6 py-[17px] border-b border-[#f1f5f9] text-right">
                    <span className="text-[10px] font-bold text-[#64748b]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ACTION</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {TASKS.map((task, i) => {
                  const phaseStyle = PHASE_STYLES[task.phase];
                  return (
                    <tr key={i} className="border-t border-[#f8fafc] hover:bg-[#fafbfd] transition-colors">
                      <td className="pl-6 pr-2 py-[25px]">
                        <input type="checkbox" className="w-4 h-4 border border-[#cbd5e1] rounded-[2px]" />
                      </td>
                      <td className="px-4 py-[17px]">
                        <span className="text-[12px] text-[#94a3b8] whitespace-pre-line" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                          {task.id.replace("-", "-\n")}
                        </span>
                      </td>
                      <td className="px-6 py-[16px] w-[280px]">
                        <p className="text-[16px] font-semibold text-[#0f172a] leading-normal">{task.title}</p>
                        <p className="text-[11px] text-[#94a3b8] truncate max-w-[240px]">{task.description}</p>
                      </td>
                      <td className="px-6 py-[23px]">
                        <span className={`inline-flex items-center gap-1.5 ${phaseStyle.bg} px-2 py-1 rounded-full`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${phaseStyle.dot}`} />
                          <span className={`text-[9px] font-normal ${phaseStyle.text}`} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{task.phase}</span>
                        </span>
                      </td>
                      <td className="px-6 py-[23px]">
                        <span className="text-[16px] font-medium text-[#4f46e5]">{task.aiEstimate}</span>
                      </td>
                      <td className="px-6 py-[23px]">
                        <span className="text-[16px] text-[#475569]">{task.humanEstimate}</span>
                      </td>
                      <td className="px-6 py-[26px]">
                        <span className={`text-[11px] font-bold ${PRIORITY_STYLES[task.priority]}`} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                          {task.priority}
                        </span>
                      </td>
                      <td className="px-6 py-[21px]">
                        <span className="inline-flex items-center gap-1.5 bg-[#f1f5f9] border border-[#e2e8f0] px-2 py-[5px] rounded-[4px] text-[11px] text-[#334155]">
                          {task.type === "Autonomous" ? <IconRobot /> : <IconUser />}
                          {task.type}
                        </span>
                      </td>
                      <td className="px-6 py-[21px] text-right">
                        <button className="text-[#94a3b8] hover:text-[#334155] transition-colors">
                          <IconEdit />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-6 py-[16px] bg-[rgba(248,250,252,0.3)] border-t border-[#f1f5f9]">
            <span className="text-[11px] text-[#64748b]">Showing 8 of 142 tasks</span>
            <div className="flex gap-2">
              <button className="bg-white border border-[#e2e8f0] text-[#475569] text-[11px] px-[13px] py-[5px] rounded-[2px] hover:bg-[#f8fafc] transition-colors">Previous</button>
              <button className="bg-white border border-[#e2e8f0] text-[#475569] text-[11px] px-[13px] py-[5px] rounded-[2px] hover:bg-[#f8fafc] transition-colors">Next</button>
            </div>
          </div>
        </div>

        {/* ── Bottom Row: Abilities + Project Links ── */}
        <div className="grid grid-cols-2 gap-6">
          {/* Abilities */}
          <div className="bg-white border border-[#e2e8f0] rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] p-[25px] flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h2 className="text-[24px] font-semibold text-[#0b1c30]">Abilities</h2>
              <Badge variant="success" className="rounded text-[11px] font-bold tracking-wide">
                1 Configured
              </Badge>
            </div>
            <div className="bg-[#eff4ff] border border-[#f1f5f9] rounded-[4px] p-[17px] flex flex-col gap-4">
              {/* Integration header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-black rounded-[2px] w-10 h-10 flex items-center justify-center shrink-0">
                    <IconVercel />
                  </div>
                  <div>
                    <p className="text-[16px] font-semibold text-[#0f172a] leading-[24px]">Deployment</p>
                    <p className="text-[11px] font-semibold text-[#64748b] tracking-[0.275px] uppercase">VERCEL INTEGRATION</p>
                  </div>
                </div>
                <div className="w-[22px] h-[22px] bg-[#712ae2] rounded-[2px] flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l3.5 3.5L12 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
              {/* API key input */}
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-[#64748b] tracking-[0.6px] uppercase">VERCEL API KEY</label>
                <div className="relative">
                  <div className="bg-white border border-[#e2e8f0] rounded-[4px] px-[13px] py-[9px] flex items-center">
                    <span className="text-[14px] text-[#0b1c30] flex-1">
                      {apiKeyVisible ? "sk_test_51MzS2xxxxxLiveKeyValue" : "sk_test_51MzS2..."}
                    </span>
                  </div>
                  <button
                    onClick={() => setApiKeyVisible((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#94a3b8] hover:text-[#334155] transition-colors"
                  >
                    <Eye className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Project Links */}
          <div className="bg-white border border-[#e2e8f0] rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] p-[25px] flex flex-col gap-4">
            <h2 className="text-[24px] font-semibold text-[#0b1c30] pb-4 border-b border-[#f1f5f9]">Project Links</h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between border border-[#f1f5f9] rounded-[4px] px-[13px] py-[13px]">
                <div className="flex items-center gap-3">
                  <IconGithub />
                  <span className="text-[16px] font-medium text-[#334155]">GitHub Repository</span>
                </div>
                <button className="text-[#94a3b8] hover:text-[#712ae2] transition-colors">
                  <IconExternalLink />
                </button>
              </div>
              <div className="flex items-center justify-between border border-[#f1f5f9] rounded-[4px] px-[13px] py-[13px]">
                <div className="flex items-center gap-3">
                  <IconJira />
                  <span className="text-[16px] font-medium text-[#334155]">Jira Board</span>
                </div>
                <button className="text-[#94a3b8] hover:text-[#712ae2] transition-colors">
                  <IconExternalLink />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer CTA ── */}
        <div className="flex justify-end pb-8 pt-4">
          <Button
            onClick={() => step?.status === "completed" && goToSubStage("task-breakdown", "kickoff")}
            className="bg-[#712ae2] hover:bg-[#5f24c2] font-bold px-8"
          >
            <Code2 className="size-4" />
            Proceed to coding
          </Button>
        </div>

      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ running, status }: { running: boolean; status?: string }) {
  if (running) return (
    <Badge variant="warning">
      <Loader2 className="size-3 animate-spin" /> Generating
    </Badge>
  );
  if (status === "completed") return (
    <Badge variant="success">
      <CheckCircle2 className="size-3" /> Done
    </Badge>
  );
  if (status === "failed") return (
    <Badge variant="destructive">
      <AlertCircle className="size-3" /> Failed
    </Badge>
  );
  return (
    <Badge variant="muted">
      <Clock className="size-3" /> Waiting
    </Badge>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconFilter() {
  return (
    <svg width="15" height="10" viewBox="0 0 15 10" fill="none">
      <path d="M0 0h15v1.5H0zM3 4.25h9v1.5H3zM5.5 8.5h4v1.5h-4z" fill="currentColor" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function IconRobot() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M12 3v4M8 11V7h8v4" /><circle cx="9" cy="16" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="16" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function IconVercel() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <path d="M12 2L2 19.5h20L12 2z" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg width="16" height="11" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8S5 1 12 1s11 7 11 7-4 7-11 7S1 8 1 8z" /><circle cx="12" cy="8" r="3" />
    </svg>
  );
}
function IconGithub() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[#334155]">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}
function IconJira() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#334155]">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconExternalLink() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
function IconCode() {
  return (
    <svg width="15" height="9" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="7 8 3 12 7 16" /><polyline points="17 8 21 12 17 16" /><line x1="14" y1="4" x2="10" y2="20" />
    </svg>
  );
}
