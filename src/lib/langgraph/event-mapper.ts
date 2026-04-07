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
        events.push(...this.emitPhaseWorkingStatus(["backend", "frontend"]));
      } else if (nodeName === "test_phase") {
        events.push(...this.handleSinglePhaseComplete(u));
      } else if (nodeName === "parallel_worker") {
        events.push(...this.handleParallelWorkerComplete(u, namespace));
        events.push(...this.emitPhaseWorkingStatus(["test"]));
      } else if (nodeName === "generate_code") {
        events.push(...this.handleGenerateCode(u, namespace));
      } else if (nodeName === "task_done") {
        events.push(...this.handleTaskDone(u, namespace));
      } else if (nodeName === "integration_verify") {
        events.push(...this.handleIntegrationVerify(u));
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
    const nsKey = namespace.join(",");
    const files = u.generatedFiles as GeneratedFile[] | undefined;
    if (files?.[0]?.role && !this.nsRoleMap.has(nsKey)) {
      this.nsRoleMap.set(nsKey, files[0].role);
    }
    return [];
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
    const errors = u.integrationErrors as string | undefined;
    if (errors) {
      return [
        {
          type: "agent_task_error" as CodingSessionEvent["type"],
          sessionId: this.sessionId,
          data: {
            error: `Integration verify: ${errors.slice(0, 500)}`,
            phase: "integration",
          },
        },
      ];
    }
    return [];
  }
}
