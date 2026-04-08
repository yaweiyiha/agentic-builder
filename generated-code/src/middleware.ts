import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default withAuth(
  // This `middleware` function is executed only if the `authorized` callback returns `true`.
  // At this point, the user is already considered authorized for the given path.
  function middleware(req: NextRequest & { nextauth: { token: any } }) {
    // You can access the authenticated user's token here if needed for further logic,
    // such as logging, adding custom headers, or performing additional checks.
    // console.log("Middleware function executed for:", req.nextUrl.pathname);
    // console.log("Authenticated token:", req.nextauth.token);

    // For API routes, you might want to add specific headers or logging.
    // For example:
    // if (req.nextUrl.pathname.startsWith("/api/")) {
    //   const response = NextResponse.next();
    //   response.headers.set("X-Authenticated-User-ID", req.nextauth.token?.sub || "unknown");
    //   return response;
    // }

    return NextResponse.next();
  },
  {
    callbacks: {
      // The `authorized` callback determines if a user is allowed to access a path.
      // If it returns `false`:
      // - For a *page* request, NextAuth.js will redirect to the `pages.signIn` URL.
      // - For an *API* request, NextAuth.js will return a `401 Unauthorized` response.
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;

        // 1. Allow all NextAuth.js API routes (e.g., /api/auth/signin, /api/auth/callback)
        // These routes are essential for the authentication flow itself and should not require a token.
        if (pathname.startsWith("/api/auth")) {
          return true;
        }

        // 2. Allow public health check API route without authentication.
        if (pathname === "/api/health") {
          return true;
        }

        // 3. Require authentication for specific protected API routes.
        // These are the core API endpoints that manage user-specific data.
        if (pathname.startsWith("/api/member") || pathname.startsWith("/api/claims")) {
          return !!token; // User must have a valid token to access these.
        }

        // 4. For all other routes included in the `matcher` (e.g., frontend pages like /timer, /settings, /statistics),
        // require a token. If no token, NextAuth.js will handle the redirect/401.
        // If you only want to protect API routes, you might adjust the matcher and this logic.
        // Based on the PRD, frontend pages like /timer, /settings, /statistics also require authentication.
        return !!token;
      },
    },
    // Specify the URL for the login page.
    // NextAuth.js will redirect unauthenticated users to this page if they try to access a protected *page* route.
    pages: {
      signIn: "/login",
    },
  }
);

// Configure the `matcher` to specify which paths the middleware should run on.
// It's crucial to include all paths that need to be protected or explicitly allowed
// (like /api/health and /api/auth) in this array.
export const config = {
  matcher: [
    "/api/member/:path*", // Protect all routes under /api/member
    "/api/claims/:path*", // Protect all routes under /api/claims
    "/api/health",        // Include health check to allow it through the middleware
    "/api/auth/:path*",   // Essential for NextAuth.js authentication flow
    // Add any frontend pages that require authentication here.
    // Example:
    "/timer",
    "/settings",
    "/statistics",
  ],
};
