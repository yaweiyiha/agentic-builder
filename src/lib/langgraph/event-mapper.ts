/**
 * EventMapper: translates raw LangGraph stream chunks into typed SSE events
 * understood by coding-store.ts.
 *
 * LangGraph streams chunks as [namespace[], updates] where:
 *   - namespace = [] for top-level supervisor updates
 *   - namespace = ["be_worker"] or ["be_worker:uuid"] for worker subgraph updates
 *   - updates = { nodeName: nodeReturnValue } for the current step
 */

import type { CodingTask } from "@/lib/pipeline/types";

export type ErrorCategory =
  | "client_disconnect"
  | "timeout"
  | "llm_error"
  | "graph_error"
  | "unknown";

// ─── Internal tracker per worker subgraph instance ───

interface WorkerTracker {
  agentId: string;
  role: string;
  label: string;
  lastKnownTaskId: string | null;
}

// ─── Typed SSE event (matches coding-store.ts IncomingPayload) ───

interface SseEvent {
  type: string;
  sessionId?: string;
  agentId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

// ─── Extracted task result from node update ───

interface ExtractedTaskResult {
  taskId: string;
  status?: string;
  generatedFiles?: string[];
  costUsd?: number;
  fixCycles?: number;
  warnings?: unknown[];
  tokenUsage?: unknown;
  subSteps?: unknown[];
}

export class EventMapper {
  private readonly sessionId: string;

  /** map from namespace-key → worker tracker */
  private readonly workers = new Map<string, WorkerTracker>();

  /** counts per parent-node base name, for numbering parallel instances */
  private readonly instanceCounts = new Map<string, number>();

  /** workers for which we've already emitted agent_completed */
  private readonly completedWorkers = new Set<string>();

  /** tasks for which we've already emitted agent_task_start */
  private readonly startedTasks = new Set<string>();

  /** how many integration fix passes we've seen */
  private integrationFixAttempts = 0;

  /** true once integration_verify_start has been emitted */
  private integrationVerifyStartEmitted = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  buildSessionStart(tasks: CodingTask[]): SseEvent {
    return {
      type: "session_start",
      sessionId: this.sessionId,
      data: { tasks },
    };
  }

  buildSessionComplete(): SseEvent {
    return { type: "session_complete", sessionId: this.sessionId };
  }

  buildSessionError(message: string, category: ErrorCategory): SseEvent {
    return {
      type: "session_error",
      sessionId: this.sessionId,
      data: { error: message, errorCategory: category },
    };
  }

  /**
   * Translate one LangGraph stream chunk into zero or more SSE events.
   * Returns an empty array for chunks that produce no meaningful events.
   */
  mapChunk(chunk: [string[], Record<string, unknown>]): SseEvent[] {
    const [ns, updates] = chunk;
    const events: SseEvent[] = [];

    if (ns.length === 0) {
      this.handleSupervisorUpdate(updates, events);
    } else {
      // Use the full joined namespace as a stable identity for this worker instance.
      const nsKey = ns.join("|");
      // The first segment names the parent supervisor node (e.g. "be_worker:abc123").
      const parentNode = ns[0] ?? "";
      this.handleWorkerUpdate(nsKey, parentNode, updates, events);
    }

    return events;
  }

  // ─── Supervisor node → human-readable log line ────────────────────────────

