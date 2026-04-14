import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { StateGraph, START, END, Send } from "@langchain/langgraph";
import {
  SupervisorStateAnnotation,
  type SupervisorState,
  type WorkerState,
  type PhaseResult,
  type GeneratedFile,
  type ApiContract,
  type TaskResult,
} from "./state";
import {
  createWorkerSubGraph,
  classifyTscErrors,
  installMissingDeps,
  extractMissingPackages,
  extractErrorFiles,
  inferRelatedConfigFiles,
  hasConfigErrors,
  findBestTsconfigForFiles,
  buildVersionConstraints,
} from "./agent-subgraph";
import {
  ensurePrismaDatasourceDatabaseUrl,
  formatGeneratedCodeDotEnv,
  resolveBlueprintGeneratedDatabaseUrl,
} from "@/lib/pipeline/generated-code-env";
import {
  shellExec,
  execPrismaGenerate,
  fsWrite,
  fsRead,
  listFiles,
  detectPackageManager,
  buildInstallCommand,
  buildAddCommand,
  isAutoInstallableNpmPackageName,
  type FsWriteOptions,
} from "./tools";
import {
  chatCompletionWithFallback,
  resolveModel,
  estimateCost,
  type ChatMessage,
  type OpenRouterToolDefinition,
} from "@/lib/openrouter";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import type {
  CodingAgentRole,
  CodingTask,
  KickoffWorkItem,
} from "@/lib/pipeline/types";
import { stripTestingPhaseTasks } from "@/lib/pipeline/strip-testing-tasks";

const execFileAsync = promisify(execFile);

// ─── Role inference ───

const PHASE_TO_ROLE: Record<string, CodingAgentRole> = {
  Scaffolding: "architect",
  "Data Layer": "architect",
  Infrastructure: "architect",
  "Auth & Gateway": "backend",
  "Backend Services": "backend",
  Integration: "backend",
  Frontend: "frontend",
  Testing: "test",
};

function inferRole(task: KickoffWorkItem): CodingAgentRole {
  if (PHASE_TO_ROLE[task.phase]) return PHASE_TO_ROLE[task.phase];
  const lower = `${task.phase} ${task.title} ${task.description}`.toLowerCase();
  if (/test|spec|e2e|vitest|playwright|k6|coverage/.test(lower)) return "test";
  if (
    /scaffold|infra|docker|helm|ci\/cd|deploy|config|schema|migrat/.test(lower)
  )
    return "architect";
  if (
    /frontend|react|component|page|ui|css|tailwind|hook|store|vite/.test(lower)
  )
    return "frontend";
  return "backend";
}

function isFrontendOnly(state: SupervisorState): boolean {
  return state.backendTasks.length === 0;
}

const ENABLE_PHASE_INCREMENTAL_CONTEXT_SYNC =
  process.env.BLUEPRINT_INCREMENTAL_CONTEXT_SYNC !== "0";

function workersForRole(role: CodingAgentRole, count: number): number {
  if (role === "architect" || role === "test") return 1;
  // Strict context mode: keep one worker per coding role so each task sees
  // the latest outputs from previous tasks within the same role.
  if (
    ENABLE_PHASE_INCREMENTAL_CONTEXT_SYNC &&
    (role === "backend" || role === "frontend")
  ) {
    return 1;
  }
  if (count <= 3) return 1;
  if (count <= 8) return 2;
  return 3;
}

function chunkTasks<T>(tasks: T[], chunks: number): T[][] {
  if (chunks <= 1) return [tasks];
  const result: T[][] = Array.from({ length: chunks }, () => []);
  tasks.forEach((t, i) => result[i % chunks].push(t));
  return result.filter((c) => c.length > 0);
}

// ─── Nodes ───

function classifyTasks(state: SupervisorState) {
  const tasks = stripTestingPhaseTasks(state.tasks);
  const byRole: Record<CodingAgentRole, CodingTask[]> = {
    architect: [],
    backend: [],
    frontend: [],
    test: [],
  };
  for (const task of tasks) {
    const role = inferRole(task);
    byRole[role].push(task);
  }

  const frontendOnly = byRole.backend.length === 0;
  if (frontendOnly) {
    console.log(
      "[Supervisor] Detected frontend-only project (no backend tasks).",
    );
  }
  console.log(
    `[Supervisor] Task classification: architect=${byRole.architect.length}, backend=${byRole.backend.length}, frontend=${byRole.frontend.length}, test=${byRole.test.length} (all parallel after scaffold)`,
  );

  let projectContext = state.projectContext;
  if (frontendOnly) {
    projectContext =
      `## PROJECT TYPE: FRONTEND-ONLY\nThis is a frontend-only project. Use React + Vite + TypeScript + Tailwind CSS.\nDo NOT use Next.js, Express, Prisma, or any server-side technology.\n\n` +
      projectContext;
  }

  return {
    tasks,
    architectTasks: byRole.architect,
    backendTasks: byRole.backend,
    frontendTasks: byRole.frontend,
    testTasks: byRole.test,
    projectContext,
  };
}

const workerGraph = createWorkerSubGraph();

function scaffoldWriteOpts(
  state: SupervisorState,
  forceOverwrite: boolean,
): FsWriteOptions | undefined {
  const paths = state.scaffoldProtectedPaths;
  if (!paths || paths.length === 0) return undefined;
  return {
    scaffoldProtectedPaths: paths,
    forceProtectedOverwrite: forceOverwrite,
  };
}

const PREBUILT_REGISTRY_MAX_FILES = 500;

const PREBUILT_SKIP_PATH_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
]);

function shouldIncludeInPrebuiltRegistry(rel: string): boolean {
  const norm = rel.replace(/\\/g, "/");
  const parts = norm.split("/");
  for (const p of parts) {
    if (PREBUILT_SKIP_PATH_SEGMENTS.has(p)) return false;
  }
  if (norm.endsWith(".DS_Store") || norm.endsWith(".swp")) return false;
  if (/(^|\/)\.env($|\..+)/.test(norm)) return false;
  return true;
}

/**
 * Register scaffold files + write ARCHITECTURE_SCAFFOLD.md (no LLM).
 */
async function buildPrebuiltScaffoldRegistryAndDoc(
  outputDir: string,
): Promise<GeneratedFile[]> {
  const all = await listFiles(".", outputDir);
  const filtered = all.filter(shouldIncludeInPrebuiltRegistry).sort();
  const capped = filtered.slice(0, PREBUILT_REGISTRY_MAX_FILES);
  const registry: GeneratedFile[] = capped.map((p) => ({
    path: p,
    role: "architect",
    summary: "Prebuilt tier scaffold",
  }));

  let scriptsSection = "(no root package.json or scripts)";
  const pkgRaw = await fsRead("package.json", outputDir);
  if (!pkgRaw.startsWith("FILE_NOT_FOUND") && !pkgRaw.startsWith("REJECTED")) {
    try {
      const j = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      if (j.scripts && Object.keys(j.scripts).length > 0) {
        scriptsSection = Object.entries(j.scripts)
          .map(([k, v]) => `- \`${k}\`: \`${String(v)}\``)
          .join("\n");
      }
    } catch {
      scriptsSection = "(could not parse package.json)";
    }
  }

  const listCap = 400;
  const listLines = filtered.slice(0, listCap);
  const moreLine =
    filtered.length > listCap
      ? `... and ${filtered.length - listCap} more path(s)`
      : null;

  const doc = [
    "# Architecture (prebuilt scaffold)",
    "",
    "This directory was bootstrapped from the **tier scaffold** at coding session start.",
    "See **SCAFFOLD_SPEC.md** for layout conventions, commands, and where to add code.",
    "Architect kickoff tasks were **not** run with an LLM; implement features in backend, frontend, and test phases.",
    "",
    "## Root `package.json` scripts",
    "",
    scriptsSection,
    "",
    "## Source paths (excludes node_modules, dist, .next, .git)",
    "",
    "```text",
    ...listLines,
    ...(moreLine ? [moreLine] : []),
    "```",
    "",
  ].join("\n");

  await fsWrite("ARCHITECTURE_SCAFFOLD.md", doc, outputDir);

  const docEntry: GeneratedFile = {
    path: "ARCHITECTURE_SCAFFOLD.md",
    role: "architect",
    summary: "Prebuilt scaffold index (auto-generated)",
  };

  return [...registry, docEntry];
}

async function runArchitectPhase(state: SupervisorState) {
  if (state.architectTasks.length === 0) {
    console.log("[Supervisor] Architect phase: no tasks, skipping.");
    return {};
  }

  if (state.prebuiltScaffold) {
    console.log(
      `[Supervisor] Architect phase: prebuiltScaffold=true — skipping LLM for ${state.architectTasks.length} task(s); registering template files.`,
    );
    const registry = await buildPrebuiltScaffoldRegistryAndDoc(state.outputDir);
    const taskResults: TaskResult[] = state.architectTasks.map((task) => ({
      taskId: task.id,
      status: "completed",
      generatedFiles: [],
      costUsd: 0,
      durationMs: 0,
      verifyPassed: true,
      fixCycles: 0,
      warnings: [
        "Completed via prebuilt tier scaffold (no LLM). See ARCHITECTURE_SCAFFOLD.md.",
      ],
    }));
    const phaseResult: PhaseResult = {
      role: "architect",
      workerLabel: "Architect",
      taskResults,
      totalCostUsd: 0,
    };
    return {
      phaseResults: [phaseResult],
      fileRegistry: registry,
      totalCostUsd: 0,
    };
  }

  console.log(
    `[Supervisor] Architect phase: starting ${state.architectTasks.length} tasks...`,
  );
  const result = await workerGraph.invoke(
    {
      role: "architect" as CodingAgentRole,
      workerLabel: "Architect",
      tasks: state.architectTasks,
      outputDir: state.outputDir,
      projectContext: state.projectContext,
      fileRegistrySnapshot: state.fileRegistry,
      apiContractsSnapshot: state.apiContracts,
      scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
      currentTaskIndex: 0,
      ralphConfig: state.ralphConfig,
    },
    { recursionLimit: 150 },
  );

  const workerState = result as WorkerState;
  const phaseResult: PhaseResult = {
    role: "architect",
    workerLabel: "Architect",
    taskResults: workerState.taskResults,
    totalCostUsd: workerState.workerCostUsd,
  };

  console.log(
    `[Supervisor] Architect phase done: ${workerState.taskResults.length} task results, ${workerState.generatedFiles.length} files.`,
  );

  return {
    phaseResults: [phaseResult],
    fileRegistry: workerState.generatedFiles,
    totalCostUsd: workerState.workerCostUsd,
  };
}

// ─── Scaffold handoff (install/build deferred to integration verify) ───

const MAX_SCAFFOLD_FIX_ATTEMPTS = 2;
const VERIFY_NPM_INSTALL_TIMEOUT_MS = 180_000;

async function scaffoldVerify(state: SupervisorState) {
  if (state.prebuiltScaffold) {
    console.log(
      "[Supervisor] Scaffold verify: prebuilt scaffold — skipping tsc (template already validated).",
    );
    return { scaffoldErrors: "" };
  }

  if (state.fileRegistry.length === 0) {
    console.log("[Supervisor] Scaffold verify: no architect files to check.");
    return { scaffoldErrors: "" };
  }

  const archFiles = state.fileRegistry
    .filter((f) => f.role === "architect" && /\.(ts|tsx)$/.test(f.path))
    .map((f) => f.path)
    .slice(0, 10);

  if (archFiles.length === 0) {
    console.log("[Supervisor] Scaffold verify: no TS files from architect.");
    return { scaffoldErrors: "" };
  }

  console.log(
    `[Supervisor] Scaffold verify: tsc check on ${archFiles.length} architect file(s)...`,
  );

  const { stdout, stderr, exitCode } = await shellExec(
    `npx tsc --noEmit --pretty false --skipLibCheck 2>&1`,
    state.outputDir,
    { timeout: 60_000 },
  );

  const rawOutput = (stderr || stdout || "").trim();
  const output = rawOutput.split("\n").slice(0, 40).join("\n");
  const hasErrors =
    (exitCode !== 0 || rawOutput.includes("error TS")) &&
    output.includes("error TS");

  if (!hasErrors) {
    console.log("[Supervisor] Scaffold verify: tsc PASSED.");
    return { scaffoldErrors: "" };
  }

  console.log(
    `[Supervisor] Scaffold verify: tsc errors found.\n${output.slice(0, 300)}`,
  );
  return { scaffoldErrors: output.slice(0, 2000) };
}

function hasNpmWorkspaces(pkg: { workspaces?: unknown }): boolean {
  const w = pkg.workspaces;
  if (w == null) return false;
  if (Array.isArray(w)) return w.length > 0;
  if (typeof w === "object" && w !== null) {
    const packages = (w as { packages?: unknown }).packages;
    return Array.isArray(packages) && packages.length > 0;
  }
  return false;
}

async function findPackageJsonRelativeDirs(
  outputDir: string,
): Promise<string[]> {
  const files = await listFiles(".", outputDir);
  const dirs = new Set<string>();
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (norm.split("/").includes("node_modules")) continue;
    if (!norm.endsWith("/package.json") && norm !== "package.json") continue;
    const dir =
      norm === "package.json" ? "." : norm.slice(0, -"/package.json".length);
    dirs.add(dir);
  }
  return [...dirs].sort((a, b) => a.split("/").length - b.split("/").length);
}

/** Run install at repo root (workspaces) or at each package root (no workspaces). */
async function runNpmInstallAllRoots(outputDir: string): Promise<void> {
  const pm = await detectPackageManager(outputDir);

  // pnpm workspace: always install from root only
  if (pm === "pnpm") {
    console.log(
      "[Supervisor] Integration verify: pnpm workspace — pnpm install at repo root.",
    );
    const r = await shellExec(buildInstallCommand("pnpm"), outputDir, {
      timeout: VERIFY_NPM_INSTALL_TIMEOUT_MS,
    });
    if (r.exitCode !== 0) {
      console.warn(
        `[Supervisor] Integration verify: root pnpm install exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 400)}`,
      );
    }
    return;
  }

  const rootPkgRaw = await fsRead("package.json", outputDir);
  if (!rootPkgRaw.startsWith("FILE_NOT_FOUND")) {
    try {
      const pkg = JSON.parse(rootPkgRaw) as { workspaces?: unknown };
      if (hasNpmWorkspaces(pkg)) {
        console.log(
          `[Supervisor] Integration verify: ${pm} workspaces — install at repo root only.`,
        );
        const r = await shellExec(buildInstallCommand(pm), outputDir, {
          timeout: VERIFY_NPM_INSTALL_TIMEOUT_MS,
        });
        if (r.exitCode !== 0) {
          console.warn(
            `[Supervisor] Integration verify: root install exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 400)}`,
          );
        }
        return;
      }
    } catch {
      // fall through to per-package installs
    }
  }

  const dirs = await findPackageJsonRelativeDirs(outputDir);
  if (dirs.length === 0) {
    console.log("[Supervisor] Integration verify: no package.json found.");
    return;
  }
  for (const rel of dirs) {
    const cwd = rel === "." ? outputDir : path.join(outputDir, rel);
    console.log(
      `[Supervisor] Integration verify: ${pm} install in "${rel === "." ? "." : rel}"`,
    );
    const r = await shellExec(buildInstallCommand(pm), cwd, {
      timeout: VERIFY_NPM_INSTALL_TIMEOUT_MS,
    });
    if (r.exitCode !== 0) {
      console.warn(
        `[Supervisor] Integration verify: install in "${rel}" exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 400)}`,
      );
    }
  }
}

