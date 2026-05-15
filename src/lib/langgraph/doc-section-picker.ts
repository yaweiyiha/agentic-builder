/**
 * Relevance-aware document trimmer.
 *
 * Historically, long design docs (TRD / SystemDesign / ImplementationGuide,
 * the project PRD itself) were truncated with a naive `slice(0, N)` before
 * being injected into agent prompts. When the relevant content happened to
 * live beyond N characters, the agent simply never saw it — a silent class
 * of "PRD feature missing" bugs.
 *
 * `pickRelevantSections` replaces slice-style truncation with a
 * section-scored trimmer:
 *   1. Split on H2/H3 headings (fall back to paragraph splits if the doc has
 *      no headings).
 *   2. Score every section against a `TaskHint` — keyword, file path, and
 *      PRD-id matches in the section's heading + body.
 *   3. Pack the highest-scoring sections until the character `budget` is
 *      spent; drop the rest.
 *   4. Telemetry (optional `RepairEmitter`) records what was trimmed so the
 *      front-end can surface silent truncations.
 */

import type { RepairEmitter } from "@/lib/pipeline/self-heal";

export interface TaskHint {
  /** Short, high-signal words to match in section headings and bodies. */
  keywords?: string[];
  /** PRD requirement IDs (AC / FR / PAGE / CMP …) this consumer cares about. */
  requirementIds?: string[];
  /** File paths the consumer plans to create / modify. */
  files?: string[];
}

export interface PickOptions {
  /** Character budget for the returned string. Hard upper bound. */
  budget: number;
  /** Label printed in repair events, e.g. "TRD" or "integration-review". */
  label?: string;
  emitter?: RepairEmitter;
  /** Which consumer is asking — included in telemetry for debugging. */
  stage?: string;
  /**
   * Sections whose heading matches this pattern are ALWAYS kept, regardless
   * of score. Used for "shared" content (glossary, conventions, data formats,
   * error handling, environment/env vars) that every task needs but that
   * rarely scores high on keyword-based relevance.
   *
   * The scoring pass still runs on the remaining sections; always-kept
   * sections just pre-consume part of the budget.
   */
  alwaysKeepHeadingPattern?: RegExp;
  /**
   * Requirement IDs (FR-*, AC-*, PAGE-*, CMP-*, …) that MUST end up in the
   * output. Any section whose heading or body contains one of these ids is
   * force-included, even if it would be dropped by score-based packing.
   *
   * This is the "task self-check": the caller's `hint.requirementIds` say
   * "this task cares about these IDs"; `forceIncludeIds` is the stronger
   * "and the IDs absolutely MUST survive trimming". In practice the worker
   * codegen passes the same list to both to guarantee task-owned AC/FR
   * sections never silently disappear.
   */
  forceIncludeIds?: string[];
}

interface Section {
  heading: string;
  body: string;
  length: number;
}

