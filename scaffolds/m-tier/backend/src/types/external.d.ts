declare module 'koa-bodyparser' {
  import type { Middleware } from 'koa';

  function bodyParser(): Middleware;

  export = bodyParser;
}

declare module 'koa-jwt' {
  import type { Middleware } from 'koa';

  interface UnlessOptions {
    path?: Array<string | RegExp>;
  }

  interface KoaJwtOptions {
    secret: string;
    passthrough?: boolean;
  }

  interface JwtMiddleware extends Middleware {
    unless(options: UnlessOptions): Middleware;
  }

  function koaJwt(options: KoaJwtOptions): JwtMiddleware;

  export = koaJwt;
}
