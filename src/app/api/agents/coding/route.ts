import { NextRequest } from "next/server";
import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";
import { resolveCodeOutputRoot } from "@/lib/pipeline/code-output";
import { createSupervisorGraph } from "@/lib/langgraph/supervisor";
import { EventMapper, type ErrorCategory } from "@/lib/langgraph/event-mapper";
import { prepareE2eArtifacts } from "@/lib/e2e/e2e-artifacts";
import {
  copyScaffold,
  listScaffoldTemplateRelativePaths,
  type ScaffoldTier,
} from "@/lib/pipeline/scaffold-copy";
import {
  distributeSharedSchema,
  distributePipelineDag,
} from "@/lib/pipeline/shared-schema-distributor";
import {
  getTierScaffoldSpecForCodingContext,
  writeScaffoldSpecFile,
} from "@/lib/pipeline/scaffold-spec";
import {
  formatGeneratedCodeDotEnv,
  resolveBlueprintGeneratedDatabaseUrl,
  upsertDatabaseUrlEnv,
  upsertJwtEnvVars,
  upsertBackendPortEnv,
  upsertFrontendApiBaseUrlEnv,
  resolveBackendPort,
  upsertBackendPrivyAppIdMirror,
  resolvePrivyAppIdMirrorFromFilledResources,
} from "@/lib/pipeline/generated-code-env";
import { normalizeProjectTier } from "@/lib/agents/shared/project-classifier";
import {
  readResourceRequirements,
  upsertResourceEnvVars,
  type ResourceRequirement,
} from "@/lib/pipeline/resource-requirements";
import type {
  KickoffWorkItem,
  CodingTask,
  RalphConfig,
} from "@/lib/pipeline/types";
import { stripTestingPhaseTasks } from "@/lib/pipeline/strip-testing-tasks";
import {
  readDesignReferencesFromOutput,
  formatDesignReferencesPromptBlock,
} from "@/lib/pipeline/design-references";
import { DEFAULT_RALPH_CONFIG } from "@/lib/pipeline/types";
import {
  buildFrontendDesignContextForCodegen,
  readPencilDesignDoc,
} from "@/lib/pipeline/frontend-design-context";
import {
  createRepairEmitter,
  createJsonlRepairSink,
  consoleRepairSink,
  registerRepairEmitter,
  unregisterRepairEmitter,
  runFeatureChecklistAudit,
  dispatchAuditRepair,
  AttemptTracker,
  escalateRepairCircuit,
  missingIdsScopeKey,
  type RepairEmitter,
  type RepairEvent,
  type AuditTaskSummary,
  type FeatureChecklistAuditResult,
} from "@/lib/pipeline/self-heal";
import {
  runEvidenceGate,
  collectCodingStageEvidence,
} from "@/lib/pipeline/gates";
import { createMemorySelfHealSink } from "@/lib/memory/self-heal-sink";
import { extractPrdRequirementIndex } from "@/lib/requirements/extract-prd-spec";
import type { PrdSpec } from "@/lib/requirements/prd-spec-types";
import type { ApiContract, GeneratedFile } from "@/lib/langgraph/state";
import {
  writeCodingSessionReport,
  clearCodingSessionLlmUsage,
  getCodingSessionLlmUsage,
} from "@/lib/pipeline/coding-session-report";
import {
  runModelScoringStage,
  type GateResultsSnapshot,
} from "@/lib/pipeline/model-scoring";
import {
  writeSessionCheckpoint,
  clearSessionCheckpoint,
  type TaskCheckpointEntry,
} from "@/lib/pipeline/session-checkpoint";
import { writeTddManifestFromTasks } from "@/lib/pipeline/tdd-manifest";

const execFileAsync = promisify(execFile);

export const maxDuration = 600;

function classifyError(
  error: unknown,
  clientAborted: boolean,
): {
  category: ErrorCategory;
  message: string;
} {
  if (clientAborted) {
    return {
      category: "client_disconnect",
      message: "Client disconnected (SSE closed)",
    };
  }

  if (!(error instanceof Error)) {
    return { category: "unknown", message: String(error) };
  }

  const msg = error.message.toLowerCase();
  const name = error.name;

  if (
    name === "AbortError" ||
    msg.includes("aborted") ||
    msg.includes("cancelled")
  ) {
    return {
      category: "client_disconnect",
      message: `Client aborted: ${error.message}`,
    };
  }

  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("terminated") ||
    msg.includes("exceeded") ||
    name === "TimeoutError"
  ) {
    return {
      category: "timeout",
      message: `Timeout/terminated: ${error.message}`,
    };
  }

  if (
    msg.includes("openrouter") ||
    msg.includes("api error") ||
    msg.includes("rate limit") ||
    msg.includes("model") ||
    msg.includes("codegen api") ||
    msg.includes("empty content") ||
    msg.includes("non-json response")
  ) {
    return { category: "llm_error", message: `LLM error: ${error.message}` };
  }

  return { category: "graph_error", message: error.message };
}

/**
 * Walk a LangGraph stream chunk and extract any {taskId, status, generatedFiles}
 * triples. Used to build `AuditTaskSummary[]` for the feature-checklist audit.
 * Robust to both top-level `taskResults` arrays (worker output) and nested
 * `phaseResults[].taskResults[]` shapes (supervisor output).
 */
function collectTaskResultsFromChunk(
  updates: Record<string, unknown>,
  codingTasks: CodingTask[],
  out: Map<string, AuditTaskSummary>,
): void {
  const taskMeta = new Map(codingTasks.map((t) => [t.id, t] as const));

  const ingest = (rec: Record<string, unknown>): void => {
    const taskId = typeof rec.taskId === "string" ? rec.taskId : null;
    if (!taskId) return;
    const files = Array.isArray(rec.generatedFiles)
      ? (rec.generatedFiles as unknown[]).filter(
          (f): f is string => typeof f === "string",
        )
      : [];
    const status =
      rec.status === "completed" ||
      rec.status === "completed_with_warnings" ||
      rec.status === "failed"
        ? (rec.status as AuditTaskSummary["status"])
        : ("unknown" as const);
    const meta = taskMeta.get(taskId);
    const prev = out.get(taskId);
    const mergedFiles = prev
      ? [...new Set([...prev.generatedFiles, ...files])]
      : files;
    out.set(taskId, {
      id: taskId,
      title: meta?.title ?? (typeof rec.title === "string" ? rec.title : taskId),
      coversRequirementIds: meta?.coversRequirementIds ?? [],
      generatedFiles: mergedFiles,
      status,
    });
  };

  for (const node of Object.keys(updates)) {
    const payload = updates[node];
    if (!payload || typeof payload !== "object") continue;
    const rec = payload as Record<string, unknown>;

    if (Array.isArray(rec.taskResults)) {
      for (const tr of rec.taskResults) {
        if (tr && typeof tr === "object") ingest(tr as Record<string, unknown>);
      }
    }
    if (Array.isArray(rec.phaseResults)) {
      for (const pr of rec.phaseResults) {
        if (!pr || typeof pr !== "object") continue;
        const phase = pr as Record<string, unknown>;
        if (Array.isArray(phase.taskResults)) {
          for (const tr of phase.taskResults) {
            if (tr && typeof tr === "object") {
              ingest(tr as Record<string, unknown>);
            }
          }
        }
      }
    }
  }
}

