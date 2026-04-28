/**
 * Repair-log miner — turn raw RepairEvent stream into clustered
 * failure-pattern seeds.
 *
 * Clustering signature: (stage, event). Each cluster with ≥minCluster
 * occurrences yields one MinedPattern. Patterns default to score=0 so
 * they enter Layer 3 (shadow) per the 3-layer architecture (design doc
 * §12.7); promotion to active requires manual approval or auto-scoring
 * from outcome attribution (Phase C-4).
 *
 * Pure function — no I/O. CLI wrapper in scripts/memory-mine-patterns.ts
 * handles file reading and memory writing.
 */

import type { RepairEvent } from "@/lib/pipeline/self-heal/events";

export type PatternCategory =
  /** Self-heal succeeded most of the time — recovery metric, not a failure
   *  to teach the LLM. Suggested action: Disapprove or Delete. */
  | "success-metric"
  /** Status snapshot / dispatch confirmation / audit-clean — pure
   *  notification, no learning signal. Suggested action: Disapprove. */
  | "broadcast"
  /** Real recurring failure with either rich `details.reason` data or a
   *  clear failure event name. Suggested action: Edit "How to avoid"
   *  then Approve. */
  | "real-failure"
  /** Cannot classify automatically. Suggested action: Review manually. */
  | "ambiguous";

export interface MinedPattern {
  /** Deterministic id: FP-mined-<stage>-<event>. Re-mining is idempotent. */
  id: string;
  title: string;
  /** Markdown body — template depends on category. */
  body: string;
  tags: string[];
  /** Auto-classified pattern nature; surfaces as `category:*` tag. */
  category: PatternCategory;
  /** Cluster size (number of events that contributed). */
  occurrences: number;
  /** Number of distinct sessions/runs the pattern appeared in. */
  sessions: number;
  outcomes: { fixed: number; progress: number; gaveUp: number; other: number };
  /** Top file extensions touched across the cluster. */
  topExtensions: string[];
}

export interface MineOptions {
  /** Minimum occurrences for a cluster to produce a pattern. Default 2. */
  minCluster?: number;
  /** Maximum patterns to return (after sorting by occurrences desc). */
  limit?: number;
}

interface ClusterAccumulator {
  stage: string;
  event: string;
  events: RepairEvent[];
  fileExts: Map<string, number>;
  sessions: Set<string>;
  outcomes: { fixed: number; progress: number; gaveUp: number; other: number };
  reasons: Map<string, number>;
  taskTitles: Set<string>;
}

export function minePatternsFromRepairLog(
  events: RepairEvent[],
  opts: MineOptions = {},
): MinedPattern[] {
  const minCluster = opts.minCluster ?? 2;
  const clusters = new Map<string, ClusterAccumulator>();

  for (const ev of events) {
    if (!isLearningSignal(ev)) continue;
    const key = `${ev.stage}::${ev.event}`;
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        stage: ev.stage,
        event: ev.event,
        events: [] as RepairEvent[],
        fileExts: new Map<string, number>(),
        sessions: new Set<string>(),
        outcomes: { fixed: 0, progress: 0, gaveUp: 0, other: 0 },
        reasons: new Map<string, number>(),
        taskTitles: new Set<string>(),
      };
      clusters.set(key, cluster);
    }

    cluster.events.push(ev);
    bumpOutcome(cluster.outcomes, classify(ev));
    if (ev.sessionId) cluster.sessions.add(ev.sessionId);
    else if (ev.runId) cluster.sessions.add(ev.runId);

    for (const f of ev.files ?? []) {
      const m = f.match(/\.([a-z0-9]+)$/i);
      if (m) {
        const ext = m[1]!.toLowerCase();
        cluster.fileExts.set(ext, (cluster.fileExts.get(ext) ?? 0) + 1);
      }
    }
    const reason = ev.details?.reason;
    if (typeof reason === "string" && reason.trim()) {
      cluster.reasons.set(reason, (cluster.reasons.get(reason) ?? 0) + 1);
    }
    const title = ev.details?.title;
    if (typeof title === "string" && title.trim()) {
      cluster.taskTitles.add(title);
    }
  }

  const patterns: MinedPattern[] = [];
  for (const c of clusters.values()) {
    if (c.events.length < minCluster) continue;
    patterns.push(buildPattern(c));
  }

  patterns.sort((a, b) => b.occurrences - a.occurrences);
  return opts.limit ? patterns.slice(0, opts.limit) : patterns;
}

function isLearningSignal(ev: RepairEvent): boolean {
  const eventName = (ev.event || "").toLowerCase();
  const isStart = /(^|_)start$/.test(eventName);
  const repairedCount = ev.repairedIds?.length ?? 0;
  const stillMissing = ev.stillMissing?.length ?? 0;
  const fileCount = ev.files?.length ?? 0;
  const detailsCount = ev.details ? Object.keys(ev.details).length : 0;
  if (isStart && repairedCount === 0 && fileCount === 0) return false;
  return repairedCount > 0 || stillMissing > 0 || fileCount > 0 || detailsCount > 0;
}

