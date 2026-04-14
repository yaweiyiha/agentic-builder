import Router from "@koa/router";
import { registerHealthRoutes } from "./health/health.routes";

export function createApiRouter(): Router {
  const apiRouter = new Router({ prefix: "/api" });

  registerHealthRoutes(apiRouter);

  return apiRouter;
}