  private buildSupervisorLogMessage(
    nodeName: string,
    update: Record<string, unknown>,
  ): string | null {
    const errorLines = (text: string) =>
      text.split("\n").filter((l) => l.includes("error TS") || l.includes("[CONVENTION]")).length;

    switch (nodeName) {
      case "classify_tasks": {
        const arch = Array.isArray(update.architectTasks) ? update.architectTasks.length : 0;
        const be = Array.isArray(update.backendTasks) ? update.backendTasks.length : 0;
        const fe = Array.isArray(update.frontendTasks) ? update.frontendTasks.length : 0;
        const te = Array.isArray(update.testTasks) ? update.testTasks.length : 0;
        return `Tasks assigned — Architect: ${arch}, Backend: ${be}, Frontend: ${fe}, Test: ${te}`;
      }
      case "architect_phase":
        return "Architect phase complete";
      case "dispatch_gate":
        return "Dispatching backend and frontend workers...";
      case "dependency_baseline":
        return "Dependency baseline planned (DEPENDENCY_PLAN.md written)";
      case "generate_api_contracts":
        return "API contracts generated";
      case "bootstrap_shared_contracts":
        return "Shared contracts bootstrapped";
      case "generate_service_skeletons":
        return "Service skeletons generated";
      case "scaffold_verify": {
        const errors = update.scaffoldErrors as string | undefined;
        if (!errors) return "Scaffold verify: passed";
        return `Scaffold verify: ${errorLines(errors)} error(s) found`;
      }
      case "scaffold_fix": {
        const files = Array.isArray(update.fileRegistry) ? update.fileRegistry.length : 0;
        return `Scaffold fix: wrote ${files} file(s)`;
      }
      case "be_phase_verify": {
        const errors = update.scaffoldErrors as string | undefined;
        const iters = update.scaffoldFixAttempts as number | undefined;
        if (!errors) return `Backend verify+fix: passed${iters ? ` (${iters} iteration(s))` : ""}`;
        return `Backend verify+fix: ${errorLines(errors)} error(s) remaining after ${iters ?? 0} iteration(s)`;
      }
      case "fe_phase_verify": {
        const errors = update.scaffoldErrors as string | undefined;
        const iters = update.scaffoldFixAttempts as number | undefined;
        if (!errors) return `Frontend verify+fix: passed${iters ? ` (${iters} iteration(s))` : ""}`;
        return `Frontend verify+fix: ${errorLines(errors)} error(s) remaining after ${iters ?? 0} iteration(s)`;
      }
      case "sync_deps":
        return "Dependencies synced";
      case "be_worker":
        return "Backend worker phase complete";
      case "fe_worker":
        return "Frontend worker phase complete";
      case "refine_task_breakdown": {
        const done = update.taskRefinementDone as boolean | undefined;
        if (done) return "Task breakdown refined with scaffold context";
        return "Refining task breakdown...";
      }
      // integration_verify is now the merged agentic verify+fix node
      case "integration_verify": {
        const errors = update.integrationErrors as string | undefined;
        const iters = update.integrationFixAttempts as number | undefined;
        const iterStr = iters !== undefined ? ` (${iters} iteration(s))` : "";
        if (!errors) return `Integration verify+fix: passed${iterStr}`;
        return `Integration verify+fix: ${errorLines(errors)} error(s) remaining${iterStr}`;
      }
      case "gap_analysis": {
        const tasks = update.supplementaryTasks as unknown[] | undefined;
        if (!tasks || tasks.length === 0) return "Gap analysis: no critical gaps found";
        return `Gap analysis: ${tasks.length} supplementary task(s) identified`;
      }
      case "supplementary_worker":
        return "Supplementary worker phase complete";
      case "supplementary_verify":
        return "Supplementary verification complete";
      case "supplementary_dispatch_gate":
        return "Dispatching supplementary workers...";
      default:
        return null;
    }
  }

  // ─── Supervisor-level updates (ns = []) ────────────────────────────────────