function shouldFixScaffoldOrContinue(state: SupervisorState): string {
  if (!state.scaffoldErrors) return "dispatch";
  if (state.scaffoldFixAttempts >= MAX_SCAFFOLD_FIX_ATTEMPTS) {
    console.log(
      `[Supervisor] Scaffold fix: max attempts (${MAX_SCAFFOLD_FIX_ATTEMPTS}) reached, proceeding anyway.`,
    );
    return "dispatch";
  }
  return "scaffold_fix";
}

function parseFileOutput(raw: string): Record<string, string> {
  const files: Record<string, string> = {};
  const regex = /```file:([^\n]+)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const filePath = match[1].trim();
    const content = match[2];
    if (filePath && content) files[filePath] = content;
  }
  return files;
}

type PackageRootKey = "root" | "web" | "api" | "shared";

interface DependencyPlanItem {
  pkg: string;
  reason: string;
}

interface DependencyWorkspacePlan {
  relPath: string;
  suggested: DependencyPlanItem[];
  alreadyDeclared: string[];
  missing: DependencyPlanItem[];
}

async function readPackageDeps(
  relPath: string,
  outputDir: string,
): Promise<Set<string>> {
  const raw = await fsRead(relPath, outputDir);
  if (raw.startsWith("FILE_NOT_FOUND") || raw.startsWith("REJECTED")) {
    return new Set();
  }
  try {
    const j = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(j.dependencies ?? {}),
      ...Object.keys(j.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function collectDependencySuggestions(
  state: SupervisorState,
): Record<PackageRootKey, DependencyPlanItem[]> {
  const text = [
    state.projectContext,
    ...state.tasks.map((t) => `${t.phase} ${t.title} ${t.description}`),
  ]
    .join("\n")
    .toLowerCase();

  const root: DependencyPlanItem[] = [];
  const web: DependencyPlanItem[] = [];
  const api: DependencyPlanItem[] = [];
  const shared: DependencyPlanItem[] = [];

  // Baseline monorepo internal linkage.
  web.push({
    pkg: "@project/shared",
    reason: "Frontend imports shared contracts/types/schemas.",
  });
  api.push({
    pkg: "@project/shared",
    reason: "Backend imports shared contracts/types/schemas.",
  });
  shared.push({
    pkg: "zod",
    reason: "Shared runtime validation schemas.",
  });

  if (/query|server state|cache|invalidate/.test(text)) {
    web.push({
      pkg: "@tanstack/react-query",
      reason: "Server-state caching and request lifecycle.",
    });
  }
  if (/axios|http client|api client/.test(text)) {
    web.push({ pkg: "axios", reason: "HTTP client for API calls." });
  }
  if (/store|zustand|global state/.test(text)) {
    web.push({ pkg: "zustand", reason: "Client-side state management." });
  }
  if (/form|validation|register|login/.test(text)) {
    web.push({ pkg: "zod", reason: "Form and API payload validation." });
  }
  if (
    /chart|charts|graph|statistics|analytics|trend|recharts|line\s*chart|bar\s*chart|pie\s*chart/.test(
      text,
    )
  ) {
    web.push({
      pkg: "recharts",
      reason: "Data visualization components for statistics/analytics UI.",
    });
  }

  if (/express/.test(text)) {
    api.push({ pkg: "express", reason: "HTTP server runtime." });
  }
  if (/fastify/.test(text)) {
    api.push({ pkg: "fastify", reason: "HTTP server runtime." });
  }
  if (/auth|jwt|token|session/.test(text)) {
    api.push({ pkg: "jose", reason: "JWT/session token primitives." });
  }
  if (/security|helmet/.test(text)) {
    api.push({ pkg: "helmet", reason: "Secure HTTP headers defaults." });
  }
  if (/cors/.test(text)) {
    api.push({ pkg: "cors", reason: "Cross-origin API access control." });
  }
  if (
    /database|schema|prisma|model|sequelize|mongoose|drizzle|knex|sqlite|redis/.test(
      text,
    )
  ) {
    api.push({
      pkg: "zod",
      reason: "Runtime input validation near handlers/services.",
    });
  }
  if (/prisma/.test(text)) {
    api.push({ pkg: "@prisma/client", reason: "Prisma ORM runtime client." });
    api.push({
      pkg: "prisma",
      reason: "Prisma CLI for schema management and migrations.",
    });
  }
  if (/sqlite|better.sqlite/.test(text)) {
    api.push({
      pkg: "better-sqlite3",
      reason: "SQLite embedded database driver.",
    });
  }
  if (/postgres|postgresql/.test(text) && !/prisma/.test(text)) {
    api.push({ pkg: "pg", reason: "PostgreSQL client for Node.js." });
  }
  if (/mongoose|mongodb/.test(text)) {
    api.push({ pkg: "mongoose", reason: "MongoDB ODM for Node.js." });
  }
  if (/drizzle/.test(text)) {
    api.push({ pkg: "drizzle-orm", reason: "TypeScript-first SQL ORM." });
  }
  if (/\bknex\b/.test(text)) {
    api.push({ pkg: "knex", reason: "SQL query builder for Node.js." });
  }
  if (/redis/.test(text)) {
    api.push({ pkg: "ioredis", reason: "Redis client for Node.js." });
  }

  if (/test|vitest|integration/.test(text)) {
    root.push({
      pkg: "vitest",
      reason: "Unit/integration test runner across workspaces.",
    });
  }
  if (/e2e|playwright/.test(text)) {
    root.push({ pkg: "playwright", reason: "End-to-end browser tests." });
  }

  const dedupe = (items: DependencyPlanItem[]): DependencyPlanItem[] => {
    const map = new Map<string, DependencyPlanItem>();
    for (const item of items) {
      if (!map.has(item.pkg)) {
        map.set(item.pkg, item);
      }
    }
    return [...map.values()];
  };

  return {
    root: dedupe(root),
    web: dedupe(web),
    api: dedupe(api),
    shared: dedupe(shared),
  };
}

async function buildDependencyBaselinePlans(
  state: SupervisorState,
): Promise<DependencyWorkspacePlan[]> {
  const suggestions = collectDependencySuggestions(state);
  const workspaceMap: Array<{ key: PackageRootKey; relPath: string }> = [
    { key: "root", relPath: "package.json" },
    { key: "web", relPath: "apps/web/package.json" },
    { key: "api", relPath: "apps/api/package.json" },
    { key: "shared", relPath: "packages/shared/package.json" },
  ];

  const plans: DependencyWorkspacePlan[] = [];
  for (const ws of workspaceMap) {
    const declared = await readPackageDeps(ws.relPath, state.outputDir);
    if (declared.size === 0) continue;
    const suggested = suggestions[ws.key];
    const missing = suggested.filter((s) => !declared.has(s.pkg));
    plans.push({
      relPath: ws.relPath,
      suggested,
      alreadyDeclared: suggested
        .map((s) => s.pkg)
        .filter((pkg) => declared.has(pkg))
        .sort(),
      missing,
    });
  }
  return plans;
}

function renderDependencyPlanMarkdown(
  plans: DependencyWorkspacePlan[],
): string {
  const body = plans
    .map((p) => {
      const suggested = p.suggested.length
        ? p.suggested.map((s) => `- \`${s.pkg}\` — ${s.reason}`).join("\n")
        : "- (none)";
      const declared = p.alreadyDeclared.length
        ? p.alreadyDeclared.map((d) => `- \`${d}\``).join("\n")
        : "- (none matched yet)";
      const missing = p.missing.length
        ? p.missing.map((m) => `- \`${m.pkg}\` — ${m.reason}`).join("\n")
        : "- (none)";
      return [
        `### ${p.relPath}`,
        "",
        "**Suggested for this project**",
        suggested,
        "",
        "**Already declared (matched)**",
        declared,
        "",
        "**Missing (to be added by coding/integration if used)**",
        missing,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "# Dependency baseline",
    "",
    "This plan is generated **before feature coding** to align package usage with PRD + task breakdown.",
    "Coding agents should prefer these packages and avoid introducing parallel alternatives.",
    "",
    body || "(no workspace package.json found)",
    "",
  ].join("\n");
}

async function dependencyBaseline(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  console.log(
    "[Supervisor] dependency_baseline: planning dependencies before coding...",
  );
  const plans = await buildDependencyBaselinePlans(state);
  const md = renderDependencyPlanMarkdown(plans);
  await fsWrite("DEPENDENCY_PLAN.md", md, state.outputDir);

  const summaryLines = plans
    .map((p) => {
      const missing = p.missing.map((m) => m.pkg).join(", ") || "(none)";
      return `- ${p.relPath}: missing ${missing}`;
    })
    .join("\n");
  const contextPatch = [
    "## Dependency baseline (pre-coding)",
    "Use these package decisions as the source of truth unless a task explicitly requires otherwise.",
    summaryLines || "- (no package roots found)",
    "Full details: DEPENDENCY_PLAN.md",
  ].join("\n");

  return {
    projectContext: state.projectContext
      ? `${state.projectContext}\n\n---\n\n${contextPatch}`
      : contextPatch,
    fileRegistry: [
      {
        path: "DEPENDENCY_PLAN.md",
        role: "architect",
        summary: "Pre-coding dependency baseline (workspace-aware)",
      },
    ],
  };
}

async function scaffoldFix(state: SupervisorState) {
  const attempt = state.scaffoldFixAttempts + 1;
  console.log(
    `[Supervisor] Scaffold fix: attempt ${attempt}/${MAX_SCAFFOLD_FIX_ATTEMPTS}...`,
  );

  const errorFiles = extractBuildErrorFiles(state.scaffoldErrors);
  const fileContents: string[] = [];
  for (const ef of errorFiles.slice(0, 5)) {
    const content = await fsRead(ef, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileContents.push(`### ${ef}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``);
    }
  }

  const configFiles = [
    "package.json",
    "vite.config.ts",
    "tsconfig.json",
    "index.html",
    "next.config.mjs",
    "next.config.ts",
  ];
  for (const cf of configFiles) {
    if (errorFiles.includes(cf)) continue;
    const content = await fsRead(cf, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileContents.push(`### ${cf}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``);
    }
  }

  const codeFixChain = resolveModelChain(
    MODEL_CONFIG.codeFix ?? "gpt-4o",
    resolveModel,
  );
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a Senior Software Architect. Fix the build errors below so that "npm install && npm run build" succeeds.
Rules:
- NEVER use create-react-app or react-scripts.
- For M-tier monorepo projects: frontend is ALWAYS Vite + React (apps/web), backend is Express (apps/api). NEVER introduce Next.js.
- For L-tier monorepo projects: frontend is Next.js (apps/web), backend is Fastify (apps/api).
- For Vite projects: index.html must be in the project root, src/main.tsx is the entry point.
- Output ONLY corrected/new files using \`\`\`file:<relative-path>\n<contents>\n\`\`\` format.
- Output ALL files that need changes, not just the ones with errors.`,
    },
    {
      role: "user",
      content: [
        "## Build Errors",
        "```",
        state.scaffoldErrors,
        "```",
        "",
        fileContents.length > 0
          ? `## Current Files\n${fileContents.join("\n\n")}`
          : "",
        "",
        "Fix all errors so npm install && npm run build passes. Output corrected files.",
      ].join("\n"),
    },
  ];

  const response = await chatCompletionWithFallback(messages, codeFixChain, {
    temperature: 0.2,
    max_tokens: 16384,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const costUsd = estimateCost(response.model, response.usage);
  const fixes = parseFileOutput(content);

  const fixedFiles: GeneratedFile[] = [];
  const fixOpts = scaffoldWriteOpts(state, true);
  for (const [fp, fc] of Object.entries(fixes)) {
    await fsWrite(fp, fc, state.outputDir, fixOpts);
    fixedFiles.push({
      path: fp,
      role: "architect",
      summary: `Scaffold fix attempt ${attempt}`,
    });
  }

  console.log(
    `[Supervisor] Scaffold fix: wrote ${fixedFiles.length} file(s) (model=${response.model}, cost: $${costUsd.toFixed(4)})`,
  );

  return {
    scaffoldFixAttempts: attempt,
    scaffoldErrors: "",
    fileRegistry: fixedFiles,
    totalCostUsd: costUsd,
  };
}

function extractBuildErrorFiles(errors: string): string[] {
  const fileSet = new Set<string>();
  const patterns = [
    /([^\s:(]+\.(?:tsx?|jsx?|json|mjs|cjs|html))/g,
    /Could not resolve "([^"]+)"/g,
    /Cannot find module '([^']+)'/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(errors)) !== null) {
      const f = match[1].replace(/^\.\//, "");
      if (!f.includes("node_modules")) fileSet.add(f);
    }
  }
  const conventionPattern = /\[CONVENTION\]\s+([^\s:]+):/g;
  let cm: RegExpExecArray | null;
  while ((cm = conventionPattern.exec(errors)) !== null) {
    const f = cm[1].replace(/^\.\//, "");
    if (f && !f.includes("node_modules")) fileSet.add(f);
  }
  return [...fileSet];
}

function appendConventionFileHints(errors: string, files: string[]): string {
  if (files.length === 0) return errors;
  const hintLines = files.map((f) => `- ${f}`).join("\n");
  return [errors, "", "CONVENTION_TARGET_FILES:", hintLines].join("\n");
}

