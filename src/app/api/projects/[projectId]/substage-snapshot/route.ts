/**
 * GET  /api/projects/[projectId]/substage-snapshot?stage=X&subStage=Y
 *        — fetch the saved snapshot for a specific (stage, sub-stage) pair.
 *        Omit query params to return the snapshot for the currently-active
 *        stage+sub-stage (derived from project_stage_state).
 *
 * PUT  /api/projects/[projectId]/substage-snapshot
 *        — persist a full pipeline snapshot for the given (stage, sub-stage).
 *        Body: { stageId, subStageId, snapshot: SubStageSnapshot }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getSubStageSnapshot,
  upsertSubStageSnapshot,
  type SubStageSnapshot,
} from "@/lib/project-store";

/** Substage order — mirrors stage-store, used for fallback walk. */
const SUB_STAGE_ORDER: Record<string, string[]> = {
  preparation: ["initial", "intent", "prd", "trd", "sysdesign", "implguide", "design", "pencil", "mockup", "qa"],
  kickoff:     ["env-setup", "task-breakdown"],
  coding:      ["architect", "backend", "frontend", "test", "verify"],
  preview:     ["serve", "e2e"],
};

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const url = new URL(req.url);
    const stage    = url.searchParams.get("stage");
    const subStage = url.searchParams.get("subStage");

    if (stage && subStage) {
      // Try exact match first.
      const snapshot = await getSubStageSnapshot(projectId, stage, subStage);
      if (snapshot) return NextResponse.json({ stageId: stage, subStageId: subStage, snapshot });

      // No exact snapshot — walk backwards to find the nearest available one.
      const order = SUB_STAGE_ORDER[stage] ?? [];
      const idx   = order.indexOf(subStage);
      for (let i = idx - 1; i >= 0; i--) {
        const prev = await getSubStageSnapshot(projectId, stage, order[i]);
        if (prev) return NextResponse.json({ stageId: stage, subStageId: subStage, snapshot: prev });
      }

      return NextResponse.json({ stageId: stage, subStageId: subStage, snapshot: null });
    }

    // No params — require stage and subStage query params
    return NextResponse.json(
      { error: "Missing required query params: stage, subStage" },
      { status: 400 },
    );
  } catch (err) {
    console.error("[api/substage-snapshot] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const body = (await req.json()) as {
      stageId:    string;
      subStageId: string;
      snapshot:   SubStageSnapshot;
    };

    if (!body.stageId || !body.subStageId || !body.snapshot) {
      return NextResponse.json(
        { error: "Missing required fields: stageId, subStageId, snapshot." },
        { status: 400 },
      );
    }

    await upsertSubStageSnapshot(projectId, body.stageId, body.subStageId, body.snapshot);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/substage-snapshot] PUT error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
