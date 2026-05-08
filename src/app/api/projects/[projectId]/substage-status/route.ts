/**
 * GET  /api/projects/[projectId]/substage-status
 *        — list all substage statuses for a project.
 *        Optional query params: ?stage=X&subStage=Y to fetch a single status.
 *
 * PUT  /api/projects/[projectId]/substage-status
 *        — upsert the status for a specific (stage, sub-stage).
 *        Body: { stageId, subStageId, status, contextRefs?, stepIds? }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  upsertSubStageStatus,
  getSubStageStatus,
  listSubStageStatuses,
  type SubStageStatusValue,
} from "@/lib/project-store";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const url       = new URL(req.url);
    const stage    = url.searchParams.get("stage");
    const subStage = url.searchParams.get("subStage");

    if (stage && subStage) {
      const status = await getSubStageStatus(projectId, stage, subStage);
      return NextResponse.json({ stageId: stage, subStageId: subStage, status });
    }

    const statuses = await listSubStageStatuses(projectId);
    return NextResponse.json({ statuses });
  } catch (err) {
    console.error("[api/substage-status] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const body = (await req.json()) as {
      stageId:      string;
      subStageId:   string;
      status:       SubStageStatusValue;
      contextRefs?: Record<string, unknown>;
      stepIds?:     string[];
    };

    if (!body.stageId || !body.subStageId || !body.status) {
      return NextResponse.json(
        { error: "Missing required fields: stageId, subStageId, status." },
        { status: 400 },
      );
    }

    await upsertSubStageStatus(projectId, body.stageId, body.subStageId, body.status, {
      contextRefs: body.contextRefs,
      stepIds:     body.stepIds,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/substage-status] PUT error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
