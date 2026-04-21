/**
 * Post-generation feature-checklist audit.
 *
 * The existing pipeline-level gates only check that *tasks declare* coverage
 * of PRD requirement IDs (`coversRequirementIds`) and that the project
 * compiles / builds. Neither of these proves that the actual generated code
 * implements the feature. This module closes that loop.
 *
 * The audit runs in three layers. Only L1 and L2 are implemented in this
 * first pass — they are cheap enough to always run and catch the most
 * common "declared but not implemented" class of failures. L3 (LLM judge)
 * is scoped in the types for future work.
 *
 *   L1 — Structural evidence:
 *     Every requirement ID that at least one task claims to cover must have
 *     that task produce ≥ 1 generated file. If a task covered FR-AUTH-01
 *     but failed (or produced zero files), FR-AUTH-01 is flagged.
 *
 *   L2 — Anchor evidence:
 *     Scan the generated source tree for textual anchors of the requirement
 *     ID (e.g. `// AC-003`, `FR-DASH-12`, a PAGE-* / CMP-* mention, or the
 *     kebab/camel form of a PrdSpec page/component name). A hit is strong
 *     evidence that the developer addressed the id. No hit is a soft
 *     signal — L3 would disambiguate; for now we mark it as `partial`.
 *
 *   L3 — Judge agent:
 *     (Future) Run a cheap LLM that reads the relevant files and renders a
 *     verdict: implemented | partial | missing, with file:line evidence.
 */

import fs from "fs/promises";
import path from "path";
import type {
  PrdRequirementIndex,
  PrdSpec,
} from "@/lib/requirements/prd-spec-types";
import type { KickoffWorkItem } from "@/lib/pipeline/types";
import type { RepairEmitter } from "./events";

export interface AuditTaskSummary {
  id: string;
  title: string;
  coversRequirementIds: string[];
  /** Files actually produced by the task (from TaskResult.generatedFiles). */
  generatedFiles: string[];
  status: "completed" | "completed_with_warnings" | "failed" | "unknown";
}

export type AuditVerdict = "implemented" | "partial" | "missing";

export interface AuditEntry {
  id: string;
  verdict: AuditVerdict;
  /** Which layer reached this verdict: l1 (structural) or l2 (anchor). */
  layer: "l1" | "l2";
  reason: string;
  /** Task ids that claimed to cover this id. */
  coveringTaskIds: string[];
  /** File:line-ish evidence strings for `implemented` verdicts. */
  evidence: string[];
}

export interface FeatureChecklistAuditInput {
  prdIndex: PrdRequirementIndex;
  prdSpec?: PrdSpec | null;
  tasks: KickoffWorkItem[];
  taskResults: AuditTaskSummary[];
  outputDir: string;
  sessionId?: string;
  emitter: RepairEmitter;
}

export interface FeatureChecklistAuditResult {
  passed: boolean;
  /** Every id checked, with its verdict. */
  entries: AuditEntry[];
  /** Subset of `entries` that did NOT reach `implemented`. */
  uncovered: AuditEntry[];
}

/**
 * Run the audit and emit structured events for every uncovered requirement.
 * Also writes a human-readable report to `<outputDir>/.ralph/uncovered.md`.
 */
