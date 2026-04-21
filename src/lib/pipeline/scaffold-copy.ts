import fs from "fs/promises";
import path from "path";

export type ScaffoldTier = "S" | "M" | "L";

/** Never copy dependency trees or VCS — pnpm workspace symlinks break fs.copyFile (ENOTSUP). */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  ".turbo",
  "coverage",
]);

/**
 * Some scaffold files should stay editable during coding runs (not protected).
 * These are app entry wiring points that workers must be able to rewrite.
 */
const UNPROTECTED_SCAFFOLD_PATHS = new Set([
  // Frontend app wiring and shared client/context entry points
  "frontend/src/main.tsx",
  "frontend/src/router.tsx",
  "frontend/src/api/client.ts",
  "frontend/src/providers/AppProviders.tsx",
  "frontend/src/context/AuthContext.tsx",
  "frontend/src/views/NotFound.tsx",
  "frontend/src/index.css",
  "frontend/src/App.css",
  // Backend app wiring, module registration, and runtime entry points
  "backend/src/app.ts",
  "backend/src/server.ts",
  "backend/src/api/modules/index.ts",
  "backend/src/db.ts",
  "backend/src/config/env.ts",
  "backend/src/models/index.ts",
  "backend/src/middlewares/errorHandler.ts",
  "backend/src/middlewares/cors.ts",
  // E2E files — agents write generated test specs here; scaffold only ships a baseline
  "frontend/e2e/smoke.spec.ts",
  "frontend/playwright.config.ts",
]);

/**
 * Copy the scaffold template for the given tier into outputDir.
 * By default, existing files are not overwritten.
 * Pass { forceOverwrite: true } to always write scaffold files (safe for fresh coding sessions).
 */
export async function copyScaffold(
  tier: ScaffoldTier,
  outputDir: string,
  options?: { forceOverwrite?: boolean },
): Promise<{ copied: string[]; skipped: string[] }> {
  const forceOverwrite = options?.forceOverwrite ?? false;
  const tierDir = tier.toLowerCase() + "-tier";
  const scaffoldRoot = path.resolve(process.cwd(), "scaffolds", tierDir);

  try {
    await fs.access(scaffoldRoot);
  } catch {
    console.warn(
      `[Scaffold] No scaffold found for tier ${tier} at ${scaffoldRoot}, skipping.`,
    );
    return { copied: [], skipped: [] };
  }

  const copied: string[] = [];
  const skipped: string[] = [];

  await copyDir(
    scaffoldRoot,
    outputDir,
    scaffoldRoot,
    copied,
    skipped,
    forceOverwrite,
  );

  console.log(
    `[Scaffold] Tier ${tier}: copied ${copied.length} file(s), skipped ${skipped.length} existing file(s).`,
  );

  return { copied, skipped };
}

/**
 * All template file paths for a tier (same walk rules as copy, no disk writes).
 * Used to merge LLM output with scaffold instead of overwriting.
 */
export async function listScaffoldTemplateRelativePaths(
  tier: ScaffoldTier,
): Promise<string[]> {
  const tierDir = tier.toLowerCase() + "-tier";
  const scaffoldRoot = path.resolve(process.cwd(), "scaffolds", tierDir);
  const paths: string[] = [];

  async function walk(srcDir: string, rootDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(srcDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const relPath = path.relative(rootDir, srcPath);

      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      if (
        entry.isBlockDevice?.() ||
        entry.isCharacterDevice?.() ||
        entry.isFIFO?.() ||
        entry.isSocket?.()
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(srcPath, rootDir);
      } else if (entry.isFile()) {
        const normalizedRel = relPath.split(path.sep).join("/");
        if (UNPROTECTED_SCAFFOLD_PATHS.has(normalizedRel)) {
          continue;
        }
        paths.push(normalizedRel);
      }
    }
  }

  try {
    await fs.access(scaffoldRoot);
  } catch {
    return [];
  }

  await walk(scaffoldRoot, scaffoldRoot);
  paths.sort();
  return paths;
}

async function copyDir(
  srcDir: string,
  destDir: string,
  rootSrcDir: string,
  copied: string[],
  skipped: string[],
  forceOverwrite: boolean,
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const relPath = path.relative(rootSrcDir, srcPath);

    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      skipped.push(`${relPath} (symlink)`);
      continue;
    }

    if (
      entry.isBlockDevice?.() ||
      entry.isCharacterDevice?.() ||
      entry.isFIFO?.() ||
      entry.isSocket?.()
    ) {
      skipped.push(`${relPath} (special file)`);
      continue;
    }

    if (entry.isDirectory()) {
      await copyDir(
        srcPath,
        destPath,
        rootSrcDir,
        copied,
        skipped,
        forceOverwrite,
      );
      continue;
    }

    if (!entry.isFile()) {
      skipped.push(`${relPath} (not a regular file)`);
      continue;
    }

    if (forceOverwrite) {
      await fs.copyFile(srcPath, destPath);
      copied.push(relPath);
    } else {
      try {
        await fs.access(destPath);
        skipped.push(relPath);
      } catch {
        await fs.copyFile(srcPath, destPath);
        copied.push(relPath);
      }
    }
  }
}
