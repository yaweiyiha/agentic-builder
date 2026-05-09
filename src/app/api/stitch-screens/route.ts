/**
 * GET /api/stitch-screens?projectId=...
 *
 * Returns all screen screenshot URLs for a Stitch project using the REST API.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStitchProjectScreenshots } from "@/lib/stitch-api";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const screenshots = await fetchStitchProjectScreenshots(projectId);
    return NextResponse.json({ screenshots });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stitch-screens] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
