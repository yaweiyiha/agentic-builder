/**
 * Memory trace logging.
 *
 * Dual-track (design doc §10.1):
 *   - Local jsonl at .memory/trace.jsonl — full structured events for the
 *     `memory:trace <kickoffId>` CLI command.
 *   - console.log of a one-line summary (langfuse integration is left for
 *     a follow-up; we don't want to spam Langfuse with N events per kickoff
 *     until we know the volume).
 *
 * All trace writes are best-effort: failures are swallowed so observability
 * never breaks the primary code path.
 */

import fs from "node:fs/promises";
import path from "node:path";

export type TraceOp =
  | "save"
  | "update"
  | "recall"
  | "delete"
  | "bumpHit"
  | "cache-hit"
  | "cache-miss"
  | "inject"
  /** Second-pass recall fired mid-task in response to a fresh error signal. */
  | "reinject"
  /** Worker-emitted citation: which injected patterns the model claimed
   *  to actually use. Drives fine-grained attribution. */
  | "cite"
  /**
   * Human verdict on a preparation-phase artifact (PRD or Design). Emitted
   * by the capture endpoints with details =
   *   { phase: "prd" | "design", source: "human_approval" | "human_edit",
   *     newRecordId: string, projectType, tier }
   * Drives PRD/Design attribution: when a session ends in human_approval the
   * patterns injected into that session's prep agent get +score; on
   * human_edit they get -score.
   */
  | "prep-outcome";

export interface TraceEvent {
  ts: number;
  op: TraceOp;
  layer: "L1" | "L2";
  kickoffId?: string;
  taskId?: string;
  agent?: string;
  /** Operation-specific details (record ids, query, latency, token count). */
  details?: Record<string, unknown>;
}

export interface TraceLogger {
  log(event: Omit<TraceEvent, "ts">): Promise<void>;
}

export class FileTraceLogger implements TraceLogger {
  constructor(private readonly memoryDir: string) {}

  async log(event: Omit<TraceEvent, "ts">): Promise<void> {
    const full: TraceEvent = { ts: Date.now(), ...event };
    const line = JSON.stringify(full);
    const consoleLine = formatConsole(full);
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      await fs.appendFile(path.join(this.memoryDir, "trace.jsonl"), line + "\n", "utf8");
    } catch {
      // Swallow: trace must never break primary flow.
    }
    if (process.env.MEMORY_TRACE_VERBOSE === "true") {
      console.log(consoleLine);
    }
  }
}

export class NoopTraceLogger implements TraceLogger {
  async log(): Promise<void> {
    /* noop */
  }
}

function formatConsole(e: TraceEvent): string {
  const parts = [`[memory] op=${e.op} layer=${e.layer}`];
  if (e.kickoffId) parts.push(`kickoff=${e.kickoffId}`);
  if (e.taskId) parts.push(`task=${e.taskId}`);
  if (e.agent) parts.push(`agent=${e.agent}`);
  if (e.details) parts.push(JSON.stringify(e.details));
  return parts.join(" ");
}

const TRACERS = new Map<string, TraceLogger>();

export function getTraceLogger(memoryRoot: string): TraceLogger {
  const dir = path.join(memoryRoot, ".memory");
  const cached = TRACERS.get(dir);
  if (cached) return cached;
  const t = new FileTraceLogger(dir);
  TRACERS.set(dir, t);
  return t;
}
