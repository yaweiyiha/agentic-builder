import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { CodeGenAgent } from "@/lib/agents/code-gen-agent";
import type {
  CodingSession,
  CodingSessionEvent,
  CodingAgentInstance,
  CodingAgentRole,
  CodingTask,
  KickoffWorkItem,
  AgentLogType,
  FileRegistryEntry,
  AgentWorkingMemory,
} from "./types";

type EventHandler = (event: CodingSessionEvent) => void;

/** Max time to wait for upstream tasks (cross-agent / cross-phase deps). */
const DEPENDENCY_WAIT_TIMEOUT_MS = 45 * 60 * 1000;

const PHASE_TO_ROLE: Record<string, CodingAgentRole> = {
  Scaffolding: "architect",
  "Data Layer": "architect",
  "Auth & Gateway": "backend",
  "Backend Services": "backend",
  Frontend: "frontend",
  Integration: "backend",
  Testing: "test",
  Infrastructure: "architect",
};

function inferRole(task: KickoffWorkItem): CodingAgentRole {
  if (PHASE_TO_ROLE[task.phase]) return PHASE_TO_ROLE[task.phase];

  const lower = `${task.phase} ${task.title} ${task.description}`.toLowerCase();
  if (/test|spec|e2e|vitest|playwright|k6|coverage/.test(lower)) return "test";
  if (/scaffold|infra|docker|helm|ci\/cd|deploy|config|schema|migrat/.test(lower))
    return "architect";
  if (/frontend|react|component|page|ui|css|tailwind|hook|store|next/.test(lower))
    return "frontend";
  return "backend";
}

/**
 * Decide how many agent instances per role based on task count.
 * Rules: <=4 tasks → 1 agent, 5-10 → 2, 11+ → 3.
 */
function planAgentCounts(
  tasksByRole: Record<CodingAgentRole, KickoffWorkItem[]>,
): Record<CodingAgentRole, number> {
  const result: Record<CodingAgentRole, number> = {
    architect: 0,
    frontend: 0,
    backend: 0,
    test: 0,
  };
  for (const role of Object.keys(result) as CodingAgentRole[]) {
    const count = tasksByRole[role]?.length ?? 0;
    if (count === 0) continue;
    // Single architect avoids cross-worker deadlocks on scaffold tasks with inter-deps.
    if (role === "architect") {
      result[role] = 1;
      continue;
    }
    if (count <= 4) result[role] = 1;
    else if (count <= 10) result[role] = 2;
    else result[role] = 3;
  }
  return result;
}

/**
 * Order tasks so that for dependencies that sit on the same agent, upstream runs first.
 */
function sortTasksForAgent(agentTasks: CodingTask[]): CodingTask[] {
  const idSet = new Set(agentTasks.map((t) => t.id));
  const sorted: CodingTask[] = [];
  const remaining = new Set(agentTasks);

  const sameAgentDepsReady = (t: CodingTask): boolean => {
    for (const d of t.dependencies ?? []) {
      if (!idSet.has(d)) continue;
      if (!sorted.some((s) => s.id === d)) return false;
    }
    return true;
  };

  let guard = 0;
  while (remaining.size > 0 && guard++ < agentTasks.length + 10) {
    const ready = [...remaining].filter((t) => sameAgentDepsReady(t));
    if (ready.length === 0) {
      // Cycle or missing dep in this slice — fall back to original order
      for (const t of agentTasks) {
        if (remaining.has(t)) {
          sorted.push(t);
          remaining.delete(t);
        }
      }
      break;
    }
    ready.sort((a, b) => a.id.localeCompare(b.id));
    for (const t of ready) {
      sorted.push(t);
      remaining.delete(t);
    }
  }
  if (remaining.size > 0) {
    for (const t of agentTasks) {
      if (remaining.has(t)) {
        sorted.push(t);
        remaining.delete(t);
      }
    }
  }
  return sorted;
}

const ROLE_LABELS: Record<CodingAgentRole, string> = {
  architect: "Architect",
  frontend: "Frontend Dev",
  backend: "Backend Dev",
  test: "Test Engineer",
};

/** Pipeline phase order — only wait on deps from this phase or earlier. */
const PHASE_ORDER: Record<CodingAgentRole, number> = {
  architect: 0,
  backend: 1,
  frontend: 2,
  test: 3,
};

/**
 * If task.files lists paths and every file already exists under outputDir, skip LLM and reuse.
 */
