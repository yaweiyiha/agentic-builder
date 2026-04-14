import type Koa from "koa";

const CORS_OPTIONS = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposeHeaders: ['Content-Length', 'Date'],
  maxAge: 86400, // 24 hours
};

export const corsMiddleware: Koa.Middleware = async (ctx, next) => {
  // Set CORS headers
  ctx.set('Access-Control-Allow-Origin', CORS_OPTIONS.origin);
  ctx.set('Access-Control-Allow-Credentials', CORS_OPTIONS.credentials.toString());
  
  if (ctx.method === 'OPTIONS') {
    // Preflight request
    ctx.set('Access-Control-Allow-Methods', CORS_OPTIONS.allowMethods.join(', '));
    ctx.set('Access-Control-Allow-Headers', CORS_OPTIONS.allowHeaders.join(', '));
    ctx.set('Access-Control-Max-Age', CORS_OPTIONS.maxAge.toString());
    ctx.set('Access-Control-Expose-Headers', CORS_OPTIONS.exposeHeaders.join(', '));
    ctx.status = 204;
    return;
  }
  
  // For regular requests
  ctx.set('Access-Control-Expose-Headers', CORS_OPTIONS.exposeHeaders.join(', '));
  
  await next();
};
