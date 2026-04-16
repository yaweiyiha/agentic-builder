import type { KickoffWorkItem } from "./types";

/**
 * Normalizes task lists for coding runs.
 * By default, Testing tasks are preserved because the pipeline now supports
 * dedicated E2E/unit test generation again.
 *
 * Set `BLUEPRINT_ENABLE_TEST_TASKS=0` to keep the old stripping behavior.
 */
export function stripTestingPhaseTasks<T extends KickoffWorkItem>(tasks: T[]): T[] {
  if (process.env.BLUEPRINT_ENABLE_TEST_TASKS !== "0") {
    return tasks;
  }

  const removed = new Set(
    tasks.filter((t) => t.phase === "Testing").map((t) => t.id),
  );
  if (removed.size === 0) return tasks;

  const kept = tasks.filter((t) => !removed.has(t.id));
  return kept.map((t) => {
    const deps = t.dependencies;
    if (!Array.isArray(deps) || deps.length === 0) return t;
    const filtered = deps.filter((id) => !removed.has(id));
    if (filtered.length === deps.length) return t;
    return { ...t, dependencies: filtered };
  });
}
