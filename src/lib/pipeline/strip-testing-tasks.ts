import type { KickoffWorkItem } from "./types";

/**
 * Drops tasks with phase "Testing" and removes dependency edges to removed ids.
 * Automated test tasks are disabled until the pipeline runs test workers again.
 */
export function stripTestingPhaseTasks<T extends KickoffWorkItem>(tasks: T[]): T[] {
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
