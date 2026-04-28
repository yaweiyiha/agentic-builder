import { z } from "zod";

/**
 * Body for `self-heal-log` records — one record per meaningful repair
 * episode (success, give-up, or partial progress) emitted by the
 * project's RepairEmitter. Pure-notification events without learning
 * signal (start events, raw counters) are not recorded.
 */
export const SelfHealLogBodySchema = z.object({
  /** Pipeline stage this repair belongs to. */
  stage: z.string(),
  /** Original event name from RepairEvent (free-form, source of truth). */
  event: z.string(),
  /**
   * Outcome classification:
   *   - "fixed": repairedIds non-empty AND stillMissing empty
   *   - "progress": both non-empty (made progress, more to do)
   *   - "gave_up": stillMissing non-empty after final attempt
   *   - "other": carried files / details but no repair-id signal
   */
  outcome: z.enum(["fixed", "progress", "gave_up", "other"]),
  attempt: z.number().int().nonnegative().optional(),
  taskId: z.string().optional(),
  missingIds: z.array(z.string()).optional(),
  repairedIds: z.array(z.string()).optional(),
  stillMissing: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  /** Free-form structured payload from the originating RepairEvent. */
  details: z.record(z.string(), z.unknown()).optional(),
  /** ISO 8601 timestamp from the source event. */
  occurredAt: z.string(),
});

export type SelfHealLogBody = z.infer<typeof SelfHealLogBodySchema>;