async function collectConventionViolations(
  outputDir: string,
): Promise<{ errorsText: string; files: string[] }> {
  const files = await listFiles(".", outputDir);
  const sourceFiles = files.filter(
    (f) =>
      /\.(ts|tsx|js|jsx)$/.test(f) &&
      !f.includes("node_modules") &&
      !f.startsWith("dist/") &&
      !f.startsWith(".next/"),
  );

  const violations: string[] = [];
  const touchedFiles = new Set<string>();
  const scaffoldSpec = await fsRead("SCAFFOLD_SPEC.md", outputDir);
  const isMTier = /scaffold specification \(tier m\)/i.test(scaffoldSpec);

  for (const rel of sourceFiles) {
    const content = await fsRead(rel, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }

    if (/(?:from\s+["']@shared\/|import\s+["']@shared\/)/.test(content)) {
      violations.push(
        `[CONVENTION] ${rel}: Use "@project/shared/..." imports; "@shared/..." is forbidden unless explicitly configured.`,
      );
      touchedFiles.add(rel);
    }

    // ── Vite alias enforcement ────────────────────────────────────────────────
    // Flag cross-directory relative imports in Vite frontend source files.
    // The scaffold configures `@` → `./src` in both vite.config.ts and tsconfig,
    // so `from '../...'` should always be written as `from '@/...'`.
    const isViteFrontendSource =
      /\.(ts|tsx)$/.test(rel) &&
      (rel.startsWith("src/") ||
        rel.startsWith("apps/web/src/") ||
        rel.startsWith("web/src/")) &&
      !rel.includes("/test/") &&
      !rel.includes(".test.") &&
      !rel.includes(".spec.");

    if (isViteFrontendSource) {
      // Match any `from '../` (one or more levels up) — these should use @/ alias.
      const relativeUpImport = /from\s+["'](\.\.[/\\][^"']+)["']/g;
      let rm: RegExpExecArray | null;
      while ((rm = relativeUpImport.exec(content)) !== null) {
        const importedPath = rm[1];
        // Convert ../foo/bar → @/foo/bar suggestion (best-effort)
        const normalized = importedPath
          .replace(/^(\.\.[/\\])+/, "")
          .replace(/\\/g, "/");
        violations.push(
          `[CONVENTION] ${rel}: Replace relative import \`${importedPath}\` with Vite alias \`@/${normalized}\`. ` +
            `The project configures \`@\` → \`./src\` in vite.config.ts and tsconfig paths.`,
        );
        touchedFiles.add(rel);
      }
    }

    const isWebUiSource =
      rel.startsWith("apps/web/src/") && /\.(tsx|jsx)$/.test(rel);
    if (isWebUiSource) {
      if (/<a\b[^>]*href=["'](?:#|)["'][^>]*>/g.test(content)) {
        violations.push(
          `[CONVENTION] ${rel}: Avoid dead links. Replace href "#" / "" with React Router navigation (Link/useNavigate) or a real route.`,
        );
        touchedFiles.add(rel);
      }
      if (
        /<button\b(?![^>]*\bonClick=)(?![^>]*\btype=["']submit["'])[^>]*>/g.test(
          content,
        )
      ) {
        violations.push(
          `[CONVENTION] ${rel}: Button elements must have onClick or be explicit submit buttons inside forms.`,
        );
        touchedFiles.add(rel);
      }
      if (/<form\b(?![^>]*\bonSubmit=)[^>]*>/g.test(content)) {
        violations.push(
          `[CONVENTION] ${rel}: Forms must provide onSubmit handlers.`,
        );
        touchedFiles.add(rel);
      }
    }

    if (rel.startsWith("packages/shared/schemas/")) {
      const schemaTypePattern = /export\s+type\s+([A-Z]\w*Schema)\b/g;
      let tm: RegExpExecArray | null;
      while ((tm = schemaTypePattern.exec(content)) !== null) {
        violations.push(
          `[CONVENTION] ${rel}: Replace type "${tm[1]}" with "*Input" (or "*Dto") to avoid schema/type naming collisions.`,
        );
        touchedFiles.add(rel);
      }
    }

    const importSchemaValuePattern =
      /import\s+\{[^}]*\b([A-Z]\w*Schema)\b[^}]*\}\s+from\s+["']@project\/shared\/schemas\//g;
    let im: RegExpExecArray | null;
    while ((im = importSchemaValuePattern.exec(content)) !== null) {
      const importBlockStart = Math.max(0, im.index - 40);
      const importSnippet = content.slice(importBlockStart, im.index + 140);
      if (!/import\s+type\s+\{/.test(importSnippet)) {
        violations.push(
          `[CONVENTION] ${rel}: "${im[1]}" looks like a type. Import runtime schema values as camelCase (e.g. registerSchema) and use "import type" for types.`,
        );
        touchedFiles.add(rel);
      }
    }

    // M-tier strict routing root: ONLY apps/web/src/pages
    if (isMTier) {
      const isWebAppDirFile = rel.startsWith("apps/web/app/");
      const isWebSrcAppDirFile = rel.startsWith("apps/web/src/app/");
      if (isWebAppDirFile || isWebSrcAppDirFile) {
        violations.push(
          `[CONVENTION] ${rel}: M-tier allows a single page root only: "apps/web/src/pages". Do not place pages/layout/routes under "apps/web/app" or "apps/web/src/app".`,
        );
        touchedFiles.add(rel);
      }

      if (
        /(?:from\s+["']@\/app\/|from\s+["']\.{1,2}\/app\/|import\s+["']@\/app\/)/.test(
          content,
        )
      ) {
        violations.push(
          `[CONVENTION] ${rel}: M-tier imports must target "src/pages" routes/components; "@\/app/*" and "./app/*" imports are forbidden.`,
        );
        touchedFiles.add(rel);
      }
    }
  }

  if (isMTier) {
    const appEntryPath = "apps/web/src/App.tsx";
    const routesFilePath = "apps/web/src/routes.tsx";
    const appEntryContent = await fsRead(appEntryPath, outputDir);
    const routesFileContent = await fsRead(routesFilePath, outputDir);
    const appExists =
      !appEntryContent.startsWith("FILE_NOT_FOUND") &&
      !appEntryContent.startsWith("REJECTED");
    const routesFileExists =
      !routesFileContent.startsWith("FILE_NOT_FOUND") &&
      !routesFileContent.startsWith("REJECTED");

    if (!appExists) {
      violations.push(
        `[CONVENTION] ${appEntryPath}: M-tier frontend must keep App.tsx as the web entry and route registry owner (directly or by importing src/routes.tsx).`,
      );
      touchedFiles.add(appEntryPath);
    } else {
      const hasRouterRegistry =
        /\bRoutes\b/.test(appEntryContent) ||
        /\bRouterProvider\b/.test(appEntryContent) ||
        /from\s+["']\.\/routes["']/.test(appEntryContent) ||
        /from\s+["']@\/routes["']/.test(appEntryContent);
      if (!hasRouterRegistry) {
        violations.push(
          `[CONVENTION] ${appEntryPath}: App entry must register React Router routes (Routes/Route) or import a dedicated src/routes.tsx registry.`,
        );
        touchedFiles.add(appEntryPath);
      }
    }

    const pageFiles = sourceFiles.filter(
      (f) => f.startsWith("apps/web/src/pages/") && /\.tsx?$/.test(f),
    );
    if (pageFiles.length > 0) {
      const registrySource = [
        appExists ? appEntryContent : "",
        routesFileExists ? routesFileContent : "",
      ].join("\n");

      const hasPagesImport =
        /from\s+["'](?:@\/pages\/|\.\/pages\/|\.\.\/pages\/)/.test(
          registrySource,
        );
      if (!hasPagesImport) {
        violations.push(
          `[CONVENTION] ${appEntryPath}: Pages exist under apps/web/src/pages but route registry does not import page modules. Register page routes explicitly.`,
        );
        touchedFiles.add(appEntryPath);
        if (routesFileExists) touchedFiles.add(routesFilePath);
      }

      const hasNonRootRoute = /path\s*=\s*["']\/[^"']+["']/.test(
        registrySource,
      );
      if (pageFiles.length > 1 && !hasNonRootRoute) {
        violations.push(
          `[CONVENTION] ${appEntryPath}: Multiple pages detected, but no non-root route is registered. Add at least one route entry beyond "/".`,
        );
        touchedFiles.add(appEntryPath);
        if (routesFileExists) touchedFiles.add(routesFilePath);
      }
    }

    const homeEntryCandidates = [
      "apps/web/src/pages/Home.tsx",
      "apps/web/src/pages/Index.tsx",
      "apps/web/src/pages/index.tsx",
      appEntryPath,
    ];
    let hasHomeNavigationEntry = false;
    for (const candidate of homeEntryCandidates) {
      const content = await fsRead(candidate, outputDir);
      if (
        content.startsWith("FILE_NOT_FOUND") ||
        content.startsWith("REJECTED")
      ) {
        continue;
      }
      if (/\b(Link|NavLink|useNavigate)\b/.test(content)) {
        hasHomeNavigationEntry = true;
        break;
      }
    }
    if (!hasHomeNavigationEntry) {
      violations.push(
        `[CONVENTION] ${appEntryPath}: Home entry must provide visible route entry points (Link/NavLink or button using useNavigate) so users can navigate to primary pages.`,
      );
      touchedFiles.add(appEntryPath);
    }
  }

  return {
    errorsText: violations.join("\n"),
    files: [...touchedFiles],
  };
}

// ─── Two-phase task refinement: after scaffold exists, refine coarse tasks ───

const MAX_SUPPLEMENTARY_ROUNDS = 1;

async function refineTaskBreakdown(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  const coarseTasks = [
    ...state.backendTasks,
    ...state.frontendTasks,
    ...state.testTasks,
  ];

  if (coarseTasks.length === 0) {
    console.log("[Supervisor] refineTaskBreakdown: no tasks to refine.");
    return { taskRefinementDone: true };
  }

  console.log(
    `[Supervisor] refineTaskBreakdown: refining ${coarseTasks.length} task(s) with scaffold context...`,
  );

  const scaffoldFiles = state.fileRegistry
    .filter((f) => f.role === "architect")
    .map((f) => `- ${f.path}: ${f.summary}`)
    .slice(0, 50);

  const sharedContractsContent: string[] = [];
  for (const f of state.fileRegistry.filter(
    (f) =>
      f.role === "architect" &&
      (f.path.includes("shared") || f.path.includes("type")) &&
      /\.(ts|tsx)$/.test(f.path),
  ).slice(0, 5)) {
    const content = await fsRead(f.path, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND") && !content.startsWith("REJECTED")) {
      sharedContractsContent.push(`### ${f.path}\n\`\`\`typescript\n${content.slice(0, 1500)}\n\`\`\``);
    }
  }

  const taskSummary = coarseTasks
    .map(
      (t) =>
        `- [${t.id}] (${t.phase}) ${t.title}: ${t.description.slice(0, 200)}${
          t.files
            ? ` | files: ${JSON.stringify(t.files).slice(0, 150)}`
            : ""
        }`,
    )
    .join("\n");

  const modelChain = resolveModelChain(
    MODEL_CONFIG.codeFix ?? "claude-sonnet",
    resolveModel,
  );

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a Senior Technical Lead refining a coarse task breakdown into detailed implementation tasks.",
        "You have access to the actual scaffold structure and shared contracts.",
        "",
        "Rules:",
        "- Keep the same task IDs from the original breakdown. Do NOT invent new IDs.",
        "- For each task, refine the `description` with specific implementation details based on the scaffold.",
        "- Update `files` (creates/modifies/reads) to reflect actual file paths in the scaffold.",
        "- Add or update `subSteps` with concrete implementation steps.",
        "- Add `acceptanceCriteria` where missing.",
        "- Do NOT change `phase`, `priority`, or `executionKind`.",
        "- If a task is already well-specified, keep it as-is.",
        "",
        "Output a JSON array of refined tasks with the same schema as input. Output ONLY the JSON array, no markdown fences or explanation.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "## Scaffold structure (actual files after architect phase)",
        scaffoldFiles.length > 0
          ? scaffoldFiles.join("\n")
          : "(no scaffold files)",
        "",
        sharedContractsContent.length > 0
          ? `## Shared contracts\n${sharedContractsContent.join("\n\n")}`
          : "",
        "",
        `## Tasks to refine\n${taskSummary}`,
        "",
        `## Original tasks (full JSON)\n${JSON.stringify(coarseTasks, null, 2).slice(0, 20000)}`,
      ].join("\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(messages, modelChain, {
      temperature: 0.2,
      max_tokens: 16384,
    });

    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);

    let refined: CodingTask[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        refined = JSON.parse(jsonMatch[0]) as CodingTask[];
      }
    } catch {
      console.warn(
        "[Supervisor] refineTaskBreakdown: failed to parse LLM output, keeping original tasks.",
      );
      return { taskRefinementDone: true, totalCostUsd: costUsd };
    }

    if (refined.length === 0) {
      console.warn(
        "[Supervisor] refineTaskBreakdown: empty result, keeping original tasks.",
      );
      return { taskRefinementDone: true, totalCostUsd: costUsd };
    }

    const originalIds = new Set(coarseTasks.map((t) => t.id));
    const validRefined = refined.filter((t) => originalIds.has(t.id));

    if (validRefined.length === 0) {
      console.warn(
        "[Supervisor] refineTaskBreakdown: no valid tasks after filtering, keeping original.",
      );
      return { taskRefinementDone: true, totalCostUsd: costUsd };
    }

    const refinedMap = new Map(validRefined.map((t) => [t.id, t]));
    const mergedTasks = coarseTasks.map((original) => {
      const r = refinedMap.get(original.id);
      if (!r) return original;
      return {
        ...original,
        description: r.description || original.description,
        files: r.files || original.files,
        subSteps: r.subSteps || original.subSteps,
        acceptanceCriteria: r.acceptanceCriteria || original.acceptanceCriteria,
      };
    });

    const newBackend = mergedTasks.filter(
      (t) => inferRole(t) === "backend",
    ) as CodingTask[];
    const newFrontend = mergedTasks.filter(
      (t) => inferRole(t) === "frontend",
    ) as CodingTask[];
    const newTest = mergedTasks.filter(
      (t) => inferRole(t) === "test",
    ) as CodingTask[];

    console.log(
      `[Supervisor] refineTaskBreakdown: refined ${validRefined.length}/${coarseTasks.length} tasks (model=${response.model}, cost=$${costUsd.toFixed(4)})`,
    );

    return {
      backendTasks: newBackend,
      frontendTasks: newFrontend,
      testTasks: newTest,
      taskRefinementDone: true,
      totalCostUsd: costUsd,
    };
  } catch (e) {
    console.warn(
      `[Supervisor] refineTaskBreakdown: LLM call failed: ${e instanceof Error ? e.message : String(e)}. Keeping original tasks.`,
    );
    return { taskRefinementDone: true };
  }
}

// ─── Post-coding gap analysis: detect missing features after integration verify ───

async function gapAnalysis(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  if (state.supplementaryRound >= MAX_SUPPLEMENTARY_ROUNDS) {
    console.log(
      `[Supervisor] gapAnalysis: max supplementary rounds (${MAX_SUPPLEMENTARY_ROUNDS}) reached, skipping.`,
    );
    return { supplementaryTasks: [] };
  }

  if (state.integrationErrors) {
    console.log(
      "[Supervisor] gapAnalysis: integration still has errors, skipping gap analysis.",
    );
    return { supplementaryTasks: [] };
  }

  console.log(
    "[Supervisor] gapAnalysis: analyzing PRD vs generated code for missing features...",
  );

  const allGeneratedFiles = state.fileRegistry
    .map((f) => `- ${f.path} (${f.role}): ${f.summary}`)
    .slice(0, 80)
    .join("\n");

  const failedTaskIds = state.phaseResults
    .flatMap((pr) => pr.taskResults)
    .filter((tr) => tr.status === "failed")
    .map((tr) => tr.taskId);

  const originalTasks = state.tasks
    .map((t) => `- [${t.id}] ${t.title}: ${t.description.slice(0, 150)}`)
    .join("\n");

  const modelChain = resolveModelChain(
    MODEL_CONFIG.codeFix ?? "claude-sonnet",
    resolveModel,
  );

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a Senior QA Engineer performing gap analysis between PRD requirements and generated code.",
        "",
        "Analyze the PRD and compare it against the generated file registry.",
        "Identify ONLY critical missing features that would make the product unusable.",
        "Do NOT flag minor issues, styling problems, or edge cases.",
        "",
        "If there are missing features, output a JSON array of supplementary tasks:",
        "[{",
        '  "id": "SUP-1",',
        '  "phase": "Backend Services" or "Frontend" or "Integration",',
        '  "title": "short title",',
        '  "description": "detailed description of what to implement",',
        '  "estimatedHours": number,',
        '  "executionKind": "ai_autonomous",',
        '  "files": { "creates": [...], "modifies": [...], "reads": [...] },',
        '  "priority": "P0",',
        '  "gapDescription": "what PRD requirement is missing"',
        "}]",
        "",
        "If no critical gaps exist, output an empty array: []",
        "Output ONLY the JSON array, no markdown or explanation.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "## PRD",
        state.projectContext.slice(0, 10000),
        "",
        "## Original task breakdown",
        originalTasks,
        "",
        failedTaskIds.length > 0
          ? `## Failed tasks (need supplementary work)\n${failedTaskIds.map((id) => `- ${id}`).join("\n")}`
          : "",
        "",
        "## Generated files",
        allGeneratedFiles,
        "",
        "Identify any critical missing features and output supplementary tasks as JSON.",
      ].join("\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(messages, modelChain, {
      temperature: 0.2,
      max_tokens: 8192,
    });

    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);

    let gaps: Array<Record<string, unknown>> = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        gaps = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
      }
    } catch {
      console.warn(
        "[Supervisor] gapAnalysis: failed to parse LLM output.",
      );
      return { supplementaryTasks: [], totalCostUsd: costUsd };
    }

    if (!Array.isArray(gaps) || gaps.length === 0) {
      console.log(
        `[Supervisor] gapAnalysis: no critical gaps found (model=${response.model}, cost=$${costUsd.toFixed(4)})`,
      );
      return { supplementaryTasks: [], totalCostUsd: costUsd };
    }

    const supplementaryTasks: CodingTask[] = gaps
      .filter((g) => g.id && g.title && g.description)
      .slice(0, 5)
      .map((g) => ({
        id: String(g.id),
        phase: String(g.phase || "Integration"),
        title: String(g.title),
        description: String(g.description),
        estimatedHours: Number(g.estimatedHours) || 1,
        executionKind: "ai_autonomous" as const,
        files: (g.files as CodingTask["files"]) ?? [],
        priority: (g.priority as CodingTask["priority"]) ?? "P0",
        dependencies: [],
        assignedAgentId: null,
        codingStatus: "pending" as const,
        gapDescription: String(g.gapDescription || ""),
      }));

    console.log(
      `[Supervisor] gapAnalysis: found ${supplementaryTasks.length} supplementary task(s) (model=${response.model}, cost=$${costUsd.toFixed(4)})`,
    );

    return {
      supplementaryTasks,
      totalCostUsd: costUsd,
    };
  } catch (e) {
    console.warn(
      `[Supervisor] gapAnalysis: LLM call failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { supplementaryTasks: [] };
  }
}

function shouldDispatchSupplementary(state: SupervisorState): string {
  if (
    state.supplementaryTasks.length > 0 &&
    state.supplementaryRound < MAX_SUPPLEMENTARY_ROUNDS
  ) {
    return "supplementary_dispatch_gate";
  }
  return "summary";
}

function dispatchSupplementaryWorkers(state: SupervisorState): Send[] {
  if (state.supplementaryTasks.length === 0) {
    return [
      new Send("supplementary_worker", {
        role: "backend" as CodingAgentRole,
        workerLabel: "Supplementary (no-op)",
        tasks: [],
        outputDir: state.outputDir,
        projectContext: "",
        fileRegistrySnapshot: [],
        apiContractsSnapshot: [],
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
      }),
    ];
  }

  const feContext = state.frontendDesignContext
    ? `${state.projectContext}\n\n---\n\n${state.frontendDesignContext}`
    : state.projectContext;

  const byRole: Record<CodingAgentRole, CodingTask[]> = {
    architect: [],
    backend: [],
    frontend: [],
    test: [],
  };
  for (const task of state.supplementaryTasks) {
    const role = inferRole(task);
    byRole[role].push(task);
  }

  const sends: Send[] = [];
  for (const [role, tasks] of Object.entries(byRole)) {
    if (tasks.length === 0) continue;
    sends.push(
      new Send("supplementary_worker", {
        role: role as CodingAgentRole,
        workerLabel: `Supplementary ${role.charAt(0).toUpperCase() + role.slice(1)}`,
        tasks,
        outputDir: state.outputDir,
        projectContext:
          role === "frontend" ? feContext : state.projectContext,
        fileRegistrySnapshot: state.fileRegistry,
        apiContractsSnapshot: state.apiContracts,
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
      }),
    );
  }

  if (sends.length === 0) {
    sends.push(
      new Send("supplementary_worker", {
        role: "backend" as CodingAgentRole,
        workerLabel: "Supplementary (no-op)",
        tasks: [],
        outputDir: state.outputDir,
        projectContext: "",
        fileRegistrySnapshot: [],
        apiContractsSnapshot: [],
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
      }),
    );
  }

  console.log(
    `[Supervisor] Dispatching ${sends.length} supplementary worker(s) for ${state.supplementaryTasks.length} gap task(s)`,
  );

  return sends;
}

async function supplementaryVerify(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  console.log(
    `[Supervisor] supplementaryVerify: round ${state.supplementaryRound + 1} — running tsc check...`,
  );

  const tscCmd = `npx tsc --noEmit --pretty false --skipLibCheck 2>&1`;
  const { stdout, stderr, exitCode } = await shellExec(
    tscCmd,
    state.outputDir,
    { timeout: 90_000 },
  );

  const rawOutput = (stderr || stdout || "").trim();
  const hasErrors =
    (exitCode !== 0 || rawOutput.includes("error TS")) &&
    rawOutput.includes("error TS");

  if (!hasErrors) {
    console.log("[Supervisor] supplementaryVerify: tsc PASSED.");
  } else {
    const errorCount = rawOutput
      .split("\n")
      .filter((l) => l.includes("error TS")).length;
    console.log(
      `[Supervisor] supplementaryVerify: ${errorCount} tsc error(s) remaining.`,
    );
  }

  return {
    supplementaryRound: state.supplementaryRound + 1,
    supplementaryTasks: [],
  };
}

// ─── API Contract generation ───

const API_CONTRACT_SYSTEM_PROMPT = `You are a Senior API Architect.
Your job is to produce a precise, machine-readable API contract based on the PRD and scaffolding.
This contract will be used by BOTH the backend (to implement) and frontend (to consume).
Everyone must follow this contract exactly.

Output a JSON array only — no markdown, no explanation, no code fences.
Each element has this shape:
{
  "service": "string (service or module name, e.g. auth, orders, users)",
  "endpoint": "string (path with leading slash, e.g. /api/users/:id)",
  "method": "GET|POST|PUT|PATCH|DELETE",
  "requestSchema": "string (TypeScript type literal for request body/params, or 'none')",
  "responseSchema": "string (TypeScript type literal for success response body)",
  "auth": "none|bearer|session",
  "description": "string (one sentence)"
}`;

async function generateApiContracts(state: SupervisorState) {
  if (state.backendTasks.length === 0) {
    console.log(
      "[Supervisor] generateApiContracts: no backend tasks, skipping.",
    );
    return {};
  }

  console.log(
    "[Supervisor] generateApiContracts: generating API contract from PRD + scaffold...",
  );

  const contextParts: string[] = [];

  if (state.projectContext) {
    contextParts.push(
      `## Project Context (PRD / TRD)\n${state.projectContext.slice(0, 8000)}`,
    );
  }

  const typeFiles = state.fileRegistry
    .filter(
      (f) =>
        f.role === "architect" &&
        (f.path.includes("type") ||
          f.path.includes("model") ||
          f.path.includes("schema")) &&
        /\.(ts|tsx)$/.test(f.path),
    )
    .slice(0, 5);

  for (const tf of typeFiles) {
    const content = await fsRead(tf.path, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      contextParts.push(
        `## Type definitions: ${tf.path}\n\`\`\`typescript\n${content.slice(0, 2000)}\n\`\`\``,
      );
    }
  }

  const taskList = state.backendTasks
    .map((t) => `- ${t.title}: ${t.description.slice(0, 200)}`)
    .join("\n");
  contextParts.push(`## Backend tasks to implement\n${taskList}`);

  const contractModelChain = resolveModelChain(
    MODEL_CONFIG.codeFix ?? "gpt-4o",
    resolveModel,
  );
  const messages: ChatMessage[] = [
    { role: "system", content: API_CONTRACT_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        ...contextParts,
        "",
        "Generate the complete API contract for this project.",
        "Output a JSON array only. No markdown fences, no explanation.",
      ].join("\n\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(
      messages,
      contractModelChain,
      {
        temperature: 0.1,
        max_tokens: 4096,
      },
    );

    const raw = (response.choices[0]?.message?.content ?? "").trim();
    const costUsd = estimateCost(response.model, response.usage);

    let parsed: Array<{
      service: string;
      endpoint: string;
      method: string;
      requestSchema?: string;
      responseSchema?: string;
      auth?: string;
      description?: string;
    }> = [];

    try {
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      console.warn(
        "[Supervisor] generateApiContracts: failed to parse LLM output as JSON, skipping.",
      );
      return { totalCostUsd: costUsd };
    }

    const contracts: ApiContract[] = parsed.map((item) => ({
      service: item.service ?? "unknown",
      endpoint: item.endpoint ?? "/",
      method: (item.method ?? "GET").toUpperCase(),
      schema: [
        item.requestSchema ? `request: ${item.requestSchema}` : "",
        item.responseSchema ? `response: ${item.responseSchema}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
      generatedBy: "api_contract_phase",
    }));

    const contractJson = JSON.stringify(
      parsed.map((item, i) => ({
        ...item,
        id: `API-${String(i + 1).padStart(3, "0")}`,
      })),
      null,
      2,
    );
    await fsWrite("API_CONTRACTS.json", contractJson, state.outputDir);

    console.log(
      `[Supervisor] generateApiContracts: generated ${contracts.length} contracts, written to API_CONTRACTS.json (model=${response.model}, cost: $${costUsd.toFixed(4)})`,
    );

    return {
      apiContracts: contracts,
      totalCostUsd: costUsd,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[Supervisor] generateApiContracts: error — ${msg}. Continuing without contracts.`,
    );
    return {};
  }
}

/**
 * Bootstrap shared schemas/types/contracts BEFORE backend/frontend workers.
 * This makes downstream imports stable and reduces naming drift.
 */
async function bootstrapSharedContracts(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  const sharedPkg = await fsRead(
    "packages/shared/package.json",
    state.outputDir,
  );
  if (
    sharedPkg.startsWith("FILE_NOT_FOUND") ||
    sharedPkg.startsWith("REJECTED")
  ) {
    console.log(
      "[Supervisor] bootstrapSharedContracts: packages/shared not found, skipping.",
    );
    return {};
  }

  console.log(
    "[Supervisor] bootstrapSharedContracts: generating shared schemas/types/contracts...",
  );

  const taskText = state.tasks
    .map((t) => `- [${t.phase}] ${t.title}: ${t.description}`)
    .join("\n");
  const apiText =
    state.apiContracts.length > 0
      ? state.apiContracts
          .map((c) => `- ${c.method} ${c.endpoint} (${c.service}) ${c.schema}`)
          .join("\n")
      : "- (none)";

  const existingShared = state.fileRegistry
    .filter((f) => f.path.startsWith("packages/shared/"))
    .slice(0, 20)
    .map((f) => `- ${f.path} (${f.summary})`)
    .join("\n");

  const chain = resolveModelChain(
    MODEL_CONFIG.codeFix ?? "gpt-4o",
    resolveModel,
  );
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a Senior TypeScript API Contract Architect.
Generate/repair ONLY shared package files for a monorepo:
- packages/shared/schemas/*.ts
- packages/shared/types/*.ts
- packages/shared/src/contracts/*.ts
- packages/shared/src/index.ts (optional update if needed)

Critical rules:
- Import path convention in consumers: @project/shared/types/... and @project/shared/schemas/...
- Zod naming: runtime values are camelCase schema objects (e.g. loginSchema, registerSchema).
- Inferred types MUST use *Input / *Dto names (e.g. LoginInput, RegisterInput). Do NOT export type names like LoginSchema/RegisterSchema.
- Keep exports consistent and explicit.
- Output ONLY file blocks: \`\`\`file:<relative-path>\n<contents>\n\`\`\``,
    },
    {
      role: "user",
      content: [
        "## Tasks",
        taskText || "- (none)",
        "",
        "## API contracts",
        apiText,
        "",
        "## Existing shared files (registry)",
        existingShared || "- (none)",
        "",
        "Generate a coherent shared contract baseline now.",
      ].join("\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(messages, chain, {
      temperature: 0.1,
      max_tokens: 16384,
    });
    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);
    const files = parseFileOutput(content);

    const skOpts = scaffoldWriteOpts(state, true);
    const newEntries: GeneratedFile[] = [];
    for (const [fp, fc] of Object.entries(files)) {
      const norm = fp.replace(/\\/g, "/");
      if (
        !norm.startsWith("packages/shared/schemas/") &&
        !norm.startsWith("packages/shared/types/") &&
        !norm.startsWith("packages/shared/src/contracts/") &&
        norm !== "packages/shared/src/index.ts"
      ) {
        continue;
      }
      await fsWrite(norm, fc, state.outputDir, skOpts);
      newEntries.push({
        path: norm,
        role: "architect",
        summary: "Shared contracts baseline (schemas/types/contracts)",
        exports: extractExports(fc),
      });
    }

    console.log(
      `[Supervisor] bootstrapSharedContracts: wrote ${newEntries.length} file(s) (model=${response.model}, cost: $${costUsd.toFixed(4)})`,
    );

    return {
      fileRegistry: newEntries,
      totalCostUsd: costUsd,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[Supervisor] bootstrapSharedContracts: error — ${msg}. Continuing without bootstrap.`,
    );
    return {};
  }
}

/**
 * Architect Phase 完成后，在 BE/FE 任务开始前，
 * 生成所有服务文件的接口骨架（类型定义 + 函数签名，无实现）。
 * 骨架文件让所有后续任务对接口有一致的预期，避免各自猜导出内容。
 */
async function generateServiceSkeletons(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  if (state.backendTasks.length === 0 && state.frontendTasks.length === 0) {
    return {};
  }

  console.log(
    "[Supervisor] generateServiceSkeletons: generating interface contracts...",
  );

  const allTasks = [...state.backendTasks, ...state.frontendTasks]
    .map(
      (t) => `- [${inferRole(t)}] ${t.title}: ${t.description.slice(0, 150)}`,
    )
    .join("\n");

  const existingTypeFiles = state.fileRegistry
    .filter(
      (f) =>
        f.role === "architect" &&
        (f.path.includes("type") ||
          f.path.includes("model") ||
          f.path.includes("schema") ||
          f.path.includes("interface")) &&
        /\.(ts|tsx)$/.test(f.path),
    )
    .slice(0, 5);

  const typeFileContents: string[] = [];
  for (const tf of existingTypeFiles) {
    const content = await fsRead(tf.path, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      typeFileContents.push(
        `### ${tf.path}\n\`\`\`typescript\n${content.slice(0, 1500)}\n\`\`\``,
      );
    }
  }

  const skeletonModelChain = resolveModelChain(
    MODEL_CONFIG.codeFix ?? "gpt-4o",
    resolveModel,
  );
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a Senior TypeScript Architect.
Generate skeleton files — type definitions and function signatures ONLY, no implementations.
Each function body should be: throw new Error("Not implemented");

Rules:
- Export every type, interface, enum, and function that other modules will import
- Use consistent naming across all files
- If a service function is used in a route, it MUST be exported from the service file
- If a type is used in multiple files, define it ONCE in a shared types file and import it everywhere
- Output files using \`\`\`file:<path> format
- Output ONLY skeleton files, no explanatory text`,
    },
    {
      role: "user",
      content: [
        "## All tasks that will be implemented",
        allTasks,
        "",
        typeFileContents.length > 0
          ? `## Existing type files from Architect\n${typeFileContents.join("\n\n")}`
          : "",
        "",
        state.apiContracts.length > 0
          ? `## API Contracts\n${state.apiContracts
              .map((c) => `- ${c.method} ${c.endpoint} (${c.service})`)
              .join("\n")}`
          : "",
        "",
        "Generate skeleton files for:",
        "1. All shared type definitions (types/, interfaces/)",
        "2. All service files (lib/server/*/*.service.ts)",
        "3. All API client files (lib/api/*.ts) for frontend consumption",
        "4. Validation schemas if needed",
        "",
        "Each skeleton must export every identifier that will be imported by other files.",
        "Output ONLY skeleton files using ```file:<path> format.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(
      messages,
      skeletonModelChain,
      {
        temperature: 0.1,
        max_tokens: 16384,
      },
    );

    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);
    const skeletonFiles = parseFileOutput(content);

    const skOpts = scaffoldWriteOpts(state, false);
    const newEntries: GeneratedFile[] = [];
    for (const [fp, fc] of Object.entries(skeletonFiles)) {
      await fsWrite(fp, fc, state.outputDir, skOpts);

      const exports = extractExports(fc);
      newEntries.push({
        path: fp,
        role: "architect",
        summary: `Interface skeleton for: ${fp}`,
        exports,
      });
    }

    console.log(
      `[Supervisor] generateServiceSkeletons: generated ${newEntries.length} skeleton file(s) (model=${response.model}, cost: $${costUsd.toFixed(4)})`,
    );

    return {
      fileRegistry: newEntries,
      totalCostUsd: costUsd,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[Supervisor] generateServiceSkeletons: error — ${msg}. Continuing without skeletons.`,
    );
    return {};
  }
}

function extractExports(source: string): string[] {
  const exports = new Set<string>();

  const namedPattern =
    /^export\s+(?:const|function|class|type|interface|enum|async\s+function)\s+(\w+)/gm;
  const bracePattern = /export\s*\{([^}]+)\}/g;
  const defaultPattern = /^export\s+default\s+(?:function|class)\s+(\w+)/gm;

  let m: RegExpExecArray | null;

  while ((m = namedPattern.exec(source)) !== null) {
    if (m[1]) exports.add(m[1]);
  }

  while ((m = bracePattern.exec(source)) !== null) {
    m[1].split(",").forEach((name) => {
      const trimmed = name.trim().split(" as ")[0].trim();
      if (trimmed) exports.add(trimmed);
    });
  }

  while ((m = defaultPattern.exec(source)) !== null) {
    if (m[1]) exports.add(m[1]);
  }

  return [...exports];
}

// ─── Phased dispatch (BE first, then FE) ───

/**
 * Phase 1 dispatch: only Backend and Test Workers.
 * Frontend waits for BE to complete so it can see BE's real output.
 */
function dispatchBackendAndTestWorkers(state: SupervisorState): Send[] {
  const sends: Send[] = [];

  const beCount = workersForRole("backend", state.backendTasks.length);
  const beChunks = chunkTasks(state.backendTasks, beCount);
  beChunks.forEach((tasks, i) => {
    sends.push(
      new Send("be_worker", {
        role: "backend" as CodingAgentRole,
        workerLabel: beCount > 1 ? `Backend Dev #${i + 1}` : "Backend Dev",
        tasks,
        outputDir: state.outputDir,
        projectContext: state.projectContext,
        fileRegistrySnapshot: state.fileRegistry,
        apiContractsSnapshot: state.apiContracts,
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
      }),
    );
  });

  if (state.testTasks.length > 0) {
    sends.push(
      new Send("be_worker", {
        role: "test" as CodingAgentRole,
        workerLabel: "Test Engineer",
        tasks: state.testTasks,
        outputDir: state.outputDir,
        projectContext: state.projectContext,
        fileRegistrySnapshot: state.fileRegistry,
        apiContractsSnapshot: state.apiContracts,
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
      }),
    );
  }

  if (sends.length === 0) {
    sends.push(
      new Send("be_worker", {
        role: "backend" as CodingAgentRole,
        workerLabel: "No-op",
        tasks: [],
        outputDir: state.outputDir,
        projectContext: "",
        fileRegistrySnapshot: [],
        apiContractsSnapshot: [],
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
      }),
    );
  }

  return sends;
}

