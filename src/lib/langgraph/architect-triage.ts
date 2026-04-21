/**
 * Architect-phase task triage for prebuiltScaffold mode.
 *
 * When the coding API copies a tier scaffold, the architect phase historically
 * short-circuits: every architect task is marked "completed" with zero files
 * and no LLM call. This is safe only for tasks whose output *is* the scaffold
 * (Vite config, tsconfig, Docker, CI). It is unsafe for PRD-specific
 * architect work that happens to be tagged as `Data Layer` / `Infrastructure`
 * — e.g. a migration that creates a domain-specific DB table, a cron job, a
 * shared email service.
 *
 * This module decides, per task:
 *   • `noop`         — every file the task touches is inside the scaffold's
 *                      protected path set (the scaffold already provides it).
 *   • `must_run_llm` — at least one file is outside the scaffold, OR the
 *                      title/description mentions a domain-implementation
 *                      keyword (migration / seed / schema / cron / queue /
 *                      email / webhook / integration / etc.). Task must go
 *                      through the regular worker graph.
 *
 * The decision is conservative: when in doubt, prefer `must_run_llm`.
 */

import path from "path";
import type { CodingTask } from "@/lib/pipeline/types";

export type ArchitectTriageDecision = "noop" | "must_run_llm";

export interface ArchitectTriageResult {
  task: CodingTask;
  decision: ArchitectTriageDecision;
  reason: string;
  /** Files referenced by the task that are OUTSIDE scaffoldProtectedPaths. */
  outsideFiles: string[];
}

/**
 * Keywords in the task title/description that strongly suggest domain-specific
 * architect work rather than scaffold-only setup. Matched case-insensitively
 * against a concatenation of `title + description + phase`.
 */
const DOMAIN_IMPLEMENTATION_KEYWORDS: ReadonlyArray<RegExp> = [
  /\bmigrat/i, // migration, migrations, migrating
  /\bseed(s|ing|er)?\b/i,
  /\bschema\b/i,
  /\bentity|entities\b/i,
  /\brelation(s|ship|ships)?\b/i,
  /\bcron\b/i,
  /\bschedul(er|ed)\b/i,
  /\bqueue\b/i,
  /\bworker pool\b/i,
  /\bemail (service|template|sender)\b/i,
  /\bmailer\b/i,
  /\bsms\b/i,
  /\bwebhook\b/i,
  /\bintegration\b/i,
  /\bs3 bucket\b/i,
  /\bstorage (service|bucket)\b/i,
  /\bstripe|payment\b/i,
  /\banalytics|telemetry\b/i,
  /\bfeature flag\b/i,
];

export function triagePrebuiltArchitectTasks(
  tasks: CodingTask[],
  scaffoldProtectedPaths: string[],
): ArchitectTriageResult[] {
  const protectedSet = buildProtectedSet(scaffoldProtectedPaths);
  return tasks.map((task) => triageSingle(task, protectedSet));
}

function buildProtectedSet(paths: string[]): Set<string> {
  const normalized = new Set<string>();
  for (const p of paths) {
    if (typeof p !== "string") continue;
    const trimmed = normalisePath(p);
    if (trimmed.length > 0) normalized.add(trimmed);
  }
  return normalized;
}

function triageSingle(
  task: CodingTask,
  protectedSet: Set<string>,
): ArchitectTriageResult {
  const files = normalizeTaskFileHints(task.files);
  const outsideFiles: string[] = [];

  for (const raw of files) {
    const rel = normalisePath(raw);
    if (rel.length === 0) continue;
    if (!isInsideProtectedSet(rel, protectedSet)) {
      outsideFiles.push(raw);
    }
  }

  if (outsideFiles.length > 0) {
    return {
      task,
      decision: "must_run_llm",
      reason: `Task references ${outsideFiles.length} file(s) outside the scaffold's protected paths — real work must be generated.`,
      outsideFiles,
    };
  }

  // No files declared: fall back to keyword inspection.
  if (files.length === 0) {
    const haystack = [task.title ?? "", task.description ?? "", task.phase ?? ""]
      .join("\n")
      .toLowerCase();
    const matched = DOMAIN_IMPLEMENTATION_KEYWORDS.find((re) =>
      re.test(haystack),
    );
    if (matched) {
      return {
        task,
        decision: "must_run_llm",
        reason: `Task has no files.creates/modifies but title/description matches keyword ${matched} — likely domain-specific architect work.`,
        outsideFiles: [],
      };
    }
    // Genuinely ambiguous. Stay conservative: run the LLM. It is better to
    // pay for an unnecessary generation than to silently skip a needed one.
    return {
      task,
      decision: "must_run_llm",
      reason: "Task declares no files and no domain keywords — running LLM conservatively to avoid silent skip.",
      outsideFiles: [],
    };
  }

  return {
    task,
    decision: "noop",
    reason: `All ${files.length} declared file(s) fall inside the scaffold's protected paths — prebuilt scaffold already provides this.`,
    outsideFiles: [],
  };
}

function normalizeTaskFileHints(taskFiles: unknown): string[] {
  if (!taskFiles) return [];
  if (Array.isArray(taskFiles)) {
    return taskFiles.filter((f): f is string => typeof f === "string");
  }
  if (typeof taskFiles !== "object") return [];
  const record = taskFiles as Record<string, unknown>;
  // Only `creates` and `modifies` count — `reads` are non-mutating.
  return ["creates", "modifies"]
    .flatMap((k) => (Array.isArray(record[k]) ? (record[k] as unknown[]) : []))
    .filter((f): f is string => typeof f === "string");
}

function normalisePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed.length === 0) return "";
  const noLead = trimmed.replace(/^\.\//, "").replace(/^\/+/, "");
  // Use posix separators everywhere so the match is stable across OSes.
  return noLead.split(path.sep).join("/");
}

function isInsideProtectedSet(rel: string, protectedSet: Set<string>): boolean {
  if (protectedSet.has(rel)) return true;
  // Accept a match if `rel` is under a protected directory entry.
  // Protected entries are typically individual files, but we allow dir prefixes.
  for (const entry of protectedSet) {
    if (!entry) continue;
    if (rel === entry) return true;
    if (rel.startsWith(entry + "/")) return true;
  }
  return false;
}
