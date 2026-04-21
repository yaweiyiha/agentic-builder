/**
 * Feature-audit repair dispatcher.
 *
 * After the post-generation audit identifies PRD ids whose implementation
 * could not be confirmed, this module synthesises a one-shot "backfill"
 * coding task per role (backend / frontend) and runs it through the
 * existing worker sub-graph. The goal is to give the pipeline a final
 * chance to produce the missing artefacts without requiring a full re-run.
 *
 * Scope is intentionally narrow:
 *   • Single dispatch round (no recursion).
 *   • Existing scaffold protection + file-plan verification still apply.
 *   • On failure / timeout, the audit report already explains what's
 *     uncovered — the dispatcher is best-effort.
 */

import { createWorkerSubGraph } from "@/lib/langgraph/agent-subgraph";
import type { ApiContract, GeneratedFile, WorkerState } from "@/lib/langgraph/state";
import type {
  CodingAgentRole,
  CodingTask,
  RalphConfig,
} from "@/lib/pipeline/types";
import { DEFAULT_RALPH_CONFIG } from "@/lib/pipeline/types";
import type { AuditEntry, AuditTaskSummary } from "./feature-checklist-audit";
import type { RepairEmitter } from "./events";

const FRONTEND_ID_PREFIX = /^(PAGE|CMP|IC)-/i;

const DISPATCH_ENABLED = (() => {
  const raw = (process.env.AUDIT_REPAIR_DISPATCH_ENABLED ?? "1")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
})();

export interface AuditRepairDispatchInput {
  uncovered: AuditEntry[];
  outputDir: string;
  projectContext: string;
  fileRegistrySnapshot?: GeneratedFile[];
  apiContractsSnapshot?: ApiContract[];
  scaffoldProtectedPaths?: string[];
  ralphConfig?: RalphConfig;
  sessionId?: string;
  emitter: RepairEmitter;
}

export interface AuditRepairDispatchResult {
  ranFrontend: boolean;
  ranBackend: boolean;
  backendGeneratedFiles: string[];
  frontendGeneratedFiles: string[];
  repairTasks: CodingTask[];
  repairTaskResults: AuditTaskSummary[];
  costUsd: number;
}