  private handleSupervisorUpdate(
    updates: Record<string, unknown>,
    events: SseEvent[],
  ): void {
    // classify_tasks → tasks_assigned ----------------------------------------
    const classified = updates.classify_tasks as
      | Record<string, unknown>
      | undefined;
    if (classified) {
      const assignments: { agentId: string; taskIds: string[] }[] = [];

      const addGroup = (tasks: unknown, roleId: string) => {
        if (!Array.isArray(tasks) || tasks.length === 0) return;
        assignments.push({
          agentId: `supervisor-${roleId}`,
          taskIds: tasks
            .map((t) =>
              typeof t === "object" && t !== null
                ? (t as Record<string, unknown>).id
                : null,
            )
            .filter((id): id is string => typeof id === "string"),
        });
      };

      addGroup(classified.architectTasks, "architect");
      addGroup(classified.backendTasks, "backend");
      addGroup(classified.frontendTasks, "frontend");
      addGroup(classified.testTasks, "test");

      if (assignments.length > 0) {
        events.push({
          type: "tasks_assigned",
          sessionId: this.sessionId,
          data: { assignments },
        });
      }
    }

    // dispatch_gate completing → task refinement is about to start
    if (updates.dispatch_gate !== undefined) {
      events.push({
        type: "task_refinement_start",
        sessionId: this.sessionId,
        data: {},
      });
    }

    // refine_task_breakdown → task_refinement events --------------------------
    const refineUpdate = updates.refine_task_breakdown as
      | Record<string, unknown>
      | undefined;
    if (refineUpdate) {
      const refinedBe = Array.isArray(refineUpdate.backendTasks)
        ? refineUpdate.backendTasks.length
        : 0;
      const refinedFe = Array.isArray(refineUpdate.frontendTasks)
        ? refineUpdate.frontendTasks.length
        : 0;
      const refinedTest = Array.isArray(refineUpdate.testTasks)
        ? refineUpdate.testTasks.length
        : 0;
      events.push({
        type: "task_refinement_complete",
        sessionId: this.sessionId,
        data: {
          backendCount: refinedBe,
          frontendCount: refinedFe,
          testCount: refinedTest,
          refinedTasks: [
            ...(Array.isArray(refineUpdate.backendTasks) ? refineUpdate.backendTasks : []),
            ...(Array.isArray(refineUpdate.frontendTasks) ? refineUpdate.frontendTasks : []),
            ...(Array.isArray(refineUpdate.testTasks) ? refineUpdate.testTasks : []),
          ],
        },
      });
    }

    // integration_verify completing → gap analysis is about to start
    if (updates.integration_verify !== undefined) {
      events.push({
        type: "gap_analysis_start",
        sessionId: this.sessionId,
        data: {},
      });
    }

    // gap_analysis → gap analysis events ---------------------------------------
    const gapUpdate = updates.gap_analysis as
      | Record<string, unknown>
      | undefined;
    if (gapUpdate) {
      const supTasks = Array.isArray(gapUpdate.supplementaryTasks)
        ? gapUpdate.supplementaryTasks
        : [];
      events.push({
        type: "gap_analysis_complete",
        sessionId: this.sessionId,
        data: {
          gapCount: supTasks.length,
          supplementaryTasks: supTasks,
        },
      });
    }

    // supplementary_dispatch_gate → dispatch event
    if (updates.supplementary_dispatch_gate !== undefined) {
      events.push({
        type: "supplementary_dispatch",
        sessionId: this.sessionId,
        data: {},
      });
    }

    // Phase nodes finishing → agent_completed for their workers ---------------
    const phaseNodes = ["be_worker", "fe_worker", "architect_phase", "supplementary_worker"] as const;
    for (const phaseNode of phaseNodes) {
      const phaseResult = updates[phaseNode] as Record<string, unknown> | undefined;
      if (phaseResult && Array.isArray(phaseResult.phaseResults)) {
        // Emit task-level events for prebuilt scaffold (architect tasks completed without LLM)
        if (phaseNode === "architect_phase") {
          this.emitArchitectTaskEvents(phaseResult, events);
        }

        for (const [nsKey, worker] of this.workers) {
          if (
            !this.completedWorkers.has(nsKey) &&
            this.matchesPhaseNode(nsKey, phaseNode)
          ) {
            this.completedWorkers.add(nsKey);
            events.push({
              type: "agent_completed",
              sessionId: this.sessionId,
              agentId: worker.agentId,
              data: { status: "completed" },
            });
          }
        }
      }
    }

    // integration_verify → merged agentic verify+fix result ------------------
    const verifyUpdate = updates.integration_verify as
      | Record<string, unknown>
      | undefined;
    if (verifyUpdate !== undefined) {
      if (!this.integrationVerifyStartEmitted) {
        this.integrationVerifyStartEmitted = true;
        events.push({
          type: "integration_verify_start",
          sessionId: this.sessionId,
        });
      }

      if (typeof verifyUpdate.integrationErrors === "string") {
        const errors = verifyUpdate.integrationErrors;
        const passed = errors === "";
        const errorLineCount = passed
          ? 0
          : errors
              .split("\n")
              .filter(
                (l) =>
                  l.includes("error TS") || l.includes("[CONVENTION]"),
              ).length;
        const iterations =
          typeof verifyUpdate.integrationFixAttempts === "number"
            ? verifyUpdate.integrationFixAttempts
            : this.integrationFixAttempts;

        events.push({
          type: "integration_verify_result",
          sessionId: this.sessionId,
          data: {
            passed,
            errors: passed ? undefined : errors,
            errorCount: errorLineCount > 0 ? errorLineCount : undefined,
            fixAttempts: iterations,
            maxFixAttempts: 80,
          },
        });
      }
    }

    // supervisor_log — emit a human-readable log line for every supervisor node
    for (const [nodeName, nodeUpdate] of Object.entries(updates)) {
      const message = this.buildSupervisorLogMessage(
        nodeName,
        typeof nodeUpdate === "object" && nodeUpdate !== null
          ? (nodeUpdate as Record<string, unknown>)
          : {},
      );
      if (message) {
        events.push({
          type: "supervisor_log",
          sessionId: this.sessionId,
          data: { message, nodeName },
        });
      }
    }
  }