/**
 * Phase 2 dispatch: Frontend Workers run after BE completes.
 * fileRegistry now contains BE's real output; apiContracts contains real endpoints.
 */
function dispatchFrontendWorkers(state: SupervisorState): Send[] {
  if (state.frontendTasks.length === 0) {
    return [
      new Send("fe_worker", {
        role: "frontend" as CodingAgentRole,
        workerLabel: "No-op",
        tasks: [],
        outputDir: state.outputDir,
        projectContext: "",
        fileRegistrySnapshot: [],
        apiContractsSnapshot: [],
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
      }),
    ];
  }

  const feCount = workersForRole("frontend", state.frontendTasks.length);
  const feChunks = chunkTasks(state.frontendTasks, feCount);

  const feContext = state.frontendDesignContext
    ? `${state.projectContext}\n\n---\n\n${state.frontendDesignContext}`
    : state.projectContext;

  return feChunks.map(
    (tasks, i) =>
      new Send("fe_worker", {
        role: "frontend" as CodingAgentRole,
        workerLabel: feCount > 1 ? `Frontend Dev #${i + 1}` : "Frontend Dev",
        tasks,
        outputDir: state.outputDir,
        projectContext: feContext,
        fileRegistrySnapshot: state.fileRegistry,
        apiContractsSnapshot: state.apiContracts,
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
      }),
  );
}

