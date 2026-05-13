"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Terminal } from "lucide-react";
import { useStepStore } from "@/store/step-store";
import type { StepUIProps } from "../../_shared/types";

export function AgentsUI({ onNavigate, stepResult }: StepUIProps) {
  const executeStep = useStepStore((s) => s.executeStep);
  const isRunning = useStepStore((s) => s.isRunning);
  const currentStep = useStepStore((s) => s.currentStep);
  const streamingContent = useStepStore((s) => s.streamingContent);
  const streamingThinking = useStepStore((s) => s.streamingThinking);
  const step = useStepStore((s) => s.steps.agents);

  const isThisRunning = isRunning && currentStep === "agents";
  const content = isThisRunning ? (streamingContent || streamingThinking) : (step?.content ?? "");
  const isDone = step?.status === "completed";

  const autoStartedRef = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (step?.content || isRunning) {
      autoStartedRef.current = true;
      setHasStarted(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (content) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [content]);

  const handleStart = () => {
    if (isRunning) return;
    setHasStarted(true);
    void executeStep("agents");
  };

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

          {!hasStarted && !isDone && (
            <div className="flex flex-col items-center gap-4 py-16">
              <p className="text-slate-500 text-sm">Ready to start the coding process</p>
              <button
                onClick={handleStart}
                disabled={isRunning}
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-40"
              >
                {isRunning ? <Loader2 size={16} className="animate-spin" /> : null}
                Start Coding
              </button>
            </div>
          )}

          {(isThisRunning || content) && (
            <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-800">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-xs text-slate-400 font-mono ml-2">coding-agents</span>
                {isThisRunning && <Loader2 size={12} className="text-emerald-400 animate-spin ml-auto" />}
              </div>
              <div className="p-4 font-mono text-sm leading-relaxed max-h-[600px] overflow-y-auto">
                {content ? (
                  <pre className="text-slate-300 whitespace-pre-wrap">{content}</pre>
                ) : (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 size={14} className="animate-spin" />
                    Initializing agents...
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
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