async function tryReuseExistingTaskFiles(
  outputDir: string,
  task: CodingTask,
): Promise<string[] | null> {
  const files = task.files;
  if (!files || files.length === 0) return null;

  const resolvedRoot = path.resolve(outputDir);
  const found: string[] = [];

  for (const rel of files) {
    const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    const abs = path.resolve(path.join(outputDir, normalized));
    const relToRoot = path.relative(resolvedRoot, abs);
    if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
      return null;
    }
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) return null;
      found.push(rel);
    } catch {
      return null;
    }
  }

  return found.length === files.length ? found : null;
}

export class CodingOrchestrator {
  private onEvent?: EventHandler;
  private outputDir: string;
  private projectContext: string;
  private session!: CodingSession;
  private agentInstances: Map<string, CodeGenAgent> = new Map();
  private fileRegistry: FileRegistryEntry[] = [];
  private agentWorkingMemory = new Map<string, AgentWorkingMemory>();

  constructor(
    outputDir: string,
    projectContext: string,
    onEvent?: EventHandler,
  ) {
    this.outputDir = outputDir;
    this.projectContext = projectContext;
    this.onEvent = onEvent;
  }

  async execute(
    runId: string,
    tasks: KickoffWorkItem[],
  ): Promise<CodingSession> {
    const sessionId = uuidv4();

    // 1. Classify tasks by role
    const tasksByRole: Record<CodingAgentRole, KickoffWorkItem[]> = {
      architect: [],
      frontend: [],
      backend: [],
      test: [],
    };
    for (const t of tasks) {
      const role = inferRole(t);
      tasksByRole[role].push(t);
    }

    // 2. Plan agent allocation
    const agentCounts = planAgentCounts(tasksByRole);

    // 3. Create agent instances
    const agents: CodingAgentInstance[] = [];
    for (const role of ["architect", "frontend", "backend", "test"] as CodingAgentRole[]) {
      const count = agentCounts[role];
      for (let i = 0; i < count; i++) {
        const suffix = count > 1 ? ` #${i + 1}` : "";
        const agent: CodingAgentInstance = {
          id: uuidv4(),
          role,
          label: `${ROLE_LABELS[role]}${suffix}`,
          status: "idle",
          currentTaskId: null,
          completedTaskIds: [],
          failedTaskIds: [],
          logs: [],
          totalCostUsd: 0,
        };
        agents.push(agent);
        this.agentInstances.set(
          agent.id,
          new CodeGenAgent(role, agent.label),
        );
      }
    }

    // 4. Create coding tasks (assigned in round-robin per role)
    const codingTasks: CodingTask[] = [];
    for (const role of ["architect", "frontend", "backend", "test"] as CodingAgentRole[]) {
      const roleAgents = agents.filter((a) => a.role === role);
      if (roleAgents.length === 0) continue;
      const roleTasks = tasksByRole[role];
      roleTasks.forEach((t, i) => {
        const assignedAgent = roleAgents[i % roleAgents.length];
        codingTasks.push({
          ...t,
          assignedAgentId: assignedAgent.id,
          codingStatus: "pending",
        });
      });
    }

    // 5. Build session
    this.session = {
      id: sessionId,
      runId,
      status: "running",
      agents,
      tasks: codingTasks,
      outputDir: this.outputDir,
      totalCostUsd: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fileRegistry: [],
    };

    this.emit({
      type: "session_start",
      sessionId,
      data: {
        agents: agents.map((a) => ({ id: a.id, role: a.role, label: a.label })),
        taskCount: codingTasks.length,
        tasks: codingTasks,
      },
    });

    for (const a of agents) {
      this.emit({
        type: "agent_created",
        sessionId,
        agentId: a.id,
        data: { role: a.role, label: a.label },
      });
    }

    // 6. Execute: architect → backend → frontend → test (sequential phases
    // avoids FE↔BE dependency deadlocks when both run in parallel).
    try {
      await this.runPhase("architect");
      await this.runPhase("backend");
      await this.runPhase("frontend");
      await this.runPhase("test");

      this.session.status = "completed";
      this.session.updatedAt = new Date().toISOString();
      this.emit({
        type: "session_complete",
        sessionId,
        data: {
          status: "completed",
          totalCostUsd: this.session.totalCostUsd,
          completedTasks: codingTasks.filter(
            (t) =>
              t.codingStatus === "completed" ||
              t.codingStatus === "completed_with_warnings",
          ).length,
          failedTasks: codingTasks.filter((t) => t.codingStatus === "failed")
            .length,
          totalTasks: codingTasks.length,
        },
      });
    } catch (e) {
      this.session.status = "failed";
      this.session.updatedAt = new Date().toISOString();
      this.emit({
        type: "session_error",
        sessionId,
        data: {
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }

    return this.session;
  }

  /**
   * Run all agents of a given role in parallel.
   * Each agent processes its assigned tasks sequentially (respecting dependencies).
   */
  private async runPhase(role: CodingAgentRole): Promise<void> {
    const roleAgents = this.session.agents.filter((a) => a.role === role);
    if (roleAgents.length === 0) return;

    await Promise.all(
      roleAgents.map((agent) => this.runAgent(agent)),
    );
  }

  private async runAgent(agent: CodingAgentInstance): Promise<void> {
    let agentTasks = this.session.tasks.filter(
      (t) => t.assignedAgentId === agent.id,
    );
    if (agentTasks.length === 0) {
      agent.status = "completed";
      return;
    }

    agentTasks = sortTasksForAgent(agentTasks);

    const llmAgent = this.agentInstances.get(agent.id);
    if (!llmAgent) return;

    agent.status = "working";

    for (const task of agentTasks) {
      // Wait for dependencies (only tasks in same or earlier pipeline phases)
      await this.waitForDependencies(task, agent.role);

      task.codingStatus = "in_progress";
      task.startedAt = new Date().toISOString();
      agent.currentTaskId = task.id;

      this.addLog(agent, "task_start", `Starting: ${task.title}`, task.id);
      this.emit({
        type: "agent_task_start",
        sessionId: this.session.id,
        agentId: agent.id,
        taskId: task.id,
        data: { title: task.title, phase: task.phase },
      });

      const reused = await tryReuseExistingTaskFiles(this.outputDir, task);
      if (reused) {
        task.codingStatus = "completed";
        task.completedAt = new Date().toISOString();
        task.output = `Reused existing files (skipped LLM):\n${reused.map((f) => `- ${f}`).join("\n")}`;
        task.generatedFiles = reused;
        agent.completedTaskIds.push(task.id);

        this.addLog(
          agent,
          "task_complete",
          `Reused ${reused.length} existing file(s): ${task.title}`,
          task.id,
        );
        this.emit({
          type: "agent_task_complete",
          sessionId: this.session.id,
          agentId: agent.id,
          taskId: task.id,
          data: {
            filesGenerated: reused,
            costUsd: 0,
            durationMs: 0,
            reusedExisting: true,
          },
        });
        continue;
      }

      const getContext = () =>
        agent.role === "architect"
          ? this.projectContext
          : this.buildEnrichedContext(agent.role, agent.id);

      try {
        const result = await llmAgent.executeTask(
          task.title,
          task.description,
          task.files ?? [],
          getContext(),
          this.session.id,
        );

        const generatedFiles = CodeGenAgent.parseFileOutput(result.content);
        const fileKeys = Object.keys(generatedFiles);

        for (const [filePath, content] of Object.entries(generatedFiles)) {
          const abs = path.join(this.outputDir, filePath);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, content, "utf-8");
        }

        task.output = result.content;
        task.generatedFiles = fileKeys;
        task.fixAttempts = 0;
        agent.totalCostUsd += result.costUsd;
        this.session.totalCostUsd += result.costUsd;

        const MAX_FIX_ATTEMPTS = 3;
        let verifyErrors = await this.verifyTaskOutput(task);

        while (verifyErrors && task.fixAttempts! < MAX_FIX_ATTEMPTS) {
          task.fixAttempts = (task.fixAttempts ?? 0) + 1;
          task.verifyErrors = verifyErrors;

          this.addLog(
            agent,
            "task_verify",
            `tsc errors (attempt ${task.fixAttempts}/${MAX_FIX_ATTEMPTS}): ${verifyErrors.slice(0, 200)}`,
            task.id,
          );
          this.emit({
            type: "agent_task_progress",
            sessionId: this.session.id,
            agentId: agent.id,
            taskId: task.id,
            data: {
              stage: "fixing",
              fixAttempt: task.fixAttempts,
              errorPreview: verifyErrors.slice(0, 200),
            },
          });

          await this.fixTaskErrors(task, verifyErrors, llmAgent, agent);

          this.addLog(
            agent,
            "task_fix",
            `Fix applied (attempt ${task.fixAttempts}), re-verifying...`,
            task.id,
          );

          verifyErrors = await this.verifyTaskOutput(task);
        }

        const hasRemainingErrors = !!verifyErrors;
        task.codingStatus = hasRemainingErrors
          ? "completed_with_warnings"
          : "completed";
        task.completedAt = new Date().toISOString();
        if (hasRemainingErrors) {
          task.verifyErrors = verifyErrors;
        }

        this.updateMemoryAfterTask(agent, task, task.generatedFiles ?? []);
        agent.completedTaskIds.push(task.id);

        this.addLog(
          agent,
          "task_complete",
          `${hasRemainingErrors ? "Completed with warnings" : "Completed"}: ${task.title} ` +
            `(${fileKeys.length} files, ${task.fixAttempts ?? 0} fix attempts, $${result.costUsd.toFixed(4)})`,
          task.id,
        );
        this.emit({
          type: "agent_task_complete",
          sessionId: this.session.id,
          agentId: agent.id,
          taskId: task.id,
          data: {
            filesGenerated: fileKeys,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            fixAttempts: task.fixAttempts ?? 0,
            completedWithWarnings: hasRemainingErrors,
            verifyErrors: hasRemainingErrors
              ? verifyErrors?.slice(0, 500)
              : undefined,
          },
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        task.codingStatus = "failed";
        task.error = errMsg;
        task.completedAt = new Date().toISOString();
        agent.failedTaskIds.push(task.id);

        this.addLog(agent, "task_error", `Failed: ${task.title} — ${errMsg}`, task.id);
        this.emit({
          type: "agent_task_error",
          sessionId: this.session.id,
          agentId: agent.id,
          taskId: task.id,
          data: { error: errMsg },
        });
      }
    }

    agent.currentTaskId = null;
    agent.status =
      agent.failedTaskIds.length > 0 ? "failed" : "completed";
    this.emit({
      type: "agent_completed",
      sessionId: this.session.id,
      agentId: agent.id,
      data: {
        status: agent.status,
        completed: agent.completedTaskIds.length,
        failed: agent.failedTaskIds.length,
      },
    });
  }

  /**
   * Only wait on dependency tasks that run in the same pipeline phase or an earlier one.
   * Otherwise architect tasks would block on backend/frontend IDs that stay pending until later phases (infinite wait).
   */
  private async waitForDependencies(
    task: CodingTask,
    currentRole: CodingAgentRole,
  ): Promise<void> {
    if (!task.dependencies || task.dependencies.length === 0) return;
    const myOrder = PHASE_ORDER[currentRole];

    const depIds = task.dependencies.filter(Boolean).filter((depId) => {
      const depTask = this.session.tasks.find((t) => t.id === depId);
      if (!depTask) return false;
      const depRole = inferRole(depTask);
      return PHASE_ORDER[depRole] <= myOrder;
    });

    if (depIds.length === 0) return;

    const start = Date.now();
    while (true) {
      const allDone = depIds.every((depId) => {
        const dep = this.session.tasks.find((t) => t.id === depId);
        if (!dep) return true;
        return (
          dep.codingStatus === "completed" ||
          dep.codingStatus === "completed_with_warnings" ||
          dep.codingStatus === "failed"
        );
      });
      if (allDone) return;

      if (Date.now() - start > DEPENDENCY_WAIT_TIMEOUT_MS) {
        throw new Error(
          `Dependency wait exceeded ${DEPENDENCY_WAIT_TIMEOUT_MS / 60000}min for task ${task.id} (waiting on: ${depIds.join(", ")})`,
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /**
   * Build an enriched projectContext for non-architect agents.
   * Appends the shared file registry (upstream outputs) and this agent's own working memory.
   */
  private buildEnrichedContext(
    role: CodingAgentRole,
    agentId: string,
  ): string {
    const parts: string[] = [this.projectContext];

    const memory = this.agentWorkingMemory.get(agentId);
    if (memory && memory.completedTaskSummaries.length > 0) {
      parts.push(
        "\n\n## Your completed tasks in this session",
        memory.completedTaskSummaries
          .map(
            (s) =>
              `- **${s.taskTitle}**: ${s.summary} (files: ${s.filesGenerated.join(", ")})`,
          )
          .join("\n"),
      );
    }

    const otherFilesEntries = this.fileRegistry.filter(
      (e) => e.role !== role,
    );
    if (otherFilesEntries.length > 0) {
      parts.push(
        "\n\n## Files already generated by upstream agents",
        "Use these as reference — do not regenerate them.",
        otherFilesEntries
          .map((e) => {
            const exportsNote =
              e.exports.length > 0
                ? ` | exports: ${e.exports.slice(0, 5).join(", ")}`
                : "";
            return `- \`${e.path}\` (${e.role}): ${e.summary}${exportsNote}`;
          })
          .join("\n"),
      );
    }

    const full = parts.join("\n");
    if (full.length <= 12000) return full;

    const base = parts[0];
    const rest = parts.slice(1).join("\n");
    const allowed = 12000 - base.length - 100;
    if (allowed <= 0) return base;
    return base + "\n\n" + rest.slice(0, allowed) + "\n...(truncated)";
  }

  /**
   * After a task completes, register its generated files in the shared registry
   * and update the agent's working memory for subsequent tasks.
   */
  private updateMemoryAfterTask(
    agent: CodingAgentInstance,
    task: CodingTask,
    generatedFiles: string[],
  ): void {
    for (const filePath of generatedFiles) {
      if (this.fileRegistry.some((e) => e.path === filePath)) continue;

      this.fileRegistry.push({
        path: filePath,
        role: agent.role,
        summary: task.title,
        exports: [],
      });
    }

    this.session.fileRegistry = [...this.fileRegistry];

    const memory = this.agentWorkingMemory.get(agent.id) ?? {
      completedTaskSummaries: [],
    };
    memory.completedTaskSummaries.push({
      taskId: task.id,
      taskTitle: task.title,
      filesGenerated: generatedFiles,
      summary: `Generated ${generatedFiles.length} file(s)`,
    });
    if (memory.completedTaskSummaries.length > 8) {
      memory.completedTaskSummaries = memory.completedTaskSummaries.slice(-8);
    }
    this.agentWorkingMemory.set(agent.id, memory);
  }

  private async verifyTaskOutput(task: CodingTask): Promise<string> {
    const files = task.generatedFiles;
    if (!files || files.length === 0) return "";

    const tsFiles = files.filter((f) => /\.(ts|tsx)$/.test(f));
    if (tsFiles.length === 0) return "";

    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      const { stderr } = await execFileAsync(
        "npx",
        [
          "tsc",
          "--noEmit",
          "--pretty",
          "false",
          ...tsFiles.map((f) => path.join(this.outputDir, f)),
        ],
        {
          cwd: this.outputDir,
          maxBuffer: 1024 * 1024,
          timeout: 30000,
        },
      );

      return stderr?.trim() ?? "";
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string };
      const errorOutput = (err.stderr ?? err.stdout ?? "").trim();
      if (!errorOutput) return "";
      if (errorOutput.includes("error TS")) {
        return errorOutput.slice(0, 3000);
      }
      return "";
    }
  }

  private async fixTaskErrors(
    task: CodingTask,
    errors: string,
    llmAgent: CodeGenAgent,
    agent: CodingAgentInstance,
  ): Promise<void> {
    const baseContext =
      agent.role === "architect"
        ? this.projectContext
        : this.buildEnrichedContext(agent.role, agent.id);
    const fixContext = [
      baseContext,
      "",
      "## Previously generated files (need fixing)",
      ...(task.generatedFiles ?? []).map((f) => `- ${f}`),
      "",
      "## TypeScript compilation errors to fix",
      errors,
      "",
      "Fix ONLY the errors above. Output the corrected files using ```file:<path> format.",
      "Do not rewrite files that have no errors.",
    ].join("\n");

    const fixTitle = `Fix TypeScript errors in: ${task.title}`;
    const fixDescription = `Fix the following TypeScript errors:\n\n${errors}`;

    const result = await llmAgent.executeTask(
      fixTitle,
      fixDescription,
      task.generatedFiles ?? [],
      fixContext,
      this.session.id,
    );

    const fixedFiles = CodeGenAgent.parseFileOutput(result.content);

    for (const [filePath, content] of Object.entries(fixedFiles)) {
      const abs = path.join(this.outputDir, filePath);
      try {
        await fs.writeFile(abs, content, "utf-8");
      } catch {
        // ignore write errors during fix
      }
    }

    this.session.totalCostUsd += result.costUsd;
  }

  private addLog(
    agent: CodingAgentInstance,
    type: AgentLogType,
    message: string,
    taskId?: string,
  ) {
    agent.logs.push({
      timestamp: new Date().toISOString(),
      type,
      taskId,
      message,
    });
  }

  private emit(event: CodingSessionEvent) {
    this.onEvent?.(event);
  }
}
