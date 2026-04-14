"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import Loading from "@/components/Loading";

type ServerStatus = "stopped" | "starting" | "running" | "error";

interface ServerInfo {
  status: ServerStatus;
  port: number | null;
  url: string | null;
  logs: string[];
  error?: string;
}

export default function PreviewPanel({ codeOutputDir }: { codeOutputDir: string }) {
  const [info, setInfo] = useState<ServerInfo>({ status: "stopped", port: null, url: null, logs: [] });
  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch("/api/agents/preview-server");
      if (resp.ok) {
        const data = await resp.json();
        setInfo(data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  useEffect(() => {
    if (info.status === "starting") {
      if (!pollRef.current) {
        pollRef.current = setInterval(fetchStatus, 2000);
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [info.status, fetchStatus]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [info.logs]);

  const handleAction = async (action: "start" | "stop" | "restart") => {
    setLoading(true);
    try {
      const resp = await fetch("/api/agents/preview-server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, codeOutputDir }),
      });
      const data = await resp.json();
      if (data.error) {
        setInfo((prev) => ({ ...prev, status: "error", logs: [...prev.logs, `Error: ${data.error}`] }));
      } else {
        setInfo(data);
        if (action === "start" || action === "restart") {
          setIframeKey((k) => k + 1);
        }
      }
    } catch (err) {
      setInfo((prev) => ({ ...prev, status: "error" }));
    } finally {
      setLoading(false);
      fetchStatus();
    }
  };

  const isRunning = info.status === "running";
  const isStarting = info.status === "starting";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-11 flex-shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50/60 px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${
              isRunning ? "bg-emerald-500" :
              isStarting ? "bg-amber-500 animate-pulse" :
              info.status === "error" ? "bg-red-500" : "bg-zinc-300"
            }`} />
            <span className="text-xs font-medium text-zinc-600">
              {isRunning ? "Running" : isStarting ? "Starting..." : info.status === "error" ? "Error" : "Stopped"}
            </span>
          </div>
          {info.url && isRunning && (
            <a
              href={info.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700"
            >
              {info.url}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!isRunning && !isStarting && (
            <button
              onClick={() => handleAction("start")}
              disabled={loading}
              className="flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Start
            </button>
          )}
          {(isRunning || isStarting) && (
            <>
              <button
                onClick={() => handleAction("restart")}
                disabled={loading}
                className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M23 4v6h-6" />
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </svg>
                Restart
              </button>
              <button
                onClick={() => handleAction("stop")}
                disabled={loading}
                className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-red-500">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </button>
            </>
          )}
          {isRunning && (
            <button
              onClick={() => setIframeKey((k) => k + 1)}
              className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
              </svg>
              Reload
            </button>
          )}
          <button
            onClick={() => setShowLogs(!showLogs)}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              showLogs ? "border-zinc-300 bg-zinc-100 text-zinc-700" : "border-zinc-200 text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
            Logs
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Preview iframe */}
        <div className="flex-1">
          {isRunning && info.url ? (
            <iframe
              key={iframeKey}
              src={info.url}
              className="h-full w-full border-0"
              title="App Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          ) : isStarting ? (
            <div className="flex h-full items-center justify-center bg-zinc-50">
              <Loading size="lg" text="Starting dev server..." />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-zinc-50">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-700">Preview</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {info.status === "error"
                    ? "Failed to start. Check logs for details."
                    : "Start the dev server to preview your generated app."}
                </p>
              </div>
              <button
                onClick={() => handleAction("start")}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Start Dev Server
              </button>
            </div>
          )}
        </div>

        {/* Logs panel */}
        <AnimatePresence>
          {showLogs && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col overflow-hidden border-l border-zinc-200 bg-zinc-900"
            >
              <div className="flex h-8 items-center justify-between border-b border-zinc-700 px-3">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Server Logs</span>
                <button
                  onClick={() => setShowLogs(false)}
                  className="text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed text-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1">
                {info.logs.length === 0 ? (
                  <p className="text-zinc-600">No logs yet.</p>
                ) : (
                  info.logs.map((line, i) => (
                    <p key={i} className={line.startsWith("[preview]") ? "text-emerald-400" : "text-zinc-400"}>
                      {line}
                    </p>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
