/**
 * Worker codegen context trimmer.
 *
 * Historically, every codegen worker call received the full `projectContext`
 * (PRD + TRD + SystemDesign + ImplementationGuide + E2E spec + …) verbatim.
 * With an 80K-word PRD that context alone can exceed 100K tokens per call,
 * pushing us dangerously close to the 200K context window and burning input
 * tokens on sections that have nothing to do with the current task.
 *
 * `trimProjectContextForTask` solves that with four layered protections so
 * "trimming" can never silently lose task-critical information:
 *
 *   1. **Score-based packing** — delegates to `pickRelevantSections`, which
 *      splits by H2/H3 headings and retains the highest-scoring sections up
 *      to `budget` chars based on task keywords + file paths + FR/AC ids.
 *
 *   2. **Always-keep whitelist** — sections whose heading matches
 *      `ALWAYS_KEEP_HEADING_RE` (glossary / conventions / data formats /
 *      error handling / environment vars / shared UI rules / design tokens
 *      / …) are ALWAYS kept, regardless of score. These are the "everyone
 *      needs this" sections that rarely score high on keyword relevance.
 *
 *   3. **FR / AC self-check** — any section containing one of the task's
 *      `coversRequirementIds` is force-included. A task's own declared
 *      requirements CANNOT be dropped by trimming.
 *
 *   4. **Trim marker** — when trimming actually happens, we append a small
 *      block telling the worker "the context was trimmed, drop the illusion
 *      that this is complete; use read_file / grep to load the full PRD if
 *      you need details you don't see here". Coupled with the existing
 *      read-only tools (read_file / list_files / grep), the worker can
 *      always recover information that happened to fall outside the budget.
 *
 * Telemetry is emitted via the shared `RepairEmitter`: every trim decision
 * lands in `.ralph/repair-log.jsonl` as a `worker_context_trimmed` event so
 * downstream triage can see exactly what was dropped.
 */

import {
  pickRelevantSections,
  listSectionHeadings,
  type TaskHint,
} from "./doc-section-picker";
import { getRepairEmitter } from "@/lib/pipeline/self-heal/events";
import type { CodingTask } from "@/lib/pipeline/types";

/**
 * Default per-task character budget for `projectContext` after trimming.
 *
 * Two-tier auto-detection (when `WORKER_CONTEXT_BUDGET_CHARS` is unset):
 *   - Large-window providers (DeepSeek V4 Pro 1M, Gemini 1M+): default
 *     150,000 chars (~37K tokens). With a 1M-token window we can afford
 *     to keep the bulk of PRD + ImplementationGuide + SystemDesign and
 *     stop forcing workers to grep their way back to context they should
 *     have seen up-front.
 *   - Standard providers (OpenRouter chains, 128K–200K windows): keep
 *     the legacy 30,000-char budget to avoid prompt-size errors.
 *
 * Override at runtime via `WORKER_CONTEXT_BUDGET_CHARS` env var.
 *
 * Hard cap is 1,000,000 chars (~250K tokens). When using DeepSeek V4 Pro
 * (1M token window) a budget of 400,000–800,000 chars is safe.
 */
export const DEFAULT_WORKER_CONTEXT_BUDGET_CHARS = (() => {
  const raw = Number(process.env.WORKER_CONTEXT_BUDGET_CHARS ?? "");
  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(6_000, Math.min(Math.floor(raw), 1_000_000));
  }
  const hasLargeWindowProvider =
    Boolean(process.env.DEEPSEEK_API_KEY?.trim()) ||
    Boolean(process.env.GEMINI_API_KEY?.trim());
  return hasLargeWindowProvider ? 150_000 : 30_000;
})();

/**
 * Heading regex for sections that are ALWAYS kept during trimming. These
 * are "shared" sections that every task needs to see — keeping them
 * outside of the relevance-score competition prevents common-knowledge
 * sections from being silently dropped.
 *
 * Matching is case-insensitive on the heading text only; the body is NOT
 * scanned to avoid false positives on normal prose that mentions
 * "error handling" in passing.
 */
