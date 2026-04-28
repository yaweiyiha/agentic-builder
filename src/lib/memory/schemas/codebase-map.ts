import { z } from "zod";

/** Markdown body; this schema documents the structure (not enforced). */
export const CodebaseMapBodySchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string(),
        purpose: z.string(),
        lastTouchedTaskId: z.string().optional(),
      }),
    )
    .optional(),
});

export type CodebaseMapBody = z.infer<typeof CodebaseMapBodySchema>;
