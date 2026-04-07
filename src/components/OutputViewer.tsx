"use client";

import { motion, AnimatePresence } from "motion/react";

interface OutputViewerProps {
  title: string;
  content: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function OutputViewer({
  title,
  content,
  isOpen,
  onClose,
}: OutputViewerProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-8 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border-[1.5px] border-[var(--border)] bg-[var(--card)] shadow-lg shadow-zinc-900/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {title}
              </h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto p-6">
              <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-[var(--foreground)]">
                {content}
              </pre>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
