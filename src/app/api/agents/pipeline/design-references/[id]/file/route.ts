import { NextRequest, NextResponse } from "next/server";
import { readDesignReferenceFile } from "@/lib/pipeline/design-references";

export const runtime = "nodejs";

function projectRoot() {
  return process.cwd();
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const result = await readDesignReferenceFile(projectRoot(), id);
  if (!result) {
    return NextResponse.json(
      { error: `No reference found with id "${id}".` },
      { status: 404 },
    );
  }
  return new NextResponse(new Uint8Array(result.data), {
    status: 200,
    headers: {
      "Content-Type": result.entry.mime,
      "Content-Length": String(result.entry.bytes),
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${encodeURIComponent(result.entry.fileName)}"`,
    },
  });
}