const ALWAYS_KEEP_HEADING_RE =
  /\b(common|shared|glossary|convention|conventions|data format|data formats|data model|data models|error handling|env|environment|env vars|environment vars|design token|design tokens|api contract|api contracts|shared ui|ui rules|theme|theming|color|colors|typography|spacing|layout rules|routing|navigation|auth|authentication|authorization|credentials|credentials \(env vars\)|external resources)\b/i;

/**
 * Extract heuristic keywords from a task's title + description. Used as
 * the relevance hint for score-based packing. We deliberately keep this
 * cheap — a richer NLP-driven hint is out of scope here.
 */
function deriveTaskKeywords(task: CodingTask): string[] {
  const text = `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();
  // Strip markdown / punctuation, keep word boundaries.
  const tokens = text
    .replace(/[`*_#>[\]()<>{}"',.!?;:/\\]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && w.length <= 24);

  // Drop generic stopwords that add no discriminating power.
  const STOP = new Set([
    "the",
    "and",
    "with",
    "that",
    "this",
    "from",
    "into",
    "then",
    "when",
    "where",
    "which",
    "while",
    "these",
    "those",
    "task",
    "should",
    "would",
    "could",
    "shall",
    "must",
    "also",
    "been",
    "have",
    "having",
    "include",
    "includes",
    "please",
    "using",
    "uses",
    "used",
    "build",
    "create",
    "implement",
    "implements",
    "implementation",
    "generate",
    "generates",
    "feature",
    "features",
    "support",
    "supports",
    "handle",
    "handles",
    "handling",
    "make",
    "makes",
    "ensure",
    "ensures",
    "provide",
    "provides",
    "update",
    "updates",
    "render",
    "renders",
    "display",
    "displays",
    "logic",
    "related",
  ]);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const tok of tokens) {
    if (STOP.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    kept.push(tok);
    if (kept.length >= 24) break;
  }
  return kept;
}

/**
 * Pull file path hints from the task's `files` plan. Accepts both the
 * legacy `string[]` shape and the newer `{creates, modifies, reads}`
 * structured form — we flatten everything into one list for matching.
 */
function deriveTaskFiles(task: CodingTask): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "string" && v.trim().length > 0) out.push(v);
  };
  if (Array.isArray(task.files)) {
    for (const f of task.files) push(f);
  } else if (task.files && typeof task.files === "object") {
    const rec = task.files as unknown as Record<string, unknown>;
    for (const key of ["creates", "modifies", "reads"] as const) {
      const arr = rec[key];
      if (Array.isArray(arr)) {
        for (const f of arr) push(f);
      }
    }
  }
  return out;
}

export interface TrimWorkerContextOptions {
  task: CodingTask;
  /** Character budget for the trimmed context. Defaults to `DEFAULT_WORKER_CONTEXT_BUDGET_CHARS`. */
  budget?: number;
  /** Used to resolve the shared `RepairEmitter`. */
  sessionId?: string;
  /** Appears in repair events; e.g. the worker label. */
  label?: string;
}

export interface TrimWorkerContextResult {
  /** Trimmed text ready for prompt injection. Always non-empty if input was non-empty. */
  content: string;
  /** True if any trimming actually happened. */
  trimmed: boolean;
  /** Characters in the final output. */
  usedChars: number;
  /** Characters in the original input. */
  originalChars: number;
  /** Section headings that existed in the input (approximate, for debugging). */
  availableHeadings: string[];
}

/**
 * Trim `projectContext` down to a task-relevant subset, with always-keep
 * whitelist + FR/AC self-check + trim-marker fallback.
 *
 * Returned `content` is safe to push directly into the prompt in place of
 * the original `projectContext`.
 */
