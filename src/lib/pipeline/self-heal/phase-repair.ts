/**
 * Phase-requirement self-heal.
 *
 * When `runPhaseRequirementGate` reports a missing backend phase, we first
 * ask the task-breakdown agent to produce a Backend Services task that
 * covers the previously-uncovered PRD ids. If the model still fails to
 * emit one, we synthesise a minimal placeholder task so there's at least
 * a unit of work — better a marked synthetic task than zero backend code.
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

export interface PhaseRepairInput {
  existingTasks: KickoffWorkItem[];
  prd: string;
  trd?: string;
  sysDesign?: string;
  implGuide?: string;
  prdSpecText?: string;
  prdSpec?: PrdSpec | null;
  scaffoldBlock?: string;
  tier: ProjectTier;
  /** PRD ids that could be the "home" for the synthetic backend task. */
  uncoveredIds?: string[];
  sessionId?: string;
  emitter: RepairEmitter;
}

export interface PhaseRepairResult {
  tasks: KickoffWorkItem[];
  addedByLlm: KickoffWorkItem[];
  synthetic: KickoffWorkItem | null;
  costUsd: number;
  durationMs: number;
}

const MAX_ATTEMPTS = 1;

export async function repairMissingBackendPhase(
  input: PhaseRepairInput,
): Promise<PhaseRepairResult> {
  const {
    existingTasks,
    prd,
    trd,
    sysDesign,
    implGuide,
    prdSpecText,
    scaffoldBlock,
    tier,
    uncoveredIds,
    sessionId,
    emitter,
  } = input;

  const out: PhaseRepairResult = {
    tasks: [...existingTasks],
    addedByLlm: [],
    synthetic: null,
    costUsd: 0,
    durationMs: 0,
  };

  const startingTaskId = nextTaskId(new Set(existingTasks.map((t) => t.id)));
  const targetIds =
    uncoveredIds && uncoveredIds.length > 0
      ? uncoveredIds.slice(0, 25)
      : deriveBackendAnchorIds(prd);

  emitter({
    stage: "phase-gate",
    event: "repair_start",
    attempt: 1,
    missingIds: targetIds,
    details: { missingPhase: "Backend Services" },
  });

  if (MAX_ATTEMPTS >= 1 && targetIds.length > 0) {
    const agent = new TaskBreakdownAgent(tier, scaffoldBlock);
    const start = Date.now();
    try {
      const resp = await agent.generateSupplementaryTasks(
        {
          missingIds: targetIds,
          existingTaskSummary: existingTasks.map((t) => ({
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
      out.costUsd += resp.costUsd ?? 0;
      out.durationMs += Date.now() - start;

      const parsed = parseJsonArrayFromLlmOutput(resp.content);
      const backendTasks = parsed.tasks.filter((t) =>
        isBackendLikePhase(t.phase),
      );
      if (backendTasks.length > 0) {
        const normalized = normalizeOriginalTaskBreakdown(backendTasks, prd);
        out.addedByLlm = normalized;
        out.tasks = [...existingTasks, ...normalized];
        emitter({
          stage: "phase-gate",
          event: "repair_done",
          attempt: 1,
          repairedIds: normalized.flatMap(
            (t) => t.coversRequirementIds ?? [],
          ),
          details: { addedByLlm: normalized.length },
        });
        return out;
      }
      emitter({
        stage: "phase-gate",
        event: "repair_no_backend_produced",
        attempt: 1,
        details: {
          parseFailed: parsed.parseFailed,
          totalParsed: parsed.tasks.length,
        },
      });
    } catch (err) {
      emitter({
        stage: "phase-gate",
        event: "repair_llm_failed",
        attempt: 1,
        details: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // Synthetic fallback — guarantee at least one backend task exists.
  const syntheticId = nextTaskId(new Set(out.tasks.map((t) => t.id)));
  const synthetic: KickoffWorkItem = {
    id: syntheticId,
    phase: "Backend Services",
    title: "Implement backend API endpoints (auto-synthesized)",
    description:
      "Synthesized placeholder: generate Koa routes, controllers and services for every PRD-documented endpoint. Add request validation and wire into the app router. This task was auto-created by the phase-requirement self-heal because the original task breakdown produced no Backend Services task.",
    estimatedHours: 6,
    executionKind: "ai_autonomous",
    files: {
      creates: [
        "backend/src/api/modules/autogen/routes.ts",
        "backend/src/api/modules/autogen/controller.ts",
        "backend/src/api/modules/autogen/service.ts",
      ],
      modifies: ["backend/src/api/modules/index.ts"],
      reads: [],
    },
    dependencies: [],
    priority: "P0",
    coversRequirementIds: targetIds,
    acceptanceCriteria: [
      "Every PRD-documented endpoint has a real handler wired into the Koa app.",
      "Request bodies are validated before reaching the service layer.",
    ],
  };
  out.synthetic = synthetic;
  out.tasks = [...out.tasks, synthetic];

  emitter({
    stage: "phase-gate",
    event: "synthetic_task_inserted",
    attempt: 1,
    repairedIds: synthetic.coversRequirementIds ?? [],
    files: [...(synthetic.files as { creates: string[] }).creates],
    details: {
      reason:
        "LLM did not produce a Backend Services task within the repair budget — inserting a placeholder task to guarantee backend generation runs.",
    },
  });

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
  return `T-${String(max + 1).padStart(3, "0")}`;
}

function isBackendLikePhase(phase: string | undefined): boolean {
  if (!phase) return false;
  const p = phase.toLowerCase();
  return (
    p.includes("backend") ||
    p.includes("data layer") ||
    p.includes("api") ||
    p.includes("auth") ||
    p.includes("service")
  );
}

/**
 * Pull PRD ids from the raw PRD text as last-resort anchors for the
 * synthetic task's `coversRequirementIds`. Keeps the synthetic task tied
 * to something meaningful rather than free-floating.
 */
function deriveBackendAnchorIds(prd: string): string[] {
  const ids = new Set<string>();
  const re = /\b(?:AC|FR|US|IC)-[A-Z0-9]+(?:-[A-Z0-9]+)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prd)) !== null) {
    ids.add(m[0].toUpperCase());
    if (ids.size >= 10) break;
  }
  return [...ids];
}
