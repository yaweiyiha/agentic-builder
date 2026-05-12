/**
 * GET  /api/projects/[projectId]/step-artifacts?stepId=X  — get artifacts for a step
 * GET  /api/projects/[projectId]/step-artifacts            — get all artifacts for project
 * PUT  /api/projects/[projectId]/step-artifacts            — upsert a step artifact
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { projectStepArtifacts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const stepId = req.nextUrl.searchParams.get("stepId");

    if (stepId) {
      const rows = await db
        .select()
        .from(projectStepArtifacts)
        .where(
          and(
            eq(projectStepArtifacts.projectId, projectId),
            eq(projectStepArtifacts.stepId, stepId),
          ),
        );
      return NextResponse.json({ artifacts: rows });
    }

    const rows = await db
      .select()
      .from(projectStepArtifacts)
      .where(eq(projectStepArtifacts.projectId, projectId));

    return NextResponse.json({ artifacts: rows });
  } catch (err) {
    console.error("[step-artifacts] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const body = (await req.json()) as {
      stepId: string;
      runIndex?: string;
      status?: string;
      input?: Record<string, unknown>;
      output?: Record<string, unknown>;
      costUsd?: number;
      durationMs?: number;
      model?: string;
      traceId?: string;
      error?: string;
      startedAt?: string;
      completedAt?: string;
    };

    const runIndex = body.runIndex ?? "0";

    await db
      .insert(projectStepArtifacts)
      .values({
        projectId,
        stepId: body.stepId,
        runIndex,
        status: body.status ?? "idle",
        input: body.input ?? {},
        output: body.output ?? {},
        costUsd: body.costUsd ?? 0,
        durationMs: body.durationMs ?? 0,
        model: body.model ?? null,
        traceId: body.traceId ?? null,
        error: body.error ?? null,
        startedAt: body.startedAt ? new Date(body.startedAt) : null,
        completedAt: body.completedAt ? new Date(body.completedAt) : null,
      })
      .onConflictDoUpdate({
        target: [
          projectStepArtifacts.projectId,
          projectStepArtifacts.stepId,
          projectStepArtifacts.runIndex,
        ],
        set: {
          ...(body.status && { status: body.status }),
          ...(body.input && { input: body.input }),
          ...(body.output && { output: body.output }),
          ...(body.costUsd !== undefined && { costUsd: body.costUsd }),
          ...(body.durationMs !== undefined && { durationMs: body.durationMs }),
          ...(body.model && { model: body.model }),
          ...(body.traceId && { traceId: body.traceId }),
          ...(body.error !== undefined && { error: body.error }),
          ...(body.startedAt && { startedAt: new Date(body.startedAt) }),
          ...(body.completedAt && { completedAt: new Date(body.completedAt) }),
        },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[step-artifacts] PUT error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
