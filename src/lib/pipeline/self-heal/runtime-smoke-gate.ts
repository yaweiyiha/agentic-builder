/**
 * Runtime Smoke Gate (CODEGEN_HARDENING_PLAN.md §4.x — P0 from FIX_PLAN).
 *
 * Boots the generated backend with `pnpm dev` (or equivalent), then proves
 * three invariants by HTTP probe — the cheapest possible "did we actually
 * ship something runnable" check before the verify-fix worker calls it
 * done:
 *
 *   1. `GET /api/health` returns 2xx.
 *   2. Every endpoint declared in `API_CONTRACTS.json` (and exempt list,
 *      see CONTRACT_AUDIT_EXEMPT_ENDPOINTS) is reachable, i.e. NEVER
 *      returns 404. 401/403 are fine — they prove auth middleware is in
 *      place; 200/204/400/422 are fine — they prove a handler responded;
 *      404 means the route file or registration is wrong (the #1 silent
 *      failure observed in earlier runs).
 *   3. The process actually came up — startup didn't crash on a missing
 *      env var, malformed Sequelize model, etc.
 *
 * Output: `.ralph/runtime-smoke.json` — schema mirrors the other audits in
 * this folder so the verify-fix worker can consume failures as
 * `pendingRepairTasks`.
 *
 * NOT a replacement for `runtime-verify.ts` (which also tests the
 * frontend) — this module is intentionally focused on the backend
 * 404-vs-401 distinction, since that single signal explains the bulk of
 * "OAuth succeeds but every API call 404s" reports.
 */

import fs from "fs/promises";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { fsRead, fsWrite, listFiles } from "@/lib/langgraph/tools";
import type { RepairEmitter } from "./events";

export type RuntimeSmokeFailureCode =
  | "backend_did_not_start"
  | "health_probe_failed"
  | "endpoint_404"
  | "endpoint_5xx"
  | "endpoint_unreachable";

export interface RuntimeSmokeFailure {
  code: RuntimeSmokeFailureCode;
  /** "GET /api/foo" or "_boot" / "_health" for non-endpoint failures. */
  target: string;
  /** Imperative directive for the verify-fix worker. */
  directive: string;
  /** Raw evidence (status code, response body excerpt, stderr tail). */
  evidence: string;
}

export interface RuntimeSmokeSuccess {
  target: string;
  detail: string;
}

export interface RuntimeSmokeGateResult {
  pass: boolean;
  /** True when the backend never started — all endpoint checks were skipped. */
  bootFailed: boolean;
  failures: RuntimeSmokeFailure[];
  successes: RuntimeSmokeSuccess[];
  port: number;
  /** Endpoints actually probed (filtered for exempt entries). */
  probedEndpoints: Array<{ method: string; endpoint: string }>;
}

export interface RuntimeSmokeGateInput {
  outputDir: string;
  emitter?: RepairEmitter;
  sessionId?: string;
  /**
   * Override the port we probe. Defaults to backend/.env's PORT, or 4000.
   */
  portOverride?: number;
  /**
   * Override the boot-ready timeout in ms. Defaults to 30000.
   */
  bootTimeoutMs?: number;
}

const PERSIST_REL = path.join(".ralph", "runtime-smoke.json");

const DEFAULT_BOOT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ENDPOINT_PROBES = 60;

/**
 * Endpoints that are scaffold-infrastructure and intentionally not in
 * API_CONTRACTS.json. Mirrors `isContractAuditExempt` in supervisor.ts —
 * keep these two lists in sync.
 */
const EXEMPT_ENDPOINTS: ReadonlyArray<{ method: string; pathRe: RegExp }> = [
  { method: "GET", pathRe: /^\/(?:api\/)?health\/?$/ },
];

function isExemptEndpoint(method: string, endpoint: string): boolean {
  const m = method.toUpperCase();
  const p = normalizePath(endpoint);
  return EXEMPT_ENDPOINTS.some(
    (rule) => rule.method === m && rule.pathRe.test(p),
  );
}

function normalizePath(p: string): string {
  let out = p.trim();
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/+/g, "/");
  return out.length > 1 ? out.replace(/\/$/, "") : out;
}

function materializeDynamicPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, (_m, key) =>
    key.toLowerCase().includes("id") ? "1" : "sample",
  );
}

async function readBackendPort(outputDir: string): Promise<number> {
  const envContent = await fsRead("backend/.env", outputDir);
  if (!envContent.startsWith("FILE_NOT_FOUND")) {
    const m = envContent.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > 0 && v < 65536) return v;
    }
  }
  return 4000;
}

async function readContractEndpoints(
  outputDir: string,
): Promise<Array<{ method: string; endpoint: string }>> {
  const raw = await fsRead("API_CONTRACTS.json", outputDir);
  if (raw.startsWith("FILE_NOT_FOUND") || raw.startsWith("REJECTED")) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is { method: string; endpoint: string } =>
          c &&
          typeof c.method === "string" &&
          typeof c.endpoint === "string",
      )
      .map((c) => ({
        method: c.method.toUpperCase(),
        endpoint: normalizePath(c.endpoint),
      }));
  } catch {
    return [];
  }
}

