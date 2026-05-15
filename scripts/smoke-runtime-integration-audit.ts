/**
 * Smoke test for `src/lib/pipeline/self-heal/runtime-integration-audit.ts`.
 *
 * Builds a synthetic generated-code project under /tmp/audit-smoke that
 * deliberately violates every Phase-5 rule, runs the audit, and asserts
 * that all 8 rule ids fire (or are explicitly disabled with a reason).
 *
 * Run with:  pnpm exec tsx scripts/smoke-runtime-integration-audit.ts
 */

import fs from "fs/promises";
import path from "path";
import {
  runRuntimeIntegrationAudit,
  formatRuntimeAuditBlock,
  type RuntimeAuditRuleId,
} from "../src/lib/pipeline/self-heal/runtime-integration-audit";

const ROOT = "/tmp/audit-smoke";

const FILES: Array<{ rel: string; body: string }> = [
  {
    rel: ".blueprint/scaffold-applied.json",
    body: JSON.stringify(
      {
        tier: "m",
        generatedAt: "2026-04-29T00:00:00Z",
        appliedOptionalFeatures: ["auth-privy"],
      },
      null,
      2,
    ) + "\n",
  },
  // §4.2-A — useSyncExternalStore without snapshot caching.
  {
    rel: "frontend/src/store/useAuth.ts",
    body: `import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let state = { token: null as string | null };

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAuth() {
  return useSyncExternalStore(subscribe, () => ({
    token: state.token,
    isAuthenticated: !!state.token,
  }));
}
`,
  },
  // §4.2-B — useBlocker import in a BrowserRouter project.
  {
    rel: "frontend/src/main.tsx",
    body: `import { BrowserRouter } from "react-router-dom";
import { App } from "./views/App";

export function Bootstrap() {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
`,
  },
  {
    rel: "frontend/src/views/SettingsPage.tsx",
    body: `import { useBlocker } from "react-router-dom";

export function SettingsPage() {
  const blocker = useBlocker(true);
  return <div>{blocker.state}</div>;
}
`,
  },
  // §4.3 (external-id-vs-db-pk) + §4.4-A (no clearActiveRunsForUser) + §4.4-B (no inproc: branch)
  {
    rel: "backend/src/api/modules/feed/feed.controller.ts",
    body: `import Router from "@koa/router";
import { User, FeedAggregationRun } from "../../../models";

const apiRouter = new Router();

apiRouter.post("/feed/refresh", async (ctx) => {
  const user = await User.findByPk(ctx.state.user.id);
  if (!user) ctx.throw(404);
  ctx.body = { ok: true };
});

apiRouter.get("/feed/stream", async (ctx) => {
  const runId = ctx.query.run_id as string;
  const run = await FeedAggregationRun.findByPk(runId);
  ctx.body = run;
});

export default apiRouter;
`,
  },
  // §4.5 (direct OpenAI import) + §4.7 (NO_SOURCES throw).
  {
    rel: "backend/src/services/feedAggregator.ts",
    body: `import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function runFeedAggregation(_userId: string) {
  const stories: unknown[] = [];
  if (stories.length === 0) {
    throw new Error("NO_SOURCES");
  }
  return openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "summarise" }],
  });
}
`,
  },
  // §4.4-C — startFeedWorker exists but server.ts never calls it.
  {
    rel: "backend/src/workers/feedAggregationWorker.ts",
    body: `export async function startFeedWorker() {
  /* in-process consumer */
}
`,
  },
  {
    rel: "backend/src/server.ts",
    body: `import { app } from "./app";

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log("server listening on " + port);
});
`,
  },
];

async function setup() {
  await fs.rm(ROOT, { recursive: true, force: true });
  for (const { rel, body } of FILES) {
    const abs = path.join(ROOT, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, "utf-8");
  }
}

let totalAssertions = 0;
let failedAssertions = 0;

function assert(name: string, cond: boolean, detail?: unknown): void {
  totalAssertions++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failedAssertions++;
    console.log(
      `  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`,
    );
  }
}

const EXPECTED_RULES_FIRED: RuntimeAuditRuleId[] = [
  "useSyncExternalStore-cached",
  "useBlocker-needs-data-router",
  "external-id-vs-db-pk",
  "bg-job-clear-stale-runs",
  "bg-job-inproc-branch",
  "bg-job-worker-startup",
  "llm-client-abstraction",
  "empty-results-not-failure",
];

async function main() {
  await setup();

  const result = await runRuntimeIntegrationAudit({
    outputDir: ROOT,
    declaredEnvKeys: [
      "LLM_PROVIDER",
      "LLM_API_KEY",
      "LLM_MODEL",
      "DATABASE_URL",
    ],
  });

  console.log("─── Summary ───");
  console.log(`clean=${result.clean}  hasError=${result.hasError}`);
  console.log("byRule=", result.byRule);
  console.log("bySeverity=", result.bySeverity);
  console.log("disabledRules=", result.disabledRules);

  console.log("\n─── Findings ───");
  for (const f of result.findings) {
    console.log(`[${f.severity}] ${f.ruleId} @ ${f.file}:${f.line}`);
  }

  console.log("\n─── Rendered prompt block ───");
  console.log(formatRuntimeAuditBlock(result));

  console.log("\n─── Assertions ───");
  assert("audit returned non-empty findings", !result.clean);
  assert("audit set hasError=true", result.hasError);
  assert("disabledRules is empty (all 8 rules active)", result.disabledRules.length === 0, result.disabledRules);

  for (const id of EXPECTED_RULES_FIRED) {
    assert(`rule fired: ${id}`, (result.byRule[id] ?? 0) > 0, result.byRule);
  }

  // Persistence check.
  const persisted = await fs.readFile(
    path.join(ROOT, ".ralph", "runtime-integration-audit.json"),
    "utf-8",
  );
  const parsed = JSON.parse(persisted);
  assert(
    "persisted findings count matches in-memory result",
    Array.isArray(parsed.findings) &&
      parsed.findings.length === result.findings.length,
    { persisted: parsed.findings?.length, inMemory: result.findings.length },
  );

  // Re-run with no LLM_* declared → llm-client-abstraction must be DISABLED.
  const noLlmResult = await runRuntimeIntegrationAudit({
    outputDir: ROOT,
    declaredEnvKeys: ["DATABASE_URL"],
  });
  assert(
    "llm rule disabled when no LLM_* declared",
    noLlmResult.disabledRules.some(
      (d) => d.ruleId === "llm-client-abstraction",
    ),
  );
  assert(
    "no llm-client-abstraction findings when rule is disabled",
    (noLlmResult.byRule["llm-client-abstraction"] ?? 0) === 0,
  );

  // Re-run with no auth-* feature → external-id-vs-db-pk must be DISABLED.
  const noAuthResult = await runRuntimeIntegrationAudit({
    outputDir: ROOT,
    appliedOptionalFeatures: [], // override autoload
    declaredEnvKeys: ["LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL"],
  });
  assert(
    "external-id rule disabled when no auth-* feature",
    noAuthResult.disabledRules.some(
      (d) => d.ruleId === "external-id-vs-db-pk",
    ),
  );
  assert(
    "no external-id findings when rule is disabled",
    (noAuthResult.byRule["external-id-vs-db-pk"] ?? 0) === 0,
  );

  console.log(
    `\nAssertions: ${totalAssertions - failedAssertions}/${totalAssertions} passed.`,
  );
  process.exit(failedAssertions === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke driver crashed:", err);
  process.exit(2);
});
