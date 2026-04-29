/**
 * Outcome attribution — close the feedback loop on injected memory
 * patterns. After tasks complete, we look up which L1 patterns were
 * actually injected into their prompts (from trace.jsonl), then bump
 * those patterns' scores up or down based on whether the task succeeded
 * or failed.
 *
 * Three-layer architecture (design doc §12.7) implications:
 *   - Active patterns that correlate with failures get demoted toward
 *     shadow → eventually deprecated.
 *   - Shadow patterns that correlate with successes drift up → eventually
 *     promoted to active without manual approval.
 *   - `manual:approved` patterns are **immune** — humans curate them.
 *     Attribution against them is logged for inspection but doesn't
 *     change the score.
 *
 * Pure function — no I/O. CLI wrapper handles file I/O and persistence.
 */

import type { TraceEvent } from "../trace";
import type { MemoryRecord } from "../types";

export interface AttributionInput {
  /** All inject trace events from the project's trace.jsonl. */
  traceEvents: TraceEvent[];
  /** All task-history records from the project's L2. */
  taskHistory: MemoryRecord[];
  /** Map from pattern id → current L1 record (must exist). Patterns not
   *  in the map are skipped (likely deleted between runs). */
  patternsById: Map<string, MemoryRecord>;
  /** (kickoffId, taskId) pairs already attributed in past runs. */
  alreadyAttributed: Set<string>;
  /** Score delta per success outcome (default +0.05). */
  deltaSuccess: number;
  /** Score delta per failure outcome (default -0.10). */
  deltaFailure: number;
}

export interface PatternAttribution {
  patternId: string;
  oldScore: number;
  newScore: number;
  /** Net delta applied (after clamping + immunity). */
  delta: number;
  /** Number of successful task outcomes credited to this pattern. */
  successes: number;
  /** Number of failed task outcomes credited. */
  failures: number;
  /** True if `manual:approved` — score not changed. */
  immune: boolean;
}

export interface AttributionResult {
  attributions: PatternAttribution[];
  /** New (kickoffId, taskId) keys to add to the persisted cursor. */
  newlyAttributed: string[];
  /** Diagnostic counts. */
  stats: {
    taskHistoryConsidered: number;
    taskHistorySkippedNotTerminal: number;
    taskHistorySkippedAlreadyAttributed: number;
    injectEventsConsidered: number;
    patternsTouched: number;
  };
}

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function pairKey(kickoffId: string, taskId: string): string {
  return `${kickoffId}::${taskId}`;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function readStatus(record: MemoryRecord): string | null {
  try {
    const body = JSON.parse(record.body) as { status?: string };
    return typeof body.status === "string" ? body.status : null;
  } catch {
    return null;
  }
}

/**
 * Build a map from (kickoffId, taskId) → injected pattern ids.
 * Only counts events where injection actually happened (`injected: true`).
 */
function buildInjectionIndex(
  events: TraceEvent[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let consideredCount = 0;
  for (const ev of events) {
    if (ev.op !== "inject") continue;
    if (!ev.kickoffId || !ev.taskId) continue;
    const det = ev.details as
      | { injected?: boolean; activeIds?: unknown }
      | undefined;
    if (!det || det.injected !== true) continue;
    if (!Array.isArray(det.activeIds)) continue;
    consideredCount++;
    const key = pairKey(ev.kickoffId, ev.taskId);
    let set = out.get(key);
    if (!set) {
      set = new Set();
      out.set(key, set);
    }
    for (const id of det.activeIds) {
      if (typeof id === "string") set.add(id);
    }
  }
  void consideredCount;
  return out;
}

export function computeAttributions(input: AttributionInput): AttributionResult {
  const injIndex = buildInjectionIndex(input.traceEvents);
  const accum = new Map<
    string,
    { successes: number; failures: number; immune: boolean }
  >();
  const newlyAttributed: string[] = [];
  const stats = {
    taskHistoryConsidered: 0,
    taskHistorySkippedNotTerminal: 0,
    taskHistorySkippedAlreadyAttributed: 0,
    injectEventsConsidered: 0,
    patternsTouched: 0,
  };

  // Count inject events for stats
  for (const ev of input.traceEvents) {
    if (ev.op === "inject") {
      const det = ev.details as { injected?: boolean } | undefined;
      if (det?.injected === true) stats.injectEventsConsidered++;
    }
  }

  for (const th of input.taskHistory) {
    stats.taskHistoryConsidered++;
    const kickoffId = th.refs.kickoffId;
    const taskId = th.refs.taskId;
    if (!kickoffId || !taskId) continue;
    const status = readStatus(th);
    if (!status || !TERMINAL_STATUSES.has(status)) {
      stats.taskHistorySkippedNotTerminal++;
      continue;
    }
    const key = pairKey(kickoffId, taskId);
    if (input.alreadyAttributed.has(key)) {
      stats.taskHistorySkippedAlreadyAttributed++;
      continue;
    }
    const injectedIds = injIndex.get(key);
    if (!injectedIds || injectedIds.size === 0) continue;

    // Mark this pair as attributed even if all patterns are immune —
    // we don't want to revisit it next time.
    newlyAttributed.push(key);

    const successful = status === "completed";
    for (const id of injectedIds) {
      const rec = input.patternsById.get(id);
      if (!rec) continue;
      const isImmune = rec.tags.includes("manual:approved");
      const cur = accum.get(id) ?? { successes: 0, failures: 0, immune: isImmune };
      if (successful) cur.successes += 1;
      else cur.failures += 1;
      cur.immune = isImmune;
      accum.set(id, cur);
    }
  }

  const attributions: PatternAttribution[] = [];
  for (const [id, c] of accum.entries()) {
    const rec = input.patternsById.get(id)!;
    const oldScore = rec.metrics.score ?? 0;
    const rawDelta =
      c.successes * input.deltaSuccess + c.failures * input.deltaFailure;
    const newScore = c.immune ? oldScore : clamp(oldScore + rawDelta, -1, 1);
    attributions.push({
      patternId: id,
      oldScore,
      newScore,
      delta: newScore - oldScore,
      successes: c.successes,
      failures: c.failures,
      immune: c.immune,
    });
  }
  stats.patternsTouched = attributions.length;
  // Sort by absolute delta desc — biggest movers first.
  attributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { attributions, newlyAttributed, stats };
}

export const DEFAULT_DELTA_SUCCESS = 0.05;
export const DEFAULT_DELTA_FAILURE = -0.1;