/**
 * Best-effort fallback: parse implemented endpoints out of routes.ts files.
 * Used when API_CONTRACTS.json is missing — we still want SOME 404 coverage.
 */
async function readImplementedEndpoints(
  outputDir: string,
): Promise<Array<{ method: string; endpoint: string }>> {
  const apiModulesDir = "backend/src/api/modules";
  let allFiles: string[] = [];
  try {
    allFiles = (await listFiles(apiModulesDir, outputDir)).filter((f) =>
      f.endsWith(".routes.ts"),
    );
  } catch {
    return [];
  }
  const out: Array<{ method: string; endpoint: string }> = [];
  for (const rel of allFiles) {
    const content = await fsRead(rel, outputDir);
    if (content.startsWith("FILE_NOT_FOUND") || content.startsWith("REJECTED")) {
      continue;
    }
    const re =
      /\b(?:router|apiRouter|[A-Za-z_$][\w$]*Router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    for (const m of content.matchAll(re)) {
      out.push({ method: m[1].toUpperCase(), endpoint: normalizePath(m[2]) });
    }
  }
  // Best-effort prefix with /api so probes target the same path Koa serves.
  return out.map((e) => ({
    method: e.method,
    endpoint: e.endpoint.startsWith("/api") ? e.endpoint : `/api${e.endpoint}`,
  }));
}

async function probe(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body: body.slice(0, 600) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: "",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeWithRetry(
  url: string,
  init: RequestInit,
  retries = 2,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  let last = await probe(url, init);
  for (let i = 0; i < retries; i++) {
    if (!last.error) return last;
    await new Promise((r) => setTimeout(r, 200));
    last = await probe(url, init);
  }
  return last;
}

interface BootResult {
  child: ChildProcess | null;
  output: string;
  bootError?: string;
}

function bootBackend(
  cwd: string,
  bootTimeoutMs: number,
  port: number,
): Promise<BootResult> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["dev"], {
      cwd,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    let output = "";
    let settled = false;
    const ready = /listening on|localhost:\d+|API server listening/i;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve({
        child: null,
        output,
        bootError: `Backend did not become ready within ${bootTimeoutMs}ms. tail=${output.slice(-1000)}`,
      });
    }, bootTimeoutMs);

    const onData = (buf: Buffer): void => {
      output += buf.toString();
      if (!settled && ready.test(output)) {
        settled = true;
        clearTimeout(timer);
        // Give the listener a beat to actually bind.
        setTimeout(() => resolve({ child, output }), 250);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        child: null,
        output,
        bootError: `Backend process exited before ready (code=${code ?? "null"}). tail=${output.slice(-1500)}`,
      });
    });
  });
}

async function killProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => resolve(), 2_500);
    child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
  if (child.exitCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

async function backendIsPresent(outputDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(outputDir, "backend", "package.json"));
    return true;
  } catch {
    return false;
  }
}

