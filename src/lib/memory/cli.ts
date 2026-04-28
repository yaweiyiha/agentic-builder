/**
 * Memory CLI commands. Invoked from scripts/memory-cli.ts.
 *
 * Argument parsing: hand-rolled `--flag=value` / `--flag value` parser to
 * keep zero CLI deps (design doc decision: parser ≈ 100 LoC).
 */

import fs from "node:fs/promises";
import path from "node:path";

import { getProjectMemory, getSystemMemory } from "./index";
import type {
  MemoryKind,
  MemoryLayer,
  MemoryRecord,
  MemoryStore,
  RecallQuery,
} from "./types";

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function pickStore(flags: ParsedArgs["flags"]): MemoryStore {
  const projectRoot = typeof flags.project === "string" ? flags.project : null;
  if (projectRoot) return getProjectMemory(projectRoot);
  const layer = (flags.layer as string | undefined)?.toUpperCase();
  if (layer === "L2") {
    throw new Error("--layer=L2 requires --project=<path>");
  }
  return getSystemMemory();
}

function parseTagFilter(input: unknown): RecallQuery["tags"] {
  if (typeof input !== "string" || !input.trim()) return undefined;
  const tags = input.split(",").map((s) => s.trim()).filter(Boolean);
  return { all: tags };
}

function parseKinds(input: unknown): MemoryKind[] | undefined {
  if (typeof input !== "string" || !input.trim()) return undefined;
  return input.split(",").map((s) => s.trim()) as MemoryKind[];
}

function parseLayer(input: unknown): MemoryLayer | "both" | undefined {
  if (typeof input !== "string") return undefined;
  const v = input.toUpperCase();
  if (v === "L1" || v === "L2") return v;
  if (v.toLowerCase() === "both") return "both";
  return undefined;
}

// ---------- commands ----------

export async function cmdList(args: ParsedArgs): Promise<void> {
  const store = pickStore(args.flags);
  const limit = numFlag(args.flags.limit, 20);
  const kind = (args.flags.kind as MemoryKind) || undefined;
  const rows = await store.list({ limit, kind });
  printTable(rows);
}

