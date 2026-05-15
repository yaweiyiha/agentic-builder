/**
 * GET /api/stitch-html?projectId=...&screenId=...
 *
 * Server-side route that fetches the exported HTML for a Stitch screen
 * using our existing auth credentials (refresh token flow), then returns
 * the raw HTML so the frontend can inject it into an iframe via `srcdoc`.
 *
 * This is the fallback path when `htmlDownloadUrl` is null in the initial
 * generate response.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStitchScreenHtml } from "@/lib/stitch-api";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const screenId = request.nextUrl.searchParams.get("screenId");

  if (!projectId || !screenId) {
    return NextResponse.json(
      { error: "projectId and screenId are required" },
      { status: 400 },
    );
  }

  try {
    const html = await fetchStitchScreenHtml(projectId, screenId);
    if (!html) {
      return NextResponse.json(
        { error: "No HTML export available for this screen" },
        { status: 404 },
      );
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stitch-html] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
