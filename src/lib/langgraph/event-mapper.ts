import type { CodingSessionEvent } from "@/lib/pipeline/types";
import type { PhaseResult, TaskResult, GeneratedFile } from "./state";

// Mirror supervisor's worker allocation logic so we can pre-create agents
// with the exact same labels the supervisor will use.
function computeWorkerCount(role: string, taskCount: number): number {
  if (role === "architect" || role === "test") return 1;
  if (taskCount <= 3) return 1;
  if (taskCount <= 8) return 2;
  return 3;
}

function distributeToChunks<T>(items: T[], chunks: number): T[][] {
  if (chunks <= 1) return [items];
  const result: T[][] = Array.from({ length: chunks }, () => []);
  items.forEach((item, i) => result[i % chunks].push(item));
  return result.filter((c) => c.length > 0);
}

function buildWorkerLabel(base: string, index: number, total: number): string {
  if (total <= 1) return base;
  return `${base} #${index + 1}`;
}

/**
 * Tracks incremental state changes emitted by graph.stream({ streamMode: "updates" })
 * and maps them to CodingSessionEvent objects compatible with the existing frontend.
 */
export class EventMapper {
  private sessionId: string;
  private agentRegistry = new Map<string, { id: string; role: string; label: string }>();
  private emittedTaskStarts = new Set<string>();
  private emittedTaskCompletes = new Set<string>();
  private emittedAgentCreations = new Set<string>();
  private completedAgents = new Set<string>();
  private agentCounter = 0;
  private taskMap = new Map<string, { id: string; title: string }>();
  private taskIdToAgentId = new Map<string, string>();
  private roleToAgentIds = new Map<string, string[]>();
  private nsRoleMap = new Map<string, string>();
  private namespaceAgentMap = new Map<string, string>();
  private agentCurrentTaskId = new Map<string, string>();
  private integrationFixAttemptCount = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  mapChunk(chunk: [string[], Record<string, unknown>]): CodingSessionEvent[] {
    const [namespace, nodeUpdates] = chunk;
    const events: CodingSessionEvent[] = [];

    for (const [nodeName, update] of Object.entries(nodeUpdates)) {
      if (!update || typeof update !== "object") continue;
      const u = update as Record<string, unknown>;

      if (nodeName === "classify_tasks") {
        events.push(...this.handleClassify(u));
      } else if (nodeName === "architect_phase") {
        events.push(...this.handleSinglePhaseComplete(u));
      } else if (nodeName === "scaffold_verify") {
        events.push(...this.handleScaffoldVerify(u));
      } else if (nodeName === "scaffold_fix") {
        events.push(...this.handleScaffoldFix(u));
      } else if (nodeName === "dispatch_gate") {
        events.push(...this.emitPhaseWorkingStatus(["backend"]));
      } else if (nodeName === "generate_api_contracts") {
        const architectIds = this.roleToAgentIds.get("architect");
        const agentId = architectIds?.[0];
        if (agentId) {
          events.push({
            type: "agent_log" as CodingSessionEvent["type"],
            sessionId: this.sessionId,
            agentId,
            data: { message: "API contract generated. Starting backend development..." },
          });
        }
      } else if (nodeName === "test_phase") {
        events.push(...this.handleSinglePhaseComplete(u));
      } else if (nodeName === "parallel_worker") {
        events.push(...this.handleParallelWorkerComplete(u, namespace));
      } else if (nodeName === "be_worker") {
        events.push(...this.handleParallelWorkerComplete(u, namespace));
        events.push(...this.emitPhaseWorkingStatus(["frontend"]));
      } else if (nodeName === "fe_worker") {
        events.push(...this.handleParallelWorkerComplete(u, namespace));
        events.push(...this.emitPhaseWorkingStatus(["test"]));
      } else if (nodeName === "extract_real_contracts") {
        // silent
      } else if (nodeName === "sync_deps") {
        events.push({
          type: "integration_verify_start" as CodingSessionEvent["type"],
          sessionId: this.sessionId,
          data: {},
        });
      } else if (nodeName === "fe_dispatch_gate") {
        events.push(...this.emitPhaseWorkingStatus(["frontend"]));
      } else if (nodeName === "generate_code") {
        events.push(...this.handleGenerateCode(u, namespace));
      } else if (nodeName === "verify") {
        events.push(...this.handleVerify(u, namespace));
      } else if (nodeName === "fix_errors") {
        events.push(...this.handleFixErrors(u, namespace));
      } else if (nodeName === "task_done") {
        events.push(...this.handleTaskDone(u, namespace));
      } else if (nodeName === "integration_verify") {
        events.push(...this.handleIntegrationVerify(u));
      } else if (nodeName === "integration_fix") {
        events.push(...this.handleIntegrationFix(u));
      } else if (nodeName === "summary") {
        events.push(this.buildSessionComplete());
      }
    }

    return events;
  }