function classify(
  ev: RepairEvent,
): "fixed" | "progress" | "gaveUp" | "other" {
  const repairedCount = ev.repairedIds?.length ?? 0;
  const stillMissing = ev.stillMissing?.length ?? 0;
  const eventName = (ev.event || "").toLowerCase();
  if (repairedCount > 0 && stillMissing === 0) return "fixed";
  if (repairedCount > 0 && stillMissing > 0) return "progress";
  const isFinal =
    /(final|exhausted|gave?_?up|abandon)/.test(eventName) ||
    eventName === "repair_final_state";
  if (isFinal && stillMissing > 0) return "gaveUp";
  return "other";
}

function bumpOutcome(
  bucket: ClusterAccumulator["outcomes"],
  outcome: "fixed" | "progress" | "gaveUp" | "other",
): void {
  bucket[outcome] += 1;
}

function buildPattern(c: ClusterAccumulator): MinedPattern {
  const id = `FP-mined-${slug(c.stage)}-${slug(c.event)}`;
  const topExtensions = Array.from(c.fileExts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext]) => ext);
  const reasonsRanked = Array.from(c.reasons.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const titleHint = reasonsRanked[0]?.[0]
    ? truncate(reasonsRanked[0][0], 60)
    : c.event;
  const title = `${c.stage} · ${titleHint}`;
  const category = classifyPatternNature(c, reasonsRanked.length);

  const body = renderMarkdown(c, reasonsRanked, topExtensions, category);
  const tags = [
    "mined",
    `stage:${c.stage}`,
    `event:${c.event}`,
    `category:${category}`,
    ...topExtensions.map((ext) => `ext:${ext}`),
  ];
  return {
    id,
    title,
    body,
    tags,
    category,
    occurrences: c.events.length,
    sessions: c.sessions.size,
    outcomes: { ...c.outcomes },
    topExtensions,
  };
}

/**
 * Classify a cluster into one of four categories based on its outcomes,
 * event name, and richness of `details.reason` data. The category drives
 * both the markdown template and the UI suggestion banner.
 */
export function classifyPatternNature(
  c: ClusterAccumulator,
  reasonsCount: number,
): PatternCategory {
  const total = c.events.length;
  const { fixed, progress, gaveUp, other } = c.outcomes;
  const eventName = c.event.toLowerCase();

  // 1. Pure status broadcasts — no learning signal regardless of frequency
  if (
    /(_snapshot|audit_clean|dispatch_done|dispatch_role_done|autorepaired|installed|applied|trimmed)/.test(
      eventName,
    )
  ) {
    return "broadcast";
  }

  // 2. Recovery metric — self-heal succeeded most of the time
  if (fixed > 0 && fixed / total >= 0.6 && gaveUp === 0) {
    return "success-metric";
  }

  // 3. Real failure — clear failure-signal event name OR explicit gave_up
  //    OR the cluster carries rich `details.reason` data we can teach from
  if (
    gaveUp > 0 ||
    /(truncated|stagnation|unfulfilled|task_forced|fail|exhausted|abandon|gave_up|missing)/.test(
      eventName,
    ) ||
    reasonsCount > 0
  ) {
    return "real-failure";
  }

  // (progress / other counts are surfaced in the body but don't drive
  //  classification on their own.)
  void progress;
  void other;

  // 4. Default — couldn't classify; let the human decide
  return "ambiguous";
}

function renderMarkdown(
  c: ClusterAccumulator,
  reasonsRanked: Array<[string, number]>,
  topExtensions: string[],
  category: PatternCategory,
): string {
  switch (category) {
    case "success-metric":
      return renderSuccessMetric(c, topExtensions);
    case "broadcast":
      return renderBroadcast(c, topExtensions);
    case "real-failure":
      return renderRealFailure(c, reasonsRanked, topExtensions);
    case "ambiguous":
    default:
      return renderAmbiguous(c, topExtensions);
  }
}

function renderSuccessMetric(
  c: ClusterAccumulator,
  topExtensions: string[],
): string {
  const total = c.events.length;
  const lines: string[] = [];
  lines.push(`# ${c.stage} — ${c.event}`);
  lines.push("");
  lines.push("## What this records");
  lines.push(
    `Self-heal **successfully repaired** \`${c.stage}\` issues in **${c.outcomes.fixed} of ${total}** attempts. This is a **recovery metric**, not a failure pattern.`,
  );
  lines.push("");
  lines.push("## Recommended action");
  lines.push(
    "🔴 **Disapprove or Delete.** Recovery metrics don't teach the LLM how to avoid anything — they describe the self-heal system working as designed. Injecting this would waste prompt budget without actionable advice.",
  );
  lines.push("");
  appendStats(lines, c, topExtensions);
  return lines.join("\n");
}

