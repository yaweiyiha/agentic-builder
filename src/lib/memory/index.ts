/**
 * Public entry point for the memory system.
 *
 * - `getSystemMemory()` — L1 store at the AgenticBuilder repo root.
 * - `getProjectMemory(root)` — L2 store under a generated project root.
 *
 * Both are cached singletons keyed by absolute path so multiple callers in
 * the same process share lockfile state.
 */

import path from "node:path";

import { FileStore } from "./file-store";
import type { MemoryStore } from "./types";

export type { MemoryStore, MemoryRecord, RecallQuery, MemoryKind, MemoryLayer } from "./types";
export { MemorySchemaError } from "./types";
export { FileStore } from "./file-store";

const REGISTRY = new Map<string, MemoryStore>();

/**
 * L1 root resolution order:
 *   1. MEMORY_L1_ROOT env var (explicit override)
 *   2. process.cwd() — works because Next.js / npm scripts / tsx all run
 *      from the repo root in this project
 */
function l1Root(): string {
  if (process.env.MEMORY_L1_ROOT) return path.resolve(process.env.MEMORY_L1_ROOT);
  return process.cwd();
}

export function getSystemMemory(): MemoryStore {
  const root = l1Root();
  return cached(`L1:${root}`, () => new FileStore({ layer: "L1", root }));
}

export function getProjectMemory(projectRoot: string): MemoryStore {
  const root = path.resolve(projectRoot);
  return cached(`L2:${root}`, () => new FileStore({ layer: "L2", root }));
}

function cached(key: string, make: () => MemoryStore): MemoryStore {
  const hit = REGISTRY.get(key);
  if (hit) return hit;
  const store = make();
  REGISTRY.set(key, store);
  return store;
}

/** Test-only: drop the singleton cache. */
export function __resetMemoryRegistry(): void {
  REGISTRY.clear();
}
