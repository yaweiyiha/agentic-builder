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
import type { AttemptTracker } from "./attempt-tracker";

const PHASE_REPAIR_SCOPE = { stage: "phase-gate" as const, scopeKey: "backend" };

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
  /** Cross-invocation attempt counter. When omitted, no circuit breaker is
   *  applied (legacy behaviour). When provided, the function returns early
   *  without running the LLM or synthesising a task once attempts ≥ threshold. */
  attemptTracker?: AttemptTracker;
}

export interface PhaseRepairResult {
  tasks: KickoffWorkItem[];
  addedByLlm: KickoffWorkItem[];
  synthetic: KickoffWorkItem | null;
  costUsd: number;
  durationMs: number;
  /** True when the call was short-circuited because the per-session attempt
   *  counter exceeded the circuit-breaker threshold. */
  circuitOpen?: boolean;
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
    attemptTracker,
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

  if (attemptTracker?.isCircuitOpen(PHASE_REPAIR_SCOPE)) {
    out.circuitOpen = true;
    const record = attemptTracker.getRecord(PHASE_REPAIR_SCOPE);
    emitter({
      stage: "phase-gate",
      event: "circuit_open",
      attempt: record?.attempts,
      circuitOpen: true,
      missingIds: targetIds,
      details: {
        missingPhase: "Backend Services",
        reason: "Backend phase repair has exhausted its retry budget for this session; escalating instead of synthesising another placeholder task.",
        lastOutcome: record?.lastOutcome,
      },
    });
    return out;
  }

  const attemptNumber = attemptTracker
    ? await attemptTracker.noteStart(PHASE_REPAIR_SCOPE)
    : 1;

  emitter({
    stage: "phase-gate",
    event: "repair_start",
    attempt: attemptNumber,
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
        const repairedIds = normalized.flatMap(
          (t) => t.coversRequirementIds ?? [],
        );
        emitter({
          stage: "phase-gate",
          event: "repair_done",
          attempt: attemptNumber,
          repairedIds,
          details: { addedByLlm: normalized.length },
        });
        if (attemptTracker) {
          await attemptTracker.noteOutcome(
            PHASE_REPAIR_SCOPE,
            "repaired",
            repairedIds.length > 0 ? repairedIds : ["__backend_phase__"],
          );
        }
        return out;
      }
      emitter({
        stage: "phase-gate",
        event: "repair_no_backend_produced",
        attempt: attemptNumber,
        details: {
          parseFailed: parsed.parseFailed,
          totalParsed: parsed.tasks.length,
        },
      });
    } catch (err) {
      emitter({
        stage: "phase-gate",
        event: "repair_llm_failed",
        attempt: attemptNumber,
        details: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
      if (attemptTracker) {
        await attemptTracker.noteOutcome(PHASE_REPAIR_SCOPE, "errored");
      }
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
    attempt: attemptNumber,
    repairedIds: synthetic.coversRequirementIds ?? [],
    files: [...(synthetic.files as { creates: string[] }).creates],
    details: {
      reason:
        "LLM did not produce a Backend Services task within the repair budget — inserting a placeholder task to guarantee backend generation runs.",
    },
  });

  // Synthetic fallback is a degraded outcome, not a real fix — record it so
  // the next invocation moves closer to the circuit breaker.
  if (attemptTracker) {
    await attemptTracker.noteOutcome(PHASE_REPAIR_SCOPE, "still_missing");
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
