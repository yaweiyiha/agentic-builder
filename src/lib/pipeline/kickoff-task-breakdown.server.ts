import { TaskBreakdownAgent } from "@/lib/agents/task-breakdown-agent";
import type { ProjectTier } from "@/lib/agents/project-classifier";
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

/**
 * Walk `raw` character by character to extract every syntactically complete
 * JSON object `{…}` that appears at the top level of the array.
 * Works even when the LLM output is cut off mid-way through the last task.
 */
function recoverTasksFromTruncatedJson(raw: string): KickoffWorkItem[] {
  const tasks: KickoffWorkItem[] = [];
  const start = raw.indexOf("[");
  if (start === -1) return tasks;

  let i = start + 1;
  while (i < raw.length) {
    // Skip whitespace, commas, and newlines between objects
    while (i < raw.length && " \n\r\t,".includes(raw[i]!)) i++;
    if (i >= raw.length || raw[i] !== "{") break;

    // Track balanced braces to find the end of the current object
    let depth = 0;
    let j = i;
    let inString = false;
    let escape = false;

    while (j < raw.length) {
      const ch = raw[j]!;
      if (escape) { escape = false; j++; continue; }
      if (ch === "\\" && inString) { escape = true; j++; continue; }
      if (ch === '"') { inString = !inString; j++; continue; }
      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) { j++; break; } }
      }
      j++;
    }

    if (depth !== 0) break; // Object was cut off — stop here

    try {
      const obj: unknown = JSON.parse(raw.slice(i, j));
      if (isKickoffWorkItem(obj)) tasks.push(obj);
    } catch {
      // malformed object — skip it
    }
    i = j;
  }

  return tasks;
}

function parseJsonArrayFromLlmOutput(raw: string): {
  tasks: KickoffWorkItem[];
  parseFailed: boolean;
  parseError?: string;
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
    return { tasks: (parsed as unknown[]).filter(isKickoffWorkItem), parseFailed: false };
  } catch {
    // Output was likely truncated at the token limit.
    // Try to salvage every complete task object from the partial JSON.
    const recovered = recoverTasksFromTruncatedJson(raw);
    if (recovered.length > 0) {
      console.warn(
        `[TaskBreakdown] JSON truncated — recovered ${recovered.length} complete tasks out of partial output (${raw.length} chars).`,
      );
      return { tasks: recovered, parseFailed: false };
    }

    const msg = "Truncated or malformed JSON — no complete tasks could be recovered.";
    console.error("[TaskBreakdown] Failed to parse LLM JSON output");
    return { tasks: [], parseFailed: true, parseError: msg };
  }
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
}): Promise<{
  tasks: KickoffWorkItem[];
  costUsd: number;
  durationMs: number;
  model: string;
  parseFailed: boolean;
  parseError?: string;
  rawOutput: string;
}> {
  const tier = params.tier ?? "M";
  const scaffoldTier = tier as ScaffoldTier;
  const templatePaths = await listScaffoldTemplateRelativePaths(scaffoldTier);
  const scaffoldBlock = buildTaskBreakdownScaffoldBlock(scaffoldTier, templatePaths);
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
    },
    params.sessionId,
  );

  const parsed = parseJsonArrayFromLlmOutput(result.content);

  return {
    tasks: stripTestingPhaseTasks(parsed.tasks),
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    model: result.model,
    parseFailed: parsed.parseFailed,
    parseError: parsed.parseError,
    rawOutput: result.content,
  };
}
