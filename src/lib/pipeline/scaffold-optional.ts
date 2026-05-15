/**
 * Conditional scaffold modules — see CODEGEN_HARDENING_PLAN.md §4.1 / §4.10.
 *
 * `copyScaffold()` lays down the base template for a tier (S/M/L). On top
 * of that, `copyOptionalScaffolds()` looks at the per-tier
 * `_optional/manifest.json` and conditionally copies feature directories
 * into the generated project, based on which `triggerEnvKeys` appear in
 * the user's `.blueprint/resource-requirements.json`.
 *
 * "Trigger" is presence of the declaration, NOT a non-empty value — the
 * detector agent declares the env key; the user fills the value later in
 * the UI; coding starts immediately so the worker sees the right scaffold.
 *
 * Files in `_optional/<feature>/<rest>` are copied to
 * `<outputDir>/<rest>` (the directory mirrors the final layout). Files
 * already present in the destination are OVERWRITTEN — optional features
 * are allowed to replace base wiring (e.g. `auth-privy` swaps `app.ts`
 * for a Privy-aware variant).
 *
 * `extraDeps` from the manifest are merged into the existing
 * `frontend/package.json` and `backend/package.json` `dependencies` map.
 * Existing entries are preserved (we never downgrade the user's choices).
 */

import fs from "fs/promises";
import path from "path";
import type { ResourceRequirement } from "./resource-requirements";
import type { ScaffoldTier } from "./scaffold-copy";

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  ".turbo",
  "coverage",
]);

const MANIFEST_REL = path.join("_optional", "manifest.json");
const MANIFEST_BASENAMES_TO_SKIP = new Set([
  "manifest.json",
  "manifest.schema.json",
  "README.md",
]);

export interface OptionalScaffoldFeature {
  /** Display label, surfaced in logs / reports. */
  label?: string;
  /**
   * If ANY of these env keys is declared on a `ResourceRequirement`, the
   * feature is applied. Comparison is case-insensitive and ignores `value`.
   */
  triggerEnvKeys: string[];
  /**
   * Map of npm package name → semver range. Patched into the matching
   * `<scope>/package.json` `dependencies` when the feature is applied.
   * Existing entries take precedence.
   */
  extraDeps?: {
    frontend?: Record<string, string>;
    backend?: Record<string, string>;
  };
}

export interface OptionalScaffoldManifest {
  version: number;
  description?: string;
  features: Record<string, OptionalScaffoldFeature>;
}

export interface CopyOptionalScaffoldsResult {
  /** Feature ids actually applied (passed all gates: triggered + files copied). */
  applied: string[];
  /** Feature ids that matched a trigger key but had no files / failed copy. */
  skipped: Array<{ feature: string; reason: string }>;
  /** All files written (relative to outputDir). */
  copiedFiles: string[];
  /**
   * Per-scope log of dependency keys appended. Useful when surfacing
   * "Privy was added" etc. in reports.
   */
  depsAppended: Array<{
    scope: "frontend" | "backend";
    feature: string;
    packages: string[];
  }>;
  /**
   * Whether a manifest was found at all. When false, the rest of the result
   * is empty — callers can skip user-facing logging.
   */
  manifestFound: boolean;
}

/**
 * Best-effort manifest loader. Returns null when missing/invalid so the
 * pipeline can keep running even if the optional layer is absent (back-compat
 * with tiers that never adopted the `_optional/` convention).
 */
export async function loadOptionalManifest(
  tier: ScaffoldTier,
): Promise<OptionalScaffoldManifest | null> {
  const tierDir = `${tier.toLowerCase()}-tier`;
  const manifestPath = path.resolve(
    process.cwd(),
    "scaffolds",
    tierDir,
    MANIFEST_REL,
  );
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const m = parsed as Partial<OptionalScaffoldManifest>;
    if (typeof m.version !== "number") return null;
    if (!m.features || typeof m.features !== "object") return null;
    // Defensive: make sure every feature has at least triggerEnvKeys.
    const features: Record<string, OptionalScaffoldFeature> = {};
    for (const [name, value] of Object.entries(
      m.features as Record<string, unknown>,
    )) {
      if (!value || typeof value !== "object") continue;
      const v = value as Partial<OptionalScaffoldFeature>;
      if (!Array.isArray(v.triggerEnvKeys) || v.triggerEnvKeys.length === 0) {
        continue;
      }
      features[name] = {
        label: typeof v.label === "string" ? v.label : undefined,
        triggerEnvKeys: v.triggerEnvKeys
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim().toUpperCase())
          .filter(Boolean),
        extraDeps: v.extraDeps,
      };
    }
    return { version: m.version, description: m.description, features };
  } catch {
    return null;
  }
}

function envKeysFromRequirements(reqs: ResourceRequirement[]): Set<string> {
  const out = new Set<string>();
  for (const r of reqs) {
    const k = (r.envKey ?? "").trim().toUpperCase();
    if (k) out.add(k);
  }
  return out;
}

function pickTriggeredFeatures(
  manifest: OptionalScaffoldManifest,
  declaredEnvKeys: Set<string>,
): Array<{ name: string; feature: OptionalScaffoldFeature }> {
  const out: Array<{ name: string; feature: OptionalScaffoldFeature }> = [];
  for (const [name, feature] of Object.entries(manifest.features)) {
    const hit = feature.triggerEnvKeys.some((k) => declaredEnvKeys.has(k));
    if (hit) out.push({ name, feature });
  }
  return out;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy `srcDir → destDir` recursively; returns the list of relative paths
 * written. Existing files are OVERWRITTEN (optional features may replace
 * base scaffold wiring). Symlinks/special files are skipped.
 */
async function copyDirOverwrite(
  srcDir: string,
  destDir: string,
  rootSrcDir: string,
  copied: string[],
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  let entries;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
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

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirOverwrite(srcPath, destPath, rootSrcDir, copied);
      continue;
    }
    if (!entry.isFile()) continue;

    await fs.copyFile(srcPath, destPath);
    copied.push(path.relative(rootSrcDir, srcPath).split(path.sep).join("/"));
  }
}

