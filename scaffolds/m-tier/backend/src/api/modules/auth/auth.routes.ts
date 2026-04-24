import Router from "@koa/router";
import { requirePrivyAuth } from "../../../middlewares/privyAuth";

export function registerAuthRoutes(router: Router): void {
  router.get("/auth/me", async (ctx) => {
    const claims = requirePrivyAuth(ctx);
    ctx.body = {
      user: ctx.state.user,
      privy: claims,
    };
  });
}

