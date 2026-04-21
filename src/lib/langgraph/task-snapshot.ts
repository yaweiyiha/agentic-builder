/**
 * Per-task snapshot + rollback.
 *
 * Before a worker starts generating code for a task, `snapshotTask` captures
 * the current on-disk state of every file in `task.files.creates ∪ modifies`.
 * If the task fails after partially writing files, `restoreTask` undoes the
 * damage: files that did not exist before the task are deleted; files that
 * did exist are written back to their original contents.
 *
 * Snapshots live on disk under `<outputDir>/.agentic-snapshot/<taskId>/` so
 * they survive process restarts and don't consume worker-state memory.
 * `discardTask` is called on successful completion to clean up.
 */

import fs from "fs/promises";
import path from "path";
import type { CodingTask } from "@/lib/pipeline/types";

export const SNAPSHOT_DIR = ".agentic-snapshot";

const MARKER_SUFFIX = ".__absent__";
const MAX_TOTAL_SNAPSHOT_BYTES = 10 * 1024 * 1024; // 10 MB cap per task
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file

/**
 * Capture the pre-task state of every file in the task's creates+modifies plan.
 * Safe to call before every task. No-op if `taskId` is empty. If the snapshot
 * dir for this task already exists, we skip — previous snapshot wins.
 */
export async function snapshotTask(
  task: CodingTask,
  outputDir: string,
): Promise<void> {
  if (!task?.id) return;
  const files = collectPlanFiles(task);
  if (files.length === 0) return;

  const snapshotRoot = path.join(outputDir, SNAPSHOT_DIR, task.id);
  try {
    await fs.access(snapshotRoot);
    // Already snapshotted this task — leave it alone.
    return;
  } catch {
    // Doesn't exist yet — proceed.
  }

  try {
    await fs.mkdir(snapshotRoot, { recursive: true });
  } catch (err) {
    console.warn(
      `[TaskSnapshot] mkdir failed for task ${task.id} (ignored):`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  let usedBytes = 0;
  for (const rel of files) {
    if (usedBytes >= MAX_TOTAL_SNAPSHOT_BYTES) break;
    try {
      const abs = path.join(outputDir, rel);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) {
        // File absent — record marker so restoreTask knows to delete later.
        await writeSnapshotMarker(snapshotRoot, rel);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_BYTES) {
        // Over the per-file cap: skip body, still mark as "present but skipped"
        // so restore can do nothing rather than mis-delete it.
        await writeSnapshotSkipped(snapshotRoot, rel);
        continue;
      }
      const buf = await fs.readFile(abs);
      const dest = path.join(snapshotRoot, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, buf);
      usedBytes += buf.length;
    } catch (err) {
      console.warn(
        `[TaskSnapshot] capture failed for ${rel} (ignored):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Roll the task's touched files back to their pre-task state. Safe to call
 * even if no snapshot exists (no-op in that case).
 */
export async function restoreTask(
  task: CodingTask,
  outputDir: string,
): Promise<{ restored: string[]; deleted: string[]; skipped: string[] }> {
  const out = { restored: [] as string[], deleted: [] as string[], skipped: [] as string[] };
  if (!task?.id) return out;
  const snapshotRoot = path.join(outputDir, SNAPSHOT_DIR, task.id);
  try {
    await fs.access(snapshotRoot);
  } catch {
    return out; // no snapshot to restore from
  }

  const files = collectPlanFiles(task);
  for (const rel of files) {
    try {
      const abs = path.join(outputDir, rel);
      const markerPath = path.join(snapshotRoot, rel + MARKER_SUFFIX);
      const skippedPath = path.join(snapshotRoot, rel + ".__skipped__");
      const bodyPath = path.join(snapshotRoot, rel);

      const markerExists = await fileExists(markerPath);
      const skippedExists = await fileExists(skippedPath);
      const bodyExists = await fileExists(bodyPath);

      if (markerExists) {
        // File didn't exist pre-task — delete whatever was produced.
        await fs.unlink(abs).catch(() => {});
        out.deleted.push(rel);
      } else if (bodyExists) {
        const buf = await fs.readFile(bodyPath);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, buf);
        out.restored.push(rel);
      } else if (skippedExists) {
        out.skipped.push(rel);
      }
    } catch (err) {
      console.warn(
        `[TaskSnapshot] restore failed for ${rel} (ignored):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await discardSnapshotDir(snapshotRoot);
  return out;
}

/**
 * Delete the snapshot directory for a successful task. Safe if the dir
 * doesn't exist.
 */
export async function discardTaskSnapshot(
  task: CodingTask,
  outputDir: string,
): Promise<void> {
  if (!task?.id) return;
  const snapshotRoot = path.join(outputDir, SNAPSHOT_DIR, task.id);
  await discardSnapshotDir(snapshotRoot);
}

/** Nuke the entire `.agentic-snapshot` tree. Call at session start. */
export async function purgeAllSnapshots(outputDir: string): Promise<void> {
  const root = path.join(outputDir, SNAPSHOT_DIR);
  await discardSnapshotDir(root);
}

// ─── helpers ─────────────────────────────────────────────────────────────

function collectPlanFiles(task: CodingTask): string[] {
  const files = task.files;
  if (!files) return [];
  if (Array.isArray(files)) {
    return files.filter(
      (f): f is string => typeof f === "string" && f.trim().length > 0,
    );
  }
  if (typeof files !== "object") return [];
  const record = files as unknown as Record<string, unknown>;
  const creates = Array.isArray(record.creates)
    ? (record.creates as unknown[]).filter(
        (f): f is string => typeof f === "string" && f.trim().length > 0,
      )
    : [];
  const modifies = Array.isArray(record.modifies)
    ? (record.modifies as unknown[]).filter(
        (f): f is string => typeof f === "string" && f.trim().length > 0,
      )
    : [];
  return [...new Set([...creates, ...modifies])];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeSnapshotMarker(
  snapshotRoot: string,
  rel: string,
): Promise<void> {
  const marker = path.join(snapshotRoot, rel + MARKER_SUFFIX);
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, "", "utf-8");
}

async function writeSnapshotSkipped(
  snapshotRoot: string,
  rel: string,
): Promise<void> {
  const skipped = path.join(snapshotRoot, rel + ".__skipped__");
  await fs.mkdir(path.dirname(skipped), { recursive: true });
  await fs.writeFile(skipped, "", "utf-8");
}

async function discardSnapshotDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