/**
 * After BE Workers complete, extract real routes from generated files
 * to supplement/correct the api_contract_phase contracts.
 */
async function extractRealContracts(state: SupervisorState) {
  const beFiles = state.fileRegistry.filter(
    (f) =>
      f.role === "backend" &&
      (f.path.includes("route") ||
        f.path.includes("controller") ||
        f.path.includes("handler") ||
        f.path.includes("api")) &&
      /\.(ts|js)$/.test(f.path),
  );

  if (beFiles.length === 0) {
    console.log("[Supervisor] extractRealContracts: no BE route files found.");
    return {};
  }

  console.log(
    `[Supervisor] extractRealContracts: scanning ${beFiles.length} BE file(s)...`,
  );

  const newContracts: ApiContract[] = [];

  for (const file of beFiles.slice(0, 8)) {
    const content = await fsRead(file.path, state.outputDir);
    if (content.startsWith("FILE_NOT_FOUND")) continue;

    const routePattern =
      /\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
    let match;
    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const endpoint = match[2];

      const exists = newContracts.some(
        (c) => c.method === method && c.endpoint === endpoint,
      );
      if (!exists) {
        newContracts.push({
          service: file.path.split("/").slice(-2, -1)[0] ?? "api",
          endpoint: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
          method,
          schema: "extracted from source",
          generatedBy: "extract_real_contracts",
        });
      }
    }
  }

  if (newContracts.length > 0) {
    console.log(
      `[Supervisor] extractRealContracts: found ${newContracts.length} real route(s).`,
    );
  }

  return { apiContracts: newContracts };
}

// ─── Build gate ───

/**
 * Run pnpm/npm build for web and api packages. Returns error text if build
 * fails, empty string if it passes or no build script exists.
 */
async function runBuildGate(outputDir: string): Promise<string> {
  console.log("[Supervisor] Build gate: attempting pnpm run build...");

  const pkgRaw = await fsRead("package.json", outputDir);
  if (pkgRaw.startsWith("FILE_NOT_FOUND")) return "";

  let usesPnpm = false;
  try {
    const files = await listFiles(".", outputDir);
    usesPnpm = files.some(
      (f) => f.includes("pnpm-workspace.yaml") || f.includes("pnpm-lock.yaml"),
    );
  } catch {
    // ignore
  }

  const buildCmd = usesPnpm ? "pnpm run build 2>&1" : "npm run build 2>&1";

  try {
    const result = await shellExec(buildCmd, outputDir, { timeout: 120_000 });
    const out = (result.stderr || result.stdout || "").trim();

    if (result.exitCode === 0) {
      console.log("[Supervisor] Build gate: PASSED.");
      return "";
    }

    if (/Missing script|ENOENT|not found/.test(out)) {
      console.log("[Supervisor] Build gate: no build script found, skipping.");
      return "";
    }

    const lastLines = out.split("\n").slice(-40).join("\n");
    console.log(`[Supervisor] Build gate: FAILED.\n${lastLines.slice(0, 300)}`);
    return `## Build failed\n\`\`\`\n${lastLines}\n\`\`\``;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Missing script|ENOENT|not found/.test(msg)) return "";
    return `## Build error\n${msg.slice(0, 500)}`;
  }
}

// ─── Phase-level verify + fix (agentic loop) ───

const MAX_VERIFY_FIX_ITERATIONS = 20;

/**
 * RALPH Phase 2 — External Judge.
 * Runs `npm test` (or `npm run test`) and returns a trimmed error string when
 * tests fail, or an empty string when they pass.
 * Only called when `ralphConfig.enableTestVerification` is true.
 */
async function runTestVerification(outputDir: string): Promise<string> {
  console.log("[Supervisor] RALPH: running npm test as external judge...");
  try {
    const result = await shellExec(
      "npm run test -- --run 2>&1 | tail -40",
      outputDir,
      { timeout: 120_000 },
    );
    const out = (result.stdout || result.stderr || "").trim();
    if (result.exitCode !== 0) {
      const failedLines = out
        .split("\n")
        .filter((l) => /fail|error|✗|✕|FAIL|ERROR|AssertionError/i.test(l))
        .slice(0, 20)
        .join("\n");
      const summary = failedLines || out.slice(0, 1000);
      console.log(
        `[Supervisor] RALPH: npm test FAILED:\n${summary.slice(0, 200)}`,
      );
      return `## Test failures (RALPH external judge)\n${summary}`;
    }
    console.log("[Supervisor] RALPH: npm test PASSED.");
    return "";
  } catch (e) {
    // If no test script exists, silently skip.
    const msg = e instanceof Error ? e.message : String(e);
    if (/Missing script|ENOENT|not found/.test(msg)) return "";
    return `## Test runner error\n${msg.slice(0, 500)}`;
  }
}

// ─── Supervisor verify+fix tools ───────────────────────────────────────────────

const SUPERVISOR_VERIFY_TOOLS: OpenRouterToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command with cwd = project root. " +
        "Use for: pnpm/npm install, pnpm add <pkg> --filter <workspace>, " +
        "npx tsc --noEmit, npx prisma generate, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file by relative path from the project root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path, e.g. apps/api/src/index.ts",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write or replace a file at the given relative path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files recursively under a directory (default: project root).",
      parameters: {
        type: "object",
        properties: {
          dir: {
            type: "string",
            description: "Directory relative to project root (omit for root)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search for a pattern in source files (.ts/.tsx/.json). Returns matching lines.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Search pattern (regex or literal)",
          },
          path: {
            type: "string",
            description: "File or directory to search (default: .)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_done",
      description:
        "Signal that the verify+fix loop is complete. " +
        "status='pass' when `tsc --noEmit` exits 0. " +
        "status='fail' when errors remain that you cannot resolve.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pass", "fail"] },
          summary: {
            type: "string",
            description:
              "Brief summary: what was fixed, or remaining errors if fail",
          },
        },
        required: ["status", "summary"],
      },
    },
  },
];

/** Execute a single tool call from the verify+fix agent loop. */
async function executeSupervisorTool(
  name: string,
  args: Record<string, unknown>,
  outputDir: string,
): Promise<string> {
  const MAX_OUT = 4000;
  switch (name) {
    case "bash": {
      const command = String(args.command ?? "").trim();
      if (!command) return "Error: empty command";
      // Block obviously destructive ops only
      const unsafe = [/rm\s+-rf?\s+\//, /sudo\b/, /git\s+push\b/];
      if (unsafe.some((r) => r.test(command))) {
        return `Error: command rejected — unsafe pattern: ${command.slice(0, 80)}`;
      }
      console.log(`[Supervisor] VerifyFix bash: ${command.slice(0, 120)}`);
      try {
        const { stdout, stderr } = await execFileAsync(
          "bash",
          ["-c", command],
          {
            cwd: outputDir,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120_000,
            env: { ...process.env, FORCE_COLOR: "0" },
          },
        );
        const out = ((stdout ?? "") + (stderr ?? "")).trim();
        return `exit_code: 0\n${out.slice(0, MAX_OUT)}`;
      } catch (err: unknown) {
        const e = err as {
          code?: number;
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        const out = (
          (e.stdout ?? "") + (e.stderr ?? "") ||
          e.message ||
          "unknown error"
        ).trim();
        return `exit_code: ${e.code ?? 1}\n${out.slice(0, MAX_OUT)}`;
      }
    }
    case "read_file": {
      const fp = String(args.path ?? "");
      const content = await fsRead(fp, outputDir);
      return content.slice(0, MAX_OUT);
    }
    case "write_file": {
      const fp = String(args.path ?? "");
      const content = String(args.content ?? "");
      await fsWrite(fp, content, outputDir, { forceProtectedOverwrite: true });
      return `OK: wrote ${fp}`;
    }
    case "list_files": {
      const dir = String(args.dir ?? ".");
      const files = await listFiles(dir, outputDir);
      return files.join("\n").slice(0, MAX_OUT);
    }
    case "grep": {
      const pattern = String(args.pattern ?? "");
      const searchPath = String(args.path ?? ".");
      if (!pattern) return "Error: pattern required";
      const escaped = pattern.replace(/'/g, "'\\''");
      const cmd = `grep -r --include="*.ts" --include="*.tsx" --include="*.json" -n '${escaped}' ${searchPath} 2>&1 | head -60`;
      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-c", cmd], {
          cwd: outputDir,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30_000,
        });
        return ((stdout ?? "") + (stderr ?? "")).trim().slice(0, MAX_OUT);
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return ((e.stdout ?? "") + (e.stderr ?? "") || e.message || "")
          .trim()
          .slice(0, MAX_OUT);
      }
    }
    default:
      return `Error: unknown tool '${name}'`;
  }
}

function formatWorkerTscWarningsForRoles(
  phaseResults: PhaseResult[],
  roles: CodingAgentRole[],
): string {
  const roleSet = new Set(roles);
  const chunks: string[] = [];
  for (const pr of phaseResults) {
    if (!roleSet.has(pr.role)) continue;
    for (const tr of pr.taskResults) {
      if (tr.status !== "completed_with_warnings" || !tr.warnings?.length) {
        continue;
      }
      const text = tr.warnings.join("\n").trim();
      if (!text) continue;
      chunks.push(
        `### ${tr.taskId} (${pr.workerLabel})\n${text.slice(0, 6000)}`,
      );
    }
  }
  if (chunks.length === 0) return "";
  return [
    "",
    "## Worker task verify warnings (from per-task checks — fix all issues)",
    "",
    ...chunks,
    "",
  ].join("\n");
}

type PhaseVerifyAndFixOptions = {
  /** Which worker phase results to surface as initial hints (e.g. BE+test vs FE). */
  workerHintRoles?: CodingAgentRole[];
};

/**
 * Merged phase verify + fix as a single agentic loop.
 *
 * The LLM is given bash, read_file, write_file, list_files, and grep tools.
 * It installs deps, runs `prisma generate`, runs `tsc`, reads error files,
 * writes fixes, and keeps iterating until tsc passes or MAX_VERIFY_FIX_ITERATIONS
 * is reached. It finishes by calling `report_done`.
 *
 * Returns { scaffoldErrors: "" } on success, { scaffoldErrors: <errors> } on failure.
 * Replaces the old separate phaseVerify + phaseFix nodes and their graph loop.
 */
