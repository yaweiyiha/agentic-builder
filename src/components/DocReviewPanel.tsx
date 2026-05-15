"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import MarkdownRenderer from "./MarkdownRenderer";
import Loading from "./Loading";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface DocReviewPanelProps {
  docId: string;
  docLabel: string;
  content: string;
  codeOutputDir?: string;
  /** Called after a successful save so parent can update state */
  onContentSaved?: (docId: string, newContent: string) => void;
}

type DocMode = "view" | "edit" | "refining";

const TOOLBAR_ACTIONS = [
  { label: "B", title: "Bold", prefix: "**", suffix: "**", block: false },
  { label: "I", title: "Italic", prefix: "_", suffix: "_", block: false },
  { label: "H1", title: "Heading 1", prefix: "# ", suffix: "", block: true },
  { label: "H2", title: "Heading 2", prefix: "## ", suffix: "", block: true },
  { label: "H3", title: "Heading 3", prefix: "### ", suffix: "", block: true },
  { label: "• List", title: "Bullet list", prefix: "- ", suffix: "", block: true },
  { label: "</>", title: "Inline code", prefix: "`", suffix: "`", block: false },
];

function MarkdownToolbar({
  textareaRef,
  onUpdate,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onUpdate: (val: string) => void;
}) {
  const applyAction = (
    prefix: string,
    suffix: string,
    block: boolean,
  ) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    const selected = val.slice(start, end);

    let newVal: string;
    let newCursor: number;

    if (block) {
      // Insert at start of line
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      newVal = val.slice(0, lineStart) + prefix + val.slice(lineStart);
      newCursor = start + prefix.length;
    } else {
      newVal =
        val.slice(0, start) + prefix + selected + suffix + val.slice(end);
      newCursor = start + prefix.length + selected.length + suffix.length;
    }

    onUpdate(newVal);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  };

  return (
    <div className="flex items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5">
      {TOOLBAR_ACTIONS.map((action) => (
        <button
          key={action.label}
          title={action.title}
          onMouseDown={(e) => {
            e.preventDefault();
            applyAction(action.prefix, action.suffix, action.block);
          }}
          className="rounded px-2 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export default function DocReviewPanel({
  docId,
  docLabel,
  content,
  codeOutputDir,
  onContentSaved,
}: DocReviewPanelProps) {
  const [mode, setMode] = useState<DocMode>("view");
  const [editValue, setEditValue] = useState(content);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"success" | "error">("success");

  // AI refinement state
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatFocused, setChatFocused] = useState(false);
  const [refining, setRefining] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Current display content (updated after save/refine)
  const [displayContent, setDisplayContent] = useState(content);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDisplayContent(content);
    setEditValue(content);
  }, [content]);

  useEffect(() => {
    if (chatFocused || refining) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatFocused, refining, chatHistory]);

  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      setToast(msg);
      setToastType(type);
      setTimeout(() => setToast(null), 3000);
    },
    [],
  );

  const handleSave = useCallback(
    async (valueToSave: string) => {
      setSaving(true);
      try {
        const resp = await fetch("/api/agents/save-doc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docId,
            content: valueToSave,
            codeOutputDir,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? "Save failed");
        }
        setDisplayContent(valueToSave);
        onContentSaved?.(docId, valueToSave);
        showToast(`Saved to ${(await resp.json()).filename}`);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Save failed",
          "error",
        );
      } finally {
        setSaving(false);
      }
    },
    [docId, codeOutputDir, onContentSaved, showToast],
  );

  const handleEditSave = useCallback(async () => {
    await handleSave(editValue);
    setMode("view");
  }, [editValue, handleSave]);

  const handleChatFocus = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setChatFocused(true);
  }, []);

  const handleChatBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => {
      setChatFocused(false);
      blurTimerRef.current = null;
    }, 180);
  }, []);

  const handleRefine = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || refining) return;
    setChatInput("");
    setRefining(true);
    setChatHistory((h) => [...h, { role: "user", content: msg }]);

    try {
      const resp = await fetch("/api/agents/refine-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          currentContent: displayContent,
          userMessage: msg,
          chatHistory,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Refinement failed");
      }
      const data = (await resp.json()) as {
        updatedContent: string;
        costUsd?: number;
        usage?: { totalTokens: number };
      };
      const assistantMsg: ChatMsg = {
        role: "assistant",
        content: `Done. (${data.usage?.totalTokens?.toLocaleString() ?? "?"} tokens${data.costUsd ? `, $${data.costUsd.toFixed(4)}` : ""})`,
      };
      setChatHistory((h) => [...h, assistantMsg]);

      // Auto-save to disk
      await handleSave(data.updatedContent);
      setEditValue(data.updatedContent);
    } catch (err) {
      setChatHistory((h) => [
        ...h,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setRefining(false);
    }
  }, [chatInput, refining, docId, displayContent, chatHistory, handleSave]);

  const showChatStrip = chatFocused || refining;
  const isEditMode = mode === "edit";

  return (
    <div className="flex flex-col gap-0">
      {/* Main content area */}
      <div className="rounded-2xl border border-zinc-200/90 bg-white shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-3.5">
          <h3 className="text-[13px] font-semibold text-zinc-900">{docLabel}</h3>
          <div className="flex items-center gap-2">
            {!isEditMode ? (
              <button
                onClick={() => {
                  setEditValue(displayContent);
                  setMode("edit");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMode("view")}
                  disabled={saving}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleEditSave()}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-zinc-700 disabled:opacity-40"
                >
                  {saving ? (
                    <Loading size="sm" text="Saving…" />
                  ) : (
                    "Save to disk"
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Editor or viewer */}
        {isEditMode ? (
          <div className="flex flex-col">
            <MarkdownToolbar
              textareaRef={textareaRef}
              onUpdate={setEditValue}
            />
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              spellCheck={false}
              className="min-h-[480px] w-full resize-y bg-white px-6 py-5 font-mono text-[13px] leading-relaxed text-zinc-800 focus:outline-none"
            />
          </div>
        ) : (
          <div className="prose prose-sm prose-zinc max-w-none px-7 py-5">
            <MarkdownRenderer content={displayContent} />
          </div>
        )}
      </div>

      {/* AI Refinement chat — same pattern as PRD review */}
      <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <AnimatePresence initial={false}>
          {showChatStrip && (
            <motion.div
              key="refine-strip"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden border-b border-zinc-200 bg-zinc-50"
            >
              <div
                role="region"
                aria-label="AI refinement thread"
                className="max-h-[min(240px,32vh)] overflow-y-auto px-3 py-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400 [&::-webkit-scrollbar-track]:bg-zinc-100 [&::-webkit-scrollbar]:w-1.5"
                onMouseDown={(e) => e.preventDefault()}
              >
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  AI Refinement
                </p>
                {chatHistory.length === 0 && !refining && (
                  <p className="text-center text-[11px] text-zinc-400">
                    Describe edits and the AI will update the document.
                  </p>
                )}
                <AnimatePresence>
                  {chatHistory.map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`mb-2 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] leading-snug ${
                          msg.role === "user"
                            ? "bg-zinc-900 text-white"
                            : "border border-zinc-200 bg-white text-zinc-700"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {refining && (
                  <div className="flex justify-start pb-1">
                    <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5">
                      <Loading size="sm" text="Refining…" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input row */}
        <div className="flex items-center gap-2 px-3.5 py-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onFocus={handleChatFocus}
            onBlur={handleChatBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleRefine();
              }
            }}
            placeholder={
              isEditMode
                ? "Switch to view mode to use AI refinement"
                : "Ask AI to refine this document…"
            }
            disabled={isEditMode || refining}
            className="h-[42px] min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-40"
          />
          <button
            onClick={() => void handleRefine()}
            disabled={isEditMode || refining || !chatInput.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
            title="Send"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Save toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-white shadow-lg ${
              toastType === "success" ? "bg-zinc-900" : "bg-red-700"
            }`}
          >
            {toastType === "success" && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4ade80"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            )}
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
