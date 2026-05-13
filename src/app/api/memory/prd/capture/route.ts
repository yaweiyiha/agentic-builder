/**
 * POST /api/memory/prd/capture
 *
 * Persist a `prd-pattern` memory record after the user finalises the PRD
 * step in the preparation pipeline.
 *
 * Behaviour:
 *   - finalPrd === originalPrd  →  positive record ("template was accepted as-is")
 *   - otherwise                 →  negative record (LLM-summarised diff guidance)
 *
 * Failures are intentionally swallowed (logged + 200 with `skipped: true`)
 * because memory writes are non-critical and must never block the user
 * from advancing through the pipeline.
 */

import { NextResponse } from "next/server";

import { getSystemMemory } from "@/lib/memory";
import { memoryEnabled } from "@/lib/memory/env";
import { summarizePrdDiff } from "@/lib/memory/prd-diff-summarize";
import { getTraceLogger } from "@/lib/memory/trace";
import { normalizeProjectTier, type ProjectTier } from "@/lib/agents/shared/project-classifier";

interface PrdCaptureRequest {
  sessionId: string;
  projectType?: string;
  tier?: string;
  /** PRD initially produced by the LLM. */
  originalPrd: string;
  /** PRD after the user reviewed / edited / approved. */
  finalPrd: string;
  /** Hint about how this capture was triggered. */
  source?: "human_approval" | "human_edit";
}

const MIN_PRD_CHARS = 200;
const SIGNIFICANT_DIFF_RATIO = 0.05;

function isSignificantEdit(orig: string, final: string): boolean {
  if (orig === final) return false;
  const lenDelta = Math.abs(orig.length - final.length);
  const minLen = Math.max(orig.length, 1);
  if (lenDelta / minLen >= SIGNIFICANT_DIFF_RATIO) return true;
  // also count any change > 200 chars (covers paragraph rewrites)
  return lenDelta > 200;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!memoryEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "memory_disabled" });
  }

  let body: PrdCaptureRequest;
  try {
    body = (await req.json()) as PrdCaptureRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { sessionId, originalPrd, finalPrd } = body;
  const projectType = body.projectType?.trim() || "unknown";
  const tier: ProjectTier = normalizeProjectTier(body.tier);

  if (!sessionId || typeof finalPrd !== "string" || finalPrd.length < MIN_PRD_CHARS) {
    return NextResponse.json(
      { ok: false, error: "missing_or_too_short_prd" },
      { status: 400 },
    );
  }

  const original = typeof originalPrd === "string" ? originalPrd : "";
  const sourceHint =
    body.source ?? (original === finalPrd ? "human_approval" : "human_edit");
  const tags = [
    `tier:${tier}`,
    `projectType:${projectType.toLowerCase().replace(/\s+/g, "-")}`,
    `phase:prd`,
    `source:${sourceHint}`,
  ];

  try {
    const memory = getSystemMemory();

    // ── Positive path: PRD template was accepted with no / trivial edits ──
    if (!isSignificantEdit(original, finalPrd)) {
      const record = await memory.save({
        layer: "L1",
        kind: "prd-pattern",
        title: `${tier}-tier ${projectType} PRD template accepted as-is`,
        body: [
          `Tier: ${tier}`,
          `Project type: ${projectType}`,
          ``,
          `The PRD generated for this ${projectType}-style ${tier}-tier project was accepted by the user without significant edits. The same shape, sections, and level of detail appears to work well for this domain — keep using it.`,
          ``,
          `Reference excerpt (first 600 chars of accepted PRD):`,
          ``,
          finalPrd.slice(0, 600),
        ].join("\n"),
        tags: [...tags, "outcome:positive"],
        source: "orchestrator",
        refs: { kickoffId: sessionId },
        metrics: { score: 0.4 }, // start above active threshold so it can inject
      });
      await emitPrepOutcome({
        sessionId,
        phase: "prd",
        source: "human_approval",
        newRecordId: record.id,
        projectType,
        tier,
      });
      return NextResponse.json({ ok: true, recordId: record.id, outcome: "positive" });
    }

    // ── Negative path: user edited PRD; summarise the diff into guidance ──
    const summary = await summarizePrdDiff({
      tier,
      projectType,
      originalPrd: original,
      finalPrd,
    });

    const title =
      summary?.title ?? `${tier}-tier ${projectType} PRD needed user revision`;
    const patternBody = summary?.pattern
      ? summary.pattern
      : [
          `The AI-generated PRD for this ${tier}-tier ${projectType} project required user edits before approval.`,
          `Diff summary unavailable (LLM call failed). The next agent should pay extra attention to: typical ${projectType} domain features, edge-case handling, and explicit interaction definitions.`,
        ].join(" ");

    const record = await memory.save({
      layer: "L1",
      kind: "prd-pattern",
      title,
      body: [
        `Tier: ${tier}`,
        `Project type: ${projectType}`,
        `Summarised by: ${summary?.modelUsed ?? "(no llm summary)"}`,
        ``,
        `## Pattern`,
        ``,
        patternBody,
      ].join("\n"),
      tags: [...tags, "outcome:negative"],
      source: "self-heal",
      refs: { kickoffId: sessionId },
      metrics: { score: 0.35 }, // active by default; demoted by attribution if irrelevant
    });

    await emitPrepOutcome({
      sessionId,
      phase: "prd",
      source: "human_edit",
      newRecordId: record.id,
      projectType,
      tier,
    });

    return NextResponse.json({
      ok: true,
      recordId: record.id,
      outcome: "negative",
      summarised: !!summary,
    });
  } catch (err) {
    console.warn("[memory] prd capture failed:", (err as Error).message);
    return NextResponse.json(
      { ok: true, skipped: true, error: (err as Error).message },
      { status: 200 },
    );
  }
}

interface EmitPrepOutcomeArgs {
  sessionId: string;
  phase: "prd" | "design";
  source: "human_approval" | "human_edit";
  newRecordId: string;
  projectType: string;
  tier: string;
}

/**
 * Append a `prep-outcome` event to the L1 trace so the preparation-phase
 * attribution job can later credit / blame the patterns injected into this
 * session's PRD or Design agent. Failures are swallowed — observability
 * must never break the user-facing capture flow.
 */
async function emitPrepOutcome(args: EmitPrepOutcomeArgs): Promise<void> {
  try {
    await getTraceLogger(process.cwd()).log({
      op: "prep-outcome",
      layer: "L1",
      kickoffId: args.sessionId,
      agent: args.phase === "prd" ? "pm" : "design",
      details: {
        phase: args.phase,
        source: args.source,
        newRecordId: args.newRecordId,
        projectType: args.projectType,
        tier: args.tier,
      },
    });
  } catch {
    /* swallow */
  }
}
