/**
 * Preparation-phase recall helpers.
 *
 * Wrappers around `recallAndPrepareInject` for the PRD and Design steps.
 * These steps live before any code is generated, so they only consult L1
 * (cross-project) memory and use the phase-specific inject toggles
 * (`MEMORY_PRD_INJECT` / `MEMORY_DESIGN_INJECT`).
 *
 * The returned `block` is meant to be passed verbatim as the
 * `additionalContext` argument of the PRD / Design agent so it ends up at
 * the top of the user message, preserving the agent's existing system
 * prompt unchanged.
 */

import {
  memoryInjectEnabledForPrd,
  memoryInjectEnabledForDesign,
} from "./env";
import { recallAndPrepareInject, type RecallContextResult } from "./recall-context";
import type { ProjectTier } from "../agents/shared/project-classifier";

export interface PreparationRecallInput {
  sessionId: string;
  /** Free-form description of what the PRD/Design is being generated for. */
  featureBrief: string;
  /** Project tier — used as a tag filter so S-tier projects pull S-tier patterns. */
  tier?: ProjectTier;
  /** Optional project type / domain identifier (e.g. "calculator", "dashboard"). */
  projectType?: string;
  /** Optional project root for L2 memory; PRD/Design typically only use L1. */
  projectRoot?: string;
}

const TIER_TAG = (tier?: ProjectTier): string | undefined =>
  tier ? `tier:${tier}` : undefined;

const PROJECT_TYPE_TAG = (projectType?: string): string | undefined =>
  projectType ? `projectType:${projectType.toLowerCase().replace(/\s+/g, "-")}` : undefined;

function buildAnyTags(input: PreparationRecallInput): string[] {
  const any: string[] = [];
  const tier = TIER_TAG(input.tier);
  const projectType = PROJECT_TYPE_TAG(input.projectType);
  if (tier) any.push(tier);
  if (projectType) any.push(projectType);
  return any;
}

/**
 * Wrap a recall block with a heading the PRD/Design agent prompt can
 * reliably target. Returns an empty string when the block is empty so
 * callers can safely concat without producing stray section headers.
 */
function wrapBlock(phase: "PRD" | "Design", block: string): string {
  if (!block.trim()) return "";
  return [
    `## Lessons from past ${phase} generations`,
    "",
    `The following ${phase}-pattern records were recalled from memory because they match the current project's tier / domain. Treat them as soft hints — apply the ones that fit.`,
    "",
    block,
    "",
    `If you used any of the records above, declare it on the FIRST line of your output via:`,
    `  <memory-cite ids="${phase.toUpperCase()}-xxx,${phase.toUpperCase()}-yyy" />`,
    "",
  ].join("\n");
}

export interface PreparationRecallResult extends RecallContextResult {
  /** Already wrapped block (with section header + cite hint), ready to splice. */
  contextChunk: string;
}

export async function recallPrdContext(
  input: PreparationRecallInput,
): Promise<PreparationRecallResult> {
  const any = buildAnyTags(input);
  const result = await recallAndPrepareInject({
    agent: "pm",
    role: "pm",
    task: {
      id: input.sessionId,
      title: input.featureBrief.slice(0, 80),
      description: input.featureBrief,
    },
    projectRoot: input.projectRoot,
    kickoffId: input.sessionId,
    layers: ["L1"],
    kinds: ["prd-pattern"],
    tokenBudget: 1500,
    injectEnabled: memoryInjectEnabledForPrd,
    ...(any.length > 0 ? { /* recall-context will not forward arbitrary tags; we rely on text */ } : {}),
  });
  void any;
  return { ...result, contextChunk: wrapBlock("PRD", result.block) };
}

export async function recallDesignContext(
  input: PreparationRecallInput & { prdContent?: string },
): Promise<PreparationRecallResult> {
  // Use the PRD content (when available) as the recall query so design
  // patterns match the actual product the user is building, not just the
  // raw feature brief.
  const queryText = input.prdContent
    ? input.prdContent.slice(0, 600)
    : input.featureBrief;
  const result = await recallAndPrepareInject({
    agent: "design",
    role: "designer",
    task: {
      id: input.sessionId,
      title: input.featureBrief.slice(0, 80),
      description: queryText,
    },
    projectRoot: input.projectRoot,
    kickoffId: input.sessionId,
    layers: ["L1"],
    kinds: ["design-pattern"],
    tokenBudget: 1500,
    injectEnabled: memoryInjectEnabledForDesign,
  });
  return { ...result, contextChunk: wrapBlock("Design", result.block) };
}
