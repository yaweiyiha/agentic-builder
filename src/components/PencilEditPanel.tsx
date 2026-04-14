"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Loading from "./Loading";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface PencilEditPanelProps {
  content: string;
  codeOutputDir?: string;
  prdContent?: string;
  /** Called after AI finishes modifying the Pencil file */
  onPencilUpdated?: () => void;
}

type PencilEvent =
  | { type: "session_start"; message: string }
  | { type: "assistant_message"; message: string }
  | { type: "tool_call_start"; toolName: string }
  | { type: "tool_call_result"; toolName: string; ok: boolean; result: string }
  | { type: "session_complete"; message: string; artifactUrls?: string[] }
  | { type: "session_error"; message: string }
  | { type: "done"; result: { content?: string; tokens?: number; costUsd?: number } }
  | { type: "error"; error: string };

export default function PencilEditPanel({
  content,
  codeOutputDir,
  prdContent,
  onPencilUpdated,
}: PencilEditPanelProps) {
  const [chatInput, setChatInput] = useState("");
  const [chatFocused, setChatFocused] = useState(false);
  const [applying, setApplying] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [artifactUrls, setArtifactUrls] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"success" | "error">("success");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (chatFocused || applying) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatFocused, applying, chatHistory, progressLines]);

  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      setToast(msg);
      setToastType(type);
      setTimeout(() => setToast(null), 3500);
    },
    [],
  );

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

  const handleApply = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || applying) return;
    setChatInput("");
    setApplying(true);
    setProgressLines([]);
    setChatHistory((h) => [...h, { role: "user", content: msg }]);

    try {
      const resp = await fetch("/api/agents/pencil-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: msg,
          prdContent: prdContent ?? "",
          codeOutputDir,
          sessionId: `pencil-chat-${Date.now()}`,
        }),
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Request failed");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const event = JSON.parse(raw) as PencilEvent;
            handlePencilEvent(event);
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: `Error: ${errMsg}` },
      ]);
      showToast(errMsg, "error");
    } finally {
      setApplying(false);
    }

    function handlePencilEvent(event: PencilEvent) {
      switch (event.type) {
        case "session_start":
        case "assistant_message":
          setProgressLines((l) => [...l, event.message]);
          break;
        case "tool_call_start":
          setProgressLines((l) => [...l, `→ ${event.toolName}…`]);
          break;
        case "tool_call_result":
          if (!event.ok) {
            setProgressLines((l) => [...l, `✗ ${event.toolName}: ${event.result.slice(0, 80)}`]);
          }
          break;
        case "session_complete": {
          const urls = event.artifactUrls ?? [];
          if (urls.length > 0) setArtifactUrls(urls);
          const summary = event.message || "Done";
          setChatHistory((h) => [
            ...h,
            { role: "assistant", content: summary },
          ]);
          showToast("Pencil design updated");
          onPencilUpdated?.();
          break;
        }
        case "done": {
          const tokens = event.result?.tokens;
          const cost = event.result?.costUsd;
          const info = [
            tokens ? `${tokens.toLocaleString()} tokens` : null,
            cost ? `$${cost.toFixed(4)}` : null,
          ]
            .filter(Boolean)
            .join(", ");
          if (info) {
            setChatHistory((h) => [
              ...h,
              { role: "assistant", content: `Design updated. (${info})` },
            ]);
          }
          showToast("Pencil design updated");
          onPencilUpdated?.();
          break;
        }
        case "session_error":
        case "error": {
          const errMsg =
            "error" in event ? event.error : event.message;
          setChatHistory((h) => [
            ...h,
            { role: "assistant", content: `Error: ${errMsg}` },
          ]);
          showToast(errMsg, "error");
          break;
        }
      }
    }
  }, [chatInput, applying, prdContent, codeOutputDir, showToast, onPencilUpdated]);

  const showChatStrip = chatFocused || applying;

  return (
    <div className="flex flex-col gap-0">
      {/* Pencil design summary panel */}
      <div className="rounded-2xl border border-zinc-200/90 bg-white shadow-[0_4px_24px_-4px_rgba(15,23,42,0.08)]">
        <div className="border-b border-zinc-100 px-6 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#7c3aed"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <h3 className="text-[13px] font-semibold text-zinc-900">
              Pencil Design
            </h3>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
              .pen file
            </span>
          </div>
        </div>

        <div className="px-6 py-5">
          {content ? (
            <div className="max-h-[320px] overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50 p-4 font-mono text-[12px] leading-relaxed text-zinc-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {content}
            </div>
          ) : (
            <p className="text-[13px] text-zinc-500">No Pencil design summary available.</p>
          )}

          {artifactUrls.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Exported screens</p>
              {artifactUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[12px] text-indigo-600 hover:underline truncate"
                >
                  {url}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-100 bg-zinc-50/60 px-6 py-3">
          <p className="text-[11px] text-zinc-500">
            Use the chat below to describe design changes. The AI will modify the{" "}
            <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-[10px]">
              .pen
            </code>{" "}
            file directly using Pencil MCP tools.
          </p>
        </div>
      </div>

      {/* AI chat — same collapsible pattern as PRD review */}
      <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <AnimatePresence initial={false}>
          {showChatStrip && (
            <motion.div
              key="pencil-strip"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden border-b border-zinc-200 bg-zinc-50"
            >
              <div
                role="region"
                aria-label="Pencil design thread"
                className="max-h-[min(260px,34vh)] overflow-y-auto px-3 py-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400 [&::-webkit-scrollbar-track]:bg-zinc-100 [&::-webkit-scrollbar]:w-1.5"
                onMouseDown={(e) => e.preventDefault()}
              >
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Design AI
                </p>
                {chatHistory.length === 0 && !applying && (
                  <p className="text-center text-[11px] text-zinc-400">
                    Describe your design change and press Apply.
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
                {applying && progressLines.length > 0 && (
                  <div className="mb-2 rounded-lg border border-zinc-200 bg-white p-2">
                    <div className="space-y-0.5 font-mono text-[10px] text-zinc-500">
                      {progressLines.slice(-6).map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  </div>
                )}
                {applying && (
                  <div className="flex justify-start pb-1">
                    <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5">
                      <Loading size="sm" text="Applying to Pencil…" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
                void handleApply();
              }
            }}
            placeholder="Describe a design change to apply…"
            disabled={applying}
            className="h-[42px] min-w-0 flex-1 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-40"
          />
          <button
            onClick={() => void handleApply()}
            disabled={applying || !chatInput.trim()}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Toast */}
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
