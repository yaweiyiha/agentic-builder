import Router from "@koa/router";

/**
 * Default auth routes (email + password, JWT-based).
 *
 * The base scaffold registers a stub for `/auth/me` so every project has a
 * predictable shape regardless of whether an OAuth provider is wired in.
 *
 * Workers are expected to:
 *   - implement POST /auth/register, POST /auth/login that hash-and-verify
 *     passwords (e.g. bcrypt) and return a signed JWT;
 *   - replace this file's contents with the real flow when the PRD asks for
 *     email+password auth.
 *
 * If the project applies `_optional/auth-privy`, this file is overwritten
 * with the Privy-based variant (`requirePrivyAuth`).
 */
export function registerAuthRoutes(router: Router): void {
  router.get("/auth/me", async (ctx) => {
    if (!ctx.state.user) {
      ctx.throw(401, "Not authenticated");
    }
    ctx.body = { user: ctx.state.user };
  });
}