export function pickRelevantSections(
  doc: string,
  hint: TaskHint,
  options: PickOptions,
): string {
  const budget = Math.max(1_000, options.budget | 0);
  if (!doc) return "";
  if (doc.length <= budget) return doc;

  const sections = splitByHeadings(doc);
  if (sections.length === 0) {
    // Last-resort fallback: slice from the front — preserves legacy
    // behaviour for pathological "no headings at all" docs.
    options.emitter?.({
      stage: (options.stage as never) ?? "worker-context",
      event: "section_split_fallback",
      details: {
        label: options.label,
        reason: "No H2/H3 headings found — falling back to head-slice.",
        kept: budget,
        total: doc.length,
      },
    });
    return doc.slice(0, budget);
  }

  const keywords = normaliseHaystack(hint.keywords ?? []);
  const files = normaliseHaystack(hint.files ?? []);
  const reqIds = normaliseHaystack(hint.requirementIds ?? []);
  const forceIds = normaliseHaystack(options.forceIncludeIds ?? []);
  const alwaysKeepRe = options.alwaysKeepHeadingPattern;

  const scored = sections.map((s, idx) => {
    const headingLower = s.heading.toLowerCase();
    const bodyLower = s.body.toLowerCase();
    const isAlwaysKeep = Boolean(alwaysKeepRe && alwaysKeepRe.test(s.heading));
    const isForceKeep =
      forceIds.length > 0 &&
      forceIds.some(
        (id) => headingLower.includes(id) || bodyLower.includes(id),
      );
    return {
      section: s,
      originalIdx: idx,
      score: scoreSection(s, keywords, files, reqIds),
      isAlwaysKeep,
      isForceKeep,
    };
  });

  // Phase 1 — ALWAYS-KEEP + FORCE-KEEP: pre-reserve budget for sections that
  // must survive trimming regardless of their relevance score. These can
  // overflow the budget (safety net); we log telemetry if that happens.
  const kept: Array<(typeof scored)[number]> = [];
  let used = 0;
  const sep = "\n\n";
  const alwaysKeptHeadings: string[] = [];
  const forceKeptHeadings: string[] = [];
  for (const s of scored) {
    if (!s.isAlwaysKeep && !s.isForceKeep) continue;
    kept.push(s);
    used += s.section.length + sep.length;
    if (s.isAlwaysKeep) alwaysKeptHeadings.push(s.section.heading || "(no heading)");
    if (s.isForceKeep && !s.isAlwaysKeep) {
      forceKeptHeadings.push(s.section.heading || "(no heading)");
    }
  }

  // Phase 2 — SCORE-BASED PACKING on the remaining sections, within the
  // budget left after Phase 1. Sort by score (desc).
  const remaining = scored
    .filter((s) => !s.isAlwaysKeep && !s.isForceKeep)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break on original order so output stays intuitive.
      return a.originalIdx - b.originalIdx;
    });
  for (const s of remaining) {
    const cost = s.section.length + sep.length;
    if (used + cost > budget) continue;
    kept.push(s);
    used += cost;
  }

  if (kept.length === 0) {
    // Budget doesn't even fit the top-scoring section. Keep it anyway — a
    // truncated "most relevant" is better than nothing.
    const top = scored[0];
    const text = top.section.heading
      ? `### ${top.section.heading}\n${top.section.body.slice(0, budget - top.section.heading.length - 10)}`
      : top.section.body.slice(0, budget);
    options.emitter?.({
      stage: (options.stage as never) ?? "worker-context",
      event: "doc_truncated",
      details: {
        label: options.label,
        reason: "Budget too small for any full section — kept only the top-scoring section, truncated.",
        keptSections: 1,
        droppedSections: sections.length - 1,
      },
    });
    return text;
  }

  kept.sort((a, b) => a.originalIdx - b.originalIdx);
  const output = kept
    .map((s) =>
      s.section.heading
        ? `### ${s.section.heading}\n${s.section.body}`
        : s.section.body,
    )
    .join(sep);

  if (kept.length < scored.length) {
    options.emitter?.({
      stage: (options.stage as never) ?? "worker-context",
      event: "doc_truncated",
      details: {
        label: options.label,
        keptSections: kept.length,
        droppedSections: scored.length - kept.length,
        budgetChars: budget,
        usedChars: output.length,
        alwaysKeptSections: alwaysKeptHeadings.length,
        forceKeptSections: forceKeptHeadings.length,
        overBudget: used > budget ? used - budget : 0,
      },
    });
  }

  return output;
}

/**
 * Split a document into H2/H3 sections and return their headings.
 * Exposed so callers can report what's available for debugging / telemetry
 * without duplicating the splitter. Preamble (body before the first heading)
 * is reported as `(preamble)`.
 */
export function listSectionHeadings(doc: string): string[] {
  return splitByHeadings(doc).map((s) => s.heading || "(preamble)");
}

// ─── helpers ─────────────────────────────────────────────────────────────

function splitByHeadings(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let heading = "";
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0 && heading.length === 0) return;
    const body = buffer.join("\n").trim();
    sections.push({
      heading: heading.trim(),
      body,
      length: heading.length + body.length + 4,
    });
    heading = "";
    buffer = [];
  };
  const HEADING_RE = /^#{2,3}\s+(.+?)\s*$/;
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flush();
      heading = m[1];
      continue;
    }
    buffer.push(line);
  }
  flush();

  // If the very first chunk captured body-only content (preamble before any
  // heading), keep it too — sometimes important TL;DR info lives there.
  return sections.filter((s) => s.heading.length > 0 || s.body.length > 0);
}

function normaliseHaystack(items: string[]): string[] {
  return items
    .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
    .filter((s) => s.length >= 3);
}

function scoreSection(
  s: Section,
  keywords: string[],
  files: string[],
  reqIds: string[],
): number {
  const heading = s.heading.toLowerCase();
  const body = s.body.toLowerCase();
  let score = 0;

  for (const id of reqIds) {
    if (heading.includes(id) || body.includes(id)) score += 80;
  }
  for (const kw of keywords) {
    if (heading.includes(kw)) score += 15;
    if (body.includes(kw)) score += 5;
  }
  for (const file of files) {
    if (heading.includes(file) || body.includes(file)) score += 30;
    const basename = basenameOf(file);
    if (basename.length >= 3) {
      if (heading.includes(basename)) score += 10;
      if (body.includes(basename)) score += 4;
    }
  }

  // Always bias slightly toward architecture / contract / schema / api /
  // endpoint sections — these tend to carry high-density implementation info.
  if (/\b(api|endpoint|schema|contract|data model|route|table)\b/i.test(s.heading)) {
    score += 10;
  }

  // Penalty for extremely short sections — probably just headings with no
  // body; unlikely to add signal.
  if (s.body.length < 100) score -= 3;
  return score;
}

function basenameOf(p: string): string {
  const withoutDir = p.split("/").pop() ?? p;
  return withoutDir.split(".")[0].toLowerCase();
}
