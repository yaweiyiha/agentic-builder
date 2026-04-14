export interface RalphConfig {
  /** Enable RALPH loop behavior. Default: false (backward-compatible). */
  enabled: boolean;
  /** Max LLM iterations per task before giving up. Default: 20. */
  maxIterationsPerTask: number;
  /** Max fix iterations per phase (tsc/build). Default: 50. */
  maxIterationsPerPhase: number;
  /** Commit each successfully completed task to git. Default: true. */
  enableGitCommits: boolean;
  /** Run `npm test` as the external judge after phase verify. Default: true. */
  enableTestVerification: boolean;
  /** Rotate context window when estimatedTokens / maxTokens exceeds this ratio. Default: 0.7. */
  contextRotationThreshold: number;
}

export const DEFAULT_RALPH_CONFIG: RalphConfig = {
  enabled: true,
  maxIterationsPerTask: 20,
  maxIterationsPerPhase: 50,
  enableGitCommits: true,
  enableTestVerification: true,
  contextRotationThreshold: 0.7,
};

export interface RalphTaskProgress {
  taskId: string;
  title: string;
  phase: string;
  /** Current lifecycle status of this task. */
  status: "pending" | "in_progress" | "completed" | "failed";
  /** Total LLM generation iterations consumed by this task. */
  iteration: number;
  /** Git commit hash produced on successful completion. */
  commitHash?: string;
  completedAt?: string;
  /** Last N error messages encountered (capped to keep the file readable). */
  errors: string[];
  filesGenerated: string[];
}

export interface RalphSessionState {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  tasks: RalphTaskProgress[];
  /** Total LLM iterations across all tasks in this session. */
  totalIterations: number;
  totalCostUsd: number;
}
