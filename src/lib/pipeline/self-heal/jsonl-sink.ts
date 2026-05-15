import fs from "fs/promises";
import path from "path";
import type { RepairEmitter, RepairEvent } from "./events";

const DEFAULT_LOG_RELATIVE = ".ralph/repair-log.jsonl";
const DEFAULT_MAX_BYTES = 1_000_000; // 1 MB rotation threshold
const ROTATED_SUFFIX = ".1";

/**
 * Build a JSONL sink that appends one event per line to
 * `<outputDir>/.ralph/repair-log.jsonl`. Rotates to `.jsonl.1` when
 * the file exceeds ~1 MB (previous `.1` is overwritten).
 *
 * All I/O is async and silently absorbs failures so that telemetry
 * never blocks or crashes the pipeline.
 */
export function createJsonlRepairSink(
  outputDir: string,
  options: { relativePath?: string; maxBytes?: number } = {},
): RepairEmitter {
  const rel = options.relativePath ?? DEFAULT_LOG_RELATIVE;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const absolute = path.join(outputDir, rel);

  // Serialise appends so rotation can't interleave with writes.
  let chain: Promise<void> = Promise.resolve();

  return (event) => {
    const ev = event as RepairEvent;
    chain = chain.then(async () => {
      try {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await maybeRotate(absolute, maxBytes);
        await fs.appendFile(absolute, JSON.stringify(ev) + "\n", "utf-8");
      } catch (err) {
        console.warn(
          `[RepairEmitter] JSONL append failed (ignored):`,
          err instanceof Error ? err.message : err,
        );
      }
    });
  };
}

async function maybeRotate(absolute: string, maxBytes: number): Promise<void> {
  try {
    const stat = await fs.stat(absolute);
    if (stat.size < maxBytes) return;
    await fs.rename(absolute, absolute + ROTATED_SUFFIX).catch(async () => {
      // If rename failed (cross-device, etc), copy + truncate.
      const data = await fs.readFile(absolute);
      await fs.writeFile(absolute + ROTATED_SUFFIX, data);
      await fs.writeFile(absolute, "");
    });
  } catch {
    // File doesn't exist yet — nothing to rotate.
  }
}