function renderBroadcast(
  c: ClusterAccumulator,
  topExtensions: string[],
): string {
  const lines: string[] = [];
  lines.push(`# ${c.stage} — ${c.event}`);
  lines.push("");
  lines.push("## What this records");
  lines.push(
    `Stage \`${c.stage}\` emitted \`${c.event}\` notifications **${c.events.length}** times. This is a **status broadcast** (snapshot, dispatch confirmation, audit-clean, autorepair completion), not a failure to learn from.`,
  );
  lines.push("");
  lines.push("## Recommended action");
  lines.push(
    "🔴 **Disapprove.** Status broadcasts don't represent avoidable failures.",
  );
  lines.push("");
  appendStats(lines, c, topExtensions);
  return lines.join("\n");
}

function renderRealFailure(
  c: ClusterAccumulator,
  reasonsRanked: Array<[string, number]>,
  topExtensions: string[],
): string {
  const lines: string[] = [];
  lines.push(`# ${c.stage} — ${c.event}`);
  lines.push("");
  lines.push("## What this records");
  const gaveUpNote =
    c.outcomes.gaveUp > 0
      ? ` **${c.outcomes.gaveUp}** ended in \`gave_up\` — these are real unrecovered failures worth preventing.`
      : "";
  lines.push(
    `Stage \`${c.stage}\` triggered \`${c.event}\` **${c.events.length}** times across ${c.sessions.size} session(s).${gaveUpNote}`,
  );
  lines.push("");
  lines.push("## Symptoms");
  if (reasonsRanked.length > 0) {
    lines.push("Top reasons captured in past events:");
    lines.push("");
    for (const [reason, count] of reasonsRanked) {
      lines.push(`- (×${count}) ${reason}`);
    }
  } else {
    lines.push(
      "_No structured reasons in raw events — please describe based on your project knowledge._",
    );
  }
  lines.push("");
  lines.push("## How to avoid (FILL IN)");
  lines.push(
    "> ⚠️ This section is the actual content the LLM will see. Write specific, actionable guidance:",
  );
  lines.push(">");
  lines.push("> - Describe the trigger condition (e.g., \"when task references files outside scaffold protected paths\")");
  lines.push("> - Give the prevention rule (e.g., \"check `scaffolds/<tier>/` before listing creates\")");
  lines.push("> - Mention any task-type / stack signals that flag this pattern");
  lines.push("");
  lines.push("## Recommended action");
  lines.push(
    `🟢 **Edit "How to avoid" with project-specific guidance, then Approve.** ${c.events.length} occurrences indicate this is a real recurring problem.`,
  );
  lines.push("");
  if (c.taskTitles.size > 0) {
    lines.push("## Sample task titles");
    for (const title of Array.from(c.taskTitles).slice(0, 3)) {
      lines.push(`- ${title}`);
    }
    lines.push("");
  }
  appendStats(lines, c, topExtensions);
  return lines.join("\n");
}

function renderAmbiguous(
  c: ClusterAccumulator,
  topExtensions: string[],
): string {
  const lines: string[] = [];
  lines.push(`# ${c.stage} — ${c.event}`);
  lines.push("");
  lines.push("## What this records");
  lines.push(
    `Stage \`${c.stage}\` emitted \`${c.event}\` **${c.events.length}** times. The cluster lacks clear classification signals (no rich reasons, no fix/give-up split, no obvious failure keyword in the event name).`,
  );
  lines.push("");
  lines.push("## Recommended action");
  lines.push(
    "🟡 **Review manually based on your knowledge of this stage:**",
  );
  lines.push(
    "- If it's a recovery / notification — **Disapprove**",
  );
  lines.push(
    "- If it's a real failure the LLM could avoid — **Edit `How to avoid` (add the section), then Approve**",
  );
  lines.push(
    "- Otherwise — **Disapprove** for now; revisit when richer event data accumulates",
  );
  lines.push("");
  appendStats(lines, c, topExtensions);
  return lines.join("\n");
}

function appendStats(
  lines: string[],
  c: ClusterAccumulator,
  topExtensions: string[],
): void {
  lines.push("## Raw stats");
  lines.push(`- Stage: \`${c.stage}\` · Event: \`${c.event}\``);
  lines.push(`- ${c.events.length} occurrences across ${c.sessions.size} session(s)`);
  lines.push(
    `- Outcomes: fixed=${c.outcomes.fixed}, progress=${c.outcomes.progress}, gave_up=${c.outcomes.gaveUp}, other=${c.outcomes.other}`,
  );
  if (topExtensions.length) {
    lines.push(
      `- File types touched: ${topExtensions.map((e) => "`." + e + "`").join(", ")}`,
    );
  }
  lines.push("");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
