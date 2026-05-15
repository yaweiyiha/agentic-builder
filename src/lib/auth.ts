/**
 * Auth utilities — lightweight token helpers.
 * Uses a simple HMAC-SHA256 signed token (no extra dependencies).
 * Token format: base64url(payload).base64url(signature)
 */

const SECRET = process.env.AUTH_SECRET ?? "agentic-builder-dev-secret";
const COOKIE_NAME = "auth_token";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function uint8ToBase64Url(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

function base64UrlToUint8(str: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(str, "base64url");
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TokenPayload {
  sub: string; // user id / email
  iat: number; // issued at (ms)
  exp: number; // expiry   (ms)
}

/** Create a signed token for the given subject (email / user-id). */
export async function signToken(subject: string): Promise<string> {
  const payload: TokenPayload = {
    sub: subject,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  };

  const payloadB64 = uint8ToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  const key = await getKey(SECRET);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );

  return `${payloadB64}.${uint8ToBase64Url(new Uint8Array(sig))}`;
}

/** Verify a token. Returns the payload or null if invalid/expired. */
export async function verifyToken(
  token: string,
): Promise<TokenPayload | null> {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;

    const key = await getKey(SECRET);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToUint8(sigB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!valid) return null;

    const payload: TokenPayload = JSON.parse(
      new TextDecoder().decode(base64UrlToUint8(payloadB64)),
    );

    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
