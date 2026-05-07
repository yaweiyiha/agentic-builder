/**
 * Markdown renderers for the model-scoring outputs.
 *
 * Three renderers live here, each producing a standalone markdown string:
 *   - `renderScorecardMarkdown`   : per-session per-model scorecard
 *   - `renderLeaderboardMarkdown` : cross-session aggregate leaderboard
 *   - `renderModelChangeMarkdown` : diff of MODEL_CONFIG vs previous run
 *
 * Keeping them in one file (rather than three) because they share small
 * table-formatting helpers and are always consumed together by the
 * scoring stage entry point.
 */

import type { ModelConfigKey } from "@/lib/model-config";
import {
  groupByStage,
  type AggregateOptions,
} from "./model-leaderboard";
import type {
  LeaderboardBucket,
  ModelConfigChange,
  ModelScorecardFile,
  ModelScorecardRow,
  ScoreDimensions,
} from "./types";

// ─── Scorecard markdown ───────────────────────────────────────────────────

export interface RenderScorecardOptions {
  /** Historical leaderboard buckets — used to render per-model score history. */
  leaderboard?: LeaderboardBucket[];
}

/**
 * Render the per-session `model-scorecard.md`. Shows every (stage, model)
 * row along with its dimensional breakdown and driving reasons,
 * plus a historical score trend section when leaderboard data is available.
 */
