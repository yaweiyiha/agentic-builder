#!/usr/bin/env tsx
/**
 * Mine failure-pattern seeds from `.ralph/repair-log.jsonl`.
 *
 * Usage:
 *   npm run memory:mine-patterns -- [--input=<path>] [--min-cluster=2]
 *                                   [--score=0] [--dry-run] [--limit=N]
 *
 * Default --input points at the canonical generated-code repair log.
 * Default --score=0 puts mined patterns in Layer 3 (shadow); use
 * --score=0.3 to immediately promote them to Layer 2 (active), or
 * leave at 0 and approve individually via `memory:approve`.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { minePatternsFromRepairLog } from "../src/lib/memory/distill/repair-log-miner";
import { getSystemMemory } from "../src/lib/memory";
import type { RepairEvent } from "../src/lib/pipeline/self-heal/events";

interface Args {
  input: string;
  minCluster: number;
  score: number;
  limit: number | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: path.resolve(
      process.cwd(),
      "generated-code/.ralph/repair-log.jsonl",
    ),
    minCluster: 2,
    score: 0,
    limit: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--input="))
      args.input = path.resolve(a.slice("--input=".length));
    else if (a.startsWith("--min-cluster="))
      args.minCluster = Number(a.slice("--min-cluster=".length));
    else if (a.startsWith("--score="))
      args.score = Number(a.slice("--score=".length));
    else if (a.startsWith("--limit="))
      args.limit = Number(a.slice("--limit=".length));
  }
  return args;
}

async function readEvents(filePath: string): Promise<RepairEvent[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const events: RepairEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as RepairEvent);
    } catch {
      // skip corrupted line
    }
  }
  return events;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`reading: ${args.input}`);

  let events: RepairEvent[];
  try {
    events = await readEvents(args.input);
  } catch (err) {
    console.error(`failed to read input: ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`parsed ${events.length} events`);

  const patterns = minePatternsFromRepairLog(events, {
    minCluster: args.minCluster,
    limit: args.limit ?? undefined,
  });
  console.log(
    `mined ${patterns.length} patterns (min-cluster=${args.minCluster}${args.limit ? `, limit=${args.limit}` : ""})`,
  );

  if (args.dryRun) {
    for (const p of patterns) {
      console.log(
        `  [dry-run] ${p.id}  occ=${p.occurrences} sessions=${p.sessions} outcomes=${JSON.stringify(p.outcomes)}`,
      );
      console.log(`            ${p.title}`);
    }
    return;
  }

  const store = getSystemMemory();
  let written = 0;
  let skipped = 0;
  for (const p of patterns) {
    try {
      await store.save({
        id: p.id,
        layer: "L1",
        kind: "failure-pattern",
        title: p.title,
        body: p.body,
        tags: p.tags,
        source: "distill",
        refs: {},
        metrics: { score: args.score, hits: 0 },
      });
      written++;
      console.log(`  wrote ${p.id}  occ=${p.occurrences} score=${args.score}`);
    } catch (err) {
      skipped++;
      console.warn(`  skipped ${p.id}: ${(err as Error).message}`);
    }
  }
  console.log(`done. written=${written} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
