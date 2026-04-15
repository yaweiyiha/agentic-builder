import fs from "fs/promises";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import type { Dirent } from "fs";

const FRONTEND_DEV_PORT = Number(process.env.RUNTIME_VERIFY_FRONTEND_PORT ?? 4173);
const BACKEND_DEFAULT_PORT = Number(
  process.env.RUNTIME_VERIFY_BACKEND_PORT ?? 4000,
);
const PROCESS_READY_TIMEOUT_MS = Number(
  process.env.RUNTIME_VERIFY_PROCESS_READY_TIMEOUT_MS ?? 35_000,
);
const REQUEST_TIMEOUT_MS = Number(
  process.env.RUNTIME_VERIFY_REQUEST_TIMEOUT_MS ?? 8_000,
);
const MAX_BACKEND_ENDPOINT_CHECKS = Number(
  process.env.RUNTIME_VERIFY_MAX_BACKEND_ENDPOINT_CHECKS ?? 40,
);
const MAX_FRONTEND_ROUTE_CHECKS = Number(
  process.env.RUNTIME_VERIFY_MAX_FRONTEND_ROUTE_CHECKS ?? 30,
);

type VerifyFailure = {
  check: string;
  detail: string;
};

type VerifySuccess = {
  check: string;
  detail: string;
};

export type RuntimeVerifyResult = {
  pass: boolean;
  summary: string;
  failures: VerifyFailure[];
  successes: VerifySuccess[];
};

type BackendEndpoint = {
  method: string;
  path: string;
};

type RunningProcess = {
  child: ChildProcess;
  output: string;
};

type PackageManager = "pnpm" | "npm" | "yarn";

type ProcessCommand = {
  command: string;
  args: string[];
};

function normalizeRoutePath(raw: string): string {
  let out = raw.trim();
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/+/g, "/");
  return out.length > 1 ? out.replace(/\/$/, "") : out;
}

function materializeDynamicPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, (_m, key) => {
    if (key.toLowerCase().includes("id")) return "1";
    return "sample";
  });
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function safeRead(absPath: string): Promise<string> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch {
    return "";
  }
}

async function listFilesRecursive(absDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(absDir);
  return out;
}

async function detectPackageManager(projectDir: string): Promise<PackageManager> {
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJsonText = await safeRead(packageJsonPath);
  if (packageJsonText.trim()) {
    try {
      const parsed = JSON.parse(packageJsonText) as { packageManager?: string };
      const pm = (parsed.packageManager ?? "").toLowerCase();
      if (pm.startsWith("npm@")) return "npm";
      if (pm.startsWith("yarn@")) return "yarn";
      if (pm.startsWith("pnpm@")) return "pnpm";
    } catch {
      /* ignore malformed package.json */
    }
  }

  if (await fileExists(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function buildDevCommand(pm: PackageManager, extraArgs: string[] = []): ProcessCommand {
  if (pm === "npm") {
    return { command: "npm", args: ["run", "dev", "--", ...extraArgs] };
  }
  return { command: pm, args: ["dev", ...extraArgs] };
}

function startProcess(
  command: string,
  args: string[],
  cwd: string,
  readyPattern: RegExp,
): Promise<RunningProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      reject(
        new Error(
          `Process startup timeout (${PROCESS_READY_TIMEOUT_MS}ms) for "${command} ${args.join(" ")}". Output: ${output.slice(-800)}`,
        ),
      );
    }, PROCESS_READY_TIMEOUT_MS);

    const onData = (buf: Buffer) => {
      const text = buf.toString();
      output += text;
      if (!settled && readyPattern.test(output)) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, output });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `Process exited before ready (code=${code ?? "null"}) for "${command} ${args.join(" ")}". Output: ${output.slice(-1000)}`,
        ),
      );
    });
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
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