export async function runFeatureChecklistAudit(
  input: FeatureChecklistAuditInput,
): Promise<FeatureChecklistAuditResult> {
  const { prdIndex, prdSpec, tasks, taskResults, outputDir, emitter } = input;

  const allIds = collectTargetIds(prdIndex, prdSpec);
  if (allIds.length === 0) {
    emitter({
      stage: "post-gen-audit",
      event: "audit_skipped_no_ids",
      details: { reason: "No PRD ids extracted — nothing to audit." },
    });
    return { passed: true, entries: [], uncovered: [] };
  }

  emitter({
    stage: "post-gen-audit",
    event: "audit_start",
    details: { totalIds: allIds.length },
  });

  const taskById = new Map(tasks.map((t) => [t.id, t] as const));
  const resultsById = new Map(
    taskResults.map((r) => [r.id, r] as const),
  );

  // Precompute: for every id, which tasks declared to cover it.
  const idToTaskIds = new Map<string, string[]>();
  for (const t of tasks) {
    const covered = t.coversRequirementIds ?? [];
    for (const raw of covered) {
      const id = String(raw).toUpperCase();
      if (!idToTaskIds.has(id)) idToTaskIds.set(id, []);
      idToTaskIds.get(id)!.push(t.id);
    }
  }

  // L1 — structural
  const entries: AuditEntry[] = [];
  const idsForL2: string[] = [];
  for (const id of allIds) {
    const taskIds = idToTaskIds.get(id) ?? [];
    if (taskIds.length === 0) {
      entries.push({
        id,
        verdict: "missing",
        layer: "l1",
        reason: "No task declared coversRequirementIds for this id.",
        coveringTaskIds: [],
        evidence: [],
      });
      continue;
    }
    const someTaskProducedFiles = taskIds.some((tid) => {
      const r = resultsById.get(tid);
      return (
        !!r &&
        r.status !== "failed" &&
        Array.isArray(r.generatedFiles) &&
        r.generatedFiles.length > 0
      );
    });
    if (!someTaskProducedFiles) {
      entries.push({
        id,
        verdict: "missing",
        layer: "l1",
        reason: `Tasks ${taskIds.join(", ")} declared coverage but produced no files.`,
        coveringTaskIds: taskIds,
        evidence: [],
      });
      continue;
    }
    // Structurally present — defer to L2 for stronger evidence.
    idsForL2.push(id);
  }

  // L2 — anchor scan
  const anchorsByFile = await buildAnchorIndex(
    outputDir,
    collectAnchorAliases(idsForL2, prdSpec, taskById),
  );

  for (const id of idsForL2) {
    const aliases = getAliasesForId(id, prdSpec, taskById);
    const taskIds = idToTaskIds.get(id) ?? [];
    const hits: string[] = [];
    for (const [file, text] of anchorsByFile) {
      for (const alias of aliases) {
        const lineNum = findAliasLine(text, alias);
        if (lineNum > 0) {
          hits.push(`${file}:${lineNum} (${alias})`);
          break;
        }
      }
      if (hits.length >= 5) break;
    }
    if (hits.length > 0) {
      entries.push({
        id,
        verdict: "implemented",
        layer: "l2",
        reason: `Found ${hits.length} anchor match(es) in generated code.`,
        coveringTaskIds: taskIds,
        evidence: hits,
      });
    } else {
      entries.push({
        id,
        verdict: "partial",
        layer: "l2",
        reason: `Structural coverage present (tasks produced files) but no textual anchor found for this id. Implementation may be implicit.`,
        coveringTaskIds: taskIds,
        evidence: [],
      });
    }
  }

  const uncovered = entries.filter((e) => e.verdict !== "implemented");

  emitter({
    stage: "post-gen-audit",
    event: uncovered.length > 0 ? "uncovered_detected" : "audit_clean",
    missingIds: uncovered.filter((e) => e.verdict === "missing").map((e) => e.id),
    stillMissing: uncovered.map((e) => e.id),
    details: {
      totalChecked: entries.length,
      implemented: entries.length - uncovered.length,
      partial: uncovered.filter((e) => e.verdict === "partial").length,
      missing: uncovered.filter((e) => e.verdict === "missing").length,
    },
  });

  await writeUncoveredReport(outputDir, entries).catch((err) => {
    console.warn(
      `[FeatureAudit] Failed to write uncovered.md (ignored):`,
      err instanceof Error ? err.message : err,
    );
  });

  return { passed: uncovered.length === 0, entries, uncovered };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function collectTargetIds(
  prdIndex: PrdRequirementIndex,
  prdSpec?: PrdSpec | null,
): string[] {
  const out = new Set<string>();
  for (const id of prdIndex.acceptanceCriteriaIds) out.add(id.toUpperCase());
  for (const id of prdIndex.featureIds) out.add(id.toUpperCase());
  for (const id of prdIndex.userStoryIds) out.add(id.toUpperCase());
  for (const id of prdIndex.componentIds) out.add(id.toUpperCase());
  if (prdSpec) {
    for (const p of prdSpec.pages ?? []) {
      if (p.id) out.add(p.id.toUpperCase());
      for (const c of p.interactiveComponents ?? []) {
        if (c.id) out.add(c.id.toUpperCase());
      }
    }
  }
  return [...out].sort();
}

function getAliasesForId(
  id: string,
  prdSpec: PrdSpec | null | undefined,
  _taskById: Map<string, KickoffWorkItem>,
): string[] {
  const aliases = new Set<string>();
  aliases.add(id);
  aliases.add(id.toLowerCase());

  if (prdSpec) {
    if (id.startsWith("PAGE-")) {
      const page = prdSpec.pages.find((p) => p.id.toUpperCase() === id);
      if (page) {
        if (page.name) {
          aliases.add(page.name);
          aliases.add(toPascalCase(page.name));
          aliases.add(toKebabCase(page.name));
        }
        if (page.route) aliases.add(page.route);
      }
    } else if (id.startsWith("CMP-")) {
      for (const page of prdSpec.pages) {
        const cmp = page.interactiveComponents.find(
          (c) => c.id.toUpperCase() === id,
        );
        if (cmp && cmp.name) {
          aliases.add(cmp.name);
          aliases.add(toPascalCase(cmp.name));
          aliases.add(toKebabCase(cmp.name));
          break;
        }
      }
    }
  }
  return [...aliases].filter((s) => s.length >= 3);
}

function collectAnchorAliases(
  ids: string[],
  prdSpec: PrdSpec | null | undefined,
  taskById: Map<string, KickoffWorkItem>,
): Set<string> {
  const all = new Set<string>();
  for (const id of ids) {
    for (const alias of getAliasesForId(id, prdSpec, taskById)) {
      all.add(alias);
    }
  }
  return all;
}

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".html",
  ".vue",
  ".svelte",
]);
const SCAN_EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".git",
  ".ralph",
  ".agentic-staging",
  "coverage",
]);
const MAX_FILES_TO_SCAN = 500;
const MAX_FILE_BYTES = 200_000;

