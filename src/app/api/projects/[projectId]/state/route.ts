/**
 * GET  /api/projects/[projectId]/state  — load pipeline + stage state for a project
 * PUT  /api/projects/[projectId]/state  — upsert pipeline + stage state
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getPipelineState,
  getStageState,
  upsertPipelineState,
  upsertStageState,
  updateProjectName,
  type PipelineStateRow,
  type StageStateRow,
} from "@/lib/project-store";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;

    const [pipelineState, stageState] = await Promise.all([
      getPipelineState(projectId),
      getStageState(projectId),
    ]);

    return NextResponse.json({ pipelineState, stageState });
  } catch (err) {
    console.error("[api/projects/[projectId]/state] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;

    const body = (await req.json()) as {
      pipelineState?: Partial<PipelineStateRow>;
      stageState?: Partial<StageStateRow>;
    };

    await Promise.all([
      body.pipelineState ? upsertPipelineState(projectId, body.pipelineState) : Promise.resolve(),
      body.stageState    ? upsertStageState(projectId, body.stageState)       : Promise.resolve(),
      body.stageState?.projectName ? updateProjectName(projectId, body.stageState.projectName) : Promise.resolve(),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/projects/[projectId]/state] PUT error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
