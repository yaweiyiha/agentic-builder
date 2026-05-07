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
  const isHtml = result.entry.kind === "html";
  // HTML must declare charset explicitly so the browser doesn't fall back
  // to latin-1 when the file omits a `<meta charset>`. The reference is
  // shown inside a sandboxed iframe (no allow-same-origin) so it can't
  // touch the outer app even if it ships scripts.
  const contentType = isHtml
    ? "text/html; charset=utf-8"
    : result.entry.mime;
  return new NextResponse(new Uint8Array(result.data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(result.entry.bytes),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${encodeURIComponent(result.entry.fileName)}"`,
    },
  });
}
