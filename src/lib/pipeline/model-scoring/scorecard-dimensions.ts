/**
 * Scorecard dimension calculators.
 *
 * Each dimension is a pure function returning 0..100 (higher = better) plus
 * a list of reason strings explaining any deductions. All dimensions are
 * computed independently; the composite score is calculated in the caller
 * by applying `DIMENSION_WEIGHTS`.
 *
 * Design notes:
 *   - Every dimension tolerates missing/empty inputs by returning a neutral
 *     score (100 for "nothing-to-penalize", not 0) so a model that simply
 *     wasn't used in a given stage never drags its own composite down.
 *   - Normalizations (cost, speed) use the session-wide min as the
 *     reference, so the cheapest/fastest model in a session always scores
 *     100 and others are relative. This gives meaningful head-to-head
 *     comparisons even without a global baseline.
 *   - Reasons are short, user-facing sentences; keep them terse.
 */

import type {
  CodingSessionLlmUsageEvent,
} from "@/lib/pipeline/coding-session-report";
import type { GateResultsSnapshot, ScoreDimensions } from "./types";

/** Wrap a dimension calculator's return payload. */
export interface DimensionScore {
  score: number;
  reasons: string[];
}

/** Model-scoped slice of LLM usage events + basic counts. */
export interface ModelUsageSlice {
  model: string;
  stage: string;
  events: CodingSessionLlmUsageEvent[];
  calls: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

/** Reference values (computed across all models in a session) for normalizations. */
export interface SessionCostSpeedReference {
  /** Minimum cost-per-task observed across all models in this session (USD). */
  minCostPerTask: number;
  /** Minimum ms/call observed across all models in this session. */
  minMsPerCall: number;
  /** The maximum cost-per-task observed; used to detect outliers. */
  maxCostPerTask: number;
  /** The maximum ms/call observed; used to detect outliers. */
  maxMsPerCall: number;
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * Correctness — did the gates that ran produce no blocking output?
 *
 * Gates that didn't execute are ignored (skipped ≠ failed). A model gets
 * the full 100 only if every executed gate passed. Each failed gate costs
 * a weighted chunk; unresolved requirement IDs add incremental penalty.
 *
 * NOTE: correctness is a session-wide property, not per-model; we return
 * the same value for every model in the session. Without per-call
 * gate-attribution data we can't blame a specific model for e.g. a failing
 * `tsc` — the leaderboard trends over time will surface which models
 * consistently correlate with gate failures.
 */
export function scoreCorrectness(gates: GateResultsSnapshot): DimensionScore {
  let score = 100;
  const reasons: string[] = [];

  if (gates.integrationExecuted && !gates.integrationPassed) {
    score -= 30;
    reasons.push("Integration gate failed.");
  }
  if (gates.runtimeExecuted && !gates.runtimePassed) {
    score -= 20;
    reasons.push("Runtime gate failed.");
  }
  if (gates.e2eExecuted && !gates.e2ePassed) {
    score -= 25;
    reasons.push("E2E gate failed.");
  }
  if (!gates.auditPassed) {
    const idPenalty = Math.min(25, Math.max(5, gates.uncoveredRequirementCount * 2));
    score -= idPenalty;
    reasons.push(
      `Audit failed: ${gates.uncoveredRequirementCount} requirement id(s) uncovered.`,
    );
  }

  return { score: clamp(score), reasons };
}

/**
 * Task success — fraction of coding tasks that completed cleanly.
 *
 * `completed` counts as full credit, `completed_with_warnings` as half,
 * `failed` as zero. Returns 100 if there are no tasks (edge case).
 */
export function scoreTaskSuccess(gates: GateResultsSnapshot): DimensionScore {
  const total = gates.tasksTotal;
  if (total === 0) return { score: 100, reasons: [] };

  const effective =
    gates.tasksCompleted + 0.5 * gates.tasksCompletedWithWarnings;
  const score = clamp((effective / total) * 100);

  const reasons: string[] = [];
  if (gates.tasksFailed > 0) {
    reasons.push(`${gates.tasksFailed}/${total} task(s) failed.`);
  }
  if (gates.tasksCompletedWithWarnings > 0) {
    reasons.push(
      `${gates.tasksCompletedWithWarnings}/${total} task(s) finished with warnings (half credit).`,
    );
  }
  return { score, reasons };
}

/**
 * Efficiency — fewer retries / fix iterations = higher score.
 *
 * Starts at 100. `integrationFixAttempts` beyond 1 costs 8 points each
 * (the first attempt is expected). `scaffoldFixAttempts` beyond 1 costs
 * 4 points each. Fallback triggers cost 6 points apiece (model that
 * failed and required backup is not efficient).
 *
 * Capped so one bad run can't drive efficiency below 20 on its own — we
 * want this dimension to be informative, not dominant.
 */
export function scoreEfficiency(gates: GateResultsSnapshot): DimensionScore {
  let score = 100;
  const reasons: string[] = [];

  const extraInt = Math.max(0, gates.integrationFixAttempts - 1);
  if (extraInt > 0) {
    const delta = Math.min(40, extraInt * 8);
    score -= delta;
    reasons.push(
      `Integration fix loop burned ${gates.integrationFixAttempts} iteration(s).`,
    );
  }
  const extraScaffold = Math.max(0, gates.scaffoldFixAttempts - 1);
  if (extraScaffold > 0) {
    const delta = Math.min(25, extraScaffold * 4);
    score -= delta;
    reasons.push(
      `Scaffold fix loop burned ${gates.scaffoldFixAttempts} iteration(s).`,
    );
  }
  if (gates.fallbackTriggerCount > 0) {
    const delta = Math.min(30, gates.fallbackTriggerCount * 6);
    score -= delta;
    reasons.push(
      `Primary-model failures triggered ${gates.fallbackTriggerCount} fallback(s).`,
    );
  }

  return { score: clamp(Math.max(20, score)), reasons };
}

/**
 * Robustness — fewer truncation / stagnation signals = higher score.
 *
 * Truncation events indicate the model requested or produced output that
 * exceeded its budget (either PRD context too large or output hit
 * max_tokens). Stagnation events indicate the model kept looping without
 * making progress. Both are direct model-quality signals.
 */
export function scoreRobustness(gates: GateResultsSnapshot): DimensionScore {
  let score = 100;
  const reasons: string[] = [];

  if (gates.truncationEventCount > 0) {
    const delta = Math.min(35, gates.truncationEventCount * 5);
    score -= delta;
    reasons.push(
      `${gates.truncationEventCount} truncation event(s) during this run.`,
    );
  }
  if (gates.stagnationEventCount > 0) {
    const delta = Math.min(40, gates.stagnationEventCount * 8);
    score -= delta;
    reasons.push(
      `${gates.stagnationEventCount} stagnation event(s) during this run.`,
    );
  }
  return { score: clamp(score), reasons };
}

/**
 * Cost — cheaper per task = higher score. Normalized to session.
 *
 * Linear inverse: 100 if this model's $/task == session min, 0 if 3×
 * the session min or worse. Saves the session's cheapest/baseline model
 * from getting dinged just for existing.
 */
export function scoreCost(
  slice: ModelUsageSlice,
  reference: SessionCostSpeedReference,
  tasksInScope: number,
): DimensionScore {
  const reasons: string[] = [];
  const effectiveTasks = tasksInScope > 0 ? tasksInScope : 1;
  const costPerTask = slice.costUsd / effectiveTasks;

  if (!Number.isFinite(costPerTask) || costPerTask <= 0) {
    return { score: 100, reasons: [] };
  }
  const min = reference.minCostPerTask > 0 ? reference.minCostPerTask : costPerTask;
  const ratio = costPerTask / min;

  // ratio = 1 → 100. ratio = 3 → 0. Linear in between.
  const score = clamp(100 - (ratio - 1) * 50);

  if (ratio > 1.5) {
    reasons.push(
      `Cost/task $${costPerTask.toFixed(4)} is ${ratio.toFixed(1)}× the cheapest model in this session.`,
    );
  }
  return { score, reasons };
}

/**
 * Speed — faster per call = higher score. Normalized to session.
 *
 * Linear inverse: 100 if this model's ms/call == session min, 0 if 4×
 * the min or worse. Uses calls as the denominator so a model that simply
 * made more calls isn't unfairly penalized.
 */
export function scoreSpeed(
  slice: ModelUsageSlice,
  reference: SessionCostSpeedReference,
): DimensionScore {
  const reasons: string[] = [];
  const calls = slice.calls > 0 ? slice.calls : 1;
  const msPerCall = slice.durationMs / calls;
  if (!Number.isFinite(msPerCall) || msPerCall <= 0) {
    return { score: 100, reasons: [] };
  }
  const min = reference.minMsPerCall > 0 ? reference.minMsPerCall : msPerCall;
  const ratio = msPerCall / min;

  // ratio = 1 → 100. ratio = 4 → 0.
  const score = clamp(100 - (ratio - 1) * (100 / 3));

  if (ratio > 1.5) {
    reasons.push(
      `Speed ${Math.round(msPerCall)}ms/call is ${ratio.toFixed(1)}× slower than the fastest model.`,
    );
  }
  return { score, reasons };
}

/**
 * Combine per-dimension scores into `ScoreDimensions` and an aggregated
 * reason list. Does NOT compute the weighted composite — caller owns
 * that so it can apply project-specific weight tweaks.
 */
export function assembleDimensions(inputs: {
  correctness: DimensionScore;
  taskSuccess: DimensionScore;
  efficiency: DimensionScore;
  robustness: DimensionScore;
  cost: DimensionScore;
  speed: DimensionScore;
}): { dimensions: ScoreDimensions; reasons: string[] } {
  const dimensions: ScoreDimensions = {
    correctness: inputs.correctness.score,
    taskSuccess: inputs.taskSuccess.score,
    efficiency: inputs.efficiency.score,
    robustness: inputs.robustness.score,
    cost: inputs.cost.score,
    speed: inputs.speed.score,
  };
  // De-duplicate reasons while preserving insertion order.
  const seen = new Set<string>();
  const reasons: string[] = [];
  const add = (list: string[]): void => {
    for (const r of list) {
      if (!seen.has(r)) {
        seen.add(r);
        reasons.push(r);
      }
    }
  };
  add(inputs.correctness.reasons);
  add(inputs.taskSuccess.reasons);
  add(inputs.efficiency.reasons);
  add(inputs.robustness.reasons);
  add(inputs.cost.reasons);
  add(inputs.speed.reasons);
  return { dimensions, reasons };
}

/** Weighted composite helper. Exported for model-scorecard + leaderboard. */
export function weightedComposite(
  dimensions: ScoreDimensions,
  weights: Record<keyof ScoreDimensions, number>,
): number {
  const keys = Object.keys(dimensions) as Array<keyof ScoreDimensions>;
  let total = 0;
  let wSum = 0;
  for (const k of keys) {
    total += dimensions[k] * weights[k];
    wSum += weights[k];
  }
  const score = wSum > 0 ? total / wSum : 0;
  return Number(clamp(score).toFixed(1));
}
