/**
 * GET /api/stitch-proxy?url=<encoded-url>
 *
 * Server-side proxy that fetches a Stitch HTML download URL (signed GCS URL)
 * and returns the raw HTML without X-Frame-Options / CSP frame restrictions,
 * so the frontend can inject it into an iframe via `srcdoc`.
 *
 * The `url` param must start with https://storage.googleapis.com or
 * https://stitch.googleapis.com to prevent open-redirect abuse.
 */

import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "https://storage.googleapis.com",
  "https://stitch.googleapis.com",
  "https://stitch.withgoogle.com",
];

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const allowed = ALLOWED_ORIGINS.some((o) => targetUrl.href.startsWith(o));
  if (!allowed) {
    return NextResponse.json({ error: "url not allowed" }, { status: 403 });
  }

  try {
    const upstream = await fetch(targetUrl.href, {
      headers: { Accept: "text/html,*/*" },
      // GCS signed URLs are self-authenticating — no auth header needed
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `Upstream ${upstream.status}: ${text.slice(0, 200)}` },
        { status: upstream.status },
      );
    }

    const html = await upstream.text();

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Explicitly allow framing by this origin
        "X-Frame-Options": "SAMEORIGIN",
        // Cache for 5 minutes (signed URLs are short-lived anyway)
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
