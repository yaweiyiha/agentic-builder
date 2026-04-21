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

export default function PrdReviewPanel({
  currentPrd,
  classification: _classification,
}: PrdReviewPanelProps) {
  return (
    <div
      className="mx-auto min-h-0 h-full w-full max-w-5xl overflow-y-auto px-2 py-2 sm:px-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600 [&::-webkit-scrollbar-track]:bg-zinc-950 [&::-webkit-scrollbar]:w-2"
      role="article"
      aria-label="PRD content"
    >
      <MarkdownRenderer content={currentPrd} variant="prd" />
    </div>
  );
}
