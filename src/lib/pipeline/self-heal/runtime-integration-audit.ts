/**
 * Runtime Integration Audit (CODEGEN_HARDENING_PLAN.md §4.2 / §4.3 / §4.4 /
 * §4.5 / §4.7) — static analysis of generated code that catches the runtime
 * pitfalls Phase 4 prompts now warn against, but with deterministic
 * file-level evidence.
 *
 * Scope: regex-based scans across `frontend/src/**\/*.{ts,tsx}` and
 * `backend/src/**\/*.ts`. We deliberately stay regex-only (no AST) for two
 * reasons:
 *   1. The same convention as `contract-usage-coverage.ts` — keeps the
 *      self-heal layer dependency-free.
 *   2. Easy to extend: each rule is ~30 lines and produces a `directive`
 *      string the worker can act on without re-deriving the failure mode.
 *
 * Rule list (severity is the default; some are downgraded by context flags
 * such as "no LLM_PROVIDER declared, so the LLM-abstraction rule is N/A"):
 *
 * | id                              | scope    | sev  | catches |
 * |---------------------------------|----------|------|---------|
 * | useSyncExternalStore-cached     | frontend | err  | §4.2 — store rebuilds snapshot every getSnapshot(), causes infinite loop |
 * | useBlocker-needs-data-router    | frontend | err  | §4.2 — useBlocker imported in a project with <BrowserRouter> |
 * | external-id-vs-db-pk            | backend  | err  | §4.3 — findByPk(ctx.state.user.id) without prior privy_id resolve, when an OAuth optional feature is applied |
 * | bg-job-clear-stale-runs         | backend  | warn | §4.4 — `/refresh` route has no `clearActiveRunsForUser` call |
 * | bg-job-inproc-branch            | backend  | err  | §4.4 — SSE / status route does findByPk on run_id without isUuid / inproc: branch |
 * | bg-job-worker-startup           | backend  | warn | §4.4 — backend has start*Worker but server.ts never calls it |
 * | llm-client-abstraction          | backend  | err  | §4.5 — direct vendor SDK import (`from "openai"` etc.) outside `services/llmService.ts` |
 * | empty-results-not-failure       | backend  | warn | §4.7 — aggregation throws on zero upstream rows (NO_SOURCES / "Zero stories" patterns) |
 *
 * Output (in addition to the in-memory result):
 *   `<outputDir>/.ralph/runtime-integration-audit.json` — full findings list
 *   the verify-fix worker can re-read between turns.
 */

import path from "path";
import { fsRead, fsWrite, listFiles } from "@/lib/langgraph/tools";
import type { RepairEmitter } from "./events";

export type RuntimeAuditRuleId =
  | "useSyncExternalStore-cached"
  | "useBlocker-needs-data-router"
  | "external-id-vs-db-pk"
  | "bg-job-clear-stale-runs"
  | "bg-job-inproc-branch"
  | "bg-job-worker-startup"
  | "llm-client-abstraction"
  | "empty-results-not-failure";

export type RuntimeAuditSeverity = "error" | "warn" | "info";

export type RuntimeAuditScope = "frontend" | "backend" | "global";

export interface RuntimeAuditFinding {
  /** Stable id so the verify-fix worker can dedupe across turns. */
  id: string;
  ruleId: RuntimeAuditRuleId;
  scope: RuntimeAuditScope;
  severity: RuntimeAuditSeverity;
  /** Source path relative to outputDir; "" when the finding is project-wide. */
  file: string;
  /** 1-indexed line; 0 when not applicable. */
  line: number;
  /** Short snippet showing the offending code (≤ 200 chars). */
  snippet: string;
  /** Human-readable explanation of WHY this is a problem. */
  reason: string;
  /** Imperative repair instruction for the worker. */
  directive: string;
}