export function trimProjectContextForTask(
  projectContext: string,
  opts: TrimWorkerContextOptions,
): TrimWorkerContextResult {
  const original = projectContext ?? "";
  const budget = Math.max(
    6_000,
    Math.floor(opts.budget ?? DEFAULT_WORKER_CONTEXT_BUDGET_CHARS),
  );

  // Short-circuit: if the whole doc already fits, skip trimming entirely.
  if (original.length <= budget) {
    return {
      content: original,
      trimmed: false,
      usedChars: original.length,
      originalChars: original.length,
      availableHeadings: [],
    };
  }

  const keywords = deriveTaskKeywords(opts.task);
  const files = deriveTaskFiles(opts.task);
  const requirementIds = opts.task.coversRequirementIds ?? [];

  const hint: TaskHint = {
    keywords,
    files,
    requirementIds,
  };

  const emitter = getRepairEmitter(opts.sessionId);
  const availableHeadings = listSectionHeadings(original);
  const label = opts.label
    ? `worker-codegen:${opts.label}`
    : "worker-codegen";

  const trimmed = pickRelevantSections(original, hint, {
    budget,
    label,
    stage: "worker-context",
    emitter,
    alwaysKeepHeadingPattern: ALWAYS_KEEP_HEADING_RE,
    // The task's own covered requirement IDs are force-included — a task
    // cannot silently lose access to the FR/AC it's responsible for.
    forceIncludeIds: requirementIds,
  });

  const wasTrimmed = trimmed.length < original.length;
  const marker = wasTrimmed
    ? buildTrimMarker({
        originalChars: original.length,
        keptChars: trimmed.length,
        availableHeadings,
        budget,
      })
    : "";

  const content = marker ? `${trimmed}\n\n${marker}` : trimmed;

  // Emit an explicit worker-scoped telemetry event. `pickRelevantSections`
  // already emits `doc_truncated`; this one is higher-signal for the
  // session report (one event per worker call) and carries task context.
  if (wasTrimmed) {
    emitter({
      stage: "worker-context",
      event: "worker_context_trimmed",
      details: {
        label,
        taskId: opts.task.id,
        taskTitle: opts.task.title,
        originalChars: original.length,
        keptChars: content.length,
        budgetChars: budget,
        requirementIds: requirementIds.slice(0, 20),
        keywordCount: keywords.length,
        fileHintCount: files.length,
        availableSectionCount: availableHeadings.length,
      },
    });
  }

  return {
    content,
    trimmed: wasTrimmed,
    usedChars: content.length,
    originalChars: original.length,
    availableHeadings,
  };
}

interface TrimMarkerInput {
  originalChars: number;
  keptChars: number;
  availableHeadings: string[];
  budget: number;
}

/**
 * Build the "context was trimmed" marker the worker reads. Crucial: this
 * is what tells the model "don't hallucinate — if the detail you need is
 * missing here, call a tool". Without it, the LLM has no way to know it's
 * seeing a partial view and may confidently invent details.
 */
function buildTrimMarker(input: TrimMarkerInput): string {
  const { originalChars, keptChars, availableHeadings, budget } = input;
  const droppedSections = availableHeadings.length;
  // Show the first ~20 headings as breadcrumbs so the worker knows what
  // *could* be loaded on demand. Long heading lists get truncated.
  const headingPreview = availableHeadings.slice(0, 20).join(" | ");
  const ellipsis =
    availableHeadings.length > 20
      ? ` | …(${availableHeadings.length - 20} more)`
      : "";

  return [
    "---",
    "## ⚠️ PROJECT CONTEXT TRIMMED",
    "",
    `The project context you see above is a **relevance-filtered subset** of the full design docs. ${originalChars.toLocaleString()} chars were compressed into ${keptChars.toLocaleString()} chars (budget: ${budget.toLocaleString()}).`,
    "",
    "If you need information that does not appear in the trimmed context — especially cross-cutting concerns (auth flows, shared types, error handling conventions, data formats, global UI rules) — **load it on demand** with the read-only tools:",
    "",
    "- `read_file { path: \"PRD.md\" }` — the authoritative product spec (full text, unfiltered)",
    "- `read_file { path: \"TRD.md\" }` / `SystemDesign.md` / `ImplementationGuide.md` — architecture docs",
    "- `grep { pattern: \"<keyword>\", path: \"PRD.md\" }` — search the full PRD for a specific term",
    "- `list_files { dir: \".\" }` — discover what docs exist",
    "",
    `### Section headings present in the full context (${droppedSections} total)`,
    headingPreview ? headingPreview + ellipsis : "(none detected)",
    "",
    "Do **NOT** invent requirements or API shapes because a section seems to be missing. Instead, grep / read the full PRD first.",
    "---",
  ].join("\n");
}
