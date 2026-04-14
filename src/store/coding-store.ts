"use client";

import { create } from "zustand";
import type {
  AgentLogEntry,
  CodingAgentInstance,
  CodingTask,
  KickoffWorkItem,
} from "@/lib/pipeline/types";

export interface IntegrationVerifyState {
  status: "verifying" | "fixing" | "passed" | "failed";
  errors?: string;
  errorCount?: number;
  fixAttempts: number;
  maxFixAttempts: number;
  filesFixed?: number;
}

export interface TaskRefinementState {
  status: "running" | "completed";
  taskCountBefore?: number;
  taskCountAfter?: number;
}

export interface GapAnalysisState {
  status: "running" | "dispatching" | "completed" | "no_gaps";
  gapCount: number;
  supplementaryTaskIds: string[];
}

interface CodingState {
  sessionId: string | null;
  status: "idle" | "running" | "completed" | "failed";
  agents: CodingAgentInstance[];
  tasks: CodingTask[];
  selectedAgentId: string | null;
  totalCostUsd: number;
  error: string | null;
  integrationVerify: IntegrationVerifyState | null;
  taskRefinement: TaskRefinementState | null;
  gapAnalysis: GapAnalysisState | null;
  /** Supervisor-level logs (phase verify, fix, install, etc.) */
  supervisorLogs: AgentLogEntry[];

  startCoding: (
    runId: string,
    tasks: KickoffWorkItem[],
    codeOutputDir: string,
    projectTier?: string,
  ) => void;
  selectAgent: (agentId: string | null) => void;
  reset: () => void;
}

export const useCodingStore = create<CodingState>()((set, get) => ({
  sessionId: null,
  status: "idle",
  agents: [],
  tasks: [],
  selectedAgentId: null,
  totalCostUsd: 0,
  error: null,
  integrationVerify: null,
  taskRefinement: null,
  gapAnalysis: null,
  supervisorLogs: [],

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  startCoding: (runId, taskItems, codeOutputDir, projectTier) => {
    set({
      status: "running",
      error: null,
      agents: [],
      tasks: [],
      selectedAgentId: null,
      totalCostUsd: 0,
      sessionId: null,
      integrationVerify: null,
      taskRefinement: null,
      gapAnalysis: null,
      supervisorLogs: [],
    });

    fetch("/api/agents/coding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, tasks: taskItems, codeOutputDir, projectTier }),
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          set({
            status: "failed",
            error:
              (errData as { error?: string }).error || "Coding request failed",
          });
          return;
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          set({ status: "failed", error: "No response body" });
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6));
              handleCodingEvent(payload, set, get);
            } catch {
              /* skip */
            }
          }
        }

        if (buffer.startsWith("data: ")) {
          try {
            handleCodingEvent(JSON.parse(buffer.slice(6)), set, get);
          } catch {
            /* skip */
          }
        }

        const state = get();
        if (state.status === "running") set({ status: "completed" });
      })
      .catch((err) => {
        set({
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });
  },

  reset: () => {
    set({
      sessionId: null,
      status: "idle",
      agents: [],
      tasks: [],
      selectedAgentId: null,
      totalCostUsd: 0,
      error: null,
      integrationVerify: null,
      taskRefinement: null,
      gapAnalysis: null,
      supervisorLogs: [],
    });
  },
}));

type IncomingPayload = {
  type: string;
  sessionId?: string;
  agentId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
  session?: { tasks: CodingTask[]; totalCostUsd: number };
};

