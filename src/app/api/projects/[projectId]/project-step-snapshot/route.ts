/**
 * GET  /api/projects/[projectId]/project-step-snapshot
 *        — no params:  returns ALL step snapshots for this project as { stepId: snapshot, ... }
 *        ?stepId=trd:  returns single snapshot for that step
 *
 * PUT  /api/projects/[projectId]/project-step-snapshot
 *        — persist a snapshot for a specific step.
 *        Body: { stepId, snapshot }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getStepSnapshot,
  getAllStepSnapshots,
  upsertStepSnapshot,
  type StepSnapshot,
} from "@/lib/project-store";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const url = new URL(req.url);
    const stepId = url.searchParams.get("stepId");

    // No stepId → return ALL snapshots as { stepId: snapshot, ... }
    if (!stepId) {
      const all = await getAllStepSnapshots(projectId);
      return NextResponse.json({ snapshots: all });
    }

    const snapshot = await getStepSnapshot(projectId, stepId);
    return NextResponse.json({ stepId, snapshot });
  } catch (err) {
    console.error("[api/substage-snapshot] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const body = (await req.json()) as {
      stepId:   string;
      snapshot: StepSnapshot;
    };

    if (!body.stepId || !body.snapshot) {
      return NextResponse.json(
        { error: "Missing required fields: stepId, snapshot." },
        { status: 400 },
      );
    }

    await upsertStepSnapshot(projectId, body.stepId, body.snapshot);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/substage-snapshot] PUT error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