export async function cmdShow(args: ParsedArgs): Promise<void> {
  const id = args.positional[1];
  if (!id) {
    fail("usage: memory show <id> [--project=<path>]");
  }
  const store = pickStore(args.flags);
  const r = await store.get(id);
  if (!r) {
    console.error(`not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(r, null, 2));
}

export async function cmdSearch(args: ParsedArgs): Promise<void> {
  const text = args.positional[1];
  if (!text) fail("usage: memory search <keyword>");
  const store = pickStore(args.flags);
  const limit = numFlag(args.flags.limit, 10);
  const rows = await store.recall({ text, limit, layer: parseLayer(args.flags.layer) });
  printTable(rows);
}

export async function cmdRecall(args: ParsedArgs): Promise<void> {
  const store = pickStore(args.flags);
  const query: RecallQuery = {
    layer: parseLayer(args.flags.layer),
    kinds: parseKinds(args.flags.kinds),
    tags: parseTagFilter(args.flags.tags),
    text: typeof args.flags.text === "string" ? args.flags.text : undefined,
    limit: numFlag(args.flags.limit, 10),
  };
  const rows = await store.recall(query);
  printTable(rows);
}

export async function cmdStats(args: ParsedArgs): Promise<void> {
  const store = pickStore(args.flags);
  const all = await store.list({ limit: 1_000_000 });
  const byKind: Record<string, number> = {};
  let totalHits = 0;
  for (const r of all) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    totalHits += r.metrics.hits ?? 0;
  }
  console.log(`total: ${all.length}`);
  console.log(`hits (sum): ${totalHits}`);
  console.log("by kind:");
  for (const [k, n] of Object.entries(byKind).sort()) {
    console.log(`  ${k}: ${n}`);
  }
  if (all.length) {
    const last = all[0]!;
    console.log(`most recent: ${last.id} (${new Date(last.updatedAt).toISOString()})`);
  }
}

export async function cmdApprove(args: ParsedArgs): Promise<void> {
  const id = args.positional[1];
  if (!id) {
    fail(
      "usage: memory approve <id> [--score=0.5] [--project=<path>]\n" +
        "  Adds the `manual:approved` tag and bumps score so the pattern\n" +
        "  enters Layer 2 (active injection). See design doc §12.7.",
    );
  }
  const score = numFlag(args.flags.score, 0.5);
  if (score < -1 || score > 1) {
    fail(`--score must be in [-1, 1]; got ${score}`);
  }
  const store = pickStore(args.flags);
  const r = await store.get(id);
  if (!r) {
    console.error(`not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  const tags = r.tags.includes("manual:approved")
    ? r.tags
    : [...r.tags, "manual:approved"];
  await store.update(id, { tags, metrics: { score } });
  console.log(`approved ${id}`);
  console.log(`  title: ${r.title}`);
  console.log(`  score: ${score}`);
  console.log(`  tags:  ${tags.join(", ")}`);
}

export async function cmdDisapprove(args: ParsedArgs): Promise<void> {
  const id = args.positional[1];
  if (!id) {
    fail(
      "usage: memory disapprove <id> [--score=0] [--project=<path>]\n" +
        "  Removes the `manual:approved` tag and resets score to 0\n" +
        "  (back to Layer 3 shadow).",
    );
  }
  const score = numFlag(args.flags.score, 0);
  const store = pickStore(args.flags);
  const r = await store.get(id);
  if (!r) {
    console.error(`not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  const tags = r.tags.filter((t) => t !== "manual:approved");
  await store.update(id, { tags, metrics: { score } });
  console.log(`disapproved ${id}  (score=${score}, tag removed)`);
}

export async function cmdInvalidateClassification(
  args: ParsedArgs,
): Promise<void> {
  const store = pickStore(args.flags);
  const all = await store.list({ kind: "classification", limit: 1_000_000 });

  const idFlag = typeof args.flags.id === "string" ? args.flags.id : null;
  const briefHash =
    typeof args.flags["brief-hash"] === "string"
      ? (args.flags["brief-hash"] as string)
      : null;
  const promptVersion =
    typeof args.flags["prompt-version"] === "string"
      ? (args.flags["prompt-version"] as string)
      : null;
  const all_ = args.flags.all === true;
  const dryRun = args.flags["dry-run"] === true;

  let targets: typeof all = [];
  if (idFlag) {
    targets = all.filter((r) => r.id === idFlag);
  } else if (briefHash) {
    targets = all.filter((r) => r.id === `CL-${briefHash}` || r.id === briefHash);
  } else if (promptVersion) {
    targets = all.filter((r) =>
      r.tags.includes(`promptVersion:${promptVersion}`),
    );
  } else if (all_) {
    targets = all;
  } else {
    fail(
      "usage: memory invalidate-classification [--id=<id> | --brief-hash=<hex> | --prompt-version=<ver> | --all] [--dry-run]",
    );
  }

  if (targets.length === 0) {
    console.log("(no matching classification cache entries)");
    return;
  }

  console.log(
    `${dryRun ? "[dry-run] would delete" : "deleting"} ${targets.length} entr${targets.length === 1 ? "y" : "ies"}:`,
  );
  for (const r of targets) {
    console.log(`  ${r.id}  ${r.title}`);
    if (!dryRun) await store.delete(r.id);
  }
}

export async function cmdTrace(args: ParsedArgs): Promise<void> {
  const kickoffId = args.positional[1];
  const projectRoot = typeof args.flags.project === "string"
    ? path.resolve(args.flags.project)
    : process.cwd();
  const tracePath = path.join(projectRoot, ".memory", "trace.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(tracePath, "utf8");
  } catch {
    console.error(`no trace file at ${tracePath}`);
    process.exitCode = 1;
    return;
  }
  const lines = raw.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (kickoffId && ev.kickoffId !== kickoffId) continue;
      console.log(JSON.stringify(ev));
    } catch {
      /* skip corrupted line */
    }
  }
}

// ---------- entry ----------

const COMMANDS: Record<string, (args: ParsedArgs) => Promise<void>> = {
  list: cmdList,
  show: cmdShow,
  search: cmdSearch,
  recall: cmdRecall,
  stats: cmdStats,
  trace: cmdTrace,
  approve: cmdApprove,
  disapprove: cmdDisapprove,
  "invalidate-classification": cmdInvalidateClassification,
};

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cmd = args.positional[0];
  if (!cmd || !COMMANDS[cmd]) {
    console.error(
      "usage: memory <list|show|search|recall|stats|trace|approve|disapprove|invalidate-classification> [args]",
    );
    console.error("  --project=<path>   target an L2 store (else L1)");
    console.error("  --layer=L1|L2|both filter by layer (recall/search)");
    console.error("  --kinds=a,b        filter kinds (comma-separated)");
    console.error("  --tags=a,b         require all listed tags");
    console.error("  --text=...         keyword search");
    console.error("  --limit=N          cap results");
    process.exitCode = 1;
    return;
  }
  await COMMANDS[cmd]!(args);
}

// ---------- helpers ----------

function numFlag(v: unknown, dflt: number): number {
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  }
  return dflt;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function printTable(rows: MemoryRecord[]): void {
  if (rows.length === 0) {
    console.log("(no records)");
    return;
  }
  for (const r of rows) {
    const hits = r.metrics.hits ?? 0;
    const score = r.metrics.score ?? 0;
    const age = humanAge(Date.now() - r.updatedAt);
    const tags = r.tags.slice(0, 4).join(",");
    console.log(
      `${r.id}  [${r.layer}/${r.kind}]  hits=${hits} score=${score.toFixed(2)} age=${age}  ${r.title}` +
        (tags ? `  #${tags}` : ""),
    );
  }
}

function humanAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
