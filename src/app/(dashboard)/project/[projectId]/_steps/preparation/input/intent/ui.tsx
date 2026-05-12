"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles, Bot, User, Loader2, ArrowRight,
  RefreshCw, MoreVertical, Check, CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStepStore } from "@/store/step-store";
import { useStepNavigationStore } from "@/store/step-navigation-store";
import { usePipelineStore } from "@/store/pipeline-store";
import { getNextStep } from "@/_config/pipeline-flow";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import StageInputBar from "@/components/StageInputBar";
import type { StepUIProps } from "../../../_shared/types";

// ── Types ──────────────────────────────────────────────────────────────────

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

type UserConvMsg = { role: "user"; text: string; id: string };
type AiConvMsg = { role: "ai"; content: string; intentForm?: IntentFormData; id: string };
type ConvMsg = UserConvMsg | AiConvMsg;

// ── Icons ──────────────────────────────────────────────────────────────────
const CheckSmallIcon = () => <Check size={10} className="text-white" />;
const CheckGatheredIcon = () => <CheckCheck size={11} className="text-emerald-500 shrink-0 mt-0.5" />;

function TypingDots() {
  return (
    <span className="inline-flex items-end gap-0.75 h-4 ml-1">
      <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
      <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
      <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
    </span>
  );
}

// ── User Message ───────────────────────────────────────────────────────────
function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3 items-end justify-end">
      <div className="bg-slate-900 text-white rounded-xl rounded-br-none px-5 py-3 max-w-sm lg:max-w-md shadow-md hover:shadow-lg transition-shadow">
        <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">{text}</p>
      </div>
      <div className="shrink-0 w-8 h-8 rounded-full bg-linear-to-br from-slate-700 to-slate-800 flex items-center justify-center flex-none shadow-sm">
        <User size={16} className="text-white" />
      </div>
    </div>
  );
}

