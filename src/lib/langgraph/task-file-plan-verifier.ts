/**
 * Task file-plan verifier.
 *
 * The default worker `verifyCode` node only checks that *some* files were
 * generated and that their paths are safe. It does NOT enforce that the task
 * actually produced every file it promised — so a task with
 * `files.creates = ["A.ts", "B.ts"]` can silently return just `A.ts` and
 * still be marked "done".
 *
 * This verifier bridges that gap: given a task and the list of files the
 * worker actually wrote, it checks that every entry in `task.files.creates`
 * matched something, and every entry in `task.files.modifies` was actually
 * modified (content changed since the pre-task snapshot).
 *
 * The result is a structured `TASK_FILE_PLAN_UNFULFILLED: <details>`
 * error message — `routeAfterVerify` recognises this prefix and routes the
 * worker back through a fix attempt (see `WORKER_FIX_ELIGIBLE_PREFIXES`).
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { CodingTask } from "@/lib/pipeline/types";

export const TASK_FILE_PLAN_UNFULFILLED_PREFIX = "TASK_FILE_PLAN_UNFULFILLED:";

/**
 * A regex that starts with `^` + the prefix — useful for callers that want
 * to test whether a `verifyErrors` string came from this verifier.
 */
export const TASK_FILE_PLAN_UNFULFILLED_REGEX = new RegExp(
  `^${TASK_FILE_PLAN_UNFULFILLED_PREFIX}`,
);

export interface TaskFilePlanSnapshot {
  /** path → sha256 of content at task start (for `modifies` diff checks). */
  [relativePath: string]: string;
}

export interface TaskFilePlanVerification {
  passed: boolean;
  missingCreates: string[];
  unmodified: string[];
  /** Short per-issue lines that end up in the `verifyErrors` payload. */
  errorLines: string[];
}

/**
 * Snapshot the current contents (sha256 only) of every `modifies` file the
 * task plans to touch. Run this at task start so the verifier can diff later.
 *
 * Missing files are NOT an error here — the task may plan to create them.
 * We simply record `<absent>` so the verifier will demand creation.
 */
export async function snapshotModifiesFiles(
  task: CodingTask,
  outputDir: string,
): Promise<TaskFilePlanSnapshot> {
  const snap: TaskFilePlanSnapshot = {};
  const modifies = extractPlanList(task.files, "modifies");
  await Promise.all(
    modifies.map(async (rel) => {
      const abs = path.join(outputDir, rel);
      try {
        const buf = await fs.readFile(abs);
        snap[rel] = sha256(buf);
      } catch {
        snap[rel] = "<absent>";
      }
    }),
  );
  return snap;
}

export async function verifyTaskFilePlan(
  task: CodingTask,
  generatedFiles: string[],
  modifiesSnapshot: TaskFilePlanSnapshot,
  outputDir: string,
): Promise<TaskFilePlanVerification> {
  const creates = extractPlanList(task.files, "creates");
  const modifies = extractPlanList(task.files, "modifies");

  const generatedSet = new Set(generatedFiles.map(normalisePath));

  // — creates —
  const missingCreates: string[] = [];
  for (const entry of creates) {
    const pattern = normalisePath(entry);
    if (!pattern) continue;
    if (matchesAny(pattern, generatedSet)) continue;
    missingCreates.push(entry);
  }

  // — modifies —
  const unmodified: string[] = [];
  await Promise.all(
    modifies.map(async (entry) => {
      const rel = normalisePath(entry);
      if (!rel) return;
      // Explicit write counts as "modified" — no need to diff hash.
      if (matchesAny(rel, generatedSet)) return;
      const before = modifiesSnapshot[entry] ?? modifiesSnapshot[rel];
      const abs = path.join(outputDir, rel);
      try {
        const buf = await fs.readFile(abs);
        const after = sha256(buf);
        if (before === after) {
          unmodified.push(entry);
        }
      } catch {
        // File vanished — treat as unmodified-and-missing.
        unmodified.push(entry);
      }
    }),
  );

  const errorLines: string[] = [];
  if (missingCreates.length > 0) {
    errorLines.push(`missingCreates=[${missingCreates.join(", ")}]`);
  }
  if (unmodified.length > 0) {
    errorLines.push(`unmodified=[${unmodified.join(", ")}]`);
  }

  return {
    passed: errorLines.length === 0,
    missingCreates,
    unmodified,
    errorLines,
  };
}

/**
 * Format a verification failure into the `TASK_FILE_PLAN_UNFULFILLED: ...`
 * string consumed by the worker routing logic.
 */
export function formatUnfulfilledMessage(
  v: TaskFilePlanVerification,
): string {
  if (v.passed) return "";
  return `${TASK_FILE_PLAN_UNFULFILLED_PREFIX} ${v.errorLines.join(" ")}`;
}

// ─── helpers ─────────────────────────────────────────────────────────────

function extractPlanList(files: unknown, key: "creates" | "modifies"): string[] {
  if (!files) return [];
  if (Array.isArray(files)) return []; // legacy flat list carries no intent
  if (typeof files !== "object") return [];
  const record = files as Record<string, unknown>;
  const raw = record[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
}

function normalisePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed.length === 0) return "";
  const noLead = trimmed.replace(/^\.\//, "").replace(/^\/+/, "");
  return noLead.split(path.sep).join("/");
}

function matchesAny(pattern: string, generatedSet: Set<string>): boolean {
  if (generatedSet.has(pattern)) return true;
  // Plain equality failed — try a glob match if the pattern contains wildcards.
  if (!pattern.includes("*")) return false;
  // Reject a `**/*`-style wildcard that matches everything — too loose to be
  // meaningful evidence that the task's specific file was produced.
  if (/^\*+\/?\*+$/.test(pattern) || pattern.trim() === "**/*") return false;
  const re = globToRegex(pattern);
  for (const g of generatedSet) {
    if (re.test(g)) return true;
  }
  return false;
}

/**
 * Minimal glob → RegExp converter. Supports:
 *   `*`  — any run of non-slash characters
 *   `**` — any run of characters including slashes
 * This is intentionally simple; the verifier accepts false positives (over-
 * matches) only for non-trivial patterns.
 */
function globToRegex(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (glob[i] === "/") i++; // skip `**/`
        continue;
      }
      re += "[^/]*";
      i++;
      continue;
    }
    if (/[.+?^${}()|[\]\\]/.test(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
    i++;
  }
  return new RegExp("^" + re + "$");
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
