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

export interface MinedPattern {
  /** Deterministic id: FP-mined-<stage>-<event>. Re-mining is idempotent. */
  id: string;
  title: string;
  /** Markdown body with Symptoms / Pattern / Frequency / Sample sections. */
  body: string;
  tags: string[];
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
    const cluster =
      clusters.get(key) ??
      ({
        stage: ev.stage,
        event: ev.event,
        events: [],
        fileExts: new Map(),
        sessions: new Set(),
        outcomes: { fixed: 0, progress: 0, gaveUp: 0, other: 0 },
        reasons: new Map(),
        taskTitles: new Set(),
      } satisfies ClusterAccumulator);
    clusters.set(key, cluster);

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

  const body = renderMarkdown(c, reasonsRanked, topExtensions);
  const tags = [
    "mined",
    `stage:${c.stage}`,
    `event:${c.event}`,
    ...topExtensions.map((ext) => `ext:${ext}`),
  ];
  return {
    id,
    title,
    body,
    tags,
    occurrences: c.events.length,
    sessions: c.sessions.size,
    outcomes: { ...c.outcomes },
    topExtensions,
  };
}

function renderMarkdown(
  c: ClusterAccumulator,
  reasonsRanked: Array<[string, number]>,
  topExtensions: string[],
): string {
  const lines: string[] = [];
  lines.push(`# ${c.stage} — ${c.event}`);
  lines.push("");
  lines.push("## Symptoms");
  if (reasonsRanked.length > 0) {
    lines.push("Recurring reasons observed in self-heal events:");
    lines.push("");
    for (const [reason, count] of reasonsRanked) {
      lines.push(`- (×${count}) ${reason}`);
    }
  } else {
    lines.push(
      `No structured reasons captured. Self-heal stage \`${c.stage}\` triggered \`${c.event}\` repeatedly.`,
    );
  }
  lines.push("");
  lines.push("## Pattern");
  lines.push(`- Stage: \`${c.stage}\``);
  lines.push(`- Event: \`${c.event}\``);
  if (topExtensions.length) {
    lines.push(`- File types touched: ${topExtensions.map((e) => "`." + e + "`").join(", ")}`);
  }
  lines.push("");
  lines.push("## Frequency");
  lines.push(`- ${c.events.length} occurrences across ${c.sessions.size} session(s)`);
  lines.push(
    `- Outcomes: fixed=${c.outcomes.fixed}, progress=${c.outcomes.progress}, gave_up=${c.outcomes.gaveUp}, other=${c.outcomes.other}`,
  );
  lines.push("");
  if (c.taskTitles.size > 0) {
    lines.push("## Sample task titles");
    for (const title of Array.from(c.taskTitles).slice(0, 3)) {
      lines.push(`- ${title}`);
    }
    lines.push("");
  }
  lines.push("## Status");
  lines.push(
    "Mined automatically from repair-log. Default score = 0 (Layer 3 shadow). Approve via `npm run memory:approve <id>` or wait for outcome attribution to promote it.",
  );
  lines.push("");
  return lines.join("\n");
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
