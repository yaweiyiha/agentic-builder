export type PipelineStepId =
  | "intent"
  | "prd"
  | "trd"
  | "sysdesign"
  | "implguide"
  | "design"
  | "pencil"
  | "mockup"
  | "qa"
  | "verify"
  | "kickoff";

export type PipelineStatus = "idle" | "running" | "completed" | "failed";

export interface StepResult {
  stepId: PipelineStepId;
  status: PipelineStatus;
  content?: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  traceId?: string;
  error?: string;
  timestamp: string;
  /** Extra structured data attached to a step (e.g. mockup file paths). */
  metadata?: Record<string, unknown>;
}

export interface PipelineRun {
  id: string;
  sessionId: string;
  featureBrief: string;
  status: PipelineStatus;
  currentStep: PipelineStepId | null;
  steps: Record<PipelineStepId, StepResult | null>;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineEvent {
  type: "step_start" | "step_complete" | "step_error" | "pipeline_complete";
  runId: string;
  stepId: PipelineStepId;
  data: Partial<StepResult>;
}

export type KickoffTaskExecutionKind = "ai_autonomous" | "human_confirm_after";

export interface TaskSubStep {
  step: number;
  action: string;
  detail: string;
}

export interface TaskTokenEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface KickoffWorkItem {
  id: string;
  phase: string;
  title: string;
  description: string;
  estimatedHours: number;
  executionKind: KickoffTaskExecutionKind;
  files?: string[];
  dependencies?: string[];
  priority?: "P0" | "P1" | "P2";
  subSteps?: TaskSubStep[];
  tokenEstimate?: TaskTokenEstimate;
  acceptanceCriteria?: string[];
  /** PRD requirement IDs this task implements (AC-*, FR-*), for coverage gates. */
  coversRequirementIds?: string[];
}

// ─── Multi-Agent Coding Session ───

export type CodingAgentRole =
  | "architect"
  | "frontend"
  | "backend"
  | "test";

export type CodingTaskStatus =
  | "pending"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed";

export interface CodingTask extends KickoffWorkItem {
  assignedAgentId: string | null;
  codingStatus: CodingTaskStatus;
  output?: string;
  generatedFiles?: string[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CodingAgentInstance {
  id: string;
  role: CodingAgentRole;
  label: string;
  status: "idle" | "working" | "completed" | "failed";
  currentTaskId: string | null;
  completedTaskIds: string[];
  failedTaskIds: string[];
  logs: AgentLogEntry[];
  totalCostUsd: number;
}

export interface AgentLogEntry {
  timestamp: string;
  type: "info" | "task_start" | "task_progress" | "task_complete" | "task_error";
  taskId?: string;
  message: string;
}

export interface CodingSession {
  id: string;
  runId: string;
  status: "pending" | "running" | "completed" | "failed";
  agents: CodingAgentInstance[];
  tasks: CodingTask[];
  outputDir: string;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodingSessionEvent {
  type:
    | "session_start"
    | "agent_created"
    | "tasks_assigned"
    | "agent_task_start"
    | "agent_task_progress"
    | "agent_task_complete"
    | "agent_task_error"
    | "agent_idle"
    | "agent_completed"
    | "agent_log"
    | "session_complete"
    | "session_error";
  sessionId: string;
  agentId?: string;
  taskId?: string;
  data: Record<string, unknown>;
}
