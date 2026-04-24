import type { Middleware } from "koa";
import { getPrivyClient } from "../privy/client";

export interface PrivyVerifiedClaims {
  user_id: string;
  session_id: string;
  app_id: string;
  issuer: string;
  issued_at: number;
  expiration: number;
}

function getBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export const privyAuthMiddleware: Middleware = async (ctx, next) => {
  const token =
    getBearerToken(ctx.headers.authorization) ?? ctx.cookies.get("privy-token");
  if (!token) return next();

  try {
    const privy = getPrivyClient();
    // Privy recommends verifying access tokens on the backend using the server SDK.
    const claims = (await privy
      .utils()
      .auth()
      .verifyAccessToken(token)) as unknown as PrivyVerifiedClaims;

    ctx.state.user = { id: claims.user_id };
    ctx.state.privy = claims;
  } catch {
    // Leave ctx.state.user undefined; route handlers can enforce auth with `requirePrivyAuth`.
    ctx.state.user = undefined;
    ctx.state.privy = undefined;
  }

  return next();
};

export function requirePrivyAuth(
  ctx: Parameters<Middleware>[0],
): PrivyVerifiedClaims {
  if (!ctx.state.user || !ctx.state.privy) {
    ctx.throw(401, "Not authenticated");
  }
  return ctx.state.privy as PrivyVerifiedClaims;
}
