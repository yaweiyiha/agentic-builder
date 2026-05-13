/**
 * POST /api/memory/attribute/preparation
 *
 * Apply outcome attribution to L1 `prd-pattern` and `design-pattern`
 * records based on `prep-outcome` trace events captured by
 * /api/memory/{prd,design}/capture.
 *
 * Cursor lives at `<l1Root>/.memory/.preparation-attribution-cursor.json`
 * and stores `(sessionId::phase)` keys to prevent double-counting across
 * runs.
 */

import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getSystemMemory } from "@/lib/memory";
import {
  computePrepAttributions,
  DEFAULT_DELTA_APPROVAL,
  DEFAULT_DELTA_EDIT,
} from "@/lib/memory/distill/preparation-attribution";
import type { TraceEvent } from "@/lib/memory/trace";
import type { MemoryRecord } from "@/lib/memory/types";

export const maxDuration = 60;

interface AttributeRequestBody {
  /** L1 root override; defaults to process.cwd() (matches getSystemMemory). */
  l1Root?: string;
  resetCursor?: boolean;
  deltaApproval?: number;
  deltaEdit?: number;
  dryRun?: boolean;
}

interface AttributeResponseBody {
  ok: true;
  l1Root: string;
  dryRun: boolean;
  applied: number;
  attributions: Array<{
    patternId: string;
    oldScore: number;
    newScore: number;
    delta: number;
    approvals: number;
    edits: number;
    immune: boolean;
    source: string;
    phase: string;
  }>;
  stats: {
    outcomeEventsConsidered: number;
    outcomeEventsSkippedAlreadyAttributed: number;
    outcomeEventsSkippedNoInjection: number;
    injectEventsConsidered: number;
    patternsTouched: number;
    newlyAttributedPairs: number;
  };
}

const CURSOR_FILENAME = ".preparation-attribution-cursor.json";

async function readTraceEvents(l1Root: string): Promise<TraceEvent[]> {
  const p = path.join(l1Root, ".memory", "trace.jsonl");
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

async function readCursor(l1Root: string): Promise<Set<string>> {
  const p = path.join(l1Root, ".memory", CURSOR_FILENAME);
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw) as { attributed?: string[] };
    return new Set(parsed.attributed ?? []);
  } catch {
    return new Set();
  }
}

async function writeCursor(l1Root: string, keys: Set<string>): Promise<void> {
  const dir = path.join(l1Root, ".memory");
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, CURSOR_FILENAME);
  await fs.writeFile(
    p,
    JSON.stringify({ attributed: Array.from(keys).sort() }, null, 2),
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

  const l1Root = path.resolve(
    typeof body.l1Root === "string" && body.l1Root.trim()
      ? body.l1Root
      : process.cwd(),
  );
  const deltaApproval =
    typeof body.deltaApproval === "number" ? body.deltaApproval : DEFAULT_DELTA_APPROVAL;
  const deltaEdit =
    typeof body.deltaEdit === "number" ? body.deltaEdit : DEFAULT_DELTA_EDIT;
  const dryRun = body.dryRun === true;

  try {
    const traceEvents = await readTraceEvents(l1Root);
    const sysMem = getSystemMemory();
    const prdRecords = await sysMem.list({ kind: "prd-pattern", limit: 1_000_000 });
    const designRecords = await sysMem.list({ kind: "design-pattern", limit: 1_000_000 });
    const patternsById = new Map<string, MemoryRecord>(
      [...prdRecords, ...designRecords].map((r) => [r.id, r] as const),
    );
    const cursor = body.resetCursor
      ? new Set<string>()
      : await readCursor(l1Root);

    const result = computePrepAttributions({
      traceEvents,
      patternsById,
      alreadyAttributed: cursor,
      deltaApproval,
      deltaEdit,
    });

    let applied = 0;
    if (!dryRun) {
      for (const a of result.attributions) {
        if (a.immune || a.delta === 0) continue;
        try {
          await sysMem.update(a.patternId, { metrics: { score: a.newScore } });
          applied++;
        } catch {
          /* swallow individual failures */
        }
      }
      const merged = new Set(cursor);
      for (const k of result.newlyAttributed) merged.add(k);
      await writeCursor(l1Root, merged);
    }

    const payload: AttributeResponseBody = {
      ok: true,
      l1Root,
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
