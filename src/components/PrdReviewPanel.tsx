"use client";

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

const TIER_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  S: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", label: "Simple" },
  M: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "Standard" },
  L: { bg: "bg-zinc-100 border-zinc-300", text: "text-zinc-700", label: "Enterprise" },
};

export default function PrdReviewPanel({
  currentPrd,
  classification,
}: PrdReviewPanelProps) {
  const tierStyle = classification
    ? TIER_STYLES[classification.tier] ?? TIER_STYLES.M
    : null;

  return (
    <div className="flex h-full flex-col gap-4">
      {classification && tierStyle && (
        <div className={`inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-1.5 ${tierStyle.bg}`}>
          <span className={`text-xs font-bold ${tierStyle.text}`}>
            Tier {classification.tier}
          </span>
          <span className="text-[10px] text-zinc-400">|</span>
          <span className={`text-[11px] font-medium ${tierStyle.text}`}>
            {tierStyle.label} &middot; {classification.type}
          </span>
          <span className="text-[10px] text-zinc-400">|</span>
          <span className="text-[10px] text-zinc-500">{classification.reasoning}</span>
        </div>
      )}

      <div className="max-h-[min(56vh,calc(100vh-16rem))] min-h-[200px] flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-6 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
        <MarkdownRenderer content={currentPrd} />
      </div>
    </div>
  );
}
