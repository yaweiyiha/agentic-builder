import { TaskBreakdownAgent } from "@/lib/agents/task-breakdown-agent";
import {
  normalizeProjectTier,
  type ProjectTier,
} from "@/lib/agents/shared/project-classifier";
import { formatPrdSpecForContext } from "@/lib/requirements/prd-spec-extractor";
import type { PrdSpec } from "@/lib/requirements/prd-spec-types";
import {
  listScaffoldTemplateRelativePaths,
  type ScaffoldTier,
} from "@/lib/pipeline/scaffold-copy";
import { buildTaskBreakdownScaffoldBlock } from "@/lib/pipeline/scaffold-spec";
import type { KickoffWorkItem } from "./types";
import { stripTestingPhaseTasks } from "./strip-testing-tasks";

function isKickoffWorkItem(x: unknown): x is KickoffWorkItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((item) => typeof item === "string");
  const filesOk =
    o.files === undefined ||
    isStringArray(o.files) ||
    (typeof o.files === "object" &&
      o.files !== null &&
      isStringArray((o.files as Record<string, unknown>).creates) &&
      isStringArray((o.files as Record<string, unknown>).modifies) &&
      isStringArray((o.files as Record<string, unknown>).reads));
  const coversOk =
    o.coversRequirementIds === undefined ||
    (Array.isArray(o.coversRequirementIds) &&
      o.coversRequirementIds.every((id) => typeof id === "string"));
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.phase === "string" &&
    typeof o.description === "string" &&
    typeof o.estimatedHours === "number" &&
    (o.executionKind === "ai_autonomous" ||
      o.executionKind === "human_confirm_after") &&
    filesOk &&
    coversOk
  );
}

interface RecoveryResult {
  tasks: KickoffWorkItem[];
  /** Count of `{` we saw but could not close or validate. Approximates
   *  "how many tasks did the LLM start but we lost to truncation/noise." */
  droppedCount: number;
  /** Truncated-at offset in the raw string, if any (useful for continuation prompts). */
  truncationOffset: number | null;
}

/**
 * Walk `raw` character by character to extract every syntactically complete
 * JSON object `{…}` that appears at the top level of the array.
 * Works even when the LLM output is cut off mid-way through the last task.
 *
 * Also reports how many task objects appeared to start but could not be
 * recovered (truncation, malformed JSON, failed validation), so the pipeline
 * can surface an explicit "truncation_detected" telemetry event instead of
 * silently dropping tasks.
 */
function recoverTasksFromTruncatedJson(raw: string): RecoveryResult {
  const tasks: KickoffWorkItem[] = [];
  const start = raw.indexOf("[");
  if (start === -1) {
    return { tasks, droppedCount: 0, truncationOffset: null };
  }

  let i = start + 1;
  let seenOpenBrace = 0;
  let truncationOffset: number | null = null;

  while (i < raw.length) {
    // Skip whitespace, commas, and newlines between objects
    while (i < raw.length && " \n\r\t,".includes(raw[i]!)) i++;
    if (i >= raw.length || raw[i] !== "{") break;

    seenOpenBrace++;

    // Track balanced braces to find the end of the current object
    let depth = 0;
    let j = i;
    let inString = false;
    let escape = false;

    while (j < raw.length) {
      const ch = raw[j]!;
      if (escape) {
        escape = false;
        j++;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        j++;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        j++;
        continue;
      }
      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      j++;
    }

    if (depth !== 0) {
      // Last object was cut off mid-way — record the offset so a continuation
      // prompt can quote the fragment and resume from the last valid task id.
      truncationOffset = i;
      break;
    }

    try {
      const obj: unknown = JSON.parse(raw.slice(i, j));
      if (isKickoffWorkItem(obj)) tasks.push(obj);
    } catch {
      // malformed object — skip it
    }
    i = j;
  }

  return {
    tasks,
    droppedCount: Math.max(0, seenOpenBrace - tasks.length),
    truncationOffset,
  };
}

export function parseJsonArrayFromLlmOutput(raw: string): {
  tasks: KickoffWorkItem[];
  parseFailed: boolean;
  parseError?: string;
  /** Approximate number of tasks lost to truncation/malformed objects. */
  droppedCount?: number;
  /** Offset in `raw` where the final incomplete object starts (if any). */
  truncationOffset?: number;
} {
  let cleaned = raw.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const bracketStart = cleaned.indexOf("[");
  const bracketEnd = cleaned.lastIndexOf("]");
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    cleaned = cleaned.slice(bracketStart, bracketEnd + 1);
  }

  // --- Happy path: output is complete and valid JSON ---
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      return {
        tasks: [],
        parseFailed: true,
        parseError: "LLM output is not a JSON array.",
      };
    }
    return {
      tasks: (parsed as unknown[]).filter(isKickoffWorkItem),
      parseFailed: false,
    };
  } catch {
    // Output was likely truncated at the token limit.
    // Try to salvage every complete task object from the partial JSON.
    const recovered = recoverTasksFromTruncatedJson(raw);
    if (recovered.tasks.length > 0) {
      console.warn(
        `[TaskBreakdown] JSON truncated — recovered ${recovered.tasks.length} complete tasks; ${recovered.droppedCount} dropped from partial output (${raw.length} chars).`,
      );
      return {
        tasks: recovered.tasks,
        parseFailed: false,
        droppedCount: recovered.droppedCount,
        truncationOffset: recovered.truncationOffset ?? undefined,
      };
    }

    const msg =
      "Truncated or malformed JSON — no complete tasks could be recovered.";
    console.error("[TaskBreakdown] Failed to parse LLM JSON output");
    return {
      tasks: [],
      parseFailed: true,
      parseError: msg,
      droppedCount: recovered.droppedCount,
      truncationOffset: recovered.truncationOffset ?? undefined,
    };
  }
}

