/**
 * Baseline endpoints — implicit infrastructure that every PRD assumes
 * exists but rarely spells out.
 *
 * The API-contract generator is intentionally conservative ("when in
 * doubt, OMIT") so it doesn't enumerate speculative CRUD. The downside:
 * `POST /auth/login` and other implicit baselines also get dropped
 * because the PRD doesn't literally say "expose a login endpoint" —
 * users assume an authenticated SaaS app has login the way they assume
 * it has TCP/IP.
 *
 * This module backfills them as a deterministic post-processing step:
 * after the LLM emits its contracts, we look at what kind of auth /
 * health surface the project needs and merge in the missing pieces.
 *
 * Detection is conservative — we only inject auth baselines when the
 * project actually has an `auth` service (LLM-emitted contracts mention
 * it, or scaffold ships `/auth/me`). Tier-S read-only apps without auth
 * see no injection.
 */

/** Loose shape matching the post-LLM parsed contract entries in
 *  supervisor.ts. Fields use string literals where the supervisor's
 *  downstream `normalisedAudience` / method-upcase logic handles the
 *  validation, so we don't impose stricter types here. */
export interface ApiContractEntry {
  service: string;
  endpoint: string;
  method: string;
  requestSchema?: string;
  responseSchema?: string;
  auth?: string;
  description?: string;
  prdJustification?: string;
  audience?: string;
  id?: string;
}

export interface BaselineInjectionInput {
  /** Contracts the LLM already emitted (parsed + validated upstream). */
  contracts: ApiContractEntry[];
  /** Set when the scaffold's auth.routes.ts (or any worker-written auth
   *  route) is present on disk. We pass this in rather than re-detect
   *  because the supervisor already reads the scaffold tree. */
  hasAuthRoutes: boolean;
}

export interface BaselineInjectionResult {
  contracts: ApiContractEntry[];
  added: string[];
  skipped: { id: string; reason: string }[];
}

const BASELINE_JUSTIFICATION_AUTH =
  "BASELINE — implicit infrastructure for any authenticated backend " +
  "(login/refresh/logout/me). Not enumerated in PRD prose but required " +
  "for every user flow that hits a bearer-guarded route.";

const BASELINE_JUSTIFICATION_HEALTH =
  "BASELINE — health probe required by Playwright webServer config and " +
  "every deployment liveness check. Scaffold ships the route.";

const BASELINE_AUTH_TEMPLATES: Array<
  Omit<ApiContractEntry, "endpoint"> & {
    /** Path WITHOUT the project prefix — we re-prefix at inject time. */
    pathSuffix: string;
  }
> = [
  {
    service: "auth",
    pathSuffix: "/auth/login",
    method: "POST",
    requestSchema: "{ email: string; password: string }",
    responseSchema:
      "{ accessToken: string; refreshToken: string; user: { id: string; email: string; role: string } }",
    auth: "none",
    description: "Sign in with email + password. Returns access + refresh tokens.",
    prdJustification: BASELINE_JUSTIFICATION_AUTH,
    audience: "user",
  },
  {
    service: "auth",
    pathSuffix: "/auth/logout",
    method: "POST",
    requestSchema: "none",
    responseSchema: "{ ok: true }",
    auth: "bearer",
    description: "Revoke the current refresh token and invalidate the session.",
    prdJustification: BASELINE_JUSTIFICATION_AUTH,
    audience: "user",
  },
  {
    service: "auth",
    pathSuffix: "/auth/me",
    method: "GET",
    requestSchema: "none",
    responseSchema: "{ user: { id: string; email: string; role: string } }",
    auth: "bearer",
    description: "Return the current user from the bearer token.",
    prdJustification: BASELINE_JUSTIFICATION_AUTH,
    audience: "user",
  },
  {
    service: "auth",
    pathSuffix: "/auth/refresh",
    method: "POST",
    requestSchema: "{ refreshToken: string }",
    responseSchema: "{ accessToken: string; refreshToken: string }",
    auth: "none",
    description: "Exchange a refresh token for a new access token.",
    prdJustification: BASELINE_JUSTIFICATION_AUTH,
    audience: "user",
  },
];