  buildSessionStart(
    tasks: { id: string; phase: string; title: string; assignedAgentId: string | null }[],
  ): CodingSessionEvent {
    return {
      type: "session_start",
      sessionId: this.sessionId,
      data: { taskCount: tasks.length, tasks },
    };
  }

  buildSessionComplete(): CodingSessionEvent {
    return {
      type: "session_complete",
      sessionId: this.sessionId,
      data: {},
    };
  }

  buildSessionError(error: string): CodingSessionEvent {
    return {
      type: "session_error",
      sessionId: this.sessionId,
      data: { error },
    };
  }

  private getOrCreateAgent(role: string, label: string): string {
    const key = `${role}:${label}`;
    if (!this.agentRegistry.has(key)) {
      const id = `agent-${++this.agentCounter}`;
      this.agentRegistry.set(key, { id, role, label });
    }
    return this.agentRegistry.get(key)!.id;
  }

  private getNewAgentCreatedEvents(): CodingSessionEvent[] {
    const events: CodingSessionEvent[] = [];
    for (const a of this.agentRegistry.values()) {
      if (!this.emittedAgentCreations.has(a.id)) {
        this.emittedAgentCreations.add(a.id);
        events.push({
          type: "agent_created" as const,
          sessionId: this.sessionId,
          agentId: a.id,
          data: { role: a.role, label: a.label },
        });
      }
    }
    return events;
  }

  private detectRoleFromNamespace(namespace: string[]): string | null {
    const joined = namespace.join(",");
    if (joined.includes("architect_phase")) return "architect";
    if (joined.includes("backend_phase")) return "backend";
    if (joined.includes("frontend_phase")) return "frontend";
    if (joined.includes("test_phase")) return "test";
    return null;
  }

  private resolveAgentIdForNamespace(namespace: string[]): string | null {
    const nsKey = namespace.join(",");
    const existing = this.namespaceAgentMap.get(nsKey);
    if (existing) return existing;

    const role = this.detectRoleFromNamespace(namespace);
    if (!role) return null;

    const candidateIds = this.roleToAgentIds.get(role) ?? [];
    if (candidateIds.length === 0) return null;

    const assignedForRole = new Set(
      [...this.namespaceAgentMap.values()].filter((id) =>
        candidateIds.includes(id),
      ),
    );
    const resolved =
      candidateIds.find((id) => !assignedForRole.has(id)) ?? candidateIds[0];
    this.namespaceAgentMap.set(nsKey, resolved);
    return resolved;
  }

  /**
   * Pre-create agents with labels that exactly match supervisor's dispatch,
   * and build precise taskId → agentId mappings.
   */
  private handleClassify(u: Record<string, unknown>): CodingSessionEvent[] {
    const events: CodingSessionEvent[] = [];
    const assignments: { agentId: string; taskIds: string[] }[] = [];

    const roles: { key: string; role: string; labelBase: string }[] = [
      { key: "architectTasks", role: "architect", labelBase: "Architect" },
      { key: "backendTasks", role: "backend", labelBase: "Backend Dev" },
      { key: "frontendTasks", role: "frontend", labelBase: "Frontend Dev" },
      { key: "testTasks", role: "test", labelBase: "Test Engineer" },
    ];

    for (const { key, role, labelBase } of roles) {
      const tasks = u[key] as Array<{ id: string; title: string }> | undefined;
      if (!tasks || tasks.length === 0) continue;

      for (const t of tasks) {
        this.taskMap.set(t.id, { id: t.id, title: t.title });
      }

      const workerCount = computeWorkerCount(role, tasks.length);
      const chunks = distributeToChunks(tasks, workerCount);

      const agentIds: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const label = buildWorkerLabel(labelBase, i, chunks.length);
        const agentId = this.getOrCreateAgent(role, label);
        agentIds.push(agentId);

        const taskIds = chunks[i].map((t) => t.id);
        for (const tid of taskIds) {
          this.taskIdToAgentId.set(tid, agentId);
        }
        assignments.push({ agentId, taskIds });
      }
      this.roleToAgentIds.set(role, agentIds);
    }

    events.push(...this.getNewAgentCreatedEvents());

