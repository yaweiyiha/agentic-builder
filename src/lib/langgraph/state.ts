import { Annotation } from "@langchain/langgraph";
import type {
  CodingAgentRole,
  CodingTask,
  KickoffWorkItem,
} from "@/lib/pipeline/types";

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
});

export type WorkerState = typeof WorkerStateAnnotation.State;
