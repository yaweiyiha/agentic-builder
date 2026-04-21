/**
 * Task-coverage self-heal.
 *
 * The `runTaskCoverageGate` gate only checks whether the kick-off task list
 * declares coverage (`coversRequirementIds`) of every PRD requirement ID.
 * Historically a failure here was a soft warning that never stopped the
 * pipeline, so PRDs with 20+ uncovered ids would proceed and silently skip
 * whole features.
 *
 * This module runs a bounded self-heal loop:
 *
 *   1. If the gate reports missing ids, call
 *      `TaskBreakdownAgent.generateSupplementaryTasks` with a batch of them.
 *   2. Parse + normalise the response, re-use existing parse/recover helpers.
 *   3. Merge with existing tasks (no renumbering, no collisions on
 *      `files.creates`) and re-evaluate the gate.
 *   4. Repeat up to `MAX_COVERAGE_REPAIR_ATTEMPTS`.
 *
 * The loop always terminates. If ids remain, they are returned as
 * `finalMissing` — the caller decides whether to warn or fail. Telemetry
 * is fully captured via the `RepairEmitter`.
 */

import type { PrdSpec } from "@/lib/requirements/prd-spec-types";
import type { KickoffWorkItem } from "@/lib/pipeline/types";
import type { ProjectTier } from "@/lib/agents";
import { TaskBreakdownAgent } from "@/lib/agents/kickoff/task-breakdown-agent";
import {
  parseJsonArrayFromLlmOutput,
  normalizeOriginalTaskBreakdown,
} from "@/lib/pipeline/kickoff-task-breakdown.server";
import type { RepairEmitter } from "./events";

const DEFAULT_MAX_ATTEMPTS = Number(
  process.env.COVERAGE_REPAIR_MAX_ATTEMPTS ?? "2",
);
const DEFAULT_MAX_MISSING_PER_BATCH = Number(
  process.env.COVERAGE_REPAIR_BATCH_SIZE ?? "15",
);

export interface TaskCoverageRepairInput {
  missingIds: string[];
  existingTasks: KickoffWorkItem[];
  prd: string;
  trd?: string;
  sysDesign?: string;
  implGuide?: string;
  prdSpecText?: string;
  prdSpec?: PrdSpec | null;
  scaffoldBlock?: string;
  tier: ProjectTier;
  sessionId?: string;
  emitter: RepairEmitter;
}

export interface TaskCoverageRepairResult {
  /** All tasks (existing + added), in the order they should appear. */
  tasks: KickoffWorkItem[];
  /** New tasks that the repair loop produced. */
  added: KickoffWorkItem[];
  /** PRD ids still uncovered after all attempts. */
  finalMissing: string[];
  attempts: number;
  costUsd: number;
  durationMs: number;
  rawOutputs: string[];
}

/**
 * Run a bounded self-heal loop to cover missing PRD requirement IDs with
 * additional tasks. Caller must pre-compute `missingIds` from the gate.
 */
