/**
 * GET  /api/projects/[projectId]/step-navigation  — get current active step for a project
 * PUT  /api/projects/[projectId]/step-navigation  — update active step
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { projectStepNavigation } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;

    const [row] = await db
      .select()
      .from(projectStepNavigation)
      .where(eq(projectStepNavigation.projectId, projectId))
      .limit(1);

    if (!row) {
      return NextResponse.json({ activeStep: "initial", tier: "M" });
    }

    return NextResponse.json({ activeStep: row.activeStep, tier: row.tier });
  } catch (err) {
    console.error("[step-navigation] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;
    const body = (await req.json()) as { activeStep?: string; tier?: string };

    await db
      .insert(projectStepNavigation)
      .values({
        projectId,
        activeStep: body.activeStep ?? "initial",
        tier: body.tier ?? "M",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: projectStepNavigation.projectId,
        set: {
          ...(body.activeStep && { activeStep: body.activeStep }),
          ...(body.tier && { tier: body.tier }),
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[step-navigation] PUT error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