const BASELINE_HEALTH_TEMPLATE: Omit<ApiContractEntry, "endpoint"> & {
  pathSuffix: string;
} = {
  service: "health",
  pathSuffix: "/health",
  method: "GET",
  requestSchema: "none",
  responseSchema: "{ status: \"ok\"; uptimeSec: number }",
  auth: "none",
  description: "Liveness probe. Used by Playwright webServer and ops monitors.",
  prdJustification: BASELINE_JUSTIFICATION_HEALTH,
  audience: "admin",
};

/**
 * Infer the route prefix used by the existing contracts (e.g. `/api`,
 * `/api/v1`). Falls back to `/api` when contracts are empty.
 *
 * The strategy: take the longest common path prefix across at least 60%
 * of contracts, normalised down to a non-empty leading segment. We need
 * this because the baseline endpoints must align with whatever prefix
 * the LLM chose — mixing `/api/v1/auth/login` with `/api/health` would
 * silently break route mounting.
 */
export function detectContractPrefix(contracts: ApiContractEntry[]): string {
  if (contracts.length === 0) return "/api";

  // Tokenise each endpoint into path segments (drop leading empty).
  const tokenLists = contracts.map((c) =>
    c.endpoint.split("/").filter((s) => s.length > 0 && !s.startsWith(":")),
  );

  // Find longest prefix that appears in >=60% of contracts.
  const threshold = Math.ceil(contracts.length * 0.6);
  const prefixSegments: string[] = [];
  for (let depth = 0; depth < 4; depth++) {
    const candidate = tokenLists[0]?.[depth];
    if (!candidate) break;
    const count = tokenLists.filter((toks) => toks[depth] === candidate).length;
    if (count < threshold) break;
    // Stop when we hit a segment that looks like a resource name
    // (heuristic: a leading "api" or "v1" or "v2" is structural; anything
    // else is resource).
    const isStructural =
      candidate === "api" || /^v\d+$/.test(candidate) || candidate === "rest";
    if (!isStructural && prefixSegments.length > 0) break;
    prefixSegments.push(candidate);
    if (!isStructural) break;
  }

  if (prefixSegments.length === 0) return "/api";
  return "/" + prefixSegments.join("/");
}

/** Stable key for deduplication: `METHOD <path>`. */
function contractKey(method: string, endpoint: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

export function injectBaselineEndpoints(
  input: BaselineInjectionInput,
): BaselineInjectionResult {
  const prefix = detectContractPrefix(input.contracts);
  const existing = new Set(
    input.contracts.map((c) => contractKey(c.method, c.endpoint)),
  );

  const added: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const augmented: ApiContractEntry[] = [...input.contracts];

  // Auth baselines — only when the project has any auth surface at all.
  const hasAuthService = input.contracts.some((c) => c.service === "auth");
  const wantAuth = hasAuthService || input.hasAuthRoutes;

  for (const tpl of BASELINE_AUTH_TEMPLATES) {
    if (!wantAuth) {
      skipped.push({
        id: `${tpl.method} ${tpl.pathSuffix}`,
        reason: "no auth surface detected",
      });
      continue;
    }
    const endpoint = prefix + tpl.pathSuffix;
    const key = contractKey(tpl.method, endpoint);
    if (existing.has(key)) {
      skipped.push({
        id: key,
        reason: "already present in LLM output",
      });
      continue;
    }
    const { pathSuffix: _suffix, ...rest } = tpl;
    augmented.push({ ...rest, endpoint });
    existing.add(key);
    added.push(key);
  }

  // Health baseline — always (scaffold ships the route).
  {
    const endpoint = prefix + BASELINE_HEALTH_TEMPLATE.pathSuffix;
    const key = contractKey(BASELINE_HEALTH_TEMPLATE.method, endpoint);
    if (existing.has(key)) {
      skipped.push({
        id: key,
        reason: "already present in LLM output",
      });
    } else {
      const { pathSuffix: _suffix, ...rest } = BASELINE_HEALTH_TEMPLATE;
      augmented.push({ ...rest, endpoint });
      added.push(key);
    }
  }

  return { contracts: augmented, added, skipped };
}
