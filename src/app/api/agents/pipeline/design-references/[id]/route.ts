import { NextRequest, NextResponse } from "next/server";
import {
  deleteDesignReference,
  updateDesignReference,
} from "@/lib/pipeline/design-references";

export const runtime = "nodejs";

function projectRoot() {
  return process.cwd();
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  let body: { label?: string; pageHint?: string } = {};
  try {
    body = (await request.json()) as { label?: string; pageHint?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { label?, pageHint? }." },
      { status: 400 },
    );
  }
  const updated = await updateDesignReference(projectRoot(), id, body);
  if (!updated) {
    return NextResponse.json(
      { error: `No reference found with id "${id}".` },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, reference: updated });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const references = await deleteDesignReference(projectRoot(), id);
  return NextResponse.json({ ok: true, references });
}