  // ─── Worker subgraph updates (ns ≠ []) ────────────────────────────────────

  private handleWorkerUpdate(
    nsKey: string,
    parentNode: string,
    updates: Record<string, unknown>,
    events: SseEvent[],
  ): void {
    // Lazily create a tracker the first time we see this worker instance.
    if (!this.workers.has(nsKey)) {
      // Strip any LangGraph UUID suffix (e.g. "be_worker:abc123" → "be_worker")
      const baseNode = parentNode.split(":")[0] ?? parentNode;
      const idx = this.instanceCounts.get(baseNode) ?? 0;
      this.instanceCounts.set(baseNode, idx + 1);

      const role = this.inferRole(baseNode);
      const label = this.inferLabel(baseNode, idx);
      const agentId = `agent-${baseNode}-${idx}`;

      this.workers.set(nsKey, { agentId, role, label, lastKnownTaskId: null });

      events.push({
        type: "agent_created",
        sessionId: this.sessionId,
        agentId,
        data: { role, label },
      });
    }

    const worker = this.workers.get(nsKey)!;

    // pick_next_task fired → emit agent_task_start for the upcoming task ------
    const pickUpdate = updates.pick_next_task as
      | Record<string, unknown>
      | undefined;
    if (pickUpdate) {
      const taskId = pickUpdate.currentTaskId as string | undefined;
      const title = pickUpdate.currentTaskTitle as string | undefined;
      const phase = pickUpdate.currentTaskPhase as string | undefined;
      if (taskId && !this.startedTasks.has(taskId)) {
        this.startedTasks.add(taskId);
        worker.lastKnownTaskId = taskId;
        events.push({
          type: "agent_task_start",
          sessionId: this.sessionId,
          agentId: worker.agentId,
          taskId,
          data: { title: title ?? taskId, phase: phase ?? worker.role },
        });
      }
    }

    // generate_code fired → log progress ------------------------------------
    const genUpdate = updates.generate_code as
      | Record<string, unknown>
      | undefined;
    if (genUpdate) {
      const fileCount = Array.isArray(genUpdate.currentTaskGeneratedFiles)
        ? genUpdate.currentTaskGeneratedFiles.length
        : 0;
      events.push({
        type: "agent_log",
        sessionId: this.sessionId,
        agentId: worker.agentId,
        taskId: worker.lastKnownTaskId ?? undefined,
        data: {
          logType: "info",
          message:
            fileCount > 0
              ? `Generated ${fileCount} file(s)`
              : "Generating code…",
        },
      });
    }

    // verify fired → task progress ------------------------------------------
    const verifyUpdate = updates.verify as Record<string, unknown> | undefined;
    if (verifyUpdate && worker.lastKnownTaskId) {
      const hasErrors =
        typeof verifyUpdate.verifyErrors === "string" &&
        verifyUpdate.verifyErrors !== "";
      const errText =
        typeof verifyUpdate.verifyErrors === "string"
          ? verifyUpdate.verifyErrors
          : "";
      const tscFixPending =
        hasErrors && errText.includes("## TypeScript errors in task files");
      events.push({
        type: "agent_task_progress",
        sessionId: this.sessionId,
        agentId: worker.agentId,
        taskId: worker.lastKnownTaskId,
        data: {
          stage: tscFixPending ? ("fixing" as const) : ("verifying" as const),
          verifyErrors: hasErrors ? verifyUpdate.verifyErrors : undefined,
        },
      });
    }

    // generate_code sub-steps → emit sub-steps event -------------------------
    if (genUpdate) {
      const subSteps = genUpdate.currentTaskSubSteps as
        | Array<Record<string, unknown>>
        | undefined;
      if (subSteps && subSteps.length > 0 && worker.lastKnownTaskId) {
        events.push({
          type: "agent_task_substeps",
          sessionId: this.sessionId,
          agentId: worker.agentId,
          taskId: worker.lastKnownTaskId,
          data: { subSteps },
        });
      }
    }

    // task_done → complete (start already emitted by pick_next_task) ---------
    const doneUpdate = updates.task_done as Record<string, unknown> | undefined;
    if (doneUpdate) {
      for (const result of this.extractTaskResults(doneUpdate)) {
        worker.lastKnownTaskId = result.taskId;

        if (!this.startedTasks.has(result.taskId)) {
          this.startedTasks.add(result.taskId);
          events.push({
            type: "agent_task_start",
            sessionId: this.sessionId,
            agentId: worker.agentId,
            taskId: result.taskId,
            data: { title: result.taskId, phase: worker.role },
          });
        }

        events.push({
          type: "agent_task_complete",
          sessionId: this.sessionId,
          agentId: worker.agentId,
          taskId: result.taskId,
          data: {
            status: result.status ?? "completed",
            filesGenerated: result.generatedFiles ?? [],
            modifiedFiles: result.generatedFiles ?? [],
            costUsd: result.costUsd ?? 0,
            fixCycles: result.fixCycles ?? 0,
            verifyErrors:
              Array.isArray(result.warnings) && result.warnings.length > 0
                ? String(result.warnings[0])
                : undefined,
            tokenUsage: result.tokenUsage,
            subSteps: result.subSteps,
          },
        });
      }
    }

    // task_failed → error (start already emitted by pick_next_task) ----------
    const failUpdate = updates.task_failed as Record<string, unknown> | undefined;
    if (failUpdate) {
      for (const result of this.extractTaskResults(failUpdate)) {
        worker.lastKnownTaskId = result.taskId;

        if (!this.startedTasks.has(result.taskId)) {
          this.startedTasks.add(result.taskId);
          events.push({
            type: "agent_task_start",
            sessionId: this.sessionId,
            agentId: worker.agentId,
            taskId: result.taskId,
            data: { title: result.taskId, phase: worker.role },
          });
        }

        events.push({
          type: "agent_task_error",
          sessionId: this.sessionId,
          agentId: worker.agentId,
          taskId: result.taskId,
          data: {
            error:
              Array.isArray(result.warnings) &&
              result.warnings.length > 0 &&
              result.warnings[0] != null
                ? String(result.warnings[0])
                : "Task generation failed",
          },
        });
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Emit task-level start + complete events for architect phase tasks
   * (e.g. prebuilt scaffold tasks that skip LLM and complete instantly).
   */
  private emitArchitectTaskEvents(
    phaseResult: Record<string, unknown>,
    events: SseEvent[],
  ): void {
    const phaseResults = phaseResult.phaseResults as Array<Record<string, unknown>>;
    const agentId = "agent-architect-0";

    if (!this.workers.has("architect_phase")) {
      this.workers.set("architect_phase", {
        agentId,
        role: "architect",
        label: "Architect",
        lastKnownTaskId: null,
      });
      events.push({
        type: "agent_created",
        sessionId: this.sessionId,
        agentId,
        data: { role: "architect", label: "Architect" },
      });
    }

    for (const pr of phaseResults) {
      if (!Array.isArray(pr.taskResults)) continue;
      for (const tr of pr.taskResults) {
        if (typeof tr !== "object" || tr === null) continue;
        const rec = tr as Record<string, unknown>;
        const taskId = rec.taskId as string | undefined;
        if (!taskId) continue;

        if (!this.startedTasks.has(taskId)) {
          this.startedTasks.add(taskId);
          events.push({
            type: "agent_task_start",
            sessionId: this.sessionId,
            agentId,
            taskId,
            data: { title: taskId, phase: "Scaffolding" },
          });
        }

        events.push({
          type: "agent_task_complete",
          sessionId: this.sessionId,
          agentId,
          taskId,
          data: {
            status: rec.status ?? "completed",
            filesGenerated: Array.isArray(rec.generatedFiles) ? rec.generatedFiles : [],
            modifiedFiles: [],
            costUsd: typeof rec.costUsd === "number" ? rec.costUsd : 0,
            fixCycles: 0,
            verifyErrors:
              Array.isArray(rec.warnings) && rec.warnings.length > 0
                ? String(rec.warnings[0])
                : undefined,
          },
        });
      }
    }
  }

  /** True when a worker namespace key belongs to the given phase node. */
  private matchesPhaseNode(nsKey: string, phaseNode: string): boolean {
    return (
      nsKey === phaseNode ||
      nsKey.startsWith(`${phaseNode}:`) ||
      nsKey.startsWith(`${phaseNode}|`)
    );
  }

  /** Extract task results array from a node's update object. */
  private extractTaskResults(
    update: Record<string, unknown>,
  ): ExtractedTaskResult[] {
    if (!Array.isArray(update.taskResults)) return [];

    const results: ExtractedTaskResult[] = [];
    for (const r of update.taskResults) {
      if (typeof r !== "object" || r === null) continue;
      const rec = r as Record<string, unknown>;
      if (typeof rec.taskId !== "string") continue;
      results.push({
        taskId: rec.taskId,
        status: typeof rec.status === "string" ? rec.status : undefined,
        generatedFiles: Array.isArray(rec.generatedFiles)
          ? (rec.generatedFiles as string[])
          : [],
        costUsd: typeof rec.costUsd === "number" ? rec.costUsd : 0,
        fixCycles: typeof rec.fixCycles === "number" ? rec.fixCycles : 0,
        warnings: Array.isArray(rec.warnings) ? rec.warnings : undefined,
        tokenUsage: rec.tokenUsage,
        subSteps: Array.isArray(rec.subSteps) ? rec.subSteps : undefined,
      });
    }
    return results;
  }

  private inferRole(baseNode: string): string {
    if (baseNode === "architect_phase" || baseNode.startsWith("architect"))
      return "architect";
    if (baseNode === "fe_worker" || baseNode.startsWith("fe_"))
      return "frontend";
    if (baseNode === "be_worker" || baseNode.startsWith("be_"))
      return "backend";
    if (baseNode === "supplementary_worker") return "backend";
    return "backend";
  }

  private inferLabel(baseNode: string, idx: number): string {
    const suffix = idx === 0 ? "" : ` #${idx + 1}`;
    if (baseNode === "architect_phase") return "Architect";
    if (baseNode === "be_worker") return `Backend Dev${suffix}`;
    if (baseNode === "fe_worker") return `Frontend Dev${suffix}`;
    if (baseNode === "supplementary_worker")
      return `Supplementary${suffix}`;
    return `Worker${suffix}`;
  }
}
