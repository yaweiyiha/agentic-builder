/**
 * Shared types for the model-scoring subsystem.
 *
 * Kept in a single file because they are small data definitions consumed
 * from multiple peer modules. Changing these is a cross-module concern.
 */

import type { ModelConfigKey } from "@/lib/model-config";

/** Per-dimension score breakdown (each 0..100, higher = better). */
export interface ScoreDimensions {
  /** Did the gates (integration, runtime, e2e, audit) pass? */
  correctness: number;
  /** What fraction of tasks completed without failures? */
  taskSuccess: number;
  /** How efficient was the model (fewer rounds/retries = higher)? */
  efficiency: number;
  /** How robust was it (fewer truncations/stagnations = higher)? */
  robustness: number;
  /** Cost efficiency ($/task normalized). */
  cost: number;
  /** Speed efficiency (ms/call normalized). */
  speed: number;
}

/** Default weights. Sum MUST equal 1.0. Tune without changing callers. */
export const DIMENSION_WEIGHTS: Readonly<Record<keyof ScoreDimensions, number>> = Object.freeze({
  correctness: 0.35,
  taskSuccess: 0.25,
  efficiency: 0.15,
  robustness: 0.10,
  cost: 0.10,
  speed: 0.05,
});

/**
 * One row of the scorecard: "model X in stage Y during session S scored …".
 *
 * Each LLM call event is attributed to exactly one (stage, model) bucket.
 * A fallback model used in the same stage produces a separate row so the
 * leaderboard can compare primary vs fallback performance.
 */
export interface ModelScorecardRow {
  sessionId: string;
  projectPath: string;
  /** ISO 8601. Represents the *end* of the session for ordering. */
  timestamp: string;
  /** Optional short git SHA for reproducibility. */
  gitSha?: string;

  /** Supervisor-level stage label, e.g. `worker_codegen`, `integration_verify_fix`. */
  stage: string;
  /** The `MODEL_CONFIG` key this stage maps to, if known. */
  modelConfigKey?: ModelConfigKey;
  /** Actual model ID used (OpenRouter ID or alias). */
  model: string;
  /** True if this was the primary (first) model in the stage's fallback chain. */
  isPrimary: boolean;
  /** True if this entry reflects a fallback call (not the primary model). */
  isFallback: boolean;

  // Raw usage
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  /** Wall-clock time spanned by this model's calls within the stage. */
  durationMs: number;

  // Scoring
  dimensions: ScoreDimensions;
  /** Weighted composite score 0..100. */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  /** Short diagnostic notes driving the score. */
  reasons: string[];

  /** Session-wide gate context used to derive `correctness` / `taskSuccess`. */
  gateResults: GateResultsSnapshot;
}

/** Gate state snapshot used during scoring — all session-wide (not per-model). */
export interface GateResultsSnapshot {
  integrationExecuted: boolean;
  integrationPassed: boolean;
  runtimeExecuted: boolean;
  runtimePassed: boolean;
  e2eExecuted: boolean;
  e2ePassed: boolean;
  auditPassed: boolean;
  uncoveredRequirementCount: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksCompletedWithWarnings: number;
  tasksFailed: number;
  truncationEventCount: number;
  stagnationEventCount: number;
  fallbackTriggerCount: number;
  integrationFixAttempts: number;
  scaffoldFixAttempts: number;
}

/** `.ralph/model-scorecard.json` shape. */
export interface ModelScorecardFile {
  sessionId: string;
  generatedAt: string;
  projectPath: string;
  gitSha?: string;
  gateResults: GateResultsSnapshot;
  rows: ModelScorecardRow[];
  /** Composite across all models in this session (usage-weighted). */
  sessionComposite: {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    topModel: string;
    worstModel: string;
  };
}

/**
 * Leaderboard aggregate for a (stage, model) pair across multiple sessions.
 * Built by reading `model-leaderboard.jsonl` and folding rows together.
 */
export interface LeaderboardBucket {
  stage: string;
  model: string;
  runs: number;
  avgScore: number;
  scoreTrend: number[]; // most recent N scores, newest last
  avgCostUsd: number;
  medianCostUsd: number;
  avgDurationMsPerCall: number;
  avgSuccessRate: number; // correctness dimension avg
  /** Timestamp of the most recent run this model appeared in. */
  lastSeenAt: string;
}

/** Detected change between previous and current MODEL_CONFIG snapshots. */
export interface ModelConfigChange {
  stageKey: ModelConfigKey;
  kind: "added" | "removed" | "changed-primary" | "changed-fallbacks" | "unchanged";
  previous?: string[];
  current?: string[];
  previousPrimary?: string;
  currentPrimary?: string;
}

/** Shape saved to `.ralph/last-model-config.json`. */
export interface ModelConfigSnapshot {
  capturedAt: string;
  config: Record<string, string | string[]>;
}
