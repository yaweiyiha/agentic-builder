/**
 * Aggregate task outcomes by (taskKind × failureMode × injectState) buckets.
 *
 * Goal: answer "did memory injection actually help on this kind of task?"
 * with per-bucket numbers, instead of a single global success rate.
 *
 * Pure function: takes already-loaded trace events and task-history records;
 * returns a structure ready to write to metrics-by-bucket.json.
 */

import type { TraceEvent } from "../trace";
import type { MemoryRecord } from "../types";
import { bucketKey, inferTaskKind } from "./task-kind";
import { classifyFailureMode } from "./failure-mode";

export interface BucketKeyParts {
  taskKind: string;
  failureMode: string; // "none" for successes
  injectState: "on" | "off";
}

export interface BucketCounts {
  total: number;
  success: number;
  failure: number;
  /** Sum of injected pattern ids encountered in this bucket (for size sense). */
  injectedPatterns: number;
}

export interface BucketRow extends BucketKeyParts, BucketCounts {
  key: string;
  successRate: number; // success / total, or 0 when total === 0
}

/** Side-by-side comparison: same (taskKind, failureMode), inject-on vs off. */
export interface InjectComparisonRow {
  taskKind: string;
  failureMode: string;
  on: BucketCounts & { successRate: number };
  off: BucketCounts & { successRate: number };
  /** on.successRate - off.successRate. Positive = inject helps. */
  delta: number;
}

export interface AggregateResult {
  buckets: BucketRow[];
  comparisons: InjectComparisonRow[];
  stats: {
    taskHistoryConsidered: number;
    terminalTasks: number;
    nonTerminalSkipped: number;
    injectEventsConsidered: number;
  };
}

interface InjectInfo {
  injected: boolean;
  injectedCount: number;
}

const TERMINAL = new Set(["completed", "failed"]);

function readBody(rec: MemoryRecord): {
  status?: string;
  taskKind?: string;
  failureMode?: string;
  errorMessage?: string;
} {
  try {
    return JSON.parse(rec.body) as Record<string, never>;
  } catch {
    return {};
  }
}

/**
 * Build per-(kickoff,task) injection lookup. Counts the *first* inject event
 * per pair — second-pass recall events are folded in via injected count.
 */
function buildInjectLookup(events: TraceEvent[]): {
  map: Map<string, InjectInfo>;
  considered: number;
} {
  const map = new Map<string, InjectInfo>();
  let considered = 0;
  for (const ev of events) {
    if (ev.op !== "inject" && ev.op !== "reinject") continue;
    if (!ev.kickoffId || !ev.taskId) continue;
    considered++;
    const det = ev.details as
      | { injected?: boolean; activeIds?: unknown }
      | undefined;
    const injected = det?.injected === true;
    const injectedCount =
      injected && Array.isArray(det?.activeIds) ? det.activeIds.length : 0;
    const key = `${ev.kickoffId}::${ev.taskId}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { injected, injectedCount });
    } else {
      // OR-merge: any inject across the lifetime counts as on.
      map.set(key, {
        injected: prev.injected || injected,
        injectedCount: prev.injectedCount + injectedCount,
      });
    }
  }
  return { map, considered };
}

export function aggregateByBucket(
  traceEvents: TraceEvent[],
  taskHistory: MemoryRecord[],
): AggregateResult {
  const { map: injectLookup, considered: injectEvents } =
    buildInjectLookup(traceEvents);

  const counts = new Map<string, BucketRow>();
  let terminalTasks = 0;
  let nonTerminalSkipped = 0;

  for (const th of taskHistory) {
    const kickoffId = th.refs.kickoffId;
    const taskId = th.refs.taskId;
    if (!kickoffId || !taskId) continue;

    const body = readBody(th);
    const status = body.status;
    if (!status || !TERMINAL.has(status)) {
      nonTerminalSkipped++;
      continue;
    }
    terminalTasks++;

    const taskKind = body.taskKind ?? inferTaskKind(taskId);
    const failureMode =
      status === "failed"
        ? body.failureMode ?? classifyFailureMode(body.errorMessage)
        : "none";

    const inj = injectLookup.get(`${kickoffId}::${taskId}`);
    const injectState: "on" | "off" = inj?.injected ? "on" : "off";

    const key = bucketKey(taskKind, failureMode, injectState);
    const row =
      counts.get(key) ??
      ({
        key,
        taskKind,
        failureMode,
        injectState,
        total: 0,
        success: 0,
        failure: 0,
        injectedPatterns: 0,
        successRate: 0,
      } satisfies BucketRow);
    row.total++;
    if (status === "completed") row.success++;
    else row.failure++;
    if (inj?.injectedCount) row.injectedPatterns += inj.injectedCount;
    counts.set(key, row);
  }

  const buckets: BucketRow[] = [];
  for (const r of counts.values()) {
    r.successRate = r.total > 0 ? r.success / r.total : 0;
    buckets.push(r);
  }
  buckets.sort((a, b) => {
    if (a.taskKind !== b.taskKind) return a.taskKind.localeCompare(b.taskKind);
    if (a.failureMode !== b.failureMode)
      return a.failureMode.localeCompare(b.failureMode);
    return a.injectState.localeCompare(b.injectState);
  });

  const comparisons = buildComparisons(buckets);

  return {
    buckets,
    comparisons,
    stats: {
      taskHistoryConsidered: taskHistory.length,
      terminalTasks,
      nonTerminalSkipped,
      injectEventsConsidered: injectEvents,
    },
  };
}

function emptyCounts(): BucketCounts & { successRate: number } {
  return {
    total: 0,
    success: 0,
    failure: 0,
    injectedPatterns: 0,
    successRate: 0,
  };
}

function buildComparisons(buckets: BucketRow[]): InjectComparisonRow[] {
  const byKind = new Map<
    string,
    {
      taskKind: string;
      failureMode: string;
      on: BucketCounts & { successRate: number };
      off: BucketCounts & { successRate: number };
    }
  >();
  for (const b of buckets) {
    const k = `${b.taskKind}|${b.failureMode}`;
    let entry = byKind.get(k);
    if (!entry) {
      entry = {
        taskKind: b.taskKind,
        failureMode: b.failureMode,
        on: emptyCounts(),
        off: emptyCounts(),
      };
      byKind.set(k, entry);
    }
    const target = b.injectState === "on" ? entry.on : entry.off;
    target.total = b.total;
    target.success = b.success;
    target.failure = b.failure;
    target.injectedPatterns = b.injectedPatterns;
    target.successRate = b.successRate;
  }
  const out: InjectComparisonRow[] = [];
  for (const e of byKind.values()) {
    out.push({
      taskKind: e.taskKind,
      failureMode: e.failureMode,
      on: e.on,
      off: e.off,
      delta: e.on.successRate - e.off.successRate,
    });
  }
  // Biggest positive delta first (where memory helps the most).
  out.sort((a, b) => b.delta - a.delta);
  return out;
}