async function buildAnchorIndex(
  outputDir: string,
  aliases: Set<string>,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  if (aliases.size === 0) return index;
  const files: string[] = [];
  await walkSourceTree(outputDir, "", files);
  for (const rel of files.slice(0, MAX_FILES_TO_SCAN)) {
    try {
      const stat = await fs.stat(path.join(outputDir, rel));
      if (stat.size > MAX_FILE_BYTES) continue;
      const text = await fs.readFile(path.join(outputDir, rel), "utf-8");
      // Quick filter: does the file mention ANY alias at all? If not, skip.
      if (!anyAliasPresent(text, aliases)) continue;
      index.set(rel, text);
    } catch {
      // ignore unreadable files
    }
  }
  return index;
}

async function walkSourceTree(
  root: string,
  rel: string,
  out: string[],
): Promise<void> {
  const abs = path.join(root, rel);
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SCAN_EXCLUDE_DIRS.has(entry.name)) continue;
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkSourceTree(root, next, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    out.push(next);
    if (out.length >= MAX_FILES_TO_SCAN * 2) return;
  }
}

function anyAliasPresent(text: string, aliases: Set<string>): boolean {
  for (const alias of aliases) {
    if (alias.length < 3) continue;
    if (text.includes(alias)) return true;
  }
  return false;
}

function findAliasLine(text: string, alias: string): number {
  const idx = text.indexOf(alias);
  if (idx < 0) return 0;
  let line = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function toPascalCase(s: string): string {
  return s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
}

function toKebabCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((seg) => seg.toLowerCase())
    .join("-");
}

async function writeUncoveredReport(
  outputDir: string,
  entries: AuditEntry[],
): Promise<void> {
  const uncovered = entries.filter((e) => e.verdict !== "implemented");
  const ralphDir = path.join(outputDir, ".ralph");
  await fs.mkdir(ralphDir, { recursive: true });
  const file = path.join(ralphDir, "uncovered.md");

  if (uncovered.length === 0) {
    await fs.writeFile(
      file,
      `# Feature Checklist Audit\n\nAll ${entries.length} PRD id(s) reached verdict \`implemented\`.\n`,
      "utf-8",
    );
    return;
  }

  const lines: string[] = [
    `# Feature Checklist Audit — uncovered requirements`,
    ``,
    `Checked ${entries.length} PRD id(s). **${uncovered.length} did not reach \`implemented\`**.`,
    ``,
    `| id | verdict | layer | covering tasks | reason |`,
    `| --- | --- | --- | --- | --- |`,
  ];
  for (const e of uncovered) {
    lines.push(
      `| \`${e.id}\` | ${e.verdict} | ${e.layer} | ${e.coveringTaskIds.join(", ") || "(none)"} | ${escapeTableCell(e.reason)} |`,
    );
  }
  lines.push(``, `## Notes`, ``);
  lines.push(
    `- \`missing\` (layer l1): no task declared coverage, or covering tasks produced no files.`,
  );
  lines.push(
    `- \`partial\` (layer l2): covering tasks produced files, but no textual anchor for the id was found in the generated source tree. Implementation may still be present but implicit.`,
  );
  lines.push(
    `- \`implemented\` (layer l2): at least one file contains an anchor matching the id (or its alias from the PRD Spec).`,
  );

  await fs.writeFile(file, lines.join("\n") + "\n", "utf-8");
}

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
