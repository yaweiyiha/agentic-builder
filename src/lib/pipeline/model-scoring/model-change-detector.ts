/**
 * `MODEL_CONFIG` change detector.
 *
 * On every session we:
 *   1. Load the previous snapshot from `.ralph/last-model-config.json`.
 *   2. Diff it against the current `MODEL_CONFIG` export.
 *   3. Return a list of `ModelConfigChange` entries — unchanged stages
 *      are reported too so the renderer can show a complete table.
 *   4. Persist the current snapshot for next session.
 *
 * The detector is deliberately pure w.r.t. file I/O — callers do the
 * actual read/write. This keeps the diff logic testable in isolation.
 */

import fs from "fs/promises";
import path from "path";
import { MODEL_CONFIG, type ModelConfigKey } from "@/lib/model-config";
import type { ModelConfigChange, ModelConfigSnapshot } from "./types";

const SNAPSHOT_FILENAME = "last-model-config.json";

/** Resolve the snapshot file path. */
export function modelConfigSnapshotPath(outputDir: string): string {
  return path.join(outputDir, ".ralph", SNAPSHOT_FILENAME);
}

/** Load the last-known snapshot. Returns null if absent / unreadable. */
export async function loadPreviousSnapshot(
  outputDir: string,
): Promise<ModelConfigSnapshot | null> {
  try {
    const raw = await fs.readFile(modelConfigSnapshotPath(outputDir), "utf-8");
    const parsed = JSON.parse(raw) as ModelConfigSnapshot;
    if (parsed && parsed.config && typeof parsed.config === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist the current `MODEL_CONFIG` as the new snapshot. */
export async function saveCurrentSnapshot(
  outputDir: string,
): Promise<{ path: string; error?: string }> {
  const file = modelConfigSnapshotPath(outputDir);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const snapshot: ModelConfigSnapshot = {
      capturedAt: new Date().toISOString(),
      // MODEL_CONFIG is `as const`, so a shallow spread preserves shape.
      config: { ...MODEL_CONFIG },
    };
    await fs.writeFile(file, JSON.stringify(snapshot, null, 2), "utf-8");
    return { path: file };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: file, error: message };
  }
}

/**
 * Compute diff between previous and current MODEL_CONFIG.
 *
 * Returns one entry per stage key present in either side. Unchanged
 * stages are included with `kind: "unchanged"` so the renderer can
 * show a complete table; filter them out at render time if unwanted.
 */
export function diffModelConfigs(
  previous: ModelConfigSnapshot | null,
): ModelConfigChange[] {
  const prev = previous?.config ?? {};
  const curr = MODEL_CONFIG as Record<string, string | string[] | readonly string[]>;

  const keys = new Set<string>([...Object.keys(prev), ...Object.keys(curr)]);
  const changes: ModelConfigChange[] = [];
  for (const key of keys) {
    const prevChain = toChain(prev[key]);
    const currChain = toChain(curr[key]);
    const prevPrimary = prevChain[0];
    const currPrimary = currChain[0];

    // `as ModelConfigKey` is safe here because the key came from the
    // current MODEL_CONFIG object keyspace, and keys that only exist in
    // the previous snapshot will be reported as "removed" (caller can
    // still display them).
    const stageKey = key as ModelConfigKey;

    if (prevChain.length === 0 && currChain.length > 0) {
      changes.push({
        stageKey,
        kind: "added",
        current: currChain,
        currentPrimary: currPrimary,
      });
      continue;
    }
    if (currChain.length === 0 && prevChain.length > 0) {
      changes.push({
        stageKey,
        kind: "removed",
        previous: prevChain,
        previousPrimary: prevPrimary,
      });
      continue;
    }
    if (prevPrimary !== currPrimary) {
      changes.push({
        stageKey,
        kind: "changed-primary",
        previous: prevChain,
        current: currChain,
        previousPrimary: prevPrimary,
        currentPrimary: currPrimary,
      });
      continue;
    }
    if (!sameChain(prevChain, currChain)) {
      changes.push({
        stageKey,
        kind: "changed-fallbacks",
        previous: prevChain,
        current: currChain,
        previousPrimary: prevPrimary,
        currentPrimary: currPrimary,
      });
      continue;
    }
    changes.push({
      stageKey,
      kind: "unchanged",
      previous: prevChain,
      current: currChain,
      previousPrimary: prevPrimary,
      currentPrimary: currPrimary,
    });
  }

  // Show substantive changes first, `unchanged` last.
  changes.sort((a, b) => {
    const weight = (c: ModelConfigChange): number => {
      if (c.kind === "changed-primary") return 0;
      if (c.kind === "changed-fallbacks") return 1;
      if (c.kind === "added") return 2;
      if (c.kind === "removed") return 3;
      return 4;
    };
    return weight(a) - weight(b);
  });
  return changes;
}

/** Whether any substantive change was detected (excludes `unchanged`). */
export function hasSubstantiveChange(changes: ModelConfigChange[]): boolean {
  return changes.some((c) => c.kind !== "unchanged");
}

function toChain(value: string | string[] | readonly string[] | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return [...value];
  return [value as string];
}

function sameChain(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
