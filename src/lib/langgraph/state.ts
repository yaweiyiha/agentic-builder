import { Annotation } from "@langchain/langgraph";
import type {
  CodingAgentRole,
  CodingTask,
  KickoffWorkItem,
  TaskSubStep,
} from "@/lib/pipeline/types";
import { type RalphConfig, DEFAULT_RALPH_CONFIG } from "@/lib/ralph";
import type { PrdSpec } from "@/lib/requirements/prd-spec-types";

// ─── Shared types ───

export interface GeneratedFile {
  path: string;
  role: CodingAgentRole;
  summary: string;
  exports?: string[];
}

export interface ApiContract {
  service: string;
  endpoint: string;
  method: string;
  /** TypeScript type literal for the request body/params, e.g. "{ email: string; password: string }" */
  requestFields?: string;
  /** TypeScript type literal for the success response body */
  responseFields?: string;
  /** "none" | "bearer" | "session" */
  authType: string;
  description?: string;
  /** Legacy: kept for backward compat, prefer requestFields + responseFields */
  schema: string;
  generatedBy: string;
}

export interface TaskResult {
  taskId: string;
  status: "completed" | "completed_with_warnings" | "failed";
  generatedFiles: string[];
  costUsd: number;
  durationMs: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  verifyPassed: boolean;
  fixCycles: number;
  warnings?: string[];
  subSteps?: TaskSubStep[];
}

export interface PhaseResult {
  role: CodingAgentRole;
  workerLabel: string;
  taskResults: TaskResult[];
  totalCostUsd: number;
}

export interface VerifyResult {
  workspace: string;
  buildOk: boolean;
  errors?: string;
}

// ─── Supervisor (parent) graph state ───

export const SupervisorStateAnnotation = Annotation.Root({
  tasks: Annotation<CodingTask[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  outputDir: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "generated-code",
  }),
  projectContext: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  frontendDesignContext: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  /** When true, tier scaffold was copied in Coding API — architect phase skips LLM. */
  prebuiltScaffold: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  /** Relative paths from scaffolds/<tier>/; fsWrite merges or skips instead of overwriting. */
  scaffoldProtectedPaths: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  architectTasks: Annotation<CodingTask[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  backendTasks: Annotation<CodingTask[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  frontendTasks: Annotation<CodingTask[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  testTasks: Annotation<CodingTask[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  fileRegistry: Annotation<GeneratedFile[]>({
    reducer: (prev, next) => {
      const map = new Map(prev.map((f) => [f.path, f]));
      for (const f of next) map.set(f.path, f);
      return [...map.values()];
    },
    default: () => [],
  }),

  apiContracts: Annotation<ApiContract[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  phaseResults: Annotation<PhaseResult[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  totalCostUsd: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),

  scaffoldErrors: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  scaffoldFixAttempts: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  integrationErrors: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  integrationFixAttempts: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  runtimeVerifyErrors: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  runtimeVerifyAttempts: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  e2eVerifyErrors: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  e2eVerifyAttempts: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  /** RALPH loop configuration. Passed down to every worker. */
  ralphConfig: Annotation<RalphConfig>({
    reducer: (_prev, next) => next,
    default: () => ({ ...DEFAULT_RALPH_CONFIG }),
  }),

  /**
   * Session id for this coding run. Used by self-heal code to look up the
   * correct `RepairEmitter` via `getRepairEmitter(sessionId)` without having
   * to pass the function through LangGraph state (which is JSON-serialised).
   */
  sessionId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  /**
   * Structured PRD spec (pages + interactive components) — forwarded from
   * the kickoff engine via `.blueprint/PRD_SPEC.json`. Frontend workers
   * use it to turn PAGE / CMP ids into concrete view/component outputs.
   */
  prdSpec: Annotation<PrdSpec | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type SupervisorState = typeof SupervisorStateAnnotation.State;

// ─── Worker (sub-graph) state ───

export const WorkerStateAnnotation = Annotation.Root({
  role: Annotation<CodingAgentRole>({
    reducer: (_prev, next) => next,
    default: () => "backend" as CodingAgentRole,
  }),
  workerLabel: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  tasks: Annotation<CodingTask[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  outputDir: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  projectContext: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  fileRegistrySnapshot: Annotation<GeneratedFile[]>({
    reducer: (prev, next) => {
      const map = new Map(prev.map((f) => [f.path, f]));
      for (const f of next) map.set(f.path, f);
      return [...map.values()];
    },
    default: () => [],
  }),
  apiContractsSnapshot: Annotation<ApiContract[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  scaffoldProtectedPaths: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  currentTaskIndex: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  verifyErrors: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  fixAttempts: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  taskResults: Annotation<TaskResult[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  generatedFiles: Annotation<GeneratedFile[]>({
    reducer: (prev, next) => {
      const map = new Map(prev.map((f) => [f.path, f]));
      for (const f of next) map.set(f.path, f);
      return [...map.values()];
    },
    default: () => [],
  }),
  currentTaskGeneratedFiles: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  currentTaskCostUsd: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  currentTaskDurationMs: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  currentTaskTokenUsage: Annotation<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>({
    reducer: (_prev, next) => next,
    default: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  }),
  workerCostUsd: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),
  currentTaskRetryCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  currentTaskLastError: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  /** RALPH: raw LLM output for the current task (used to check completion promise). */
  currentTaskLastRawContent: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  /** RALPH: config propagated from supervisor. */
  ralphConfig: Annotation<RalphConfig>({
    reducer: (_prev, next) => next,
    default: () => ({ ...DEFAULT_RALPH_CONFIG }),
  }),
  /** Dynamic sub-steps planned by the worker for the current task. */
  currentTaskSubSteps: Annotation<TaskSubStep[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** RALPH: cumulative estimated prompt tokens in this worker session (for context rotation). */
  estimatedContextTokens: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),
  /** RALPH: set true when context window exceeds rotation threshold. */
  contextRotationNeeded: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  /** Session id propagated from supervisor — used to look up the RepairEmitter. */
  sessionId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  /**
   * Snapshot of sha256 hashes for every file in the current task's
   * `files.modifies` list, captured at task start. The file-plan verifier
   * diffs these against post-generation hashes to detect "modified" files
   * that were never actually touched.
   */
  currentTaskModifiesSnapshot: Annotation<Record<string, string>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),

  /** Structured PRD spec forwarded from supervisor — shared with workers. */
  prdSpec: Annotation<PrdSpec | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type WorkerState = typeof WorkerStateAnnotation.State;
