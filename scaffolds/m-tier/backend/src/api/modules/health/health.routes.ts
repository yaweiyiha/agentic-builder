import Router from '@koa/router';
import { getHealth } from './health.controller';

export function registerHealthRoutes(apiRouter: Router): void {
  const router = new Router();

  router.get('/health', getHealth);
  apiRouter.use(router.routes(), router.allowedMethods());
}
