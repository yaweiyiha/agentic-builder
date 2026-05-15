import { z } from "zod";

export const ClassificationBodySchema = z.object({
  tier: z.enum(["S", "M", "L"]),
  type: z.string(),
  needsBackend: z.boolean(),
  needsDatabase: z.boolean(),
  needsAuth: z.boolean(),
  needsMultipleServices: z.boolean(),
  reasoning: z.string(),
  briefHash: z.string(),
  modelUsed: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
});

export type ClassificationBody = z.infer<typeof ClassificationBodySchema>;
