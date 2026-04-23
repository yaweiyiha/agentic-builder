import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

// Canonical JWT helpers for the backend.
//
// LLM-generated code repeatedly trips over `jsonwebtoken`'s overload set —
// passing `expiresIn: "7d"` collides with the typed payload overload, and
// `jwt.sign(payload, secret as string)` triggers `Property 'sign' has no
// matching overload`. Centralising sign/verify here keeps the exact types
// in one place and lets feature code stay short.

export interface JwtPayload {
  sub: string;
  email?: string;
  [key: string]: unknown;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error("JWT_SECRET is required to sign or verify tokens");
  }
  return secret;
}

function getDefaultExpiresIn(): SignOptions["expiresIn"] {
  // Cast through `unknown` because the SignOptions type narrows the literal
  // `string` to a specific union; users can override via env without us
  // re-typing every accepted format.
  const raw = process.env.JWT_EXPIRES_IN ?? "7d";
  return raw as unknown as SignOptions["expiresIn"];
}

export function signJwt(
  payload: JwtPayload,
  options?: SignOptions,
): string {
  const opts: SignOptions = {
    expiresIn: getDefaultExpiresIn(),
    ...(options ?? {}),
  };
  return jwt.sign(payload as object, getSecret(), opts);
}

export function verifyJwt<T extends JwtPayload = JwtPayload>(token: string): T {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded === "string") {
    throw new Error("Invalid JWT payload: expected object, received string");
  }
  return decoded as T;
}
