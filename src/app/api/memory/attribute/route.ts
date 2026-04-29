import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import {
  computeAttributions,
  DEFAULT_DELTA_FAILURE,
  DEFAULT_DELTA_SUCCESS,
} from "@/lib/memory/distill/attribution";
import { getProjectMemory, getSystemMemory } from "@/lib/memory";
import type { TraceEvent } from "@/lib/memory/trace";
import type { MemoryRecord } from "@/lib/memory/types";

export const maxDuration = 60;

interface AttributeRequestBody {
  projectRoot?: string;
  resetCursor?: boolean;
  deltaSuccess?: number;
  deltaFailure?: number;
  dryRun?: boolean;
}

interface AttributePatternResult {
  patternId: string;
  oldScore: number;
  newScore: number;
  delta: number;
  successes: number;
  failures: number;
  immune: boolean;
}

interface AttributeResponseBody {
  ok: true;
  projectRoot: string;
  dryRun: boolean;
  applied: number;
  attributions: AttributePatternResult[];
  stats: {
    taskHistoryConsidered: number;
    taskHistorySkippedNotTerminal: number;
    taskHistorySkippedAlreadyAttributed: number;
    injectEventsConsidered: number;
    patternsTouched: number;
    newlyAttributedPairs: number;
  };
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
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as TraceEvent);
    } catch {
      /* skip */
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

async function writeCursor(projectRoot: string, pairs: Set<string>): Promise<void> {
  const dir = path.join(projectRoot, ".memory");
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, ".attribution-cursor.json");
  await fs.writeFile(
    p,
    JSON.stringify({ attributed: Array.from(pairs).sort() }, null, 2),
    "utf8",
  );
}

export async function POST(req: NextRequest) {
  let body: AttributeRequestBody = {};
  try {
    body = (await req.json().catch(() => ({}))) as AttributeRequestBody;
  } catch {
    body = {};
  }

  const projectRoot = path.resolve(
    typeof body.projectRoot === "string" && body.projectRoot.trim()
      ? body.projectRoot
      : "generated-code",
  );
  const deltaSuccess =
    typeof body.deltaSuccess === "number" ? body.deltaSuccess : DEFAULT_DELTA_SUCCESS;
  const deltaFailure =
    typeof body.deltaFailure === "number" ? body.deltaFailure : DEFAULT_DELTA_FAILURE;
  const dryRun = body.dryRun === true;

  try {
    const traceEvents = await readTraceEvents(projectRoot);
    const projectMem = getProjectMemory(projectRoot);
    const taskHistory = await projectMem.list({
      kind: "task-history",
      limit: 1_000_000,
    });
    const sysMem = getSystemMemory();
    const allPatterns = await sysMem.list({
      kind: "failure-pattern",
      limit: 1_000_000,
    });
    const patternsById = new Map<string, MemoryRecord>(
      allPatterns.map((r) => [r.id, r] as const),
    );
    const cursor = body.resetCursor ? new Set<string>() : await readCursor(projectRoot);

    const result = computeAttributions({
      traceEvents,
      taskHistory,
      patternsById,
      alreadyAttributed: cursor,
      deltaSuccess,
      deltaFailure,
    });

    let applied = 0;
    if (!dryRun) {
      for (const a of result.attributions) {
        if (a.immune || a.delta === 0) continue;
        try {
          await sysMem.update(a.patternId, { metrics: { score: a.newScore } });
          applied++;
        } catch {
          /* swallow individual failures, surface count via stats */
        }
      }
      const merged = new Set(cursor);
      for (const k of result.newlyAttributed) merged.add(k);
      await writeCursor(projectRoot, merged);
    }

    const payload: AttributeResponseBody = {
      ok: true,
      projectRoot,
      dryRun,
      applied,
      attributions: result.attributions,
      stats: {
        ...result.stats,
        newlyAttributedPairs: result.newlyAttributed.length,
      },
    };
    return Response.json(payload, { status: 200 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
