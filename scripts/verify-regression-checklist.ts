/**
 * Regression checklist verifier (CODEGEN_HARDENING_PLAN.md §6.1 / §7.6).
 *
 * Run AFTER you've regenerated a project from the golden PRD with the
 * Phase 1–5 changes in place. The script statically inspects the
 * generated tree and reports pass/fail for the 11 §6.1 checks plus the
 * 7 §7.6 numeric gates.
 *
 * It only READS — never mutates the generated project.
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-regression-checklist.ts \
 *     --outputDir <path-to-generated-code> \
 *     [--prd <path-to-PRD.md>]
 *
 * Exit code: 0 if every HARD check passes, 1 otherwise. Soft warnings
 * (e.g. "markets scanner" task naming) only print, never fail.
 */

import fs from "fs/promises";
import path from "path";

interface CheckResult {
  id: string;
  title: string;
  status: "pass" | "fail" | "skip" | "warn";
  detail: string;
  /** When false, a fail does NOT cause non-zero exit (informational only). */
  hard: boolean;
  /** Plan section reference, e.g. "§6.1" / "§7.6". */
  ref: string;
}

interface Args {
  outputDir: string;
  prdPath?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--outputDir" && next) {
      out.outputDir = path.resolve(next);
      i++;
    } else if (flag === "--prd" && next) {
      out.prdPath = path.resolve(next);
      i++;
    } else if (flag === "-h" || flag === "--help") {
      console.log(
        "Usage: tsx scripts/verify-regression-checklist.ts --outputDir <path> [--prd <path>]",
      );
      process.exit(0);
    }
  }
  if (!out.outputDir) {
    console.error("error: --outputDir is required");
    process.exit(2);
  }
  return out as Args;
}