function collectWorkerContextFromChunk(
  updates: Record<string, unknown>,
  fileRegistryOut: Map<string, GeneratedFile>,
  apiContractsOut: Map<string, ApiContract>,
): void {
  const ingestGeneratedFile = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    if (
      typeof rec.path !== "string" ||
      typeof rec.role !== "string" ||
      typeof rec.summary !== "string"
    ) {
      return;
    }
    const exports = Array.isArray(rec.exports)
      ? rec.exports.filter((item): item is string => typeof item === "string")
      : undefined;
    fileRegistryOut.set(rec.path, {
      path: rec.path,
      role: rec.role as GeneratedFile["role"],
      summary: rec.summary,
      exports,
    });
  };

  const ingestApiContract = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    if (
      typeof rec.service !== "string" ||
      typeof rec.endpoint !== "string" ||
      typeof rec.method !== "string" ||
      typeof rec.authType !== "string" ||
      typeof rec.schema !== "string" ||
      typeof rec.generatedBy !== "string"
    ) {
      return;
    }
    const key = [
      rec.service,
      rec.method.toUpperCase(),
      rec.endpoint,
      rec.generatedBy,
    ].join("::");
    apiContractsOut.set(key, {
      service: rec.service,
      endpoint: rec.endpoint,
      method: rec.method,
      requestFields:
        typeof rec.requestFields === "string" ? rec.requestFields : undefined,
      responseFields:
        typeof rec.responseFields === "string" ? rec.responseFields : undefined,
      authType: rec.authType,
      description:
        typeof rec.description === "string" ? rec.description : undefined,
      schema: rec.schema,
      generatedBy: rec.generatedBy,
    });
  };

  for (const payload of Object.values(updates)) {
    if (!payload || typeof payload !== "object") continue;
    const rec = payload as Record<string, unknown>;

    if (Array.isArray(rec.fileRegistry)) {
      for (const item of rec.fileRegistry) ingestGeneratedFile(item);
    }
    if (Array.isArray(rec.apiContracts)) {
      for (const item of rec.apiContracts) ingestApiContract(item);
    }
  }
}

interface SupervisorGateSnapshot {
  integrationErrors: string;
  runtimeVerifyErrors: string;
  e2eVerifyErrors: string;
  /**
   * Highest observed `scaffoldFixAttempts` across all phase-verify runs.
   * Surfaced in the session report so the user can tell whether scaffold
   * fix phases converged quickly or bumped the iteration ceiling.
   */
  scaffoldFixAttempts: number;
  /** Same for `integrationFixAttempts` from integration verify/fix. */
  integrationFixAttempts: number;
  /**
   * Tracks which gate actually ran — used by the report to render
   * SKIPPED vs PASS/FAIL instead of treating "no error string" as a pass.
   */
  gatesExecuted: {
    integrationVerify: boolean;
    runtimeVerify: boolean;
    e2eVerify: boolean;
  };
}

function collectSupervisorGateStateFromChunk(
  updates: Record<string, unknown>,
  snapshot: SupervisorGateSnapshot,
): void {
  for (const payload of Object.values(updates)) {
    if (!payload || typeof payload !== "object") continue;
    const rec = payload as Record<string, unknown>;
    if (typeof rec.integrationErrors === "string") {
      snapshot.integrationErrors = rec.integrationErrors;
      snapshot.gatesExecuted.integrationVerify = true;
    }
    if (typeof rec.runtimeVerifyErrors === "string") {
      snapshot.runtimeVerifyErrors = rec.runtimeVerifyErrors;
      snapshot.gatesExecuted.runtimeVerify = true;
    }
    if (typeof rec.e2eVerifyErrors === "string") {
      snapshot.e2eVerifyErrors = rec.e2eVerifyErrors;
      snapshot.gatesExecuted.e2eVerify = true;
    }
    if (typeof rec.scaffoldFixAttempts === "number") {
      snapshot.scaffoldFixAttempts = Math.max(
        snapshot.scaffoldFixAttempts,
        rec.scaffoldFixAttempts,
      );
    }
    if (typeof rec.integrationFixAttempts === "number") {
      snapshot.integrationFixAttempts = Math.max(
        snapshot.integrationFixAttempts,
        rec.integrationFixAttempts,
      );
    }
  }
}

function summarizeBlockingGateErrors(snapshot: SupervisorGateSnapshot): string[] {
  const failures: string[] = [];
  if (snapshot.integrationErrors.trim()) {
    failures.push(
      [
        "Integration verify gate failed.",
        snapshot.integrationErrors.trim().slice(0, 3000),
      ].join("\n"),
    );
  }
  if (snapshot.runtimeVerifyErrors.trim()) {
    failures.push(
      [
        "Runtime verify gate failed.",
        snapshot.runtimeVerifyErrors.trim().slice(0, 3000),
      ].join("\n"),
    );
  }
  if (snapshot.e2eVerifyErrors.trim()) {
    failures.push(
      [
        "E2E verify gate failed.",
        snapshot.e2eVerifyErrors.trim().slice(0, 3000),
      ].join("\n"),
    );
  }
  return failures;
}

/**
 * Build a markdown block describing user-provided third-party credentials so
 * coding agents know exactly which env vars are wired up and what each is for.
 * Filled vs. unfilled values are surfaced separately so workers don't pretend
 * a missing key exists. The actual secret values are NEVER shown to the LLM —
 * only the env var names + descriptions.
 */
