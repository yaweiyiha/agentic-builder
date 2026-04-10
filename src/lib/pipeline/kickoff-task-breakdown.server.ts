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

function isKickoffWorkItem(x: unknown): x is KickoffWorkItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
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
    coversOk
  );
}

function parseJsonArrayFromLlmOutput(raw: string): KickoffWorkItem[] {
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

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKickoffWorkItem);
  } catch {
    console.error("[TaskBreakdown] Failed to parse LLM JSON output");
    return [];
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
}): Promise<{ tasks: KickoffWorkItem[]; costUsd: number; durationMs: number }> {
  const tier = params.tier ?? "L";
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

  const tasks = parseJsonArrayFromLlmOutput(result.content);

  return {
    tasks,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
  };
}
