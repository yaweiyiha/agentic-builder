// Global module augmentation for koa.
//
// koa-bodyparser attaches the parsed body to `ctx.request.body`, but the
// upstream `koa` types do not declare it. Generators that hand-write
// `(ctx.request as any).body` introduce ambient `any` and break type
// inference downstream. Declaring this augmentation once at scaffold time
// means controllers can write `ctx.request.body` and get a known type
// without per-file casts.

import type { ParsedUrlQuery } from "node:querystring";

declare module "koa" {
  interface Request {
    /**
     * Parsed JSON / form / text body from `koa-bodyparser`. The shape is
     * `unknown` on purpose so handlers must validate (e.g. with Joi) before
     * use, instead of consuming an implicit `any`.
     */
    body?: unknown;
    /** Raw stringified body, present when `enableTypes` includes the matching type. */
    rawBody?: string;
  }

  interface DefaultState {
    /**
     * Normalized user identity attached by whichever auth middleware is
     * registered (email+password JWT in the base scaffold, Privy / Clerk
     * via `_optional/auth-*` modules). For OAuth providers, `id` is the
     * EXTERNAL user id (Privy DID, Clerk userId, etc.) — controllers
     * MUST resolve to a DB row via the `<provider>_id` column before
     * using it as an FK (see CODEGEN_HARDENING_PLAN.md §4.3).
     */
    user?: { id: string; email?: string; [key: string]: unknown };
    /**
     * Provider-specific token claims for the request, when an OAuth
     * middleware is wired in. Type narrowed by feature-specific helpers:
     * Privy → `PrivyVerifiedClaims`, Clerk → `ClerkClaims`, etc.
     */
    privy?: unknown;
    clerk?: unknown;
  }
}

// Re-export to make this file a module so the `declare module` is treated as
// an augmentation rather than a global script.
export type ParsedQuery = ParsedUrlQuery;