/**
 * Patch a `package.json` `dependencies` map. Existing entries are
 * preserved (we don't downgrade what's already there). Returns the
 * package names that were actually added (i.e. not already present).
 */
async function patchPackageJsonDeps(
  packageJsonAbs: string,
  deps: Record<string, string>,
): Promise<string[]> {
  if (!(await pathExists(packageJsonAbs))) return [];
  let raw: string;
  try {
    raw = await fs.readFile(packageJsonAbs, "utf-8");
  } catch {
    return [];
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  const existing =
    (pkg.dependencies as Record<string, string> | undefined) ?? {};
  const added: string[] = [];
  let mutated = false;
  for (const [name, range] of Object.entries(deps)) {
    if (existing[name]) continue;
    existing[name] = range;
    added.push(name);
    mutated = true;
  }
  if (!mutated) return [];
  pkg.dependencies = existing;
  // Preserve the user's original 2-space indent + trailing newline.
  await fs.writeFile(
    packageJsonAbs,
    JSON.stringify(pkg, null, 2) + "\n",
    "utf-8",
  );
  return added;
}

/**
 * Apply all triggered optional scaffolds for the given tier on top of
 * `outputDir`. Idempotent: re-running with the same input writes the same
 * files (overwrite is unconditional).
 */
export async function copyOptionalScaffolds(
  tier: ScaffoldTier,
  outputDir: string,
  reqs: ResourceRequirement[],
): Promise<CopyOptionalScaffoldsResult> {
  const empty: CopyOptionalScaffoldsResult = {
    applied: [],
    skipped: [],
    copiedFiles: [],
    depsAppended: [],
    manifestFound: false,
  };

  const manifest = await loadOptionalManifest(tier);
  if (!manifest) return empty;

  const declared = envKeysFromRequirements(reqs);
  const triggered = pickTriggeredFeatures(manifest, declared);
  if (triggered.length === 0) {
    return { ...empty, manifestFound: true };
  }

  const tierDir = `${tier.toLowerCase()}-tier`;
  const optionalRoot = path.resolve(
    process.cwd(),
    "scaffolds",
    tierDir,
    "_optional",
  );

  const applied: string[] = [];
  const skipped: Array<{ feature: string; reason: string }> = [];
  const copiedFiles: string[] = [];
  const depsAppended: CopyOptionalScaffoldsResult["depsAppended"] = [];

  for (const { name, feature } of triggered) {
    const featureDir = path.join(optionalRoot, name);
    if (!(await pathExists(featureDir))) {
      skipped.push({
        feature: name,
        reason: `manifest declared "${name}" but ${featureDir} does not exist`,
      });
      continue;
    }

    // ── 1. Copy files ──────────────────────────────────────────────────
    // Iterate immediate children: each top-level dir under <feature>
    // (e.g. backend/, frontend/) maps directly to outputDir's same name.
    let entries;
    try {
      entries = await fs.readdir(featureDir, { withFileTypes: true });
    } catch {
      skipped.push({ feature: name, reason: "readdir failed" });
      continue;
    }
    const beforeCount = copiedFiles.length;
    for (const entry of entries) {
      if (
        entry.isFile() &&
        MANIFEST_BASENAMES_TO_SKIP.has(entry.name.toLowerCase())
      ) {
        continue;
      }
      if (
        entry.isFile() &&
        (entry.name === "README.md" || entry.name === "package.json")
      ) {
        // Top-level READMEs / placeholder package.jsons inside _optional/
        // are documentation-only — don't surface them in the generated
        // project.
        continue;
      }
      if (entry.isDirectory()) {
        const childAbs = path.join(featureDir, entry.name);
        const destAbs = path.join(outputDir, entry.name);
        const featureCopied: string[] = [];
        await copyDirOverwrite(childAbs, destAbs, featureDir, featureCopied);
        copiedFiles.push(...featureCopied);
      }
    }
    const wroteAnything = copiedFiles.length > beforeCount;

    // ── 2. Patch deps ──────────────────────────────────────────────────
    const feDeps = feature.extraDeps?.frontend ?? {};
    const beDeps = feature.extraDeps?.backend ?? {};
    if (Object.keys(feDeps).length > 0) {
      const fePkg = path.join(outputDir, "frontend", "package.json");
      const added = await patchPackageJsonDeps(fePkg, feDeps);
      if (added.length > 0) {
        depsAppended.push({
          scope: "frontend",
          feature: name,
          packages: added,
        });
      }
    }
    if (Object.keys(beDeps).length > 0) {
      const bePkg = path.join(outputDir, "backend", "package.json");
      const added = await patchPackageJsonDeps(bePkg, beDeps);
      if (added.length > 0) {
        depsAppended.push({
          scope: "backend",
          feature: name,
          packages: added,
        });
      }
    }

    if (wroteAnything || depsAppended.some((d) => d.feature === name)) {
      applied.push(name);
    } else {
      skipped.push({
        feature: name,
        reason: "feature directory was empty and no deps to patch",
      });
    }
  }

  return {
    applied,
    skipped,
    copiedFiles,
    depsAppended,
    manifestFound: true,
  };
}
