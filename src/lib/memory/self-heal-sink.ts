/**
 * Memory sink for the self-heal RepairEmitter chain.
 *
 * Subscribes to RepairEvents, classifies the outcome, and persists
 * meaningful events as L2 `self-heal-log` records.
 *
 * Filtering rules:
 *   - skip if MEMORY_ENABLED=false
 *   - skip pure-notification events (e.g. *_start) with no repair signal
 *     and no files
 *   - else classify outcome and record fire-and-forget (sink contract:
 *     never throw)
 */

import type {
  RepairEmitter,
  RepairEvent,
} from "@/lib/pipeline/self-heal/events";

import { memoryEnabled } from "./env";
import { recordSelfHealLog } from "./recorders";

export interface MemorySelfHealSinkOptions {
  outputDir: string;
  /**
   * Stable session id (the same one passed to wrapPipelineEventHandler as
   * kickoffIdOverride). Used to link self-heal records to project-card.
   * If absent, falls back to event.sessionId / event.runId.
   */
  kickoffSessionId?: string;
}

export function createMemorySelfHealSink(
  opts: MemorySelfHealSinkOptions,
): RepairEmitter {
  if (!memoryEnabled()) {
    return () => {};
  }
  return (event) => {
    try {
      const ev = event as RepairEvent;
      const decision = classify(ev);
      if (!decision) return;
      const kickoffId = opts.kickoffSessionId ?? ev.sessionId ?? ev.runId;
      if (!kickoffId) return;
      void recordSelfHealLog({
        outputDir: opts.outputDir,
        kickoffId,
        stage: ev.stage,
        event: ev.event,
        outcome: decision,
        attempt: ev.attempt,
        taskId: ev.taskId,
        missingIds: ev.missingIds,
        repairedIds: ev.repairedIds,
        stillMissing: ev.stillMissing,
        files: ev.files,
        details: ev.details,
        occurredAt: ev.timestamp,
      });
    } catch {
      // Sink contract: never throw into the emitter chain.
    }
  };
}

/**
 * Decide whether an event carries learning signal worth persisting,
 * and what outcome class it represents. Returns null to skip.
 */
function classify(
  ev: RepairEvent,
): "fixed" | "progress" | "gave_up" | "other" | null {
  const repairedCount = ev.repairedIds?.length ?? 0;
  const stillMissingCount = ev.stillMissing?.length ?? 0;
  const fileCount = ev.files?.length ?? 0;
  const eventName = (ev.event || "").toLowerCase();

  // Skip pure-notification *_start events with no concrete signal.
  const isStart = /(^|_)start$/.test(eventName);
  if (isStart && repairedCount === 0 && fileCount === 0) return null;

  if (repairedCount > 0 && stillMissingCount === 0) return "fixed";
  if (repairedCount > 0 && stillMissingCount > 0) return "progress";

  const isFinal =
    /(final|exhausted|gave?_?up|abandon)/.test(eventName) ||
    eventName === "repair_final_state";
  if (isFinal && stillMissingCount > 0) return "gave_up";

  // Has a concrete file change or fix details — worth recording even if
  // it doesn't fit the missing-id model.
  if (fileCount > 0 || (ev.details && Object.keys(ev.details).length > 0)) {
    return "other";
  }

  return null;
}
