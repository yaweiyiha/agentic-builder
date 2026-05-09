/**
 * After scaffold copy, replicate the TRD-confirmed shared schema into
 * every consumer root in the generated project so frontend and backend
 * workers can import a single source of truth for types crossing the
 * API boundary.
 *
 * The TRD step writes `.blueprint/shared-schema.ts` (see engine.ts /
 * persistTrdArtifacts). This module fans it out to per-tier locations
 * inside `outputDir`. Tier mapping:
 *
 *   S → src/shared/schema.ts            (single-app)
 *   M → frontend/src/shared/schema.ts   (split monolith)
 *       backend/src/shared/schema.ts
 *   L → packages/shared/src/schema.ts   (already a workspace package)
 *
 * Pure I/O helper: never throws on missing source (TRD may have been
 * skipped, or §6 may have been omitted). Caller decides what to do with
 * the `found: false` signal — typically: log it, fall back to per-worker
 * type definitions, surface in run metadata.
 *
 * The written paths should be appended to `scaffoldProtectedPaths` by
 * the caller so workers cannot overwrite the canonical schema mid-run.
 */

import fs from "fs/promises";
import path from "path";

export type SharedSchemaTier = "S" | "M" | "L";

const SCHEMA_BLUEPRINT_REL = ".blueprint/shared-schema.ts";

const TARGETS_BY_TIER: Readonly<Record<SharedSchemaTier, readonly string[]>> = {
  S: ["src/shared/schema.ts"],
  M: ["frontend/src/shared/schema.ts", "backend/src/shared/schema.ts"],
  L: ["packages/shared/src/schema.ts"],
};

export interface DistributeSharedSchemaResult {
  /** True when `.blueprint/shared-schema.ts` was present and read. */
  found: boolean;
  /** Relative paths written under outputDir. Empty when found=false. */
  written: string[];
  /** Absolute path of the source file consulted (for logging). */
  sourcePath: string;
}

export async function distributeSharedSchema(
  tier: SharedSchemaTier,
  outputDir: string,
  options?: { sourceDir?: string },
): Promise<DistributeSharedSchemaResult> {
  const sourceDir = options?.sourceDir ?? process.cwd();
  const sourcePath = path.resolve(sourceDir, SCHEMA_BLUEPRINT_REL);

  let content: string;
  try {
    content = await fs.readFile(sourcePath, "utf8");
  } catch {
    return { found: false, written: [], sourcePath };
  }

  if (!content.trim()) {
    // Treat empty-but-present as "no schema" — still no-op, no need to
    // write empty files into the project.
    return { found: false, written: [], sourcePath };
  }

  const targets = TARGETS_BY_TIER[tier];
  const written: string[] = [];
  for (const rel of targets) {
    const dest = path.join(outputDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, "utf8");
    written.push(rel);
  }
  return { found: true, written, sourcePath };
}

/**
 * Returns the list of relative paths the distributor *would* write for a
 * given tier, without performing any I/O. Useful for callers that want
 * to pre-allocate slots in scaffoldProtectedPaths even when the TRD
 * schema isn't available yet.
 */
export function plannedSharedSchemaPaths(tier: SharedSchemaTier): string[] {
  return [...TARGETS_BY_TIER[tier]];
}
