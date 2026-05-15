/**
 * Model-scoring stage entry point.
 *
 * Single-call API: `runModelScoringStage(input)` does all of:
 *   1. Build the per-session scorecard from raw usage + gate data.
 *   2. Append the scorecard rows to the project leaderboard (jsonl).
 *   3. Detect changes in `MODEL_CONFIG` vs the previous session snapshot.
 *   4. Persist the new snapshot so next session can diff again.
 *   5. Render scorecard.md, leaderboard.md, and an inline diff block.
 *   6. Write scorecard.{json,md} + leaderboard.md to `.ralph/`.
 *
 * Callers (namely `coding/route.ts`'s finally block) only need to pass
 * the data they already have and get back a summary they can inject
 * into the main coding session report.
 */

import fs from "fs/promises";
import path from "path";
import type { AuditTaskSummary } from "@/lib/pipeline/self-heal";
import type { CodingSessionLlmUsageEvent } from "@/lib/pipeline/coding-session-report";
import { buildModelScorecard } from "./model-scorecard";
import {
  aggregateLeaderboard,
  appendScorecardToLeaderboard,
  leaderboardPath,
  loadLeaderboardRows,
} from "./model-leaderboard";
import {
  diffModelConfigs,
  hasSubstantiveChange,
  loadPreviousSnapshot,
  modelConfigSnapshotPath,
  saveCurrentSnapshot,
} from "./model-change-detector";
import {
  renderLeaderboardMarkdown,
  renderModelChangeMarkdown,
  renderScorecardMarkdown,
} from "./scorecard-markdown";
import type {
  GateResultsSnapshot,
  ModelScorecardFile,
} from "./types";

export interface RunModelScoringInput {
  sessionId: string;
  projectPath: string;
  outputDir: string;
  gitSha?: string;
  endedAt: string;
  llmUsage: CodingSessionLlmUsageEvent[];
  taskResults: AuditTaskSummary[];
  gateResults: GateResultsSnapshot;
}

export interface RunModelScoringOutput {
  scorecard: ModelScorecardFile;
  scorecardMarkdown: string;
  /** Short markdown block showing any MODEL_CONFIG changes; empty when none. */
  modelChangeMarkdown: string;
  /** Whether at least one substantive change was detected. */
  hasModelChange: boolean;
  /** Paths of files written to disk (when I/O succeeded). */
  paths: {
    scorecardJson: string;
    scorecardMd: string;
    leaderboardJsonl: string;
    leaderboardMd: string;
    snapshotJson: string;
  };
  errors: string[];
}

/**
 * Run the entire model-scoring stage end-to-end. Never throws — any I/O
 * failure is captured in `output.errors` so the caller can log but
 * continue its primary work (writing the main session report).
 */
export async function runModelScoringStage(
  input: RunModelScoringInput,
): Promise<RunModelScoringOutput> {
  const errors: string[] = [];

  const scorecard = buildModelScorecard({
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    gitSha: input.gitSha,
    endedAt: input.endedAt,
    llmUsage: input.llmUsage,
    taskResults: input.taskResults,
    gateResults: input.gateResults,
  });

  // Append to leaderboard FIRST — so the aggregated view we render below
  // already includes this session's rows.
  const append = await appendScorecardToLeaderboard(input.outputDir, scorecard);
  if (append.error) errors.push(`leaderboard-append: ${append.error}`);

  // Load the freshly-updated leaderboard + previous snapshot in parallel.
  const [leaderboardRows, previousSnapshot] = await Promise.all([
    loadLeaderboardRows(input.outputDir),
    loadPreviousSnapshot(input.outputDir),
  ]);
  const leaderboardBuckets = aggregateLeaderboard(leaderboardRows);

  // Diff MODEL_CONFIG (leaderboard context enriches the table).
  const changes = diffModelConfigs(previousSnapshot);
  const hasChange = hasSubstantiveChange(changes);

  // Persist the current snapshot so next session diffs against THIS one.
  const save = await saveCurrentSnapshot(input.outputDir);
  if (save.error) errors.push(`snapshot-save: ${save.error}`);

  // Render three markdown payloads.
  const scorecardMd = renderScorecardMarkdown(scorecard, {
    leaderboard: leaderboardBuckets,
  });
  const leaderboardMd = renderLeaderboardMarkdown(leaderboardBuckets);
  const changeMd = renderModelChangeMarkdown(changes, {
    leaderboard: leaderboardBuckets,
  });

  // Write scorecard.json + scorecard.md + leaderboard.md to disk.
  const paths = {
    scorecardJson: path.join(input.outputDir, ".ralph", "model-scorecard.json"),
    scorecardMd: path.join(input.outputDir, ".ralph", "model-scorecard.md"),
    leaderboardJsonl: leaderboardPath(input.outputDir),
    leaderboardMd: path.join(input.outputDir, ".ralph", "model-leaderboard.md"),
    snapshotJson: modelConfigSnapshotPath(input.outputDir),
  };

  await safeWrite(paths.scorecardJson, JSON.stringify(scorecard, null, 2), errors);
  await safeWrite(paths.scorecardMd, scorecardMd, errors);
  await safeWrite(paths.leaderboardMd, leaderboardMd, errors);

  return {
    scorecard,
    scorecardMarkdown: scorecardMd,
    modelChangeMarkdown: changeMd,
    hasModelChange: hasChange,
    paths,
    errors,
  };
}

/** Narrow wrapper: write a UTF-8 file, capturing errors into the accumulator. */
async function safeWrite(
  filePath: string,
  contents: string,
  errors: string[],
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`write ${filePath}: ${message}`);
  }
}

// Public barrel re-exports — consumers can import everything from this
// single entry point if they prefer.
export {
  buildModelScorecard,
} from "./model-scorecard";
export {
  aggregateLeaderboard,
  appendScorecardToLeaderboard,
  leaderboardPath,
  loadLeaderboardRows,
  groupByStage,
} from "./model-leaderboard";
export {
  diffModelConfigs,
  loadPreviousSnapshot,
  saveCurrentSnapshot,
  hasSubstantiveChange,
  modelConfigSnapshotPath,
} from "./model-change-detector";
export {
  renderScorecardMarkdown,
  renderLeaderboardMarkdown,
  renderModelChangeMarkdown,
} from "./scorecard-markdown";
export type {
  GateResultsSnapshot,
  ModelScorecardFile,
  ModelScorecardRow,
  ScoreDimensions,
  LeaderboardBucket,
  ModelConfigChange,
  ModelConfigSnapshot,
} from "./types";
