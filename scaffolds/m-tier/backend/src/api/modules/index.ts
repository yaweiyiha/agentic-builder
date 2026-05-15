import Router from "@koa/router";
import { registerHealthRoutes } from "./health/health.routes";
import { registerAuthRoutes } from "./auth/auth.routes";

export function createApiRouter(): Router {
  const apiRouter = new Router({ prefix: "/api" });

  registerHealthRoutes(apiRouter);
  registerAuthRoutes(apiRouter);

  return apiRouter;
}