export function renderScorecardMarkdown(
  card: ModelScorecardFile,
  options: RenderScorecardOptions = {},
): string {
  const lines: string[] = [];
  lines.push("# Model Scorecard — This Session");
  lines.push("");
  lines.push(`- **Session**: \`${card.sessionId}\``);
  lines.push(`- **Generated at**: ${card.generatedAt}`);
  if (card.gitSha) lines.push(`- **Git SHA**: \`${card.gitSha}\``);
  lines.push(
    `- **Session composite**: **${card.sessionComposite.score} (${card.sessionComposite.grade})**`,
  );
  lines.push(
    `- **Top model**: \`${card.sessionComposite.topModel}\``,
  );
  lines.push(
    `- **Weakest model**: \`${card.sessionComposite.worstModel}\``,
  );
  lines.push("");
  lines.push(
    "> Scores are weighted composites across 6 dimensions: correctness " +
      "(35%), taskSuccess (25%), efficiency (15%), robustness (10%), cost " +
      "(10%), speed (5%). Higher is better.",
  );
  lines.push("");

  // Group by stage for readability
  const byStage = new Map<string, ModelScorecardRow[]>();
  for (const r of card.rows) {
    const list = byStage.get(r.stage) ?? [];
    list.push(r);
    byStage.set(r.stage, list);
  }

  if (byStage.size === 0) {
    lines.push("_No LLM usage recorded._");
    return lines.join("\n");
  }

  for (const [stage, rows] of byStage.entries()) {
    lines.push(`## Stage \`${stage}\``);
    lines.push("");
    lines.push(
      "| Model | Role | Score | Correct | TaskSuc | Efficient | Robust | Cost | Speed | Calls | Tokens | $ |",
    );
    lines.push(
      "|---|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const r of rows) {
      const role = r.isPrimary ? "primary" : r.isFallback ? "fallback" : "-";
      lines.push(
        [
          "",
          `\`${r.model}\``,
          role,
          `**${r.score.toFixed(1)} (${r.grade})**`,
          r.dimensions.correctness.toFixed(0),
          r.dimensions.taskSuccess.toFixed(0),
          r.dimensions.efficiency.toFixed(0),
          r.dimensions.robustness.toFixed(0),
          r.dimensions.cost.toFixed(0),
          r.dimensions.speed.toFixed(0),
          String(r.calls),
          fmtNumber(r.totalTokens),
          `$${r.costUsd.toFixed(4)}`,
          "",
        ].join(" | "),
      );
    }
    lines.push("");

    // Reasons block
    for (const r of rows) {
      if (r.reasons.length === 0) continue;
      lines.push(`**\`${r.model}\` reasons**:`);
      for (const reason of r.reasons) lines.push(`- ${reason}`);
      lines.push("");
    }
  }

  // Session gate snapshot footer
  lines.push("## Session gate context");
  lines.push("");
  const g = card.gateResults;
  lines.push(
    `- Tasks: ${g.tasksCompleted}/${g.tasksTotal} completed, ` +
      `${g.tasksCompletedWithWarnings} warnings, ${g.tasksFailed} failed`,
  );
  lines.push(
    `- Gates: integration=${stateLabel(g.integrationExecuted, g.integrationPassed)}, ` +
      `runtime=${stateLabel(g.runtimeExecuted, g.runtimePassed)}, ` +
      `e2e=${stateLabel(g.e2eExecuted, g.e2ePassed)}`,
  );
  lines.push(
    `- Audit: ${g.auditPassed ? "passed" : "failed"} (uncovered requirements: ${g.uncoveredRequirementCount})`,
  );
  lines.push(
    `- Fix loops: scaffold=${g.scaffoldFixAttempts}, integration=${g.integrationFixAttempts}; ` +
      `truncations=${g.truncationEventCount}, stagnations=${g.stagnationEventCount}, ` +
      `fallbacks=${g.fallbackTriggerCount}`,
  );
  lines.push("");

  // ── Model history section (requires leaderboard data) ─────────────────
  const leaderboard = options.leaderboard ?? [];
  if (leaderboard.length > 0) {
    lines.push("## Model Score History (cross-session)");
    lines.push("");
    lines.push(
      "> Each row shows a model's full score history across sessions for that stage. " +
        "Newest scores are on the right. ↑ = improving, ↓ = declining.",
    );
    lines.push("");

    // Collect models that appear in this session's rows for focused view.
    const sessionModels = new Set(card.rows.map((r) => r.model));
    const relevantBuckets = leaderboard.filter((b) => sessionModels.has(b.model));

    if (relevantBuckets.length === 0) {
      lines.push("_No historical data available yet (first session for these models)._");
      lines.push("");
    } else {
      const byStageHist = new Map<string, LeaderboardBucket[]>();
      for (const b of relevantBuckets) {
        const list = byStageHist.get(b.stage) ?? [];
        list.push(b);
        byStageHist.set(b.stage, list);
      }
      for (const [stage, buckets] of byStageHist.entries()) {
        lines.push(`### Stage \`${stage}\``);
        lines.push("");
        lines.push("| Model | Runs | Avg score | Score history | Trend | Avg cost |");
        lines.push("|---|---|---|---|---|---|");
        for (const b of buckets) {
          const trendArrow =
            b.scoreTrend.length < 2
              ? "—"
              : b.scoreTrend[b.scoreTrend.length - 1] > b.scoreTrend[0]
                ? "↑"
                : b.scoreTrend[b.scoreTrend.length - 1] < b.scoreTrend[0]
                  ? "↓"
                  : "→";
          const isCurrentSession = card.rows.some(
            (r) => r.model === b.model && r.stage === stage,
          );
          const modelLabel = isCurrentSession ? `**\`${b.model}\`** ← this session` : `\`${b.model}\``;
          lines.push(
            [
              "",
              modelLabel,
              String(b.runs),
              `**${b.avgScore.toFixed(1)}**`,
              renderTrend(b.scoreTrend),
              trendArrow,
              `$${b.avgCostUsd.toFixed(4)}`,
              "",
            ].join(" | "),
          );
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// ─── Leaderboard markdown ─────────────────────────────────────────────────

export interface RenderLeaderboardOptions extends AggregateOptions {
  /** Title override — default "Model Leaderboard (project)". */
  title?: string;
}

/** Render the cross-session leaderboard, grouped by stage. */
export function renderLeaderboardMarkdown(
  buckets: LeaderboardBucket[],
  options: RenderLeaderboardOptions = {},
): string {
  const lines: string[] = [];
  lines.push(`# ${options.title ?? "Model Leaderboard (project)"}`);
  lines.push("");
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Rows aggregated: ${buckets.length}`);
  lines.push("");
  lines.push(
    "> Compares models that have been used across sessions. Scores are simple means; " +
      "trend column shows the most recent runs in time order (newest last).",
  );
  lines.push("");

  if (buckets.length === 0) {
    lines.push("_No historical data yet. Run a coding session to populate the leaderboard._");
    return lines.join("\n");
  }

  const byStage = groupByStage(buckets);
  for (const [stage, stageBuckets] of byStage.entries()) {
    lines.push(`## Stage \`${stage}\``);
    lines.push("");
    lines.push(
      "| Model | Runs | Avg Score | Success % | Avg Cost | Median Cost | Avg ms/call | Trend | Last seen |",
    );
    lines.push(
      "|---|---|---|---|---|---|---|---|---|",
    );
    for (const b of stageBuckets) {
      lines.push(
        [
          "",
          `\`${b.model}\``,
          String(b.runs),
          `**${b.avgScore.toFixed(1)}**`,
          `${b.avgSuccessRate.toFixed(1)}%`,
          `$${b.avgCostUsd.toFixed(4)}`,
          `$${b.medianCostUsd.toFixed(4)}`,
          `${b.avgDurationMsPerCall}ms`,
          renderTrend(b.scoreTrend),
          shortTimestamp(b.lastSeenAt),
          "",
        ].join(" | "),
      );
    }
    lines.push("");

    // Head-to-head (pairwise top 2)
    if (stageBuckets.length >= 2) {
      const [a, b] = stageBuckets;
      lines.push(`**Head-to-head — \`${a.model}\` vs \`${b.model}\`**:`);
      lines.push(
        `- Score: ${a.avgScore.toFixed(1)} vs ${b.avgScore.toFixed(1)} ` +
          formatDelta(a.avgScore - b.avgScore),
      );
      lines.push(
        `- Cost:  $${a.avgCostUsd.toFixed(4)} vs $${b.avgCostUsd.toFixed(4)} ` +
          formatDelta(a.avgCostUsd - b.avgCostUsd, "cost"),
      );
      lines.push(
        `- Speed: ${a.avgDurationMsPerCall}ms vs ${b.avgDurationMsPerCall}ms/call ` +
          formatDelta(a.avgDurationMsPerCall - b.avgDurationMsPerCall, "ms"),
      );
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Model-change (diff) markdown ────────────────────────────────────────

export interface RenderChangeOptions {
  /**
   * Leaderboard aggregates — used to pull historical averages for each
   * side of a change (previous vs new model).
   */
  leaderboard?: LeaderboardBucket[];
  /**
   * Stage key → supervisor stage name mapping. Used to look up
   * leaderboard history for a `MODEL_CONFIG` key. Optional.
   */
  configKeyToStage?: Partial<Record<ModelConfigKey, string>>;
}

/**
 * Render the `MODEL_CONFIG` diff. Emits a short, scan-friendly block
 * suitable for embedding at the top of the session report.
 */
export function renderModelChangeMarkdown(
  changes: ModelConfigChange[],
  options: RenderChangeOptions = {},
): string {
  const substantive = changes.filter((c) => c.kind !== "unchanged");
  const lines: string[] = [];
  if (substantive.length === 0) {
    lines.push("## Model changes vs last session");
    lines.push("");
    lines.push("_No `MODEL_CONFIG` changes detected since the previous session._");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("## Model changes vs last session");
  lines.push("");
  lines.push(
    "Detected changes in `MODEL_CONFIG` between this session and the previous one. " +
      "Historical averages pulled from the leaderboard help predict how this switch might affect quality.",
  );
  lines.push("");
  lines.push(
    "| Stage | Change | Previous primary | New primary | Historical comparison |",
  );
  lines.push("|---|---|---|---|---|");

  for (const change of substantive) {
    const prevModel = change.previousPrimary ?? "-";
    const currModel = change.currentPrimary ?? "-";
    const history = computeHistoryComparison(change, options);
    lines.push(
      [
        "",
        `\`${change.stageKey}\``,
        change.kind,
        prevModel !== "-" ? `\`${prevModel}\`` : "—",
        currModel !== "-" ? `\`${currModel}\`` : "—",
        history,
        "",
      ].join(" | "),
    );
  }
  lines.push("");

  // Unchanged (collapsible hint)
  const unchanged = changes.filter((c) => c.kind === "unchanged");
  if (unchanged.length > 0) {
    lines.push(
      `<sub>Unchanged stages: ${unchanged.map((c) => `\`${c.stageKey}\``).join(", ")}</sub>`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

// ─── helpers ──────────────────────────────────────────────────────────────

function stateLabel(executed: boolean, passed: boolean): string {
  if (!executed) return "skipped";
  return passed ? "pass" : "fail";
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function renderTrend(trend: number[]): string {
  if (trend.length === 0) return "—";
  return trend.map((v) => Math.round(v)).join(" → ");
}

function shortTimestamp(iso: string): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function formatDelta(
  diff: number,
  kind: "score" | "cost" | "ms" = "score",
): string {
  const abs = Math.abs(diff);
  if (abs < 0.01) return "(≈ equal)";
  const sign = diff > 0 ? "+" : "-";
  if (kind === "cost") return `(Δ ${sign}$${abs.toFixed(4)})`;
  if (kind === "ms") return `(Δ ${sign}${Math.round(abs)}ms)`;
  return `(Δ ${sign}${abs.toFixed(1)})`;
}

function computeHistoryComparison(
  change: ModelConfigChange,
  options: RenderChangeOptions,
): string {
  const boards = options.leaderboard ?? [];
  if (boards.length === 0) return "_(no history yet)_";
  const stage =
    options.configKeyToStage?.[change.stageKey] ?? change.stageKey;
  const byModel = new Map<string, LeaderboardBucket>();
  for (const b of boards) {
    if (b.stage === stage) byModel.set(b.model, b);
  }
  const partBuckets: string[] = [];
  if (change.previousPrimary) {
    const hist = byModel.get(change.previousPrimary);
    partBuckets.push(
      hist
        ? `${change.previousPrimary}: avg ${hist.avgScore.toFixed(1)} (${hist.runs} runs)`
        : `${change.previousPrimary}: no history`,
    );
  }
  if (change.currentPrimary && change.currentPrimary !== change.previousPrimary) {
    const hist = byModel.get(change.currentPrimary);
    partBuckets.push(
      hist
        ? `${change.currentPrimary}: avg ${hist.avgScore.toFixed(1)} (${hist.runs} runs)`
        : `${change.currentPrimary}: first run`,
    );
  }
  return partBuckets.join(" · ") || "—";
}

// Re-export for tests
export const __internals__ = {
  formatDelta,
  renderTrend,
  computeHistoryComparison,
};

// Ensure the ScoreDimensions import is used by TS so we don't drop it
// on a future refactor; callers of scorecard-markdown rely on row.dimensions
// already typed.
export type _KeepImport = ScoreDimensions;
