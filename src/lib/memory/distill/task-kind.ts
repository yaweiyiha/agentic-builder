/**
 * Map pipeline stepIds to a coarse task-kind label. Used as a bucketing
 * key for memory metrics so we can answer "does memory help codegen tasks
 * more than qa tasks?".
 *
 * The mapping is intentionally lossy: many distinct stepIds collapse into
 * a single kind because at this granularity ("does memory help here?") the
 * sub-step distinctions don't matter. If a stepId doesn't match any rule,
 * we fall back to its prefix before the first `-` or `:`, which keeps it
 * reasonably stable without hardcoding every possible id.
 */

export type TaskKind =
  | "intent"
  | "prd"
  | "trd"
  | "design"
  | "qa"
  | "verify"
  | "kickoff"
  | "codegen"
  | "self-heal"
  | "test"
  | "report"
  | "other";

interface Rule {
  kind: TaskKind;
  re: RegExp;
}

const RULES: readonly Rule[] = [
  { kind: "intent", re: /^(intent|brief|classification)\b/i },
  { kind: "prd", re: /\b(prd|requirements)\b/i },
  { kind: "trd", re: /\b(trd|tech-design|sysdesign|system-design)\b/i },
  { kind: "design", re: /\b(design|pencil|tokens|figma)\b/i },
  { kind: "qa", re: /\b(qa|review-prd|review-design)\b/i },
  { kind: "verify", re: /\b(verify|verifier)\b/i },
  { kind: "kickoff", re: /\b(kickoff|task-breakdown|architect|scaffold)\b/i },
  { kind: "self-heal", re: /\b(self-?heal|repair|tsc-fix|smoke-gate|runtime-(?:audit|integration)|contract-(?:audit|coverage))\b/i },
  { kind: "test", re: /\b(test|e2e|playwright|smoke)\b/i },
  { kind: "codegen", re: /\b(codegen|coding|worker|frontend|backend|tests?-task)\b/i },
  { kind: "report", re: /\b(report|summary|leaderboard)\b/i },
];

export function inferTaskKind(stepId: string | undefined | null): TaskKind {
  if (!stepId) return "other";
  for (const r of RULES) {
    if (r.re.test(stepId)) return r.kind;
  }
  return "other";
}

/**
 * Stable bucket key for (taskKind, failureMode, injectState) tuples. Used
 * as the key in metric aggregations so callers can iterate buckets in a
 * deterministic order.
 */
export function bucketKey(
  taskKind: string,
  failureMode: string,
  injectState: "on" | "off",
): string {
  return `${taskKind}|${failureMode}|${injectState}`;
}
