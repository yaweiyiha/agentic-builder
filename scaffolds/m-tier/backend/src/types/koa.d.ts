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
    /** User payload populated by `authMiddleware` after JWT verification. */
    user?: { id: string; email?: string; [key: string]: unknown };
  }
}

// Re-export to make this file a module so the `declare module` is treated as
// an augmentation rather than a global script.
export type ParsedQuery = ParsedUrlQuery;