export async function runRuntimeSmokeGate(
  input: RuntimeSmokeGateInput,
): Promise<RuntimeSmokeGateResult> {
  const { outputDir, emitter, sessionId } = input;
  const port = input.portOverride ?? (await readBackendPort(outputDir));
  const bootTimeoutMs = input.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;

  const result: RuntimeSmokeGateResult = {
    pass: false,
    bootFailed: false,
    failures: [],
    successes: [],
    port,
    probedEndpoints: [],
  };

  // Frontend-only projects (s-tier or PRD's that genuinely have no backend)
  // don't need this gate. Skip cleanly and emit a snapshot so the report
  // shows we evaluated the gate.
  if (!(await backendIsPresent(outputDir))) {
    result.pass = true;
    if (emitter) {
      emitter({
        stage: "integration-gate",
        sessionId,
        event: "runtime_smoke_skipped",
        details: {
          reason: "no_backend",
          outputDir,
        },
      });
    }
    return result;
  }

  const backendDir = path.join(outputDir, "backend");
  const boot = await bootBackend(backendDir, bootTimeoutMs, port);
  if (!boot.child) {
    result.bootFailed = true;
    result.failures.push({
      code: "backend_did_not_start",
      target: "_boot",
      directive:
        "Backend `pnpm dev` did not reach a listening state. Inspect the stderr tail in `evidence` — common causes: missing PORT/DATABASE_URL/PRIVY_APP_ID in `backend/.env`, Sequelize model init throwing, or a TS error that crashed `tsx`.",
      evidence:
        boot.bootError ??
        boot.output.slice(-1500) ??
        "(no output captured)",
    });
    await persistAndEmit(outputDir, result, emitter, sessionId);
    return result;
  }

  try {
    // Step 1: /api/health
    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    const health = await probeWithRetry(healthUrl, { method: "GET" });
    if (health.error || health.status === 0) {
      result.failures.push({
        code: "health_probe_failed",
        target: "GET /api/health",
        directive:
          "Backend booted but `/api/health` is unreachable. Confirm `registerHealthRoutes(apiRouter)` is called in `backend/src/api/modules/index.ts` and the route file exists at `backend/src/api/modules/health/health.routes.ts`.",
        evidence: health.error ?? `status=${health.status} body=${health.body}`,
      });
    } else if (health.status >= 400) {
      result.failures.push({
        code: "health_probe_failed",
        target: "GET /api/health",
        directive:
          "`/api/health` responded with an error status. Check the health controller for an unconditional auth gate or an exception thrown before the JSON write.",
        evidence: `status=${health.status} body=${health.body}`,
      });
    } else {
      result.successes.push({
        target: "GET /api/health",
        detail: `reachable (${health.status})`,
      });
    }

    // Step 2: contract endpoints — must NEVER 404 (401/403/422 are fine)
    let endpoints = await readContractEndpoints(outputDir);
    if (endpoints.length === 0) {
      // Fallback to grep'd routes when contracts are missing.
      endpoints = await readImplementedEndpoints(outputDir);
    }
    endpoints = endpoints.filter(
      (e) => !isExemptEndpoint(e.method, e.endpoint),
    );
    // Dedupe.
    const seen = new Set<string>();
    endpoints = endpoints.filter((e) => {
      const k = `${e.method} ${e.endpoint}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    endpoints = endpoints.slice(0, MAX_ENDPOINT_PROBES);
    result.probedEndpoints = endpoints;

    for (const ep of endpoints) {
      const url = `http://127.0.0.1:${port}${materializeDynamicPath(ep.endpoint)}`;
      const init: RequestInit =
        ep.method === "GET" || ep.method === "DELETE"
          ? { method: ep.method }
          : {
              method: ep.method,
              headers: { "content-type": "application/json" },
              body: "{}",
            };
      const r = await probeWithRetry(url, init);
      const target = `${ep.method} ${ep.endpoint}`;
      if (r.error || r.status === 0) {
        result.failures.push({
          code: "endpoint_unreachable",
          target,
          directive:
            "Endpoint declared in API_CONTRACTS.json could not be reached. Most likely the backend crashed mid-request, or the path is mounted under a different prefix than expected.",
          evidence: r.error ?? `status=0`,
        });
      } else if (r.status === 404) {
        result.failures.push({
          code: "endpoint_404",
          target,
          directive:
            "Endpoint declared in API_CONTRACTS.json (or parsed from routes.ts) returns 404 to an unauthenticated probe. " +
            "Likely causes (in order of frequency): " +
            "(a) a guard function (e.g. `requirePrivyAuth`) was used directly as middleware without `next()` — switch to `requirePrivyAuthMiddleware`; " +
            "(b) the `*Handler` is exported in a controller but the corresponding `*.routes.ts` never registers it; " +
            "(c) `authGate` calls `ctx.throw(404, \"User not found\")` when the DB row is missing — replace with `resolveOrCreateDbUser(ctx)` (auto-upsert).",
          evidence: `status=404 body=${r.body}`,
        });
      } else if (r.status >= 500) {
        result.failures.push({
          code: "endpoint_5xx",
          target,
          directive:
            "Endpoint returned 5xx to a probe. Inspect server logs for an unhandled exception. Common causes: missing env vars (DATABASE_URL/PRIVY_APP_ID), Sequelize column mismatch, or a service throwing before the response is written.",
          evidence: `status=${r.status} body=${r.body}`,
        });
      } else {
        result.successes.push({
          target,
          detail: `reachable (${r.status})`,
        });
      }
    }

    result.pass = result.failures.length === 0;
  } finally {
    await killProcess(boot.child);
  }

  await persistAndEmit(outputDir, result, emitter, sessionId);
  return result;
}

async function persistAndEmit(
  outputDir: string,
  result: RuntimeSmokeGateResult,
  emitter: RepairEmitter | undefined,
  sessionId: string | undefined,
): Promise<void> {
  try {
    const persistRel = PERSIST_REL.split(path.sep).join("/");
    await fsWrite(
      persistRel,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          sessionId,
          ...result,
        },
        null,
        2,
      ),
      outputDir,
    );
  } catch (err) {
    console.warn(
      `[runtime-smoke-gate] failed to persist report: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (emitter) {
    emitter({
      stage: "integration-gate",
      sessionId,
      event: "runtime_smoke_snapshot",
      details: {
        when: "final",
        pass: result.pass,
        bootFailed: result.bootFailed,
        port: result.port,
        failureCount: result.failures.length,
        endpointsProbed: result.probedEndpoints.length,
        codes: result.failures.reduce<Record<string, number>>((acc, f) => {
          acc[f.code] = (acc[f.code] ?? 0) + 1;
          return acc;
        }, {}),
      },
    });
  }
}
