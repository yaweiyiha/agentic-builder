import { z } from "zod";

export const TaskHistoryBodySchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]),
  attempts: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative().optional(),
  files: z.array(z.string()).default([]),
  selfHealTriggered: z.boolean().optional(),
  selfHealLogId: z.string().optional(),
  errorMessage: z.string().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});

export type TaskHistoryBody = z.infer<typeof TaskHistoryBodySchema>;
