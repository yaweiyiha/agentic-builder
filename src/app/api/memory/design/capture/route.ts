/**
 * POST /api/memory/design/capture
 *
 * Mirror of /api/memory/prd/capture, scoped to the `design-pattern` kind.
 * See prd/capture/route.ts for the design rationale.
 */

import { NextResponse } from "next/server";

import { getSystemMemory } from "@/lib/memory";
import { memoryEnabled } from "@/lib/memory/env";
import { summarizeDesignDiff } from "@/lib/memory/design-diff-summarize";
import { getTraceLogger } from "@/lib/memory/trace";
import { normalizeProjectTier, type ProjectTier } from "@/lib/agents/shared/project-classifier";

interface DesignCaptureRequest {
  sessionId: string;
  projectType?: string;
  tier?: string;
  originalDesign: string;
  finalDesign: string;
  source?: "human_approval" | "human_edit";
}

const MIN_DESIGN_CHARS = 500;
const SIGNIFICANT_DIFF_RATIO = 0.05;

function isSignificantEdit(orig: string, final: string): boolean {
  if (orig === final) return false;
  const lenDelta = Math.abs(orig.length - final.length);
  const minLen = Math.max(orig.length, 1);
  if (lenDelta / minLen >= SIGNIFICANT_DIFF_RATIO) return true;
  return lenDelta > 500;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!memoryEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "memory_disabled" });
  }

  let body: DesignCaptureRequest;
  try {
    body = (await req.json()) as DesignCaptureRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { sessionId, originalDesign, finalDesign } = body;
  const projectType = body.projectType?.trim() || "unknown";
  const tier: ProjectTier = normalizeProjectTier(body.tier);

  if (!sessionId || typeof finalDesign !== "string" || finalDesign.length < MIN_DESIGN_CHARS) {
    return NextResponse.json(
      { ok: false, error: "missing_or_too_short_design" },
      { status: 400 },
    );
  }

  const original = typeof originalDesign === "string" ? originalDesign : "";
  const sourceHint =
    body.source ?? (original === finalDesign ? "human_approval" : "human_edit");
  const tags = [
    `tier:${tier}`,
    `projectType:${projectType.toLowerCase().replace(/\s+/g, "-")}`,
    `phase:design`,
    `source:${sourceHint}`,
  ];

  try {
    const memory = getSystemMemory();

    if (!isSignificantEdit(original, finalDesign)) {
      // Capture the colour palette / typography decisions worth remembering.
      // For an HTML design spec we summarise by including the first 1KB of
      // body content (CSS tokens usually appear early).
      const record = await memory.save({
        layer: "L1",
        kind: "design-pattern",
        title: `${tier}-tier ${projectType} design accepted as-is`,
        body: [
          `Tier: ${tier}`,
          `Project type: ${projectType}`,
          ``,
          `The design spec generated for this ${projectType}-style ${tier}-tier project was accepted by the user without significant edits. Reuse the same palette, typography, and component patterns for similar projects.`,
          ``,
          `Reference excerpt (first 800 chars of accepted design HTML — typically contains the CSS token block):`,
          ``,
          finalDesign.slice(0, 800),
        ].join("\n"),
        tags: [...tags, "outcome:positive"],
        source: "orchestrator",
        refs: { kickoffId: sessionId },
        metrics: { score: 0.4 },
      });
      await emitPrepOutcome({
        sessionId,
        phase: "design",
        source: "human_approval",
        newRecordId: record.id,
        projectType,
        tier,
      });
      return NextResponse.json({ ok: true, recordId: record.id, outcome: "positive" });
    }

    const summary = await summarizeDesignDiff({
      tier,
      projectType,
      originalDesign: original,
      finalDesign,
    });

    const title =
      summary?.title ?? `${tier}-tier ${projectType} design needed user revision`;
    const patternBody = summary?.pattern
      ? summary.pattern
      : `The AI-generated design spec for this ${tier}-tier ${projectType} project required user edits. The next design agent should re-examine palette/typography choices for this domain.`;

    const record = await memory.save({
      layer: "L1",
      kind: "design-pattern",
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
      metrics: { score: 0.35 },
    });

    await emitPrepOutcome({
      sessionId,
      phase: "design",
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
    console.warn("[memory] design capture failed:", (err as Error).message);
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

/** Mirror of the helper in /api/memory/prd/capture — see there for docs. */
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
