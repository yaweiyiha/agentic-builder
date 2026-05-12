"use client";
import { useState } from "react";
import { ArrowRight, Rocket, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import type { StepUIProps } from "../../../_shared/types";

export function EnvSetupUI({ onNavigate, isHydrated, projectSlug }: StepUIProps) {
  const [loading, setLoading] = useState(false);
  const featureBrief = useStepStore((s) => s.featureBrief);
  const codeOutputDir = useStepStore((s) => s.codeOutputDir);
  const steps = useStepStore((s) => s.steps);
  const setStepResult = useStepStore((s) => s.setStepResult);
  const setStepFailed = useStepStore((s) => s.setStepFailed);

  const handleKickoff = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/agents/kickoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureBrief,
          codeOutputDir,
          prd: steps.prd?.content ?? "",
          trd: steps.trd?.content ?? "",
          sysdesign: steps.sysdesign?.content ?? "",
          implguide: steps.implguide?.content ?? "",
          design: steps.design?.content ?? "",
          pencil: steps.pencil?.content ?? "",
          sessionId: useStepStore.getState().kickoffSessionId ?? "",
        }),
      });

      if (!resp.ok) throw new Error("Kickoff request failed");

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let kickoffContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "step_stream") {
              kickoffContent += event.data?.chunk ?? "";
            } else if (event.type === "step_complete") {
              kickoffContent = event.data?.content ?? kickoffContent;
            } else if (event.type === "done") {
              const kickoffMeta = event.run?.steps?.kickoff;
              const costUsd = kickoffMeta?.costUsd ?? 0;
              const durationMs = kickoffMeta?.durationMs ?? 0;
              const metadata = kickoffMeta?.metadata ?? {};
              const now = new Date().toISOString();
              setStepResult("env-setup", {
                stepId: "env-setup",
                status: "completed",
                content: kickoffContent,
                costUsd,
                durationMs,
                metadata,
                timestamp: now,
              });
              setStepResult("task-breakdown", {
                stepId: "task-breakdown",
                status: "completed",
                content: kickoffContent,
                costUsd: 0,
                durationMs: 0,
                metadata,
                timestamp: now,
              });
              onNavigate("task-breakdown");
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setStepFailed("env-setup", err instanceof Error ? err.message : "Kickoff failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-12">
      <div className="max-w-lg w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-5">
          <Rocket className="size-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-[#0b1c30] mb-2">Ready to Kick Off</h1>
        <p className="text-[15px] text-[#64748b] mb-8">
          All preparation documents are ready. Run the kick-off to scaffold your project environment and generate the task breakdown.
        </p>

        <div className="bg-[#f8fafc] rounded-xl p-4 mb-6 text-left text-sm text-[#64748b] space-y-2">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span>Output Directory: <code className="text-[#334155]">{codeOutputDir}</code></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span>Documents generated: PRD, Design, QA</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span>Push to GitHub after kick-off</span>
          </div>
        </div>

        <Button size="lg" onClick={handleKickoff} disabled={loading} className="w-full">
          {loading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Rocket size={16} className="mr-2" />}
          {loading ? "Running Kick-off..." : "Run Kick-off"}
        </Button>

        <p className="text-xs text-[#94a3b8] mt-3">
          This will scaffold the environment and generate the coding task breakdown.
        </p>
      </div>
    </div>
  );
}
