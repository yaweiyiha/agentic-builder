import Router from "@koa/router";
import {
  requirePrivyAuth,
  requirePrivyAuthMiddleware,
  resolveOrCreateDbUser,
} from "../../../middlewares/privyAuth";
import { User } from "../../../models";

/**
 * Default auth routes provided by the `auth-privy` optional scaffold.
 *
 * - `GET  /auth/me`      — return verified Privy claims (debug / mobile).
 * - `POST /auth/verify`  — upsert the DB user row for the current Privy
 *                           session and return `{ user, is_new_user }`.
 *                           The frontend MUST call this exactly once after
 *                           the OAuth flow completes so that subsequent
 *                           authenticated routes have a corresponding DB
 *                           row to read against.
 *
 * Workers may add additional routes (logout, refresh, link providers, …)
 * but MUST NOT remove the two above — the rest of the scaffold (and the
 * generated frontend) assumes they exist.
 */
export function registerAuthRoutes(router: Router): void {
  router.get("/auth/me", requirePrivyAuthMiddleware, async (ctx) => {
    const claims = requirePrivyAuth(ctx);
    ctx.body = {
      user: ctx.state.user,
      privy: claims,
    };
  });

  router.post("/auth/verify", requirePrivyAuthMiddleware, async (ctx) => {
    const privyId = ctx.state.user!.id;
    const before = await User.findOne({ where: { privy_id: privyId } });
    const user = await resolveOrCreateDbUser(ctx);
    ctx.body = {
      user: {
        id: user.id,
        privy_id: user.privy_id,
      },
      is_new_user: !before,
    };
    ctx.type = "application/json";
  });
}