async function readSafe(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf-8");
  } catch {
    return null;
  }
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T = unknown>(abs: string): Promise<T | null> {
  const raw = await readSafe(abs);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function listFilesRec(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.name === "node_modules" || e.name === ".git") continue;
      if (e.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out;
}

// ─── Check helpers ────────────────────────────────────────────────────────

function pass(id: string, title: string, ref: string, detail = "ok"): CheckResult {
  return { id, title, status: "pass", detail, hard: true, ref };
}
function fail(id: string, title: string, ref: string, detail: string): CheckResult {
  return { id, title, status: "fail", detail, hard: true, ref };
}
function skip(id: string, title: string, ref: string, detail: string): CheckResult {
  return { id, title, status: "skip", detail, hard: false, ref };
}
function warn(id: string, title: string, ref: string, detail: string): CheckResult {
  return { id, title, status: "warn", detail, hard: false, ref };
}

// ─── §6.1 checks (1-11) ───────────────────────────────────────────────────

async function check_useAuthSnapshotCached(out: string): Promise<CheckResult> {
  const id = "6.1.1";
  const title = "frontend useAuth caches useSyncExternalStore snapshot";
  const ref = "§6.1";
  // Look for the canonical hook file; fall back to grep if path differs.
  const candidates = [
    "frontend/src/hooks/useAuth.ts",
    "frontend/src/store/useAuth.ts",
    "frontend/src/state/useAuth.ts",
  ];
  for (const rel of candidates) {
    const body = await readSafe(path.join(out, rel));
    if (body == null) continue;
    if (!/\buseSyncExternalStore\s*\(/.test(body)) {
      return skip(id, title, ref, `${rel} exists but does not use useSyncExternalStore — not applicable`);
    }
    if (
      /\bcachedSnapshot\b/.test(body) ||
      /let\s+snapshot\s*[:=]/.test(body) ||
      /useMemo\s*\(\s*\(\s*\)\s*=>\s*\(\{[\s\S]{0,200}\}\)/.test(body)
    ) {
      return pass(id, title, ref, `${rel} uses cached snapshot`);
    }
    return fail(id, title, ref, `${rel} uses useSyncExternalStore but does NOT cache snapshot — will trigger Maximum update depth`);
  }
  return skip(id, title, ref, "no useAuth.ts variant found — not applicable");
}

async function check_feedControllerResolvesPrivyId(out: string): Promise<CheckResult> {
  const id = "6.1.2";
  const title = "feed.controller getUserId resolves privy_id → DB UUID";
  const ref = "§6.1";
  const rel = "backend/src/api/modules/feed/feed.controller.ts";
  const body = await readSafe(path.join(out, rel));
  if (body == null) return skip(id, title, ref, `${rel} not present — not applicable`);
  // Pass if any handler uses findOne({ where: { *_id: ctx.state.user.id } })
  // BEFORE any findByPk(ctx.state.user.id) call.
  const goodPattern = /findOne\s*\(\s*\{\s*where\s*:\s*\{\s*[a-z]+_id\s*:\s*ctx\.state\.user\.id/;
  const badPattern = /findByPk\s*\(\s*ctx\.state\.user\.id/;
  if (goodPattern.test(body) && !badPattern.test(body.slice(0, body.search(goodPattern)))) {
    return pass(id, title, ref, "uses findOne({ where: { *_id: ctx.state.user.id } }) helper");
  }
  if (badPattern.test(body)) {
    return fail(id, title, ref, "still passes ctx.state.user.id (Privy DID) directly to findByPk → uuid syntax error");
  }
  return warn(id, title, ref, "no privy_id resolver found, but no offending findByPk either — manual review needed");
}

async function check_queueDefaultsInProcess(out: string): Promise<CheckResult> {
  const id = "6.1.3";
  const title = "queue defaults to in-process; BullMQ behind USE_REDIS_QUEUE";
  const ref = "§6.1";
  const rel = "backend/src/utils/queue.ts";
  const body = await readSafe(path.join(out, rel));
  if (body == null) return skip(id, title, ref, `${rel} not present — not applicable`);
  const guarded = /USE_REDIS_QUEUE/.test(body);
  const hardImport = /^import\s+.*from\s+["']bullmq["']/m.test(body);
  if (guarded && !hardImport) return pass(id, title, ref, "in-process default + USE_REDIS_QUEUE flag, BullMQ lazy-loaded");
  if (guarded && hardImport)
    return warn(id, title, ref, "USE_REDIS_QUEUE flag exists but BullMQ is hard-imported — boot will need redis even with the flag off");
  return fail(id, title, ref, "no USE_REDIS_QUEUE flag found — queue path is not in-process by default");
}

async function check_serverStartsWorker(out: string): Promise<CheckResult> {
  const id = "6.1.4";
  const title = "backend/src/server.ts calls await start*Worker()";
  const ref = "§6.1";
  const body = await readSafe(path.join(out, "backend/src/server.ts"));
  if (body == null) return fail(id, title, ref, "backend/src/server.ts missing");
  if (/await\s+start\w*Worker\s*\(/.test(body)) {
    return pass(id, title, ref, "found `await start*Worker()` invocation");
  }
  // No worker module at all → not applicable.
  const workerFiles = await listFilesRec(path.join(out, "backend/src/workers")).catch(
    () => [] as string[],
  );
  if (workerFiles.length === 0) return skip(id, title, ref, "no backend/src/workers/*.ts present — not applicable");
  return fail(id, title, ref, "worker module exists but server.ts never calls start*Worker() — in-process queue has no consumer");
}

async function check_aggregatorEmptyResultGraceful(out: string): Promise<CheckResult> {
  const id = "6.1.5";
  const title = "feedAggregator returns empty feed instead of throwing";
  const ref = "§6.1";
  const candidates = [
    "backend/src/services/feedAggregator.ts",
    "backend/src/services/feed-aggregator.ts",
    "backend/src/services/aggregator.ts",
  ];
  for (const rel of candidates) {
    const body = await readSafe(path.join(out, rel));
    if (body == null) continue;
    const throws = /throw\s+new\s+Error\s*\(\s*["'`](NO_SOURCES|AGGREGATION_FAILED|Zero\s+stories)/.test(body);
    const graceful = /completeEmptyFeedRun\s*\(/.test(body) || /status\s*[:=]\s*['"]completed['"][^]*item_count\s*[:=]\s*0/.test(body);
    if (throws && !graceful) return fail(id, title, ref, `${rel} still throws on zero stories`);
    if (graceful) return pass(id, title, ref, `${rel} uses completeEmptyFeedRun / completed-with-zero pattern`);
    return warn(id, title, ref, `${rel} present, neither throws nor calls completeEmptyFeedRun — manual review`);
  }
  return skip(id, title, ref, "no feedAggregator.ts variant found — not applicable");
}

async function check_llmServiceNoOpenAiLiterals(out: string): Promise<CheckResult> {
  const id = "6.1.6";
  const title = "llmService.ts has no OPENAI_API_KEY / gpt-4o-mini hard-coded";
  const ref = "§6.1";
  const rel = "backend/src/services/llmService.ts";
  const body = await readSafe(path.join(out, rel));
  if (body == null) return skip(id, title, ref, `${rel} not present — not applicable`);
  const offenses: string[] = [];
  if (/OPENAI_API_KEY/.test(body)) offenses.push("OPENAI_API_KEY literal");
  if (/gpt-4o-mini|gpt-4o\b/.test(body)) offenses.push("gpt-4o[-mini] model id");
  if (offenses.length > 0)
    return fail(id, title, ref, `forbidden literals: ${offenses.join(", ")}`);
  return pass(id, title, ref, "no OpenAI-specific literals; reads from LLM_* env bundle");
}

async function check_authGuardBidirectional(out: string): Promise<CheckResult> {
  const id = "6.1.7";
  const title = "AuthGuard handles both unauth + onboarding-incomplete redirects";
  const ref = "§6.1";
  const rel = "frontend/src/components/auth/AuthGuard.tsx";
  const body = await readSafe(path.join(out, rel));
  if (body == null) return skip(id, title, ref, `${rel} not present — not applicable`);
  const handlesUnauth = /isAuthenticated|hasToken|!token|loggedIn/i.test(body);
  const handlesOnboarding = /hasCompletedOnboarding|onboarding/i.test(body);
  if (handlesUnauth && handlesOnboarding) return pass(id, title, ref, "checks both unauth and onboarding state");
  return fail(id, title, ref, `AuthGuard missing one branch — unauth=${handlesUnauth} onboarding=${handlesOnboarding}`);
}

async function check_useUnsavedChangesNoUseBlocker(out: string): Promise<CheckResult> {
  const id = "6.1.8";
  const title = "useUnsavedChanges does NOT import useBlocker";
  const ref = "§6.1";
  const rel = "frontend/src/hooks/useUnsavedChanges.ts";
  const body = await readSafe(path.join(out, rel));
  if (body == null) return skip(id, title, ref, `${rel} not present — not applicable`);
  if (/\buseBlocker\b/.test(body))
    return fail(id, title, ref, "still imports useBlocker — incompatible with BrowserRouter");
  return pass(id, title, ref, "no useBlocker import");
}

async function check_taskBreakdownMarketsScannerSplit(out: string): Promise<CheckResult> {
  const id = "6.1.9";
  const title = "TASK_BREAKDOWN.md splits 'markets scanner' into ≥3 sub-tasks";
  const ref = "§6.1";
  const rel = "TASK_BREAKDOWN.md";
  const body = await readSafe(path.join(out, rel));
  if (body == null) return skip(id, title, ref, `${rel} not present — not applicable`);
  if (!/markets?\s+scanner/i.test(body))
    return skip(id, title, ref, "TASK_BREAKDOWN.md present but no 'markets scanner' task — PRD-specific check, skipping");
  // Heuristic: count occurrences of task headers ("- T-" / "## T-") that
  // mention "scanner" or "market" — should be ≥3.
  const taskLines = body
    .split(/\r?\n/)
    .filter((l) => /^(\s*[-*]\s+|##\s+)?T-\d{2,}/.test(l));
  const scannerTasks = taskLines.filter((l) => /scanner|market/i.test(l));
  if (scannerTasks.length >= 3)
    return pass(id, title, ref, `${scannerTasks.length} scanner sub-tasks found`);
  return fail(id, title, ref, `only ${scannerTasks.length} scanner sub-task(s) — expected ≥3`);
}

async function check_apiContractsHaveJustification(out: string): Promise<CheckResult> {
  const id = "6.1.10";
  const title = "API_CONTRACTS.json: every entry has prdJustification + audience";
  const ref = "§6.1";
  const rel = "API_CONTRACTS.json";
  const arr = await readJsonSafe<unknown[]>(path.join(out, rel));
  if (!Array.isArray(arr)) return skip(id, title, ref, `${rel} not present or not an array — not applicable`);
  const missing: string[] = [];
  for (const entry of arr as Array<Record<string, unknown>>) {
    const id_ = entry.id as string | undefined;
    const j = (entry.prdJustification ?? "") as string;
    const a = entry.audience as string | undefined;
    if (!j || j.trim().length === 0 || !a) {
      missing.push(`${id_ ?? "?"} ${entry.method ?? ""} ${entry.endpoint ?? ""}`);
    }
  }
  if (missing.length === 0) return pass(id, title, ref, `all ${arr.length} entries justified`);
  return fail(
    id,
    title,
    ref,
    `${missing.length}/${arr.length} entries missing prdJustification/audience: ${missing
      .slice(0, 3)
      .join("; ")}${missing.length > 3 ? ` … (+${missing.length - 3})` : ""}`,
  );
}

async function check_integrationVerifyFixCount(out: string): Promise<CheckResult> {
  const id = "6.1.11";
  const title = "integration_verify_fix iterations ≤5 + every contract-pruned has PRD-grep evidence";
  const ref = "§6.1 / §7.6";
  const reportPath = path.join(out, ".ralph", "coding-session-report.json");
  const report = await readJsonSafe<{
    integrationFixAttempts?: number;
    repairSummary?: { byEvent?: Record<string, number>; entries?: Array<{ event?: string; details?: Record<string, unknown> }> };
  }>(reportPath);
  if (!report) return skip(id, title, ref, "no coding-session-report.json yet — run codegen first");

  const attempts = report.integrationFixAttempts ?? 0;
  const repairEntries = report.repairSummary?.entries ?? [];
  const pruneEvents = repairEntries.filter((e) =>
    typeof e.event === "string" && /pruned|contract-surplus/.test(e.event),
  );
  const pruneEventsWithoutEvidence = pruneEvents.filter((e) => {
    const d = e.details ?? {};
    const reason = JSON.stringify(d);
    return !/prd|justification|grep|surplus/i.test(reason);
  });

  const issues: string[] = [];
  if (attempts > 5) issues.push(`integrationFixAttempts=${attempts} (>5)`);
  if (pruneEventsWithoutEvidence.length > 0)
    issues.push(`${pruneEventsWithoutEvidence.length} prune event(s) without PRD evidence`);
  if (issues.length === 0)
    return pass(id, title, ref, `attempts=${attempts}, prunes=${pruneEvents.length}`);
  return fail(id, title, ref, issues.join("; "));
}

// ─── §7.6 numeric gates ────────────────────────────────────────────────────

async function check_76_metrics(out: string): Promise<CheckResult[]> {
  const ref = "§7.6";
  const reportPath = path.join(out, ".ralph", "coding-session-report.json");
  const report = await readJsonSafe<{
    score?: { score?: number };
    integrationFixAttempts?: number;
    gateStates?: Record<string, string>;
    modelUsage?: Array<{ costUsd?: number }>;
  }>(reportPath);
  const contracts = await readJsonSafe<unknown[]>(path.join(out, "API_CONTRACTS.json"));

  const results: CheckResult[] = [];

  // 7.6.a: contract endpoint count ≤ 12
  if (Array.isArray(contracts)) {
    if (contracts.length <= 12)
      results.push(pass("7.6.a", "API_CONTRACTS.json endpoint count ≤ 12", ref, `${contracts.length} entries`));
    else
      results.push(fail("7.6.a", "API_CONTRACTS.json endpoint count ≤ 12", ref, `${contracts.length} entries (>12)`));
  } else {
    results.push(skip("7.6.a", "API_CONTRACTS.json endpoint count ≤ 12", ref, "no API_CONTRACTS.json"));
  }

  if (!report) {
    results.push(skip("7.6.b", "integration_verify_fix iterations ≤ 5", ref, "no report"));
    results.push(skip("7.6.c", "Runtime / E2E gates not SKIPPED", ref, "no report"));
    results.push(skip("7.6.d", "Session score ≥ 75", ref, "no report"));
    results.push(skip("7.6.e", "Total LLM cost ≤ $2.50", ref, "no report"));
    return results;
  }

  // 7.6.b: integrationFixAttempts ≤ 5
  const att = report.integrationFixAttempts ?? 0;
  results.push(
    att <= 5
      ? pass("7.6.b", "integration_verify_fix iterations ≤ 5", ref, `${att}`)
      : fail("7.6.b", "integration_verify_fix iterations ≤ 5", ref, `${att} (>5)`),
  );

  // 7.6.c: runtime / e2e not SKIPPED
  const rt = report.gateStates?.runtimeVerify ?? "skipped";
  const e2e = report.gateStates?.e2eVerify ?? "skipped";
  if (rt !== "skipped" && e2e !== "skipped")
    results.push(pass("7.6.c", "Runtime / E2E gates not SKIPPED", ref, `runtime=${rt} e2e=${e2e}`));
  else
    results.push(fail("7.6.c", "Runtime / E2E gates not SKIPPED", ref, `runtime=${rt} e2e=${e2e}`));

  // 7.6.d: session score ≥ 75
  const score = report.score?.score ?? 0;
  results.push(
    score >= 75
      ? pass("7.6.d", "Session score ≥ 75", ref, `${score}/100`)
      : fail("7.6.d", "Session score ≥ 75", ref, `${score}/100`),
  );

  // 7.6.e: total LLM cost ≤ $2.50
  const totalCost = (report.modelUsage ?? []).reduce(
    (sum, m) => sum + (m.costUsd ?? 0),
    0,
  );
  results.push(
    totalCost <= 2.5
      ? pass("7.6.e", "Total LLM cost ≤ $2.50", ref, `$${totalCost.toFixed(4)}`)
      : fail("7.6.e", "Total LLM cost ≤ $2.50", ref, `$${totalCost.toFixed(4)}`),
  );

  return results;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (!(await exists(args.outputDir))) {
    console.error(`error: --outputDir does not exist: ${args.outputDir}`);
    process.exit(2);
  }

  const sectionChecks: CheckResult[] = await Promise.all([
    check_useAuthSnapshotCached(args.outputDir),
    check_feedControllerResolvesPrivyId(args.outputDir),
    check_queueDefaultsInProcess(args.outputDir),
    check_serverStartsWorker(args.outputDir),
    check_aggregatorEmptyResultGraceful(args.outputDir),
    check_llmServiceNoOpenAiLiterals(args.outputDir),
    check_authGuardBidirectional(args.outputDir),
    check_useUnsavedChangesNoUseBlocker(args.outputDir),
    check_taskBreakdownMarketsScannerSplit(args.outputDir),
    check_apiContractsHaveJustification(args.outputDir),
    check_integrationVerifyFixCount(args.outputDir),
  ]);
  const numericChecks = await check_76_metrics(args.outputDir);
  const all = [...sectionChecks, ...numericChecks];

  const sym = (s: CheckResult["status"]) =>
    s === "pass" ? "✅" : s === "fail" ? "❌" : s === "warn" ? "⚠️ " : "—";

  console.log("\n=== Regression Checklist (CODEGEN_HARDENING_PLAN.md §6.1 + §7.6) ===");
  console.log(`outputDir: ${args.outputDir}\n`);
  for (const c of all) {
    console.log(`${sym(c.status)} [${c.id}] ${c.title}`);
    console.log(`     ${c.ref} — ${c.detail}`);
  }

  const passed = all.filter((c) => c.status === "pass").length;
  const failed = all.filter((c) => c.status === "fail").length;
  const skipped = all.filter((c) => c.status === "skip").length;
  const warned = all.filter((c) => c.status === "warn").length;
  console.log(
    `\nTotals: ${passed} pass, ${failed} fail, ${warned} warn, ${skipped} skip (of ${all.length})`,
  );

  const hardFailures = all.filter((c) => c.status === "fail" && c.hard);
  if (hardFailures.length === 0) {
    console.log("Result: GREEN — all hard checks passed.");
    process.exit(0);
  } else {
    console.log(`Result: RED — ${hardFailures.length} hard check(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verifier crashed:", err);
  process.exit(2);
});
