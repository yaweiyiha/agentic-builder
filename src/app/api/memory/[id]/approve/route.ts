import { NextRequest } from "next/server";

import { getSystemMemory } from "@/lib/memory";

export const maxDuration = 30;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  let body: { score?: number } = {};
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }
  const score = typeof body.score === "number" ? body.score : 0.5;
  if (score < -1 || score > 1) {
    return Response.json(
      { error: "score must be in [-1, 1]" },
      { status: 400 },
    );
  }
  try {
    const store = getSystemMemory();
    const existing = await store.get(id);
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    const tags = existing.tags.includes("manual:approved")
      ? existing.tags
      : [...existing.tags, "manual:approved"];
    const updated = await store.update(id, { tags, metrics: { score } });
    return Response.json({ record: updated }, { status: 200 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
