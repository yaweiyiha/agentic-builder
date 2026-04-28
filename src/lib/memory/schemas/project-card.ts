import { z } from "zod";

/**
 * Project card body is markdown — the schema below describes the *frontmatter*
 * style metadata embedded in the markdown for programmatic readers. Kept as
 * documentation; `project-card` is registered with `format: "markdown"` and
 * not validated against this schema.
 */
export const ProjectCardBodySchema = z.object({
  tier: z.enum(["S", "M", "L"]).optional(),
  type: z.string().optional(),
  stack: z.array(z.string()).optional(),
  briefSummary: z.string().optional(),
  injectedPatternIds: z.array(z.string()).optional(),
});

export type ProjectCardBody = z.infer<typeof ProjectCardBodySchema>;