function extractPrdRequirementIds(prd: string): Set<string> {
  const ids = new Set<string>();
  const re = /\b(?:AC|FR|US|IC)-[A-Z0-9]+(?:-[A-Z0-9]+)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prd)) !== null) ids.add(m[0]);
  return ids;
}

function normalizeDependencyIds(
  task: KickoffWorkItem,
  validTaskIds: Set<string>,
): string[] {
  const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
  return deps.filter((d) => typeof d === "string" && validTaskIds.has(d));
}

function normalizeCoverageIds(
  task: KickoffWorkItem,
  prdIds: Set<string>,
): string[] {
  const raw = Array.isArray(task.coversRequirementIds)
    ? task.coversRequirementIds
    : [];

  const out = new Set<string>();
  for (const idRaw of raw) {
    if (typeof idRaw !== "string") continue;
    const id = idRaw.trim();
    if (!id) continue;

    // Common hallucination/typo fallback: FR-TMxx -> FR-TSxx (Task Management)
    if (/^FR-TM\d+$/i.test(id)) {
      const mapped = id.replace(/^FR-TM/i, "FR-TS");
      if (prdIds.has(mapped)) {
        out.add(mapped);
        continue;
      }
    }

    // Keep AC/FR/US/IC only when they exist in PRD.
    if (/^(AC|FR|US|IC)-/i.test(id)) {
      if (prdIds.has(id)) out.add(id);
      continue;
    }

    // Keep structured IDs from PRD spec context if present.
    if (/^(PAGE|CMP|F)-/i.test(id)) {
      out.add(id);
    }
  }
  return [...out];
}

export function normalizeOriginalTaskBreakdown(
  tasks: KickoffWorkItem[],
  prd: string,
): KickoffWorkItem[] {
  const validTaskIds = new Set(tasks.map((t) => t.id));
  const prdIds = extractPrdRequirementIds(prd);

  return tasks.map((t) => ({
    ...t,
    dependencies: normalizeDependencyIds(t, validTaskIds),
    coversRequirementIds: normalizeCoverageIds(t, prdIds),
  }));
}

/**
 * Use the LLM to analyze all pipeline documents and produce a real coding task breakdown.
 * Falls back to an empty list if the LLM output cannot be parsed.
 */
export async function buildTaskBreakdownFromDocuments(params: {
  prd: string;
  trd?: string;
  sysDesign?: string;
  implGuide?: string;
  designSpec?: string;
  /** Structured PRD spec (pages + component IDs) produced by prd-spec-extractor. */
  prdSpec?: PrdSpec | null;
  sessionId?: string;
  tier?: ProjectTier;
  /** Optional user-selected guidance for improving a previously generated breakdown. */
  improvementNotes?: string[];
}): Promise<{
  tasks: KickoffWorkItem[];
  costUsd: number;
  durationMs: number;
  model: string;
  parseFailed: boolean;
  parseError?: string;
  rawOutput: string;
  droppedFromTruncation?: number;
  truncationOffset?: number;
}> {
  const tier = normalizeProjectTier(params.tier ?? "M");
  const scaffoldTier = tier as ScaffoldTier;
  const templatePaths = await listScaffoldTemplateRelativePaths(scaffoldTier);
  const scaffoldBlock = buildTaskBreakdownScaffoldBlock(
    scaffoldTier,
    templatePaths,
  );
  const agent = new TaskBreakdownAgent(tier, scaffoldBlock);

  const prdSpecText = params.prdSpec
    ? formatPrdSpecForContext(params.prdSpec)
    : undefined;

  const result = await agent.generateTaskBreakdown(
    {
      prd: params.prd,
      trd: params.trd,
      sysDesign: params.sysDesign,
      implGuide: params.implGuide,
      designSpec: params.designSpec,
      prdSpecText,
      improvementNotes: params.improvementNotes,
    },
    params.sessionId,
  );

  const parsed = parseJsonArrayFromLlmOutput(result.content);
  const normalized = normalizeOriginalTaskBreakdown(parsed.tasks, params.prd);

  return {
    tasks: stripTestingPhaseTasks(normalized),
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    model: result.model,
    parseFailed: parsed.parseFailed,
    parseError: parsed.parseError,
    rawOutput: result.content,
    droppedFromTruncation: parsed.droppedCount,
    truncationOffset: parsed.truncationOffset,
  };
}
