import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const DESIGN_DIR = path.join(process.cwd(), "public", "design");

async function ensureDesignDir() {
  await fs.mkdir(DESIGN_DIR, { recursive: true });
}

async function listDesignFiles(): Promise<string[]> {
  await ensureDesignDir();
  const entries = await fs.readdir(DESIGN_DIR);
  return entries
    .filter(
      (f) =>
        f.endsWith(".pen") ||
        f.endsWith(".png") ||
        f.endsWith(".webp") ||
        f.endsWith(".jpg") ||
        f.endsWith(".jpeg") ||
        f.endsWith(".pdf"),
    )
    .sort();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body as { action: "list" | "ensure-dir" };

    if (action === "ensure-dir") {
      await ensureDesignDir();
      return NextResponse.json({ ok: true, designDir: DESIGN_DIR });
    }

    if (action === "list") {
      const files = await listDesignFiles();
      return NextResponse.json({ ok: true, files, designDir: DESIGN_DIR });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pencil operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
