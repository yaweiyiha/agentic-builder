/**
 * Convert per-task migration-coverage gaps (recorded in
 * `<outputDir>/.ralph/migration-coverage.json` by the agent-subgraph
 * worker hook) into deterministic repair-task descriptors that the
 * supervisor's verify-fix worker can pick up.
 *
 * Closes the loop opened by `migration-coverage.ts`: that file *detects*
 * gaps as workers run; this file converts them into actionable work
 * before the runtime-integration-audit phase tries to start a server
 * with a missing column.
 */

import fs from "fs/promises";
import path from "path";

import type { RepairEmitter } from "./events";

interface ReportEntry {
  taskId: string;
  taskTitle: string;
  ok: boolean;
  modelFilesTouched: string[];
  migrationFilesTouched: string[];
  gaps: { modelPath: string; modelName: string; instruction: string }[];
  checkedAt: string;
}

interface CoverageReport {
  version: number;
  updatedAt: string;
  tasks: Record<string, ReportEntry>;
}

export interface MigrationRepairTask {
  /** Stable id derived from the originating task + modelName. */
  id: string;
  /** Source task that introduced the gap. */
  sourceTaskId: string;
  /** Model file the worker modified without writing a migration. */
  modelPath: string;
  modelName: string;
  /** Pre-formatted directive to embed in the worker's instruction. */
  directive: string;
}

export interface MigrationCoverageRepairInput {
  outputDir: string;
  emitter?: RepairEmitter | null;
  sessionId?: string;
}

export interface MigrationCoverageRepairResult {
  /** Total gaps observed across all tasks (sum over tasks). */
  totalGaps: number;
  /** Number of distinct source tasks that have gaps. */
  tasksWithGaps: number;
  /** Repair-task descriptors, one per gap. */
  pendingRepairTasks: MigrationRepairTask[];
  /** True when no report file existed (no models touched yet). */
  reportMissing: boolean;
}

const REPORT_RELATIVE = ".ralph/migration-coverage.json";

export async function runMigrationCoverageRepair(
  input: MigrationCoverageRepairInput,
): Promise<MigrationCoverageRepairResult> {
  const reportPath = path.join(input.outputDir, REPORT_RELATIVE);
  let raw: string;
  try {
    raw = await fs.readFile(reportPath, "utf8");
  } catch {
    return {
      totalGaps: 0,
      tasksWithGaps: 0,
      pendingRepairTasks: [],
      reportMissing: true,
    };
  }

  let report: CoverageReport;
  try {
    report = JSON.parse(raw);
  } catch {
    return {
      totalGaps: 0,
      tasksWithGaps: 0,
      pendingRepairTasks: [],
      reportMissing: false,
    };
  }
  if (!report || typeof report.tasks !== "object") {
    return {
      totalGaps: 0,
      tasksWithGaps: 0,
      pendingRepairTasks: [],
      reportMissing: false,
    };
  }

  const pendingRepairTasks: MigrationRepairTask[] = [];
  let tasksWithGaps = 0;
  for (const entry of Object.values(report.tasks)) {
    if (!entry || entry.ok || !Array.isArray(entry.gaps) || entry.gaps.length === 0) {
      continue;
    }
    tasksWithGaps++;
    for (const gap of entry.gaps) {
      pendingRepairTasks.push({
        id: `migration-repair-${entry.taskId}-${gap.modelName}`,
        sourceTaskId: entry.taskId,
        modelPath: gap.modelPath,
        modelName: gap.modelName,
        directive: gap.instruction,
      });
    }
  }

  if (input.emitter && pendingRepairTasks.length > 0) {
    try {
      input.emitter({
        sessionId: input.sessionId,
        stage: "post-gen-audit",
        event: "migration-coverage-gaps",
        details: {
          totalGaps: pendingRepairTasks.length,
          tasksWithGaps,
          taskIds: Array.from(
            new Set(pendingRepairTasks.map((t) => t.sourceTaskId)),
          ),
        },
      });
    } catch {
      // Telemetry must never break the pipeline.
    }
  }

  return {
    totalGaps: pendingRepairTasks.length,
    tasksWithGaps,
    pendingRepairTasks,
    reportMissing: false,
  };
}

/** Render the repair tasks as a Markdown checklist for the verify-fix
 *  worker's opening user message — mirrors the contract-usage-coverage
 *  block style so the worker sees a consistent format across audits. */
export function formatMigrationCoverageBlock(
  result: MigrationCoverageRepairResult,
): string {
  if (result.pendingRepairTasks.length === 0) return "";

  const lines: string[] = ["", "## Migration coverage repair"];
  lines.push(
    `Detected ${result.totalGaps} Sequelize model file(s) modified without a corresponding migration across ${result.tasksWithGaps} task(s). Each entry below is a deterministic repair instruction — execute them all before the runtime audit re-runs.`,
  );
  lines.push("");
  for (const t of result.pendingRepairTasks.slice(0, 12)) {
    lines.push(`  - [backend] ${t.modelPath} — ${t.directive}`);
  }
  if (result.pendingRepairTasks.length > 12) {
    lines.push(
      `  - … (+${result.pendingRepairTasks.length - 12} more, full list in .ralph/migration-coverage.json)`,
    );
  }
  return lines.join("\n");
}
