/**
 * RepairEvent — structured, cross-stage self-heal telemetry.
 *
 * All pipeline stages that perform detection + bounded self-repair
 * (truncation recovery, coverage-gate repair, architect triage,
 * feature audit, etc.) emit these events through a single `RepairEmitter`.
 * Sinks typically include:
 *   • SSE channel back to the browser (user-facing log)
 *   • `.ralph/repair-log.jsonl` (post-mortem analysis)
 *   • stdout (developer observability)
 */

export type RepairStage =
  | "prd-spec"
  | "worker-context"
  | "coverage-gate"
  | "phase-gate"
  | "task-breakdown"
  | "worker-codegen"
  | "worker-verify"
  | "task"
  | "architect-triage"
  | "post-gen-audit"
  | "integration-gate"
  | "e2e-triage"
  | "preflight-convention-fix"
  | "preflight-route-audit"
  | "preflight-deps"
  | "generate_api_contracts"
  | "preflight-contract-completeness";

export interface RepairEvent {
  timestamp: string;
  sessionId?: string;
  runId?: string;
  stage: RepairStage;
  /** Short machine-readable event name; see the event-name table in the plan. */
  event: string;
  /** 1-indexed attempt counter for self-heal loops. */
  attempt?: number;
  taskId?: string;
  /** PRD requirement ids that are currently missing / uncovered. */
  missingIds?: string[];
  /** Ids that the most recent repair step successfully fixed. */
  repairedIds?: string[];
  /** Ids still unresolved after the repair step. */
  stillMissing?: string[];
  /** Files touched by the event (creates / modifies / discards). */
  files?: string[];
  /** Free-form structured payload. Keep it JSON-serialisable. */
  details?: Record<string, unknown>;
}

export type RepairEmitter = (event: Omit<RepairEvent, "timestamp"> & { timestamp?: string }) => void;

/**
 * Merge multiple sinks into a single emitter. Sinks never throw;
 * they must swallow their own errors so telemetry never breaks the pipeline.
 */
export function createRepairEmitter(sinks: RepairEmitter[]): RepairEmitter {
  return (event) => {
    const withTs: RepairEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    for (const sink of sinks) {
      try {
        sink(withTs);
      } catch (err) {
        // Telemetry must never break the pipeline.
        console.warn(
          `[RepairEmitter] sink threw (ignored):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };
}

/** A no-op emitter. Useful for unit tests and for library code that wants a default. */
export const noopRepairEmitter: RepairEmitter = () => {};

// ─── Session-scoped emitter registry ──────────────────────────────────────
// LangGraph state is JSON-serialised between nodes, so we can't attach the
// emitter directly to state. Instead, the coding-API route registers an
// emitter for its `sessionId` at the start of the request, and any self-heal
// code (inside a node) can look it up by sessionId.

const _emitters = new Map<string, RepairEmitter>();

export function registerRepairEmitter(
  sessionId: string,
  emitter: RepairEmitter,
): void {
  _emitters.set(sessionId, emitter);
}

export function unregisterRepairEmitter(sessionId: string): void {
  _emitters.delete(sessionId);
}

/**
 * Look up the emitter for a session. Returns `noopRepairEmitter` if no
 * emitter is registered — callers should never have to guard.
 */
export function getRepairEmitter(sessionId?: string | null): RepairEmitter {
  if (!sessionId) return noopRepairEmitter;
  return _emitters.get(sessionId) ?? noopRepairEmitter;
}

/**
 * A stdout sink that prints a single compact line per event.
 * Always safe in server-side contexts.
 */
export const consoleRepairSink: RepairEmitter = (event) => {
  const ev = event as RepairEvent;
  const parts = [
    `[RepairEvent]`,
    `${ev.stage}/${ev.event}`,
    ev.attempt !== undefined ? `attempt=${ev.attempt}` : "",
    ev.taskId ? `task=${ev.taskId}` : "",
    ev.missingIds?.length ? `missing=${ev.missingIds.length}` : "",
    ev.stillMissing?.length ? `stillMissing=${ev.stillMissing.length}` : "",
    ev.files?.length ? `files=${ev.files.length}` : "",
  ].filter(Boolean);
  console.log(parts.join(" "));
};