    if (assignments.length > 0) {
      events.push({
        type: "tasks_assigned" as CodingSessionEvent["type"],
        sessionId: this.sessionId,
        data: { assignments },
      });
    }

    const architectIds = this.roleToAgentIds.get("architect");
    if (architectIds && architectIds.length > 0) {
      const firstArchTask = (u["architectTasks"] as Array<{ id: string; title: string }> | undefined)?.[0];
      if (firstArchTask?.id) {
        this.agentCurrentTaskId.set(architectIds[0], firstArchTask.id);
      }
      events.push({
        type: "agent_task_start" as CodingSessionEvent["type"],
        sessionId: this.sessionId,
        agentId: architectIds[0],
        taskId: firstArchTask?.id,
        data: { title: firstArchTask?.title ?? "Architect phase" },
      });
    }

    return events;
  }

  private handleSinglePhaseComplete(
    u: Record<string, unknown>,
  ): CodingSessionEvent[] {
    const events: CodingSessionEvent[] = [];
    const phaseResults = u.phaseResults as PhaseResult[] | undefined;
    if (!phaseResults) return events;

    for (const pr of phaseResults) {
      const agentId = this.getOrCreateAgent(pr.role, pr.workerLabel);
      events.push(...this.getNewAgentCreatedEvents());

      const taskIds = pr.taskResults.map((tr) => tr.taskId);
      if (taskIds.length > 0) {
        for (const tid of taskIds) {
          this.taskIdToAgentId.set(tid, agentId);
        }
        events.push({
          type: "tasks_assigned" as CodingSessionEvent["type"],
          sessionId: this.sessionId,
          data: { assignments: [{ agentId, taskIds }] },
        });
      }

      for (const tr of pr.taskResults) {
        const taskTitle = this.taskMap.get(tr.taskId)?.title ?? tr.taskId;

        if (!this.emittedTaskStarts.has(tr.taskId)) {
          this.emittedTaskStarts.add(tr.taskId);
          this.agentCurrentTaskId.set(agentId, tr.taskId);
          events.push({
            type: "agent_task_start" as CodingSessionEvent["type"],
            sessionId: this.sessionId,
            agentId,
            taskId: tr.taskId,
            data: { title: taskTitle },
          });
        }

        if (!this.emittedTaskCompletes.has(tr.taskId)) {
          this.emittedTaskCompletes.add(tr.taskId);
          this.agentCurrentTaskId.delete(agentId);
          events.push({
            type: "agent_task_complete",
            sessionId: this.sessionId,
            agentId,
            taskId: tr.taskId,
            data: {
              filesGenerated: tr.generatedFiles,
              costUsd: tr.costUsd,
              durationMs: tr.durationMs,
              verifyPassed: tr.verifyPassed,
              fixCycles: tr.fixCycles,
              status: tr.status,
              verifyErrors: tr.warnings?.[0],
            },
          });
        }
      }

      this.completedAgents.add(agentId);
      events.push({
        type: "agent_completed",
        sessionId: this.sessionId,
        agentId,
        data: {
          status: "completed",
          completed: pr.taskResults.filter((t) => t.status !== "failed").length,
          failed: pr.taskResults.filter((t) => t.status === "failed").length,
        },
      });
    }

    return events;
  }

  private handleParallelWorkerComplete(
    u: Record<string, unknown>,
    _namespace: string[],
  ): CodingSessionEvent[] {
    return this.handleSinglePhaseComplete(u);
  }

  private handleGenerateCode(
    u: Record<string, unknown>,
    namespace: string[],
  ): CodingSessionEvent[] {
    const events: CodingSessionEvent[] = [];
    const nsKey = namespace.join(",");
    const files = u.generatedFiles as GeneratedFile[] | undefined;
    if (files?.[0]?.role && !this.nsRoleMap.has(nsKey)) {
      this.nsRoleMap.set(nsKey, files[0].role);
    }
    const agentId = this.resolveAgentIdForNamespace(namespace);
    const taskId = agentId ? this.agentCurrentTaskId.get(agentId) : undefined;
    const tsFileCount =
      files?.filter((file) => /\.(ts|tsx)$/.test(file.path)).length ?? 0;

    if (!agentId || !taskId || tsFileCount === 0) return events;

    events.push({
      type: "agent_task_progress",
      sessionId: this.sessionId,
      agentId,
      taskId,
      data: {
        stage: "verifying",
        tsFileCount,
      },
    });
    events.push({
      type: "agent_log",
      sessionId: this.sessionId,
      agentId,
      taskId,
      data: {
        logType: "task_verify",
        message: `Verify started · ${tsFileCount} TS files`,
      },
    });

    return events;
  }

  private handleVerify(
    u: Record<string, unknown>,
    namespace: string[],
  ): CodingSessionEvent[] {
    const agentId = this.resolveAgentIdForNamespace(namespace);
    const taskId = agentId ? this.agentCurrentTaskId.get(agentId) : undefined;
    if (!agentId || !taskId) return [];

    const verifyErrors =
      typeof u.verifyErrors === "string" ? u.verifyErrors.trim() : "";
    const fixAttempts =
      typeof u.fixAttempts === "number" ? u.fixAttempts : 0;

    if (verifyErrors) {
      const attempt = fixAttempts + 1;
      return [
        {
          type: "agent_task_progress",
          sessionId: this.sessionId,
          agentId,
          taskId,
          data: {
            stage: "fixing",
            fixAttempt: attempt,
            verifyErrors: verifyErrors.slice(0, 2000),
            errorPreview: verifyErrors.slice(0, 200),
          },
        },
        {
          type: "agent_log",
          sessionId: this.sessionId,
          agentId,
          taskId,
          data: {
            logType: "task_verify",
            message: `Verify FAILED · attempt ${attempt}/3`,
            details: verifyErrors.slice(0, 2000),
          },
        },
      ];
    }

    return [
      {
        type: "agent_task_progress",
        sessionId: this.sessionId,
        agentId,
        taskId,
        data: {
          stage: "verifying",
          verifyPassed: true,
        },
      },
      {
        type: "agent_log",
        sessionId: this.sessionId,
        agentId,
        taskId,
        data: {
          logType: "task_verify",
          message: "Verify passed.",
        },
      },
    ];
  }

  private handleFixErrors(
    u: Record<string, unknown>,
    namespace: string[],
  ): CodingSessionEvent[] {
    const agentId = this.resolveAgentIdForNamespace(namespace);
    const taskId = agentId ? this.agentCurrentTaskId.get(agentId) : undefined;
    if (!agentId || !taskId) return [];

    const fixAttempt =
      typeof u.fixAttempts === "number" ? u.fixAttempts : undefined;
    const generatedFiles = (u.generatedFiles as GeneratedFile[] | undefined) ?? [];
    const details = generatedFiles.length
      ? generatedFiles.map((file) => `Updated: ${file.path}`).join("\n")
      : undefined;

    return [
      {
        type: "agent_task_progress",
        sessionId: this.sessionId,
        agentId,
        taskId,
        data: {
          stage: "fixing",
          fixAttempt,
        },
      },
      {
        type: "agent_log",
        sessionId: this.sessionId,
        agentId,
        taskId,
        data: {
          logType: "task_fix",
          message: "Fix applied · regenerating affected files",
          details,
        },
      },
      {
        type: "agent_log",
        sessionId: this.sessionId,
        agentId,
        taskId,
        data: {
          message: "Re-running verify...",
        },
      },
    ];
  }

  /**
   * Handle real-time task completion events from worker subgraphs.
   * Uses taskIdToAgentId for precise agent attribution.
   */
  private handleTaskDone(
    u: Record<string, unknown>,
    namespace: string[],
  ): CodingSessionEvent[] {
    const events: CodingSessionEvent[] = [];
    const taskResults = u.taskResults as TaskResult[] | undefined;
    const nextIndex = u.currentTaskIndex as number | undefined;

    if (!taskResults || taskResults.length === 0) return events;

    const completedResult = taskResults[0];
    const { taskId } = completedResult;
    const agentId = this.taskIdToAgentId.get(taskId);
    if (!agentId) return events;
    this.namespaceAgentMap.set(namespace.join(","), agentId);

    if (this.completedAgents.has(agentId)) return events;

    const taskTitle = this.taskMap.get(taskId)?.title ?? taskId;

    if (!this.emittedTaskStarts.has(taskId)) {
      this.emittedTaskStarts.add(taskId);
      events.push({
        type: "agent_task_start",
        sessionId: this.sessionId,
        agentId,
        taskId,
        data: { title: taskTitle },
      });
    }

    if (!this.emittedTaskCompletes.has(taskId)) {
      this.emittedTaskCompletes.add(taskId);
      this.agentCurrentTaskId.delete(agentId);
      events.push({
        type: "agent_task_complete",
        sessionId: this.sessionId,
        agentId,
        taskId,
        data: {
          filesGenerated: completedResult.generatedFiles,
          costUsd: completedResult.costUsd,
          durationMs: completedResult.durationMs,
          verifyPassed: completedResult.verifyPassed,
          fixCycles: completedResult.fixCycles,
          status: completedResult.status,
          verifyErrors: completedResult.warnings?.[0],
        },
      });
    }

    if (nextIndex !== undefined) {
      const allAgentTasks = [...this.taskIdToAgentId.entries()]
        .filter(([, aid]) => aid === agentId)
        .map(([tid]) => tid);

      if (nextIndex < allAgentTasks.length) {
        const nextTaskId = allAgentTasks[nextIndex];
        const nextTitle = this.taskMap.get(nextTaskId)?.title ?? nextTaskId;
        if (!this.emittedTaskStarts.has(nextTaskId)) {
          this.emittedTaskStarts.add(nextTaskId);
          this.agentCurrentTaskId.set(agentId, nextTaskId);
          events.push({
            type: "agent_task_start",
            sessionId: this.sessionId,
            agentId,
            taskId: nextTaskId,
            data: { title: nextTitle },
          });
        }
      }
    }

    return events;
  }

  /**
   * Phase transition hint — use agent_log only. Do NOT emit agent_task_start without
   * a real taskId: the store would create a phantom task that never completes.
   */
  private emitPhaseWorkingStatus(roles: string[]): CodingSessionEvent[] {
    const events: CodingSessionEvent[] = [];
    for (const role of roles) {
      const agentIds = this.roleToAgentIds.get(role);
      if (!agentIds) continue;
      for (const agentId of agentIds) {
        if (this.completedAgents.has(agentId)) continue;
        events.push({
          type: "agent_log" as CodingSessionEvent["type"],
          sessionId: this.sessionId,
          agentId,
          data: { message: `Starting ${role} phase...` },
        });
      }
    }
    return events;
  }

  private handleScaffoldVerify(u: Record<string, unknown>): CodingSessionEvent[] {
    const errors = u.scaffoldErrors as string | undefined;
    const architectIds = this.roleToAgentIds.get("architect");
    const agentId = architectIds?.[0];
    if (!agentId) return [];

    if (errors) {
      return [{
        type: "agent_log" as CodingSessionEvent["type"],
        sessionId: this.sessionId,
        agentId,
        data: { message: `Scaffold build failed, attempting auto-fix...` },
      }];
    }

    return [{
      type: "agent_log" as CodingSessionEvent["type"],
      sessionId: this.sessionId,
      agentId,
      data: { message: `Scaffold verified: npm install && npm run build passed.` },
    }];
  }

  private handleScaffoldFix(u: Record<string, unknown>): CodingSessionEvent[] {
    const attempt = u.scaffoldFixAttempts as number | undefined;
    const architectIds = this.roleToAgentIds.get("architect");
    const agentId = architectIds?.[0];
    if (!agentId) return [];

    return [{
      type: "agent_log" as CodingSessionEvent["type"],
      sessionId: this.sessionId,
      agentId,
      data: { message: `Scaffold fix attempt ${attempt ?? "?"}: applied corrections.` },
    }];
  }

  private handleIntegrationVerify(
    u: Record<string, unknown>,
  ): CodingSessionEvent[] {
    const errors =
      typeof u.integrationErrors === "string"
        ? u.integrationErrors.trim()
        : "";
    const errorCount = errors
      ? errors.split("\n").filter((l) => l.includes("error TS")).length
      : 0;

    return [
      {
        type: "integration_verify_result" as CodingSessionEvent["type"],
        sessionId: this.sessionId,
        data: {
          passed: !errors,
          errors: errors ? errors.slice(0, 2000) : undefined,
          errorCount,
          fixAttempts: this.integrationFixAttemptCount,
          maxFixAttempts: 3,
        },
      },
    ];
  }

  private handleIntegrationFix(
    u: Record<string, unknown>,
  ): CodingSessionEvent[] {
    this.integrationFixAttemptCount =
      typeof u.integrationFixAttempts === "number"
        ? u.integrationFixAttempts
        : this.integrationFixAttemptCount + 1;
    const filesFixed = Array.isArray(u.fileRegistry)
      ? (u.fileRegistry as unknown[]).length
      : 0;

    return [
      {
        type: "integration_fix_result" as CodingSessionEvent["type"],
        sessionId: this.sessionId,
        data: {
          attempt: this.integrationFixAttemptCount,
          filesFixed,
        },
      },
    ];
  }
}