export interface RuntimeIntegrationAuditInput {
  outputDir: string;
  /**
   * Names of `_optional/<feature>` directories that were applied to this
   * project (read from `.blueprint/scaffold-applied.json` by the supervisor).
   * Used to gate context-sensitive rules — e.g. `external-id-vs-db-pk` only
   * fires when an `auth-*` feature is applied.
   */
  appliedOptionalFeatures?: string[];
  /**
   * EnvKeys declared on the project's `ResourceRequirement[]`. Used to gate
   * `llm-client-abstraction` (only fires when LLM_PROVIDER / LLM_API_KEY is
   * declared) and similar.
   */
  declaredEnvKeys?: string[];
  emitter?: RepairEmitter;
  sessionId?: string;
}

export interface RuntimeIntegrationAuditResult {
  findings: RuntimeAuditFinding[];
  byRule: Record<RuntimeAuditRuleId, number>;
  bySeverity: Record<RuntimeAuditSeverity, number>;
  /** True when at least one rule produced a finding with severity = "error". */
  hasError: boolean;
  /** True when nothing fired (clean project). */
  clean: boolean;
  /** Disabled-rule explanations so reports show why a rule was N/A. */
  disabledRules: Array<{ ruleId: RuntimeAuditRuleId; reason: string }>;
}

const PERSIST_REL = path.join(".ralph", "runtime-integration-audit.json");

const FILE_SIZE_CAP = 256 * 1024; // 256 KB per file — anything bigger is gen artefact / lockfile

const FRONTEND_GLOB_RE = /^frontend\/src\/.+\.(t|j)sx?$/;
const BACKEND_GLOB_RE = /^backend\/src\/.+\.(t|j)sx?$/;

const PRIVY_FEATURES = new Set(["auth-privy", "auth-clerk", "auth-auth0"]);

function makeId(rule: RuntimeAuditRuleId, file: string, line: number): string {
  return `${rule}|${file}|${line}`;
}

function clampSnippet(s: string): string {
  const trimmed = s.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed;
}

async function readSafe(file: string, outputDir: string): Promise<string | null> {
  const content = await fsRead(file, outputDir);
  if (content.startsWith("FILE_NOT_FOUND") || content.startsWith("REJECTED")) {
    return null;
  }
  if (content.length > FILE_SIZE_CAP) return null;
  return content;
}

/**
 * Best-effort load of `<outputDir>/.blueprint/scaffold-applied.json`. Returns
 * [] when the file is missing, malformed, or empty — callers that need a hard
 * answer should pass `appliedOptionalFeatures` explicitly.
 */
async function loadAppliedOptionalFeatures(
  outputDir: string,
): Promise<string[]> {
  const raw = await readSafe(".blueprint/scaffold-applied.json", outputDir);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      appliedOptionalFeatures?: unknown;
    };
    if (!Array.isArray(parsed.appliedOptionalFeatures)) return [];
    return parsed.appliedOptionalFeatures.filter(
      (v): v is string => typeof v === "string",
    );
  } catch {
    return [];
  }
}

async function listScopedFiles(
  outputDir: string,
  scope: "frontend" | "backend",
): Promise<string[]> {
  const all = await listFiles(scope, outputDir);
  const re = scope === "frontend" ? FRONTEND_GLOB_RE : BACKEND_GLOB_RE;
  return all.filter((p) => {
    const norm = p.split(path.sep).join("/");
    if (!re.test(norm)) return false;
    if (norm.includes("/__tests__/")) return false;
    if (norm.endsWith(".d.ts")) return false;
    return true;
  });
}

// ─── Rules ────────────────────────────────────────────────────────────────

/**
 * §4.2-A: useSyncExternalStore must cache snapshot. We grep for files that
 * call `useSyncExternalStore(` AND lack any of the canonical caching
 * patterns. False positives are tolerated — the directive is a no-op when
 * the worker re-reads and confirms the cache is already there.
 */