function formatResourceRequirementsPromptBlock(
  items: ResourceRequirement[],
  appliedOptionalFeatures: string[] = [],
): string {
  if (items.length === 0) return "";
  const filled = items.filter((r) => (r.value ?? "").trim().length > 0);
  const unfilled = items.filter((r) => !(r.value ?? "").trim());

  const lines: string[] = [];
  lines.push("## External resources & credentials (env vars)");
  lines.push("");
  lines.push(
    "The user provided the following third-party credentials at kickoff. " +
      "Use these EXACT env var names when reading from `process.env` or `import.meta.env`. " +
      "Do NOT invent alternative names. Secret values themselves are never exposed here — they live in `backend/.env` / `frontend/.env`.",
  );
  lines.push("");

  if (filled.length > 0) {
    lines.push("### Configured (values present in .env, ready to use)");
    lines.push("");
    for (const r of filled) {
      const reqMark = r.required ? " — required" : " — optional";
      // Non-secret config values (LLM_PROVIDER="gemini", USE_REDIS_QUEUE="0", …)
      // are surfaced inline so workers can branch on them at code-gen time.
      // Secret values are NEVER shown — only the env var name + description.
      const inlineValue = r.isConfig
        ? ` = \`${(r.value ?? "").trim()}\``
        : "";
      lines.push(
        `- **\`${r.envKey}\`**${inlineValue} (${r.category}${reqMark}): ${r.description}`,
      );
    }
    lines.push("");
  }

  if (unfilled.length > 0) {
    lines.push("### Declared but NOT yet configured (treat the corresponding feature as disabled / stubbed)");
    lines.push("");
    for (const r of unfilled) {
      const reqMark = r.required ? " — required" : " — optional";
      lines.push(`- \`${r.envKey}\` (${r.category}${reqMark}): ${r.description}`);
    }
    lines.push("");
    lines.push(
      "For unfilled keys: write code that reads the env var defensively " +
        "(check `process.env.X` for truthy value before calling the integration); " +
        "if absent, log a clear warning and gracefully degrade. Do NOT hardcode placeholder values.",
    );
    lines.push("");
  }

  // ── LLM provider abstraction (when LLM_* bundle is present) ────────────
  const declaredKeys = new Set(items.map((r) => r.envKey));
  if (
    declaredKeys.has("LLM_PROVIDER") ||
    declaredKeys.has("LLM_API_KEY") ||
    declaredKeys.has("LLM_MODEL")
  ) {
    lines.push("### LLM provider abstraction (HARD RULE)");
    lines.push("");
    lines.push(
      "This project declared the `LLM_*` env bundle. ALL LLM calls (chat, " +
        "summarisation, ranking, embeddings) MUST go through ONE provider-aware " +
        "client at `backend/src/services/llmService.ts` that reads `LLM_PROVIDER` " +
        "and instantiates the matching adapter. NEVER hardcode `https://api.openai.com/v1`, " +
        "a vendor-specific env var (`OPENAI_API_KEY`, `GEMINI_API_KEY`), or a model id " +
        "in feature files. Switching providers must be a one-line `.env` change with " +
        "zero source edits — the audit will fail any direct vendor SDK import outside `llmService.ts`.",
    );
    lines.push("");
  }

  // ── Auth integration directives ────────────────────────────────────────
  // Phase 3 split scaffold so OAuth SDK files are conditionally copied via
  // `_optional/auth-*`. The prompt now distinguishes:
  //   (a) detected provider with `_optional/auth-<x>` already applied → tell
  //       the worker the SDK files are ALREADY on disk; only wire onLogin
  //       and (optionally) the auth bridge hook.
  //   (b) detected provider with NO matching optional feature → fall back to
  //       the legacy "install + create Provider + rewrite LoginModal" flow.
  const oauthMatches = detectOauthIntegrations(items);
  if (oauthMatches.length > 0) {
    const appliedSet = new Set(appliedOptionalFeatures);

    const coveredByScaffold: OauthProviderInfo[] = [];
    const needsManualWiring: OauthProviderInfo[] = [];
    for (const m of oauthMatches) {
      if (m.optionalScaffoldFeature && appliedSet.has(m.optionalScaffoldFeature)) {
        coveredByScaffold.push(m);
      } else {
        needsManualWiring.push(m);
      }
    }

    if (coveredByScaffold.length > 0) {
      lines.push(
        "### Authentication integration (scaffold already shipped — wire it up)",
      );
      lines.push("");
      lines.push(
        "The kickoff resource detector triggered the optional scaffold " +
          "feature(s) listed below, so the SDK files have ALREADY been copied " +
          "into the generated project (see `.blueprint/scaffold-applied.json`). " +
          "DO NOT re-create them. Your task is to wire the existing files into " +
          "your landing/login page and a top-level layout.",
      );
      lines.push("");
      for (const m of coveredByScaffold) {
        lines.push(
          `- **${m.providerLabel}** — \`_optional/${m.optionalScaffoldFeature}\` applied (env: \`${m.envKey}\`)`,
        );
        lines.push(
          `  - SDK already shipped: \`frontend/src/providers/${m.providerComponent}.tsx\`, an OAuth-aware \`frontend/src/providers/AppProviders.tsx\`, an OAuth-aware \`frontend/src/components/auth/LoginModal.tsx\` (uses the SDK login hook), \`frontend/src/hooks/usePrivyAuthBridge.ts\` (or equivalent helper), plus backend middleware \`backend/src/middlewares/${m.optionalScaffoldFeature?.replace("auth-", "")}Auth.ts\` and SDK client. Dependency \`${m.npmPackage}\`${m.serverPackage ? ` (and \`${m.serverPackage}\`)` : ""} already in \`package.json\`.`,
        );
        lines.push(
          `  - In the landing / login page (e.g. \`frontend/src/views/LandingPage.tsx\`): render \`<LoginModal>\` and pass \`onLogin={(providerToken) => useAuth().login(providerToken)}\`. Do NOT re-implement the modal.`,
        );
        lines.push(
          `  - In a top-level layout (e.g. \`frontend/src/App.tsx\` or whatever wraps the router): call the auth-bridge hook once (\`usePrivyAuthBridge()\` for \`auth-privy\`). It auto-syncs the provider's access token into \`AuthContext\` so \`apiClient\` attaches it as \`Bearer\`. The backend middleware (already shipped) verifies it on every request — no separate \`/api/auth/verify\` exchange is required unless your PRD demands an internal JWT.`,
        );
        lines.push(
          `  - Backend HARD RULE: every controller / service that reads \`ctx.state.user.id\` MUST resolve the EXTERNAL provider id to the internal DB UUID first via \`User.findOne({ where: { ${m.optionalScaffoldFeature?.replace("auth-", "")}_id: ctx.state.user.id } })\`. NEVER call \`findByPk(ctx.state.user.id)\` with a provider DID — Postgres throws \`invalid input syntax for type uuid\`. See "External identity vs database primary key" in the backend role prompt.`,
        );
        lines.push("");
      }
    }

    if (needsManualWiring.length > 0) {
      lines.push(
        "### Authentication integration (NOT covered by an _optional scaffold — implement manually)",
      );
      lines.push("");
      lines.push(
        "The provider(s) below have no matching `_optional/auth-*` scaffold " +
          "yet, so you MUST plan and implement the integration end-to-end:",
      );
      lines.push("");
      for (const m of needsManualWiring) {
        lines.push(`- **${m.providerLabel}** (env: \`${m.envKey}\`)`);
        lines.push(
          `  - install: \`${m.npmPackage}\` in \`frontend/package.json\`${m.serverPackage ? ` (and \`${m.serverPackage}\` in \`backend/package.json\` for token verification)` : ""}`,
        );
        lines.push(
          `  - create \`frontend/src/providers/${m.providerComponent}.tsx\`: mount the real SDK Provider using \`${m.envKey}\` from \`import.meta.env\`. Do NOT leave it as a passthrough \`<>{children}</>\`.`,
        );
        lines.push(
          `  - modify \`frontend/src/components/auth/LoginModal.tsx\`: import the SDK login hook, drop the email+password fields, render a button that triggers the provider flow, and forward the resulting access token to the parent via \`onLogin(token)\`.`,
        );
        lines.push(
          `  - modify \`frontend/src/providers/AppProviders.tsx\`: wrap \`<AuthProvider>\` with the new provider component.`,
        );
        lines.push(
          `  - the page that renders \`LoginModal\` MUST pass an \`onLogin\` handler that calls the auth backend (e.g. \`POST /api/auth/verify\`) and then promotes local auth state on success.`,
        );
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

/**
 * Map known OAuth env keys to their SDK details so we can emit explicit
 * integration directives. Extending this is the right way to add support
 * for new providers (Auth0, Clerk, Supabase Auth, NextAuth, etc.).
 */
interface OauthProviderInfo {
  envKey: string;
  providerLabel: string;
  npmPackage: string;
  serverPackage?: string;
  /** Component name (without extension) for the provider wrapper. */
  providerComponent: string;
  /**
   * When set, this env triggers the matching `scaffolds/<tier>/_optional/<feature>`
   * directory to be copied into the generated project (see Phase 3:
   * `src/lib/pipeline/scaffold-optional.ts`). The prompt block uses this
   * to decide whether to tell the worker "SDK already shipped, just wire
   * it" (when applied) versus "you must implement end-to-end" (no
   * matching feature yet). Keep in sync with `_optional/manifest.json`.
   */
  optionalScaffoldFeature?: string;
}

const OAUTH_PROVIDER_REGISTRY: OauthProviderInfo[] = [
  {
    envKey: "VITE_PRIVY_APP_ID",
    providerLabel: "Privy (Twitter / Farcaster / wallet OAuth)",
    npmPackage: "@privy-io/react-auth",
    serverPackage: "@privy-io/node",
    providerComponent: "PrivyProvider",
    optionalScaffoldFeature: "auth-privy",
  },
  {
    envKey: "NEXT_PUBLIC_PRIVY_APP_ID",
    providerLabel: "Privy (Next.js)",
    npmPackage: "@privy-io/react-auth",
    serverPackage: "@privy-io/node",
    providerComponent: "PrivyProvider",
    optionalScaffoldFeature: "auth-privy",
  },
  {
    envKey: "VITE_CLERK_PUBLISHABLE_KEY",
    providerLabel: "Clerk",
    npmPackage: "@clerk/clerk-react",
    serverPackage: "@clerk/backend",
    providerComponent: "ClerkProvider",
    optionalScaffoldFeature: "auth-clerk",
  },
  {
    envKey: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    providerLabel: "Clerk (Next.js)",
    npmPackage: "@clerk/nextjs",
    providerComponent: "ClerkProvider",
    optionalScaffoldFeature: "auth-clerk",
  },
  {
    envKey: "VITE_AUTH0_DOMAIN",
    providerLabel: "Auth0",
    npmPackage: "@auth0/auth0-react",
    providerComponent: "Auth0Provider",
  },
  {
    envKey: "VITE_SUPABASE_URL",
    providerLabel: "Supabase Auth",
    npmPackage: "@supabase/supabase-js",
    providerComponent: "SupabaseProvider",
  },
  {
    envKey: "VITE_GOOGLE_CLIENT_ID",
    providerLabel: "Google OAuth",
    npmPackage: "@react-oauth/google",
    providerComponent: "GoogleAuthProvider",
  },
];

function detectOauthIntegrations(
  items: ResourceRequirement[],
): OauthProviderInfo[] {
  const matches: OauthProviderInfo[] = [];
  const seen = new Set<string>();
  for (const r of items) {
    const info = OAUTH_PROVIDER_REGISTRY.find((p) => p.envKey === r.envKey);
    if (info && !seen.has(info.providerLabel)) {
      seen.add(info.providerLabel);
      matches.push(info);
    }
  }
  return matches;
}

/**
 * Resolve the scaffold tier for a coding session.
 * Priority: explicit `projectTier` arg → PRD.md badge in outputDir → default "M".
 * Defaulting to "M" for pure-frontend (S-tier) projects causes a backend
 * directory to be scaffolded, which in turn breaks E2E because playwright.config.ts
 * tries to start a backend server that can't connect to any database.
 */
async function resolveTier(
  projectTier: string | undefined,
  outputRoot: string,
): Promise<ScaffoldTier> {
  // Always run through normalizeProjectTier so the L → M downgrade applies
  // even when the caller passes an explicit "L" via the request body or
  // when the PRD.md badge says L.
  if (projectTier) return normalizeProjectTier(projectTier) as ScaffoldTier;
  try {
    const prdPath = path.join(outputRoot, "PRD.md");
    const prdContent = await fs.readFile(prdPath, "utf-8");
    const match = prdContent.match(/\*\*Project Tier:\s*([SML])\*\*/i);
    if (match) {
      const extracted = normalizeProjectTier(match[1]);
      console.log(`[CodingAPI] Resolved tier from PRD.md badge: ${extracted}`);
      return extracted as ScaffoldTier;
    }
  } catch {
    // PRD.md may not exist yet; fall through to default
  }
  console.warn("[CodingAPI] projectTier not provided and PRD.md has no tier badge — defaulting to M");
  return "M";
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    runId,
    tasks,
    codeOutputDir,
    projectTier,
    ralph: ralphOverride,
    databaseUrl: databaseUrlBody,
    prd: prdBody,
    retryFailedTaskIds,
  } = body as {
    runId: string;
    tasks: KickoffWorkItem[];
    codeOutputDir?: string;
    projectTier?: string;
    ralph?: Partial<RalphConfig>;
    /** Optional override; otherwise `BLUEPRINT_GENERATED_DATABASE_URL` (server .env.local). */
    databaseUrl?: string;
    /** PRD content passed from the UI to guarantee the correct project PRD is used. */
    prd?: string;
    /**
     * When set, ONLY tasks whose IDs are in this list will be executed.
     * All other tasks are considered already-completed and skipped.
     * Used for "retry failed tasks only" workflows.
     */
    retryFailedTaskIds?: string[];
  };

  const ralphConfig: RalphConfig = {
    ...DEFAULT_RALPH_CONFIG,
    ...(ralphOverride ?? {}),
  };

  if (!runId || !Array.isArray(tasks) || tasks.length === 0) {
    return Response.json(
      { error: "runId and non-empty tasks array are required" },
      { status: 400 },
    );
  }

  const tasksAfterStrip = stripTestingPhaseTasks(tasks);
  if (tasksAfterStrip.length === 0) {
    return Response.json(
      { error: "No tasks to run after task normalization" },
      { status: 400 },
    );
  }

  // When retryFailedTaskIds is provided, only run those tasks.
  // All other tasks are considered already-completed and pre-populated
  // into collectedTaskResults as "completed_with_warnings" so the rest of
  // the pipeline (audit, scoring, reports) still sees them.
  const retrySet = retryFailedTaskIds && retryFailedTaskIds.length > 0
    ? new Set(retryFailedTaskIds)
    : null;
  const tasksToRun = retrySet
    ? tasksAfterStrip.filter((t) => retrySet.has(t.id))
    : tasksAfterStrip;
  const tasksSkipped = retrySet
    ? tasksAfterStrip.filter((t) => !retrySet.has(t.id))
    : [];

  if (retrySet && tasksToRun.length === 0) {
    return Response.json(
      { error: "None of the retryFailedTaskIds matched any known task" },
      { status: 400 },
    );
  }

  const outputRoot = resolveCodeOutputRoot(process.cwd(), codeOutputDir);

  // Pencil exports live under frontend/public/design; cleanup removes `frontend/`. Stash PNGs
  // so they survive scaffold refresh (markdown stays at repo root via KEEP_MD).
  const pencilDesignStash = path.join(outputRoot, ".agentic-pencil-design-stash");
  const pencilDesignSrc = path.join(outputRoot, "frontend", "public", "design");
  try {
    await fs.rm(pencilDesignStash, { recursive: true, force: true });
    await fs.access(pencilDesignSrc);
    await fs.cp(pencilDesignSrc, pencilDesignStash, { recursive: true });
    console.log(
      "[CodingAPI] Stashed frontend/public/design (Pencil exports) before cleanup.",
    );
  } catch {
    /* no prior exports */
  }

  // Robust cleanup: handle each entry individually so one failure doesn't stop the rest.
  // Keep .git (RALPH commits), specific doc .md files, and .ralph tracking dir.
  const KEEP_ENTRIES = new Set([".git", ".ralph"]);
  const KEEP_MD = new Set([
    "PRD.md",
    "TRD.md",
    "SystemDesign.md",
    "ImplementationGuide.md",
    "DesignSpec.md",
    "PencilDesign.md",
    "PRD_E2E_SPEC.md",
    "E2E_COVERAGE.md",
  ]);
  await fs.mkdir(outputRoot, { recursive: true });
  const entries = await fs.readdir(outputRoot).catch(() => [] as string[]);
  let removedCount = 0;
  for (const entry of entries) {
    if (KEEP_ENTRIES.has(entry)) continue;
    if (entry.endsWith(".md") && KEEP_MD.has(entry)) continue;
    const entryPath = path.join(outputRoot, entry);
    try {
      await fs.rm(entryPath, { recursive: true, force: true });
      removedCount++;
    } catch (e) {
      console.warn(
        `[CodingAPI] Could not remove ${entry}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  console.log(
    `[CodingAPI] Cleaned output directory: ${outputRoot} (removed ${removedCount} entries)`,
  );

  const tier = await resolveTier(projectTier, outputRoot);

  // Read user-provided resource requirements (API keys, OAuth secrets, etc.)
  // collected during the kickoff phase BEFORE the scaffold copy so the
  // optional-feature layer can use them as triggers (e.g. VITE_PRIVY_APP_ID
  // → copy `_optional/auth-privy/**`). See CODEGEN_HARDENING_PLAN.md §4.10.
  const resourceRequirements = await readResourceRequirements(process.cwd());

  // Always overwrite scaffold files so fresh copies are guaranteed even if cleanup was partial.
  let scaffoldCopied: string[] = [];
  let appliedOptionalScaffolds: string[] = [];
  try {
    const result = await copyScaffold(tier, outputRoot, {
      forceOverwrite: true,
      resourceRequirements,
    });
    scaffoldCopied = result.copied;
    appliedOptionalScaffolds = result.optional.applied;
    console.log(
      `[CodingAPI] Scaffold (${tier} tier): wrote ${scaffoldCopied.length} base file(s) + ${result.optional.copiedFiles.length} optional file(s) (${appliedOptionalScaffolds.length} feature(s) applied) to ${outputRoot}`,
    );
  } catch (e) {
    console.warn(
      `[CodingAPI] Scaffold copy warning: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Persist the applied optional-scaffold list so downstream stages
  // (task-breakdown, worker prompts, post-gen audits) can reference it
  // without re-deriving from triggers.
  if (appliedOptionalScaffolds.length > 0) {
    try {
      await fs.mkdir(path.join(outputRoot, ".blueprint"), { recursive: true });
      await fs.writeFile(
        path.join(outputRoot, ".blueprint", "scaffold-applied.json"),
        JSON.stringify(
          {
            tier,
            generatedAt: new Date().toISOString(),
            appliedOptionalFeatures: appliedOptionalScaffolds,
          },
          null,
          2,
        ) + "\n",
        "utf-8",
      );
    } catch (e) {
      console.warn(
        `[CodingAPI] Failed to persist scaffold-applied.json: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  try {
    await fs.access(pencilDesignStash);
    await fs.mkdir(pencilDesignSrc, { recursive: true });
    await fs.cp(pencilDesignStash, pencilDesignSrc, { recursive: true });
    await fs.rm(pencilDesignStash, { recursive: true, force: true });
    console.log(
      "[CodingAPI] Restored frontend/public/design after scaffold (Pencil PNG exports).",
    );
  } catch {
    /* nothing stashed */
  }

  try {
    await writeScaffoldSpecFile(outputRoot, tier);
  } catch (e) {
    console.warn(
      `[CodingAPI] writeScaffoldSpecFile warning: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Replicate the TRD-confirmed shared schema (.blueprint/shared-schema.ts)
  // into the per-tier consumer roots so workers see a single source of
  // truth for cross-boundary types. No-op when the TRD step did not emit
  // a schema (S-tier projects often skip TRD entirely).
  let distributedSharedSchemaPaths: string[] = [];
  try {
    const dist = await distributeSharedSchema(tier, outputRoot);
    distributedSharedSchemaPaths = dist.written;
    if (dist.found) {
      console.log(
        `[CodingAPI] Shared schema distributed: ${dist.written.length} location(s) — ${dist.written.join(", ")}`,
      );
    } else {
      console.log(
        `[CodingAPI] Shared schema not distributed: source ${dist.sourcePath} missing or empty (TRD likely skipped).`,
      );
    }
  } catch (e) {
    console.warn(
      `[CodingAPI] distributeSharedSchema warning: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Replicate the TRD workflow DAG (.blueprint/pipeline-dag.yaml). Lives
  // at outputRoot/.blueprint/pipeline-dag.yaml — workers read it as a
  // reference for service ordering when implementing pipeline tasks.
  let distributedDagPath: string | null = null;
  try {
    const dist = await distributePipelineDag(outputRoot);
    distributedDagPath = dist.written;
    if (dist.found) {
      console.log(
        `[CodingAPI] Pipeline DAG distributed: ${dist.written}`,
      );
    } else {
      console.log(
        `[CodingAPI] Pipeline DAG not distributed: source ${dist.sourcePath} missing (TRD §8 omitted — project has no multi-step pipelines).`,
      );
    }
  } catch (e) {
    console.warn(
      `[CodingAPI] distributePipelineDag warning: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const resolvedDbUrl = resolveBlueprintGeneratedDatabaseUrl(databaseUrlBody);
  if (resolvedDbUrl) {
    try {
      await fs.writeFile(path.join(outputRoot, ".env"), formatGeneratedCodeDotEnv(resolvedDbUrl), "utf-8");
      console.log("[CodingAPI] Wrote generated-code .env with DATABASE_URL.");
    } catch (e) {
      console.warn(
        `[CodingAPI] Failed to write .env: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Filled-value subset of `resourceRequirements` used for env file
  // population (the optional-scaffold copy above only cares about the
  // declarations, not the values). See CODEGEN_HARDENING_PLAN.md §4.10.
  const filledResources = resourceRequirements.filter(
    (r) => (r.value ?? "").trim().length > 0,
  );
  const frontendResources = filledResources.filter((r) =>
    /^(VITE_|NEXT_PUBLIC_)/.test(r.envKey),
  );
  const backendResources = filledResources.filter(
    (r) => !/^(VITE_|NEXT_PUBLIC_)/.test(r.envKey),
  );

  // Always ensure backend/.env has JWT_SECRET (and DATABASE_URL if available).
  const backendEnvPath = path.join(outputRoot, "backend", ".env");
  try {
    const existingBackendEnv = await fs.readFile(backendEnvPath, "utf-8").catch(() => "");
    const withDbUrl = resolvedDbUrl
      ? upsertDatabaseUrlEnv(existingBackendEnv, resolvedDbUrl)
      : existingBackendEnv;
    const withJwt = upsertJwtEnvVars(withDbUrl);
    const withPort = upsertBackendPortEnv(withJwt);
    const withResources = upsertResourceEnvVars(withPort, backendResources);
    const privyMirror = resolvePrivyAppIdMirrorFromFilledResources(filledResources);
    const withPrivyMirror = upsertBackendPrivyAppIdMirror(
      withResources,
      privyMirror,
    );
    await fs.writeFile(backendEnvPath, withPrivyMirror, "utf-8");
    console.log(
      `[CodingAPI] Synced backend/.env (PORT + DATABASE_URL + JWT + PRIVY_APP_ID mirror + ${backendResources.length} backend resource(s)).`,
    );
  } catch (e) {
    console.warn(
      `[CodingAPI] Failed to sync backend/.env: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Frontend env vars (VITE_* / NEXT_PUBLIC_*) need to land in frontend/.env.
  // We always overwrite VITE_API_BASE_URL to keep it in sync with backend PORT
  // (single source of truth = BLUEPRINT_BACKEND_PORT, defaults to 4000).
  {
    const frontendEnvPath = path.join(outputRoot, "frontend", ".env");
    try {
      const existingFrontendEnv = await fs
        .readFile(frontendEnvPath, "utf-8")
        .catch(() => "");
      const withApiBase = upsertFrontendApiBaseUrlEnv(
        existingFrontendEnv,
        resolveBackendPort(),
      );
      const merged = upsertResourceEnvVars(withApiBase, frontendResources);
      await fs.writeFile(frontendEnvPath, merged, "utf-8");
      console.log(
        `[CodingAPI] Synced frontend/.env (VITE_API_BASE_URL + ${frontendResources.length} user resource(s)).`,
      );
    } catch (e) {
      console.warn(
        `[CodingAPI] Failed to sync frontend/.env: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const scaffoldProtectedPaths = await listScaffoldTemplateRelativePaths(tier);
  // Distributed shared-schema files are written outside the scaffold
  // template walker, so merge them in explicitly. Workers must not
  // overwrite the canonical TRD-frozen schema.
  for (const p of distributedSharedSchemaPaths) {
    if (!scaffoldProtectedPaths.includes(p)) scaffoldProtectedPaths.push(p);
  }
  if (distributedDagPath && !scaffoldProtectedPaths.includes(distributedDagPath)) {
    scaffoldProtectedPaths.push(distributedDagPath);
  }

  // Run installs for every package root present in the scaffold.
  const installTargets = tier === "M" ? ["frontend", "backend"] : [""];
  for (const relTarget of installTargets) {
    const targetDir = relTarget ? path.join(outputRoot, relTarget) : outputRoot;
    const hasPkg = await fs
      .access(path.join(targetDir, "package.json"))
      .then(() => true)
      .catch(() => false);
    if (!hasPkg) continue;
    try {
      console.log(
        `[CodingAPI] Running pnpm install for scaffold at ${relTarget || "."}...`,
      );
      await execFileAsync("pnpm", ["install", "--no-frozen-lockfile"], {
        cwd: targetDir,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000,
      });
      console.log(`[CodingAPI] pnpm install OK at ${relTarget || "."}.`);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const detail = (
        err.stderr ||
        err.stdout ||
        err.message ||
        String(e)
      ).slice(0, 400);
      console.warn(
        `[CodingAPI] pnpm install warning at ${relTarget || "."}: ${detail}`,
      );
    }
  }

  const readDoc = async (name: string, limit?: number): Promise<string> => {
    try {
      const raw = await fs.readFile(path.join(outputRoot, name), "utf-8");
      if (!raw.trim()) return "";
      return limit && raw.length > limit
        ? `${raw.slice(0, limit)}\n\n[${name} truncated]`
        : raw;
    } catch {
      return "";
    }
  };

  // If the caller passed PRD content directly, write it to disk before reading.
  // This guarantees the correct project PRD is used even when the file on disk
  // belongs to a previous session (e.g. after a retry without a fresh kickoff).
  if (prdBody && prdBody.trim().length > 0) {
    try {
      await fs.writeFile(path.join(outputRoot, "PRD.md"), prdBody, "utf-8");
      console.log("[CodingAPI] PRD.md overwritten from request body (session PRD pinning).");
    } catch (e) {
      console.warn(
        `[CodingAPI] Failed to write PRD.md from request body: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Docs are passed through to the supervisor/worker graph as-is; the
  // downstream `pickRelevantSections` helper trims per-task. Keep a
  // generous safety cap here purely to protect against runaway docs.
  const DOC_HARD_CAP = 60_000;
  const prdDoc = await readDoc("PRD.md");
  const trdDoc = await readDoc("TRD.md", DOC_HARD_CAP);
  const sysDesignDoc = await readDoc("SystemDesign.md", DOC_HARD_CAP);
  const implGuideDoc = await readDoc("ImplementationGuide.md", DOC_HARD_CAP);
  const designSpecDoc = await readDoc("DesignSpec.md", DOC_HARD_CAP);

  // Read the structured PRD spec sidecar written by the kickoff engine.
  // Non-fatal: if absent or unparseable, frontend workers just won't get
  // PAGE-*/CMP-* context (the pre-existing behaviour).
  let prdSpec: PrdSpec | null = null;
  try {
    const raw = await fs.readFile(
      path.join(outputRoot, ".blueprint", "PRD_SPEC.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as PrdSpec;
    if (parsed && Array.isArray(parsed.pages)) prdSpec = parsed;
  } catch {
    /* sidecar missing — proceed without it */
  }
  const pencilDesignDoc = await readPencilDesignDoc(outputRoot);
  const scaffoldReadmePath = path.resolve(
    process.cwd(),
    "scaffolds",
    "m-tier",
    "README.md",
  );
  const scaffoldReadmeDoc =
    tier === "M"
      ? await fs
          .readFile(scaffoldReadmePath, "utf-8")
          .then((raw) =>
            raw.length > 12000
              ? `${raw.slice(0, 12000)}\n\n[m-tier README truncated]`
              : raw,
          )
          .catch(() => "")
      : "";

  const baseContextParts: string[] = [];
  if (prdDoc) baseContextParts.push(`## PRD\n\n${prdDoc}`);
  if (trdDoc) baseContextParts.push(`## TRD\n\n${trdDoc}`);
  if (sysDesignDoc)
    baseContextParts.push(`## System Design\n\n${sysDesignDoc}`);
  if (implGuideDoc)
    baseContextParts.push(`## Implementation Guide\n\n${implGuideDoc}`);

  const designReferenceEntries =
    await readDesignReferencesFromOutput(outputRoot);
  const designReferencesBlock = formatDesignReferencesPromptBlock(
    designReferenceEntries,
  );
  if (designReferencesBlock) {
    baseContextParts.push(designReferencesBlock);
    console.log(
      `[CodingAPI] Injected ${designReferenceEntries.length} design reference(s) into projectContext.`,
    );
  }

  const resourcesContextBlock = formatResourceRequirementsPromptBlock(
    resourceRequirements,
    appliedOptionalScaffolds,
  );
  if (resourcesContextBlock) {
    baseContextParts.push(resourcesContextBlock);
    console.log(
      `[CodingAPI] Injected ${resourceRequirements.length} resource requirement(s) into projectContext (${filledResources.length} configured).`,
    );
  }

  const scaffoldContextBlock = [
    "## Scaffold specification",
    "",
    "The repository includes **SCAFFOLD_SPEC.md** (tier layout, commands, where to implement).",
    "Follow that layout; extend the prebuilt scaffold structure instead of replacing it wholesale.",
    "",
    ...(scaffoldReadmeDoc
      ? [
          `## Scaffold README Reference (${scaffoldReadmePath})`,
          "",
          scaffoldReadmeDoc,
          "",
        ]
      : []),
    getTierScaffoldSpecForCodingContext(tier),
  ].join("\n");

  const preparedE2e = await prepareE2eArtifacts({
    outputRoot,
    prdDoc,
    tasks: tasksAfterStrip,
  });

  const projectContext =
    baseContextParts.length > 0
      ? [
          baseContextParts.join("\n\n---\n\n"),
          scaffoldContextBlock,
          preparedE2e.e2eContextBlock,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n")
      : [
          "No project documents found. Generate code based on task description only.",
          scaffoldContextBlock,
          preparedE2e.e2eContextBlock,
        ]
          .filter(Boolean)
          .join("\n\n---\n\n");

  const frontendDesignContext = await buildFrontendDesignContextForCodegen(
    outputRoot,
    designSpecDoc,
    pencilDesignDoc,
  );

  const normalizedTasks = [...tasksToRun, ...preparedE2e.extraTasks];
  const codingTasks: CodingTask[] = normalizedTasks.map((t) => ({
    ...t,
    assignedAgentId: null,
    codingStatus: "pending" as const,
  }));

  const sessionId = uuidv4();
  const mapper = new EventMapper(sessionId);
  const encoder = new TextEncoder();

  let clientAborted = false;
  request.signal.addEventListener("abort", () => {
    clientAborted = true;
    console.warn(
      `[CodingAPI] Session ${sessionId}: client disconnected (signal aborted)`,
    );
  });

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = new Date().toISOString();
      function send(data: unknown) {
        if (clientAborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          clientAborted = true;
        }
      }

      // ── Self-heal telemetry ────────────────────────────────────────────────
      // Fan out repair events to: (1) SSE channel (front-end log panel),
      // (2) .ralph/repair-log.jsonl on disk, (3) stdout for dev observability.
      const sseRepairSink: RepairEmitter = (event) => {
        send(mapper.buildRepairEvent(event as RepairEvent));
      };
      // In-memory counter sink — feeds the model-scoring stage in the
      // finally block. Non-blocking; pure counter, no I/O.
      const repairCounters = {
        truncation: 0,
        stagnation: 0,
        fallback: 0,
      };
      const counterRepairSink: RepairEmitter = (event) => {
        const name = event.event;
        if (name === "truncation_detected" || name === "doc_truncated") {
          repairCounters.truncation += 1;
        } else if (name === "stagnation_warning") {
          repairCounters.stagnation += 1;
        } else if (name.includes("fallback")) {
          repairCounters.fallback += 1;
        }
      };
      const repairEmitter = createRepairEmitter([
        sseRepairSink,
        createJsonlRepairSink(outputRoot),
        consoleRepairSink,
        counterRepairSink,
        // Memory L2 sink: persist meaningful repair events as self-heal-log
        // records. Uses the request's runId as kickoffId so records link
        // back to the project-card written by the pipeline/kickoff routes.
        createMemorySelfHealSink({
          outputDir: outputRoot,
          kickoffSessionId: typeof runId === "string" && runId.length > 0 ? runId : sessionId,
        }),
      ]);
      registerRepairEmitter(sessionId, repairEmitter);
      const auditAttemptTracker = new AttemptTracker({
        outputDir: outputRoot,
      });
      await auditAttemptTracker.load();
      const collectedTaskResults = new Map<string, AuditTaskSummary>();
      // Pre-populate skipped tasks (from previous session) as completed_with_warnings
      // so they appear in audit and scoring reports without being re-generated.
      for (const t of tasksSkipped) {
        collectedTaskResults.set(t.id, {
          id: t.id,
          title: t.title,
          coversRequirementIds: t.coversRequirementIds ?? [],
          generatedFiles: [],
          status: "completed_with_warnings",
        });
      }
      if (retrySet) {
        console.log(
          `[CodingAPI] Retry mode: running ${tasksToRun.length} task(s), skipping ${tasksSkipped.length} previously-completed task(s).`,
        );
        // Clear the checkpoint since we're retrying — will be re-written on completion.
        await clearSessionCheckpoint(process.cwd());
      }
      const collectedFileRegistry = new Map<string, GeneratedFile>();
      const collectedApiContracts = new Map<string, ApiContract>();
      const collectedGateSnapshot: SupervisorGateSnapshot = {
        integrationErrors: "",
        runtimeVerifyErrors: "",
        e2eVerifyErrors: "",
        scaffoldFixAttempts: 0,
        integrationFixAttempts: 0,
        gatesExecuted: {
          integrationVerify: false,
          runtimeVerify: false,
          e2eVerify: false,
        },
      };
      let reportTaskResults: AuditTaskSummary[] = [];
      let finalAuditResult: FeatureChecklistAuditResult | null = null;
      let reportStatus: "pass" | "fail" | "aborted" = "fail";
      let terminalSummary = "";
      let fatalError = "";

      console.log(
        `[CodingAPI] Session ${sessionId}: starting with ${codingTasks.length} tasks, output: ${outputRoot}`,
      );

      send(
        mapper.buildSessionStart(
          codingTasks.map((t) => ({
            ...t,
            assignedAgentId: null,
          })),
        ),
      );

      const graph = createSupervisorGraph();

      try {
        const prebuiltScaffold = scaffoldCopied.length > 0;
        if (prebuiltScaffold) {
          console.log(
            `[CodingAPI] prebuiltScaffold=true — architect tasks will skip LLM (${scaffoldCopied.length} template file(s) copied).`,
          );
        }

        try {
          const tddManifest = await writeTddManifestFromTasks(outputRoot, codingTasks);
          console.log(
            `[CodingAPI] TDD manifest written with ${tddManifest.testCount} test(s): ${tddManifest.path}`,
          );
        } catch (e) {
          console.warn(`[CodingAPI] TDD manifest write failed: ${e}`);
        }

        // RALPH Phase 1+3: initialise progress tracker and write IMPLEMENTATION_PLAN.md
        if (ralphConfig.enabled) {
          try {
            const { ProgressTracker } = await import("@/lib/ralph");
            const tracker = new ProgressTracker(outputRoot);
            await tracker.init(codingTasks, sessionId);
            console.log(
              `[CodingAPI] RALPH enabled — progress tracker initialised at ${outputRoot}/.ralph/`,
            );
          } catch (e) {
            console.warn(
              `[CodingAPI] RALPH progress tracker init failed: ${e}`,
            );
          }
        }

        const streamIterator = await graph.stream(
          {
            tasks: codingTasks,
            outputDir: outputRoot,
            projectContext,
            frontendDesignContext,
            prebuiltScaffold,
            scaffoldProtectedPaths,
            ralphConfig,
            sessionId,
            prdSpec,
          },
          { subgraphs: true, streamMode: "updates", recursionLimit: 10000 },
        );

        for await (const chunk of streamIterator) {
          if (clientAborted) {
            console.warn(
              `[CodingAPI] Session ${sessionId}: stopping iteration — client disconnected`,
            );
            break;
          }

          const [ns, updates] = chunk as [string[], Record<string, unknown>];
          const nodeNames = Object.keys(updates);
          console.log(
            `[CodingAPI] Stream chunk: ns=[${ns.join(",")}] nodes=[${nodeNames.join(",")}]`,
          );

          collectTaskResultsFromChunk(
            updates,
            codingTasks,
            collectedTaskResults,
          );
          collectWorkerContextFromChunk(
            updates,
            collectedFileRegistry,
            collectedApiContracts,
          );
          collectSupervisorGateStateFromChunk(updates, collectedGateSnapshot);

          const events = mapper.mapChunk(
            chunk as [string[], Record<string, unknown>],
          );
          for (const event of events) {
            send(event);
          }
        }

        if (!clientAborted) {
          console.log(`[CodingAPI] Session ${sessionId}: stream complete.`);

          const prdIndex = extractPrdRequirementIndex(prdDoc ?? "");
          const auditTaskResults: AuditTaskSummary[] = codingTasks.map(
            (t) =>
              collectedTaskResults.get(t.id) ?? {
                id: t.id,
                title: t.title,
                coversRequirementIds: t.coversRequirementIds ?? [],
                generatedFiles: [],
                status: "unknown" as const,
              },
          );
          reportTaskResults = auditTaskResults;
          let finalAudit = await runFeatureChecklistAudit({
            prdIndex,
            prdSpec,
            tasks: codingTasks,
            taskResults: auditTaskResults,
            outputDir: outputRoot,
            sessionId,
            emitter: repairEmitter,
          });

          if (finalAudit.uncovered.length > 0) {
            const dispatchResult = await dispatchAuditRepair({
              uncovered: finalAudit.uncovered,
              outputDir: outputRoot,
              projectContext,
              fileRegistrySnapshot: [...collectedFileRegistry.values()],
              apiContractsSnapshot: [...collectedApiContracts.values()],
              scaffoldProtectedPaths,
              ralphConfig,
              sessionId,
              emitter: repairEmitter,
              attemptTracker: auditAttemptTracker,
            });

            if (dispatchResult.circuitOpenRoles?.length) {
              const frontendIds = finalAudit.uncovered
                .filter((e) => /^(PAGE|CMP|IC)-/i.test(e.id))
                .map((e) => e.id);
              const backendIds = finalAudit.uncovered
                .filter((e) => !/^(PAGE|CMP|IC)-/i.test(e.id))
                .map((e) => e.id);
              for (const role of dispatchResult.circuitOpenRoles) {
                const ids = role === "frontend" ? frontendIds : backendIds;
                await escalateRepairCircuit({
                  scope: {
                    stage: "post-gen-audit",
                    scopeKey: `${role}:${missingIdsScopeKey(ids)}`,
                  },
                  tracker: auditAttemptTracker,
                  outputDir: outputRoot,
                  emitter: repairEmitter,
                  sessionId,
                  reason: `Audit-repair dispatch circuit opened for role=${role} — worker subgraph cannot close the gap after 3+ attempts on the same uncovered-id set.`,
                });
              }
            }

            if (
              dispatchResult.backendGeneratedFiles.length +
                dispatchResult.frontendGeneratedFiles.length >
              0
            ) {
              // Backfill wrote something — re-run the audit to see what
              // actually got closed. We intentionally do NOT loop again;
              // one repair round is the hard upper bound.
              finalAudit = await runFeatureChecklistAudit({
                prdIndex,
                prdSpec,
                tasks: [...codingTasks, ...dispatchResult.repairTasks],
                taskResults: [
                  ...auditTaskResults,
                  ...dispatchResult.repairTaskResults,
                ],
                outputDir: outputRoot,
                sessionId,
                emitter: repairEmitter,
              });
              reportTaskResults = [
                ...auditTaskResults,
                ...dispatchResult.repairTaskResults,
              ];
            }
          }
          finalAuditResult = finalAudit;

          // Evidence gate (Phase A pilot) — read persisted .ralph/*.json
          // artefacts written by the supervisor's smoke/tsc/tdd validators
          // and refuse the stage if any required validator is missing or
          // failing. Telemetry-only during the rollout — does not block
          // pipeline advance yet so we observe evidence-gate decisions
          // alongside the existing audit-driven blocking.
          try {
            const { evidence, missingArtefacts } =
              await collectCodingStageEvidence(outputRoot);
            const evidenceReport = runEvidenceGate("coding", evidence);
            repairEmitter({
              sessionId,
              stage: "post-gen-audit",
              event: "evidence_gate_evaluated",
              details: {
                passed: evidenceReport.passed,
                missingRequirements: evidenceReport.missingRequirements,
                missingArtefacts,
                evidenceCount: evidence.length,
              },
            });
          } catch (evidenceErr) {
            console.warn(
              `[CodingAPI] evidence gate threw (non-fatal):`,
              evidenceErr instanceof Error ? evidenceErr.message : evidenceErr,
            );
          }

          const blockingFailures = summarizeBlockingGateErrors(
            collectedGateSnapshot,
          );
          if (!finalAudit.passed) {
            // Use hardUncovered to exclude IC-xx interaction specs (soft warnings).
            const remainingIds = (finalAudit.hardUncovered ?? finalAudit.uncovered.filter((e) => !/^IC-\d+$/i.test(e.id))).map((entry) => entry.id);
            blockingFailures.push(
              [
                `Feature audit gate failed: ${remainingIds.length} requirement id(s) still unresolved.`,
                remainingIds.slice(0, 40).join(", "),
              ]
                .filter(Boolean)
                .join("\n"),
            );
          }
          if (blockingFailures.length > 0) {
            throw new Error(blockingFailures.join("\n\n"));
          }

          reportStatus = "pass";
          terminalSummary =
            "Coding session completed with integration, runtime/E2E, and feature-audit gates passing.";
          send(mapper.buildSessionComplete());
        }
      } catch (error) {
        const classified = classifyError(error, clientAborted);
        reportStatus = clientAborted ? "aborted" : "fail";
        terminalSummary = classified.message;
        fatalError = classified.message;
        console.error(
          `[CodingAPI] Session ${sessionId} error [${classified.category}]:`,
          classified.message,
          error instanceof Error ? `\n  name=${error.name}` : "",
          error instanceof Error && error.stack
            ? `\n  stack=${error.stack.split("\n").slice(0, 4).join("\n  ")}`
            : "",
        );
        send(mapper.buildSessionError(classified.message, classified.category));
      } finally {
        if (clientAborted && reportStatus === "fail" && !fatalError) {
          reportStatus = "aborted";
          terminalSummary = "Client disconnected before the coding session completed.";
          fatalError = terminalSummary;
        }
        try {
          await writeCodingSessionReport({
            sessionId,
            outputDir: outputRoot,
            startedAt,
            endedAt: new Date().toISOString(),
            status: reportStatus,
            terminalSummary:
              terminalSummary || "Coding session ended without an explicit summary.",
            integrationErrors: collectedGateSnapshot.integrationErrors,
            runtimeVerifyErrors: collectedGateSnapshot.runtimeVerifyErrors,
            e2eVerifyErrors: collectedGateSnapshot.e2eVerifyErrors,
            scaffoldFixAttempts: collectedGateSnapshot.scaffoldFixAttempts,
            integrationFixAttempts:
              collectedGateSnapshot.integrationFixAttempts,
            gatesExecuted: collectedGateSnapshot.gatesExecuted,
            finalAudit: finalAuditResult,
            taskResults:
              reportTaskResults.length > 0
                ? reportTaskResults
                : codingTasks.map((task) => ({
                    id: task.id,
                    title: task.title,
                    coversRequirementIds: task.coversRequirementIds ?? [],
                    generatedFiles:
                      collectedTaskResults.get(task.id)?.generatedFiles ?? [],
                    status:
                      collectedTaskResults.get(task.id)?.status ?? "unknown",
                  })),
            fileRegistry: [...collectedFileRegistry.values()],
            fatalError,
          });
        } catch (reportErr) {
          console.warn(
            `[CodingAPI] Failed to write coding session report (ignored):`,
            reportErr instanceof Error ? reportErr.message : reportErr,
          );
        }

        // ── Model scoring stage ────────────────────────────────────────────
        // Build per-session scorecard, append to project leaderboard, diff
        // MODEL_CONFIG vs previous run. Never throws; errors are logged.
        // See src/lib/pipeline/model-scoring/.
        try {
          const sessionLlmUsage = getCodingSessionLlmUsage(sessionId);
          const sessionTaskResults =
            reportTaskResults.length > 0
              ? reportTaskResults
              : codingTasks.map((task) => ({
                  id: task.id,
                  title: task.title,
                  coversRequirementIds: task.coversRequirementIds ?? [],
                  generatedFiles:
                    collectedTaskResults.get(task.id)?.generatedFiles ?? [],
                  status:
                    collectedTaskResults.get(task.id)?.status ?? "unknown",
                }));

          const tasksTotal = sessionTaskResults.length;
          const tasksCompleted = sessionTaskResults.filter(
            (t) => t.status === "completed",
          ).length;
          const tasksCompletedWithWarnings = sessionTaskResults.filter(
            (t) => t.status === "completed_with_warnings",
          ).length;
          const tasksFailed = sessionTaskResults.filter(
            (t) => t.status === "failed",
          ).length;

          const gateResults: GateResultsSnapshot = {
            integrationExecuted:
              collectedGateSnapshot.gatesExecuted.integrationVerify,
            integrationPassed:
              collectedGateSnapshot.gatesExecuted.integrationVerify &&
              !collectedGateSnapshot.integrationErrors.trim(),
            runtimeExecuted:
              collectedGateSnapshot.gatesExecuted.runtimeVerify,
            runtimePassed:
              collectedGateSnapshot.gatesExecuted.runtimeVerify &&
              !collectedGateSnapshot.runtimeVerifyErrors.trim(),
            e2eExecuted: collectedGateSnapshot.gatesExecuted.e2eVerify,
            e2ePassed:
              collectedGateSnapshot.gatesExecuted.e2eVerify &&
              !collectedGateSnapshot.e2eVerifyErrors.trim(),
            auditPassed: finalAuditResult?.passed ?? true,
            uncoveredRequirementCount:
              finalAuditResult?.uncovered.length ?? 0,
            tasksTotal,
            tasksCompleted,
            tasksCompletedWithWarnings,
            tasksFailed,
            truncationEventCount: repairCounters.truncation,
            stagnationEventCount: repairCounters.stagnation,
            fallbackTriggerCount: repairCounters.fallback,
            integrationFixAttempts:
              collectedGateSnapshot.integrationFixAttempts,
            scaffoldFixAttempts: collectedGateSnapshot.scaffoldFixAttempts,
          };

          const scoringResult = await runModelScoringStage({
            sessionId,
            projectPath: outputRoot,
            outputDir: outputRoot,
            endedAt: new Date().toISOString(),
            llmUsage: sessionLlmUsage,
            taskResults: sessionTaskResults,
            gateResults,
          });
          console.log(
            `[CodingAPI] Model scoring done: session=${scoringResult.scorecard.sessionComposite.score}(${scoringResult.scorecard.sessionComposite.grade}), ` +
              `rows=${scoringResult.scorecard.rows.length}, ` +
              `modelChange=${scoringResult.hasModelChange ? "YES" : "no"}` +
              (scoringResult.errors.length > 0
                ? ` (${scoringResult.errors.length} warning(s))`
                : ""),
          );
          if (scoringResult.errors.length > 0) {
            for (const err of scoringResult.errors) {
              console.warn(`[CodingAPI] model-scoring warning: ${err}`);
            }
          }
        } catch (scoringErr) {
          console.warn(
            `[CodingAPI] Model scoring stage failed (ignored):`,
            scoringErr instanceof Error ? scoringErr.message : scoringErr,
          );
        }

        // ── Session checkpoint ─────────────────────────────────────────────
        // Persist task results so the next run can skip already-completed
        // tasks via `retryFailedTaskIds`.
        try {
          const checkpointMap = new Map<string, TaskCheckpointEntry>();
          for (const [id, result] of collectedTaskResults) {
            checkpointMap.set(id, {
              status: result.status,
              generatedFiles: result.generatedFiles,
            });
          }
          await writeSessionCheckpoint(process.cwd(), sessionId, checkpointMap);
        } catch (cpErr) {
          console.warn(
            `[CodingAPI] Checkpoint write failed (ignored):`,
            cpErr instanceof Error ? cpErr.message : cpErr,
          );
        }

        clearCodingSessionLlmUsage(sessionId);
        unregisterRepairEmitter(sessionId);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
