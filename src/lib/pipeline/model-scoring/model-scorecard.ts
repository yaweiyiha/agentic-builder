/**
 * Per-session model scorecard builder.
 *
 * Consumes the raw LLM usage events + gate snapshot for one coding
 * session and emits one `ModelScorecardRow` per (stage, model) bucket.
 * Fallback invocations produce their own rows so the leaderboard can
 * compare `deepseek-v4-pro` vs the backup `gpt-5.3-codex` vs `qwen` etc.
 *
 * The scorecard is session-local: it tells you "how did each model
 * perform IN THIS RUN". Cross-session comparisons come from the
 * leaderboard, which folds multiple scorecards together.
 */

import type { AuditTaskSummary } from "@/lib/pipeline/self-heal";
import type { CodingSessionLlmUsageEvent } from "@/lib/pipeline/coding-session-report";
import { MODEL_CONFIG, type ModelConfigKey } from "@/lib/model-config";
import {
  DIMENSION_WEIGHTS,
  type GateResultsSnapshot,
  type ModelScorecardFile,
  type ModelScorecardRow,
} from "./types";
import {
  assembleDimensions,
  scoreCorrectness,
  scoreCost,
  scoreEfficiency,
  scoreRobustness,
  scoreSpeed,
  scoreTaskSuccess,
  weightedComposite,
  type SessionCostSpeedReference,
} from "./scorecard-dimensions";

/**
 * Maps supervisor-side stage strings to the `MODEL_CONFIG` key that
 * controls which model each stage uses. Known gaps return `undefined`
 * (scorecard still gets built, just without `modelConfigKey` reference).
 */
const STAGE_TO_CONFIG_KEY: Record<string, ModelConfigKey> = {
  worker_codegen: "codeGen",
  worker_fix: "codeFix",
  task_verify_fix: "codeFix",
  integration_verify_fix: "phaseVerifyFix",
  phase_verify_fix: "phaseVerifyFix",
  e2e_verify_fix: "phaseVerifyFix",
  e2e_source_repair: "e2eGen",
  e2e_coverage_gen: "e2eGen",
  task_breakdown: "taskBreakdown",
  task_breakdown_review: "taskBreakdownReview",
};

export interface BuildScorecardInput {
  sessionId: string;
  projectPath: string;
  gitSha?: string;
  /** All LLM usage events captured during the session. */
  llmUsage: CodingSessionLlmUsageEvent[];
  /** Aggregated task outcomes. */
  taskResults: AuditTaskSummary[];
  /** Gate results snapshot (see coding/route.ts supervisor snapshot). */
  gateResults: GateResultsSnapshot;
  /** ISO timestamp marking the end of the session (for ordering). */
  endedAt: string;
}

/** Build the full scorecard file payload for this session. */
export function buildModelScorecard(
  input: BuildScorecardInput,
): ModelScorecardFile {
  const buckets = groupByStageAndModel(input.llmUsage);
  const reference = computeCostSpeedReference(buckets, input.gateResults);

  const rows: ModelScorecardRow[] = buckets.map((bucket) => {
    const configKey = STAGE_TO_CONFIG_KEY[bucket.stage];
    const chain = configKey ? resolveChain(MODEL_CONFIG[configKey]) : [];
    const primaryModel = chain[0];
    const isPrimary =
      primaryModel !== undefined &&
      matchesModelId(primaryModel, bucket.model);
    const isInChain = chain.some((c) => matchesModelId(c, bucket.model));
    const isFallback = isInChain && !isPrimary;

    const correctness = scoreCorrectness(input.gateResults);
    const taskSuccess = scoreTaskSuccess(input.gateResults);
    const efficiency = scoreEfficiency(input.gateResults);
    const robustness = scoreRobustness(input.gateResults);
    const cost = scoreCost(bucket, reference, input.gateResults.tasksTotal);
    const speed = scoreSpeed(bucket, reference);

    const { dimensions, reasons } = assembleDimensions({
      correctness,
      taskSuccess,
      efficiency,
      robustness,
      cost,
      speed,
    });
    const score = weightedComposite(dimensions, DIMENSION_WEIGHTS);

    const row: ModelScorecardRow = {
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      timestamp: input.endedAt,
      gitSha: input.gitSha,
      stage: bucket.stage,
      modelConfigKey: configKey,
      model: bucket.model,
      isPrimary,
      isFallback,
      calls: bucket.calls,
      promptTokens: sum(bucket.events, (e) => e.promptTokens),
      completionTokens: sum(bucket.events, (e) => e.completionTokens),
      totalTokens: bucket.totalTokens,
      costUsd: Number(bucket.costUsd.toFixed(6)),
      durationMs: bucket.durationMs,
      dimensions,
      score,
      grade: scoreToGrade(score),
      reasons: reasons.slice(0, 5),
      gateResults: input.gateResults,
    };
    return row;
  });

  // Sort: stage A→Z, then by score desc within each stage.
  rows.sort((a, b) => {
    if (a.stage !== b.stage) return a.stage.localeCompare(b.stage);
    return b.score - a.score;
  });

  const sessionComposite = computeSessionComposite(rows);

  return {
    sessionId: input.sessionId,
    generatedAt: new Date().toISOString(),
    projectPath: input.projectPath,
    gitSha: input.gitSha,
    gateResults: input.gateResults,
    rows,
    sessionComposite,
  };
}

