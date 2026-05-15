/**
 * GET  /api/projects/[projectId]/step-navigation  — get current active step for a project
 * PUT  /api/projects/[projectId]/step-navigation  — update active step
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { projectStepNavigation } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { projectId } = await ctx.params;

    const [row] = await db
      .select()
      .from(projectStepNavigation)
      .where(eq(projectStepNavigation.projectId, projectId))
      .orderBy(desc(projectStepNavigation.updatedAt))
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
    const activeStep = body.activeStep ?? "initial";
    const tier = body.tier ?? "M";
    const updatedAt = new Date();

    // Compatibility path:
    // some environments may miss/lose a unique constraint for project_id,
    // so relying purely on ON CONFLICT can fail at runtime.
    const updated = await db
      .update(projectStepNavigation)
      .set({
        activeStep,
        tier,
        updatedAt,
      })
      .where(eq(projectStepNavigation.projectId, projectId))
      .returning({ projectId: projectStepNavigation.projectId });

    if (updated.length === 0) {
      await db.insert(projectStepNavigation).values({
        projectId,
        activeStep,
        tier,
        updatedAt,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[step-navigation] PUT error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
