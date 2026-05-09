#!/usr/bin/env tsx
/**
 * Outcome attribution CLI — close the feedback loop on injected memory.
 *
 *   npm run memory:attribute -- [--project=<path>] [--dry-run]
 *                               [--reset-cursor]
 *                               [--delta-success=0.05]
 *                               [--delta-failure=-0.1]
 *
 * Reads `<project>/.memory/trace.jsonl` + task-history records, looks up
 * which L1 patterns were injected into each task, applies +δ on success
 * / -δ on failure to those patterns. `manual:approved` patterns are
 * immune (humans curate them).
 *
 * Idempotent via cursor file `<project>/.memory/.attribution-cursor.json`
 * which records (kickoffId, taskId) pairs already processed.
 */

import fs from "node:fs/promises";
import path from "node:path";

import {
  computeAttributions,
  DEFAULT_DELTA_SUCCESS,
  DEFAULT_DELTA_FAILURE,
} from "../src/lib/memory/distill/attribution";
import {
  getProjectMemory,
  getSystemMemory,
} from "../src/lib/memory";
import type { TraceEvent } from "../src/lib/memory/trace";
import type { MemoryRecord } from "../src/lib/memory/types";

interface Args {
  projectRoot: string;
  dryRun: boolean;
  resetCursor: boolean;
  deltaSuccess: number;
  deltaFailure: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    projectRoot: path.resolve(process.cwd(), "generated-code"),
    dryRun: false,
    resetCursor: false,
    deltaSuccess: DEFAULT_DELTA_SUCCESS,
    deltaFailure: DEFAULT_DELTA_FAILURE,
  };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--reset-cursor") args.resetCursor = true;
    else if (a.startsWith("--project="))
      args.projectRoot = path.resolve(a.slice("--project=".length));
    else if (a.startsWith("--delta-success="))
      args.deltaSuccess = Number(a.slice("--delta-success=".length));
    else if (a.startsWith("--delta-failure="))
      args.deltaFailure = Number(a.slice("--delta-failure=".length));
  }
  return args;
}

async function readTraceEvents(projectRoot: string): Promise<TraceEvent[]> {
  const p = path.join(projectRoot, ".memory", "trace.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: TraceEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as TraceEvent);
    } catch {
      /* skip corrupted line */
    }
  }
  return out;
}

async function readCursor(projectRoot: string): Promise<Set<string>> {
  const p = path.join(projectRoot, ".memory", ".attribution-cursor.json");
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as { attributed?: string[] };
    return new Set(parsed.attributed ?? []);
  } catch {
    return new Set();
  }
}

async function writeCursor(
  projectRoot: string,
  pairs: Set<string>,
): Promise<void> {
  const dir = path.join(projectRoot, ".memory");
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, ".attribution-cursor.json");
  const payload = { attributed: Array.from(pairs).sort() };
  await fs.writeFile(p, JSON.stringify(payload, null, 2), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`project: ${args.projectRoot}`);
  console.log(
    `deltas: success=+${args.deltaSuccess}, failure=${args.deltaFailure}` +
      (args.dryRun ? "  (dry-run)" : ""),
  );

  const traceEvents = await readTraceEvents(args.projectRoot);
  console.log(`trace events read: ${traceEvents.length}`);

  const projectMem = getProjectMemory(args.projectRoot);
  const taskHistory = await projectMem.list({ kind: "task-history", limit: 1_000_000 });
  console.log(`task-history records: ${taskHistory.length}`);

  const sysMem = getSystemMemory();
  const allPatterns = await sysMem.list({
    kind: "failure-pattern",
    limit: 1_000_000,
  });
  const patternsById = new Map<string, MemoryRecord>(
    allPatterns.map((r) => [r.id, r] as const),
  );

  const cursor = args.resetCursor
    ? new Set<string>()
    : await readCursor(args.projectRoot);

  const result = computeAttributions({
    traceEvents,
    taskHistory,
    patternsById,
    alreadyAttributed: cursor,
    deltaSuccess: args.deltaSuccess,
    deltaFailure: args.deltaFailure,
  });

  console.log("\n--- stats ---");
  for (const [k, v] of Object.entries(result.stats)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(
    `  newlyAttributedPairs: ${result.newlyAttributed.length}`,
  );

  if (result.attributions.length === 0) {
    console.log("\nno score changes to apply");
    return;
  }

  console.log(
    `\n--- ${args.dryRun ? "WOULD apply" : "applying"} ${result.attributions.length} score change(s) ---`,
  );
  for (const a of result.attributions) {
    const tag = a.immune ? " [immune: manual:approved]" : "";
    const arrow =
      a.delta > 0
        ? "↑"
        : a.delta < 0
          ? "↓"
          : "·";
    console.log(
      `  ${arrow} ${a.patternId}  ${a.oldScore.toFixed(2)} → ${a.newScore.toFixed(2)} ` +
        `(Δ=${a.delta >= 0 ? "+" : ""}${a.delta.toFixed(2)}, ` +
        `${a.successes} success / ${a.failures} fail)${tag}`,
    );
  }

  if (args.dryRun) return;

  let applied = 0;
  for (const a of result.attributions) {
    if (a.immune || a.delta === 0) continue;
    try {
      await sysMem.update(a.patternId, { metrics: { score: a.newScore } });
      applied++;
    } catch (err) {
      console.warn(`  failed to update ${a.patternId}: ${(err as Error).message}`);
    }
  }
  console.log(`\napplied ${applied} score updates`);

  // Persist cursor — even immune attributions count, since we processed them.
  const merged = new Set(cursor);
  for (const k of result.newlyAttributed) merged.add(k);
  await writeCursor(args.projectRoot, merged);
  console.log(`cursor updated: ${merged.size} attributed pairs total`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