async function requestOnce(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: body.slice(0, 1200),
    };
  } catch (error) {
    const cause =
      error instanceof Error &&
      error.cause &&
      typeof error.cause === "object" &&
      "message" in error.cause
        ? String((error.cause as { message?: string }).message ?? "")
        : "";
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      body: "",
      error: cause ? `${message}; cause=${cause}` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry(
  url: string,
  init?: RequestInit,
  retries = 2,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  let last = await requestOnce(url, init);
  for (let i = 0; i < retries; i++) {
    if (!last.error) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await requestOnce(url, init);
  }
  return last;
}

async function parseBackendEndpoints(backendDir: string): Promise<BackendEndpoint[]> {
  const moduleIndexPath = path.join(backendDir, "src/api/modules/index.ts");
  const indexContent = await safeRead(moduleIndexPath);
  if (!indexContent.trim()) return [];

  const varToRouteFile = new Map<string, string>();
  const importRegex =
    /import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*["']\.\/([^"']+\.routes)["'];?/g;
  for (const match of indexContent.matchAll(importRegex)) {
    const variable = match[1];
    const rel = match[2];
    varToRouteFile.set(variable, `${rel}.ts`);
  }

  const varToBasePath = new Map<string, string>();
  const useRegex =
    /router\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  for (const match of indexContent.matchAll(useRegex)) {
    varToBasePath.set(match[2], normalizeRoutePath(match[1]));
  }

  const endpoints: BackendEndpoint[] = [];
  for (const [routeVar, routeRelPath] of varToRouteFile.entries()) {
    const basePath = varToBasePath.get(routeVar);
    if (!basePath) continue;
    const routeFilePath = path.join(
      backendDir,
      "src/api/modules",
      routeRelPath,
    );
    const content = await safeRead(routeFilePath);
    if (!content.trim()) continue;
    const methodRegex =
      /\.((?:get|post|put|patch|delete))\(\s*["'`]([^"'`]+)["'`]/g;
    for (const match of content.matchAll(methodRegex)) {
      const method = match[1].toUpperCase();
      const subPath = normalizeRoutePath(match[2]);
      const joined = normalizeRoutePath(
        `${basePath}${subPath === "/" ? "" : subPath}`,
      );
      endpoints.push({ method, path: joined });
    }
  }

  const unique = new Map<string, BackendEndpoint>();
  for (const ep of endpoints) {
    unique.set(`${ep.method} ${ep.path}`, ep);
  }
  return [...unique.values()];
}

async function parseFrontendRoutes(frontendDir: string): Promise<string[]> {
  const routerPath = path.join(frontendDir, "src/router.tsx");
  const content = await safeRead(routerPath);
  if (!content.trim()) return ["/"];

  const routes = new Set<string>(["/"]);
  const routeRegex = /path=\s*["'`]([^"'`]+)["'`]/g;
  for (const match of content.matchAll(routeRegex)) {
    const raw = match[1];
    if (!raw || raw === "*") continue;
    routes.add(normalizeRoutePath(raw));
  }
  return [...routes].slice(0, MAX_FRONTEND_ROUTE_CHECKS);
}

async function verifyFrontendAuthProviderWiring(
  frontendDir: string,
): Promise<{ ok: boolean; detail: string }> {
  const authContextPath = path.join(frontendDir, "src/context/AuthContext.tsx");
  const authContextContent = await safeRead(authContextPath);
  if (!authContextContent.trim()) {
    return { ok: true, detail: "AuthContext not found, skipped AuthProvider wiring check." };
  }

  const hasUseAuthGuard =
    authContextContent.includes("useAuth must be used within an AuthProvider") ||
    authContextContent.includes("createContext<AuthContextType | undefined>");
  if (!hasUseAuthGuard) {
    return { ok: true, detail: "AuthContext guard not detected, skipped AuthProvider wiring check." };
  }

  const srcDir = path.join(frontendDir, "src");
  const allFiles = await listFilesRecursive(srcDir);
  const authHookUsers: string[] = [];
  for (const absPath of allFiles) {
    if (!/\.(ts|tsx|js|jsx)$/.test(absPath)) continue;
    const rel = path.relative(frontendDir, absPath).replace(/\\/g, "/");
    if (rel === "src/context/AuthContext.tsx" || rel === "src/hooks/useAuth.ts") {
      continue;
    }
    const content = await safeRead(absPath);
    if (content.includes("useAuth(")) {
      authHookUsers.push(rel);
    }
  }

  if (authHookUsers.length === 0) {
    return { ok: true, detail: "No useAuth consumers detected, AuthProvider wiring check skipped." };
  }

  let providerFound = false;
  const providerAnchors = ["<AuthProvider", "<AuthContext.Provider"];
  for (const absPath of allFiles) {
    if (!/\.(tsx|jsx)$/.test(absPath)) continue;
    const content = await safeRead(absPath);
    if (providerAnchors.some((token) => content.includes(token))) {
      providerFound = true;
      break;
    }
  }

  if (!providerFound) {
    const sampleUsers = authHookUsers.slice(0, 6).join(", ");
    return {
      ok: false,
      detail:
        "Detected useAuth consumers but no AuthProvider wrapper in frontend entry tree. " +
        `Add <AuthProvider> around AppRouter in src/main.tsx or root layout. Sample consumers: ${sampleUsers}`,
    };
  }

  return {
    ok: true,
    detail: `AuthProvider wiring detected for ${authHookUsers.length} useAuth consumer file(s).`,
  };
}

async function runBackendRuntimeChecks(
  outputDir: string,
  successes: VerifySuccess[],
  failures: VerifyFailure[],
): Promise<void> {
  const backendDir = path.join(outputDir, "backend");
  if (!(await fileExists(path.join(backendDir, "package.json")))) {
    successes.push({
      check: "backend_runtime",
      detail: "backend/package.json not found, skipped backend runtime checks.",
    });
    return;
  }

  let proc: RunningProcess | null = null;
  try {
    const pm = await detectPackageManager(backendDir);
    const devCommand = buildDevCommand(pm);
    proc = await startProcess(
      devCommand.command,
      devCommand.args,
      backendDir,
      /listening on|localhost:\d+/i,
    );
    const portMatch = proc.output.match(/localhost:(\d+)/i);
    const port = portMatch ? Number(portMatch[1]) : BACKEND_DEFAULT_PORT;

    const healthUrl = `http://127.0.0.1:${port}/api/health`;
    const health = await requestWithRetry(healthUrl);
    if (health.status >= 500 || health.error) {
      failures.push({
        check: "backend_health",
        detail:
          health.error ??
          `health endpoint returned status=${health.status}, body=${health.body}`,
      });
    } else {
      successes.push({
        check: "backend_health",
        detail: `health reachable (${health.status})`,
      });
    }

    const endpoints = await parseBackendEndpoints(backendDir);
    const sample = endpoints.slice(0, MAX_BACKEND_ENDPOINT_CHECKS);
    for (const endpoint of sample) {
      const route = materializeDynamicPath(endpoint.path);
      const url = `http://127.0.0.1:${port}${route}`;
      const method = endpoint.method;
      const req =
        method === "GET" || method === "DELETE"
          ? { method }
          : {
              method,
              headers: { "content-type": "application/json" },
              body: "{}",
            };
      const result = await requestWithRetry(url, req);
      const checkLabel = `backend_endpoint ${method} ${endpoint.path}`;
      if (result.error) {
        failures.push({
          check: checkLabel,
          detail: result.error,
        });
      } else if (result.status >= 500) {
        failures.push({
          check: checkLabel,
          detail: `status=${result.status}, body=${result.body}`,
        });
      } else {
        successes.push({
          check: checkLabel,
          detail: `reachable (${result.status})`,
        });
      }
    }
  } catch (error) {
    failures.push({
      check: "backend_runtime_start",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (proc) await stopProcess(proc.child);
  }
}

async function runFrontendRuntimeChecks(
  outputDir: string,
  successes: VerifySuccess[],
  failures: VerifyFailure[],
): Promise<void> {
  const frontendDir = path.join(outputDir, "frontend");
  if (!(await fileExists(path.join(frontendDir, "package.json")))) {
    successes.push({
      check: "frontend_runtime",
      detail: "frontend/package.json not found, skipped frontend runtime checks.",
    });
    return;
  }

  const authProviderWiring = await verifyFrontendAuthProviderWiring(frontendDir);
  if (!authProviderWiring.ok) {
    failures.push({
      check: "frontend_auth_provider_wiring",
      detail: authProviderWiring.detail,
    });
  } else {
    successes.push({
      check: "frontend_auth_provider_wiring",
      detail: authProviderWiring.detail,
    });
  }

  let proc: RunningProcess | null = null;
  try {
    const pm = await detectPackageManager(frontendDir);
    const devCommand = buildDevCommand(pm, [
      "--host",
      "127.0.0.1",
      "--port",
      String(FRONTEND_DEV_PORT),
    ]);
    proc = await startProcess(
      devCommand.command,
      devCommand.args,
      frontendDir,
      /ready in|local:\s*http:\/\/127\.0\.0\.1/i,
    );
    const frontendPortMatch = proc.output.match(
      /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i,
    );
    const frontendPort = frontendPortMatch
      ? Number(frontendPortMatch[1])
      : FRONTEND_DEV_PORT;

    const routes = await parseFrontendRoutes(frontendDir);
    for (const routePath of routes) {
      const url = `http://127.0.0.1:${frontendPort}${materializeDynamicPath(routePath)}`;
      const result = await requestWithRetry(url, {
        headers: { accept: "text/html" },
      });
      const checkLabel = `frontend_route ${routePath}`;
      if (result.error) {
        failures.push({ check: checkLabel, detail: `${result.error} (url=${url})` });
        continue;
      }
      if (result.status >= 500) {
        failures.push({
          check: checkLabel,
          detail: `status=${result.status}, body=${result.body}`,
        });
        continue;
      }
      const body = result.body.toLowerCase();
      const hasRoot =
        body.includes('id="root"') ||
        body.includes("id='root'") ||
        body.includes("id=root");
      if (!hasRoot) {
        failures.push({
          check: checkLabel,
          detail: "page html does not contain root container; possible blank screen risk.",
        });
        continue;
      }
      successes.push({
        check: checkLabel,
        detail: `served (${result.status}) with root container.`,
      });
    }
  } catch (error) {
    failures.push({
      check: "frontend_runtime_start",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (proc) await stopProcess(proc.child);
  }
}

function formatSummary(
  pass: boolean,
  failures: VerifyFailure[],
  successes: VerifySuccess[],
): string {
  const lines: string[] = [
    `Runtime verify ${pass ? "PASSED" : "FAILED"}.`,
    `Success checks: ${successes.length}`,
    `Failure checks: ${failures.length}`,
    "",
  ];
  if (successes.length > 0) {
    lines.push("## Passed");
    for (const item of successes.slice(0, 25)) {
      lines.push(`- ${item.check}: ${item.detail}`);
    }
    lines.push("");
  }
  if (failures.length > 0) {
    lines.push("## Failed");
    for (const item of failures.slice(0, 25)) {
      lines.push(`- ${item.check}: ${item.detail}`);
    }
  }
  return lines.join("\n").slice(0, 6000);
}

export async function runRuntimeVerification(
  outputDir: string,
): Promise<RuntimeVerifyResult> {
  const failures: VerifyFailure[] = [];
  const successes: VerifySuccess[] = [];

  await runBackendRuntimeChecks(outputDir, successes, failures);
  await runFrontendRuntimeChecks(outputDir, successes, failures);

  const pass = failures.length === 0;
  return {
    pass,
    failures,
    successes,
    summary: formatSummary(pass, failures, successes),
  };
}