export async function repairTaskCoverage(
  input: TaskCoverageRepairInput,
): Promise<TaskCoverageRepairResult> {
  const {
    missingIds,
    existingTasks,
    prd,
    trd,
    sysDesign,
    implGuide,
    prdSpecText,
    scaffoldBlock,
    tier,
    sessionId,
    emitter,
  } = input;

  const result: TaskCoverageRepairResult = {
    tasks: [...existingTasks],
    added: [],
    finalMissing: [...missingIds],
    attempts: 0,
    costUsd: 0,
    durationMs: 0,
    rawOutputs: [],
  };

  if (missingIds.length === 0) return result;

  const agent = new TaskBreakdownAgent(tier, scaffoldBlock);
  const maxAttempts = clampPositiveInt(DEFAULT_MAX_ATTEMPTS, 1, 5);
  const batchSize = clampPositiveInt(DEFAULT_MAX_MISSING_PER_BATCH, 1, 50);

  const alreadyCreates = collectAllCreates(existingTasks);
  const allSeenIds = new Set(existingTasks.map((t) => t.id));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (result.finalMissing.length === 0) break;

    emitter({
      stage: "coverage-gate",
      event: "repair_start",
      attempt,
      missingIds: result.finalMissing,
      details: {
        existingTaskCount: result.tasks.length,
        batchSize,
      },
    });

    const batches = chunk(result.finalMissing, batchSize);
    let addedThisAttempt = 0;

    for (const batch of batches) {
      const startingTaskId = nextTaskId(allSeenIds);
      const start = Date.now();

      let agentResult: Awaited<
        ReturnType<TaskBreakdownAgent["generateSupplementaryTasks"]>
      >;
      try {
        agentResult = await agent.generateSupplementaryTasks(
          {
            missingIds: batch,
            existingTaskSummary: result.tasks.map((t) => ({
              id: t.id,
              phase: t.phase,
              title: t.title,
            })),
            startingTaskId,
            prd,
            trd,
            sysDesign,
            implGuide,
            prdSpecText,
          },
          sessionId,
        );
      } catch (err) {
        emitter({
          stage: "coverage-gate",
          event: "repair_llm_failed",
          attempt,
          missingIds: batch,
          details: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
        continue;
      }

      result.rawOutputs.push(agentResult.content);
      result.costUsd += agentResult.costUsd ?? 0;
      result.durationMs += Date.now() - start;

      const parsed = parseJsonArrayFromLlmOutput(agentResult.content);
      if (parsed.parseFailed || parsed.tasks.length === 0) {
        emitter({
          stage: "coverage-gate",
          event: "repair_parse_failed",
          attempt,
          missingIds: batch,
          details: {
            parseError: parsed.parseError ?? "no tasks parsed",
          },
        });
        continue;
      }

      const newTasks = parsed.tasks.filter((t) => !allSeenIds.has(t.id));
      const droppedCollisions = parsed.tasks.length - newTasks.length;
      if (droppedCollisions > 0) {
        emitter({
          stage: "coverage-gate",
          event: "id_collision_dropped",
          attempt,
          details: { dropped: droppedCollisions },
        });
      }

      // Demote a new task's "creates" to "modifies" if another task already
      // creates that path — prevents two tasks fighting over one file.
      const adjusted = newTasks.map((t) =>
        remapCreatesToModifies(t, alreadyCreates),
      );

      const normalized = normalizeOriginalTaskBreakdown(adjusted, prd);
      for (const t of normalized) {
        allSeenIds.add(t.id);
        extendCreatesSet(alreadyCreates, t);
        result.tasks.push(t);
        result.added.push(t);
        addedThisAttempt++;
      }
    }

    // Recompute the uncovered set from the post-merge coverage declarations.
    const coveredNow = new Set<string>();
    for (const t of result.tasks) {
      for (const id of t.coversRequirementIds ?? []) {
        coveredNow.add(String(id).toUpperCase());
      }
    }
    const stillMissing = result.finalMissing.filter(
      (id) => !coveredNow.has(String(id).toUpperCase()),
    );

    emitter({
      stage: "coverage-gate",
      event: "repair_done",
      attempt,
      repairedIds: result.finalMissing.filter(
        (id) => coveredNow.has(String(id).toUpperCase()),
      ),
      stillMissing,
      details: { addedThisAttempt },
    });

    result.attempts = attempt;
    result.finalMissing = stillMissing;

    // If the model produced nothing new, further attempts are unlikely to help.
    if (addedThisAttempt === 0) break;
  }

  emitter({
    stage: "coverage-gate",
    event: "repair_final_state",
    attempt: result.attempts,
    stillMissing: result.finalMissing,
    details: {
      addedTotal: result.added.length,
      costUsd: result.costUsd,
    },
  });

  return result;
}

// ─── helpers ─────────────────────────────────────────────────────────────

function clampPositiveInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n) || n <= 0) return lo;
  return Math.min(Math.max(Math.floor(n), lo), hi);
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function nextTaskId(seen: Set<string>): string {
  let max = 0;
  for (const id of seen) {
    const m = /^T-(\d+)$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  return `T-${String(next).padStart(3, "0")}`;
}

function collectAllCreates(tasks: KickoffWorkItem[]): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) {
    const plan = t.files;
    if (!plan) continue;
    if (Array.isArray(plan)) continue;
    if (typeof plan !== "object") continue;
    const creates = (plan as unknown as Record<string, unknown>).creates;
    if (!Array.isArray(creates)) continue;
    for (const f of creates) {
      if (typeof f === "string" && f.trim()) out.add(f.trim());
    }
  }
  return out;
}

function extendCreatesSet(set: Set<string>, task: KickoffWorkItem): void {
  const plan = task.files;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return;
  const creates = (plan as unknown as Record<string, unknown>).creates;
  if (!Array.isArray(creates)) return;
  for (const f of creates) {
    if (typeof f === "string" && f.trim()) set.add(f.trim());
  }
}

/**
 * If a new task's `creates` entry already appears in `existingCreates`,
 * move that entry to `modifies` instead. Prevents ownership conflicts.
 */
function remapCreatesToModifies(
  task: KickoffWorkItem,
  existingCreates: Set<string>,
): KickoffWorkItem {
  const plan = task.files;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return task;
  const record = plan as unknown as Record<string, unknown>;
  const creates = Array.isArray(record.creates)
    ? (record.creates as unknown[]).filter(
        (f): f is string => typeof f === "string",
      )
    : [];
  const modifies = Array.isArray(record.modifies)
    ? (record.modifies as unknown[]).filter(
        (f): f is string => typeof f === "string",
      )
    : [];
  const reads = Array.isArray(record.reads)
    ? (record.reads as unknown[]).filter(
        (f): f is string => typeof f === "string",
      )
    : [];

  const newCreates: string[] = [];
  const movedToModifies: string[] = [];
  for (const f of creates) {
    if (existingCreates.has(f)) {
      movedToModifies.push(f);
    } else {
      newCreates.push(f);
    }
  }
  if (movedToModifies.length === 0) return task;

  return {
    ...task,
    files: {
      creates: newCreates,
      modifies: [...new Set([...modifies, ...movedToModifies])],
      reads,
    },
  };
}
