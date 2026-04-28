import { NextRequest } from "next/server";

import { getSystemMemory } from "@/lib/memory";

export const maxDuration = 30;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    const r = await getSystemMemory().get(id);
    if (!r) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ record: r }, { status: 200 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  let body: { body?: string; tags?: string[]; score?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const store = getSystemMemory();
    const existing = await store.get(id);
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });

    const patch: { body?: string; tags?: string[]; metrics?: { score?: number } } = {};
    if (typeof body.body === "string") patch.body = body.body;
    if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t) => typeof t === "string");
    if (typeof body.score === "number") {
      if (body.score < -1 || body.score > 1) {
        return Response.json(
          { error: "score must be in [-1, 1]" },
          { status: 400 },
        );
      }
      patch.metrics = { score: body.score };
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ record: existing }, { status: 200 });
    }

    const updated = await store.update(id, patch);
    return Response.json({ record: updated }, { status: 200 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  try {
    const store = getSystemMemory();
    const existing = await store.get(id);
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    await store.delete(id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