async function phaseVerifyAndFix(
  state: SupervisorState,
  options?: PhaseVerifyAndFixOptions,
): Promise<Partial<SupervisorState>> {
  const label = "[Supervisor] VerifyFix";
  const MAX_ITER = state.ralphConfig.enabled
    ? Math.min(
        state.ralphConfig.maxIterationsPerPhase * 3,
        MAX_VERIFY_FIX_ITERATIONS,
      )
    : MAX_VERIFY_FIX_ITERATIONS;

  console.log(
    `${label}: starting agentic loop (max ${MAX_ITER} iterations)...`,
  );

  const pm = await detectPackageManager(state.outputDir);
  const installCmd = buildInstallCommand(pm).replace("tail -30", "tail -10");
  const versionConstraints = await buildVersionConstraints(state.outputDir);

  const systemPrompt = [
    "You are a Senior Engineer. Your job: verify the generated codebase compiles cleanly and fix ALL errors.",
    "",
    "## Workflow (follow in order)",
    `1. Run: \`${installCmd}\`  — install all dependencies`,
    "2. Check if @prisma/client is used:",
    "   - If prisma/schema.prisma exists → run `npx prisma generate`",
    '   - Match Prisma major version: Prisma 5/6 expects `url = env("DATABASE_URL")` in datasource; Prisma 7+ may omit url — follow package.json.',
    "     If @prisma/client cannot be resolved, ensure it is in package.json and re-run install.",
    "3. Run: `npx tsc --noEmit --skipLibCheck --pretty false 2>&1`",
    "4. For each TypeScript error:",
    "   a. Read the file with the error",
    "   b. Read any imported modules that are missing exports",
    "   c. Write the fix (only change what's needed to resolve the error)",
    "5. Re-run tsc to verify your fixes didn't introduce new errors",
    "6. Repeat until tsc exits 0, then call `report_done(status='pass', summary=...)`",
    "7. If you cannot fix all errors after exhausting options, call `report_done(status='fail', summary=<remaining errors>)`",
    "",
    "## Hard rules",
    "- Fix ONLY compile/type errors. Do NOT change business logic.",
    "- Do NOT switch HTTP frameworks (Express ↔ Fastify ↔ Koa).",
    "- If an export is missing from a module, add it to that module's source file.",
    "- Install missing npm packages: `pnpm add <pkg> --filter <workspace-name>`",
    "- Do not rewrite entire files — minimal targeted changes only.",
    ...(versionConstraints ? ["", versionConstraints] : []),
  ].join("\n");

  const workerHints =
    options?.workerHintRoles && options.workerHintRoles.length > 0
      ? formatWorkerTscWarningsForRoles(
          state.phaseResults,
          options.workerHintRoles,
        )
      : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Project directory: ${state.outputDir}\nPackage manager: ${pm}${workerHints}\nBegin verification and fix now.`,
    },
  ];

  const modelChain = resolveModelChain(
    MODEL_CONFIG.phaseVerifyFix ?? MODEL_CONFIG.codeFix ?? "claude-sonnet",
    resolveModel,
  );

  let iterations = 0;
  let finalStatus: "pass" | "fail" = "fail";
  let finalSummary = "";
  let totalCostUsd = 0;

  /**
   * Estimate rough token count from messages (4 chars ≈ 1 token).
   * When the conversation grows beyond ~80k tokens, compact the middle portion
   * into a single summary assistant message, keeping system + last 6 messages.
   */
  function compactMessagesIfNeeded(): void {
    const COMPACT_THRESHOLD = 10_000 * 4; // ~10k tokens in chars
    const KEEP_TAIL = 6; // keep last N messages after system prompt
    const totalChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
      0,
    );
    if (totalChars < COMPACT_THRESHOLD) return;

    const systemMsg = messages[0];
    const tail = messages.slice(-KEEP_TAIL);
    const middle = messages.slice(1, messages.length - KEEP_TAIL);

    // Build a summary of the compacted middle
    const actionLines: string[] = [];
    for (const m of middle) {
      if (m.role === "tool") {
        actionLines.push(
          `[tool result] ${String(m.content ?? "").slice(0, 200)}`,
        );
      } else if (m.role === "assistant") {
        const calls = (m.tool_calls ?? [])
          .map((tc) => tc.function.name)
          .join(", ");
        if (calls) actionLines.push(`[assistant called] ${calls}`);
      }
    }
    const summary =
      `[Context compacted — ${middle.length} messages omitted]\n` +
      `Previous actions summary:\n${actionLines.slice(-30).join("\n")}`;

    messages.splice(
      0,
      messages.length,
      systemMsg,
      { role: "assistant", content: summary },
      ...tail,
    );
    console.log(
      `${label}: context compacted — removed ${middle.length} messages (was ~${Math.round(totalChars / 4)} tokens)`,
    );
  }

  while (iterations < MAX_ITER) {
    iterations++;
    console.log(`${label}: iteration ${iterations}/${MAX_ITER}`);

    // Compact context if growing too large
    compactMessagesIfNeeded();

    let resp;
    try {
      resp = await chatCompletionWithFallback(messages, modelChain, {
        temperature: 0.2,
        max_tokens: 36000,
        tools: SUPERVISOR_VERIFY_TOOLS,
        tool_choice: "auto",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${label}: LLM call failed: ${msg}`);
      break;
    }

    const choice = resp.choices[0];
    totalCostUsd += estimateCost(resp.model, resp.usage);

    // Append assistant message to conversation history
    messages.push({
      role: "assistant",
      content: choice.message.content ?? "",
      tool_calls: choice.message.tool_calls,
    });

    const toolCalls = choice.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // LLM stopped without calling report_done
      console.log(
        `${label}: LLM returned no tool calls at iteration ${iterations}`,
      );
      finalSummary = choice.message.content?.slice(0, 500) ?? "";
      break;
    }

    let doneSignaled = false;
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        /* ignore */
      }

      if (tc.function.name === "report_done") {
        finalStatus = (args.status as "pass" | "fail") ?? "fail";
        finalSummary = String(args.summary ?? "");
        doneSignaled = true;
        console.log(
          `${label}: report_done status=${finalStatus} — ${finalSummary.slice(0, 120)}`,
        );
        messages.push({
          role: "tool",
          content: "acknowledged",
          tool_call_id: tc.id,
          name: "report_done",
        });
      } else {
        const result = await executeSupervisorTool(
          tc.function.name,
          args,
          state.outputDir,
        );
        console.log(
          `${label}: tool=${tc.function.name} result_preview=${result.slice(0, 100).replace(/\n/g, " ")}`,
        );
        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
          name: tc.function.name,
        });
      }
    }

    if (doneSignaled) break;
  }

  // If no explicit report_done, run tsc one final time to determine actual status
  if (!finalSummary && finalStatus === "fail") {
    console.log(
      `${label}: no report_done received — running final tsc check...`,
    );
    const lastTsc = await shellExec(
      "npx tsc --noEmit --skipLibCheck --pretty false 2>&1",
      state.outputDir,
      { timeout: 90_000 },
    );
    const lastOut = (lastTsc.stdout + lastTsc.stderr).trim();
    if (lastTsc.exitCode === 0 || !lastOut.includes("error TS")) {
      finalStatus = "pass";
      finalSummary = "tsc passed on final check";
    } else {
      finalSummary = lastOut.slice(0, 3000);
    }
  }

  // RALPH test verification when tsc passes
  if (
    finalStatus === "pass" &&
    state.ralphConfig.enabled &&
    state.ralphConfig.enableTestVerification
  ) {
    const testErrors = await runTestVerification(state.outputDir);
    if (testErrors) {
      console.log(`${label}: tsc PASSED but tests FAILED (RALPH judge).`);
      finalStatus = "fail";
      finalSummary = testErrors;
    }
  }

  console.log(
    `${label}: done — status=${finalStatus} iterations=${iterations} cost=$${totalCostUsd.toFixed(4)}`,
  );

  return {
    scaffoldErrors: finalStatus === "pass" ? "" : finalSummary,
    scaffoldFixAttempts: iterations,
    totalCostUsd,
  };
}

/**
 * Prisma 5+ validates datasource config (get-config WASM) during `prisma generate`.
 * Schemas using `env("DATABASE_URL")` require a syntactically valid URL in the
 * environment; the coding output directory often has no `.env` loaded into the
 * shell, which yields P1012 on the `url` property. Use a local-only placeholder.
 *
 * Note: only relevant for Prisma 5/6 schemas that still have `url` in datasource.
 * Prisma 7+ removes `url` from the schema entirely (see migrateSchemaToPrisma7).
 */
function envForPrismaCliFromSchema(
  schemaContent: string,
): Record<string, string> {
  const provider = (name: string) =>
    new RegExp(`provider\\s*=\\s*["']${name}["']`, "i").test(schemaContent);

  if (provider("mysql")) {
    return {
      DATABASE_URL: "mysql://prisma:prisma@127.0.0.1:3306/prisma_phase_verify",
    };
  }
  if (provider("mongodb")) {
    return { DATABASE_URL: "mongodb://127.0.0.1:27017/prisma_phase_verify" };
  }
  if (provider("sqlserver")) {
    return {
      DATABASE_URL:
        "sqlserver://127.0.0.1:1433;database=prisma_phase_verify;user=sa;password=PrismaPhase1;encrypt=true;trustServerCertificate=true",
    };
  }
  if (provider("sqlite")) {
    if (/url\s*=\s*env\(\s*["']DATABASE_URL["']\s*\)/.test(schemaContent)) {
      return { DATABASE_URL: "file:./.prisma/prisma_phase_verify.db" };
    }
    return {};
  }
  if (provider("postgresql") || provider("cockroachdb")) {
    const url = "postgresql://prisma:prisma@127.0.0.1:5432/prisma_phase_verify";
    const out: Record<string, string> = { DATABASE_URL: url };
    if (/directUrl\s*=\s*env\(\s*["']DIRECT_URL["']\s*\)/.test(schemaContent)) {
      out.DIRECT_URL = url;
    }
    return out;
  }
  const fallback =
    "postgresql://prisma:prisma@127.0.0.1:5432/prisma_phase_verify";
  const out: Record<string, string> = { DATABASE_URL: fallback };
  if (/directUrl\s*=\s*env\(\s*["']DIRECT_URL["']\s*\)/.test(schemaContent)) {
    out.DIRECT_URL = fallback;
  }
  return out;
}

/**
 * Prisma 7+ removed the `url` / `directUrl` properties from `datasource db {}` blocks.
 * When `prisma generate` fails with P1012 "url is no longer supported", strip those
 * properties from schema.prisma and create a minimal `prisma.config.ts` so that
 * `prisma generate` can proceed without a live database connection.
 */
async function migrateSchemaToPrisma7(
  schemaContent: string,
  outputDir: string,
): Promise<{ migrated: boolean; newSchema: string }> {
  const hasUrl = /^\s+url\s*=/m.test(schemaContent);
  const hasDirectUrl = /^\s+directUrl\s*=/m.test(schemaContent);
  if (!hasUrl && !hasDirectUrl) {
    return { migrated: false, newSchema: schemaContent };
  }

  const newSchema = schemaContent
    .replace(/^\s+url\s*=\s*env\([^)]*\)\s*\n/gm, "")
    .replace(/^\s+url\s*=\s*"[^"]*"\s*\n/gm, "")
    .replace(/^\s+directUrl\s*=\s*env\([^)]*\)\s*\n/gm, "")
    .replace(/^\s+directUrl\s*=\s*"[^"]*"\s*\n/gm, "");

  await fsWrite("prisma/schema.prisma", newSchema, outputDir);

  // Create prisma.config.ts only if not already present
  const existing = await fsRead("prisma.config.ts", outputDir);
  if (existing.startsWith("FILE_NOT_FOUND")) {
    const configTs = [
      "import { defineConfig } from 'prisma/config'",
      "",
      "export default defineConfig({",
      "  schema: './prisma/schema.prisma',",
      "})",
      "",
    ].join("\n");
    await fsWrite("prisma.config.ts", configTs, outputDir);
  }

  console.log(
    "[Supervisor] Prisma 7 migration: removed `url`/`directUrl` from datasource, wrote prisma.config.ts",
  );
  return { migrated: true, newSchema };
}
// ─── (legacy) Parallel dispatch — kept for reference, replaced by phased dispatch ───

function dispatchParallelWorkers(state: SupervisorState): Send[] {
  const sends: Send[] = [];

  const beCount = workersForRole("backend", state.backendTasks.length);
  const beChunks = chunkTasks(state.backendTasks, beCount);
  beChunks.forEach((tasks, i) => {
    sends.push(
      new Send("parallel_worker", {
        role: "backend" as CodingAgentRole,
        workerLabel: beCount > 1 ? `Backend Dev #${i + 1}` : "Backend Dev",
        tasks,
        outputDir: state.outputDir,
        projectContext: state.projectContext,
        fileRegistrySnapshot: state.fileRegistry,
        apiContractsSnapshot: state.apiContracts,
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
      }),
    );
  });

  const feCount = workersForRole("frontend", state.frontendTasks.length);
  const feChunks = chunkTasks(state.frontendTasks, feCount);
  const feContext = state.frontendDesignContext
    ? `${state.projectContext}\n\n---\n\n${state.frontendDesignContext}`
    : state.projectContext;
  feChunks.forEach((tasks, i) => {
    sends.push(
      new Send("parallel_worker", {
        role: "frontend" as CodingAgentRole,
        workerLabel: feCount > 1 ? `Frontend Dev #${i + 1}` : "Frontend Dev",
        tasks,
        outputDir: state.outputDir,
        projectContext: feContext,
        fileRegistrySnapshot: state.fileRegistry,
        apiContractsSnapshot: state.apiContracts,
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
      }),
    );
  });

  if (state.testTasks.length > 0) {
    sends.push(
      new Send("parallel_worker", {
        role: "test" as CodingAgentRole,
        workerLabel: "Test Engineer",
        tasks: state.testTasks,
        outputDir: state.outputDir,
        projectContext: state.projectContext,
        fileRegistrySnapshot: state.fileRegistry,
        apiContractsSnapshot: state.apiContracts,
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
      }),
    );
  }

  if (sends.length === 0) {
    sends.push(
      new Send("parallel_worker", {
        role: "backend" as CodingAgentRole,
        workerLabel: "No-op",
        tasks: [],
        outputDir: state.outputDir,
        projectContext: "",
        fileRegistrySnapshot: [],
        apiContractsSnapshot: [],
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
      }),
    );
  }

  return sends;
}

async function parallelWorkerNode(
  input: WorkerState,
): Promise<Partial<SupervisorState>> {
  if (input.tasks.length === 0) {
    console.log(
      `[Supervisor] Parallel worker ${input.workerLabel}: no tasks, skipping.`,
    );
    return {};
  }

  console.log(
    `[Supervisor] Parallel worker ${input.workerLabel}: starting ${input.tasks.length} tasks...`,
  );
  const result = await workerGraph.invoke(input, { recursionLimit: 150 });
  const workerState = result as WorkerState;

  const phaseResult: PhaseResult = {
    role: input.role,
    workerLabel: input.workerLabel,
    taskResults: workerState.taskResults,
    totalCostUsd: workerState.workerCostUsd,
  };

  console.log(
    `[Supervisor] Parallel worker ${input.workerLabel} done: ${workerState.taskResults.length} results.`,
  );

  return {
    phaseResults: [phaseResult],
    fileRegistry: workerState.generatedFiles,
    totalCostUsd: workerState.workerCostUsd,
  };
}

// ─── Dependency sync: scan imports → install missing packages ───

const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

function extractPackageName(specifier: string): string | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return null;
  }
  if (specifier.startsWith("@/")) return null;
  if (specifier.startsWith("@shared/")) return null;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0];
}

function isUnderAnyPrefix(file: string, prefixes: string[]): boolean {
  const norm = file.replace(/\\/g, "/");
  return prefixes.some((root) => norm === root || norm.startsWith(`${root}/`));
}

async function scanImportsFromFiles(
  outputDir: string,
  sourceFiles: string[],
): Promise<Set<string>> {
  const importedPkgs = new Set<string>();
  for (const file of sourceFiles) {
    const content = await fsRead(file, outputDir);
    if (content.startsWith("FILE_NOT_FOUND") || content.startsWith("REJECTED"))
      continue;

    const patterns = [
      /(?:import|export)\s+.*?\s+from\s+["']([^"']+)["']/g,
      /(?:import|export)\s*\(["']([^"']+)["']\)/g,
      /require\s*\(["']([^"']+)["']\)/g,
      /import\s+["']([^"']+)["']/g,
    ];

    for (const pat of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pat.exec(content)) !== null) {
        const pkg = extractPackageName(m[1]);
        if (pkg && !NODE_BUILTINS.has(pkg)) {
          importedPkgs.add(pkg);
        }
      }
    }
  }
  return importedPkgs;
}

/** Root package.json vs imports; excludes sources that live under nested package roots (e.g. frontend/). */
async function collectMissingImportPackages(
  outputDir: string,
  nestedPackageRoots: string[] = [],
): Promise<string[]> {
  const nestedNorm = nestedPackageRoots.map((r) => r.replace(/\\/g, "/"));
  const files = await listFiles(".", outputDir);
  const sourceFiles = files.filter(
    (f) =>
      /\.(tsx?|jsx?|mjs|cjs)$/.test(f) &&
      !f.includes("node_modules") &&
      !isUnderAnyPrefix(f, nestedNorm),
  );

  const importedPkgs = await scanImportsFromFiles(outputDir, sourceFiles);
  if (importedPkgs.size === 0) return [];

  const pkgJsonContent = await fsRead("package.json", outputDir);
  if (pkgJsonContent.startsWith("FILE_NOT_FOUND")) return [];

  let pkgJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkgJson = JSON.parse(pkgJsonContent);
  } catch {
    return [];
  }

  const declared = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ]);

  return [...importedPkgs]
    .filter((pkg) => !declared.has(pkg))
    .filter(isAutoInstallableNpmPackageName);
}

