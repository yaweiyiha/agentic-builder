import path from "path";
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
  extractErrorFiles,
  inferRelatedConfigFiles,
  hasConfigErrors,
  findBestTsconfigForFiles,
  buildVersionConstraints,
} from "./agent-subgraph";
import {
  shellExec,
  fsWrite,
  fsRead,
  listFiles,
  type FsWriteOptions,
} from "./tools";
import {
  chatCompletionWithFallback,
  resolveModel,
  estimateCost,
  type ChatMessage,
} from "@/lib/openrouter";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import type {
  CodingAgentRole,
  CodingTask,
  KickoffWorkItem,
} from "@/lib/pipeline/types";

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

function workersForRole(role: CodingAgentRole, count: number): number {
  if (role === "architect" || role === "test") return 1;
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
  const byRole: Record<CodingAgentRole, CodingTask[]> = {
    architect: [],
    backend: [],
    frontend: [],
    test: [],
  };
  for (const task of state.tasks) {
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
    `npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | head -40`,
    state.outputDir,
    { timeout: 30_000 },
  );

  const output = (stderr || stdout || "").trim();
  const hasErrors = exitCode !== 0 && output.includes("error TS");

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

async function findPackageJsonRelativeDirs(outputDir: string): Promise<string[]> {
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
  return [...dirs].sort(
    (a, b) => a.split("/").length - b.split("/").length,
  );
}

/** Run npm install at repo root (workspaces) or at each package root (no workspaces). */
async function runNpmInstallAllRoots(outputDir: string): Promise<void> {
  const rootPkgRaw = await fsRead("package.json", outputDir);
  if (!rootPkgRaw.startsWith("FILE_NOT_FOUND")) {
    try {
      const pkg = JSON.parse(rootPkgRaw) as { workspaces?: unknown };
      if (hasNpmWorkspaces(pkg)) {
        console.log(
          "[Supervisor] Integration verify: npm workspaces — npm install at repo root only.",
        );
        const r = await shellExec(
          "npm install --prefer-offline 2>&1 | tail -30",
          outputDir,
          { timeout: VERIFY_NPM_INSTALL_TIMEOUT_MS },
        );
        if (r.exitCode !== 0) {
          console.warn(
            `[Supervisor] Integration verify: root npm install exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 400)}`,
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
      `[Supervisor] Integration verify: npm install in "${rel === "." ? "." : rel}"`,
    );
    const r = await shellExec(
      "npm install --prefer-offline 2>&1 | tail -30",
      cwd,
      { timeout: VERIFY_NPM_INSTALL_TIMEOUT_MS },
    );
    if (r.exitCode !== 0) {
      console.warn(
        `[Supervisor] Integration verify: npm install in "${rel}" exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 400)}`,
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

  const codeFixChain = resolveModelChain(MODEL_CONFIG.codeFix ?? "gpt-4o", resolveModel);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a Senior Software Architect. Fix the build errors below so that "npm install && npm run build" succeeds.
Rules:
- NEVER use create-react-app or react-scripts. Use Vite + @vitejs/plugin-react or Next.js.
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
  return [...fileSet];
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

  const contractModelChain = resolveModelChain(MODEL_CONFIG.codeFix ?? "gpt-4o", resolveModel);
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
    const response = await chatCompletionWithFallback(messages, contractModelChain, {
      temperature: 0.1,
      max_tokens: 4096,
    });

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
 * Architect Phase 完成后，在 BE/FE 任务开始前，
 * 生成所有服务文件的接口骨架（类型定义 + 函数签名，无实现）。
 * 骨架文件让所有后续任务对接口有一致的预期，避免各自猜导出内容。
 */
async function generateServiceSkeletons(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  if (
    state.backendTasks.length === 0 &&
    state.frontendTasks.length === 0
  ) {
    return {};
  }

  console.log(
    "[Supervisor] generateServiceSkeletons: generating interface contracts...",
  );

  const allTasks = [
    ...state.backendTasks,
    ...state.frontendTasks,
  ]
    .map(
      (t) =>
        `- [${inferRole(t)}] ${t.title}: ${t.description.slice(0, 150)}`,
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

  const skeletonModelChain = resolveModelChain(MODEL_CONFIG.codeFix ?? "gpt-4o", resolveModel);
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
    const response = await chatCompletionWithFallback(messages, skeletonModelChain, {
      temperature: 0.1,
      max_tokens: 16384,
    });

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
  const defaultPattern =
    /^export\s+default\s+(?:function|class)\s+(\w+)/gm;

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

// ─── Phase-level verification ───

const MAX_PHASE_FIX_ATTEMPTS = 2;

async function phaseVerify(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  console.log("[Supervisor] Phase verify: installing dependencies...");

  const installResult = await shellExec(
    "npm install --prefer-offline 2>&1 | tail -10",
    state.outputDir,
    { timeout: 60_000 },
  );

  if (installResult.exitCode !== 0) {
    console.warn(
      `[Supervisor] Phase verify: npm install failed, continuing anyway.`,
    );
  } else {
    console.log("[Supervisor] Phase verify: npm install OK.");
  }

  console.log("[Supervisor] Phase verify: running tsc...");
  const tscResult = await shellExec(
    "npx tsc --noEmit --pretty false --skipLibCheck 2>&1 | head -60",
    state.outputDir,
    { timeout: 60_000 },
  );

  const output = (tscResult.stderr || tscResult.stdout || "").trim();
  const hasErrors = tscResult.exitCode !== 0 && output.includes("error TS");

  if (!hasErrors) {
    console.log("[Supervisor] Phase verify: tsc PASSED.");
    return { scaffoldErrors: "" };
  }

  const realErrors = output
    .split("\n")
    .filter((line) => {
      if (!line.includes("error TS")) return false;
      if (
        line.includes("Cannot find module") &&
        (line.includes("'./") || line.includes("'../"))
      ) {
        return false;
      }
      return true;
    })
    .join("\n");

  if (!realErrors) {
    console.log(
      "[Supervisor] Phase verify: only cross-ref errors (expected at this stage), PASSED.",
    );
    return { scaffoldErrors: "" };
  }

  console.log(
    `[Supervisor] Phase verify: tsc FAILED.\n${realErrors.slice(0, 300)}`,
  );

  return { scaffoldErrors: realErrors.slice(0, 3000) };
}

function shouldFixPhaseOrContinue(state: SupervisorState): string {
  if (!state.scaffoldErrors) return "continue";
  if (state.scaffoldFixAttempts >= MAX_PHASE_FIX_ATTEMPTS) {
    console.log(
      `[Supervisor] Phase fix: max attempts reached, proceeding with warnings.`,
    );
    return "continue";
  }
  return "phase_fix";
}

async function phaseFix(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  const attempt = state.scaffoldFixAttempts + 1;
  console.log(
    `[Supervisor] Phase fix attempt ${attempt}/${MAX_PHASE_FIX_ATTEMPTS}...`,
  );

  const errorFiles = extractBuildErrorFiles(state.scaffoldErrors);
  const fileContents: string[] = [];
  const alreadyRead = new Set<string>();

  for (const ef of errorFiles.slice(0, 6)) {
    if (alreadyRead.has(ef)) continue;
    alreadyRead.add(ef);
    const content = await fsRead(ef, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileContents.push(
        `### ${ef} (has errors)\n\`\`\`typescript\n${content.slice(0, 2000)}\n\`\`\``,
      );
    }
  }

  const importedModulePattern =
    /Module '"([^"]+)"' has no exported member/g;
  let im: RegExpExecArray | null;
  while ((im = importedModulePattern.exec(state.scaffoldErrors)) !== null) {
    const modulePath = im[1];
    const resolvedPath = modulePath
      .replace(/^@\//, "src/")
      .replace(/^~\//, "src/");
    const candidates = [
      resolvedPath + ".ts",
      resolvedPath + ".tsx",
      resolvedPath + "/index.ts",
    ];
    for (const candidate of candidates) {
      if (alreadyRead.has(candidate)) continue;
      const content = await fsRead(candidate, state.outputDir);
      if (!content.startsWith("FILE_NOT_FOUND")) {
        alreadyRead.add(candidate);
        fileContents.push(
          `### ${candidate} (imported module — check its actual exports)\n\`\`\`typescript\n${content.slice(0, 2000)}\n\`\`\``,
        );
        break;
      }
    }
  }

  const versionConstraints = await buildVersionConstraints(state.outputDir);

  const phaseFixChain = resolveModelChain(MODEL_CONFIG.codeFix ?? "gpt-4o", resolveModel);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a Senior Engineer. Fix the TypeScript errors below. " +
        "Output ONLY corrected files using ```file:<path> format. " +
        "Do not rewrite files that have no errors.",
    },
    {
      role: "user",
      content: [
        "## TypeScript Errors",
        "```",
        state.scaffoldErrors,
        "```",
        "",
        versionConstraints
          ? `## Installed package versions (use these APIs)\n${versionConstraints}`
          : "",
        "",
        fileContents.length > 0
          ? `## Current file contents\n${fileContents.join("\n\n")}`
          : "",
        "",
        "Fix all errors. Output corrected files only.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const response = await chatCompletionWithFallback(messages, phaseFixChain, {
    temperature: 0.2,
    max_tokens: 16384,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const costUsd = estimateCost(response.model, response.usage);
  const fixes = parseFileOutput(content);

  const phaseFixOpts = scaffoldWriteOpts(state, true);
  const fixedFiles: GeneratedFile[] = [];
  for (const [fp, fc] of Object.entries(fixes)) {
    await fsWrite(fp, fc, state.outputDir, phaseFixOpts);
    fixedFiles.push({
      path: fp,
      role: "architect",
      summary: `Phase fix attempt ${attempt}`,
    });
  }

  console.log(
    `[Supervisor] Phase fix: wrote ${fixedFiles.length} file(s) (model=${response.model}, cost: $${costUsd.toFixed(4)})`,
  );

  return {
    scaffoldFixAttempts: attempt,
    scaffoldErrors: "",
    fileRegistry: fixedFiles,
    totalCostUsd: costUsd,
  };
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
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0];
}

function isUnderAnyPrefix(file: string, prefixes: string[]): boolean {
  const norm = file.replace(/\\/g, "/");
  return prefixes.some(
    (root) => norm === root || norm.startsWith(`${root}/`),
  );
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

  return [...importedPkgs].filter((pkg) => !declared.has(pkg));
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

  return [...importedPkgs].filter((pkg) => !declared.has(pkg));
}

const VERIFY_IMPORT_INSTALL_TIMEOUT_MS = 120_000;

async function installImportGapsAllProjects(outputDir: string): Promise<void> {
  await runNpmInstallAllRoots(outputDir);

  const dirs = await findPackageJsonRelativeDirs(outputDir);
  const nested = dirs.filter((d) => d !== ".");

  const rootMissing = await collectMissingImportPackages(outputDir, nested);
  if (rootMissing.length > 0) {
    console.log(
      `[Supervisor] Integration verify: root npm install --save (${rootMissing.length}): ${rootMissing.join(", ")}`,
    );
    const r = await shellExec(
      `npm install --save ${rootMissing.join(" ")} 2>&1 | tail -15`,
      outputDir,
      { timeout: VERIFY_IMPORT_INSTALL_TIMEOUT_MS },
    );
    if (r.exitCode !== 0) {
      console.warn(
        `[Supervisor] Integration verify: root import-based install exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 300)}`,
      );
    }
  }

  for (const rel of nested) {
    const missing = await collectMissingImportPackagesForPrefix(outputDir, rel);
    if (missing.length === 0) continue;
    const cwd = path.join(outputDir, rel);
    console.log(
      `[Supervisor] Integration verify: "${rel}" npm install --save (${missing.length}): ${missing.join(", ")}`,
    );
    const r = await shellExec(
      `npm install --save ${missing.join(" ")} 2>&1 | tail -15`,
      cwd,
      { timeout: VERIFY_IMPORT_INSTALL_TIMEOUT_MS },
    );
    if (r.exitCode !== 0) {
      console.warn(
        `[Supervisor] Integration verify: "${rel}" import-based install exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 300)}`,
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

const MAX_INTEGRATION_FIX_ATTEMPTS = 3;

async function integrationVerify(state: SupervisorState) {
  if (state.integrationFixAttempts === 0) {
    console.log(
      "[Supervisor] Integration verify: first pass — npm install for all package roots, then import-gap installs (root + nested apps).",
    );
    await installImportGapsAllProjects(state.outputDir);
  }

  console.log("[Supervisor] Integration verify: running full project tsc check...");

  const allPaths = state.fileRegistry.map((f) => f.path);
  const tscProject = await findBestTsconfigForFiles(allPaths, state.outputDir);
  const tscCmd = tscProject
    ? `npx tsc --noEmit --pretty false --skipLibCheck --project ${tscProject} 2>&1`
    : `npx tsc --noEmit --pretty false --skipLibCheck 2>&1`;

  if (tscProject) {
    console.log(
      `[Supervisor] Integration verify: using --project ${tscProject}`,
    );
  }

  const runTsc = async (): Promise<{ output: string; exitCode: number }> => {
    const result = await shellExec(tscCmd, state.outputDir, {
      timeout: 60_000,
    });
    return {
      output: (result.stderr || result.stdout || "").trim(),
      exitCode: result.exitCode,
    };
  };

  let { output, exitCode } = await runTsc();

  if (exitCode === 0 || !output.includes("error TS")) {
    console.log("[Supervisor] Integration verify: PASSED (no errors)");
    return { integrationErrors: "" };
  }

  const classification = classifyTscErrors(output);

  if (classification.hasMissingDeps) {
    console.log(
      "[Supervisor] Integration verify: missing deps detected, installing...",
    );
    await installMissingDeps(output, state.outputDir, {
      scaffoldProtectedPaths: state.scaffoldProtectedPaths,
    });
    const retry = await runTsc();
    if (retry.exitCode === 0 || !retry.output.includes("error TS")) {
      console.log("[Supervisor] Integration verify: PASSED after dep install");
      return { integrationErrors: "" };
    }
    output = retry.output;
  }

  const errorLines = output
    .split("\n")
    .filter((l) => l.includes("error TS"));
  const errorCount = errorLines.length;
  const truncated = errorLines.slice(0, 80).join("\n");

  console.log(
    `[Supervisor] Integration verify: FAILED with ${errorCount} error(s) (fixAttempts=${state.integrationFixAttempts})`,
  );
  return {
    integrationErrors: truncated.slice(0, 4000),
  };
}

function shouldFixIntegrationOrSummarize(state: SupervisorState): string {
  if (!state.integrationErrors) return "summary";
  if (state.integrationFixAttempts >= MAX_INTEGRATION_FIX_ATTEMPTS) {
    console.log(
      `[Supervisor] Integration fix: max attempts (${MAX_INTEGRATION_FIX_ATTEMPTS}) reached, proceeding to summary.`,
    );
    return "summary";
  }
  return "integration_fix";
}

async function integrationFix(state: SupervisorState) {
  const attempt = state.integrationFixAttempts + 1;
  console.log(
    `[Supervisor] Integration fix: attempt ${attempt}/${MAX_INTEGRATION_FIX_ATTEMPTS}...`,
  );

  const errFiles = extractErrorFiles(state.integrationErrors);
  const fileContents: string[] = [];
  const addedPaths = new Set<string>();

  for (const ef of errFiles.slice(0, 8)) {
    const content = await fsRead(ef, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileContents.push(
        `### ${ef}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``,
      );
      addedPaths.add(ef);
    }
  }

  const allGeneratedPaths = state.fileRegistry.map((f) => f.path);
  const configFiles = await inferRelatedConfigFiles(
    state.integrationErrors,
    state.outputDir,
    allGeneratedPaths,
  );
  for (const cf of configFiles) {
    if (addedPaths.has(cf)) continue;
    const content = await fsRead(cf, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileContents.push(
        `### ${cf} (config)\n\`\`\`json\n${content.slice(0, 2000)}\n\`\`\``,
      );
      addedPaths.add(cf);
    }
  }

  const isConfigError = hasConfigErrors(state.integrationErrors);
  const configHint = isConfigError
    ? "**IMPORTANT**: Some errors are likely caused by tsconfig.json misconfiguration " +
      "(e.g. missing `\"jsx\": \"react-jsx\"` or wrong `compilerOptions`). " +
      "If the fix requires changing tsconfig.json or other config files, " +
      "output the corrected config file(s) as well.\n"
    : "";

  const integFixChain = resolveModelChain(MODEL_CONFIG.codeFix ?? "gpt-4o", resolveModel);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a Senior Full-Stack Developer fixing TypeScript compilation errors across an entire project.
Fix all errors so that "npx tsc --noEmit" passes cleanly.
Rules:
- Fix type errors, missing imports, incorrect interfaces, wrong JSX config, etc.
- If a config file (tsconfig.json, package.json) needs changes, output the corrected version.
- Prefer minimal changes that fix the errors without breaking other functionality.
- Output ONLY corrected files using \`\`\`file:<relative-path>\\n<contents>\\n\`\`\` format.`,
    },
    {
      role: "user",
      content: [
        `## TypeScript Errors (attempt ${attempt}/${MAX_INTEGRATION_FIX_ATTEMPTS})`,
        "```",
        state.integrationErrors,
        "```",
        "",
        configHint,
        fileContents.length > 0
          ? `## Current file contents\n${fileContents.join("\n\n")}`
          : "",
        "",
        "Fix all errors. Output ONLY the corrected files.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const response = await chatCompletionWithFallback(messages, integFixChain, {
    temperature: 0.2,
    max_tokens: 16384,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const costUsd = estimateCost(response.model, response.usage);
  const fixes = parseFileOutput(content);

  const integOpts = scaffoldWriteOpts(state, true);
  const fixedFiles: GeneratedFile[] = [];
  for (const [fp, fc] of Object.entries(fixes)) {
    await fsWrite(fp, fc, state.outputDir, integOpts);
    fixedFiles.push({
      path: fp,
      role: "architect",
      summary: `Integration fix attempt ${attempt}`,
    });
  }

  console.log(
    `[Supervisor] Integration fix: wrote ${fixedFiles.length} file(s) (model=${response.model}, cost: $${costUsd.toFixed(4)})`,
  );

  return {
    integrationFixAttempts: attempt,
    integrationErrors: "",
    fileRegistry: fixedFiles,
    totalCostUsd: costUsd,
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
    .addNode("generate_api_contracts", generateApiContracts)
    .addNode("generate_service_skeletons", generateServiceSkeletons)
    .addNode("be_worker", parallelWorkerNode)
    .addNode("be_phase_verify", phaseVerify)
    .addNode("be_phase_fix", phaseFix)
    .addNode("extract_real_contracts", extractRealContracts)
    .addNode("fe_dispatch_gate", feDispatchGate)
    .addNode("fe_worker", parallelWorkerNode)
    .addNode("fe_phase_verify", phaseVerify)
    .addNode("fe_phase_fix", phaseFix)
    .addNode("sync_deps", syncDeps)
    .addNode("integration_verify", integrationVerify)
    .addNode("integration_fix", integrationFix)
    .addNode("summary", summary)

    .addEdge(START, "classify_tasks")
    .addEdge("classify_tasks", "architect_phase")
    .addEdge("architect_phase", "scaffold_verify")
    .addConditionalEdges("scaffold_verify", shouldFixScaffoldOrContinue, {
      dispatch: "dispatch_gate",
      scaffold_fix: "scaffold_fix",
    })
    .addEdge("scaffold_fix", "scaffold_verify")
    .addEdge("dispatch_gate", "generate_api_contracts")
    .addEdge("generate_api_contracts", "generate_service_skeletons")
    .addConditionalEdges(
      "generate_service_skeletons",
      dispatchBackendAndTestWorkers,
    )
    .addEdge("be_worker", "be_phase_verify")
    .addConditionalEdges("be_phase_verify", shouldFixPhaseOrContinue, {
      continue: "extract_real_contracts",
      phase_fix: "be_phase_fix",
    })
    .addEdge("be_phase_fix", "be_phase_verify")
    .addEdge("extract_real_contracts", "fe_dispatch_gate")
    .addConditionalEdges("fe_dispatch_gate", dispatchFrontendWorkers)
    .addEdge("fe_worker", "fe_phase_verify")
    .addConditionalEdges("fe_phase_verify", shouldFixPhaseOrContinue, {
      continue: "sync_deps",
      phase_fix: "fe_phase_fix",
    })
    .addEdge("fe_phase_fix", "fe_phase_verify")
    .addEdge("sync_deps", "integration_verify")
    .addConditionalEdges(
      "integration_verify",
      shouldFixIntegrationOrSummarize,
      {
        summary: "summary",
        integration_fix: "integration_fix",
      },
    )
    .addEdge("integration_fix", "integration_verify")
    .addEdge("summary", END);

  return graph.compile();
}
