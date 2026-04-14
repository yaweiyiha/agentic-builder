import type { CodingAgentInstance, CodingAgentRole, CodingTask } from "@/lib/pipeline/types";

export const PHASE_TO_ROLE: Record<string, CodingAgentRole> = {
  Scaffolding: "architect",
  "Data Layer": "architect",
  Infrastructure: "architect",
  "Auth & Gateway": "backend",
  "Backend Services": "backend",
  Integration: "backend",
  Frontend: "frontend",
  Testing: "test",
};

/** Left stripe on task cards / topology nodes (matches CodingAgentGraph role colors). */
export const CODING_ROLE_STRIPE: Record<CodingAgentRole, string> = {
  architect: "bg-amber-500",
  backend: "bg-blue-600",
  frontend: "bg-violet-600",
  test: "bg-emerald-600",
};

export function resolveTaskRole(
  task: CodingTask,
  agentById: Map<string, CodingAgentInstance>,
): CodingAgentRole {
  if (task.assignedAgentId) {
    const assignedAgent = agentById.get(task.assignedAgentId);
    if (assignedAgent) return assignedAgent.role;
  }
  if (PHASE_TO_ROLE[task.phase]) return PHASE_TO_ROLE[task.phase];

  const lower = `${task.phase} ${task.title} ${task.description}`.toLowerCase();
  if (/test|spec|e2e|vitest|playwright|k6|coverage/.test(lower)) return "test";
  if (/scaffold|infra|docker|helm|ci\/cd|deploy|config|schema|migrat/.test(lower)) {
    return "architect";
  }
  if (/frontend|react|component|page|ui|css|tailwind|hook|store|next/.test(lower)) {
    return "frontend";
  }
  return "backend";
}

export function isCompletedTask(task: CodingTask): boolean {
  return (
    task.codingStatus === "completed" ||
    task.codingStatus === "completed_with_warnings"
  );
}

export function formatTaskStatus(task: CodingTask): string {
  if (task.codingStatus === "completed_with_warnings") return "Warning";
  if (task.codingStatus === "completed") return "Done";
  if (task.codingStatus === "failed") return "Failed";
  if (task.progressStage === "fixing") return "Fixing";
  if (task.progressStage === "verifying") return "Verifying";
  if (task.progressStage === "generating") return "Generating";
  if (task.codingStatus === "in_progress") return "Running";
  return "Pending";
}

export function taskMetaColorClass(task: CodingTask): string {
  if (task.codingStatus === "failed") return "text-red-500";
  if (task.codingStatus === "completed_with_warnings") return "text-amber-600";
  if (task.progressStage === "fixing") return "text-amber-700";
  if (task.progressStage === "verifying") return "text-zinc-500";
  if (task.codingStatus === "in_progress") return "text-zinc-500";
  return "text-zinc-400";
}
