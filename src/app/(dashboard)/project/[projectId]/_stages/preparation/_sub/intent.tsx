"use client";

import { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/store/pipeline-store";
import { useStageStore } from "@/store/stage-store";
import MarkdownRenderer from "@/components/MarkdownRenderer";

// ── Conversation message types ─────────────────────────────────────────────

type IntentQuestion = {
  id: string;
  type: "radio" | "checkbox" | "text";
  label: string;
  options?: string[];
};

type IntentFormData = {
  project_name?: string;
  all_clear?: boolean;
  summary: string;
  gathered?: string[];
  questions: IntentQuestion[];
};

function parseIntentForm(content: string): IntentFormData | undefined {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return undefined;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.summary || !Array.isArray(parsed.questions)) return undefined;
    return parsed as IntentFormData;
  } catch {
    return undefined;
  }
}

type UserConvMsg = { role: "user"; text: string; id: string };
type AiConvMsg = { role: "ai"; content: string; intentForm?: IntentFormData; id: string };
type ConvMsg = UserConvMsg | AiConvMsg;

// ── Icons ──────────────────────────────────────────────────────────────────

function AgentIcon() {
  return (
    <svg width="14" height="13" viewBox="0 0 14 13" fill="none">
      <path d="M7 0L8.5 4.5H13.5L9.5 7.5L11 12L7 9L3 12L4.5 7.5L0.5 4.5H5.5L7 0Z" fill="white" />
    </svg>
  );
}

function RobotIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 11h6M9 15h6" />
      <circle cx="9" cy="7" r="1" fill="white" />
      <circle cx="15" cy="7" r="1" fill="white" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <circle cx="5" cy="3" r="2.5" fill="white" />
      <path d="M0 9.5C0 7.567 2.239 6 5 6s5 1.567 5 3.5" stroke="white" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function SpinnerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="12" height="11" viewBox="0 0 12 11" fill="none">
      <path d="M11 5.5L1 1l2 4.5L1 10l10-4.5z" fill="white" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 5h6M5.5 2.5L8 5l-2.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor">
      <circle cx="2" cy="2" r="1.5" />
      <circle cx="2" cy="8" r="1.5" />
      <circle cx="2" cy="14" r="1.5" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="13" height="20" viewBox="0 0 13 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 8v5.5a5 5 0 0 1-10 0V5.5a3.5 3.5 0 0 1 7 0V13a2 2 0 0 1-4 0V7" />
    </svg>
  );
}

function CheckSmallIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
      <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckGatheredIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0 mt-0.5">
      <path d="M2 6l3 3 5-5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3 items-start justify-end">
      <div className="bg-linear-to-br from-[#07c160] to-[#05a042] text-white rounded-3xl rounded-tr-none px-5 py-3.5 shadow-md hover:shadow-lg transition-shadow">
        <p className="text-[15px] leading-7 whitespace-pre-wrap font-medium">{text}</p>
      </div>
      <div className="shrink-0 w-7 h-7 rounded-lg bg-linear-to-br from-[#07c160] to-[#05a042] flex items-center justify-center flex-none">
        <UserIcon />
      </div>
    </div>
  );
}

// ── Intent Form Card ─────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span className="inline-flex items-end gap-0.75 h-4 ml-1">
      <span className="w-1 h-1 rounded-full bg-[#712ae2] animate-bounce [animation-delay:0ms]" />
      <span className="w-1 h-1 rounded-full bg-[#712ae2] animate-bounce [animation-delay:150ms]" />
      <span className="w-1 h-1 rounded-full bg-[#712ae2] animate-bounce [animation-delay:300ms]" />
    </span>
  );
}