/** Missing deps for a nested package (e.g. apps/api) vs its own package.json. */
async function collectMissingImportPackagesForPrefix(
  outputDir: string,
  prefix: string,
): Promise<string[]> {
  const prefixNorm = prefix.replace(/\\/g, "/");
  const files = await listFiles(".", outputDir);
  const sourceFiles = files.filter((f) => {
    const norm = f.replace(/\\/g, "/");
    return (
      /\.(tsx?|jsx?|mjs|cjs)$/.test(f) &&
      !f.includes("node_modules") &&
      (norm === prefixNorm || norm.startsWith(`${prefixNorm}/`))
    );
  });

  const importedPkgs = await scanImportsFromFiles(outputDir, sourceFiles);
  if (importedPkgs.size === 0) return [];

  const pkgJsonContent = await fsRead(`${prefixNorm}/package.json`, outputDir);
  if (pkgJsonContent.startsWith("FILE_NOT_FOUND")) return [];

  let pkgJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkgJson = JSON.parse(pkgJsonContent);
  } catch {
    return [];
  }

  const declared = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ]);

  return [...importedPkgs]
    .filter((pkg) => !declared.has(pkg))
    .filter(isAutoInstallableNpmPackageName);
}

const VERIFY_IMPORT_INSTALL_TIMEOUT_MS = 120_000;

/** Read the "name" field from a nested package's package.json (for pnpm --filter). */
async function readWorkspacePackageName(
  rel: string,
  outputDir: string,
): Promise<string | null> {
  try {
    const raw = await fsRead(`${rel}/package.json`, outputDir);
    if (raw.startsWith("FILE_NOT_FOUND")) return null;
    const pkg = JSON.parse(raw) as { name?: string };
    return pkg.name ?? null;
  } catch {
    return null;
  }
}

async function installImportGapsAllProjects(outputDir: string): Promise<void> {
  await runNpmInstallAllRoots(outputDir);

  const pm = await detectPackageManager(outputDir);
  const dirs = await findPackageJsonRelativeDirs(outputDir);
  const nested = dirs.filter((d) => d !== ".");

  const rootMissing = await collectMissingImportPackages(outputDir, nested);
  if (rootMissing.length > 0) {
    console.log(
      `[Supervisor] Integration verify: root add (${rootMissing.length}): ${rootMissing.join(", ")}`,
    );
    const cmd = buildAddCommand(pm, rootMissing);
    const r = await shellExec(cmd, outputDir, {
      timeout: VERIFY_IMPORT_INSTALL_TIMEOUT_MS,
    });
    if (r.exitCode !== 0) {
      console.warn(
        `[Supervisor] Integration verify: root import-based add exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 300)}`,
      );
    }
  }

  for (const rel of nested) {
    const missing = await collectMissingImportPackagesForPrefix(outputDir, rel);
    if (missing.length === 0) continue;
    console.log(
      `[Supervisor] Integration verify: "${rel}" add (${missing.length}): ${missing.join(", ")}`,
    );

    let r;
    if (pm === "pnpm") {
      // For pnpm workspaces, add packages via --filter from root
      const pkgName = await readWorkspacePackageName(rel, outputDir);
      const filter = pkgName ?? path.basename(rel);
      const cmd = buildAddCommand("pnpm", missing, { filter });
      r = await shellExec(cmd, outputDir, {
        timeout: VERIFY_IMPORT_INSTALL_TIMEOUT_MS,
      });
    } else {
      const cwd = path.join(outputDir, rel);
      const cmd = buildAddCommand(pm, missing);
      r = await shellExec(cmd, cwd, {
        timeout: VERIFY_IMPORT_INSTALL_TIMEOUT_MS,
      });
    }

    if (r.exitCode !== 0) {
      console.warn(
        `[Supervisor] Integration verify: "${rel}" add exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 300)}`,
      );
    }
  }
}

async function syncDeps(_state: SupervisorState) {
  console.log(
    "[Supervisor] sync_deps: skipping installs (npm install runs in integration verify).",
  );
  return {};
}

const MAX_INTEGRATION_VERIFY_FIX_ITERATIONS = 80;

// ─── DB dependency detection (Fix 3) ─────────────────────────────────────────

interface DbDependencyInfo {
  hasPrisma: boolean;
  hasSequelize: boolean;
  hasMongoose: boolean;
  hasKnex: boolean;
  hasDrizzle: boolean;
  hasBetterSqlite: boolean;
  hasEnvFile: boolean;
  hasDatabaseUrl: boolean;
  hasDockerCompose: boolean;
}

async function detectDbDependencies(
  outputDir: string,
): Promise<DbDependencyInfo> {
  const info: DbDependencyInfo = {
    hasPrisma: false,
    hasSequelize: false,
    hasMongoose: false,
    hasKnex: false,
    hasDrizzle: false,
    hasBetterSqlite: false,
    hasEnvFile: false,
    hasDatabaseUrl: false,
    hasDockerCompose: false,
  };

  // Check package.json dependencies — root and monorepo api workspace
  const pkgPaths = ["package.json", "apps/api/package.json"];
  for (const pkgPath of pkgPaths) {
    const pkgRaw = await fsRead(pkgPath, outputDir);
    if (pkgRaw.startsWith("FILE_NOT_FOUND")) continue;
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      info.hasPrisma =
        info.hasPrisma || "@prisma/client" in deps || "prisma" in deps;
      info.hasSequelize = info.hasSequelize || "sequelize" in deps;
      info.hasMongoose = info.hasMongoose || "mongoose" in deps;
      info.hasKnex = info.hasKnex || "knex" in deps;
      info.hasDrizzle = info.hasDrizzle || "drizzle-orm" in deps;
      info.hasBetterSqlite = info.hasBetterSqlite || "better-sqlite3" in deps;
    } catch {
      // ignore parse errors
    }
  }

  // Check .env / .env.local
  for (const envFile of [".env", ".env.local"]) {
    const envRaw = await fsRead(envFile, outputDir);
    if (!envRaw.startsWith("FILE_NOT_FOUND")) {
      info.hasEnvFile = true;
      if (/DATABASE_URL\s*=/.test(envRaw)) info.hasDatabaseUrl = true;
      break;
    }
  }

  // Check docker-compose
  for (const f of ["docker-compose.yml", "docker-compose.yaml"]) {
    const raw = await fsRead(f, outputDir);
    if (!raw.startsWith("FILE_NOT_FOUND")) {
      info.hasDockerCompose = true;
      break;
    }
  }

  return info;
}

/**
 * Run Prisma-specific setup steps:
 *   1. If .env is absent, write it from `BLUEPRINT_GENERATED_DATABASE_URL` (Agentic Builder env).
 *   2. prisma generate (always safe, no DB needed).
 *   3. Attempt prisma migrate dev if a live DB is reachable:
 *        - If docker-compose.yml exists, try `docker-compose up -d` then migrate.
 *        - If DATABASE_URL is already set in .env, migrate directly.
 *      Failures are non-fatal: we warn and leave clear manual instructions.
 * Returns warning text to surface in integration errors, or "" if all good.
 */
async function handlePrismaSetup(
  outputDir: string,
  info: DbDependencyInfo,
): Promise<string> {
  const warnings: string[] = [];

  // ── Step 1: ensure .env (scaffold may have written it; else use Blueprint env) ──
  if (!info.hasEnvFile) {
    const fromBlueprint = resolveBlueprintGeneratedDatabaseUrl();
    if (fromBlueprint) {
      await fsWrite(
        ".env",
        formatGeneratedCodeDotEnv(fromBlueprint),
        outputDir,
      );
      info.hasEnvFile = true;
      info.hasDatabaseUrl = true;
      console.log(
        "[Supervisor] DB check: wrote .env from BLUEPRINT_GENERATED_DATABASE_URL",
      );
    }
  }

  // ── Step 2: prisma generate ──────────────────────────────────────────────
  let schemaRaw = await fsRead("prisma/schema.prisma", outputDir);
  if (schemaRaw.startsWith("FILE_NOT_FOUND")) {
    warnings.push(
      "## Missing prisma/schema.prisma\n" +
        "@prisma/client is installed but prisma/schema.prisma was not generated. " +
        "Add a Prisma schema file or the app will fail at runtime.",
    );
    return warnings.join("\n\n");
  }
  if (schemaRaw.charCodeAt(0) === 0xfeff) {
    schemaRaw = schemaRaw.slice(1);
    await fsWrite("prisma/schema.prisma", schemaRaw, outputDir);
  }

  const normalizedSchema = ensurePrismaDatasourceDatabaseUrl(schemaRaw);
  if (normalizedSchema !== schemaRaw) {
    schemaRaw = normalizedSchema;
    await fsWrite("prisma/schema.prisma", schemaRaw, outputDir);
    console.log(
      '[Supervisor] DB check: ensured datasource url = env("DATABASE_URL") in schema.prisma',
    );
  }

  console.log("[Supervisor] DB check: running npx prisma generate...");
  let genResult = await execPrismaGenerate(
    outputDir,
    envForPrismaCliFromSchema(schemaRaw),
    { timeout: 90_000 },
  );
  if (genResult.exitCode !== 0) {
    const out = (genResult.stdout + genResult.stderr).trim();
    // Prisma 7+ removed `url` from datasource — auto-migrate and retry once.
    const isPrisma7UrlError =
      out.includes("P1012") &&
      (out.includes("no longer supported") ||
        out.includes("datasource property"));
    if (isPrisma7UrlError) {
      console.log(
        "[Supervisor] DB check: Prisma 7 `url` incompatibility — auto-migrating schema...",
      );
      const { migrated, newSchema } = await migrateSchemaToPrisma7(
        schemaRaw,
        outputDir,
      );
      if (migrated) {
        schemaRaw = newSchema;
        genResult = await execPrismaGenerate(
          outputDir,
          {},
          { timeout: 90_000 },
        );
        if (genResult.exitCode !== 0) {
          const retryOut = (genResult.stdout + genResult.stderr).trim();
          warnings.push(`## Prisma generate failed\n${retryOut.slice(0, 500)}`);
          console.warn(
            `[Supervisor] DB check: prisma generate still failed after migration: ${retryOut.slice(0, 200)}`,
          );
          return warnings.join("\n\n");
        }
        console.log(
          "[Supervisor] DB check: prisma generate OK after Prisma 7 migration.",
        );
      }
    } else {
      warnings.push(`## Prisma generate failed\n${out.slice(0, 500)}`);
      console.warn(
        `[Supervisor] DB check: prisma generate failed: ${out.slice(0, 200)}`,
      );
      return warnings.join("\n\n");
    }
  } else {
    console.log("[Supervisor] DB check: prisma generate OK.");
  }

  // ── Step 3: prisma migrate dev ───────────────────────────────────────────
  let dbReachable = info.hasDatabaseUrl;

  if (!dbReachable && info.hasDockerCompose) {
    console.log(
      "[Supervisor] DB check: starting docker-compose services for migration...",
    );
    const upResult = await shellExec(
      "docker-compose up -d 2>&1 | tail -5",
      outputDir,
      { timeout: 60_000 },
    );
    if (upResult.exitCode === 0) {
      console.log(
        "[Supervisor] DB check: docker-compose up -d OK, waiting 8s for DB to be ready...",
      );
      await new Promise((r) => setTimeout(r, 8_000));
      dbReachable = true;
    } else {
      const out = (upResult.stdout || upResult.stderr || "").trim();
      console.warn(
        `[Supervisor] DB check: docker-compose up failed: ${out.slice(0, 200)}`,
      );
    }
  }

  if (dbReachable) {
    console.log(
      "[Supervisor] DB check: running npx prisma migrate dev --name init...",
    );
    const migrateResult = await shellExec(
      "npx prisma migrate dev --name init --skip-seed 2>&1 | tail -20",
      outputDir,
      { timeout: 120_000 },
    );
    if (migrateResult.exitCode === 0) {
      console.log("[Supervisor] DB check: prisma migrate dev OK.");
    } else {
      const out = (migrateResult.stdout || migrateResult.stderr || "").trim();
      warnings.push(
        `## Prisma migrate dev failed\n${out.slice(0, 500)}\n\n` +
          "Run manually once your database is running:\n" +
          "```\ndocker-compose up -d\nnpx prisma migrate dev --name init\n```",
      );
      console.warn(
        `[Supervisor] DB check: prisma migrate dev failed: ${out.slice(0, 200)}`,
      );
    }
  } else {
    warnings.push(
      "## Prisma migrate dev skipped\n" +
        "No live database detected (no DATABASE_URL in .env and docker-compose could not start).\n\n" +
        "Run manually once your database is ready:\n" +
        "```\ndocker-compose up -d\nnpx prisma migrate dev --name init\n```",
    );
  }

  if (!info.hasDockerCompose) {
    warnings.push(
      "## Missing docker-compose.yml\n" +
        "No docker-compose.yml found. Create one to provision the database service, " +
        "then run: docker-compose up -d && npx prisma migrate dev --name init",
    );
  }

  return warnings.join("\n\n");
}

/**
 * Scan all generated .ts/.tsx files and replace wrong workspace import prefixes
 * with the correct one read from packages/shared/package.json.
 *
 * Agents sometimes hallucinate `@repo/shared` or `@shared` instead of the real
 * workspace name (e.g. `@project/shared`). This corrects them before tsc runs.
 */
async function normalizeWorkspaceImports(outputDir: string): Promise<void> {
  const pkgRaw = await fsRead("packages/shared/package.json", outputDir);
  if (pkgRaw.startsWith("FILE_NOT_FOUND")) return;

  let sharedPkgName: string;
  try {
    sharedPkgName = (JSON.parse(pkgRaw) as { name?: string }).name ?? "";
  } catch {
    return;
  }
  if (!sharedPkgName) return;

  // Build a list of wrong prefixes to replace
  const wrongPrefixes = ["@repo/shared", "@shared", "@monorepo/shared"].filter(
    (p) => p !== sharedPkgName,
  );
  if (wrongPrefixes.length === 0) return;

  // Find all .ts/.tsx files in apps/ and packages/
  const srcDirs = ["apps", "packages"];
  let fixed = 0;

  for (const dir of srcDirs) {
    let files: string[] = [];
    try {
      files = await listFiles(dir, outputDir);
    } catch {
      continue;
    }
    for (const relPath of files) {
      if (!/\.(ts|tsx)$/.test(relPath)) continue;
      const content = await fsRead(relPath, outputDir);
      if (
        content.startsWith("FILE_NOT_FOUND") ||
        content.startsWith("REJECTED")
      )
        continue;

      let updated = content;
      for (const wrong of wrongPrefixes) {
        if (updated.includes(wrong)) {
          updated = updated.split(wrong).join(sharedPkgName);
        }
      }
      if (updated !== content) {
        await fsWrite(relPath, updated, outputDir);
        fixed++;
        console.log(
          `[Supervisor] normalizeWorkspaceImports: fixed "${relPath}" (${wrongPrefixes.find((p) => content.includes(p))} → ${sharedPkgName})`,
        );
      }
    }
  }

  if (fixed > 0) {
    console.log(
      `[Supervisor] normalizeWorkspaceImports: corrected ${fixed} file(s).`,
    );
  }
}

/**
 * Merged integration verify + fix as a single agentic loop.
 *
 * Replaces the old separate integrationVerify + integrationFix nodes and their
 * conditional loop edge. The LLM is given the same bash/filesystem/grep tools
 * as phaseVerifyAndFix and runs up to MAX_INTEGRATION_VERIFY_FIX_ITERATIONS
 * rounds to discover and fix all compile/convention/build errors.
 */