function handleCodingEvent(
  payload: IncomingPayload,
  set: (s: Partial<CodingState>) => void,
  get: () => CodingState,
) {
  const { type } = payload;

  if (type === "session_start") {
    const initialTasks = (payload.data?.tasks as CodingTask[] | undefined) ?? [];
    set({
      sessionId: payload.sessionId,
      tasks: initialTasks,
    });
    return;
  }

  if (type === "tasks_assigned") {
    const assignments = payload.data?.assignments as
      | { agentId: string; taskIds: string[] }[]
      | undefined;
    if (assignments) {
      const tasks = get().tasks.map((t) => {
        const match = assignments.find((a) => a.taskIds.includes(t.id));
        if (match) return { ...t, assignedAgentId: match.agentId };
        return t;
      });
      set({ tasks });
    }
    return;
  }

  if (type === "agent_created") {
    const agents = [...get().agents];
    agents.push({
      id: payload.agentId!,
      role: payload.data?.role as CodingAgentInstance["role"],
      label: payload.data?.label as string,
      status: "idle",
      currentTaskId: null,
      completedTaskIds: [],
      failedTaskIds: [],
      logs: [],
      totalCostUsd: 0,
    });
    set({ agents });
    return;
  }

  if (type === "agent_task_start") {
    const taskId = payload.taskId;
    const agents = get().agents.map((a) => {
      if (a.id !== payload.agentId) return a;
      return {
        ...a,
        status: "working" as const,
        currentTaskId: taskId ?? null,
        logs: [
          ...a.logs,
          {
            timestamp: new Date().toISOString(),
            type: "task_start" as const,
            taskId,
            message: `Starting: ${payload.data?.title}`,
          },
        ],
      };
    });
    const existingTasks = get().tasks;
    if (!taskId) {
      set({ agents, tasks: existingTasks });
      return;
    }
    const taskExists = existingTasks.some((t) => t.id === taskId);
    let tasks: CodingTask[];
    if (taskExists) {
      tasks = existingTasks.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          assignedAgentId: payload.agentId ?? t.assignedAgentId,
          codingStatus: "in_progress" as const,
          progressStage: "generating" as const,
          fixAttempts: 0,
          verifyErrors: undefined,
          errorPreview: undefined,
        };
      });
    } else {
      tasks = [
        ...existingTasks,
        {
          id: taskId,
          phase: (payload.data?.phase as string) ?? "Dynamic",
          title: (payload.data?.title as string) ?? taskId,
          description: (payload.data?.description as string) ?? "",
          estimatedHours: 0,
          executionKind: "ai_autonomous" as const,
          files: [],
          dependencies: [],
          priority: "P1" as const,
          assignedAgentId: payload.agentId ?? null,
          codingStatus: "in_progress" as const,
          progressStage: "generating" as const,
          fixAttempts: 0,
        },
      ];
    }
    set({ agents, tasks });
    return;
  }

  if (type === "agent_task_progress") {
    const taskId = payload.taskId;
    if (!taskId) return;

    const stage = payload.data?.stage as CodingTask["progressStage"] | undefined;
    const fixAttempt = payload.data?.fixAttempt as number | undefined;
    const verifyErrors = payload.data?.verifyErrors as string | undefined;
    const errorPreview = payload.data?.errorPreview as string | undefined;

    const tasks = get().tasks.map((t) => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        progressStage: stage ?? t.progressStage,
        fixAttempts: fixAttempt ?? t.fixAttempts,
        verifyErrors: verifyErrors ?? t.verifyErrors,
        errorPreview: errorPreview ?? t.errorPreview,
      };
    });

    set({ tasks });
    return;
  }

  if (type === "agent_task_complete") {
    const agents = get().agents.map((a) => {
      if (a.id !== payload.agentId) return a;
      const costUsd = (payload.data?.costUsd as number) ?? 0;
      const completedStatus =
        (payload.data?.status as CodingTask["codingStatus"] | undefined) ??
        "completed";
      const tokenUsage = payload.data?.tokenUsage as
        | { totalTokens?: number }
        | undefined;
      const totalTokens = tokenUsage?.totalTokens ?? 0;
      return {
        ...a,
        currentTaskId: null,
        completedTaskIds: [...a.completedTaskIds, payload.taskId!],
        totalCostUsd: a.totalCostUsd + costUsd,
        logs: [
          ...a.logs,
          {
            timestamp: new Date().toISOString(),
            type: "task_complete" as const,
            taskId: payload.taskId,
            details: [
              typeof payload.data?.verifyErrors === "string"
                ? (payload.data.verifyErrors as string)
                : "",
              ((payload.data?.modifiedFiles as string[]) ??
                (payload.data?.filesGenerated as string[]) ??
                [])
                .map((f) => `- ${f}`)
                .join("\n"),
            ]
              .filter(Boolean)
              .join("\n\n"),
            message:
              completedStatus === "completed_with_warnings"
                ? `Completed with warnings (${((payload.data?.filesGenerated as string[]) ?? []).length} files, ${totalTokens.toLocaleString()} tokens, $${costUsd.toFixed(4)})`
                : `Completed (${((payload.data?.filesGenerated as string[]) ?? []).length} files, ${totalTokens.toLocaleString()} tokens, $${costUsd.toFixed(4)})`,
          },
        ],
      };
    });
    const existingTasks = get().tasks;
    const taskExists = existingTasks.some((t) => t.id === payload.taskId);
    const filesGenerated = (payload.data?.filesGenerated as string[]) ?? [];
    const modifiedFiles = (payload.data?.modifiedFiles as string[]) ?? filesGenerated;
    const tokenUsage = payload.data?.tokenUsage as
      | {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        }
      | undefined;
    let tasks: CodingTask[];
    if (taskExists) {
      tasks = existingTasks.map((t) => {
        if (t.id !== payload.taskId) return t;
        return {
          ...t,
          assignedAgentId: payload.agentId ?? t.assignedAgentId,
          codingStatus:
            (payload.data?.status as CodingTask["codingStatus"] | undefined) ??
            ("completed" as const),
          generatedFiles: filesGenerated,
          modifiedFiles,
          tokenUsage: tokenUsage ?? t.tokenUsage,
          taskCostUsd: (payload.data?.costUsd as number | undefined) ?? t.taskCostUsd,
          progressStage: undefined,
          fixAttempts:
            (payload.data?.fixCycles as number | undefined) ?? t.fixAttempts,
          verifyErrors:
            (payload.data?.verifyErrors as string | undefined) ??
            t.verifyErrors,
          errorPreview:
            (payload.data?.verifyErrors as string | undefined)?.slice(0, 200) ??
            t.errorPreview,
        };
      });
    } else {
      tasks = [
        ...existingTasks,
        {
          id: payload.taskId!,
          phase: (payload.data?.phase as string) ?? "Dynamic",
          title: (payload.data?.title as string) ?? payload.taskId!,
          description: "",
          estimatedHours: 0,
          executionKind: "ai_autonomous" as const,
          files: [],
          dependencies: [],
          priority: "P1" as const,
          assignedAgentId: payload.agentId ?? null,
          codingStatus:
            (payload.data?.status as CodingTask["codingStatus"] | undefined) ??
            ("completed" as const),
          generatedFiles: filesGenerated,
          modifiedFiles,
          tokenUsage,
          taskCostUsd: payload.data?.costUsd as number | undefined,
          fixAttempts: payload.data?.fixCycles as number | undefined,
          verifyErrors: payload.data?.verifyErrors as string | undefined,
          errorPreview: (payload.data?.verifyErrors as string | undefined)?.slice(
            0,
            200,
          ),
        },
      ];
    }
    const totalCostUsd =
      get().totalCostUsd + ((payload.data?.costUsd as number) ?? 0);
    set({ agents, tasks, totalCostUsd });
    return;
  }

  if (type === "agent_task_error") {
    const agents = get().agents.map((a) => {
      if (a.id !== payload.agentId) return a;
      return {
        ...a,
        currentTaskId: null,
        failedTaskIds: [...a.failedTaskIds, payload.taskId!],
        logs: [
          ...a.logs,
          {
            timestamp: new Date().toISOString(),
            type: "task_error" as const,
            taskId: payload.taskId,
            details: payload.data?.error as string | undefined,
            message: `Failed: ${payload.data?.error}`,
          },
        ],
      };
    });
    const tasks = get().tasks.map((t) => {
      if (t.id !== payload.taskId) return t;
      return {
        ...t,
        codingStatus: "failed" as const,
        error: payload.data?.error as string,
        progressStage: undefined,
      };
    });
    set({ agents, tasks });
    return;
  }

  if (type === "agent_log") {
    const agents = get().agents.map((a) => {
      if (a.id !== payload.agentId) return a;
      return {
        ...a,
        logs: [
          ...a.logs,
          {
            timestamp: new Date().toISOString(),
            type:
              ((payload.data?.logType as AgentLogEntry["type"] | undefined) ??
                "info") as AgentLogEntry["type"],
            taskId: payload.taskId,
            message: (payload.data?.message as string) ?? "",
            details: payload.data?.details as string | undefined,
          },
        ],
      };
    });
    set({ agents });
    return;
  }

  if (type === "agent_task_substeps") {
    const taskId = payload.taskId;
    if (!taskId || !payload.data?.subSteps) return;
    const subSteps = payload.data.subSteps as CodingTask["subSteps"];
    const tasks = get().tasks.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, subSteps };
    });
    set({ tasks });
    return;
  }

  if (type === "task_refinement_start") {
    const logs = get().supervisorLogs;
    set({
      taskRefinement: {
        status: "running",
        taskCountBefore: get().tasks.length,
      },
      supervisorLogs: [
        ...logs,
        {
          timestamp: new Date().toISOString(),
          type: "info",
          message: "Refining task breakdown with scaffold context...",
        },
      ],
    });
    return;
  }

  if (type === "task_refinement_complete") {
    const refinedTasks = (payload.data?.refinedTasks as CodingTask[]) ?? [];
    const logs = get().supervisorLogs;
    const taskCountBefore = get().taskRefinement?.taskCountBefore ?? 0;

    if (refinedTasks.length > 0) {
      const existingTasks = get().tasks;
      const mergedTasks = refinedTasks.map((rt) => {
        const existing = existingTasks.find((t) => t.id === rt.id);
        return existing ? { ...existing, ...rt } : rt;
      });
      set({ tasks: mergedTasks });
    }

    set({
      taskRefinement: {
        status: "completed",
        taskCountBefore,
        taskCountAfter: refinedTasks.length || get().tasks.length,
      },
      supervisorLogs: [
        ...logs,
        {
          timestamp: new Date().toISOString(),
          type: "info",
          message: `Task breakdown refined: backend=${payload.data?.backendCount ?? 0}, frontend=${payload.data?.frontendCount ?? 0}, test=${payload.data?.testCount ?? 0}`,
        },
      ],
    });
    return;
  }

  if (type === "gap_analysis_start") {
    const logs = get().supervisorLogs;
    set({
      gapAnalysis: {
        status: "running",
        gapCount: 0,
        supplementaryTaskIds: [],
      },
      supervisorLogs: [
        ...logs,
        {
          timestamp: new Date().toISOString(),
          type: "info",
          message: "Running gap analysis to find missing functionality...",
        },
      ],
    });
    return;
  }

  if (type === "gap_analysis_complete") {
    const gapCount = (payload.data?.gapCount as number) ?? 0;
    const supplementaryTasks = (payload.data?.supplementaryTasks as CodingTask[]) ?? [];
    const logs = get().supervisorLogs;
    const existingTasks = get().tasks;

    const newTasks = supplementaryTasks
      .filter((st) => !existingTasks.some((t) => t.id === st.id))
      .map((st) => ({
        ...st,
        assignedAgentId: null,
        codingStatus: "pending" as const,
      }));

    set({
      tasks: [...existingTasks, ...newTasks],
      gapAnalysis: {
        status: gapCount > 0 ? "completed" : "no_gaps",
        gapCount,
        supplementaryTaskIds: newTasks.map((t) => t.id),
      },
      supervisorLogs: [
        ...logs,
        {
          timestamp: new Date().toISOString(),
          type: "info",
          message:
            gapCount > 0
              ? `Gap analysis: ${gapCount} supplementary task(s) identified`
              : "Gap analysis: no critical gaps found",
        },
      ],
    });
    return;
  }

  if (type === "supplementary_dispatch") {
    const logs = get().supervisorLogs;
    const prev = get().gapAnalysis;
    set({
      gapAnalysis: prev
        ? { ...prev, status: "dispatching" }
        : { status: "dispatching", gapCount: 0, supplementaryTaskIds: [] },
      supervisorLogs: [
        ...logs,
        {
          timestamp: new Date().toISOString(),
          type: "info",
          message: "Dispatching supplementary workers for gap tasks...",
        },
      ],
    });
    return;
  }

  if (type === "agent_completed") {
    const agents = get().agents.map((a) => {
      if (a.id !== payload.agentId) return a;
      return {
        ...a,
        status: (payload.data?.status as CodingAgentInstance["status"]) ?? "completed",
      };
    });
    set({ agents });
    return;
  }

  if (type === "done" && payload.session) {
    const session = payload.session;
    set({
      status: "completed",
      tasks: session.tasks ?? get().tasks,
      totalCostUsd: session.totalCostUsd ?? get().totalCostUsd,
    });
    return;
  }

  if (type === "session_complete") {
    set({ status: "completed" });
    return;
  }

  if (type === "session_error") {
    const errorCategory = (payload.data?.errorCategory as string) ?? "unknown";
    const currentTasks = get().tasks;
    const currentAgents = get().agents;

    const cleanedTasks = currentTasks.map((t) =>
      t.codingStatus === "in_progress"
        ? { ...t, codingStatus: "failed" as const }
        : t,
    );

    const cleanedAgents = currentAgents.map((a) =>
      a.status === "working"
        ? { ...a, status: "idle" as const, currentTaskId: null }
        : a,
    );

    set({
      status: "failed",
      error: (payload.data?.error as string) ?? "Session failed",
      tasks: cleanedTasks,
      agents: cleanedAgents,
    });

    console.warn(
      `[CodingStore] session_error (${errorCategory}): ` +
      `marked ${cleanedTasks.filter((_, i) => currentTasks[i].codingStatus === "in_progress").length} task(s) failed, ` +
      `reset ${cleanedAgents.filter((_, i) => currentAgents[i].status === "working").length} agent(s) to idle`,
    );
    return;
  }

  if (type === "integration_verify_start") {
    set({
      integrationVerify: {
        status: "verifying",
        fixAttempts: 0,
        maxFixAttempts: 3,
      },
    });
    return;
  }

  if (type === "integration_verify_result") {
    const passed = payload.data?.passed as boolean;
    const errors = payload.data?.errors as string | undefined;
    const errorCount = payload.data?.errorCount as number | undefined;
    const fixAttempts = (payload.data?.fixAttempts as number) ?? 0;
    const maxFixAttempts = (payload.data?.maxFixAttempts as number) ?? 3;

    if (passed) {
      set({
        integrationVerify: {
          status: "passed",
          fixAttempts,
          maxFixAttempts,
        },
      });
    } else {
      const atMax = fixAttempts >= maxFixAttempts;
      set({
        integrationVerify: {
          status: atMax ? "failed" : "fixing",
          errors,
          errorCount,
          fixAttempts,
          maxFixAttempts,
        },
      });
    }
    return;
  }

  if (type === "supervisor_log") {
    const entry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      type: "info",
      message: (payload.data?.message as string) ?? "",
    };
    set({ supervisorLogs: [...get().supervisorLogs, entry] });
    return;
  }

  if (type === "integration_fix_result") {
    const attempt = (payload.data?.attempt as number) ?? 0;
    const filesFixed = payload.data?.filesFixed as number | undefined;
    const prev = get().integrationVerify;
    set({
      integrationVerify: {
        status: "verifying",
        fixAttempts: attempt,
        maxFixAttempts: prev?.maxFixAttempts ?? 3,
        filesFixed,
        errors: undefined,
        errorCount: undefined,
      },
    });
    return;
  }
}
