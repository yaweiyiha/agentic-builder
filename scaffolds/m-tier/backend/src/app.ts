import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { createApiRouter } from "./api/modules";
import { corsMiddleware } from "./middlewares/cors";
import { errorHandlerMiddleware } from "./middlewares/errorHandler";

export function createApp(): Koa {
  const app = new Koa();
  const apiRouter = createApiRouter();

  app.use(errorHandlerMiddleware);
  app.use(corsMiddleware);
  app.use(bodyParser());
  app.use(apiRouter.routes()).use(apiRouter.allowedMethods());

  return app;
}
