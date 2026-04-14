import fs from "fs/promises";
import path from "path";
import type { KickoffWorkItem } from "@/lib/pipeline/types";
import type { RalphTaskProgress, RalphSessionState } from "./ralph-types";

export const RALPH_DIR = ".ralph";
export const PLAN_FILE = "IMPLEMENTATION_PLAN.md";
export const PROGRESS_FILE = "task-progress.json";
export const SESSION_CONTEXT_FILE = "session-context.md";
export const ERROR_HISTORY_FILE = "error-history.json";

const MAX_ERRORS_PER_TASK = 5;

export class ProgressTracker {
  private outputDir: string;
  private ralphDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.ralphDir = path.join(outputDir, RALPH_DIR);
  }

  /** Initialise the .ralph directory and write the initial plan from the task breakdown. */
  async init(tasks: KickoffWorkItem[], sessionId: string): Promise<void> {
    await fs.mkdir(this.ralphDir, { recursive: true });

    const state: RalphSessionState = {
      sessionId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks: tasks.map((t) => ({
        taskId: t.id,
        title: t.title,
        phase: t.phase,
        status: "pending",
        iteration: 0,
        errors: [],
        filesGenerated: [],
      })),
      totalIterations: 0,
      totalCostUsd: 0,
    };

    await this.writeState(state);
    await this.writePlan(state.tasks);
  }

  async markInProgress(taskId: string): Promise<void> {
    const state = await this.loadState();
    const task = state.tasks.find((t) => t.taskId === taskId);
    if (!task) return;
    task.status = "in_progress";
    task.iteration += 1;
    state.totalIterations += 1;
    state.updatedAt = new Date().toISOString();
    await this.writeState(state);
    await this.writePlan(state.tasks);
  }

  async markComplete(
    taskId: string,
    files: string[],
    commitHash?: string,
  ): Promise<void> {
    const state = await this.loadState();
    const task = state.tasks.find((t) => t.taskId === taskId);
    if (!task) return;
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.filesGenerated = files;
    if (commitHash) task.commitHash = commitHash;
    state.updatedAt = new Date().toISOString();
    await this.writeState(state);
    await this.writePlan(state.tasks);
  }

  async markFailed(taskId: string, error: string): Promise<void> {
    const state = await this.loadState();
    const task = state.tasks.find((t) => t.taskId === taskId);
    if (!task) return;
    task.status = "failed";
    task.errors = [...task.errors, error.slice(0, 500)].slice(
      -MAX_ERRORS_PER_TASK,
    );
    state.updatedAt = new Date().toISOString();
    await this.writeState(state);
    await this.writePlan(state.tasks);
  }

  /** Record a per-iteration error into error-history.json without changing task status. */
  async recordError(
    taskId: string,
    iteration: number,
    error: string,
  ): Promise<void> {
    const historyPath = path.join(this.ralphDir, ERROR_HISTORY_FILE);
    let history: Array<{
      taskId: string;
      iteration: number;
      error: string;
      timestamp: string;
    }> = [];
    try {
      history = JSON.parse(await fs.readFile(historyPath, "utf-8"));
    } catch {
      // first write
    }
    history.push({
      taskId,
      iteration,
      error: error.slice(0, 1000),
      timestamp: new Date().toISOString(),
    });
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
  }

  /** Update cumulative cost in the session state. */
  async addCost(costUsd: number): Promise<void> {
    const state = await this.loadState();
    state.totalCostUsd += costUsd;
    state.updatedAt = new Date().toISOString();
    await this.writeState(state);
  }

  async loadState(): Promise<RalphSessionState> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(this.ralphDir, PROGRESS_FILE), "utf-8"),
      );
    } catch {
      return {
        sessionId: "",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: [],
        totalIterations: 0,
        totalCostUsd: 0,
      };
    }
  }

  /** Write a human-readable context summary for use by rotated context windows. */
  async writeSessionContext(context: string): Promise<void> {
    await fs.writeFile(
      path.join(this.ralphDir, SESSION_CONTEXT_FILE),
      context,
      "utf-8",
    );
  }

  async readSessionContext(): Promise<string | null> {
    try {
      return await fs.readFile(
        path.join(this.ralphDir, SESSION_CONTEXT_FILE),
        "utf-8",
      );
    } catch {
      return null;
    }
  }

  private async writeState(state: RalphSessionState): Promise<void> {
    await fs.writeFile(
      path.join(this.ralphDir, PROGRESS_FILE),
      JSON.stringify(state, null, 2),
    );
  }

  /** Render the IMPLEMENTATION_PLAN.md in the project root (visible to agents and humans). */
  private async writePlan(tasks: RalphTaskProgress[]): Promise<void> {
    const now = new Date().toISOString();
    const completed = tasks.filter((t) => t.status === "completed").length;
    const failed = tasks.filter((t) => t.status === "failed").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;

    const lines = [
      "# Implementation Plan",
      "",
      "> Generated by AgenticBuilder with RALPH Loop",
      `> Last updated: ${now}`,
      `> Progress: ${completed}/${tasks.length} completed${failed ? `, ${failed} failed` : ""}${inProgress ? `, ${inProgress} in-progress` : ""}`,
      "",
      "## Tasks",
      "",
    ];

    for (const task of tasks) {
      const icon =
        task.status === "completed"
          ? "[x]"
          : task.status === "failed"
            ? "[!]"
            : task.status === "in_progress"
              ? "[-]"
              : "[ ]";
      const commitNote = task.commitHash
        ? ` _(commit: \`${task.commitHash.slice(0, 7)}\`)_`
        : "";
      lines.push(
        `${icon} **${task.taskId}** [${task.phase}]: ${task.title}${commitNote}`,
      );

      if (task.status === "in_progress") {
        lines.push(`   - _In progress — iteration ${task.iteration}_`);
      }
      if (task.status === "failed" && task.errors.length > 0) {
        lines.push(
          `   - _Last error: ${task.errors[task.errors.length - 1].slice(0, 120)}_`,
        );
      }
      if (task.filesGenerated.length > 0) {
        const shown = task.filesGenerated.slice(0, 4);
        for (const f of shown) lines.push(`   - \`${f}\``);
        if (task.filesGenerated.length > 4)
          lines.push(
            `   - _...and ${task.filesGenerated.length - 4} more files_`,
          );
      }
    }

    lines.push("");
    lines.push("---");
    lines.push(
      `**Summary**: ${completed}/${tasks.length} tasks completed | ${failed} failed | Generated by RALPH Loop`,
    );

    await fs.writeFile(
      path.join(this.outputDir, PLAN_FILE),
      lines.join("\n"),
      "utf-8",
    );
  }
}
