"use client";

import type { MemoryRecord } from "@/lib/memory/types";

type Suggestion = {
  /** Card color theme. */
  tone: "danger" | "warning" | "good" | "neutral";
  /** Short headline (one-liner). */
  headline: string;
  /** Longer rationale shown below the headline. */
  rationale: string;
  /** Concrete next-step prompts shown as a bullet list. */
  steps: string[];
};

/**
 * Derive a recommendation for a memory record so the user can decide
 * approve / disapprove / edit at-a-glance.
 *
 * Source of truth: the `category:*` tag attached by the miner. We fall
 * back to weaker heuristics for hand-written or pre-category records.
 */
export function suggestForRecord(record: MemoryRecord): Suggestion | null {
  if (record.kind !== "failure-pattern") return null;

  const category = extractCategory(record.tags);
  const approved = record.tags.includes("manual:approved");

  // Approved patterns don't need a banner — they've already been vouched for.
  if (approved) return null;

  switch (category) {
    case "success-metric":
      return {
        tone: "danger",
        headline: "🔴 Suggested: Disapprove or Delete",
        rationale:
          "This is a self-heal recovery metric, not a failure to teach the LLM. Injecting it into prompts wastes token budget without giving any actionable advice.",
        steps: [
          "Click Disapprove (keeps record but never recalled)",
          "OR click Delete to remove it entirely",
        ],
      };
    case "broadcast":
      return {
        tone: "danger",
        headline: "🔴 Suggested: Disapprove",
        rationale:
          "This is a status broadcast (snapshot / dispatch confirmation / audit-clean / autorepair). Status events don't represent avoidable failures.",
        steps: ["Click Disapprove — keeps record visible but excluded from recall"],
      };
    case "real-failure":
      return {
        tone: "good",
        headline: "🟢 Suggested: Edit then Approve",
        rationale:
          "This represents a real recurring failure. Add a project-specific 'How to avoid' section so the LLM can use it as preventive guidance.",
        steps: [
          "Click Edit and fill in the 'How to avoid' section with concrete rules",
          "Then click Approve — score will jump to 0.5 (active layer)",
        ],
      };
    case "ambiguous":
      return {
        tone: "warning",
        headline: "🟡 Suggested: Review manually",
        rationale:
          "The cluster lacks clear classification signals. Decide based on your knowledge of this stage.",
        steps: [
          "If it's a recovery / notification → Disapprove",
          "If it's a real preventable failure → Edit + Approve",
          "Otherwise Disapprove for now and revisit later",
        ],
      };
  }

  // Hand-written or unclassified record — no strong recommendation.
  return null;
}

function extractCategory(tags: string[]): string | null {
  const t = tags.find((x) => x.startsWith("category:"));
  return t ? t.slice("category:".length) : null;
}

const TONE_STYLES: Record<Suggestion["tone"], { wrap: string; head: string }> = {
  danger: {
    wrap: "border-rose-200 bg-rose-50",
    head: "text-rose-800",
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50",
    head: "text-amber-800",
  },
  good: {
    wrap: "border-emerald-200 bg-emerald-50",
    head: "text-emerald-800",
  },
  neutral: {
    wrap: "border-gray-200 bg-gray-50",
    head: "text-gray-800",
  },
};

export default function SuggestionBanner({ record }: { record: MemoryRecord }) {
  const suggestion = suggestForRecord(record);
  if (!suggestion) return null;
  const styles = TONE_STYLES[suggestion.tone];

  return (
    <div className={`mt-4 rounded-md border px-4 py-3 ${styles.wrap}`}>
      <div className={`text-sm font-semibold ${styles.head}`}>
        {suggestion.headline}
      </div>
      <p className="mt-1 text-xs text-[var(--foreground)]/80">
        {suggestion.rationale}
      </p>
      {suggestion.steps.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-[var(--foreground)]/80">
          {suggestion.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