function IntentFormCard({
  form,
  onSubmit,
  onTextQuestion,
  disabled,
  isRechecking,
}: {
  form: IntentFormData;
  onSubmit: (questions: IntentQuestion[], answers: Record<string, string | string[]>) => void;
  /** Called when current question is text-type so parent can route chat-bar input here */
  onTextQuestion?: (ctx: { questions: IntentQuestion[]; answers: Record<string, string | string[]>; id: string } | null) => void;
  disabled?: boolean;
  isRechecking?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  // Show one question at a time; advance after answering
  const [currentIdx, setCurrentIdx] = useState(0);

  function toggleRadio(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: value }));
  }
  function toggleCheckbox(id: string, value: string) {
    setAnswers((a) => {
      const prev = (a[id] as string[]) ?? [];
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      return { ...a, [id]: next };
    });
  }

  const currentQuestion = form.questions[currentIdx];
  const isLastQuestion  = currentIdx === form.questions.length - 1;

  // Notify parent whenever the current question changes (or on mount)
  useEffect(() => {
    if (currentQuestion?.type === "text") {
      onTextQuestion?.({ questions: form.questions, answers, id: currentQuestion.id });
    } else {
      onTextQuestion?.(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, currentQuestion?.id]);

  function isCurrentAnswered() {
    if (!currentQuestion) return true;
    // text-type answers are collected via the bottom chat bar, always allow advancing
    if (currentQuestion.type === "text") return true;
    const a = answers[currentQuestion.id];
    if (currentQuestion.type === "checkbox") return Array.isArray(a) && a.length > 0;
    return typeof a === "string" && a.length > 0;
  }

  return (
    <div className="space-y-5">
      {/* All-clear banner */}
      {(form.all_clear || form.questions.length === 0) && form.gathered && form.gathered.length > 0 && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" className="shrink-0 mt-0.5">
            <circle cx="10" cy="10" r="9" stroke="#10b981" strokeWidth="1.5" />
            <path d="M6 10l3 3 5-5" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="text-[12px] font-bold text-emerald-700 uppercase tracking-wide">All information gathered</p>
            <p className="text-[13px] text-emerald-800 mt-0.5">You can now start generation.</p>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="prose prose-sm max-w-none text-[#1f2937] leading-relaxed">
        <MarkdownRenderer content={form.summary} />
      </div>

      {/* Already gathered */}
      {form.gathered && form.gathered.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Already gathered</p>
          {form.gathered.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <CheckGatheredIcon />
              <span className="text-[13px] text-emerald-800 leading-5">{item}</span>
            </div>
          ))}
        </div>
      )}

      {/* One question at a time */}
      {currentQuestion && (
        <div className="space-y-5 border-t border-[#f1f5f9] pt-4">
          {/* Progress indicator */}
          {form.questions.length > 1 && (
            <p className="text-[11px] text-[#94a3b8]">
              Question {currentIdx + 1} of {form.questions.length}
            </p>
          )}

          <div className="space-y-2.5">
            <p className="text-[14px] font-semibold text-[#111827] leading-6">{currentQuestion.label}</p>

            {currentQuestion.type === "radio" && currentQuestion.options?.map((opt) => {
              const selected = answers[currentQuestion.id] === opt;
              return (
                <label key={opt} onClick={() => !disabled && toggleRadio(currentQuestion.id, opt)} className="flex items-center gap-2.5 cursor-pointer group">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${selected ? "border-[#712ae2] bg-[#712ae2]" : "border-[#cbd5e1] group-hover:border-[#a78bfa]"}`}>
                    {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <span className="text-[13px] text-[#4b5563] select-none font-medium">{opt}</span>
                </label>
              );
            })}

            {currentQuestion.type === "checkbox" && currentQuestion.options?.map((opt) => {
              const checked = ((answers[currentQuestion.id] as string[]) ?? []).includes(opt);
              return (
                <label key={opt} onClick={() => !disabled && toggleCheckbox(currentQuestion.id, opt)} className="flex items-center gap-2.5 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${checked ? "border-[#712ae2] bg-[#712ae2]" : "border-[#cbd5e1] group-hover:border-[#a78bfa]"}`}>
                    {checked && <CheckSmallIcon />}
                  </div>
                  <span className="text-[13px] text-[#4b5563] select-none font-medium">{opt}</span>
                </label>
              );
            })}

            {currentQuestion.type === "text" && (
              <p className="text-[12px] text-[#6b7280] italic font-medium">
                ↓ Type your answer in the chat bar below and press Send
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Next question button */}
            {!isLastQuestion && (
              <button
                onClick={() => setCurrentIdx((i) => i + 1)}
                disabled={!isCurrentAnswered() || disabled}
                className="flex items-center gap-2 px-4 py-2 bg-[#f1f5f9] text-[#374151] text-[13px] font-semibold rounded-md hover:bg-[#e2e8f0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <ArrowRightIcon />
              </button>
            )}
            {/* Submit all answers */}
            {isLastQuestion && (
              <button
                onClick={() => onSubmit(form.questions, answers)}
                disabled={!isCurrentAnswered() || disabled || isRechecking}
                className="flex items-center gap-2 px-4 py-2 bg-[#712ae2] text-white text-[13px] font-semibold rounded-md hover:bg-[#5f22c7] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isRechecking ? (
                  <><SpinnerIcon size={13} />Checking…</>
                ) : (
                  <>Confirm &amp; Check<ArrowRightIcon /></>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AIMessage({
  intentForm,
  onFormSubmit,
  onTextQuestion,
  isRechecking,
  isLastMessage,
}: {
  intentForm?: IntentFormData;
  onFormSubmit?: (questions: IntentQuestion[], answers: Record<string, string | string[]>) => void;
  onTextQuestion?: (ctx: { questions: IntentQuestion[]; answers: Record<string, string | string[]>; id: string } | null) => void;
  isRechecking?: boolean;
  isLastMessage?: boolean;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className={`shrink-0 w-8 h-8 rounded-lg bg-linear-to-br from-[#712ae2] to-[#5f22c7] flex items-center justify-center flex-none text-white ${isRechecking && isLastMessage ? "animate-pulse" : ""}`}>
        <RobotIcon />
      </div>
      <div className="flex-1 min-w-0 bg-linear-to-br from-[#f1f5ff] to-[#ede9f6] border border-[#e9e5f5] rounded-3xl rounded-tl-none p-5 shadow-md hover:shadow-lg transition-shadow">
        {intentForm ? (
          <IntentFormCard
            form={intentForm}
            onSubmit={onFormSubmit ?? (() => {})}
            onTextQuestion={isLastMessage ? onTextQuestion : undefined}
            disabled={isRechecking}
            isRechecking={isRechecking && isLastMessage}
          />
        ) : (
          <div className="flex items-center gap-2.5 text-[#6b7280] text-sm font-medium">
            <SpinnerIcon size={14} />
            <span>Processing…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Classification card ──────────────────────────────────────────────────

type Classification = {
  tier: string;
  type: string;
  needsBackend: boolean;
  needsDatabase: boolean;
  reasoning: string;
};

const TIER_LABEL: Record<string, string> = { S: "Simple", M: "Standard", L: "Enterprise" };
const TIER_COLOR: Record<string, string> = {
  S: "bg-emerald-50 text-emerald-700 border-emerald-200",
  M: "bg-amber-50 text-amber-700 border-amber-200",
  L: "bg-zinc-100 text-zinc-700 border-zinc-300",
};

function ClassificationCard({ cls }: { cls: Classification }) {
  const tierStyle = TIER_COLOR[cls.tier] ?? TIER_COLOR.M;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-semibold ${tierStyle}`}>
          Tier {cls.tier} · {TIER_LABEL[cls.tier] ?? cls.tier}
        </span>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-[#e2e8f0] bg-white text-[12px] text-[#475569]">
          {cls.type}
        </span>
        {cls.needsBackend && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-[12px] text-blue-700">
            Backend
          </span>
        )}
        {cls.needsDatabase && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-violet-200 bg-violet-50 text-[12px] text-violet-700">
            Database
          </span>
        )}
      </div>
      <p className="text-[14px] text-[#374151] leading-6">{cls.reasoning}</p>
    </div>
  );
}

function MetaBadge({ step }: { step: { model?: string; costUsd?: number; durationMs?: number } }) {
  return (
    <div className="flex items-center gap-4 pl-12 mt-1">
      {step.model && (
        <span className="text-[11px] text-[#94a3b8]">
          Model: <span className="font-medium text-[#64748b]">{step.model}</span>
        </span>
      )}
      {step.costUsd != null && (
        <span className="text-[11px] text-[#94a3b8]">
          Cost: <span className="font-medium text-[#64748b]">${step.costUsd.toFixed(4)}</span>
        </span>
      )}
      {step.durationMs != null && (
        <span className="text-[11px] text-[#94a3b8]">
          Time: <span className="font-medium text-[#64748b]">{(step.durationMs / 1000).toFixed(1)}s</span>
        </span>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function IntentSubStage() {
  const isRunning             = usePipelineStore((s) => s.isRunning);
  const startPipeline         = usePipelineStore((s) => s.startPipeline);
  const featureBrief          = usePipelineStore((s) => s.featureBrief);
  const goToSubStage          = useStageStore((s) => s.goToSubStage);
  const setProjectName        = useStageStore((s) => s.setProjectName);
  const isStageHydrated       = useStageStore((s) => s.isStageHydrated);
  const intentMessages        = useStageStore((s) => s.intentMessages);
  const intentEnrichedBrief   = useStageStore((s) => s.intentEnrichedBrief);
  const setIntentConversation = useStageStore((s) => s.setIntentConversation);

  const [inputValue, setInputValue]         = useState("");
  const [messages, setMessages]             = useState<ConvMsg[]>([]);
  const [isRechecking, setIsRechecking]     = useState(false);
  const [streamingText, setStreamingText]   = useState("");
  const [intentAllClear, setIntentAllClear] = useState(false);

  const qaHistoryRef           = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const enrichedBriefRef        = useRef("");
  const bottomRef               = useRef<HTMLDivElement>(null);
  const inputRef                = useRef<HTMLInputElement>(null);
  const autoStartedRef          = useRef(false); // prevent StrictMode double-fire

  // Auto-scroll to bottom whenever messages update or streaming text changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText, isRechecking]);
  // Set when the last AI message is waiting for a text-type answer via the chat bar
  const pendingTextQuestionRef  = useRef<{ questions: IntentQuestion[]; answers: Record<string, string | string[]>; id: string } | null>(null);

  // Intent stage runs BEFORE the full pipeline — only block on isRechecking here.
  // isRunning reflects the main pipeline which hasn't started yet.
  const isAgentActive = isRechecking;

  // Initialize: wait for DB hydration, then restore conversation or auto-start.
  useEffect(() => {
    if (!isStageHydrated) return; // wait for page.tsx loadFromServer to complete
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;

    // 1. Restore conversation from store (populated by loadFromServer from DB)
    if (intentMessages.length > 0) {
      const msgs = intentMessages as ConvMsg[];
      enrichedBriefRef.current = intentEnrichedBrief || featureBrief.trim();
      setMessages(msgs);
      // Restore derived state from the last AI message
      const lastAiMsg = [...msgs].reverse().find((m) => m.role === "ai") as AiConvMsg | undefined;
      if (lastAiMsg?.intentForm) {
        if (lastAiMsg.intentForm.all_clear || lastAiMsg.intentForm.questions.length === 0) {
          setIntentAllClear(true);
        }
        if (lastAiMsg.intentForm.project_name?.trim()) {
          setProjectName(lastAiMsg.intentForm.project_name.trim());
        }
      }
      console.log("[intent] restored conversation from DB, messages:", msgs.length);
      return;
    }

    // 2. Auto-start if featureBrief exists
    if (!featureBrief.trim()) return;

    console.log("[intent] auto-starting with featureBrief from store");
    enrichedBriefRef.current = featureBrief.trim();
    qaHistoryRef.current = [];
    setMessages([
      { role: "user", text: featureBrief.trim(), id: `user-auto-${Date.now()}` } satisfies UserConvMsg,
    ]);
    setIsRechecking(true);
    callRecheckStream(featureBrief.trim(), [])
      .then((result) => {
        console.log("[intent] auto-start result:", result ? "ok" : "null");
        if (!result) {
          setMessages((prev) => [...prev, {
            role: "ai",
            content: "Error analyzing brief.",
            intentForm: { summary: "Error analyzing brief. Please try again.", questions: [] },
            id: `ai-err-auto-${Date.now()}`,
          } satisfies AiConvMsg]);
          return;
        }
        if (result.project_name?.trim()) setProjectName(result.project_name.trim());
        if (result.all_clear || result.questions.length === 0) setIntentAllClear(true);
        setMessages((prev) => [...prev, {
          role: "ai",
          content: JSON.stringify(result),
          intentForm: result,
          id: `ai-auto-${Date.now()}`,
        } satisfies AiConvMsg]);
      })
      .catch((err) => {
        console.error("[intent] auto-start error:", err);
        setMessages((prev) => [...prev, {
          role: "ai",
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}.`,
          intentForm: { summary: "Network error — please try again.", questions: [] },
          id: `ai-err-auto-${Date.now()}`,
        } satisfies AiConvMsg]);
      })
      .finally(() => setIsRechecking(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStageHydrated]);

  // Sync conversation to store (→ DB) whenever messages or enrichedBrief change.
  useEffect(() => {
    if (messages.length > 0) {
      setIntentConversation(messages as unknown[], enrichedBriefRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // ── Shared SSE streaming helper ────────────────────────────────────────
  // Consumes pipeline-style SSE events from /api/agents/intent-recheck.
  // step_stream events accumulate into streamingText for a typing animation;
  // step_complete carries the final parsed IntentFormData as JSON in data.content.
  async function callRecheckStream(
    brief: string,
    history: { role: "user" | "assistant"; content: string }[],
  ): Promise<IntentFormData | null> {
    console.log("[intent] callRecheckStream called, brief length:", brief.length, "history:", history.length);
    setStreamingText("");
    const resp = await fetch("/api/agents/intent-recheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, conversationHistory: history }),
    });
    console.log("[intent] fetch response status:", resp.status, "ok:", resp.ok, "body:", !!resp.body);
    if (!resp.ok || !resp.body) {
      console.error("[intent] fetch failed or no body");
      return null;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let result: IntentFormData | null = null;
    // SSE frames are delimited by \n\n
    let buf = "";
    let frameCount = 0;
    let streamCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("[intent] stream done. frames processed:", frameCount, "stream events:", streamCount, "result:", result ? "✓" : "null");
          break;
        }
        buf += decoder.decode(value, { stream: true });
        // Split on double-newline — each SSE frame ends with \n\n
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          if (!frame.trim()) continue;
          frameCount++;
          const line = frame.startsWith("data: ") ? frame : frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) {
            console.warn("[intent] frame with no data: line →", JSON.stringify(frame.slice(0, 80)));
            continue;
          }
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              stepId?: string;
              data?: Record<string, unknown>;
            };
            console.log("[intent] SSE event type:", event.type, "stepId:", event.stepId);
            if (event.type === "step_stream") {
              const chunk = (event.data?.chunk as string) ?? "";
              if (chunk) {
                streamCount++;
                setStreamingText((t) => t + chunk);
              }
            } else if (event.type === "step_complete") {
              const content = (event.data?.content as string) ?? "";
              console.log("[intent] step_complete content length:", content.length, "preview:", content.slice(0, 120));
              if (content) {
                try {
                  result = JSON.parse(content) as IntentFormData;
                  console.log("[intent] parsed IntentFormData — project_name:", result.project_name, "questions:", result.questions?.length);
                } catch (e) {
                  console.error("[intent] failed to parse step_complete content as JSON:", e, content.slice(0, 200));
                }
              }
            } else if (event.type === "step_error") {
              console.error("[intent] step_error:", event.data?.error);
            }
          } catch (e) {
            console.error("[intent] failed to parse SSE frame:", e, JSON.stringify(frame.slice(0, 120)));
          }
        }
      }
    } finally {
      reader.releaseLock();
      setStreamingText("");
    }
    console.log("[intent] callRecheckStream returning:", result ? JSON.stringify(result).slice(0, 120) : "null");
    return result;
  }

  // ── Handle form submission: call recheck API ──
  async function handleFormSubmit(
    questions: IntentQuestion[],
    answers: Record<string, string | string[]>,
  ) {
    const parts = Object.entries(answers)
      .map(([id, val]) => {
        const q = questions.find((q) => q.id === id);
        const label = q?.label ?? id;
        const value = Array.isArray(val) ? val.join(", ") : val;
        return `- ${label}: ${value}`;
      })
      .join("\n");

    const userMsgText = parts;
    enrichedBriefRef.current = `${enrichedBriefRef.current}\n\nUser clarifications:\n${parts}`;

    setMessages((prev) => [
      ...prev,
      { role: "user", text: userMsgText, id: `user-${Date.now()}` } satisfies UserConvMsg,
    ]);

    qaHistoryRef.current = [
      ...qaHistoryRef.current,
      { role: "assistant", content: `Questions asked: ${questions.map((q) => q.label).join("; ")}` },
      { role: "user", content: userMsgText },
    ];

    setIsRechecking(true);
    try {
      const result = await callRecheckStream(enrichedBriefRef.current, qaHistoryRef.current);
      console.log("[handleFormSubmit] callRecheckStream result:", result ? "ok" : "null");

      if (!result) {
        console.warn("[handleFormSubmit] result is null — appending error AI message");
        setMessages((prev) => [...prev, { role: "ai", content: "Error: could not parse response.", intentForm: { summary: "Error — please try again.", questions: [] }, id: `ai-err-${Date.now()}` } satisfies AiConvMsg]);
        return;
      }

      if (result.project_name?.trim()) setProjectName(result.project_name.trim());
      if (result.all_clear || result.questions.length === 0) setIntentAllClear(true);

      console.log("[handleFormSubmit] appending AI message, questions:", result.questions?.length);
      setMessages((prev) => [...prev, {
        role: "ai",
        content: JSON.stringify(result),
        intentForm: { ...result, questions: result.all_clear ? [] : result.questions },
        id: `ai-${Date.now()}`,
      } satisfies AiConvMsg]);
    } catch (err) {
      console.error("[handleFormSubmit] caught error:", err);
      setMessages((prev) => [...prev, { role: "ai", content: `Error: ${err instanceof Error ? err.message : "Network error"}.`, intentForm: { summary: `Network error — please try again.`, questions: [] }, id: `ai-err-${Date.now()}` } satisfies AiConvMsg]);
    } finally {
      setIsRechecking(false);
    }
  }

  function handleStartGeneration() {
    startPipeline(enrichedBriefRef.current);
    goToSubStage("prd", "preparation");
  }

  // ── Handle initial brief send OR text-question answer ──
  async function handleSend() {
    const val = inputValue.trim();
    if (!val || isAgentActive) return;
    setInputValue("");

    // If we're waiting for a text-type answer, inject it and submit the form
    const pending = pendingTextQuestionRef.current;
    if (pending) {
      pendingTextQuestionRef.current = null;
      const filledAnswers = { ...pending.answers, [pending.id]: val };
      // handleFormSubmit already appends the user message internally, so don't add it here
      await handleFormSubmit(pending.questions, filledAnswers);
      inputRef.current?.focus();
      return;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", text: val, id: `user-${Date.now()}` } satisfies UserConvMsg,
    ]);

    // New brief — reset context
    enrichedBriefRef.current = val;
    qaHistoryRef.current = [];
    setIntentAllClear(false);

    setIsRechecking(true);
    try {
      const result = await callRecheckStream(val, []);
      console.log("[handleSend] callRecheckStream result:", result ? "ok" : "null");

      if (!result) {
        console.warn("[handleSend] result is null — appending error AI message");
        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            content: "Sorry, there was an error analyzing your brief. Please try again.",
            intentForm: { summary: "Sorry, there was an error analyzing your brief. Please try again.", questions: [] },
            id: `ai-err-${Date.now()}`,
          } satisfies AiConvMsg,
        ]);
        inputRef.current?.focus();
        return;
      }

      if (result.project_name?.trim()) {
        setProjectName(result.project_name.trim());
      }

      if (result.all_clear || result.questions.length === 0) {
        setIntentAllClear(true);
      }

      console.log("[handleSend] appending AI message with intentForm, questions:", result.questions?.length);
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: JSON.stringify(result),
          intentForm: result,
          id: `ai-${Date.now()}`,
        } satisfies AiConvMsg,
      ]);
    } catch (err) {
      console.error("[handleSend] caught error:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: `Network error: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`,
          id: `ai-err-${Date.now()}`,
        } satisfies AiConvMsg,
      ]);
    } finally {
      setIsRechecking(false);
      inputRef.current?.focus();
    }
  }

  const isEmpty = messages.length === 0 && !isAgentActive;

  return (
    <div className="flex flex-col w-full flex-1 min-h-0 bg-white border border-[#e2e8f0] rounded-lg p-5 shadow-sm overflow-hidden">

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#f1f5f9] bg-white/80 backdrop-blur-sm">
        <div>
          <h2 className="text-[16px] font-semibold text-[#0b1c30] leading-6">Intent Refinement</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`w-2 h-2 rounded-full ${isRechecking ? "bg-[#f59e0b] animate-pulse" : intentAllClear ? "bg-[#10b981]" : "bg-[#cbd5e1]"}`} />
            <span className="text-[14px] text-[#45464d]">
              {isRechecking ? "Agent active: analyzing intent…" : intentAllClear ? "Intent confirmed — ready to generate" : "Waiting for project brief"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button className="p-2 rounded hover:bg-[#f1f5f9] text-[#64748b] transition-colors" title="Refresh"><RefreshIcon /></button>
          <button className="p-2 rounded hover:bg-[#f1f5f9] text-[#64748b] transition-colors" title="More"><MoreIcon /></button>
        </div>
      </div>

      {/* Chat History */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[#94a3b8]">
            <div className="w-12 h-12 rounded-full bg-[#f8fafc] border border-[#e2e8f0] flex items-center justify-center">
              <AgentIcon />
            </div>
            <p className="text-[13px]">Describe your project idea to get started…</p>
          </div>
        )}

        {messages.map((msg, idx) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} text={msg.text} />
          ) : (
            <AIMessage
              key={msg.id}
              intentForm={(msg as AiConvMsg).intentForm}
              onFormSubmit={handleFormSubmit}
              onTextQuestion={(ctx) => { pendingTextQuestionRef.current = ctx; }}
              isRechecking={isRechecking}
              isLastMessage={idx === messages.length - 1}
            />
          )
        )}

        {isRechecking && (
          <div className="flex gap-3 items-start">
            <div className="shrink-0 w-8 h-8 rounded-lg bg-linear-to-br from-[#712ae2] to-[#5f22c7] flex items-center justify-center animate-pulse flex-none text-white">
              <RobotIcon />
            </div>
            <div className="flex-1 min-w-0 bg-linear-to-br from-[#f1f5ff] to-[#ede9f6] border border-[#e9e5f5] rounded-3xl rounded-tl-none p-5 shadow-md">
              {streamingText ? (
                <div className="prose prose-sm max-w-none text-[#1f2937] leading-relaxed">
                  <MarkdownRenderer content={streamingText} />
                  <TypingDots />
                </div>
              ) : (
                <div className="flex items-center gap-2.5 text-[#6b7280] text-sm font-medium">
                  <SpinnerIcon size={13} />
                  <span>Analyzing your brief</span>
                  <TypingDots />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="shrink-0 border-t border-[#f1f5f9] bg-white px-6 py-5">
        <div className="flex items-center gap-4 border border-[#e2e8f0] rounded-lg bg-[#f8fafc] px-2.5 py-2.5">
          <button className="p-2 rounded text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] transition-colors shrink-0">
            <AttachIcon />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={isAgentActive ? "Agent is thinking…" : "Describe or refine your project idea…"}
            className="flex-1 bg-transparent text-[16px] text-[#0b1c30] placeholder:text-[#6b7280] outline-none min-w-0 px-3 py-2"
            disabled={isAgentActive}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            onClick={() => { console.log("[intent] Send clicked, inputValue:", inputValue.trim(), "isAgentActive:", isAgentActive); void handleSend(); }}
            disabled={!inputValue.trim() || isAgentActive}
            className="flex items-center gap-2 px-4 py-2 bg-[#07c160] text-white text-[16px] font-semibold rounded shrink-0 hover:bg-[#06a050] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Send</span>
            <SendIcon />
          </button>
          <button
            onClick={handleStartGeneration}
            disabled={isAgentActive}
            className="flex items-center gap-2 px-4 py-2 bg-[#4f46e5] text-white text-[16px] font-semibold rounded shrink-0 shadow-sm hover:bg-[#4338ca] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Next Step -&gt;</span>
            <ArrowRightIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
