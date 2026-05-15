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
  "https://contribution.usercontent.google.com",
  "https://lh3.googleusercontent.com",
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
      headers: { Accept: "text/html,text/plain,*/*" },
      // Signed URLs (GCS / usercontent.google.com) are self-authenticating.
      // Do NOT pass an Authorization header — it causes 400/empty responses.
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `Upstream ${upstream.status}: ${text.slice(0, 200)}` },
        { status: upstream.status },
      );
    }

    const html = await upstream.text();

    // Reject non-HTML content (e.g. Stitch sometimes stores the input PRD
    // markdown as the htmlCode for older generations).
    const looksLikeHtml = /^\s*(<(!DOCTYPE|html|head|body|div|<!--))/i.test(html);
    if (!looksLikeHtml) {
      return NextResponse.json(
        { error: "upstream content is not HTML" },
        { status: 422 },
      );
    }

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