// ─── internals ────────────────────────────────────────────────────────────

interface StageModelBucket {
  stage: string;
  model: string;
  events: CodingSessionLlmUsageEvent[];
  calls: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

function groupByStageAndModel(
  events: CodingSessionLlmUsageEvent[],
): StageModelBucket[] {
  const map = new Map<string, StageModelBucket>();
  for (const event of events) {
    const key = `${event.stage}::${event.model}`;
    const bucket = map.get(key) ?? {
      stage: event.stage,
      model: event.model,
      events: [],
      calls: 0,
      totalTokens: 0,
      costUsd: 0,
      durationMs: 0,
    };
    bucket.events.push(event);
    bucket.calls += 1;
    bucket.totalTokens += event.totalTokens;
    bucket.costUsd += event.costUsd;
    map.set(key, bucket);
  }
  // Fill durations from span of timestamps within each bucket (rough
  // approximation — per-call duration isn't tracked separately).
  for (const bucket of map.values()) {
    const ts = bucket.events
      .map((e) => Date.parse(e.timestamp))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    bucket.durationMs = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
  }
  return [...map.values()];
}

function computeCostSpeedReference(
  buckets: StageModelBucket[],
  gates: GateResultsSnapshot,
): SessionCostSpeedReference {
  const tasks = gates.tasksTotal > 0 ? gates.tasksTotal : 1;
  let minCost = Number.POSITIVE_INFINITY;
  let maxCost = 0;
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = 0;

  for (const b of buckets) {
    if (b.costUsd > 0) {
      const perTask = b.costUsd / tasks;
      if (perTask < minCost) minCost = perTask;
      if (perTask > maxCost) maxCost = perTask;
    }
    const msPerCall = b.calls > 0 ? b.durationMs / b.calls : 0;
    if (msPerCall > 0) {
      if (msPerCall < minMs) minMs = msPerCall;
      if (msPerCall > maxMs) maxMs = msPerCall;
    }
  }

  if (!Number.isFinite(minCost)) minCost = 0;
  if (!Number.isFinite(minMs)) minMs = 0;
  return {
    minCostPerTask: minCost,
    maxCostPerTask: maxCost,
    minMsPerCall: minMs,
    maxMsPerCall: maxMs,
  };
}

function computeSessionComposite(
  rows: ModelScorecardRow[],
): ModelScorecardFile["sessionComposite"] {
  if (rows.length === 0) {
    return { score: 100, grade: "A", topModel: "(none)", worstModel: "(none)" };
  }
  const totalTokens = rows.reduce((s, r) => s + Math.max(r.totalTokens, 1), 0);
  let weighted = 0;
  for (const r of rows) {
    weighted += r.score * Math.max(r.totalTokens, 1);
  }
  const score = Number((weighted / totalTokens).toFixed(1));

  // Top = highest score with significant calls; worst = lowest score with ≥2 calls.
  const sortedBest = [...rows].sort((a, b) => b.score - a.score);
  const sortedWorst = [...rows]
    .filter((r) => r.calls >= 2)
    .sort((a, b) => a.score - b.score);

  return {
    score,
    grade: scoreToGrade(score),
    topModel: sortedBest[0]?.model ?? "(none)",
    worstModel: sortedWorst[0]?.model ?? sortedBest[sortedBest.length - 1]?.model ?? "(none)",
  };
}

function resolveChain(value: string | readonly string[]): string[] {
  return Array.isArray(value) ? [...value] : [value as string];
}

/**
 * Fuzzy match between a configured model alias (e.g. `claude-sonnet`) and
 * the actual model id logged by the usage event (e.g. `anthropic/claude-sonnet-4`).
 * Substring match is sufficient because our alias map doesn't have false
 * siblings (no `claude-sonnet-X` vs `claude-sonnet-Y`).
 */
function matchesModelId(configured: string, actual: string): boolean {
  if (configured === actual) return true;
  const c = configured.toLowerCase();
  const a = actual.toLowerCase();
  if (a.includes(c)) return true;
  if (c.includes(a)) return true;
  return false;
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  let acc = 0;
  for (const it of items) acc += pick(it);
  return acc;
}

function scoreToGrade(score: number): ModelScorecardRow["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