async function integrationVerifyAndFix(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  const label = "[Supervisor] IntegrationVerifyFix";
  const MAX_ITER = state.ralphConfig.enabled
    ? Math.min(
        state.ralphConfig.maxIterationsPerPhase * 5,
        MAX_INTEGRATION_VERIFY_FIX_ITERATIONS,
      )
    : MAX_INTEGRATION_VERIFY_FIX_ITERATIONS;

  console.log(
    `${label}: starting agentic loop (max ${MAX_ITER} iterations)...`,
  );

  // ── Pre-flight: workspace normalisation + dep install + DB setup ─────────
  console.log(
    `${label}: pre-flight — normalising workspace imports & installing deps...`,
  );
  await normalizeWorkspaceImports(state.outputDir);
  await installImportGapsAllProjects(state.outputDir);

  const dbInfo = await detectDbDependencies(state.outputDir);
  const hasAnyOrmWithExternalDb =
    dbInfo.hasPrisma ||
    dbInfo.hasSequelize ||
    dbInfo.hasMongoose ||
    dbInfo.hasKnex ||
    dbInfo.hasDrizzle;

  if (hasAnyOrmWithExternalDb) {
    console.log(
      `${label}: ORM detected (prisma=${dbInfo.hasPrisma}, sequelize=${dbInfo.hasSequelize}, mongoose=${dbInfo.hasMongoose}, knex=${dbInfo.hasKnex}, drizzle=${dbInfo.hasDrizzle}). Running setup...`,
    );
    if (dbInfo.hasPrisma) {
      const prismaWarnings = await handlePrismaSetup(state.outputDir, dbInfo);
      if (prismaWarnings) {
        console.warn(
          `${label}: DB check warnings:\n${prismaWarnings.slice(0, 400)}`,
        );
      }
    }
    if (!dbInfo.hasDockerCompose) {
      console.warn(
        `${label}: No docker-compose.yml detected — app may fail at runtime without a DB.`,
      );
    }
    if (!dbInfo.hasDatabaseUrl) {
      console.warn(
        `${label}: No DATABASE_URL — configure before running the app.`,
      );
    }
  }
  if (dbInfo.hasBetterSqlite) {
    console.log(
      `${label}: better-sqlite3 detected (SQLite, file-based). No external service needed.`,
    );
  }

  // ── Determine tsc command ─────────────────────────────────────────────────
  const allPaths = state.fileRegistry.map((f) => f.path);
  const tscProject = await findBestTsconfigForFiles(allPaths, state.outputDir);
  const tscCmd = tscProject
    ? `npx tsc --noEmit --pretty false --skipLibCheck --project ${tscProject} 2>&1`
    : `npx tsc --noEmit --pretty false --skipLibCheck 2>&1`;
  if (tscProject) {
    console.log(`${label}: using --project ${tscProject}`);
  }

  // ── Package manager + version constraints ────────────────────────────────
  const pm = await detectPackageManager(state.outputDir);
  const installCmd = buildInstallCommand(pm).replace("tail -30", "tail -10");
  const versionConstraints = await buildVersionConstraints(state.outputDir);

  // ── Protected files list ──────────────────────────────────────────────────
  const protectedPaths = state.scaffoldProtectedPaths ?? [];
  const protectedFilesBlock =
    protectedPaths.length > 0
      ? [
          "",
          "## Protected scaffold files (YOU MAY EDIT THESE in this phase)",
          "The following files were generated from scaffold templates. During earlier phases",
          "they were write-protected, but in Final Verification you MUST inspect each one",
          "and fix any implementation errors, missing handlers, or PRD mismatches.",
          "Treat them with the same rigor as any other source file:",
          ...protectedPaths.map((p) => `  - ${p}`),
        ].join("\n")
      : "";

  // ── PRD context (truncated to keep prompt manageable) ────────────────────
  const prdBlock = state.projectContext
    ? `\n## Product Requirements (PRD)\nUse this as the authoritative specification when reviewing feature completeness.\n\n${state.projectContext.slice(0, 12000)}`
    : "";

  const systemPrompt = [
    "You are a Senior Full-Stack Engineer performing the **Final Verification** of a fully generated codebase.",
    "Your two objectives, in order:",
    "  1. Fix ALL compile/type/build errors so the project builds cleanly.",
    "  2. Review the PRD requirements and ensure every feature is correctly implemented and user-usable.",
    "",
    "## Phase 1 — Compile & Build",
    `1. Run: \`${tscCmd}\`  — check TypeScript errors across the whole project`,
    "2. For each TypeScript error:",
    "   a. Read the file with the error",
    "   b. Read any imported modules that are missing exports",
    "   c. Write the minimal fix",
    "3. Re-run tsc after fixes",
    "4. If tsc passes, also run the build:",
    `   - Run: \`${installCmd}\` if needed`,
    "   - Run: `pnpm run build 2>&1` (or `npm run build 2>&1`) to confirm no build errors",
    "5. Repeat until tsc exits 0 AND build succeeds",
    "",
    "## Phase 2 — PRD Implementation Review",
    "After the project compiles, perform a comprehensive review against the PRD:",
    "1. List all major features/requirements in the PRD",
    "2. For each feature, verify the implementation:",
    "   a. Use `grep` to find related files and handlers",
    "   b. Read the relevant source files",
    "   c. Check: is the feature fully implemented? Are edge cases handled?",
    "   d. Check: will a real user be able to use this feature end-to-end?",
    "3. Fix any missing or broken feature implementations",
    "4. Specifically inspect every Protected Scaffold File listed below:",
    "   - Check that business logic was correctly added (not left as stub/TODO)",
    "   - Check that routes, controllers, services, and configs are wired up correctly",
    "   - Fix any implementation errors — you ARE allowed to edit these files in this phase",
    "5. After all fixes, call `report_done(status='pass', summary=...)` with a brief feature coverage summary",
    "   OR `report_done(status='fail', summary=<unresolved issues>)` if critical features cannot be fixed",
    "",
    "## Hard rules",
    "- Do NOT switch HTTP frameworks (Express ↔ Fastify ↔ Koa) or frontend frameworks.",
    "- For M-tier web projects, page root must be only apps/web/src/pages.",
    "- Minimal targeted changes — do not rewrite working code.",
    "- Install missing npm packages: `pnpm add <pkg> --filter <workspace-name>`",
    "- If errors include [CONVENTION], they are policy violations and MUST be fixed.",
    ...(versionConstraints ? ["", versionConstraints] : []),
    protectedFilesBlock,
  ].join("\n");

  const openingUserContent = [
    `Project directory: ${state.outputDir}`,
    `Package manager: ${pm}`,
    prdBlock,
    "",
    "Begin Phase 1 (compile & build) first, then proceed to Phase 2 (PRD review) once the project compiles cleanly.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: openingUserContent },
  ];

  const modelChain = resolveModelChain(
    MODEL_CONFIG.phaseVerifyFix ?? MODEL_CONFIG.codeFix ?? "claude-sonnet",
    resolveModel,
  );

  let iterations = 0;
  let finalStatus: "pass" | "fail" = "fail";
  let finalSummary = "";
  let totalCostUsd = 0;

  /**
   * Context compression: when messages exceed ~30k tokens, compact the middle
   * portion into a summary, keeping system prompt + last 6 messages.
   */
  function compactMessagesIfNeeded(): void {
    const COMPACT_THRESHOLD = 30_000 * 4;
    const KEEP_TAIL = 6;
    const totalChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
      0,
    );
    if (totalChars < COMPACT_THRESHOLD) return;

    const systemMsg = messages[0];
    const tail = messages.slice(-KEEP_TAIL);
    const middle = messages.slice(1, messages.length - KEEP_TAIL);

    const actionLines: string[] = [];
    for (const m of middle) {
      if (m.role === "tool") {
        actionLines.push(
          `[tool result] ${String(m.content ?? "").slice(0, 200)}`,
        );
      } else if (m.role === "assistant") {
        const calls = (m.tool_calls ?? [])
          .map((tc) => tc.function.name)
          .join(", ");
        if (calls) actionLines.push(`[assistant called] ${calls}`);
      }
    }
    const summary =
      `[Context compacted — ${middle.length} messages omitted]\n` +
      `Previous actions summary:\n${actionLines.slice(-30).join("\n")}`;

    messages.splice(
      0,
      messages.length,
      systemMsg,
      { role: "assistant", content: summary },
      ...tail,
    );
    console.log(
      `${label}: context compacted — removed ${middle.length} messages (was ~${Math.round(totalChars / 4)} tokens)`,
    );
  }

  while (iterations < MAX_ITER) {
    iterations++;
    console.log(`${label}: iteration ${iterations}/${MAX_ITER}`);

    compactMessagesIfNeeded();

    let resp;
    try {
      resp = await chatCompletionWithFallback(messages, modelChain, {
        temperature: 0.2,
        max_tokens: 36000,
        tools: SUPERVISOR_VERIFY_TOOLS,
        tool_choice: "auto",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${label}: LLM call failed: ${msg}`);
      break;
    }

    const choice = resp.choices[0];
    totalCostUsd += estimateCost(resp.model, resp.usage);

    messages.push({
      role: "assistant",
      content: choice.message.content ?? "",
      tool_calls: choice.message.tool_calls,
    });

    const toolCalls = choice.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      console.log(
        `${label}: LLM returned no tool calls at iteration ${iterations}`,
      );
      finalSummary = choice.message.content?.slice(0, 500) ?? "";
      break;
    }

    let doneSignaled = false;
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        /* ignore */
      }

      if (tc.function.name === "report_done") {
        finalStatus = (args.status as "pass" | "fail") ?? "fail";
        finalSummary = String(args.summary ?? "");
        doneSignaled = true;
        console.log(
          `${label}: report_done status=${finalStatus} — ${finalSummary.slice(0, 120)}`,
        );
        messages.push({
          role: "tool",
          content: "acknowledged",
          tool_call_id: tc.id,
          name: "report_done",
        });
      } else {
        const result = await executeSupervisorTool(
          tc.function.name,
          args,
          state.outputDir,
        );
        console.log(
          `${label}: tool=${tc.function.name} result_preview=${result.slice(0, 100).replace(/\n/g, " ")}`,
        );
        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
          name: tc.function.name,
        });
      }
    }

    if (doneSignaled) break;
  }

  // If no explicit report_done, run tsc one final time to determine status
  if (!finalSummary && finalStatus === "fail") {
    console.log(
      `${label}: no report_done received — running final tsc check...`,
    );
    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-c", tscCmd], {
        cwd: state.outputDir,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 90_000,
      });
      const lastOut = ((stdout ?? "") + (stderr ?? "")).trim();
      if (!lastOut.includes("error TS")) {
        finalStatus = "pass";
        finalSummary = "tsc passed on final check";
      } else {
        finalSummary = lastOut.slice(0, 3000);
      }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      const lastOut = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
      if (!lastOut.includes("error TS")) {
        finalStatus = "pass";
        finalSummary = "tsc passed on final check";
      } else {
        finalSummary = lastOut.slice(0, 3000);
      }
    }
  }

  console.log(
    `${label}: done — status=${finalStatus} iterations=${iterations} cost=$${totalCostUsd.toFixed(4)}`,
  );

  return {
    integrationErrors:
      finalStatus === "pass" ? "" : finalSummary.slice(0, 4000),
    integrationFixAttempts: iterations,
    totalCostUsd,
  };
}

function summary(state: SupervisorState) {
  const totalTasks = state.phaseResults.reduce(
    (sum, pr) => sum + pr.taskResults.length,
    0,
  );
  const completedOk = state.phaseResults
    .flatMap((pr) => pr.taskResults)
    .filter((tr) => tr.status === "completed").length;
  const withWarnings = state.phaseResults
    .flatMap((pr) => pr.taskResults)
    .filter((tr) => tr.status === "completed_with_warnings").length;
  const failed = state.phaseResults
    .flatMap((pr) => pr.taskResults)
    .filter((tr) => tr.status === "failed").length;

  return {
    // Terminal state; no additional mutation needed
  };
}

// ─── Build supervisor graph ───

function dispatchGate(_state: SupervisorState) {
  return {};
}

export function createSupervisorGraph() {
  const feDispatchGate = (_state: SupervisorState) => ({});

  const graph = new StateGraph(SupervisorStateAnnotation)
    .addNode("classify_tasks", classifyTasks)
    .addNode("architect_phase", runArchitectPhase)
    .addNode("scaffold_verify", scaffoldVerify)
    .addNode("scaffold_fix", scaffoldFix)
    .addNode("dispatch_gate", dispatchGate)
    .addNode("refine_task_breakdown", refineTaskBreakdown)
    .addNode("dependency_baseline", dependencyBaseline)
    .addNode("generate_api_contracts", generateApiContracts)
    .addNode("bootstrap_shared_contracts", bootstrapSharedContracts)
    .addNode("generate_service_skeletons", generateServiceSkeletons)
    .addNode("be_worker", parallelWorkerNode)
    .addNode("be_phase_verify", (s) =>
      phaseVerifyAndFix(s, { workerHintRoles: ["backend", "test"] }),
    )
    .addNode("extract_real_contracts", extractRealContracts)
    .addNode("fe_dispatch_gate", feDispatchGate)
    .addNode("fe_worker", parallelWorkerNode)
    .addNode("fe_phase_verify", (s) =>
      phaseVerifyAndFix(s, { workerHintRoles: ["frontend"] }),
    )
    .addNode("sync_deps", syncDeps)
    .addNode("integration_verify", integrationVerifyAndFix)
    .addNode("gap_analysis", gapAnalysis)
    .addNode("supplementary_dispatch_gate", (_s: SupervisorState) => ({}))
    .addNode("supplementary_worker", parallelWorkerNode)
    .addNode("supplementary_verify", supplementaryVerify)
    .addNode("summary", summary)

    .addEdge(START, "classify_tasks")
    .addEdge("classify_tasks", "architect_phase")
    .addEdge("architect_phase", "scaffold_verify")
    .addConditionalEdges("scaffold_verify", shouldFixScaffoldOrContinue, {
      dispatch: "dispatch_gate",
      scaffold_fix: "scaffold_fix",
    })
    .addEdge("scaffold_fix", "scaffold_verify")
    .addEdge("dispatch_gate", "refine_task_breakdown")
    .addEdge("refine_task_breakdown", "dependency_baseline")
    .addEdge("dependency_baseline", "generate_api_contracts")
    .addEdge("generate_api_contracts", "bootstrap_shared_contracts")
    .addEdge("bootstrap_shared_contracts", "generate_service_skeletons")
    .addConditionalEdges(
      "generate_service_skeletons",
      dispatchBackendAndTestWorkers,
    )
    .addEdge("be_worker", "be_phase_verify")
    .addEdge("be_phase_verify", "extract_real_contracts")
    .addEdge("extract_real_contracts", "fe_dispatch_gate")
    .addConditionalEdges("fe_dispatch_gate", dispatchFrontendWorkers)
    .addEdge("fe_worker", "fe_phase_verify")
    .addEdge("fe_phase_verify", "sync_deps")
    .addEdge("sync_deps", "integration_verify")
    .addEdge("integration_verify", "gap_analysis")
    .addConditionalEdges("gap_analysis", shouldDispatchSupplementary, {
      supplementary_dispatch_gate: "supplementary_dispatch_gate",
      summary: "summary",
    })
    .addConditionalEdges(
      "supplementary_dispatch_gate",
      dispatchSupplementaryWorkers,
    )
    .addEdge("supplementary_worker", "supplementary_verify")
    .addEdge("supplementary_verify", "summary")
    .addEdge("summary", END);

  return graph.compile();
}
