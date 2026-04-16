import { NextRequest } from "next/server";
import {
  normalizeProjectTier,
  type ProjectTier,
} from "@/lib/agents/project-classifier";
import type { PrdSpec } from "@/lib/requirements/prd-spec-types";
import { buildTaskBreakdownFromDocuments } from "@/lib/pipeline/kickoff-task-breakdown.server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    prd,
    trd,
    sysdesign,
    implguide,
    design,
    prdSpec,
    sessionId,
    tier,
    improvementNotes,
  } = body as {
    prd?: string;
    trd?: string;
    sysdesign?: string;
    implguide?: string;
    design?: string;
    prdSpec?: PrdSpec | null;
    sessionId?: string;
    tier?: string;
    improvementNotes?: string[];
  };

  if (!prd || !prd.trim()) {
    return Response.json(
      { error: "PRD content is required for task breakdown" },
      { status: 400 },
    );
  }

  const result = await buildTaskBreakdownFromDocuments({
    prd,
    trd: trd || undefined,
    sysDesign: sysdesign || undefined,
    implGuide: implguide || undefined,
    designSpec: design || undefined,
    prdSpec: prdSpec ?? null,
    sessionId,
    tier: normalizeProjectTier(
      ((tier ?? "M").toUpperCase() as ProjectTier) ?? "M",
    ),
    improvementNotes: Array.isArray(improvementNotes)
      ? improvementNotes.filter((n) => typeof n === "string" && n.trim().length > 0)
      : undefined,
  });

  return Response.json({
    ok: true,
    taskBreakdown: result.tasks,
    taskBreakdownParseFailed: result.parseFailed,
    taskBreakdownParseError: result.parseError,
    taskBreakdownRawOutput: result.rawOutput,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    model: result.model,
  });
}
