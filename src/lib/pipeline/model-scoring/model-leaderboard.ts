/**
 * Cross-session model leaderboard.
 *
 * Storage layout (per project):
 *   generated-code/.ralph/model-leaderboard.jsonl
 *     - Append-only. One line per scorecard row from every session ever run.
 *     - Corrupted lines are skipped, not fatal.
 *
 * Read path: `loadLeaderboardRows(outputDir)` streams every line back
 *   into `ModelScorecardRow` records.
 *
 * Write path: `appendScorecardToLeaderboard(outputDir, scorecard)`
 *   serializes each row and appends.
 *
 * Aggregation: `aggregateLeaderboard(rows)` folds rows per (stage, model)
 *   producing `LeaderboardBucket[]` ready for rendering. Caller controls
 *   trend-window length (default 10).
 */

import fs from "fs/promises";
import path from "path";
import type {
  LeaderboardBucket,
  ModelScorecardFile,
  ModelScorecardRow,
} from "./types";

const LEADERBOARD_FILENAME = "model-leaderboard.jsonl";

/** Resolve the leaderboard file path for a given output dir. */
export function leaderboardPath(outputDir: string): string {
  return path.join(outputDir, ".ralph", LEADERBOARD_FILENAME);
}

/**
 * Append every row of a scorecard to the project's leaderboard. Creates
 * the `.ralph/` directory and file if they don't yet exist. Never throws
 * — failures are logged and swallowed, since leaderboard persistence is
 * non-critical to the session's primary outcome.
 */
export async function appendScorecardToLeaderboard(
  outputDir: string,
  scorecard: ModelScorecardFile,
): Promise<{ appended: number; path: string; error?: string }> {
  const filePath = leaderboardPath(outputDir);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const lines = scorecard.rows.map((row) => JSON.stringify(row)).join("\n");
    const payload = lines.length > 0 ? lines + "\n" : "";
    await fs.appendFile(filePath, payload, "utf-8");
    return { appended: scorecard.rows.length, path: filePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { appended: 0, path: filePath, error: message };
  }
}

/**
 * Stream-read every row from the leaderboard file. Missing file = empty.
 * Corrupted lines are logged but not fatal; this mirrors a real append-log.
 */
export async function loadLeaderboardRows(
  outputDir: string,
): Promise<ModelScorecardRow[]> {
  const filePath = leaderboardPath(outputDir);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const rows: ModelScorecardRow[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ModelScorecardRow;
      if (parsed && typeof parsed.model === "string" && typeof parsed.stage === "string") {
        rows.push(parsed);
      }
    } catch {
      // Skip corrupted line — append-logs can have partial writes.
    }
  }
  return rows;
}

export interface AggregateOptions {
  /** How many recent scores to retain per (stage, model) for trend rendering. */
  trendWindow?: number;
}

/**
 * Fold raw leaderboard rows into per-(stage, model) aggregates.
 *
 * - `avgScore` is a simple mean (all runs weighted equally); intentionally
 *   NOT usage-weighted so a model's average reflects its track record, not
 *   its total usage time.
 * - `scoreTrend` keeps the most recent `trendWindow` scores for that model
 *   within the stage (chronologically, newest last).
 * - `medianCostUsd` uses the classic middle-of-sorted-values.
 */
export function aggregateLeaderboard(
  rows: ModelScorecardRow[],
  options: AggregateOptions = {},
): LeaderboardBucket[] {
  const trendWindow = Math.max(3, Math.min(20, options.trendWindow ?? 10));
  const map = new Map<string, ModelScorecardRow[]>();
  for (const row of rows) {
    const key = `${row.stage}::${row.model}`;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }

  const buckets: LeaderboardBucket[] = [];
  for (const [key, bucket] of map.entries()) {
    const [stage, model] = key.split("::");
    // Sort chronologically — trend relies on time order.
    bucket.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const scores = bucket.map((r) => r.score);
    const successRates = bucket.map((r) => r.dimensions.correctness);
    const costs = bucket.map((r) => r.costUsd).filter((v) => v > 0);
    const msPerCalls = bucket
      .map((r) => (r.calls > 0 ? r.durationMs / r.calls : 0))
      .filter((v) => v > 0);

    buckets.push({
      stage,
      model,
      runs: bucket.length,
      avgScore: round1(mean(scores)),
      scoreTrend: scores.slice(-trendWindow),
      avgCostUsd: round6(mean(costs)),
      medianCostUsd: round6(median(costs)),
      avgDurationMsPerCall: Math.round(mean(msPerCalls)),
      avgSuccessRate: round1(mean(successRates)),
      lastSeenAt: bucket[bucket.length - 1].timestamp,
    });
  }

  // Sort: stage A→Z, then avgScore desc within stage.
  buckets.sort((a, b) => {
    if (a.stage !== b.stage) return a.stage.localeCompare(b.stage);
    return b.avgScore - a.avgScore;
  });
  return buckets;
}

/** Groups aggregated buckets by stage, for rendering. */
export function groupByStage(
  buckets: LeaderboardBucket[],
): Map<string, LeaderboardBucket[]> {
  const out = new Map<string, LeaderboardBucket[]>();
  for (const b of buckets) {
    const list = out.get(b.stage) ?? [];
    list.push(b);
    out.set(b.stage, list);
  }
  return out;
}

// ─── math helpers ─────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function round1(v: number): number {
  return Number(v.toFixed(1));
}

function round6(v: number): number {
  return Number(v.toFixed(6));
}