export async function dispatchAuditRepair(
  input: AuditRepairDispatchInput,
): Promise<AuditRepairDispatchResult> {
  const {
    uncovered,
    outputDir,
    projectContext,
    fileRegistrySnapshot,
    apiContractsSnapshot,
    scaffoldProtectedPaths,
    ralphConfig,
    sessionId,
    emitter,
  } = input;

  const result: AuditRepairDispatchResult = {
    ranFrontend: false,
    ranBackend: false,
    backendGeneratedFiles: [],
    frontendGeneratedFiles: [],
    repairTasks: [],
    repairTaskResults: [],
    costUsd: 0,
  };

  if (!DISPATCH_ENABLED) {
    emitter({
      stage: "post-gen-audit",
      event: "dispatch_disabled",
      details: {
        reason: "AUDIT_REPAIR_DISPATCH_ENABLED is off — skipping dispatcher.",
      },
    });
    return result;
  }
  if (uncovered.length === 0) return result;

  const frontendEntries = uncovered.filter((e) => FRONTEND_ID_PREFIX.test(e.id));
  const backendEntries = uncovered.filter((e) => !FRONTEND_ID_PREFIX.test(e.id));

  emitter({
    stage: "post-gen-audit",
    event: "repair_dispatch_start",
    missingIds: uncovered.map((e) => e.id),
    details: {
      frontend: frontendEntries.length,
      backend: backendEntries.length,
    },
  });

  const workerGraph = createWorkerSubGraph();
  const config = ralphConfig ?? { ...DEFAULT_RALPH_CONFIG };

  if (backendEntries.length > 0) {
    const task = buildRepairTask("backend", backendEntries);
    result.repairTasks.push(task);
    try {
      const res = await workerGraph.invoke(
        buildWorkerInput({
          role: "backend",
          task,
          outputDir,
          projectContext,
          fileRegistrySnapshot,
          apiContractsSnapshot,
          scaffoldProtectedPaths,
          ralphConfig: config,
          sessionId,
        }),
        { recursionLimit: 60 },
      );
      const ws = res as WorkerState;
      result.ranBackend = true;
      result.backendGeneratedFiles = collectFilesFromWorkerResult(ws);
      result.repairTaskResults.push(buildRepairTaskSummary(task, ws));
      result.costUsd += ws.workerCostUsd ?? 0;
      emitter({
        stage: "post-gen-audit",
        event: "repair_dispatch_role_done",
        details: {
          role: "backend",
          filesWritten: result.backendGeneratedFiles.length,
          taskId: task.id,
        },
      });
    } catch (err) {
      emitter({
        stage: "post-gen-audit",
        event: "repair_dispatch_role_failed",
        details: {
          role: "backend",
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  if (frontendEntries.length > 0) {
    const task = buildRepairTask("frontend", frontendEntries);
    result.repairTasks.push(task);
    try {
      const res = await workerGraph.invoke(
        buildWorkerInput({
          role: "frontend",
          task,
          outputDir,
          projectContext,
          fileRegistrySnapshot,
          apiContractsSnapshot,
          scaffoldProtectedPaths,
          ralphConfig: config,
          sessionId,
        }),
        { recursionLimit: 60 },
      );
      const ws = res as WorkerState;
      result.ranFrontend = true;
      result.frontendGeneratedFiles = collectFilesFromWorkerResult(ws);
      result.repairTaskResults.push(buildRepairTaskSummary(task, ws));
      result.costUsd += ws.workerCostUsd ?? 0;
      emitter({
        stage: "post-gen-audit",
        event: "repair_dispatch_role_done",
        details: {
          role: "frontend",
          filesWritten: result.frontendGeneratedFiles.length,
          taskId: task.id,
        },
      });
    } catch (err) {
      emitter({
        stage: "post-gen-audit",
        event: "repair_dispatch_role_failed",
        details: {
          role: "frontend",
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  emitter({
    stage: "post-gen-audit",
    event: "repair_dispatch_done",
    details: {
      totalFiles:
        result.backendGeneratedFiles.length +
        result.frontendGeneratedFiles.length,
      costUsd: result.costUsd,
    },
  });

  return result;
}

function buildRepairTask(
  role: CodingAgentRole,
  entries: AuditEntry[],
): CodingTask {
  const id = `T-REPAIR-${role.toUpperCase()}`;
  const ids = entries.map((e) => e.id);
  const phase =
    role === "frontend" ? "Frontend" : "Backend Services";

  const description = [
    `The post-generation feature audit reported that these PRD requirement IDs are`,
    `not implemented in the current codebase:`,
    "",
    ...entries.map((e) => {
      const ev = e.evidence.length > 0 ? ` (evidence: ${e.evidence[0]})` : "";
      return `- \`${e.id}\` — ${e.verdict}: ${e.reason}${ev}`;
    }),
    "",
    `Your task is a TARGETED backfill. Read the project context and existing`,
    `code before writing anything. For each uncovered id:`,
    ``,
    `  1. Locate the most appropriate existing file (controller, router,`,
    `     view, service, model) and extend it in place where possible.`,
    `  2. Only create new files when there is no plausible existing home.`,
    `  3. Do NOT rewrite or delete code that already implements OTHER PRD`,
    `     requirements — this is an additive backfill.`,
    `  4. Do NOT modify scaffold files listed in scaffoldProtectedPaths.`,
    ``,
    `Use real endpoints / routes / types already present in the project.`,
    `For frontend backfill, read \`frontend/src/api/client.ts\` and any`,
    `backend route files to discover real endpoints before coding.`,
  ].join("\n");

  return {
    id,
    phase,
    title: `Backfill uncovered features (${role}): ${ids.slice(0, 4).join(", ")}${ids.length > 4 ? ` …+${ids.length - 4}` : ""}`,
    description,
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    files: {
      creates: [],
      modifies: [],
      reads: [],
    },
    dependencies: [],
    priority: "P0",
    coversRequirementIds: ids,
    assignedAgentId: null,
    codingStatus: "pending",
  };
}

interface BuildWorkerInputArgs {
  role: CodingAgentRole;
  task: CodingTask;
  outputDir: string;
  projectContext: string;
  fileRegistrySnapshot?: GeneratedFile[];
  apiContractsSnapshot?: ApiContract[];
  scaffoldProtectedPaths?: string[];
  ralphConfig: RalphConfig;
  sessionId?: string;
}

function buildWorkerInput(args: BuildWorkerInputArgs): Partial<WorkerState> {
  return {
    role: args.role,
    workerLabel: `Audit Backfill (${args.role})`,
    tasks: [args.task],
    outputDir: args.outputDir,
    projectContext: args.projectContext,
    fileRegistrySnapshot: args.fileRegistrySnapshot ?? [],
    apiContractsSnapshot: args.apiContractsSnapshot ?? [],
    scaffoldProtectedPaths: args.scaffoldProtectedPaths ?? [],
    currentTaskIndex: 0,
    ralphConfig: args.ralphConfig,
    sessionId: args.sessionId ?? "",
  };
}

function collectFilesFromWorkerResult(ws: WorkerState): string[] {
  const out = new Set<string>();
  for (const tr of ws.taskResults ?? []) {
    for (const f of tr.generatedFiles ?? []) out.add(f);
  }
  for (const f of ws.generatedFiles ?? []) out.add(f.path);
  return [...out];
}

function buildRepairTaskSummary(
  task: CodingTask,
  ws: WorkerState,
): AuditTaskSummary {
  const primaryResult = (ws.taskResults ?? []).find((item) => item.taskId === task.id);
  return {
    id: task.id,
    title: task.title,
    coversRequirementIds: task.coversRequirementIds ?? [],
    generatedFiles: primaryResult?.generatedFiles ?? collectFilesFromWorkerResult(ws),
    status: primaryResult?.status ?? "unknown",
  };
}