async function ruleUseSyncExternalStore(
  outputDir: string,
  feFiles: string[],
): Promise<RuntimeAuditFinding[]> {
  const findings: RuntimeAuditFinding[] = [];
  for (const file of feFiles) {
    const content = await readSafe(file, outputDir);
    if (!content) continue;
    if (!/\buseSyncExternalStore\s*\(/.test(content)) continue;
    const cached =
      /\bcachedSnapshot\b/.test(content) ||
      /let\s+snapshot\s*[:=]/.test(content) ||
      /const\s+snapshot\s*=\s*useMemo/.test(content) ||
      // Common pattern: stable getSnapshot returning a module-level frozen object
      /Object\.freeze\(\s*\{[\s\S]{0,200}?\}\s*\)/.test(content);
    if (cached) continue;
    const idx = content.search(/\buseSyncExternalStore\s*\(/);
    const line = content.slice(0, idx).split("\n").length;
    findings.push({
      id: makeId("useSyncExternalStore-cached", file, line),
      ruleId: "useSyncExternalStore-cached",
      scope: "frontend",
      severity: "error",
      file,
      line,
      snippet: clampSnippet(
        content.slice(Math.max(0, idx - 40), idx + 120),
      ),
      reason:
        "Custom store consumed via useSyncExternalStore but getSnapshot() does not return a cached reference. Returning a fresh object on every call triggers React's `Maximum update depth exceeded`.",
      directive:
        "Refactor the store: declare a module-level `let snapshot = { ... }`, mutate it ONLY inside the setter (`snapshot = { ...snapshot, ...next }; listeners.forEach((l) => l());`), and return the same `snapshot` reference from `getSnapshot()`. Do NOT build a new object inside `getSnapshot()`.",
    });
  }
  return findings;
}

/**
 * §4.2-B: useBlocker requires a data router. We fire when (a) any frontend
 * file imports `useBlocker` from `react-router-dom`, AND (b) the project
 * uses `<BrowserRouter>` (check `frontend/src/main.tsx`). The pair is
 * incompatible at runtime and crashes on first navigation.
 */
async function ruleUseBlockerDataRouter(
  outputDir: string,
  feFiles: string[],
): Promise<RuntimeAuditFinding[]> {
  const main = await readSafe("frontend/src/main.tsx", outputDir);
  const usesBrowserRouter =
    !!main && /<BrowserRouter[\s>]/.test(main) && !/createBrowserRouter/.test(main);
  if (!usesBrowserRouter) return [];

  const findings: RuntimeAuditFinding[] = [];
  for (const file of feFiles) {
    const content = await readSafe(file, outputDir);
    if (!content) continue;
    if (!/\buseBlocker\b/.test(content)) continue;
    if (
      !/from\s+["']react-router-dom["']/.test(content) &&
      !/from\s+["']react-router["']/.test(content)
    ) {
      continue;
    }
    const idx = content.search(/\buseBlocker\b/);
    const line = content.slice(0, idx).split("\n").length;
    findings.push({
      id: makeId("useBlocker-needs-data-router", file, line),
      ruleId: "useBlocker-needs-data-router",
      scope: "frontend",
      severity: "error",
      file,
      line,
      snippet: clampSnippet(
        content.slice(Math.max(0, idx - 40), idx + 80),
      ),
      reason:
        "useBlocker only works inside a data router (createBrowserRouter). This project uses <BrowserRouter> in main.tsx, so this import crashes on first navigation with `useBlocker must be used within a data router`.",
      directive:
        "Remove the `useBlocker` import. Implement unsaved-changes blocking with local state: a `pendingNavigation` value + `requestNavigation(target)` callback that sets it, paired with confirm/cancel handlers in the consuming page. See §4.2 in CODEGEN_HARDENING_PLAN.md for the pattern.",
    });
  }
  return findings;
}

/**
 * §4.3: when an OAuth optional feature is applied, the backend MUST resolve
 * the external user id (Privy DID, Clerk userId) to the DB row before using
 * it in Sequelize / Prisma queries. We catch:
 *   - findByPk(ctx.state.user.id)
 *   - where: { ...: ctx.state.user.id } (excluding `*_id` lookup columns)
 *   - findOne({ where: { id: ctx.state.user.id } })
 *
 * Heuristic: a file is OK if it shows a prior `findOne({ where: { *_id: ` or
 * `where: { privy_id: ` BEFORE the offending pattern.
 */
async function ruleExternalIdVsDbPk(
  outputDir: string,
  beFiles: string[],
  applied: string[],
): Promise<RuntimeAuditFinding[]> {
  const oauthApplied = applied.some((f) => PRIVY_FEATURES.has(f));
  if (!oauthApplied) return [];

  const findings: RuntimeAuditFinding[] = [];
  // Match the offending patterns. Tracks the line-level position of each.
  const OFFENDERS = [
    /\b(?:findByPk|findOne)\s*\(\s*ctx\.state\.user\.id\b/g,
    /\bwhere\s*:\s*\{\s*id\s*:\s*ctx\.state\.user\.id\b/g,
    /\bwhere\s*:\s*\{\s*user_id\s*:\s*ctx\.state\.user\.id\b/g,
    /\bwhere\s*:\s*\{\s*userId\s*:\s*ctx\.state\.user\.id\b/g,
  ];
  // A "good" pattern that, when present BEFORE an offender, neutralises it.
  const RESOLVER_RE =
    /findOne\s*\(\s*\{\s*where\s*:\s*\{\s*[a-z]+_id\s*:\s*ctx\.state\.user\.id/;

  for (const file of beFiles) {
    const content = await readSafe(file, outputDir);
    if (!content) continue;

    for (const re of OFFENDERS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        const idx = m.index;
        // If the file resolves the DID earlier, treat as OK.
        const before = content.slice(0, idx);
        if (RESOLVER_RE.test(before)) continue;

        const line = before.split("\n").length;
        findings.push({
          id: makeId("external-id-vs-db-pk", file, line),
          ruleId: "external-id-vs-db-pk",
          scope: "backend",
          severity: "error",
          file,
          line,
          snippet: clampSnippet(
            content.slice(Math.max(0, idx - 60), idx + 120),
          ),
          reason:
            "ctx.state.user.id is the EXTERNAL provider id (Privy DID / Clerk userId), not the DB primary key. Passing it to findByPk / `where: { id }` / `where: { user_id }` throws Postgres `invalid input syntax for type uuid: \"did:privy:...\"`.",
          directive:
            "At the top of this handler/service: `const user = await User.findOne({ where: { privy_id: ctx.state.user.id } }); if (!user) ctx.throw(404, \"User not found\");` then use `user.id` (UUID) for any FK queries below. Apply the SAME fix to every other handler in this file that reads `ctx.state.user.id`.",
        });
      }
    }
  }
  return findings;
}

/**
 * §4.4-A: any /refresh-style route that triggers a long-running aggregation
 * MUST call `clearActiveRunsForUser` first; otherwise stale `running` rows
 * from a crashed previous run block every retry with `ALREADY_RUNNING`.
 */
async function ruleBgClearStaleRuns(
  outputDir: string,
  beFiles: string[],
): Promise<RuntimeAuditFinding[]> {
  const findings: RuntimeAuditFinding[] = [];
  for (const file of beFiles) {
    const content = await readSafe(file, outputDir);
    if (!content) continue;
    // Only consider controllers / routes (heuristic: filename ends with
    // `.controller.ts` / `.routes.ts`, OR uses koa Router definitions).
    const looksLikeRoute =
      /\.(controller|routes)\.ts$/.test(file) ||
      /apiRouter\.(post|put|patch)\s*\(/.test(content);
    if (!looksLikeRoute) continue;

    // Look for refresh/restart endpoints handled in this file.
    const refreshRe = /\b(?:apiRouter|router)\.(?:post|put)\s*\(\s*["'`][^"'`]*\/(refresh|reaggregate|restart)\b/;
    const m = refreshRe.exec(content);
    if (!m) continue;

    if (/clearActiveRunsForUser\s*\(/.test(content)) continue;

    const line = content.slice(0, m.index).split("\n").length;
    findings.push({
      id: makeId("bg-job-clear-stale-runs", file, line),
      ruleId: "bg-job-clear-stale-runs",
      scope: "backend",
      severity: "warn",
      file,
      line,
      snippet: clampSnippet(
        content.slice(Math.max(0, m.index - 20), m.index + 160),
      ),
      reason:
        "This route kicks off a background aggregation but never clears stale `running` rows. A crashed previous run leaves the user with `ALREADY_RUNNING` errors forever.",
      directive:
        "Implement a `clearActiveRunsForUser(userId)` helper in the matching service file that updates every `status='running'` row for the user to `failed` (with `completed_at = new Date()`), and call it as the FIRST line of this refresh handler — before `enqueueXxx`.",
    });
  }
  return findings;
}

/**
 * §4.4-B: SSE / status routes MUST distinguish UUID run-ids (DB-backed)
 * from `inproc:<scope>:<ts>` run-ids (memory-backed). Calling findByPk on
 * an `inproc:` id throws `invalid input syntax for type uuid` and 5xxs
 * the SSE stream — exactly the failure observed in the previous run.
 *
 * Heuristic: any file that mentions BOTH `runId`/`run_id` AND
 * `Run.findByPk` / `Run.findOne(... where: { id` MUST also branch on
 * `inproc:` (`startsWith("inproc:")` or `isUuid(...)`).
 */
async function ruleBgInprocBranch(
  outputDir: string,
  beFiles: string[],
): Promise<RuntimeAuditFinding[]> {
  const findings: RuntimeAuditFinding[] = [];
  for (const file of beFiles) {
    const content = await readSafe(file, outputDir);
    if (!content) continue;

    if (!/\b(runId|run_id)\b/.test(content)) continue;

    // Look for queries against a *Run model on the run id.
    const runQueryRe =
      /\b\w*Run\.(findByPk|findOne)\s*\(\s*[^)]{0,80}(runId|run_id)/;
    const m = runQueryRe.exec(content);
    if (!m) continue;

    const branched =
      /startsWith\(\s*["']inproc:/.test(content) ||
      /isUuid\s*\(/.test(content);
    if (branched) continue;

    const line = content.slice(0, m.index).split("\n").length;
    findings.push({
      id: makeId("bg-job-inproc-branch", file, line),
      ruleId: "bg-job-inproc-branch",
      scope: "backend",
      severity: "error",
      file,
      line,
      snippet: clampSnippet(
        content.slice(Math.max(0, m.index - 20), m.index + 160),
      ),
      reason:
        "This file queries the *Run table by id but does not branch on `inproc:` run-ids. In-process runs use ids like `inproc:<userId>:<ts>` that are NOT UUIDs — Postgres throws `invalid input syntax for type uuid`, the SSE / status endpoint 5xxs, and the user sees an indefinite spinner.",
      directive:
        "Wrap the lookup in a discriminator: `if (runId.startsWith(\"inproc:\")) { /* subscribe to in-memory event emitter; do NOT touch DB */ } else if (isUuid(runId)) { const run = await XxxRun.findByPk(runId); ... } else { ctx.throw(400, \"Invalid run_id\"); }`. Apply to every status / stream handler in this file.",
    });
  }
  return findings;
}

/**
 * §4.4-C: backend has start*Worker but server.ts never invokes it.
 * Without the call, the in-process queue has no consumer and every
 * enqueued run hangs forever.
 */
async function ruleBgWorkerStartup(
  outputDir: string,
  beFiles: string[],
): Promise<RuntimeAuditFinding[]> {
  const findings: RuntimeAuditFinding[] = [];
  const server = await readSafe("backend/src/server.ts", outputDir);
  if (server == null) return [];

  for (const file of beFiles) {
    if (!/workers?\//.test(file) && !/Worker\.ts$/.test(file)) continue;
    const content = await readSafe(file, outputDir);
    if (!content) continue;
    const exportRe = /export\s+(?:async\s+)?function\s+(start\w*Worker)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = exportRe.exec(content))) {
      const fnName = m[1];
      const calledInServer = new RegExp(`\\b${fnName}\\s*\\(`).test(server);
      if (calledInServer) continue;
      const line = content.slice(0, m.index).split("\n").length;
      findings.push({
        id: makeId("bg-job-worker-startup", file, line),
        ruleId: "bg-job-worker-startup",
        scope: "backend",
        severity: "warn",
        file,
        line,
        snippet: `export async function ${fnName}(...) { ... }`,
        reason: `\`${fnName}\` is exported from a worker module but \`backend/src/server.ts\` never calls it. The in-process queue then has no consumer — every enqueued run hangs forever.`,
        directive: `In \`backend/src/server.ts\`, after the app is created and BEFORE \`app.listen(...)\`, import and call \`await ${fnName}();\`. This registers the in-process consumer at boot.`,
      });
    }
  }
  return findings;
}

/**
 * §4.5: when the project declared the LLM_* bundle, ALL LLM calls must go
 * through `backend/src/services/llmService.ts`. Direct vendor SDK imports
 * anywhere else are forbidden.
 */
async function ruleLlmClientAbstraction(
  outputDir: string,
  beFiles: string[],
  declaredEnvKeys: string[],
): Promise<RuntimeAuditFinding[]> {
  const llmDeclared =
    declaredEnvKeys.includes("LLM_PROVIDER") ||
    declaredEnvKeys.includes("LLM_API_KEY") ||
    declaredEnvKeys.includes("LLM_MODEL");
  if (!llmDeclared) return [];

  const findings: RuntimeAuditFinding[] = [];
  // Forbidden imports (pattern → label).
  const VENDOR_IMPORTS: Array<{ re: RegExp; label: string }> = [
    { re: /from\s+["']openai["']/, label: "openai" },
    { re: /from\s+["']@google\/generative-ai["']/, label: "@google/generative-ai" },
    { re: /from\s+["']@anthropic-ai\/sdk["']/, label: "@anthropic-ai/sdk" },
    { re: /from\s+["']@mistralai\/mistralai["']/, label: "@mistralai/mistralai" },
    { re: /from\s+["']cohere-ai["']/, label: "cohere-ai" },
  ];

  const ALLOW_FILE_RE = /backend\/src\/services\/llmService\.ts$/;

  for (const file of beFiles) {
    if (ALLOW_FILE_RE.test(file)) continue;
    const content = await readSafe(file, outputDir);
    if (!content) continue;

    for (const { re, label } of VENDOR_IMPORTS) {
      const m = re.exec(content);
      if (!m) continue;
      const line = content.slice(0, m.index).split("\n").length;
      findings.push({
        id: makeId("llm-client-abstraction", file, line),
        ruleId: "llm-client-abstraction",
        scope: "backend",
        severity: "error",
        file,
        line,
        snippet: clampSnippet(content.slice(Math.max(0, m.index - 20), m.index + 120)),
        reason: `Direct \`${label}\` import in feature code violates the LLM provider abstraction. The project declared \`LLM_PROVIDER\` so swapping providers must be a one-line .env change with zero source edits.`,
        directive: `Remove the direct \`${label}\` import. Replace the call(s) below with \`llmService.chat(...)\` / \`llmService.embed(...)\` from \`backend/src/services/llmService.ts\`. If \`llmService.ts\` does not yet support the call shape you need, EXTEND it (and only it) — never hardcode vendor URLs / model ids in feature files.`,
      });
    }
  }
  return findings;
}

/**
 * §4.7: aggregation pipelines must NOT throw on zero upstream rows.
 * Catches the specific `NO_SOURCES` / `Zero stories from all sources` /
 * `AGGREGATION_FAILED` patterns observed in the previous run.
 */
async function ruleEmptyResultsNotFailure(
  outputDir: string,
  beFiles: string[],
): Promise<RuntimeAuditFinding[]> {
  const findings: RuntimeAuditFinding[] = [];
  // Files that look like aggregation services / workers.
  const FILE_HINT_RE = /(aggregator|aggregation|scanner|ingest|pipeline)\.ts$/i;
  // Forbidden throws.
  const THROW_RES: Array<{ re: RegExp; label: string }> = [
    {
      re: /throw\s+new\s+Error\s*\(\s*["'`]NO_SOURCES["'`]/,
      label: "NO_SOURCES",
    },
    {
      re: /throw\s+new\s+Error\s*\(\s*["'`][^"'`]{0,60}Zero\s+stories[^"'`]*["'`]/i,
      label: "Zero stories from all sources",
    },
    {
      re: /throw\s+new\s+Error\s*\(\s*["'`]AGGREGATION_FAILED["'`]/,
      label: "AGGREGATION_FAILED",
    },
  ];
  for (const file of beFiles) {
    if (!FILE_HINT_RE.test(file) && !/services\//.test(file)) continue;
    const content = await readSafe(file, outputDir);
    if (!content) continue;
    for (const { re, label } of THROW_RES) {
      const m = re.exec(content);
      if (!m) continue;
      const line = content.slice(0, m.index).split("\n").length;
      findings.push({
        id: makeId("empty-results-not-failure", file, line),
        ruleId: "empty-results-not-failure",
        scope: "backend",
        severity: "warn",
        file,
        line,
        snippet: clampSnippet(content.slice(Math.max(0, m.index - 20), m.index + 140)),
        reason: `Aggregation throws \`${label}\` when all upstream sources return zero rows. Empty result is a normal user-visible state, not an error — throwing turns a benign empty feed into a hard failure that leaves stale 'running' rows in the DB.`,
        directive: `Replace the throw with a graceful empty-feed completion: mark the run \`status='completed'\` with \`item_count=0\`, clear the user's existing items (or leave them — depending on the empty-state UX you want), and emit a final SSE \`complete\` event so the frontend transitions to an empty state instead of an error toast.`,
      });
    }
  }
  return findings;
}

// ─── Public entry point ───────────────────────────────────────────────────

export async function runRuntimeIntegrationAudit(
  input: RuntimeIntegrationAuditInput,
): Promise<RuntimeIntegrationAuditResult> {
  const {
    outputDir,
    declaredEnvKeys = [],
    emitter,
    sessionId,
  } = input;

  // appliedOptionalFeatures: prefer caller-provided value, otherwise auto-load
  // from <outputDir>/.blueprint/scaffold-applied.json. The auto-load path
  // means downstream pipelines don't need to thread this through state.
  const appliedOptionalFeatures =
    input.appliedOptionalFeatures !== undefined
      ? input.appliedOptionalFeatures
      : await loadAppliedOptionalFeatures(outputDir);

  const feFiles = await listScopedFiles(outputDir, "frontend");
  const beFiles = await listScopedFiles(outputDir, "backend");

  const disabledRules: RuntimeIntegrationAuditResult["disabledRules"] = [];

  if (!appliedOptionalFeatures.some((f) => PRIVY_FEATURES.has(f))) {
    disabledRules.push({
      ruleId: "external-id-vs-db-pk",
      reason:
        "no auth-* optional scaffold applied — no external user id to resolve.",
    });
  }
  const llmDeclared =
    declaredEnvKeys.includes("LLM_PROVIDER") ||
    declaredEnvKeys.includes("LLM_API_KEY") ||
    declaredEnvKeys.includes("LLM_MODEL");
  if (!llmDeclared) {
    disabledRules.push({
      ruleId: "llm-client-abstraction",
      reason:
        "no LLM_* bundle declared on resource requirements — abstraction rule N/A.",
    });
  }

  const findings: RuntimeAuditFinding[] = [];
  findings.push(...(await ruleUseSyncExternalStore(outputDir, feFiles)));
  findings.push(...(await ruleUseBlockerDataRouter(outputDir, feFiles)));
  findings.push(
    ...(await ruleExternalIdVsDbPk(outputDir, beFiles, appliedOptionalFeatures)),
  );
  findings.push(...(await ruleBgClearStaleRuns(outputDir, beFiles)));
  findings.push(...(await ruleBgInprocBranch(outputDir, beFiles)));
  findings.push(...(await ruleBgWorkerStartup(outputDir, beFiles)));
  findings.push(
    ...(await ruleLlmClientAbstraction(outputDir, beFiles, declaredEnvKeys)),
  );
  findings.push(...(await ruleEmptyResultsNotFailure(outputDir, beFiles)));

  // Dedupe by id (file+line+rule) defensively.
  const seen = new Set<string>();
  const unique: RuntimeAuditFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    unique.push(f);
  }

  const byRule = unique.reduce<Record<string, number>>((acc, f) => {
    acc[f.ruleId] = (acc[f.ruleId] ?? 0) + 1;
    return acc;
  }, {});
  const bySeverity = unique.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  const result: RuntimeIntegrationAuditResult = {
    findings: unique,
    byRule: byRule as Record<RuntimeAuditRuleId, number>,
    bySeverity: bySeverity as Record<RuntimeAuditSeverity, number>,
    hasError: unique.some((f) => f.severity === "error"),
    clean: unique.length === 0,
    disabledRules,
  };

  // Persist the full report so the verify-fix worker can re-read it.
  try {
    const persistRel = PERSIST_REL.split(path.sep).join("/");
    const writeRes = await fsWrite(
      persistRel,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          sessionId,
          appliedOptionalFeatures,
          declaredEnvKeys,
          ...result,
        },
        null,
        2,
      ),
      outputDir,
    );
    if (writeRes.startsWith("ERROR")) {
      console.warn(
        `[runtime-integration-audit] failed to persist report: ${writeRes}`,
      );
    }
  } catch (err) {
    console.warn(
      `[runtime-integration-audit] failed to persist report: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (emitter) {
    emitter({
      stage: "preflight-route-audit",
      sessionId,
      event: "runtime_integration_audit",
      details: {
        clean: result.clean,
        hasError: result.hasError,
        byRule: result.byRule,
        bySeverity: result.bySeverity,
        disabledRules: result.disabledRules,
        findingCount: unique.length,
      },
    });
    if (!result.clean) {
      // Distinct event so the session report can render a Pipeline Anomalies
      // row WITHOUT having to inspect details payloads.
      emitter({
        stage: "preflight-route-audit",
        sessionId,
        event: result.hasError
          ? "runtime_integration_audit_failure"
          : "runtime_integration_audit_warning",
        details: {
          byRule: result.byRule,
          bySeverity: result.bySeverity,
          findingCount: unique.length,
        },
      });
    }
  }

  return result;
}

/**
 * Render a runtime-integration-audit result block suitable for inclusion in
 * the verify-fix worker's opening user message. Returns "" when the audit
 * had nothing actionable.
 */
export function formatRuntimeAuditBlock(
  result: RuntimeIntegrationAuditResult,
): string {
  if (result.clean) return "";
  const lines: string[] = ["", "## Runtime integration audit (deterministic findings)"];
  lines.push(
    `Findings: ${result.findings.length} (${result.bySeverity.error ?? 0} error, ${result.bySeverity.warn ?? 0} warn). Full report: \`.ralph/runtime-integration-audit.json\`.`,
  );
  lines.push("");
  lines.push(
    "Each finding below is pre-classified — fix them in one batch pass before re-running the route audit.",
  );

  // Group by ruleId for compact output.
  const grouped = new Map<RuntimeAuditRuleId, RuntimeAuditFinding[]>();
  for (const f of result.findings) {
    const arr = grouped.get(f.ruleId) ?? [];
    arr.push(f);
    grouped.set(f.ruleId, arr);
  }

  for (const [ruleId, list] of grouped.entries()) {
    const sample = list[0];
    lines.push("");
    lines.push(
      `**[${sample.severity.toUpperCase()}] ${ruleId}** — ${list.length} occurrence(s):`,
    );
    lines.push(`  reason: ${sample.reason}`);
    lines.push(`  directive: ${sample.directive}`);
    for (const f of list.slice(0, 8)) {
      lines.push(`    - ${f.file}:${f.line}`);
    }
    if (list.length > 8) {
      lines.push(`    - … (+${list.length - 8} more, see full report)`);
    }
  }

  if (result.disabledRules.length > 0) {
    lines.push("");
    lines.push(`Rules skipped this run:`);
    for (const d of result.disabledRules) {
      lines.push(`  - ${d.ruleId}: ${d.reason}`);
    }
  }

  return lines.join("\n");
}
