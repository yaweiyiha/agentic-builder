import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";

/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  AUTH GATE SWITCH                                               │
 * │  Set AUTH_ENABLED = true to activate token validation.         │
 * │  When false, all requests pass through without any auth check. │
 * └─────────────────────────────────────────────────────────────────┘
 */
const AUTH_ENABLED = false;

/** Routes that are always public (never redirected to /login) */
const PUBLIC_PATHS = ["/login", "/api/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  // ── Auth gate is disabled ─────────────────────────────────────────
  if (!AUTH_ENABLED) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Always allow public paths
  if (isPublicPath(pathname)) return NextResponse.next();

  // Check token
  const token = req.cookies.get(COOKIE_NAME)?.value ?? null;

  if (!token) {
    // No token → redirect to login
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const payload = await verifyToken(token);

  if (!payload) {
    // Invalid / expired token → redirect to login and clear cookie
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(COOKIE_NAME);
    return res;
  }

  // Token valid → continue
  return NextResponse.next();
}

export const config = {
  // Match all routes except Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
