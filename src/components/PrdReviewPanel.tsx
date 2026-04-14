"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import MarkdownRenderer from "./MarkdownRenderer";

export interface PrdReviewChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface PrdReviewPanelProps {
  currentPrd: string;
  classification?: {
    tier: string;
    type: string;
    reasoning: string;
  };
}

const TIER_STYLES: Record<
  string,
  { ring: string; bg: string; text: string; label: string }
> = {
  S: {
    ring: "ring-emerald-500/30",
    bg: "bg-emerald-950/50",
    text: "text-emerald-300",
    label: "S · Focused scope",
  },
  M: {
    ring: "ring-amber-500/30",
    bg: "bg-amber-950/40",
    text: "text-amber-200",
    label: "M · Standard product",
  },
  L: {
    ring: "ring-zinc-500/40",
    bg: "bg-zinc-900/80",
    text: "text-zinc-200",
    label: "L · Enterprise breadth",
  },
};

export default function PrdReviewPanel({
  currentPrd,
  classification,
}: PrdReviewPanelProps) {
  const tierStyle = classification
    ? TIER_STYLES[classification.tier] ?? TIER_STYLES.M
    : null;

  const docDate = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    [],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5">
      <motion.header
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="shrink-0 rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-950 p-6 shadow-xl shadow-black/20 ring-1 ring-white/5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Product requirements
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-100 sm:text-xl">
              Product Requirements Document
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Working draft for stakeholder review — confirm scope, acceptance
              criteria, and priorities before TRD, design, and implementation.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
              Draft for review
            </span>
            <span className="text-xs text-zinc-500">{docDate}</span>
          </div>
        </div>

        {classification && tierStyle && (
          <div
            className={`mt-5 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1 ${tierStyle.ring} ${tierStyle.bg}`}
          >
            <span
              className={`rounded-md bg-black/30 px-2 py-0.5 text-[11px] font-bold ${tierStyle.text}`}
            >
              Tier {classification.tier}
            </span>
            <span className={`text-sm font-medium ${tierStyle.text}`}>
              {tierStyle.label}
            </span>
            <span className="hidden h-4 w-px bg-zinc-600 sm:block" />
            <span className="text-xs leading-snug text-zinc-400">
              {classification.type}
            </span>
            <span className="w-full text-[11px] leading-relaxed text-zinc-500 sm:w-auto sm:pl-2">
              {classification.reasoning}
            </span>
          </div>
        )}
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut", delay: 0.05 }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950 shadow-2xl shadow-black/25 ring-1 ring-white/[0.04]"
      >
        <div className="border-b border-zinc-800/80 bg-zinc-900/50 px-5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Document body
            </span>
            <span className="text-[10px] text-zinc-600">
              Markdown · scroll to read
            </span>
          </div>
        </div>
        <div
          className="min-h-[min(56vh,calc(100vh-18rem))] flex-1 overflow-y-auto px-5 py-8 sm:px-10 sm:py-10 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-track]:bg-zinc-950 [&::-webkit-scrollbar]:w-2"
          role="article"
          aria-label="PRD content"
        >
          <MarkdownRenderer content={currentPrd} variant="prd" />
        </div>
      </motion.div>
    </div>
  );
}