// ── Intent Form Card ───────────────────────────────────────────────────────
function IntentFormCard({
  form, onSubmit, onTextQuestion, onStartGeneration,
  intentAllClear, disabled, isRechecking, isLastMessage,
}: {
  form: IntentFormData;
  onSubmit: (questions: IntentQuestion[], answers: Record<string, string | string[]>) => void;
  onTextQuestion?: (ctx: { questions: IntentQuestion[]; answers: Record<string, string | string[]>; id: string } | null) => void;
  onStartGeneration?: (questions: IntentQuestion[], answers: Record<string, string | string[]>) => void;
  intentAllClear?: boolean; disabled?: boolean; isRechecking?: boolean; isLastMessage?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [currentIdx, setCurrentIdx] = useState(0);

  function toggleRadio(id: string, value: string) { setAnswers((a) => ({ ...a, [id]: value })); }
  function toggleCheckbox(id: string, value: string) {
    setAnswers((a) => { const prev = (a[id] as string[]) ?? []; const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]; return { ...a, [id]: next }; });
  }

  const currentQuestion = form.questions[currentIdx];
  const isLastQuestion = currentIdx === form.questions.length - 1;

  useEffect(() => {
    if (currentQuestion?.type === "text") onTextQuestion?.({ questions: form.questions, answers, id: currentQuestion.id });
    else onTextQuestion?.(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, currentQuestion?.id]);

  function isCurrentAnswered() {
    if (!currentQuestion) return true;
    if (currentQuestion.type === "text") return true;
    const a = answers[currentQuestion.id];
    if (currentQuestion.type === "checkbox") return Array.isArray(a) && a.length > 0;
    return typeof a === "string" && a.length > 0;
  }

  return (
    <div className="space-y-5">
      {(form.all_clear || form.questions.length === 0) && form.gathered && form.gathered.length > 0 && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" className="shrink-0 mt-0.5">
            <circle cx="10" cy="10" r="9" stroke="#10b981" strokeWidth="1.5" />
            <path d="M6 10l3 3 5-5" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">All information gathered</p>
            <p className="text-sm text-emerald-700 mt-1">You can now start generation.</p>
          </div>
        </div>
      )}

      <div className="prose prose-sm max-w-none text-foreground leading-relaxed">
        <MarkdownRenderer content={form.summary} />
      </div>

      {form.gathered && form.gathered.length > 0 && (
        <div className="border border-slate-200 rounded-lg px-4 py-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide">Already gathered</p>
          {form.gathered.map((item, i) => (
            <div key={i} className="flex items-start gap-2"><CheckGatheredIcon /><span className="text-sm text-foreground leading-5">{item}</span></div>
          ))}
        </div>
      )}

      {currentQuestion && (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground leading-6">{currentQuestion.label}</p>

            {currentQuestion.type === "radio" && currentQuestion.options?.map((opt) => {
              const selected = answers[currentQuestion.id] === opt;
              return (
                <div key={opt} className="flex items-center gap-2.5 cursor-pointer group select-none" onClick={() => { if (!disabled) toggleRadio(currentQuestion.id, opt); }}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${selected ? "border-slate-800 bg-slate-800" : "border-slate-300 group-hover:border-slate-500"}`}>
                    {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <span className={`text-sm font-medium ${selected ? "text-slate-900" : "text-slate-600 group-hover:text-slate-800"}`}>{opt}</span>
                </div>
              );
            })}

            {currentQuestion.type === "checkbox" && currentQuestion.options?.map((opt) => {
              const checked = ((answers[currentQuestion.id] as string[]) ?? []).includes(opt);
              return (
                <div key={opt} className="flex items-center gap-2.5 cursor-pointer group select-none" onClick={() => { if (!disabled) toggleCheckbox(currentQuestion.id, opt); }}>
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${checked ? "border-slate-800 bg-slate-800" : "border-slate-300 group-hover:border-slate-500"}`}>
                    {checked && <CheckSmallIcon />}
                  </div>
                  <span className={`text-sm font-medium ${checked ? "text-slate-900" : "text-slate-600 group-hover:text-slate-800"}`}>{opt}</span>
                </div>
              );
            })}

            {currentQuestion.type === "text" && (
              <p className="text-xs text-muted-foreground italic font-medium">↓ Type your answer in the chat bar below and press Send</p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            {!isLastQuestion && (
              <Button variant="outline" size="sm" onClick={() => setCurrentIdx((i) => i + 1)} disabled={!isCurrentAnswered() || disabled}>
                Next <ArrowRight size={13} />
              </Button>
            )}
            {isLastQuestion && (
              <Button size="sm" onClick={() => onSubmit(form.questions, answers)} disabled={!isCurrentAnswered() || disabled || isRechecking}>
                {isRechecking ? <><Loader2 size={13} className="animate-spin" />Checking…</> : <>Confirm & Check <ArrowRight size={13} /></>}
              </Button>
            )}
            <div className="flex-1" />
            {isLastMessage && (() => {
              const isAllClear = form.all_clear || (form.gathered?.length ?? 0) >= 6;
              return (
                <>
                  {form.questions.length > 0 && <span className="text-xs text-muted-foreground font-medium">Question {(form.gathered?.length ?? 0) + currentIdx + 1} / 6</span>}
                  <Button onClick={() => onStartGeneration?.(form.questions, answers)} disabled={disabled} className="text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg h-8 px-3 text-sm font-semibold shadow-md hover:shadow-indigo-200 hover:shadow-lg transition-all hover:scale-105 active:scale-95">
                    {isAllClear ? "Next Step" : "Skip to Next Step"} <ArrowRight size={14} />
                  </Button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {!currentQuestion && isLastMessage && (() => {
        const isAllClear = form.all_clear || (form.gathered?.length ?? 0) >= 6;
        return (
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-2">
            <Button onClick={() => onStartGeneration?.(form.questions, answers)} disabled={disabled} className="text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg h-9 px-4 text-sm font-semibold shadow-md hover:shadow-indigo-200 hover:shadow-lg transition-all hover:scale-105 active:scale-95">
              {isAllClear ? "Next Step" : "Skip to Next Step"} <ArrowRight size={15} />
            </Button>
          </div>
        );
      })()}
    </div>
  );
}

// ── AI Message ─────────────────────────────────────────────────────────────
function AIMessage({
  intentForm, onFormSubmit, onTextQuestion, onStartGeneration,
  intentAllClear, isRechecking, isLastMessage,
}: {
  intentForm?: IntentFormData;
  onFormSubmit?: (questions: IntentQuestion[], answers: Record<string, string | string[]>) => void;
  onTextQuestion?: (ctx: { questions: IntentQuestion[]; answers: Record<string, string | string[]>; id: string } | null) => void;
  onStartGeneration?: (questions: IntentQuestion[], answers: Record<string, string | string[]>) => void;
  intentAllClear?: boolean; isRechecking?: boolean; isLastMessage?: boolean;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className={`shrink-0 w-8 h-8 rounded-full bg-linear-to-br from-slate-600 to-slate-700 flex items-center justify-center flex-none text-white shadow-md ${isRechecking && isLastMessage ? "animate-pulse" : ""}`}>
        <Bot size={16} />
      </div>
      <div className="flex-1 min-w-0">
        {intentForm ? (
          <div className="bg-white rounded-xl rounded-tl-none border border-slate-100 p-6 shadow-sm hover:shadow-md transition-shadow">
            <IntentFormCard form={intentForm} onSubmit={onFormSubmit ?? (() => {})} onTextQuestion={isLastMessage ? onTextQuestion : undefined} onStartGeneration={onStartGeneration} intentAllClear={intentAllClear} disabled={isRechecking} isRechecking={isRechecking && isLastMessage} isLastMessage={isLastMessage} />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-slate-600 text-sm font-medium"><Loader2 size={14} className="animate-spin" /><span>Analyzing your brief…</span></div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function IntentUI(props: StepUIProps) {
  const isRunning = useStepStore((s) => s.isRunning);
  const startPipeline = usePipelineStore((s) => s.startPipeline); // bridge: pipeline-store handles SSE
  const featureBrief = useStepStore((s) => s.featureBrief);
  const tier = useStepNavigationStore((s) => s.tier);
  const nextStep = getNextStep("intent", tier);
  const setProjectName = useStepNavigationStore((s) => s.setProjectName);
  const isHydrated = props.isHydrated;
  const intentMessages = useStepStore((s) => s.intentMessages);
  const intentEnrichedBrief = useStepStore((s) => s.intentEnrichedBrief);
  const setIntentConversation = useStepNavigationStore((s) => s.setIntentConversation);

  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ConvMsg[]>([]);
  const [isRechecking, setIsRechecking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [intentAllClear, setIntentAllClear] = useState(false);

  const qaHistoryRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const enrichedBriefRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoStartedRef = useRef(false);
  const pendingTextQuestionRef = useRef<{ questions: IntentQuestion[]; answers: Record<string, string | string[]>; id: string } | null>(null);

  const isAgentActive = isRechecking;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, streamingText, isRechecking]);

  // Initialize — auto-start when featureBrief is available
  useEffect(() => {
    if (!isHydrated) return;

    // Restore from persisted messages
    if (intentMessages.length > 0 && !autoStartedRef.current) {
      autoStartedRef.current = true;
      const msgs = intentMessages as ConvMsg[];
      enrichedBriefRef.current = intentEnrichedBrief || featureBrief.trim();
      setMessages(msgs);
      const lastAiMsg = [...msgs].reverse().find((m) => m.role === "ai") as AiConvMsg | undefined;
      if (lastAiMsg?.intentForm) {
        if (lastAiMsg.intentForm.all_clear || lastAiMsg.intentForm.questions.length === 0) setIntentAllClear(true);
        if (lastAiMsg.intentForm.project_name?.trim()) setProjectName(lastAiMsg.intentForm.project_name.trim());
      }
      return;
    }

    // Wait for featureBrief from the initial step
    if (!featureBrief.trim()) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;

    enrichedBriefRef.current = featureBrief.trim();
    qaHistoryRef.current = [];
    setMessages([{ role: "user", text: featureBrief.trim(), id: `user-auto-${Date.now()}` } satisfies UserConvMsg]);
    setIsRechecking(true);
    callRecheckStream(featureBrief.trim(), [])
      .then((result) => {
        if (!result) {
          setMessages((prev) => [...prev, { role: "ai", content: "Error analyzing brief.", intentForm: { summary: "Error analyzing brief. Please try again.", questions: [] }, id: `ai-err-auto-${Date.now()}` } satisfies AiConvMsg]);
          return;
        }
        if (result.project_name?.trim()) setProjectName(result.project_name.trim());
        if (result.all_clear || result.questions.length === 0) setIntentAllClear(true);
        setMessages((prev) => [...prev, { role: "ai", content: JSON.stringify(result), intentForm: result, id: `ai-auto-${Date.now()}` } satisfies AiConvMsg]);
      })
      .catch((err) => {
        setMessages((prev) => [...prev, { role: "ai", content: `Error: ${err instanceof Error ? err.message : "Unknown error"}.`, intentForm: { summary: "Network error — please try again.", questions: [] }, id: `ai-err-auto-${Date.now()}` } satisfies AiConvMsg]);
      })
      .finally(() => setIsRechecking(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, featureBrief]);

  useEffect(() => {
    if (messages.length > 0) setIntentConversation(messages as unknown[], enrichedBriefRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // ── SSE streaming ──
  async function callRecheckStream(brief: string, history: { role: "user" | "assistant"; content: string }[]): Promise<IntentFormData | null> {
    setStreamingText("");
    const resp = await fetch("/api/agents/intent-recheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, conversationHistory: history }),
    });
    if (!resp.ok || !resp.body) return null;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let result: IntentFormData | null = null;
    let buf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          if (!frame.trim()) continue;
          const line = frame.startsWith("data: ") ? frame : frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; data?: Record<string, unknown> };
            if (event.type === "step_stream") {
              const chunk = (event.data?.chunk as string) ?? "";
              if (chunk) setStreamingText((t) => t + chunk);
            } else if (event.type === "step_complete") {
              const content = (event.data?.content as string) ?? "";
              if (content) { try { result = JSON.parse(content) as IntentFormData; } catch { /* skip */ } }
            }
          } catch { /* skip */ }
        }
      }
    } finally { reader.releaseLock(); setStreamingText(""); }
    return result;
  }

  async function handleFormSubmit(questions: IntentQuestion[], answers: Record<string, string | string[]>) {
    const parts = Object.entries(answers).map(([id, val]) => {
      const q = questions.find((q) => q.id === id);
      const label = q?.label ?? id; const value = Array.isArray(val) ? val.join(", ") : val;
      return `- ${label}: ${value}`;
    }).join("\n");

    const userMsgText = parts;
    enrichedBriefRef.current = `${enrichedBriefRef.current}\n\nUser clarifications:\n${parts}`;
    setMessages((prev) => [...prev, { role: "user", text: userMsgText, id: `user-${Date.now()}` } satisfies UserConvMsg]);
    qaHistoryRef.current = [...qaHistoryRef.current, { role: "assistant", content: `Questions asked: ${questions.map((q) => q.label).join("; ")}` }, { role: "user", content: userMsgText }];

    setIsRechecking(true);
    try {
      const result = await callRecheckStream(enrichedBriefRef.current, qaHistoryRef.current);
      if (!result) {
        setMessages((prev) => [...prev, { role: "ai", content: "Error: could not parse response.", intentForm: { summary: "Error — please try again.", questions: [] }, id: `ai-err-${Date.now()}` } satisfies AiConvMsg]);
        return;
      }
      if (result.project_name?.trim()) setProjectName(result.project_name.trim());
      if (result.all_clear || result.questions.length === 0) setIntentAllClear(true);
      setMessages((prev) => [...prev, { role: "ai", content: JSON.stringify(result), intentForm: { ...result, questions: result.all_clear ? [] : result.questions }, id: `ai-${Date.now()}` } satisfies AiConvMsg]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "ai", content: `Error: ${err instanceof Error ? err.message : "Network error"}.`, intentForm: { summary: "Network error — please try again.", questions: [] }, id: `ai-err-${Date.now()}` } satisfies AiConvMsg]);
    } finally { setIsRechecking(false); }
  }

  async function handleStartGeneration(questions: IntentQuestion[], answers: Record<string, string | string[]>) {
    const hasAnswers = Object.keys(answers).length > 0;
    if (hasAnswers && questions.length > 0) await handleFormSubmit(questions, answers);
    startPipeline(enrichedBriefRef.current);
    if (nextStep) props.onNavigate(nextStep);
  }

  async function handleSend() {
    const val = inputValue.trim();
    if (!val || isAgentActive) return;
    setInputValue("");

    const pending = pendingTextQuestionRef.current;
    if (pending) {
      pendingTextQuestionRef.current = null;
      const filledAnswers = { ...pending.answers, [pending.id]: val };
      await handleFormSubmit(pending.questions, filledAnswers);
      inputRef.current?.focus();
      return;
    }

    setMessages((prev) => [...prev, { role: "user", text: val, id: `user-${Date.now()}` } satisfies UserConvMsg]);
    enrichedBriefRef.current = val;
    qaHistoryRef.current = [];
    setIntentAllClear(false);
    setIsRechecking(true);
    try {
      const result = await callRecheckStream(val, []);
      if (!result) {
        setMessages((prev) => [...prev, { role: "ai", content: "Sorry, there was an error analyzing your brief. Please try again.", intentForm: { summary: "Sorry, there was an error analyzing your brief. Please try again.", questions: [] }, id: `ai-err-${Date.now()}` } satisfies AiConvMsg]);
        inputRef.current?.focus();
        return;
      }
      if (result.project_name?.trim()) setProjectName(result.project_name.trim());
      if (result.all_clear || result.questions.length === 0) setIntentAllClear(true);
      setMessages((prev) => [...prev, { role: "ai", content: JSON.stringify(result), intentForm: result, id: `ai-${Date.now()}` } satisfies AiConvMsg]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "ai", content: `Network error: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`, id: `ai-err-${Date.now()}` } satisfies AiConvMsg]);
    } finally { setIsRechecking(false); inputRef.current?.focus(); }
  }

  const isEmpty = messages.length === 0 && !isAgentActive;

  return (
    <div className="flex flex-col w-full flex-1 min-h-0 bg-linear-to-br from-slate-50 via-slate-50 to-slate-100 rounded-2xl overflow-hidden shadow-lg">
      <div className="shrink-0 flex items-center justify-between px-8 py-6 bg-white/60 backdrop-blur-md border-b border-white/40">
        <div>
          <h2 className="text-lg font-bold text-slate-900 leading-6">Project Intent Refinement</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2.5 h-2.5 rounded-full transition-colors ${isRechecking ? "bg-amber-500 animate-pulse" : intentAllClear ? "bg-emerald-500" : "bg-slate-300"}`} />
            <span className="text-xs text-slate-600 font-medium">{isRechecking ? "Analyzing…" : intentAllClear ? "Ready to generate" : "Describe your project"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-700 hover:bg-white/50"><RefreshCw size={16} /></Button>
          <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-700 hover:bg-white/50"><MoreVertical size={16} /></Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-8 space-y-6">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
            <div className="w-16 h-16 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center shadow-sm"><Sparkles size={24} className="text-slate-400" /></div>
            <div className="text-center"><p className="text-base font-medium text-slate-700">Start your project journey</p><p className="text-sm text-slate-500 mt-1">Describe your project idea to get started…</p></div>
          </div>
        )}

        {messages.map((msg, idx) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} text={msg.text} />
          ) : (
            <AIMessage key={msg.id} intentForm={(msg as AiConvMsg).intentForm} onFormSubmit={handleFormSubmit} onTextQuestion={(ctx) => { pendingTextQuestionRef.current = ctx; }} onStartGeneration={handleStartGeneration} intentAllClear={intentAllClear} isRechecking={isRechecking} isLastMessage={idx === messages.length - 1} />
          ),
        )}

        {isRechecking && (
          <div className="flex gap-3 items-start">
            <div className="shrink-0 w-8 h-8 rounded-full bg-linear-to-br from-slate-600 to-slate-700 flex items-center justify-center animate-pulse flex-none text-white shadow-md"><Bot size={16} /></div>
            <div className="flex-1 min-w-0 bg-white rounded-2xl rounded-tl-lg border border-slate-100 p-6 shadow-sm hover:shadow-md transition-shadow">
              {streamingText ? (
                <div className="prose prose-sm max-w-none text-slate-900 leading-relaxed"><MarkdownRenderer content={streamingText} /><TypingDots /></div>
              ) : (
                <div className="flex items-center gap-2.5 text-slate-600 text-sm"><Loader2 size={13} className="animate-spin" /><span>Analyzing your brief</span><TypingDots /></div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <StageInputBar value={inputValue} onChange={setInputValue} onSubmit={() => { void handleSend(); }} placeholder="Drop your script or tell me your story ideas…" disabled={isAgentActive} />
    </div>
  );
}
