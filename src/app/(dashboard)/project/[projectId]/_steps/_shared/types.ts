// ── Shared interfaces for the 3-file step pattern ──────────────────────────
//
// Each step folder (e.g. _steps/preparation/core-docs/prd/) contains:
//   agent.ts    – Agent interaction (StepAgent)
//   ui.tsx      – UI rendering (React component receiving StepUIProps)
//   snapshot.ts – DB persistence (StepSnapshot)

import type { StepId, StepConfig } from "@/_config/pipeline-flow";

// ── Step Result ───────────────────────────────────────────────────────────────

export type StepStatus = "idle" | "running" | "completed" | "failed";

export interface StepResultData {
  stepId: StepId;
  status: StepStatus;
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
  metadata?: Record<string, unknown>;
}

// ── Agent Interface ───────────────────────────────────────────────────────────

export interface StepAgentState {
  streamingContent: string;
  streamingThinking: string;
  isRunning: boolean;
  error: string | null;
  totalCostUsd: number;
}

export interface StepAgentContext {
  projectSlug: string;
  featureBrief: string;
  codeOutputDir: string;
  /** Results from all previous steps */
  previousSteps: Partial<Record<StepId, StepResultData>>;
  tier: "S" | "M" | "L";
  sessionId: string;
  /** Optional edit instruction for re-run flows */
  editInstruction?: string;
  emitState: (update: Partial<StepAgentState>) => void;
  getState: () => StepAgentState;
}

export interface SseEvent {
  type: string;
  stepId?: string;
  docId?: string;
  data?: Record<string, unknown>;
  run?: Record<string, unknown>;
  error?: string;
  chunk?: string;
  chunkType?: "thinking" | "content";
  content?: string;
  costUsd?: number;
  durationMs?: number;
  result?: Record<string, unknown>;
  message?: string;
  toolName?: string;
  [key: string]: unknown;
}

export interface StepAgent {
  /** Primary execution: send request, consume SSE, return result */
  execute(ctx: StepAgentContext): Promise<StepResultData>;
  /** Handle a single SSE event during streaming */
  handleEvent(event: SseEvent, ctx: StepAgentContext): Partial<StepAgentState>;
  /** Retry on failure */
  retry(ctx: StepAgentContext): Promise<StepResultData>;
}

// ── UI Interface ──────────────────────────────────────────────────────────────

export interface StepUIProps {
  /** Current agent state */
  agentState: StepAgentState;
  /** Null until step completes */
  stepResult: StepResultData | null;
  /** Step config from flow definition */
  stepConfig: StepConfig;
  /** Trigger agent execution (and optionally pass an edit instruction) */
  onStart: (editInstruction?: string) => void;
  /** Navigate to another step */
  onNavigate: (stepId: StepId) => void;
  /** True after DB hydration completes */
  isHydrated: boolean;
  /** Project ID for API calls */
  projectSlug: string;
}

// ── Snapshot Interface ────────────────────────────────────────────────────────

export type SnapshotData = Record<string, unknown>;

export interface StepSnapshot<T extends SnapshotData = SnapshotData> {
  /** Load snapshot from DB on page mount or step navigation */
  load(projectSlug: string): Promise<T | null>;
  /** Save snapshot to DB after step completes or content changes */
  save(projectSlug: string, data: T): Promise<void>;
  /** Extract context from the previous step's snapshot */
  getContextFromPrevious(previousSnapshot: unknown): Partial<T>;
}
