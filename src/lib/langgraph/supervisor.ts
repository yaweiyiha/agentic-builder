import path from "path";
import fs from "fs/promises";
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
  type OpenRouterOptions,
  type OpenRouterToolDefinition,
} from "@/lib/openrouter";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import type {
  CodingAgentRole,
  CodingTask,
  KickoffWorkItem,
} from "@/lib/pipeline/types";
import { stripTestingPhaseTasks } from "@/lib/pipeline/strip-testing-tasks";
import { triagePrebuiltArchitectTasks } from "./architect-triage";
import { getRepairEmitter } from "@/lib/pipeline/self-heal";
import { recordCodingSessionLlmUsage } from "@/lib/pipeline/coding-session-report";
import { pickRelevantSections } from "./doc-section-picker";
import {
  triageE2eFailures,
  hasInfraSignal,
  type FailedTestRecord,
} from "./e2e-triage";

const execFileAsync = promisify(execFile);

function getOpenRouterUsageCounts(usage: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const raw = usage as
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      }
    | undefined;
  const promptTokens = raw?.prompt_tokens ?? raw?.promptTokens ?? 0;
  const completionTokens = raw?.completion_tokens ?? raw?.completionTokens ?? 0;
  const totalTokens =
    raw?.total_tokens ?? raw?.totalTokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function recordSupervisorLlmUsage(args: {
  sessionId: string;
  stage: string;
  label?: string;
  model: string;
  usage: unknown;
  costUsd: number;
}): void {
  const usageCounts = getOpenRouterUsageCounts(args.usage);
  recordCodingSessionLlmUsage({
    sessionId: args.sessionId,
    stage: args.stage,
    label: args.label,
    model: args.model,
    costUsd: args.costUsd,
    promptTokens: usageCounts.promptTokens,
    completionTokens: usageCounts.completionTokens,
    totalTokens: usageCounts.totalTokens,
  });
}

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

function isToolSequenceValidationError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("messages with role 'tool'") && m.includes("tool_calls");
}

function countRemovedOrphanToolMessages(messages: ChatMessage[]): number {
  let removed = 0;
  const cleaned: ChatMessage[] = [];
  let pendingToolCallIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "assistant" && (msg.tool_calls?.length ?? 0) > 0) {
      pendingToolCallIds = new Set(
        (msg.tool_calls ?? []).map((tc) => tc.id).filter(Boolean),
      );
      cleaned.push(msg);
      continue;
    }

    if (msg.role === "tool") {
      const toolCallId = msg.tool_call_id ?? "";
      if (toolCallId && pendingToolCallIds.has(toolCallId)) {
        cleaned.push(msg);
        pendingToolCallIds.delete(toolCallId);
      } else {
        removed++;
      }
      continue;
    }

    pendingToolCallIds = new Set<string>();
    cleaned.push(msg);
  }

  messages.splice(0, messages.length, ...cleaned);
  return removed;
}

function calculateSafeTailStart(
  messages: ChatMessage[],
  desiredStart: number,
): number {
  let safeStart = desiredStart;

  const findAssistantIndexForTool = (
    toolIdx: number,
    toolCallId: string,
  ): number => {
    if (!toolCallId) return -1;
    for (let i = toolIdx - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.role !== "assistant") continue;
      const hasMatch = (msg.tool_calls ?? []).some(
        (tc) => tc.id === toolCallId,
      );
      if (hasMatch) return i;
    }
    return -1;
  };

  for (let i = desiredStart; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "tool") continue;
    const assistantIdx = findAssistantIndexForTool(i, msg.tool_call_id ?? "");
    if (assistantIdx >= 0) {
      safeStart = Math.min(safeStart, assistantIdx);
    }
  }

  return Math.max(1, Math.min(safeStart, messages.length - 1));
}

async function callWithOrphanToolRetry(
  label: string,
  messages: ChatMessage[],
  modelChain: string[],
  options: Omit<OpenRouterOptions, "model">,
) {
  try {
    return await chatCompletionWithFallback(messages, modelChain, options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isToolSequenceValidationError(msg)) {
      throw e;
    }
    const removed = countRemovedOrphanToolMessages(messages);
    console.warn(
      `${label}: detected tool-call sequence error; cleaned ${removed} orphan tool message(s) and retrying once.`,
    );
    if (removed <= 0) {
      throw e;
    }
    return chatCompletionWithFallback(messages, modelChain, options);
  }
}

function formatTaskBreakdownMarkdown(
  title: string,
  tasks: CodingTask[],
  roleBuckets?: Record<CodingAgentRole, CodingTask[]>,
  notes?: string[],
): string {
  const lines: string[] = [
    `# ${title}`,
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Total tasks: ${tasks.length}`,
  ];

  if (roleBuckets) {
    lines.push(
      `- Role buckets: architect=${roleBuckets.architect.length}, backend=${roleBuckets.backend.length}, frontend=${roleBuckets.frontend.length}, test=${roleBuckets.test.length}`,
    );
  }

  if (notes && notes.length > 0) {
    lines.push(...notes.map((n) => `- Note: ${n}`));
  }

  lines.push("", "## Tasks", "");

  for (const task of tasks) {
    lines.push(`### [${task.id}] ${task.title}`);
    lines.push(
      `- Phase: ${task.phase} | Priority: ${task.priority} | Execution: ${task.executionKind}`,
    );
    lines.push(`- Estimated hours: ${task.estimatedHours}`);
    lines.push(`- Description: ${task.description}`);

    const files = task.files;
    const creates = files && !Array.isArray(files) ? (files.creates ?? []) : [];
    const modifies =
      files && !Array.isArray(files) ? (files.modifies ?? []) : [];
    const reads = files && !Array.isArray(files) ? (files.reads ?? []) : [];
    lines.push(
      `- Files (create/modify/read): ${creates.length}/${modifies.length}/${reads.length}`,
    );

    if (creates.length > 0) {
      lines.push("  - Creates:");
      lines.push(...creates.map((f: string) => `    - \`${f}\``));
    }
    if (modifies.length > 0) {
      lines.push("  - Modifies:");
      lines.push(...modifies.map((f: string) => `    - \`${f}\``));
    }
    if (reads.length > 0) {
      lines.push("  - Reads:");
      lines.push(...reads.map((f: string) => `    - \`${f}\``));
    }

    const dependencies = task.dependencies ?? [];
    if (dependencies.length > 0) {
      lines.push(`- Dependencies: ${dependencies.join(", ")}`);
    } else {
      lines.push("- Dependencies: (none)");
    }

    const subSteps = task.subSteps ?? [];
    if (subSteps.length > 0) {
      lines.push("- Sub-steps:");
      for (const step of subSteps) {
        lines.push(`  - ${step.step}. ${step.action}: ${step.detail}`);
      }
    }

    const acceptanceCriteria = task.acceptanceCriteria ?? [];
    if (acceptanceCriteria.length > 0) {
      lines.push("- Acceptance criteria:");
      lines.push(...acceptanceCriteria.map((ac: string) => `  - ${ac}`));
    }

    const coversRequirementIds = task.coversRequirementIds ?? [];
    if (coversRequirementIds.length > 0) {
      lines.push(`- Covers requirements: ${coversRequirementIds.join(", ")}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function writeTaskBreakdownMarkdown(
  outputDir: string,
  fileName: string,
  content: string,
): Promise<void> {
  try {
    await fsWrite(fileName, content, outputDir);
    console.log(`[Supervisor] wrote ${fileName}`);
  } catch (e) {
    console.warn(
      `[Supervisor] failed to write ${fileName}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ─── Nodes ───

async function classifyTasks(state: SupervisorState) {
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

  const originalTaskDoc = formatTaskBreakdownMarkdown(
    "Task Breakdown (Original)",
    tasks,
    byRole,
  );
  await writeTaskBreakdownMarkdown(
    state.outputDir,
    "TASK_BREAKDOWN_ORIGINAL.md",
    originalTaskDoc,
  );

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
    // P0-A: prebuiltScaffold no longer implies "skip every architect task".
    // Triage each task: scaffold-only tasks can legitimately no-op, but any
    // task touching files outside the scaffold (migrations, domain models,
    // infra glue, etc.) must still run through the LLM — otherwise PRD
    // requirements routed to Data Layer / Infrastructure silently vanish.
    const triaged = triagePrebuiltArchitectTasks(
      state.architectTasks,
      state.scaffoldProtectedPaths ?? [],
    );
    const noopTasks = triaged.filter((t) => t.decision === "noop");
    const mustRunTasks = triaged.filter((t) => t.decision === "must_run_llm");

    console.log(
      `[Supervisor] Architect phase: prebuiltScaffold=true — triaged ${state.architectTasks.length} task(s): ${noopTasks.length} scaffold-only (no-op), ${mustRunTasks.length} must run LLM.`,
    );

    const emitter = getRepairEmitter(state.sessionId);
    for (const t of mustRunTasks) {
      emitter({
        stage: "architect-triage",
        event: "task_forced_to_llm",
        taskId: t.task.id,
        files: t.outsideFiles,
        details: { reason: t.reason, title: t.task.title, phase: t.task.phase },
      });
    }
    for (const t of noopTasks) {
      emitter({
        stage: "architect-triage",
        event: "task_noop_scaffold_only",
        taskId: t.task.id,
        details: { reason: t.reason, title: t.task.title, phase: t.task.phase },
      });
    }

    // Always build the scaffold doc + registry; both branches rely on it.
    const registry = await buildPrebuiltScaffoldRegistryAndDoc(state.outputDir);

    const noopResults: TaskResult[] = noopTasks.map(({ task, reason }) => ({
      taskId: task.id,
      status: "completed",
      generatedFiles: [],
      costUsd: 0,
      durationMs: 0,
      verifyPassed: true,
      fixCycles: 0,
      warnings: [
        `Completed via prebuilt tier scaffold (no LLM). ${reason} See ARCHITECTURE_SCAFFOLD.md.`,
      ],
    }));

    if (mustRunTasks.length === 0) {
      const phaseResult: PhaseResult = {
        role: "architect",
        workerLabel: "Architect",
        taskResults: noopResults,
        totalCostUsd: 0,
      };
      return {
        phaseResults: [phaseResult],
        fileRegistry: registry,
        totalCostUsd: 0,
      };
    }

    console.log(
      `[Supervisor] Architect phase: running LLM for ${mustRunTasks.length} non-scaffold task(s)...`,
    );
    const result = await workerGraph.invoke(
      {
        role: "architect" as CodingAgentRole,
        workerLabel: "Architect",
        tasks: mustRunTasks.map((t) => t.task),
        outputDir: state.outputDir,
        projectContext: state.projectContext,
        fileRegistrySnapshot: registry,
        apiContractsSnapshot: state.apiContracts,
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
        currentTaskIndex: 0,
        ralphConfig: state.ralphConfig,
        sessionId: state.sessionId,
      },
      { recursionLimit: 150 },
    );

    const workerState = result as WorkerState;
    const combinedTaskResults = [...noopResults, ...workerState.taskResults];
    const phaseResult: PhaseResult = {
      role: "architect",
      workerLabel: "Architect",
      taskResults: combinedTaskResults,
      totalCostUsd: workerState.workerCostUsd,
    };
    return {
      phaseResults: [phaseResult],
      fileRegistry: [...registry, ...workerState.generatedFiles],
      totalCostUsd: workerState.workerCostUsd,
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
      sessionId: state.sessionId,
      prdSpec: state.prdSpec,
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

type PackageManager = "pnpm" | "yarn" | "npm";

async function readDeclaredPackageManager(
  relDir: string,
  outputDir: string,
): Promise<PackageManager | null> {
  const relPkg = relDir === "." ? "package.json" : `${relDir}/package.json`;
  const raw = await fsRead(relPkg, outputDir);
  if (raw.startsWith("FILE_NOT_FOUND") || raw.startsWith("REJECTED")) {
    return null;
  }
  try {
    const pkg = JSON.parse(raw) as { packageManager?: string };
    const pm = (pkg.packageManager ?? "").toLowerCase();
    if (pm.startsWith("pnpm@")) return "pnpm";
    if (pm.startsWith("yarn@")) return "yarn";
    if (pm.startsWith("npm@")) return "npm";
  } catch {
    // ignore malformed package.json
  }
  return null;
}

async function inferRepoPackageManager(
  outputDir: string,
): Promise<PackageManager | null> {
  const dirs = await findPackageJsonRelativeDirs(outputDir);
  const declared = new Set<PackageManager>();
  for (const rel of dirs) {
    const pm = await readDeclaredPackageManager(rel, outputDir);
    if (pm) declared.add(pm);
  }
  return declared.size === 1 ? [...declared][0] : null;
}

async function resolvePackageManagerForDir(
  relDir: string,
  outputDir: string,
  repoFallback: PackageManager | null,
): Promise<PackageManager> {
  const declared = await readDeclaredPackageManager(relDir, outputDir);
  if (declared) return declared;
  const cwd = relDir === "." ? outputDir : path.join(outputDir, relDir);
  const detected = await detectPackageManager(cwd);
  if (detected !== "npm") return detected;
  return repoFallback ?? detected;
}

/** Run install at repo root (workspaces) or at each package root (no workspaces). */
async function runNpmInstallAllRoots(outputDir: string): Promise<void> {
  const pm = await detectPackageManager(outputDir);
  const repoFallbackPm = await inferRepoPackageManager(outputDir);

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
    const relPm = await resolvePackageManagerForDir(
      rel,
      outputDir,
      repoFallbackPm,
    );
    console.log(
      `[Supervisor] Integration verify: ${relPm} install in "${rel === "." ? "." : rel}"`,
    );
    const r = await shellExec(buildInstallCommand(relPm), cwd, {
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
  const hasSharedPackage =
    /packages\/shared|@project\/shared|workspace:\*/.test(text);

  // Baseline monorepo internal linkage when a shared package actually exists.
  if (hasSharedPackage) {
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
  }

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
  // Prisma is intentionally NOT suggested. This generator standardises on
  // Sequelize for M-tier SQL workloads to avoid Prisma's binary footprint and
  // migration-runner complexity in generated projects. If "prisma" appears in
  // the task text (e.g. PRD copy-paste), we redirect to Sequelize instead.
  if (/prisma|sequelize/.test(text)) {
    api.push({
      pkg: "sequelize",
      reason: "SQL ORM for Node.js (Sequelize is the standard for this tier).",
    });
    api.push({
      pkg: "sequelize-cli",
      reason: "Sequelize migrations / model scaffolding CLI.",
    });
  }
  if (/sqlite|better.sqlite/.test(text)) {
    api.push({
      pkg: "better-sqlite3",
      reason: "SQLite embedded database driver.",
    });
  }
  if (/postgres|postgresql/.test(text)) {
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
    { key: "web", relPath: "frontend/package.json" },
    { key: "api", relPath: "backend/package.json" },
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
- For M-tier split projects: frontend is Vite + React in frontend/, backend is Koa + TypeScript in backend/. NEVER introduce Next.js.
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
    max_tokens: 65536,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const costUsd = estimateCost(response.model, response.usage);
  recordSupervisorLlmUsage({
    sessionId: state.sessionId,
    stage: "scaffold_fix",
    model: response.model,
    usage: response.usage,
    costUsd,
  });
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
  const hasSplitMTierFrontend = !(
    await fsRead("frontend/package.json", outputDir)
  ).startsWith("FILE_NOT_FOUND");

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
        rel.startsWith("frontend/src/") ||
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
      (rel.startsWith("frontend/src/") || rel.startsWith("apps/web/src/")) &&
      /\.(tsx|jsx)$/.test(rel);
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

    if (isMTier && hasSplitMTierFrontend) {
      const isForbiddenAppDirFile =
        rel.startsWith("frontend/app/") || rel.startsWith("frontend/src/app/");
      if (isForbiddenAppDirFile) {
        violations.push(
          `[CONVENTION] ${rel}: Split M-tier keeps frontend routes in "frontend/src/router.tsx" and page-level screens under "frontend/src/views" (or nearby React source), not under "frontend/app" or "frontend/src/app".`,
        );
        touchedFiles.add(rel);
      }
      const isForbiddenPagesDir = rel.startsWith("frontend/src/pages/");
      if (isForbiddenPagesDir) {
        violations.push(
          `[CONVENTION] ${rel}: M-tier uses "frontend/src/views" for page-level screens, NOT "frontend/src/pages" (that is a Next.js convention). Move this file to "frontend/src/views/${rel.split("/").pop() ?? rel}".`,
        );
        touchedFiles.add(rel);
      }
    }
  }

  if (isMTier && hasSplitMTierFrontend) {
    const routerPath = "frontend/src/router.tsx";
    const routerContent = await fsRead(routerPath, outputDir);
    const routerExists =
      !routerContent.startsWith("FILE_NOT_FOUND") &&
      !routerContent.startsWith("REJECTED");

    if (!routerExists) {
      violations.push(
        `[CONVENTION] ${routerPath}: Split M-tier frontend must keep a dedicated React Router registry in frontend/src/router.tsx.`,
      );
      touchedFiles.add(routerPath);
    } else {
      const hasRouterRegistry =
        /\bBrowserRouter\b/.test(routerContent) ||
        /\bRoutes\b/.test(routerContent) ||
        /\bRouterProvider\b/.test(routerContent);
      if (!hasRouterRegistry) {
        violations.push(
          `[CONVENTION] ${routerPath}: Route registry must define React Router wiring (BrowserRouter, Routes/Route, or RouterProvider).`,
        );
        touchedFiles.add(routerPath);
      }
    }

    const viewFiles = sourceFiles.filter(
      (f) => f.startsWith("frontend/src/views/") && /\.tsx?$/.test(f),
    );
    if (viewFiles.length > 0 && routerExists) {
      const hasViewImport = /from\s+["'](?:\.\/views\/|\.{2}\/views\/)/.test(
        routerContent,
      );
      if (!hasViewImport) {
        violations.push(
          `[CONVENTION] ${routerPath}: Views exist under frontend/src/views but the route registry does not import them. Register those screens explicitly.`,
        );
        touchedFiles.add(routerPath);
      }
    }

    const homeEntryCandidates = [
      "frontend/src/router.tsx",
      "frontend/src/App.tsx",
      "frontend/src/views/Home.tsx",
      "frontend/src/views/LandingPage.tsx",
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
        `[CONVENTION] ${routerPath}: Home/landing entry must provide visible route entry points (Link/NavLink or button using useNavigate) so users can navigate to primary pages.`,
      );
      touchedFiles.add(routerPath);
    }
  } else if (isMTier) {
    const appEntryPath = "apps/web/src/App.tsx";
    const appEntryContent = await fsRead(appEntryPath, outputDir);
    const appExists =
      !appEntryContent.startsWith("FILE_NOT_FOUND") &&
      !appEntryContent.startsWith("REJECTED");

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
  }

  return {
    errorsText: violations.join("\n"),
    files: [...touchedFiles],
  };
}

const MAX_E2E_VERIFY_FIX_ATTEMPTS = 10;

/**
 * When `true` (the default) a failed e2e run is re-executed once before any
 * LLM fix attempt. The two runs are compared to classify every failing
 * test as deterministic / flaky / infra, and only deterministic failures
 * are sent to auto-repair. Set env `E2E_TRIAGE_ENABLED=0` to revert to the
 * legacy "feed everything to the LLM" behaviour.
 */
const E2E_TRIAGE_ENABLED = (() => {
  const raw = (process.env.E2E_TRIAGE_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
})();

function parseFileBlocksFromContent(
  raw: string,
): { filePath: string; fileContent: string }[] {
  const files: { filePath: string; fileContent: string }[] = [];
  const regex = /```file:([^\n]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const filePath = match[1]?.trim();
    const fileContent = match[2] ?? "";
    if (filePath && fileContent) {
      files.push({ filePath, fileContent });
    }
  }
  return files;
}

function summarizeE2eTaskContext(tasks: CodingTask[]): string {
  if (tasks.length === 0) return "No explicit test tasks were generated.";
  return tasks
    .slice(0, 20)
    .map((t) => `- [${t.id}] ${t.title}: ${t.description}`)
    .join("\n");
}

async function detectE2eCommand(
  outputDir: string,
): Promise<{ command: string; cwd: string; label: string } | null> {
  const frontendPkgRaw = await fsRead("frontend/package.json", outputDir);
  if (
    frontendPkgRaw.startsWith("FILE_NOT_FOUND") ||
    frontendPkgRaw.startsWith("REJECTED")
  ) {
    return null;
  }
  let scripts: Record<string, string> = {};
  try {
    scripts =
      (JSON.parse(frontendPkgRaw) as { scripts?: Record<string, string> })
        .scripts ?? {};
  } catch {
    scripts = {};
  }

  const frontendDir = path.join(outputDir, "frontend");
  const pm = await detectPackageManager(frontendDir);
  if (scripts.e2e) {
    const command =
      pm === "pnpm"
        ? "pnpm run e2e 2>&1"
        : pm === "yarn"
          ? "yarn run e2e 2>&1"
          : "npm run e2e 2>&1";
    return { command, cwd: frontendDir, label: "frontend:e2e-script" };
  }

  const hasPlaywrightConfig = !(
    await fsRead("frontend/playwright.config.ts", outputDir)
  ).startsWith("FILE_NOT_FOUND");
  if (hasPlaywrightConfig) {
    return {
      command: "npx playwright test 2>&1",
      cwd: frontendDir,
      label: "frontend:playwright",
    };
  }
  return null;
}

async function e2eVerifyAndFix(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  const attempt = state.e2eVerifyAttempts + 1;
  console.log(
    `[Supervisor] e2eVerify: attempt ${attempt}/${MAX_E2E_VERIFY_FIX_ATTEMPTS + 1}...`,
  );

  const e2eSpecDoc = await fsRead("PRD_E2E_SPEC.md", state.outputDir);
  const e2eCoverageDoc = await fsRead("E2E_COVERAGE.md", state.outputDir);
  const hasE2eSpecDoc =
    !e2eSpecDoc.startsWith("FILE_NOT_FOUND") &&
    !e2eSpecDoc.startsWith("REJECTED");
  const hasE2eCoverageDoc =
    !e2eCoverageDoc.startsWith("FILE_NOT_FOUND") &&
    !e2eCoverageDoc.startsWith("REJECTED");

  const plan = await detectE2eCommand(state.outputDir);
  if (!plan) {
    return {
      e2eVerifyAttempts: attempt,
      e2eVerifyErrors: hasE2eSpecDoc
        ? "No executable E2E command found. PRD_E2E_SPEC.md exists, but the project is still missing a runnable frontend e2e script or Playwright config."
        : "No executable E2E command found. Expected frontend package script `e2e` or playwright config.",
    };
  }

  // On the very first attempt: if only the scaffold smoke test exists and
  // PRD_E2E_SPEC.md is present, generate PRD-based test scripts before running.
  if (attempt === 1 && hasE2eSpecDoc) {
    const existingTestFiles = (
      await listFiles("frontend", state.outputDir)
    ).filter((f) => /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(f));
    const onlySmoke =
      existingTestFiles.length === 0 ||
      existingTestFiles.every((f) => /smoke\.spec\.(ts|tsx|js|jsx)$/.test(f));

    if (onlySmoke) {
      console.log(
        "[Supervisor] e2eVerify: no PRD-based test scripts found — generating from PRD_E2E_SPEC.md...",
      );
      try {
        const genModelChain = resolveModelChain(
          MODEL_CONFIG.e2eGen ?? MODEL_CONFIG.codeFix ?? "gpt-4o",
          resolveModel,
        );
        const genMessages: ChatMessage[] = [
          {
            role: "system",
            content: [
              "You are an expert Playwright E2E test author.",
              "Generate complete Playwright TypeScript test files that cover every scenario in the PRD E2E spec.",
              "",
              "## Structure requirements",
              "- One spec file per PRD section/route group (e.g. frontend/e2e/auth.spec.ts, frontend/e2e/dashboard.spec.ts).",
              "- Use `test.describe` blocks matching section headings.",
              "- Each `test()` maps 1-to-1 with a PRD E2E step sequence.",
              "- Use `page.goto()`, `page.locator()`, `page.fill()`, `page.click()`, `expect()` from @playwright/test.",
              "- Do NOT import anything outside @playwright/test.",
              "- Output ONLY the file blocks using ```file:frontend/e2e/<name>.spec.ts``` syntax.",
              "- The base URL is http://localhost:5173 (already configured in playwright.config.ts).",
              "- Do not re-generate smoke.spec.ts.",
              "",
              "## Playwright locator best practices (CRITICAL — violations cause strict mode errors)",
              "- NEVER use `page.getByRole('heading')` or any role-based locator without a unique qualifier.",
              "  Always add `{ level: N }` or `{ name: 'exact text' }` so only ONE element matches.",
              "  Example: `page.getByRole('heading', { level: 1 })` or `page.getByRole('heading', { name: 'Welcome' })`.",
              "- NEVER use `page.getByRole('button')` alone — always add `{ name: '...' }`.",
              "- NEVER use `page.getByText('...')` without `.first()` when the text may appear more than once.",
              "- NEVER use `page.locator('text=...')` in `expect(...).toBeVisible()` without `.first()` unless the selector is guaranteed unique.",
              "- Prefer `page.getByRole(...)` with unique qualifiers > `page.getByTestId(...)` > `page.locator('text=...')` > CSS selectors.",
              "- When using `page.locator(css)` that could match multiple elements, always append `.first()` or `.nth(N)` before assertions.",
              "- Text in selectors must match the EXACT case rendered in the DOM.",
              "  If the UI shows 'SIGN UP' (uppercase), use `page.getByRole('link', { name: 'SIGN UP' })` — not 'Sign Up'.",
              "- Avoid deprecated `page.click('text=...')` — use `page.locator('text=...').click()` or `page.getByRole(...).click()`.",
              "- For form inputs always prefer `page.getByLabel('...')` or `page.getByPlaceholder('...')`.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Project output dir: ${state.outputDir}`,
              "",
              "## PRD E2E Specification",
              e2eSpecDoc.slice(0, 12000),
              "",
              state.projectContext
                ? `## Project context\n${state.projectContext.slice(0, 4000)}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ];
        const genResponse = await chatCompletionWithFallback(
          genMessages,
          genModelChain,
          {
            temperature: 0.1,
            max_tokens: 16000,
          },
        );
        const genContent = genResponse.choices[0]?.message?.content ?? "";
        recordSupervisorLlmUsage({
          sessionId: state.sessionId,
          stage: "e2e_generate_tests",
          model: genResponse.model,
          usage: genResponse.usage,
          costUsd: estimateCost(genResponse.model, genResponse.usage),
        });
        const genFileBlocks = parseFileBlocksFromContent(genContent);
        if (genFileBlocks.length > 0) {
          for (const file of genFileBlocks) {
            await fsWrite(file.filePath, file.fileContent, state.outputDir, {
              scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
            });
          }
          console.log(
            `[Supervisor] e2eVerify: generated ${genFileBlocks.length} PRD-based test file(s): ${genFileBlocks.map((f) => f.filePath).join(", ")}`,
          );
        } else {
          console.warn(
            "[Supervisor] e2eVerify: LLM returned no test file blocks during generation.",
          );
        }
      } catch (genErr) {
        console.warn(
          `[Supervisor] e2eVerify: test generation failed: ${genErr instanceof Error ? genErr.message : String(genErr)}`,
        );
      }
    }
  }

  const runResult = await shellExec(plan.command, plan.cwd, {
    timeout: 180_000,
  });
  const output = `${runResult.stdout}${runResult.stderr}`.trim();
  if (runResult.exitCode === 0) {
    return {
      e2eVerifyAttempts: attempt,
      e2eVerifyErrors: "",
    };
  }

  const failureSummary = output.slice(-12_000);
  console.log(
    `[Supervisor] e2eVerify: command="${plan.command}" cwd="${plan.cwd}" exitCode=${runResult.exitCode}`,
  );
  console.log(
    `[Supervisor] e2eVerify: output (last 800 chars):\n${output.slice(-800)}`,
  );
  if (attempt > MAX_E2E_VERIFY_FIX_ATTEMPTS) {
    console.warn("[Supervisor] e2eVerify: max attempts reached.");
    return {
      e2eVerifyAttempts: attempt,
      e2eVerifyErrors: failureSummary,
    };
  }

  // ── Triage before auto-repair ────────────────────────────────────────────
  // 1. Re-run the same command once, under the same conditions, so the
  //    triage classifier can tell a real deterministic bug apart from a
  //    flake (timing / mock race) or an infrastructure problem (port
  //    clash, backend not up, DNS error).
  // 2. Feed only the deterministic failures to the LLM. For flaky / infra
  //    cases we write a report and exit the loop — rewriting code on a
  //    flake or infra error is how we corrupt previously-correct files.
  const emitter = getRepairEmitter(state.sessionId);
  let deterministicTestNames: Set<string> | null = null;
  let triageSummaryText = "";

  if (E2E_TRIAGE_ENABLED) {
    // Short-circuit for obvious infra — don't even pay the second run.
    if (hasInfraSignal(output)) {
      console.warn(
        "[Supervisor] e2eVerify: infra signal detected in first run (ECONNREFUSED / EADDRINUSE / etc.) — skipping auto-repair.",
      );
      const triage = triageE2eFailures({
        firstRunOutput: output,
        firstRunExitCode: runResult.exitCode,
      });
      await writeTriageReport(state.outputDir, attempt, triage.report);
      emitter({
        stage: "e2e-triage",
        event: "infra_detected",
        details: {
          attempt,
          summary: triage.summary,
          infraCount: triage.infra.length,
        },
      });
      return {
        // Bump past the limit so routeAfterE2eVerify exits the loop.
        e2eVerifyAttempts: MAX_E2E_VERIFY_FIX_ATTEMPTS + 1,
        e2eVerifyErrors: [
          "E2E failed with infrastructure signal — not a code bug.",
          triage.summary,
          "See .ralph/e2e-triage.md for the full report.",
          "",
          failureSummary.slice(-2000),
        ].join("\n\n"),
      };
    }

    console.log(
      "[Supervisor] e2eVerify: first run failed — executing retry pass for flake detection...",
    );
    const retryResult = await shellExec(plan.command, plan.cwd, {
      timeout: 180_000,
    });
    const retryOutput = `${retryResult.stdout}${retryResult.stderr}`.trim();

    const triage = triageE2eFailures({
      firstRunOutput: output,
      firstRunExitCode: runResult.exitCode,
      secondRunOutput: retryOutput,
      secondRunExitCode: retryResult.exitCode,
    });
    triageSummaryText = triage.summary;
    await writeTriageReport(state.outputDir, attempt, triage.report);

    console.log(`[Supervisor] e2eVerify: ${triage.summary}`);

    emitter({
      stage: "e2e-triage",
      event: "triage_complete",
      details: {
        attempt,
        deterministic: triage.deterministic.length,
        flaky: triage.flaky.length,
        infra: triage.infra.length,
        selfHealed: triage.selfHealed.length,
        retryExitCode: retryResult.exitCode,
      },
    });

    // Retry passed cleanly → treat as success; the original failure was a flake.
    if (retryResult.exitCode === 0 && triage.deterministic.length === 0) {
      console.log(
        "[Supervisor] e2eVerify: retry run passed — original failure was a flake, no auto-repair needed.",
      );
      emitter({
        stage: "e2e-triage",
        event: "flake_self_healed",
        details: { attempt, selfHealed: triage.selfHealed.length },
      });
      return {
        e2eVerifyAttempts: attempt,
        e2eVerifyErrors: "",
      };
    }

    // Retry still fails but none of the failures are deterministic (all
    // flake / infra) — auto-repair would chase noise. Exit the loop.
    if (triage.deterministic.length === 0) {
      console.warn(
        `[Supervisor] e2eVerify: retry still failed but no deterministic failures (${triage.summary}) — skipping auto-repair.`,
      );
      emitter({
        stage: "e2e-triage",
        event: "no_deterministic_failures",
        details: {
          attempt,
          flaky: triage.flaky.length,
          infra: triage.infra.length,
          selfHealed: triage.selfHealed.length,
        },
      });
      return {
        e2eVerifyAttempts: MAX_E2E_VERIFY_FIX_ATTEMPTS + 1,
        e2eVerifyErrors: [
          "E2E has failures but none are deterministic — auto-repair skipped.",
          triage.summary,
          "See .ralph/e2e-triage.md for the full report.",
          "",
          failureSummary.slice(-2000),
        ].join("\n\n"),
      };
    }

    deterministicTestNames = new Set(triage.deterministic.map((r) => r.name));
    emitter({
      stage: "e2e-triage",
      event: "repair_dispatch",
      details: {
        attempt,
        deterministicCount: triage.deterministic.length,
        skippedFlaky: triage.flaky.length,
        skippedInfra: triage.infra.length,
      },
    });
  }

  const e2eModelChain = resolveModelChain(
    MODEL_CONFIG.e2eGen ?? MODEL_CONFIG.codeFix ?? "gpt-4o",
    resolveModel,
  );
  const testTaskContext = summarizeE2eTaskContext(state.testTasks);
  const testFiles = (await listFiles("frontend", state.outputDir))
    .filter((f) => /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(f))
    .slice(0, 6);
  const testFileContents: string[] = [];
  for (const tf of testFiles) {
    const c = await fsRead(tf, state.outputDir);
    if (!c.startsWith("FILE_NOT_FOUND") && !c.startsWith("REJECTED")) {
      testFileContents.push(`### ${tf}\n\`\`\`\n${c.slice(0, 2500)}\n\`\`\``);
    }
  }

  // Read per-test error-context.md files from test-results — these contain
  // the page snapshot, exact failing line, and DOM structure the LLM needs
  // to understand WHY each test failed and what source code must change.
  //
  // When triage produced a `deterministicTestNames` set, we filter to only
  // the matching contexts — the LLM is explicitly instructed below to fix
  // ONLY those, so feeding it extra flaky/infra contexts would invite it
  // to rewrite otherwise-correct code.
  const errorContextContents: string[] = [];
  const errorContextFiles = (
    await listFiles("frontend/test-results", state.outputDir)
  ).filter((f) => f.endsWith("error-context.md"));
  for (const ecf of errorContextFiles) {
    const md = await fsRead(ecf, state.outputDir);
    if (md.startsWith("FILE_NOT_FOUND") || md.startsWith("REJECTED")) continue;
    if (
      deterministicTestNames &&
      !errorContextMatchesAny(md, deterministicTestNames)
    ) {
      continue;
    }
    const folderName = ecf.split("/").slice(-2, -1)[0] ?? ecf;
    errorContextContents.push(`### ${folderName}\n${md.slice(0, 3000)}`);
  }

  // Statically analyse test files to extract waitForResponse URL patterns.
  // Each pattern represents a network request the application MUST make, or
  // the test will block until timeout. Surface these as explicit constraints.
  const waitForResponseConstraints: string[] = [];
  for (const tf of testFiles) {
    const c = await fsRead(tf, state.outputDir);
    if (c.startsWith("FILE_NOT_FOUND") || c.startsWith("REJECTED")) continue;
    const wfrMatches = [
      ...c.matchAll(
        /waitForResponse\s*\(\s*(?:response\s*=>\s*)?[^)]*?['"](\/[^'"]+)['"]/g,
      ),
    ];
    for (const m of wfrMatches) {
      waitForResponseConstraints.push(
        `- File ${tf}: waitForResponse expects a real HTTP request to a URL containing "${m[1]}"`,
      );
    }
    // Also catch arrow-function form: response => response.url().includes('/sessions')
    const includesMatches = [
      ...c.matchAll(
        /waitForResponse[^)]*?\.url\(\)\.includes\(['"](\/[^'"]+)['"]\)/g,
      ),
    ];
    for (const m of includesMatches) {
      const url = m[1];
      if (!waitForResponseConstraints.some((l) => l.includes(url))) {
        waitForResponseConstraints.push(
          `- File ${tf}: waitForResponse expects a real HTTP request to a URL containing "${url}"`,
        );
      }
    }
    // Detect timer-completion tests: expect(modal).toBeVisible({ timeout: N }) after clicking Start
    if (
      c.includes("toBeVisible") &&
      c.includes("timeout") &&
      c.includes("Start") &&
      c.includes("modal")
    ) {
      waitForResponseConstraints.push(
        `- File ${tf}: timer completion test — workDuration in defaultSettings MUST be ≤ 0.25 minutes (15 seconds) so the timer completes within the 30-second test timeout`,
      );
    }
  }

  // Collect key source files for repair context (pages, router, auth, api client).
  const allSrcFiles = (await listFiles("frontend/src", state.outputDir)).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !/\.(spec|test)\.(ts|tsx)$/.test(f),
  );
  const SOURCE_PRIORITY = [
    /router\.(ts|tsx)$/,
    /App\.(ts|tsx)$/,
    /main\.(ts|tsx)$/,
    /pages\//,
    /views\//,
    /context\//,
    /lib\/auth/,
    /api\/client/,
    /api\/auth/,
    /utils\/authStorage/,
    /lib\/storage/,
  ];
  const sortedSrcFiles = [...allSrcFiles].sort((a, b) => {
    const ai = SOURCE_PRIORITY.findIndex((r) => r.test(a));
    const bi = SOURCE_PRIORITY.findIndex((r) => r.test(b));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const srcFileContents: string[] = [];
  let srcBudget = 14000;
  for (const sf of sortedSrcFiles) {
    if (srcBudget <= 0) break;
    const c = await fsRead(sf, state.outputDir);
    if (!c.startsWith("FILE_NOT_FOUND") && !c.startsWith("REJECTED")) {
      const snippet = c.slice(0, Math.min(2000, srcBudget));
      srcFileContents.push(`### ${sf}\n\`\`\`\n${snippet}\n\`\`\``);
      srcBudget -= snippet.length;
    }
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are an E2E source-code repair specialist.",
        "",
        "## Your job",
        "The Playwright E2E test files are derived directly from the PRD and represent the REQUIRED behaviour.",
        "They are the specification — do NOT modify them.",
        "Your job is to fix the APPLICATION SOURCE CODE so that all E2E tests pass.",
        "",
        "## Rules",
        "- NEVER modify any file that matches *.spec.ts, *.spec.tsx, *.test.ts, *.test.tsx.",
        "- Treat every locator, URL, button label, and aria-label in the test files as the ground truth for what the UI must render.",
        "- When a test expects a button named 'Go Home', the source component MUST render a button with that exact accessible name.",
        "- When a test navigates to /dashboard or /settings, those routes MUST exist and render the correct page.",
        "- When a test logs in with seeded credentials (e.g. owner@example.com / Password123!), the auth layer MUST accept them without a real backend.",
        "- Prefer localStorage-based mock auth (lib/auth.ts pattern) over real API calls when no backend is available.",
        "- Fix routing gaps: if a route is missing from the router, add it with the correct page component.",
        "- Fix label mismatches: if a test uses getByLabel('Sound Notifications') the input must have aria-label='Sound Notifications'.",
        "- Fix navigation: if a test clicks a Settings link in the nav, the nav must contain that link.",
        "",
        "## Critical Playwright mechanics you MUST understand before diagnosing",
        "- The page snapshot in error-context.md is captured AT THE MOMENT THE TEST FAILS, which can be",
        "  30 seconds into test execution after many actions have already occurred.",
        "  DO NOT assume the snapshot shows the initial page state — it shows the state at failure time.",
        "- `page.waitForResponse(url)` creates a promise that resolves only when the application makes",
        "  an actual HTTP request whose URL matches. If the application code does NOT fetch that URL,",
        "  `waitForResponse` blocks until test timeout. This is the #1 cause of 'Test timeout exceeded'",
        "  with no specific assertion error. Fix: add a fetch/axios call in the application code for",
        "  every URL pattern the test listens for (e.g. reset, pause, complete actions).",
        "- When a test error says only 'Test timeout of 30000ms exceeded' (no assertion line shown),",
        "  it almost always means an `await` is blocked on a promise that never resolved.",
        "  Look for `page.waitForResponse`, `page.waitForNavigation`, or similar in the test code.",
        "- `expect(locator).toBeVisible({ timeout: 90000 })` means the test will wait UP TO 90s for",
        "  the element — but the overall TEST timeout is 30s. If the UI state change (e.g. timer",
        "  completing and showing a modal) takes longer than 30s, the test will timeout regardless.",
        "  Fix: shorten the underlying timer/animation duration so the state change happens in < 20s.",
        "- Output ONLY modified source files using ```file:path``` blocks. No explanations.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Project root: ${state.outputDir}`,
        `E2E command: ${plan.command}`,
        `Attempt: ${attempt}`,
        triageSummaryText ? `Triage: ${triageSummaryText}` : "",
        deterministicTestNames && deterministicTestNames.size > 0
          ? [
              "",
              "## Triage-filtered scope",
              "The e2e command was executed twice. Only the tests listed below failed",
              "deterministically on BOTH runs — fix ONLY these, do not speculate about",
              "flaky or infrastructure-related failures (they are intentionally omitted",
              "from this prompt):",
              ...[...deterministicTestNames].map((n) => `- ${n}`),
            ].join("\n")
          : "",
        "",
        errorContextContents.length > 0
          ? `## Per-test failure details (page snapshots, exact failing lines, DOM state)\n${errorContextContents.join("\n\n---\n\n")}`
          : "",
        "",
        waitForResponseConstraints.length > 0
          ? [
              "## MANDATORY constraints derived from test code (fix ALL of these or tests will keep timing out)",
              ...waitForResponseConstraints,
            ].join("\n")
          : "",
        "",
        "## E2E failure summary",
        "```",
        failureSummary.slice(-4000),
        "```",
        "",
        testFileContents.length > 0
          ? `## E2E test files (DO NOT MODIFY — treat as specification)\n${testFileContents.join("\n\n")}`
          : "",
        "",
        srcFileContents.length > 0
          ? `## Application source files (these are what you should fix)\n${srcFileContents.join("\n\n")}`
          : "",
        "",
        "## PRD context",
        state.projectContext.slice(0, 4000),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(messages, e2eModelChain, {
      temperature: 0.1,
      max_tokens: 12000,
    });
    const content = response.choices[0]?.message?.content ?? "";
    recordSupervisorLlmUsage({
      sessionId: state.sessionId,
      stage: "e2e_source_repair",
      model: response.model,
      usage: response.usage,
      costUsd: estimateCost(response.model, response.usage),
    });
    const fileBlocks = parseFileBlocksFromContent(content);
    if (fileBlocks.length === 0) {
      console.warn(
        "[Supervisor] e2eVerify: model returned no file blocks, keeping failure for next retry.",
      );
      return {
        e2eVerifyAttempts: attempt,
        e2eVerifyErrors: failureSummary,
      };
    }

    for (const file of fileBlocks) {
      await fsWrite(file.filePath, file.fileContent, state.outputDir, {
        scaffoldProtectedPaths: state.scaffoldProtectedPaths ?? [],
      });
    }
    console.log(
      `[Supervisor] e2eVerify: wrote ${fileBlocks.length} file(s), will re-verify next iteration.`,
    );
  } catch (e) {
    console.warn(
      `[Supervisor] e2eVerify: auto-fix call failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    e2eVerifyAttempts: attempt,
    e2eVerifyErrors: failureSummary,
  };
}

function routeAfterIntegrationVerify(state: SupervisorState): string {
  if (state.integrationErrors) return "summary";
  return "e2e_verify";
}

/**
 * Extract the most-uniquely-identifying segment of a Playwright test name.
 * Tests are typically written as `<spec>:<line>:<col> › <suite> › <title>`
 * or in error-context.md form `<spec> >> <suite> >> <title>`. The final
 * segment is the test title, which uniquely identifies the test within a
 * single run. We use it to match across the two formats.
 */
function lastTestNameSegment(name: string): string {
  const parts = name
    .split(/\s*(?:›|>>)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1] ?? name;
  return last.replace(/\s+/g, " ").trim();
}

function errorContextMatchesAny(
  errorContextMd: string,
  deterministicNames: Set<string>,
): boolean {
  // Find the `- Name: ...` line in the markdown header.
  const m = /^-\s*Name:\s*(.+)$/m.exec(errorContextMd);
  if (!m) return false;
  const ctxTitle = lastTestNameSegment(m[1]);
  for (const det of deterministicNames) {
    const detTitle = lastTestNameSegment(det);
    if (detTitle && ctxTitle === detTitle) return true;
    // Fuzzy fallback: PRD ids like "E2E-002" must appear in both.
    const prdId = (/\bE2E-\d+\b/i.exec(detTitle) ?? [])[0];
    if (prdId && ctxTitle.includes(prdId)) return true;
  }
  return false;
}

async function writeTriageReport(
  outputDir: string,
  attempt: number,
  report: string,
): Promise<void> {
  try {
    const ralphDir = path.join(outputDir, ".ralph");
    await fs.mkdir(ralphDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `e2e-triage-attempt-${attempt}-${timestamp}.md`;
    await fs.writeFile(path.join(ralphDir, filename), report, "utf-8");
    // Also write/overwrite the "latest" pointer for quick access.
    await fs.writeFile(path.join(ralphDir, "e2e-triage.md"), report, "utf-8");
  } catch (err) {
    console.warn(
      `[Supervisor] writeTriageReport failed (ignored):`,
      err instanceof Error ? err.message : err,
    );
  }
}

function routeAfterE2eVerify(state: SupervisorState): string {
  if (!state.e2eVerifyErrors) {
    return "summary";
  }
  if (state.e2eVerifyAttempts <= MAX_E2E_VERIFY_FIX_ATTEMPTS) {
    return "e2e_verify";
  }
  // All attempts exhausted but still failing — proceed to summary with errors recorded.
  console.warn(
    `[Supervisor] e2eVerify: all ${MAX_E2E_VERIFY_FIX_ATTEMPTS} fix attempts exhausted, proceeding to summary with remaining failures.`,
  );
  return "summary";
}

function e2eFailed(state: SupervisorState): never {
  const details =
    state.e2eVerifyErrors?.slice(0, 2000) ?? "Unknown E2E failure";
  throw new Error(
    `E2E verification gate failed after ${state.e2eVerifyAttempts} attempt(s).\n${details}`,
  );
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
}

## MANDATORY: Nested resource endpoints for parent-child relationships

When the PRD or supplied type/model definitions describe a one-to-many relationship
between two resources (e.g. a Project "has" Tasks, a User "has" Comments, an Order
"has" LineItems), you MUST emit BOTH sets of endpoints:

  1. **Flat endpoints** on the child resource:
       GET    /api/{children}              — list with filters
       POST   /api/{children}              — create
       GET    /api/{children}/:id          — get one
       PATCH  /api/{children}/:id          — update
       DELETE /api/{children}/:id          — delete

  2. **Scoped-list endpoint** under the parent (THIS IS THE ONE MOST OFTEN MISSED):
       GET    /api/{parents}/:id/{children}
       Description: "List all {children} belonging to the {parent} identified by :id."
       Support the same filtering/sorting/pagination query params the flat list accepts.
       Example relationships and resulting scoped lists:
         Project hasMany Tasks         → GET /api/projects/:id/tasks
         User    hasMany Posts         → GET /api/users/:id/posts
         Order   hasMany LineItems     → GET /api/orders/:id/line-items

Rules:
- The scoped-list endpoint is ADDITIONAL, not a replacement for the flat list.
- Detect relationships from every signal available: PRD wording ("tasks belong to a project",
  "user's posts"), TypeScript types/interfaces with a foreign-key field (e.g. \`projectId\`),
  ORM model snippets (\`Project.hasMany(Task)\`, \`Task.belongsTo(Project)\`).
- If the parent→child relationship exists but you are unsure about exact pluralisation,
  still emit the endpoint — use the child resource's plural form consistent with its flat
  endpoint (e.g. if flat is \`/api/tasks\`, scoped is \`/api/projects/:id/tasks\`).
- Never silently drop a scoped endpoint because a flat one already exists.

A separate post-generation gate will audit ORM models for hasMany/belongsTo relations
and REJECT the contract if any scoped-list endpoint is missing. Get it right the first
time to avoid a rework loop.`;

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
    // Replace legacy `slice(0, 8000)` truncation with a relevance-aware
    // section picker. We're looking for API contract material: endpoints,
    // routes, request/response shapes, auth, data types.
    const apiContractHint = {
      keywords: [
        "api",
        "endpoint",
        "route",
        "request",
        "response",
        "schema",
        "auth",
        "token",
        "controller",
        "service",
      ],
    };
    const trimmed = pickRelevantSections(
      state.projectContext,
      apiContractHint,
      {
        budget: 12_000,
        label: "api-contract-generation",
        stage: "worker-context",
        emitter: getRepairEmitter(state.sessionId),
      },
    );
    contextParts.push(`## Project Context (PRD / TRD)\n${trimmed}`);
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
    MODEL_CONFIG.taskBreakdown ?? MODEL_CONFIG.codeFix ?? "gpt-4o",
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
        max_tokens: 65536,
      },
    );

    const raw = (response.choices[0]?.message?.content ?? "").trim();
    const costUsd = estimateCost(response.model, response.usage);
    recordSupervisorLlmUsage({
      sessionId: state.sessionId,
      stage: "generate_api_contracts",
      model: response.model,
      usage: response.usage,
      costUsd,
    });

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
      requestFields: item.requestSchema ?? undefined,
      responseFields: item.responseSchema ?? undefined,
      authType: item.auth ?? "none",
      description: item.description ?? undefined,
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

    // ── Contract-vs-models completeness audit + auto-append ────────────────
    // Run immediately after writing so the downstream worker phases generate
    // against a complete contract instead of silently skipping endpoints the
    // ORM relationships obviously require. Auto-append is safe-by-default: it
    // only synthesises entries whose plural segments were already resolved by
    // the audit, and never overwrites existing contract entries.
    try {
      const completeness = await auditContractCompleteness(state.outputDir);
      if (completeness.missingScopedEndpoints.length > 0) {
        console.warn(
          `[Supervisor] generateApiContracts: contract completeness audit found ${completeness.missingScopedEndpoints.length} missing scoped endpoint(s): ${completeness.missingScopedEndpoints
            .map((m) => m.expectedPath)
            .join(", ")}`,
        );
      }
      getRepairEmitter(state.sessionId)({
        stage: "generate_api_contracts",
        event: "contract_completeness_snapshot",
        details: {
          when: "post-generate",
          inferredRelationshipCount: completeness.inferredRelationships.length,
          missingScopedEndpoints: completeness.missingScopedEndpoints,
        },
      });
      if (completeness.missingScopedEndpoints.length > 0) {
        const appendResult = await autoAppendMissingScopedEndpoints(
          state.outputDir,
          completeness.missingScopedEndpoints,
        );
        if (appendResult.added.length > 0) {
          console.log(
            `[Supervisor] generateApiContracts: auto-appended ${appendResult.added.length} scoped endpoint(s) to API_CONTRACTS.json: ${appendResult.added.join(", ")}`,
          );
        }
        getRepairEmitter(state.sessionId)({
          stage: "generate_api_contracts",
          event: "contract_completeness_autorepaired",
          details: {
            when: "post-generate",
            added: appendResult.added,
            skipped: appendResult.skipped,
          },
        });
      }
    } catch (err) {
      console.warn(
        `[Supervisor] generateApiContracts: contract completeness audit skipped — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

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
      max_tokens: 65536,
    });
    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);
    recordSupervisorLlmUsage({
      sessionId: state.sessionId,
      stage: "bootstrap_shared_contracts",
      model: response.model,
      usage: response.usage,
      costUsd,
    });
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

/* generateServiceSkeletons — REMOVED.
 * Skeleton files (throw new Error("Not implemented")) caused more harm than
 * good: controllers / routes / middleware were generated as stubs and often
 * not replaced by workers. API contracts + task-breakdown + architect phase
 * already provide enough cross-file context for workers. */

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
        sessionId: state.sessionId,
        prdSpec: state.prdSpec,
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
        sessionId: state.sessionId,
        prdSpec: state.prdSpec,
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
        sessionId: state.sessionId,
        prdSpec: state.prdSpec,
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
        sessionId: state.sessionId,
        prdSpec: state.prdSpec,
      }),
    ];
  }

  const feCount = workersForRole("frontend", state.frontendTasks.length);
  const feChunks = chunkTasks(state.frontendTasks, feCount);

  // Build a rich API reference block from the full contracts.
  // This is injected into projectContext so LLM cannot miss it.
  let apiReferenceBlock = "";
  if (state.apiContracts.length > 0) {
    const contractLines = state.apiContracts.map((c) => {
      const lines = [
        `### ${c.method} ${c.endpoint}`,
        `- **Service**: ${c.service}`,
        `- **Auth**: ${c.authType ?? "none"}`,
      ];
      if (c.description) lines.push(`- **Description**: ${c.description}`);
      if (c.requestFields && c.requestFields !== "none") {
        lines.push(`- **Request body**: \`${c.requestFields}\``);
      }
      if (c.responseFields && c.responseFields !== "none") {
        lines.push(`- **Response**: \`${c.responseFields}\``);
      }
      return lines.join("\n");
    });
    apiReferenceBlock = [
      "\n\n---\n\n## REAL Backend API Reference (use these EXACT paths and field names)",
      "⚠️  ALL frontend API calls MUST use these endpoints. DO NOT invent endpoints or use mock data.",
      "⚠️  For auth-required endpoints, read the token from localStorage key `pomotrack_token`.",
      "",
      contractLines.join("\n\n"),
    ].join("\n");
  }

  const feContext = [
    state.frontendDesignContext
      ? `${state.projectContext}\n\n---\n\n${state.frontendDesignContext}`
      : state.projectContext,
    apiReferenceBlock,
  ]
    .filter(Boolean)
    .join("");

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
        sessionId: state.sessionId,
        prdSpec: state.prdSpec,
      }),
  );
}

/**
 * After BE Workers complete, extract real routes from generated files
 * to supplement/correct the api_contract_phase contracts.
 */
async function extractRealContracts(
  state: SupervisorState,
): Promise<Partial<SupervisorState>> {
  // Collect backend route/controller files and shared type files
  const beFiles = state.fileRegistry.filter(
    (f) =>
      f.role === "backend" &&
      (f.path.includes("route") ||
        f.path.includes("controller") ||
        f.path.includes("handler") ||
        f.path.includes("api")) &&
      /\.(ts|js)$/.test(f.path),
  );

  const typeFiles = state.fileRegistry
    .filter(
      (f) =>
        (f.role === "architect" || f.role === "backend") &&
        (f.path.includes("type") ||
          f.path.includes("interface") ||
          f.path.includes("schema") ||
          f.path.includes("model")) &&
        /\.(ts|js)$/.test(f.path),
    )
    .slice(0, 6);

  if (beFiles.length === 0) {
    console.log("[Supervisor] extractRealContracts: no BE route files found.");
    return {};
  }

  console.log(
    `[Supervisor] extractRealContracts: scanning ${beFiles.length} BE file(s) with LLM...`,
  );

  // Build file content context for LLM
  const fileParts: string[] = [];
  for (const file of [...beFiles.slice(0, 8), ...typeFiles]) {
    const content = await fsRead(file.path, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileParts.push(
        `### ${file.path}\n\`\`\`typescript\n${content.slice(0, 3000)}\n\`\`\``,
      );
    }
  }

  if (fileParts.length === 0) return {};

  const extractModelChain = resolveModelChain(
    MODEL_CONFIG.codeFix ?? "gpt-4o",
    resolveModel,
  );

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a backend API analyst. Read the provided source files and extract every HTTP endpoint.
Output a JSON array only — no markdown, no explanation.
Each element:
{
  "service": "string (module/folder name, e.g. auth, sessions, users)",
  "endpoint": "string (full path with prefix, e.g. /api/auth/login)",
  "method": "GET|POST|PUT|PATCH|DELETE",
  "requestFields": "TypeScript type literal for request body, e.g. { email: string; password: string } or 'none'",
  "responseFields": "TypeScript type literal for success response, e.g. { success: boolean; data: { token: string; user: User } }",
  "auth": "none|bearer|session",
  "description": "one sentence"
}
Rules:
- Reconstruct the full path by combining router prefix + route prefix + route path.
- For request/response schemas, look at the TypeScript interfaces/types actually used by the handler.
- If a route uses auth middleware, set auth to "bearer".
- Be precise about field names and types — the frontend will use these to write its API calls.`,
    },
    {
      role: "user",
      content: [
        "Extract all API endpoints from the following backend source files.",
        "",
        ...fileParts,
        "",
        "Output a JSON array only.",
      ].join("\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(
      messages,
      extractModelChain,
      {
        temperature: 0.1,
        max_tokens: 4096,
      },
    );
    const raw = (response.choices[0]?.message?.content ?? "").trim();
    const costUsd = estimateCost(response.model, response.usage);
    recordSupervisorLlmUsage({
      sessionId: state.sessionId,
      stage: "extract_real_contracts",
      model: response.model,
      usage: response.usage,
      costUsd,
    });

    let parsed: Array<{
      service?: string;
      endpoint?: string;
      method?: string;
      requestFields?: string;
      responseFields?: string;
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
        "[Supervisor] extractRealContracts: failed to parse LLM output, falling back to regex.",
      );
    }

    // Regex fallback for any route the LLM missed
    const regexContracts: ApiContract[] = [];
    for (const file of beFiles.slice(0, 8)) {
      const content = await fsRead(file.path, state.outputDir);
      if (content.startsWith("FILE_NOT_FOUND")) continue;
      const routePattern =
        /\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
      let match;
      while ((match = routePattern.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const endpoint = match[2].startsWith("/") ? match[2] : `/${match[2]}`;
        const alreadyCovered = parsed.some(
          (p) => p.method?.toUpperCase() === method && p.endpoint === endpoint,
        );
        if (
          !alreadyCovered &&
          !regexContracts.some(
            (c) => c.method === method && c.endpoint === endpoint,
          )
        ) {
          regexContracts.push({
            service: file.path.split("/").slice(-2, -1)[0] ?? "api",
            endpoint,
            method,
            authType: "bearer",
            schema: "extracted by regex",
            generatedBy: "extract_real_contracts_regex",
          });
        }
      }
    }

    const llmContracts: ApiContract[] = parsed.map((item) => ({
      service: item.service ?? "api",
      endpoint: item.endpoint ?? "/",
      method: (item.method ?? "GET").toUpperCase(),
      requestFields:
        item.requestFields !== "none" ? item.requestFields : undefined,
      responseFields:
        item.responseFields !== "none" ? item.responseFields : undefined,
      authType: item.auth ?? "none",
      description: item.description,
      schema: [
        item.requestFields && item.requestFields !== "none"
          ? `request: ${item.requestFields}`
          : "",
        item.responseFields && item.responseFields !== "none"
          ? `response: ${item.responseFields}`
          : "",
      ]
        .filter(Boolean)
        .join(" | "),
      generatedBy: "extract_real_contracts_llm",
    }));

    const allContracts = [...llmContracts, ...regexContracts];

    console.log(
      `[Supervisor] extractRealContracts: extracted ${allContracts.length} real route(s) (${llmContracts.length} via LLM, ${regexContracts.length} via regex, cost: $${costUsd.toFixed(4)})`,
    );

    return { apiContracts: allContracts, totalCostUsd: costUsd };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[Supervisor] extractRealContracts: LLM error — ${msg}. Falling back to regex only.`,
    );

    // Pure regex fallback
    const fallbackContracts: ApiContract[] = [];
    for (const file of beFiles.slice(0, 8)) {
      const content = await fsRead(file.path, state.outputDir);
      if (content.startsWith("FILE_NOT_FOUND")) continue;
      const routePattern =
        /\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
      let match;
      while ((match = routePattern.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const endpoint = match[2].startsWith("/") ? match[2] : `/${match[2]}`;
        if (
          !fallbackContracts.some(
            (c) => c.method === method && c.endpoint === endpoint,
          )
        ) {
          fallbackContracts.push({
            service: file.path.split("/").slice(-2, -1)[0] ?? "api",
            endpoint,
            method,
            authType: "bearer",
            schema: "extracted by regex",
            generatedBy: "extract_real_contracts_regex",
          });
        }
      }
    }
    return { apiContracts: fallbackContracts };
  }
}

// ─── Build gate ───

/**
 * Run pnpm/npm build for web and api packages. Returns error text if build
 * fails, empty string if it passes or no build script exists.
 */
async function runBuildGate(outputDir: string): Promise<string> {
  console.log("[Supervisor] Build gate: attempting pnpm run build...");

  const pkgRaw = await fsRead("package.json", outputDir);
  const frontendPkgRaw = await fsRead("frontend/package.json", outputDir);
  const backendPkgRaw = await fsRead("backend/package.json", outputDir);

  if (
    pkgRaw.startsWith("FILE_NOT_FOUND") &&
    frontendPkgRaw.startsWith("FILE_NOT_FOUND") &&
    backendPkgRaw.startsWith("FILE_NOT_FOUND")
  ) {
    return "";
  }

  if (
    pkgRaw.startsWith("FILE_NOT_FOUND") &&
    (!frontendPkgRaw.startsWith("FILE_NOT_FOUND") ||
      !backendPkgRaw.startsWith("FILE_NOT_FOUND"))
  ) {
    const targets = [
      !frontendPkgRaw.startsWith("FILE_NOT_FOUND")
        ? { name: "frontend", cwd: "frontend" }
        : null,
      !backendPkgRaw.startsWith("FILE_NOT_FOUND")
        ? { name: "backend", cwd: "backend" }
        : null,
    ].filter((v): v is { name: string; cwd: string } => Boolean(v));

    const failures: string[] = [];
    for (const target of targets) {
      try {
        const result = await shellExec(
          "pnpm run build 2>&1",
          path.join(outputDir, target.cwd),
          {
            timeout: 120_000,
          },
        );
        const out = (result.stderr || result.stdout || "").trim();
        if (
          result.exitCode !== 0 &&
          !/Missing script|ENOENT|not found/.test(out)
        ) {
          failures.push(
            `### ${target.name}\n\`\`\`\n${out.split("\n").slice(-40).join("\n")}\n\`\`\``,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/Missing script|ENOENT|not found/.test(msg)) {
          failures.push(`### ${target.name}\n${msg.slice(0, 500)}`);
        }
      }
    }

    if (failures.length === 0) {
      console.log("[Supervisor] Build gate: PASSED for split M-tier targets.");
      return "";
    }

    console.log("[Supervisor] Build gate: FAILED for split M-tier targets.");
    return `## Build failed\n${failures.join("\n\n")}`;
  }

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

const MAX_VERIFY_FIX_ITERATIONS = 50;

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
        "npx tsc --noEmit, npx prisma generate, etc. " +
        "For integration validation, scope commands explicitly to frontend/ or backend/.",
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
      description:
        "Write or replace a file at the given relative path. In IntegrationVerifyFix this may overwrite scaffold-protected files when needed.",
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
function buildSupervisorSearchMatcher(
  pattern: string,
): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern, "i");
    return (line: string) => regex.test(line);
  } catch {
    const lowered = pattern.toLowerCase();
    return (line: string) => line.toLowerCase().includes(lowered);
  }
}

type ScopedValidationKind =
  | "frontend_tsc"
  | "frontend_build"
  | "backend_tsc"
  | "backend_smoke";

function isSuccessfulSupervisorToolResult(result: string): boolean {
  return /^exit_code:\s*0\b/m.test(result);
}

function stripSupervisorExitCodePrefix(result: string): string {
  return result.replace(/^exit_code:\s*\d+\s*\n?/m, "").trim();
}

interface ScopedValidationIssueMetrics {
  files: number;
  errors: number;
}

function extractScopedValidationIssueMetrics(
  kind: ScopedValidationKind,
  result: string,
): ScopedValidationIssueMetrics | null {
  if (isSuccessfulSupervisorToolResult(result)) {
    return { files: 0, errors: 0 };
  }
  const body = stripSupervisorExitCodePrefix(result);
  if (!body) return null;
  if (kind === "backend_smoke") {
    return { files: 1, errors: 1 };
  }

  const filePathPattern =
    /(^|\n)\s*((?:\.{0,2}\/)?(?:[A-Za-z0-9@_\-.]+\/)*[A-Za-z0-9@_\-.]+\.(?:[cm]?[jt]sx?|vue|svelte))(?:[:(]| - )/gm;
  const files = new Set<string>();
  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = filePathPattern.exec(body)) !== null) {
    files.add(fileMatch[2]);
  }

  const tsMatches = body.match(/\berror TS\d+:/g);
  const fileScopedErrors = body.match(/^\S+:\d+:\d+\s+-\s+error\b/gm);
  const genericErrors = body.match(/^\s*(?:error|Error:)\b/gm);
  const errors = Math.max(
    tsMatches?.length ?? 0,
    fileScopedErrors?.length ?? 0,
    genericErrors?.length ?? 0,
    1,
  );

  return {
    files: Math.max(files.size, errors > 0 ? 1 : 0),
    errors,
  };
}

function isValidationIssueMetricsImproved(
  current: ScopedValidationIssueMetrics,
  previousBest: ScopedValidationIssueMetrics,
): boolean {
  return (
    current.files < previousBest.files ||
    (current.files === previousBest.files &&
      current.errors < previousBest.errors)
  );
}

function countRouteAuditIssues(audit: RouteRegistrationAudit): number {
  return (
    audit.unregisteredModules.length +
    audit.unresolvedRegistrations.length +
    audit.missingContractEndpoints.length
  );
}

function countContractCompletenessIssues(
  result: ContractCompletenessResult,
): number {
  return result.missingScopedEndpoints.length;
}

function isMutatingSupervisorBashCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /\b(pnpm|npm|yarn)\s+(install|add|remove|unlink|update)\b/.test(
      normalized,
    ) ||
    /\b(npx\s+)?prisma\s+generate\b/.test(normalized) ||
    /\bmkdir\b|\btouch\b|\bcp\b|\bmv\b|\bsed\s+-i\b|\bperl\s+-pi\b/.test(
      normalized,
    )
  );
}

function detectScopedValidationKind(
  command: string,
): ScopedValidationKind | null {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
  const touchesFrontend =
    normalized.includes("cd frontend") ||
    normalized.includes("/frontend") ||
    normalized.includes(" frontend/");
  const touchesBackend =
    normalized.includes("cd backend") ||
    normalized.includes("/backend") ||
    normalized.includes(" backend/");

  if (touchesFrontend && /\b(tsc|npx tsc)\b/.test(normalized)) {
    return "frontend_tsc";
  }
  if (
    touchesFrontend &&
    /\b(pnpm|npm|yarn)\s+(run\s+)?build\b/.test(normalized)
  ) {
    return "frontend_build";
  }
  if (touchesBackend && /\b(tsc|npx tsc)\b/.test(normalized)) {
    return "backend_tsc";
  }
  if (
    touchesBackend &&
    (normalized.includes("createapp export missing") ||
      normalized.includes("backend_smoke_ok") ||
      normalized.includes("tsx --eval"))
  ) {
    return "backend_smoke";
  }
  return null;
}

function isValidationLikeBashCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /\b(tsc|npx tsc)\b/.test(normalized) ||
    /\b(pnpm|npm|yarn)\s+(run\s+)?build\b/.test(normalized) ||
    normalized.includes("tsx --eval")
  );
}

function buildIntegrationReasoningOptions(): Pick<
  OpenRouterOptions,
  "reasoning" | "thinking"
> {
  const enabled =
    (
      process.env.INTEGRATION_VERIFYFIX_ENABLE_REASONING ?? "true"
    ).toLowerCase() !== "false";
  if (!enabled) {
    return {};
  }

  const effortRaw =
    process.env.INTEGRATION_VERIFYFIX_REASONING_EFFORT?.trim().toLowerCase() ??
    "medium";
  const effort =
    effortRaw === "low" || effortRaw === "high" ? effortRaw : "medium";

  const verbosityRaw =
    process.env.INTEGRATION_VERIFYFIX_THINKING_VERBOSITY?.trim().toLowerCase() ??
    "medium";
  const verbosity =
    verbosityRaw === "low" || verbosityRaw === "high" ? verbosityRaw : "medium";

  return {
    reasoning: {
      enabled: true,
      effort,
    },
    thinking: {
      thinking_effort: effort,
      verbosity,
    },
  };
}

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

      const matcher = buildSupervisorSearchMatcher(pattern);
      const filePaths: string[] = [];
      const directFileContent = await fsRead(searchPath, outputDir);
      if (
        !directFileContent.startsWith("FILE_NOT_FOUND") &&
        !directFileContent.startsWith("REJECTED")
      ) {
        filePaths.push(searchPath);
      } else {
        filePaths.push(...(await listFiles(searchPath, outputDir)));
      }

      const matches: string[] = [];
      for (const relPath of filePaths) {
        if (!/\.(ts|tsx|js|jsx|json|md)$/.test(relPath)) continue;
        const content = await fsRead(relPath, outputDir);
        if (
          content.startsWith("FILE_NOT_FOUND") ||
          content.startsWith("REJECTED")
        ) {
          continue;
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!matcher(lines[i])) continue;
          matches.push(`${relPath}:${i + 1}:${lines[i]}`);
          if (matches.length >= 60) break;
        }
        if (matches.length >= 60) break;
      }

      return (matches.join("\n") || "No matches found.")
        .trim()
        .slice(0, MAX_OUT);
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
 * Deterministic auto-fix for well-known convention violations.
 *
 * Runs before the LLM-driven phase so mechanical fixes don't burn LLM tokens
 * and don't risk the LLM "creatively" inventing inconsistent fixes.
 *
 * Covers:
 *  1. `@shared/...` import alias → `@project/shared/...` (Vite/tsconfig canonical).
 *  2. Residual-only canonical/residual pairs (e.g. `backend/src/middlewares/` when
 *     `backend/src/middleware/` is absent): rename residual → canonical on disk
 *     and rewrite imports that reference the residual segment.
 *
 * When BOTH canonical and residual exist the merge decision is genuinely
 * ambiguous (file contents may diverge) — we leave that to the LLM and surface
 * the conflict as an `unfixable` note so the system prompt can call it out.
 */
async function autoApplyConventionFixes(outputDir: string): Promise<{
  fixedFiles: string[];
  notes: string[];
  unfixable: string[];
}> {
  const fixedFiles = new Set<string>();
  const notes: string[] = [];
  const unfixable: string[] = [];

  const allFiles = await listFiles(".", outputDir);
  const sourceFiles = allFiles.filter(
    (f) =>
      /\.(ts|tsx|js|jsx|mts|cts)$/.test(f) &&
      !f.includes("node_modules") &&
      !f.startsWith("dist/") &&
      !f.startsWith(".next/") &&
      !f.startsWith("build/"),
  );

  // ── Rule 1: @shared/ import alias rewrite ───────────────────────────────
  let sharedAliasHits = 0;
  for (const rel of sourceFiles) {
    const content = await fsRead(rel, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    if (!/@shared\//.test(content)) continue;
    const rewritten = content
      .replace(/(from\s+["'])@shared\//g, "$1@project/shared/")
      .replace(/(import\s+["'])@shared\//g, "$1@project/shared/")
      .replace(/(require\(\s*["'])@shared\//g, "$1@project/shared/");
    if (rewritten !== content) {
      await fsWrite(rel, rewritten, outputDir);
      fixedFiles.add(rel);
      sharedAliasHits += 1;
    }
  }
  if (sharedAliasHits > 0) {
    notes.push(
      `Rewrote "@shared/..." → "@project/shared/..." imports in ${sharedAliasHits} file(s).`,
    );
  }

  // ── Rule 2: canonical/residual relocation ──────────────────────────────
  // Each pair: { canonical, residual, importSegmentBefore, importSegmentAfter }
  // `importSegment*` are substrings we can safely swap inside import specifiers
  // to keep references consistent after a rename. They are chosen narrow enough
  // to avoid collateral rewrites.
  const pairs: Array<{
    canonical: string;
    residual: string;
    kind: "file" | "directory";
    importSegmentBefore: string;
    importSegmentAfter: string;
  }> = [
    {
      canonical: "frontend/src/contexts/AuthContext.tsx",
      residual: "frontend/src/context/AuthContext.tsx",
      kind: "file",
      importSegmentBefore: "/context/AuthContext",
      importSegmentAfter: "/contexts/AuthContext",
    },
    {
      canonical: "backend/src/middleware/",
      residual: "backend/src/middlewares/",
      kind: "directory",
      importSegmentBefore: "/middlewares/",
      importSegmentAfter: "/middleware/",
    },
    {
      canonical: "backend/src/db.ts",
      residual: "backend/src/database/connection.ts",
      kind: "file",
      importSegmentBefore: "/database/connection",
      importSegmentAfter: "/db",
    },
    {
      canonical: "backend/src/db.ts",
      residual: "backend/src/config/database.ts",
      kind: "file",
      importSegmentBefore: "/config/database",
      importSegmentAfter: "/db",
    },
    {
      canonical: "frontend/src/views/NotFoundPage.tsx",
      residual: "frontend/src/views/NotFound.tsx",
      kind: "file",
      importSegmentBefore: "/views/NotFound",
      importSegmentAfter: "/views/NotFoundPage",
    },
  ];

  for (const pair of pairs) {
    const canonicalAbs = path.join(outputDir, pair.canonical);
    const residualAbs = path.join(outputDir, pair.residual);
    const canonicalExists = await pathExistsUnderOutput(
      outputDir,
      pair.canonical,
    );
    const residualExists = await pathExistsUnderOutput(
      outputDir,
      pair.residual,
    );

    if (!residualExists) continue;

    if (canonicalExists) {
      unfixable.push(
        `Both "${pair.canonical}" and "${pair.residual}" exist — cannot auto-merge safely. Keep the canonical and delete or merge the residual.`,
      );
      continue;
    }

    // Only residual exists → relocate to canonical path + rewrite imports.
    try {
      await fs.mkdir(path.dirname(canonicalAbs), { recursive: true });
      await fs.rename(residualAbs, canonicalAbs);
      notes.push(
        `Renamed residual ${pair.kind} "${pair.residual}" → canonical "${pair.canonical}".`,
      );

      // Rewrite imports that reference the residual segment.
      let rewriteHits = 0;
      for (const rel of sourceFiles) {
        // The moved file itself may now live at the canonical path — still
        // re-read by the original rel is fine (it has been moved, read will
        // return FILE_NOT_FOUND).
        const content = await fsRead(rel, outputDir);
        if (
          content.startsWith("FILE_NOT_FOUND") ||
          content.startsWith("REJECTED")
        ) {
          continue;
        }
        if (!content.includes(pair.importSegmentBefore)) continue;

        // Guard: only rewrite occurrences inside import/require string
        // specifiers; a bare substring in a comment could also match but that
        // is low risk and such rewrites are harmless.
        const importSpecifierRe = new RegExp(
          `((?:from|import|require\\(\\s*)\\s*["'][^"']*?)${escapeRegExp(
            pair.importSegmentBefore,
          )}`,
          "g",
        );
        const rewritten = content.replace(
          importSpecifierRe,
          (_m, prefix) => `${prefix}${pair.importSegmentAfter}`,
        );
        if (rewritten !== content) {
          await fsWrite(rel, rewritten, outputDir);
          fixedFiles.add(rel);
          rewriteHits += 1;
        }
      }
      if (rewriteHits > 0) {
        notes.push(
          `  ↳ rewrote import paths in ${rewriteHits} file(s) to track the rename.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      unfixable.push(
        `Failed to rename "${pair.residual}" → "${pair.canonical}": ${msg}. LLM must relocate manually.`,
      );
    }
  }

  return {
    fixedFiles: [...fixedFiles],
    notes,
    unfixable,
  };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

  // Skip backend verify+fix when the project has no backend tasks (frontend-only project).
  // Frontend TypeScript errors will be caught by fe_phase_verify that runs afterwards.
  const isBackendPhase = options?.workerHintRoles?.includes("backend");
  const isFrontendPhase = options?.workerHintRoles?.includes("frontend");
  if (isBackendPhase && state.backendTasks.length === 0) {
    console.log(
      `${label}: skipping backend verify (frontend-only project, no backend tasks).`,
    );
    return { scaffoldErrors: undefined, scaffoldFixAttempts: 0 };
  }

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

  type TsFixPlan = {
    scope: "backend" | "frontend" | "root";
    cwd: string;
    tscCommand: string;
  };

  const tsFixPlans: TsFixPlan[] = [];
  if (isFrontendPhase) {
    const hasFrontendTsconfig = !(
      await fsRead("frontend/tsconfig.json", state.outputDir)
    ).startsWith("FILE_NOT_FOUND");
    if (hasFrontendTsconfig) {
      const hasFrontendAppTsconfig = !(
        await fsRead("frontend/tsconfig.app.json", state.outputDir)
      ).startsWith("FILE_NOT_FOUND");
      tsFixPlans.push({
        scope: "frontend",
        cwd: path.join(state.outputDir, "frontend"),
        tscCommand: hasFrontendAppTsconfig
          ? "npx tsc -p tsconfig.app.json --pretty false 2>&1"
          : "npx tsc --noEmit --skipLibCheck --pretty false 2>&1",
      });
    }
  }
  if (isBackendPhase) {
    const hasBackendTsconfig = !(
      await fsRead("backend/tsconfig.json", state.outputDir)
    ).startsWith("FILE_NOT_FOUND");
    if (hasBackendTsconfig) {
      tsFixPlans.push({
        scope: "backend",
        cwd: path.join(state.outputDir, "backend"),
        tscCommand: "npx tsc --noEmit --skipLibCheck --pretty false 2>&1",
      });
    }
  }
  if (!isFrontendPhase && !isBackendPhase) {
    const hasRootTsconfig = !(
      await fsRead("tsconfig.json", state.outputDir)
    ).startsWith("FILE_NOT_FOUND");
    if (hasRootTsconfig) {
      tsFixPlans.push({
        scope: "root",
        cwd: state.outputDir,
        tscCommand: "npx tsc --noEmit --skipLibCheck --pretty false 2>&1",
      });
    }
  }

  const autoFixNotes: string[] = [];

  // ── Deterministic convention auto-fix (runs before ESLint / ts-fix) ─────
  // Mechanical fixes the LLM doesn't need to burn tokens on: @shared/ alias
  // rewrite and residual-only canonical/residual relocations. Unfixable
  // conflicts (both paths exist) are surfaced into the prompt below.
  try {
    const conv = await autoApplyConventionFixes(state.outputDir);
    if (conv.fixedFiles.length > 0) {
      console.log(
        `${label}: pre-LLM convention auto-fix touched ${conv.fixedFiles.length} file(s).`,
      );
      for (const note of conv.notes) {
        autoFixNotes.push(`convention: ${note}`);
      }
    }
    for (const line of conv.unfixable) {
      autoFixNotes.push(`convention (unfixable): ${line}`);
    }
    getRepairEmitter(state.sessionId)({
      stage: "preflight-convention-fix",
      event: "convention_autofix_applied",
      details: {
        phase: isBackendPhase
          ? "backend"
          : isFrontendPhase
            ? "frontend"
            : "root",
        fixedFileCount: conv.fixedFiles.length,
        fixedFiles: conv.fixedFiles.slice(0, 20),
        notes: conv.notes,
        unfixable: conv.unfixable,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    autoFixNotes.push(`convention auto-fix skipped due to error: ${msg}`);
    getRepairEmitter(state.sessionId)({
      stage: "preflight-convention-fix",
      event: "convention_autofix_error",
      details: { message: msg },
    });
  }

  let autoFixAllPassed = tsFixPlans.length > 0;
  for (const plan of tsFixPlans) {
    const autoFixCommand =
      plan.scope === "frontend"
        ? 'npx eslint --fix "src/**/*.{ts,tsx}" 2>&1'
        : "npx --no-install ts-fix --tsconfig ./tsconfig.json 2>&1";
    const autoFixLabel = plan.scope === "frontend" ? "eslint --fix" : "ts-fix";
    console.log(
      `${label}: pre-LLM ${autoFixLabel} (${plan.scope}) running: ${autoFixCommand}`,
    );
    const fixResult = await shellExec(autoFixCommand, plan.cwd, {
      timeout: 120_000,
    });
    autoFixNotes.push(
      `${plan.scope}: ${autoFixLabel} exit=${fixResult.exitCode}`,
    );

    const checkResult = await shellExec(plan.tscCommand, plan.cwd, {
      timeout: 120_000,
    });
    const checkOutput = `${checkResult.stdout}${checkResult.stderr}`.trim();
    if (checkResult.exitCode !== 0 && checkOutput.includes("error TS")) {
      autoFixAllPassed = false;
      autoFixNotes.push(
        `${plan.scope}: remaining tsc errors after ${autoFixLabel}:\n${checkOutput.slice(0, 1200)}`,
      );
    } else {
      autoFixNotes.push(`${plan.scope}: tsc passed after ${autoFixLabel}`);
    }
  }

  if (tsFixPlans.length > 0 && autoFixAllPassed) {
    console.log(`${label}: pre-LLM auto-fix fully resolved errors.`);
    return {
      scaffoldErrors: "",
      scaffoldFixAttempts: 0,
      totalCostUsd: 0,
    };
  }

  const systemPrompt = [
    "You are a Senior Engineer. Your job: verify the generated codebase compiles cleanly and fix ALL errors.",
    "",
    "## Workflow (follow in order)",
    `1. Run: \`${installCmd}\`  — install all dependencies`,
    "2. ORM handling:",
    "   - This generator standardises on Sequelize for SQL persistence. Do NOT introduce Prisma (`@prisma/client`, `prisma` CLI, or `prisma/schema.prisma`). If prior runs left Prisma artefacts behind, delete them and rewrite the persistence layer with Sequelize models in `backend/src/models/` and migrations in `backend/src/database/migrations/`.",
    "   - If a legacy `prisma/schema.prisma` still exists from an older run, `npx prisma generate` may run automatically as a compatibility fallback — but the correct fix is to remove the Prisma schema and replace it with equivalent Sequelize definitions, not to keep it.",
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

  const autoFixHints =
    autoFixNotes.length > 0
      ? `\n## Pre-LLM auto-fix report\n${autoFixNotes.join("\n")}\n`
      : "";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Project directory: ${state.outputDir}\nPackage manager: ${pm}${workerHints}${autoFixHints}\nBegin verification and fix now.`,
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
    const COMPACT_THRESHOLD = 20_000 * 4; // ~20k tokens in chars
    const KEEP_TAIL = 6; // keep last N messages after system prompt
    const totalChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
      0,
    );
    if (totalChars < COMPACT_THRESHOLD) return;

    const systemMsg = messages[0];
    const desiredStart = Math.max(1, messages.length - KEEP_TAIL);
    const tailStart = calculateSafeTailStart(messages, desiredStart);
    const tail = messages.slice(tailStart);
    const middle = messages.slice(1, tailStart);

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
    const removed = countRemovedOrphanToolMessages(messages);
    console.log(
      `${label}: context compacted — removed ${middle.length} messages (was ~${Math.round(totalChars / 4)} tokens), orphan_tools_removed=${removed}`,
    );
  }

  while (iterations < MAX_ITER) {
    iterations++;
    console.log(`${label}: iteration ${iterations}/${MAX_ITER}`);

    // Compact context if growing too large
    compactMessagesIfNeeded();

    let resp;
    try {
      resp = await callWithOrphanToolRetry(label, messages, modelChain, {
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
    recordSupervisorLlmUsage({
      sessionId: state.sessionId,
      stage: "phase_verify_fix",
      model: resp.model,
      usage: resp.usage,
      costUsd: estimateCost(resp.model, resp.usage),
    });

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

interface ImportGapInstallRecord {
  scope: string;
  packages: string[];
  exitCode: number;
}

async function installImportGapsAllProjects(
  outputDir: string,
): Promise<ImportGapInstallRecord[]> {
  await runNpmInstallAllRoots(outputDir);

  const records: ImportGapInstallRecord[] = [];
  const pm = await detectPackageManager(outputDir);
  const repoFallbackPm = await inferRepoPackageManager(outputDir);
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
    records.push({
      scope: "root",
      packages: rootMissing,
      exitCode: r.exitCode,
    });
  }

  for (const rel of nested) {
    const missing = await collectMissingImportPackagesForPrefix(outputDir, rel);
    if (missing.length === 0) continue;
    console.log(
      `[Supervisor] Integration verify: "${rel}" add (${missing.length}): ${missing.join(", ")}`,
    );

    let r;
    const relPm = await resolvePackageManagerForDir(
      rel,
      outputDir,
      repoFallbackPm,
    );
    if (relPm === "pnpm") {
      // For pnpm workspaces, add packages via --filter from root
      const cwd = path.join(outputDir, rel);
      const cmd = buildAddCommand("pnpm", missing);
      r = await shellExec(cmd, cwd, {
        timeout: VERIFY_IMPORT_INSTALL_TIMEOUT_MS,
      });
    } else {
      const cwd = path.join(outputDir, rel);
      const cmd = buildAddCommand(relPm, missing);
      r = await shellExec(cmd, cwd, {
        timeout: VERIFY_IMPORT_INSTALL_TIMEOUT_MS,
      });
    }

    if (r.exitCode !== 0) {
      console.warn(
        `[Supervisor] Integration verify: "${rel}" add exit ${r.exitCode}: ${(r.stderr || r.stdout).slice(0, 300)}`,
      );
    }
    records.push({ scope: rel, packages: missing, exitCode: r.exitCode });
  }
  return records;
}

interface DependencyConsistencyAudit {
  remainingIssues: string[];
  summary: string;
}

async function auditImportDependencyConsistency(
  outputDir: string,
): Promise<DependencyConsistencyAudit> {
  const dirs = await findPackageJsonRelativeDirs(outputDir);
  const nested = dirs.filter((d) => d !== ".");
  const issues: string[] = [];

  const rootMissing = await collectMissingImportPackages(outputDir, nested);
  if (rootMissing.length > 0) {
    issues.push(
      `Root package imports are missing dependencies: ${rootMissing.join(", ")}`,
    );
  }

  for (const rel of nested) {
    const missing = await collectMissingImportPackagesForPrefix(outputDir, rel);
    if (missing.length > 0) {
      issues.push(
        `"${rel}" imports are missing dependencies: ${missing.join(", ")}`,
      );
    }
  }

  return {
    remainingIssues: issues,
    summary:
      issues.length > 0
        ? [
            "Dependency consistency audit still has unresolved items:",
            ...issues,
          ]
            .join("\n")
            .slice(0, 4000)
        : "Dependency consistency audit: clean.",
  };
}

async function pathExistsUnderOutput(
  outputDir: string,
  relPath: string,
): Promise<boolean> {
  try {
    await fs.stat(path.join(outputDir, relPath));
    return true;
  } catch {
    return false;
  }
}

async function detectResidualImplementationConflicts(
  outputDir: string,
): Promise<string[]> {
  const conflicts: string[] = [];
  const candidatePairs = [
    {
      canonical: "frontend/src/contexts/AuthContext.tsx",
      residual: "frontend/src/context/AuthContext.tsx",
    },
    {
      canonical: "backend/src/middleware/",
      residual: "backend/src/middlewares/",
    },
    {
      canonical: "backend/src/db.ts",
      residual: "backend/src/database/connection.ts",
    },
    {
      canonical: "backend/src/db.ts",
      residual: "backend/src/config/database.ts",
    },
    {
      canonical: "frontend/src/views/NotFoundPage.tsx",
      residual: "frontend/src/views/NotFound.tsx",
    },
  ];

  for (const pair of candidatePairs) {
    const canonicalExists = await pathExistsUnderOutput(
      outputDir,
      pair.canonical,
    );
    const residualExists = await pathExistsUnderOutput(
      outputDir,
      pair.residual,
    );
    if (canonicalExists && residualExists) {
      conflicts.push(
        `Both "${pair.canonical}" and "${pair.residual}" exist. Keep one canonical implementation and remove or merge the residual copy.`,
      );
    }
  }

  return conflicts;
}

interface FrontendNormalizationResult {
  changedFiles: string[];
  notes: string[];
}

interface FrontendConvergenceCluster {
  key: string;
  title: string;
  description: string;
  files: string[];
}

async function normalizeFrontendHookSignatures(
  outputDir: string,
): Promise<FrontendNormalizationResult> {
  const changedFiles: string[] = [];
  const notes: string[] = [];
  const sourceRoots = ["frontend/src", "apps/web/src"];

  for (const root of sourceRoots) {
    let files: string[] = [];
    try {
      files = (await listFiles(root, outputDir)).filter((file) =>
        /\.(ts|tsx)$/.test(file),
      );
    } catch {
      continue;
    }

    for (const relPath of files) {
      const content = await fsRead(relPath, outputDir);
      if (
        content.startsWith("FILE_NOT_FOUND") ||
        content.startsWith("REJECTED")
      ) {
        continue;
      }

      let updated = content;
      updated = updated.replace(
        /useEffect\(\(\):\s*void\s*=>/g,
        "useEffect(() =>",
      );
      updated = updated.replace(
        /useLayoutEffect\(\(\):\s*void\s*=>/g,
        "useLayoutEffect(() =>",
      );

      if (updated !== content) {
        await fsWrite(relPath, updated, outputDir);
        changedFiles.push(relPath);
      }
    }
  }

  if (changedFiles.length > 0) {
    notes.push(
      `Frontend hook signature normalizer updated ${changedFiles.length} file(s): ${changedFiles.slice(0, 8).join(", ")}${changedFiles.length > 8 ? " ..." : ""}`,
    );
  }

  return { changedFiles, notes };
}

async function normalizeFrontendJsxElementAnnotations(
  outputDir: string,
): Promise<FrontendNormalizationResult> {
  const changedFiles: string[] = [];
  const notes: string[] = [];
  const sourceRoots = ["frontend/src", "apps/web/src"];

  for (const root of sourceRoots) {
    let files: string[] = [];
    try {
      files = (await listFiles(root, outputDir)).filter((file) =>
        /\.(ts|tsx)$/.test(file),
      );
    } catch {
      continue;
    }

    for (const relPath of files) {
      const content = await fsRead(relPath, outputDir);
      if (
        content.startsWith("FILE_NOT_FOUND") ||
        content.startsWith("REJECTED")
      ) {
        continue;
      }

      const updated = content.replace(
        /(?<!React\.)\bJSX\.Element\b/g,
        "React.JSX.Element",
      );

      if (updated !== content) {
        await fsWrite(relPath, updated, outputDir);
        changedFiles.push(relPath);
      }
    }
  }

  if (changedFiles.length > 0) {
    notes.push(
      `Frontend JSX return-type normalizer updated ${changedFiles.length} file(s): ${changedFiles.slice(0, 8).join(", ")}${changedFiles.length > 8 ? " ..." : ""}`,
    );
  }

  return { changedFiles, notes };
}

async function normalizeFrontendReactComponentTemplates(
  outputDir: string,
): Promise<FrontendNormalizationResult> {
  const changedFiles: string[] = [];
  const notes: string[] = [];
  const sourceRoots = ["frontend/src", "apps/web/src"];

  for (const root of sourceRoots) {
    let files: string[] = [];
    try {
      files = (await listFiles(root, outputDir)).filter((file) =>
        /\.tsx$/.test(file),
      );
    } catch {
      continue;
    }

    for (const relPath of files) {
      const content = await fsRead(relPath, outputDir);
      if (
        content.startsWith("FILE_NOT_FOUND") ||
        content.startsWith("REJECTED")
      ) {
        continue;
      }

      let updated = content;
      updated = updated.replace(/\)\s*:\s*React\.JSX\.Element\s*\{/g, ") {");
      updated = updated.replace(/\)\s*:\s*JSX\.Element\s*\{/g, ") {");
      updated = updated.replace(/\)\s*:\s*React\.JSX\.Element\s*=>/g, ") =>");
      updated = updated.replace(/\)\s*:\s*JSX\.Element\s*=>/g, ") =>");

      if (!updated.includes("React.")) {
        updated = updated.replace(
          /^import React,\s*\{([^}]*)\}\s*from\s*["']react["'];?\n?/m,
          (_match, imports: string) =>
            imports.trim().length > 0
              ? `import {${imports}} from "react";\n`
              : "",
        );
        updated = updated.replace(/^import React from ["']react["'];?\n?/m, "");
      }

      if (updated !== content) {
        await fsWrite(relPath, updated, outputDir);
        changedFiles.push(relPath);
      }
    }
  }

  if (changedFiles.length > 0) {
    notes.push(
      `Frontend React component-template normalizer updated ${changedFiles.length} file(s): ${changedFiles.slice(0, 8).join(", ")}${changedFiles.length > 8 ? " ..." : ""}`,
    );
  }

  return { changedFiles, notes };
}

async function normalizeFrontendAuthDtoAliases(
  outputDir: string,
): Promise<FrontendNormalizationResult> {
  const changedFiles: string[] = [];
  const notes: string[] = [];
  const candidatePaths = [
    "frontend/src/types/api.ts",
    "apps/web/src/types/api.ts",
  ];

  for (const relPath of candidatePaths) {
    const content = await fsRead(relPath, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }

    if (
      !content.includes("export type MeResponseDto = User;") &&
      !content.includes("export type UpdateMeResponseDto = User;")
    ) {
      continue;
    }

    let updated = content;
    const authUserDtoBlock = `export type AuthUserDto = Pick<User, "id" | "name" | "email" | "avatar" | "timezone"> &\n  Partial<Pick<User, "notificationPreferences" | "createdAt" | "updatedAt">>;\n\n`;
    if (!updated.includes("export type AuthUserDto =")) {
      if (updated.includes("export interface AuthResponseDto {")) {
        updated = updated.replace(
          "export interface AuthResponseDto {\n",
          `${authUserDtoBlock}export interface AuthResponseDto {\n`,
        );
      } else {
        updated = `${authUserDtoBlock}${updated}`;
      }
    }
    updated = updated.replace(
      /user:\s*Pick<User,\s*"id"\s*\|\s*"name"\s*\|\s*"email"\s*\|\s*"avatar"\s*\|\s*"timezone">;/g,
      "user: AuthUserDto;",
    );
    updated = updated.replace(
      "export type MeResponseDto = User;",
      "export type MeResponseDto = AuthUserDto;",
    );
    updated = updated.replace(
      "export type UpdateMeResponseDto = User;",
      "export type UpdateMeResponseDto = AuthUserDto;",
    );

    if (updated !== content) {
      await fsWrite(relPath, updated, outputDir);
      changedFiles.push(relPath);
    }
  }

  if (changedFiles.length > 0) {
    notes.push(
      `Frontend auth DTO normalizer updated ${changedFiles.length} file(s): ${changedFiles.join(", ")}`,
    );
  }

  return { changedFiles, notes };
}

async function normalizeFrontendUseFormHook(
  outputDir: string,
): Promise<FrontendNormalizationResult> {
  const changedFiles: string[] = [];
  const notes: string[] = [];
  const candidatePaths = [
    "frontend/src/hooks/useForm.ts",
    "apps/web/src/hooks/useForm.ts",
  ];

  for (const relPath of candidatePaths) {
    const content = await fsRead(relPath, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }

    let updated = content;
    updated = updated.replace(
      "type FormValues = Record<string, string>;",
      "type FormValues = Record<string, unknown>;",
    );
    updated = updated.replace(
      "const maybeError: string | undefined = validator(values[key], values);",
      'const maybeError: string | undefined = validator(String(values[key] ?? ""), values);',
    );
    updated = updated.replace(
      "const message: string | undefined = validator(values[field], values);",
      'const message: string | undefined = validator(String(values[field] ?? ""), values);',
    );

    if (updated !== content) {
      await fsWrite(relPath, updated, outputDir);
      changedFiles.push(relPath);
    }
  }

  if (changedFiles.length > 0) {
    notes.push(
      `Frontend form-hook normalizer updated ${changedFiles.length} file(s): ${changedFiles.join(", ")}`,
    );
  }

  return { changedFiles, notes };
}

/**
 * Frontend duplicate-apiClient convergence.
 *
 * The scaffold ships exactly one canonical client at
 * `frontend/src/api/client.ts`. LLM-generated code repeatedly creates a
 * second one at `frontend/src/utils/apiClient.ts` (or `utils/api.ts` /
 * `lib/http.ts`), then half the feature files import from each — driving
 * the "frontend shared API surface mismatch" cluster that stalls
 * `integration_verify_fix` for many iterations.
 *
 * This normalizer:
 *   1. Detects parallel client files in known anti-pattern locations.
 *   2. Rewrites imports of those parallel clients to point at the
 *      canonical `@/api/client` (or relative equivalent).
 *   3. Deletes the parallel client file once no consumer references it.
 */
async function normalizeFrontendDuplicateApiClient(
  outputDir: string,
): Promise<FrontendNormalizationResult> {
  const changedFiles: string[] = [];
  const notes: string[] = [];

  const canonicalCandidates = [
    "frontend/src/api/client.ts",
    "apps/web/src/api/client.ts",
  ];
  let canonicalRoot: string | null = null;
  for (const candidate of canonicalCandidates) {
    const content = await fsRead(candidate, outputDir);
    if (
      !content.startsWith("FILE_NOT_FOUND") &&
      !content.startsWith("REJECTED") &&
      /export\s+(?:const|function)\s+apiClient\b/.test(content)
    ) {
      canonicalRoot = candidate.startsWith("apps/web/")
        ? "apps/web/src"
        : "frontend/src";
      break;
    }
  }
  if (!canonicalRoot) {
    return { changedFiles, notes };
  }

  const parallelRelPaths = [
    `${canonicalRoot}/utils/apiClient.ts`,
    `${canonicalRoot}/utils/api.ts`,
    `${canonicalRoot}/utils/http.ts`,
    `${canonicalRoot}/lib/http.ts`,
    `${canonicalRoot}/lib/apiClient.ts`,
    `${canonicalRoot}/services/http.ts`,
    `${canonicalRoot}/services/apiClient.ts`,
  ];
  const parallels: string[] = [];
  for (const relPath of parallelRelPaths) {
    const content = await fsRead(relPath, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    if (
      /export\s+(?:const|class|function|default)\s+\w*[Aa]pi\w*/.test(content)
    ) {
      parallels.push(relPath);
    }
  }
  if (parallels.length === 0) {
    return { changedFiles, notes };
  }

  // Rewrite imports across the entire frontend tree.
  const sourceFiles = (await listFiles(canonicalRoot, outputDir)).filter(
    (file) => /\.(ts|tsx)$/.test(file),
  );

  const importRewrites: Array<{ from: RegExp; to: string }> = [
    // Examples we want to neutralise:
    //   import { apiClient } from "../utils/apiClient";
    //   import { ApiClient } from "@/utils/apiClient";
    //   import apiClient from "../../utils/apiClient";
    {
      from: /from\s+["'](?:\.{1,2}\/)+utils\/apiClient["']/g,
      to: 'from "../api/client"',
    },
    {
      from: /from\s+["'](?:\.{1,2}\/)+utils\/api["']/g,
      to: 'from "../api/client"',
    },
    {
      from: /from\s+["']@\/utils\/apiClient["']/g,
      to: 'from "@/api/client"',
    },
    {
      from: /from\s+["']@\/utils\/api["']/g,
      to: 'from "@/api/client"',
    },
    {
      from: /from\s+["'](?:\.{1,2}\/)+lib\/http["']/g,
      to: 'from "../api/client"',
    },
    {
      from: /from\s+["']@\/lib\/http["']/g,
      to: 'from "@/api/client"',
    },
    {
      from: /from\s+["'](?:\.{1,2}\/)+services\/http["']/g,
      to: 'from "../api/client"',
    },
  ];

  for (const relPath of sourceFiles) {
    if (parallels.includes(relPath)) continue;
    const content = await fsRead(relPath, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    let updated = content;
    for (const rule of importRewrites) {
      updated = updated.replace(rule.from, rule.to);
    }
    if (updated !== content) {
      await fsWrite(relPath, updated, outputDir);
      changedFiles.push(relPath);
    }
  }

  // Replace each parallel client with a thin re-export so any stale import
  // we did not rewrite still resolves to the canonical instance instead of
  // diverging behaviour.
  for (const parallel of parallels) {
    const reexport = `// Auto-converged by AgenticBuilder preflight normalizer.\n// This file used to define a parallel HTTP client. The canonical client\n// lives at \`frontend/src/api/client.ts\` (re-exported via \`@/api/client\`).\nexport * from "../api/client";\n`;
    await fsWrite(parallel, reexport, outputDir);
    changedFiles.push(parallel);
  }

  if (changedFiles.length > 0) {
    notes.push(
      `Frontend duplicate-apiClient normalizer collapsed ${parallels.length} parallel client(s) and rewrote ${changedFiles.length - parallels.length} consumer import(s).`,
    );
  }

  return { changedFiles, notes };
}

interface BackendMiddlewareFolderResult {
  /** Source files moved from `middleware/` to `middlewares/`. */
  movedFiles: string[];
  /** Source files dropped (because the canonical version already existed). */
  droppedFiles: string[];
  /** Files whose imports were rewritten. */
  rewrittenImports: string[];
  notes: string[];
}

/**
 * Backend middleware-folder normalizer.
 *
 * Koa convention in the M-tier scaffold is `backend/src/middlewares` (plural).
 * Workers occasionally emit `backend/src/middleware/*.ts` (singular) which
 * leaves the project with two parallel directories — half the imports point
 * to the canonical folder and half to the singular one, producing dozens of
 * `Cannot find module` errors that the LLM then tries (and usually fails) to
 * untangle by hand. This normalizer:
 *
 *   1. Moves every `backend/src/middleware/*.ts` file into
 *      `backend/src/middlewares/` (preferring the canonical version when both
 *      exist).
 *   2. Rewrites every import of `.../middleware/<name>` (relative or alias)
 *      across the backend source tree to `.../middlewares/<name>`.
 *   3. Removes the now-empty singular folder so the audit cannot regress.
 */
async function normalizeBackendMiddlewareFolder(
  outputDir: string,
): Promise<BackendMiddlewareFolderResult> {
  const result: BackendMiddlewareFolderResult = {
    movedFiles: [],
    droppedFiles: [],
    rewrittenImports: [],
    notes: [],
  };

  const singularRoot = "backend/src/middleware";
  const pluralRoot = "backend/src/middlewares";

  const singularDirAbs = path.join(outputDir, singularRoot);
  let singularEntries: string[] = [];
  try {
    const stat = await fs.stat(singularDirAbs);
    if (!stat.isDirectory()) return result;
    singularEntries = (
      await fs.readdir(singularDirAbs, { withFileTypes: true })
    )
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return result;
  }

  if (singularEntries.length === 0) {
    try {
      await fs.rmdir(singularDirAbs);
    } catch {
      // ignore — directory may not be empty for unrelated reasons.
    }
    return result;
  }

  await fs.mkdir(path.join(outputDir, pluralRoot), { recursive: true });

  for (const fileName of singularEntries) {
    const singularRel = `${singularRoot}/${fileName}`;
    const pluralRel = `${pluralRoot}/${fileName}`;
    const singularContent = await fsRead(singularRel, outputDir);
    if (
      singularContent.startsWith("FILE_NOT_FOUND") ||
      singularContent.startsWith("REJECTED")
    ) {
      continue;
    }

    const existingPlural = await fsRead(pluralRel, outputDir);
    const pluralExists =
      !existingPlural.startsWith("FILE_NOT_FOUND") &&
      !existingPlural.startsWith("REJECTED");

    if (pluralExists) {
      result.droppedFiles.push(singularRel);
    } else {
      await fsWrite(pluralRel, singularContent, outputDir);
      result.movedFiles.push(singularRel);
    }

    try {
      await fs.unlink(path.join(outputDir, singularRel));
    } catch {
      // best-effort delete; downstream import rewrite still helps
    }
  }

  // Rewrite imports across the backend source tree.
  const backendFiles = (await listFiles("backend/src", outputDir)).filter(
    (file) => /\.(ts|tsx)$/.test(file),
  );
  const rewriteRules: Array<{ from: RegExp; to: string }> = [
    {
      from: /(from\s+["'])((?:\.{1,2}\/)+)middleware\//g,
      to: "$1$2middlewares/",
    },
    {
      from: /(from\s+["'])@\/middleware\//g,
      to: "$1@/middlewares/",
    },
    {
      from: /(import\s*\(\s*["'])((?:\.{1,2}\/)+)middleware\//g,
      to: "$1$2middlewares/",
    },
    {
      from: /(import\s*\(\s*["'])@\/middleware\//g,
      to: "$1@/middlewares/",
    },
  ];

  for (const relPath of backendFiles) {
    const content = await fsRead(relPath, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    let updated = content;
    for (const rule of rewriteRules) {
      updated = updated.replace(rule.from, rule.to);
    }
    if (updated !== content) {
      await fsWrite(relPath, updated, outputDir);
      result.rewrittenImports.push(relPath);
    }
  }

  // Try to remove the now-empty singular dir so subsequent audits do not
  // re-flag a residual empty folder.
  try {
    const remaining = await fs.readdir(singularDirAbs);
    if (remaining.length === 0) {
      await fs.rmdir(singularDirAbs);
    }
  } catch {
    // ignore
  }

  if (
    result.movedFiles.length > 0 ||
    result.droppedFiles.length > 0 ||
    result.rewrittenImports.length > 0
  ) {
    result.notes.push(
      `Backend middleware-folder normalizer moved ${result.movedFiles.length} file(s), dropped ${result.droppedFiles.length} duplicate(s), and rewrote imports in ${result.rewrittenImports.length} file(s).`,
    );
  }

  return result;
}

interface FrontendApiClientUniquenessResult {
  /** Canonical client path detected (or null when scaffold is missing). */
  canonical: string | null;
  /** Parallel apiClient files that survived the preflight normalizer. */
  parallelClients: string[];
  /** Human-readable findings for the LLM prompt / repair log. */
  findings: string[];
}

/**
 * Hard-fail audit: there must be exactly ONE HTTP client in the frontend
 * after preflight runs. The preflight normalizer collapses duplicates by
 * rewriting the parallel file to a re-export — this audit treats anything
 * that *defines* a new fetch wrapper, axios instance, or class with the
 * `Api` substring under `utils/`, `lib/`, or `services/` as a regression.
 *
 * Wired as a hard-fail at the final integration gate so coding sessions
 * cannot ship two clients silently again.
 */
async function auditFrontendApiClientUniqueness(
  outputDir: string,
): Promise<FrontendApiClientUniquenessResult> {
  const empty: FrontendApiClientUniquenessResult = {
    canonical: null,
    parallelClients: [],
    findings: [],
  };

  const canonicalCandidates = [
    "frontend/src/api/client.ts",
    "apps/web/src/api/client.ts",
  ];
  let canonical: string | null = null;
  for (const candidate of canonicalCandidates) {
    const content = await fsRead(candidate, outputDir);
    if (
      !content.startsWith("FILE_NOT_FOUND") &&
      !content.startsWith("REJECTED") &&
      /export\s+(?:const|function)\s+apiClient\b/.test(content)
    ) {
      canonical = candidate;
      break;
    }
  }
  if (!canonical) return empty;

  const root = canonical.startsWith("apps/web/")
    ? "apps/web/src"
    : "frontend/src";
  const suspectPaths = [
    `${root}/utils/apiClient.ts`,
    `${root}/utils/api.ts`,
    `${root}/utils/http.ts`,
    `${root}/lib/http.ts`,
    `${root}/lib/apiClient.ts`,
    `${root}/services/http.ts`,
    `${root}/services/apiClient.ts`,
  ];

  const parallelClients: string[] = [];
  for (const rel of suspectPaths) {
    const content = await fsRead(rel, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    // After preflight, the parallel file should be a thin re-export. Anything
    // that still declares its own `apiClient`/`ApiClient` class/const, or
    // creates an axios/fetch instance, is a real divergence.
    const reexportOnly =
      /export\s+\*\s+from\s+["']\.\.\/api\/client["']/.test(content) &&
      !/export\s+(?:const|class|function|default)\s+\w*[Aa]pi\w*/.test(
        content.replace(
          /export\s+\*\s+from\s+["']\.\.\/api\/client["'];?\s*\n?/g,
          "",
        ),
      );
    if (reexportOnly) continue;
    if (
      /export\s+(?:const|class|function|default)\s+\w*[Aa]pi\w*/.test(
        content,
      ) ||
      /axios\.create\s*\(/.test(content) ||
      /class\s+\w*[Aa]pi\w*Client\b/.test(content)
    ) {
      parallelClients.push(rel);
    }
  }

  const findings: string[] = [];
  if (parallelClients.length > 0) {
    findings.push(
      "## Frontend API client uniqueness violation",
      `Canonical client: ${canonical}`,
      "Parallel HTTP client(s) still defining their own \`apiClient\` / \`axios.create\` / \`ApiClient\` class:",
      ...parallelClients.map((p) => `- ${p}`),
      'Resolution: delete or convert these files to \`export * from "../api/client"\` and update every consumer to import from the canonical path.',
    );
  }

  return {
    canonical,
    parallelClients,
    findings,
  };
}

/**
 * Backend GET-with-validateBody normalizer.
 *
 * `validateBody` is a body-validation middleware; LLMs sometimes attach it
 * to `apiRouter.get(...)` calls, which produces both a TypeScript noise
 * (the controller signature is wrong) and a runtime semantics bug (a
 * GET handler should not validate a JSON body). We strip the
 * `validateBody(...)` argument so the route at least compiles and the
 * route audit can re-evaluate; the LLM is still expected to pick a real
 * handler name afterwards.
 */
async function normalizeBackendGetValidateBody(
  outputDir: string,
): Promise<FrontendNormalizationResult> {
  const changedFiles: string[] = [];
  const notes: string[] = [];
  const routesRoot = "backend/src/api/modules";
  let files: string[];
  try {
    files = (await listFiles(routesRoot, outputDir)).filter((file) =>
      file.endsWith(".routes.ts"),
    );
  } catch {
    return { changedFiles, notes };
  }

  // Match `apiRouter.get( "<path>" , validateBody(<args>), <rest...> )` over
  // multiple lines and remove the validateBody segment. Also catch sub-router
  // form `router.get(...)` for completeness.
  const getCallRe =
    /\b((?:api)?[Rr]outer)\.get\s*\(\s*((?:[^()"'`]|"[^"]*"|'[^']*'|`[^`]*`|\([^()]*\))+)\)/g;
  const validateBodyArgRe = /\bvalidateBody\s*\([^()]*\)\s*,\s*/g;

  for (const rel of files) {
    const content = await fsRead(rel, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    let mutated = false;
    const updated = content.replace(getCallRe, (match, prefix, args) => {
      if (!/\bvalidateBody\s*\(/.test(args)) return match;
      const cleanedArgs = String(args).replace(validateBodyArgRe, "");
      mutated = true;
      return `${prefix}.get(${cleanedArgs})`;
    });
    if (mutated && updated !== content) {
      await fsWrite(rel, updated, outputDir);
      changedFiles.push(rel);
    }
  }

  if (changedFiles.length > 0) {
    notes.push(
      `Backend GET-route normalizer stripped \`validateBody(...)\` from ${changedFiles.length} file(s): ${changedFiles.slice(0, 6).join(", ")}${changedFiles.length > 6 ? " ..." : ""}`,
    );
  }

  return { changedFiles, notes };
}

/**
 * `Error(message, e)` → `Error(message, { cause: e })` rewrite.
 *
 * The two-arg `Error(message, cause)` signature is invalid TypeScript and
 * fires `TS2554`/`TS2345` across multiple frontend files in every recent
 * generation. The fix is mechanical: detect `throw new Error(<msg>, <ident>)`
 * patterns where the second arg is a plain identifier (typical catch-binding)
 * and convert it to the `{ cause: ident }` options form.
 */
async function normalizeFrontendErrorWithCause(
  outputDir: string,
): Promise<FrontendNormalizationResult> {
  const changedFiles: string[] = [];
  const notes: string[] = [];
  const sourceRoots = ["frontend/src", "apps/web/src"];

  const pattern =
    /throw\s+new\s+Error\s*\(\s*([^,()]+?)\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;

  for (const root of sourceRoots) {
    let files: string[] = [];
    try {
      files = (await listFiles(root, outputDir)).filter((file) =>
        /\.(ts|tsx)$/.test(file),
      );
    } catch {
      continue;
    }
    for (const rel of files) {
      const content = await fsRead(rel, outputDir);
      if (
        content.startsWith("FILE_NOT_FOUND") ||
        content.startsWith("REJECTED")
      ) {
        continue;
      }
      const updated = content.replace(
        pattern,
        (_m, msg: string, ident: string) =>
          `throw new Error(${msg.trim()}, { cause: ${ident} })`,
      );
      if (updated !== content) {
        await fsWrite(rel, updated, outputDir);
        changedFiles.push(rel);
      }
    }
  }

  if (changedFiles.length > 0) {
    notes.push(
      `Frontend Error(cause) normalizer rewrote ${changedFiles.length} file(s): ${changedFiles.slice(0, 8).join(", ")}${changedFiles.length > 8 ? " ..." : ""}`,
    );
  }

  return { changedFiles, notes };
}

async function detectFrontendConvergenceClusters(
  outputDir: string,
): Promise<FrontendConvergenceCluster[]> {
  const clusters: FrontendConvergenceCluster[] = [];
  const sourceRoots = ["frontend/src", "apps/web/src"];
  const frontendFiles = (
    await Promise.all(
      sourceRoots.map(async (root) => {
        try {
          return await listFiles(root, outputDir);
        } catch {
          return [];
        }
      }),
    )
  ).flat();

  const hookSignatureFiles: string[] = [];
  for (const relPath of frontendFiles.filter((file) =>
    /\.(ts|tsx)$/.test(file),
  )) {
    const content = await fsRead(relPath, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    if (
      content.includes("useEffect((): void =>") ||
      content.includes("useLayoutEffect((): void =>")
    ) {
      hookSignatureFiles.push(relPath);
    }
  }
  if (hookSignatureFiles.length > 0) {
    clusters.push({
      key: "hook_signature",
      title: "React hook callback signature mismatch",
      description:
        "Some React hook callbacks are annotated with explicit `: void` return types even though they return cleanup functions. Normalize the hook callback signature before fixing per-file logic.",
      files: hookSignatureFiles.slice(0, 12),
    });
  }

  const jsxAnnotationFiles: string[] = [];
  for (const relPath of frontendFiles.filter((file) =>
    /\.(ts|tsx)$/.test(file),
  )) {
    const content = await fsRead(relPath, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    if (/(?<!React\.)\bJSX\.Element\b/.test(content)) {
      jsxAnnotationFiles.push(relPath);
    }
  }
  if (jsxAnnotationFiles.length > 0) {
    clusters.push({
      key: "jsx_namespace_annotation",
      title: "React JSX namespace annotation mismatch",
      description:
        "Generated frontend files still use bare `JSX.Element` return types. Normalize this shared pattern across the cluster by preferring inferred return types or rewriting to `React.JSX.Element` consistently.",
      files: jsxAnnotationFiles.slice(0, 12),
    });
  }

  const reactTemplateResidualFiles: string[] = [];
  for (const relPath of frontendFiles.filter((file) => /\.tsx$/.test(file))) {
    const content = await fsRead(relPath, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    if (
      /^import React from ["']react["'];?$/m.test(content) ||
      /^import React,\s*\{[^}]+\}\s*from ["']react["'];?$/m.test(content) ||
      /\)\s*:\s*React\.JSX\.Element\s*(\{|=>)/.test(content)
    ) {
      reactTemplateResidualFiles.push(relPath);
    }
  }
  if (reactTemplateResidualFiles.length > 0) {
    clusters.push({
      key: "react_component_template_residuals",
      title: "React component template residuals",
      description:
        "Some frontend files still carry template-style explicit component return types or default `React` imports that are no longer needed under the current JSX runtime. Normalize the shared template first, then fix any remaining leaf-file typing issues.",
      files: reactTemplateResidualFiles.slice(0, 12),
    });
  }

  const useFormCandidates = await Promise.all(
    ["frontend/src/hooks/useForm.ts", "apps/web/src/hooks/useForm.ts"].map(
      async (filePath) => ({
        filePath,
        content: await fsRead(filePath, outputDir),
      }),
    ),
  );
  const useFormCandidate = useFormCandidates.find(
    (entry) =>
      !entry.content.startsWith("FILE_NOT_FOUND") &&
      !entry.content.startsWith("REJECTED"),
  );
  if (
    useFormCandidate &&
    useFormCandidate.content.includes(
      "type FormValues = Record<string, string>;",
    )
  ) {
    const formConsumerFiles: string[] = [];
    for (const relPath of frontendFiles.filter((file) =>
      /\.(ts|tsx)$/.test(file),
    )) {
      const content = await fsRead(relPath, outputDir);
      if (
        content.startsWith("FILE_NOT_FOUND") ||
        content.startsWith("REJECTED")
      ) {
        continue;
      }
      if (/useForm<\w+>/.test(content)) {
        formConsumerFiles.push(relPath);
      }
    }
    clusters.push({
      key: "form_hook_compatibility",
      title: "Form hook generic incompatibility",
      description:
        "The shared `useForm` hook is narrower than the generated page form interfaces. Repair the hook abstraction first so page-level form interfaces no longer need index signatures.",
      files: [useFormCandidate.filePath, ...formConsumerFiles.slice(0, 8)],
    });
  }

  const modelsPath = useFormCandidate?.filePath.startsWith("apps/web/")
    ? "apps/web/src/types/models.ts"
    : "frontend/src/types/models.ts";
  const projectMembersPath = useFormCandidate?.filePath.startsWith("apps/web/")
    ? "apps/web/src/components/Projects/ProjectMembersList.tsx"
    : "frontend/src/components/Projects/ProjectMembersList.tsx";
  const apiTypesPath = useFormCandidate?.filePath.startsWith("apps/web/")
    ? "apps/web/src/types/api.ts"
    : "frontend/src/types/api.ts";
  const modelsContent = await fsRead(modelsPath, outputDir);
  const projectMembersContent = await fsRead(projectMembersPath, outputDir);
  const apiTypesContent = await fsRead(apiTypesPath, outputDir);
  if (
    !apiTypesContent.startsWith("FILE_NOT_FOUND") &&
    (/export type MeResponseDto = User;/.test(apiTypesContent) ||
      /export type UpdateMeResponseDto = User;/.test(apiTypesContent))
  ) {
    clusters.push({
      key: "auth_dto_alias_leakage",
      title: "Auth DTO aliases leak model-only fields",
      description:
        "Frontend auth/session DTOs are aliased directly to `User`, which leaks persistence-model unions into UI and auth flows. Replace those aliases with a dedicated auth DTO shape and update all consuming types consistently.",
      files: [apiTypesPath, modelsPath],
    });
  }
  if (
    !modelsContent.startsWith("FILE_NOT_FOUND") &&
    !projectMembersContent.startsWith("FILE_NOT_FOUND") &&
    modelsContent.includes("user?: ProjectMemberUserRef;") &&
    /\.user\./.test(projectMembersContent)
  ) {
    clusters.push({
      key: "dto_ui_consistency",
      title: "DTO / UI optionality mismatch",
      description:
        "Frontend DTOs mark project member `user` as optional, but the consuming UI dereferences it as required. Decide whether the DTO should be required or the UI must guard against missing relations, then fix the cluster consistently.",
      files: [modelsPath, apiTypesPath, projectMembersPath],
    });
  }

  return clusters;
}

async function syncDeps(_state: SupervisorState) {
  console.log(
    "[Supervisor] sync_deps: skipping installs (npm install runs in integration verify).",
  );
  return {};
}

const MAX_INTEGRATION_VERIFY_FIX_ITERATIONS = 150;
// Tightened thresholds: previous 8/18 burned ~100k tokens on read-only loops
// before the abort fired. 3 iterations without mutation is enough to know the
// LLM is reading in circles; 10 iterations is the hard stop.
const BASE_INTEGRATION_STAGNATION_WARNING_ITERATIONS = 3;
const BASE_INTEGRATION_STAGNATION_ABORT_ITERATIONS = 10;
const MAX_INTEGRATION_PROGRESS_SCORE = 6;
const INTEGRATION_STAGNATION_ABORT_BONUS_PER_PROGRESS = 2;
const INTEGRATION_STAGNATION_WARNING_BONUS_PER_PROGRESS = 1;
/** After N total stagnation warnings without progress, inject an escalated prompt. */
const STAGNATION_ESCALATION_WARNING_COUNT = 2;

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
  const pkgPaths = [
    "package.json",
    "backend/package.json",
    "apps/api/package.json",
  ];
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
 * Scans frontend/src/components/**\/*.tsx for exported component Props types and
 * returns a compact "Component Interface Reference" block injected into the
 * integration prompt. This lets the integration agent know the EXACT prop names
 * each component expects, preventing TS2322 "Property X does not exist" regressions.
 *
 * Uses regex — good enough for the standard `type XxxProps = { ... }` /
 * `interface XxxProps { ... }` patterns produced by the scaffold. Falls back to
 * an empty string if the frontend directory doesn't exist.
 */
async function buildComponentInterfaceReference(
  outputDir: string,
): Promise<string> {
  const componentsDir = path.join(outputDir, "frontend", "src", "components");
  let tsxFiles: string[] = [];
  try {
    tsxFiles = await collectTsxFiles(componentsDir);
  } catch {
    return "";
  }
  if (tsxFiles.length === 0) return "";

  const entries: string[] = [];

  for (const filePath of tsxFiles) {
    const raw = await fs.readFile(filePath, "utf-8").catch(() => "");
    if (!raw) continue;

    // Match both `type XxxProps = { ... }` and `interface XxxProps { ... }` (multiline)
    const blockRe =
      /(?:export\s+)?(?:type|interface)\s+(\w+Props)\s*(?:=\s*)?\{([\s\S]*?)\}/g;
    let match: RegExpExecArray | null;

    while ((match = blockRe.exec(raw)) !== null) {
      const propsName = match[1];
      const body = match[2];

      // Extract field names (required and optional)
      const fieldRe = /^\s*(?:readonly\s+)?(\w+)(\?)?:/gm;
      const fields: string[] = [];
      let fieldMatch: RegExpExecArray | null;
      while ((fieldMatch = fieldRe.exec(body)) !== null) {
        const name = fieldMatch[1];
        const optional = fieldMatch[2] === "?";
        if (name !== "children") {
          fields.push(optional ? `${name}?` : name);
        }
      }

      if (fields.length === 0) continue;

      // Derive component name from Props name (strip trailing "Props")
      const componentName = propsName.replace(/Props$/, "");
      const relPath = path.relative(path.join(outputDir, "frontend"), filePath);
      entries.push(`- **${componentName}** (\`${relPath}\`): ${fields.join(", ")}`);
    }
  }

  if (entries.length === 0) return "";

  return [
    "## Component Interface Reference (use EXACT prop names — TS2322 mismatches are P0 HARD FAIL)",
    "Each line lists a component and its accepted prop names (? = optional).",
    "Pass ONLY these names. Unknown props cause TypeScript errors that BLOCK report_done(pass).",
    ...entries,
  ].join("\n");
}

async function collectTsxFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectTsxFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

interface RouteRegistrationAudit {
  /** Human-readable lines suitable for feeding into the system prompt. */
  findings: string[];
  /** Modules that have a `*.routes.ts` file but are never wired into index.ts. */
  unregisteredModules: string[];
  /** register*Routes imports in index.ts that don't resolve to a real module. */
  unresolvedRegistrations: string[];
  /** Endpoints declared in API_CONTRACTS.json but no matching route implementation found. */
  missingContractEndpoints: Array<{ method: string; endpoint: string }>;
  /**
   * Endpoints implemented in routes.ts but not present in API_CONTRACTS.json.
   * Warning only — not a hard failure (internal endpoints may legitimately
   * live outside the public contract).
   */
  undeclaredEndpoints: Array<{ method: string; endpoint: string }>;
}

/**
 * Audits backend API route wiring against three sources of truth:
 *   1. Filesystem: what route files actually exist under backend/src/api/modules.
 *   2. Router entry: what register*Routes functions index.ts imports AND calls.
 *   3. Contract: API_CONTRACTS.json endpoints (method + path).
 *
 * Inconsistencies between these three are the #1 cause of "generated project
 * starts but returns 404 on the paths the PRD promised". This audit is
 * deliberately regex-based (not AST): the patterns below match the scaffold
 * template conventions and fail loud when they don't — the LLM then has to
 * close the gaps before integrationVerifyAndFix can pass.
 *
 * Returns an empty result (no findings) if the project has no backend or no
 * api/modules tree, so frontend-only projects are a no-op.
 */
async function auditApiRouteRegistration(
  outputDir: string,
): Promise<RouteRegistrationAudit> {
  const empty: RouteRegistrationAudit = {
    findings: [],
    unregisteredModules: [],
    unresolvedRegistrations: [],
    missingContractEndpoints: [],
    undeclaredEndpoints: [],
  };

  const hasBackend = await pathExistsUnderOutput(
    outputDir,
    "backend/package.json",
  );
  if (!hasBackend) return empty;

  const apiModulesDir = "backend/src/api/modules";
  if (!(await pathExistsUnderOutput(outputDir, apiModulesDir))) return empty;

  const moduleFiles = (await listFiles(apiModulesDir, outputDir)).filter((f) =>
    f.endsWith(".routes.ts"),
  );

  // Implemented modules: map export name → { file, endpoints: [{method, path}] }
  interface ModuleImpl {
    file: string;
    /** All register*Routes export names found in the file (a module may export aliases). */
    exportNames: string[];
    /** Primary export name used for backward-compat reporting. */
    exportName: string | null;
    mountPrefix: string | null;
    endpoints: Array<{ method: string; endpoint: string }>;
  }
  const implemented: ModuleImpl[] = [];

  // Collect ALL register*Routes exports (not just the first one) so modules
  // that export both a canonical name and a backward-compat alias don't get
  // flagged as unregistered when the alias is what index.ts actually calls.
  const exportNameRe =
    /export\s+(?:async\s+)?function\s+(register[A-Z]\w*Routes)\s*\(/g;
  // Match common Koa router variable names: `router`, `apiRouter`,
  // `<feature>Router`, plus inline `new Router().<verb>()`. Generators
  // alternate between mounting a sub-router (`router.get(...)` then
  // `apiRouter.use("/foo", router.routes())`) and binding directly on
  // the parent (`apiRouter.get("/foo", ...)`); both must be picked up.
  const routerVerbRe =
    /\b(?:router|apiRouter|[A-Za-z_$][\w$]*Router)\.(get|post|put|patch|delete|all|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  const inlineNewRouterRe =
    /new\s+Router\s*\([^)]*\)\.(get|post|put|patch|delete|all|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  const mountPrefixRe =
    /apiRouter\.use\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:router|[A-Za-z_$][\w$]*Router)\.routes/;

  for (const rel of moduleFiles) {
    const content = await fsRead(rel, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    // Collect all register*Routes exports (reset lastIndex for global re-use).
    exportNameRe.lastIndex = 0;
    const exportNames: string[] = [];
    let enm: RegExpExecArray | null;
    while ((enm = exportNameRe.exec(content)) !== null) {
      exportNames.push(enm[1]);
    }
    const mountMatch = content.match(mountPrefixRe);
    const endpoints: Array<{ method: string; endpoint: string }> = [];
    const seen = new Set<string>();
    const pushEndpoint = (method: string, endpoint: string): void => {
      const key = `${method.toUpperCase()} ${endpoint}`;
      if (seen.has(key)) return;
      seen.add(key);
      endpoints.push({ method: method.toUpperCase(), endpoint });
    };
    let vm: RegExpExecArray | null;
    routerVerbRe.lastIndex = 0;
    while ((vm = routerVerbRe.exec(content)) !== null) {
      pushEndpoint(vm[1], vm[2]);
    }
    inlineNewRouterRe.lastIndex = 0;
    while ((vm = inlineNewRouterRe.exec(content)) !== null) {
      pushEndpoint(vm[1], vm[2]);
    }
    // If the file binds directly on `apiRouter` (no sub-router .use),
    // do not prepend a mountPrefix later — endpoints already carry full
    // paths relative to apiPrefix. Detect this by: any `apiRouter.<verb>`
    // call exists.
    const bindsDirectlyOnApiRouter =
      /\bapiRouter\.(get|post|put|patch|delete|all|options|head)\s*\(/.test(
        content,
      );
    implemented.push({
      file: rel,
      exportNames,
      exportName: exportNames[0] ?? null,
      mountPrefix: bindsDirectlyOnApiRouter
        ? null
        : mountMatch
          ? mountMatch[1]
          : null,
      endpoints,
    });
  }

  // Parse index.ts: which register*Routes are imported AND called.
  const indexPath = `${apiModulesDir}/index.ts`;
  const indexContent = await fsRead(indexPath, outputDir);
  const indexExists =
    !indexContent.startsWith("FILE_NOT_FOUND") &&
    !indexContent.startsWith("REJECTED");

  const registeredNames = new Set<string>();
  const importedNames = new Set<string>();
  const apiPrefixMatch = indexContent.match(
    /new\s+Router\s*\(\s*\{[^}]*\bprefix\s*:\s*["'`]([^"'`]+)["'`]/,
  );
  const apiPrefix = apiPrefixMatch ? apiPrefixMatch[1] : "/api";

  if (indexExists) {
    const importLineRe =
      /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\/([\w-]+)\/\2\.routes["']/g;
    let im: RegExpExecArray | null;
    while ((im = importLineRe.exec(indexContent)) !== null) {
      for (const n of im[1].split(",")) {
        const name = n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (name) importedNames.add(name);
      }
    }
    // Also accept flat-form imports like `from "./health/health.routes"`.
    const flatImportRe =
      /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\.routes["']/g;
    let fm: RegExpExecArray | null;
    while ((fm = flatImportRe.exec(indexContent)) !== null) {
      for (const n of fm[1].split(",")) {
        const name = n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (name) importedNames.add(name);
      }
    }
    // Called registrations: `registerFooRoutes(apiRouter)`
    const callRe = /(register[A-Z]\w*Routes)\s*\(/g;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(indexContent)) !== null) {
      registeredNames.add(cm[1]);
    }
  }

  // Find modules where NONE of their register*Routes exports are called in index.ts.
  // A module that exports both a canonical name AND a backward-compat alias is
  // considered registered if ANY of its exports is called.
  const unregisteredModules: string[] = [];
  for (const mod of implemented) {
    if (mod.exportNames.length === 0) continue;
    const anyRegistered = mod.exportNames.some((n) => registeredNames.has(n));
    if (!anyRegistered) {
      const primary = mod.exportNames[0];
      unregisteredModules.push(
        `${mod.file}: exports "${primary}" but index.ts never calls it.`,
      );
    }
  }

  // Imports referencing a register*Routes that doesn't exist in any routes.ts.
  const knownExports = new Set(implemented.flatMap((m) => m.exportNames));
  const unresolvedRegistrations: string[] = [];
  for (const name of importedNames) {
    if (!knownExports.has(name)) {
      unresolvedRegistrations.push(
        `index.ts imports "${name}" but no routes.ts defines that export.`,
      );
    }
  }

  // Compare against API_CONTRACTS.json.
  const missingContractEndpoints: Array<{ method: string; endpoint: string }> =
    [];
  const undeclaredEndpoints: Array<{ method: string; endpoint: string }> = [];

  const contractRaw = await fsRead("API_CONTRACTS.json", outputDir);
  const hasContract =
    !contractRaw.startsWith("FILE_NOT_FOUND") &&
    !contractRaw.startsWith("REJECTED");

  if (hasContract) {
    let contracts: Array<{ method?: string; endpoint?: string }> = [];
    try {
      const parsed = JSON.parse(contractRaw);
      if (Array.isArray(parsed)) {
        contracts = parsed as Array<{ method?: string; endpoint?: string }>;
      }
    } catch {
      // Ignore malformed contracts — earlier phases should have rejected them.
    }

    // Normalise implemented endpoints: method + full path = apiPrefix + mount + route.
    const implementedPaths = new Set<string>();
    for (const mod of implemented) {
      for (const ep of mod.endpoints) {
        const fullPath = joinApiPath(
          apiPrefix,
          mod.mountPrefix ?? "",
          ep.endpoint,
        );
        implementedPaths.add(`${ep.method} ${fullPath}`);
      }
    }

    const contractKeys = new Set<string>();
    for (const c of contracts) {
      if (!c.method || !c.endpoint) continue;
      const key = `${c.method.toUpperCase()} ${normaliseApiPath(c.endpoint)}`;
      contractKeys.add(key);
      if (!routeMatches(key, implementedPaths)) {
        missingContractEndpoints.push({
          method: c.method.toUpperCase(),
          endpoint: c.endpoint,
        });
      }
    }

    for (const key of implementedPaths) {
      if (!routeMatches(key, contractKeys)) {
        const [method, endpoint] = key.split(" ");
        undeclaredEndpoints.push({ method, endpoint });
      }
    }
  }

  const findings: string[] = [];
  if (unregisteredModules.length > 0) {
    findings.push("## Unregistered backend modules");
    findings.push(...unregisteredModules.map((l) => `- ${l}`));
  }
  if (unresolvedRegistrations.length > 0) {
    findings.push("## Dangling register*Routes imports in index.ts");
    findings.push(...unresolvedRegistrations.map((l) => `- ${l}`));
  }
  if (missingContractEndpoints.length > 0) {
    findings.push("## API_CONTRACTS endpoints with no matching implementation");
    findings.push(
      ...missingContractEndpoints.map((e) => `- ${e.method} ${e.endpoint}`),
    );
  }
  if (undeclaredEndpoints.length > 0) {
    findings.push(
      "## Implemented endpoints not declared in API_CONTRACTS (verify intent)",
    );
    findings.push(
      ...undeclaredEndpoints.map((e) => `- ${e.method} ${e.endpoint}`),
    );
  }

  return {
    findings,
    unregisteredModules,
    unresolvedRegistrations,
    missingContractEndpoints,
    undeclaredEndpoints,
  };
}

function normaliseApiPath(p: string): string {
  const withLeading = p.startsWith("/") ? p : `/${p}`;
  return withLeading.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function joinApiPath(prefix: string, mount: string, route: string): string {
  const parts = [prefix, mount, route]
    .filter((s) => s && s.length > 0)
    .map((s) => (s.startsWith("/") ? s : `/${s}`))
    .join("");
  return normaliseApiPath(parts);
}

/**
 * Match a route key ("METHOD /api/foo/:id") against a set, treating path
 * parameters (`:id`, `:userId`) as wildcards so that `/api/users/:id` in the
 * contract matches `/api/users/:userId` in code (and vice versa).
 */
function routeMatches(key: string, candidates: Set<string>): boolean {
  if (candidates.has(key)) return true;
  const [method, path] = key.split(" ", 2);
  if (!path) return false;
  const pattern = new RegExp(
    "^" + path.replace(/:\w+/g, ":[A-Za-z0-9_]+") + "$",
  );
  for (const candidate of candidates) {
    const [cMethod, cPath] = candidate.split(" ", 2);
    if (cMethod !== method || !cPath) continue;
    if (pattern.test(cPath)) return true;
    const reverse = new RegExp(
      "^" + cPath.replace(/:\w+/g, ":[A-Za-z0-9_]+") + "$",
    );
    if (reverse.test(path)) return true;
  }
  return false;
}

interface ContractCompletenessResult {
  /** Unique parent→child relationships extracted from Sequelize models. */
  inferredRelationships: Array<{
    parent: string;
    child: string;
    file: string;
  }>;
  /**
   * Relationships where the scoped-list endpoint (GET /api/parents/:id/children)
   * is absent from API_CONTRACTS.json AND no acceptable alternative exists.
   * Only HARD FAIL cases — warnings are separated into `warnOnlyEndpoints`.
   */
  missingScopedEndpoints: Array<{
    parent: string;
    child: string;
    expectedPath: string;
    reason: string;
  }>;
  /**
   * Relationships that look "missing" at first glance but are likely served
   * via a /me/... or flat filtered endpoint pattern. Reported as WARN only
   * and do NOT block report_done(pass).
   */
  warnOnlyEndpoints: Array<{
    parent: string;
    child: string;
    expectedPath: string;
    reason: string;
  }>;
  /**
   * Human-readable findings lines ready to paste into an LLM system prompt or
   * repair-log payload. Includes both HARD and WARN items, each labelled.
   */
  findings: string[];
  /** True when only warnOnly items remain — does not block report_done. */
  warnOnly: boolean;
}

/**
 * Audits the API contract against Sequelize models to catch "the contract
 * omits scoped endpoints the data model obviously requires" — e.g. Project
 * hasMany Task but no `GET /api/projects/:id/tasks` in API_CONTRACTS.json.
 *
 * auditApiRouteRegistration only checks consistency between the contract and
 * the implementation. When the contract itself under-specifies the domain,
 * both ends look "consistent" and the bug ships. This audit derives the
 * expected endpoint set from a stronger source of truth (the ORM models)
 * and surfaces the delta.
 *
 * Regex-based on purpose — AST adds a Sequelize-typed dependency surface and
 * the scaffold conventions are narrow enough that regex is precise.
 */
async function auditContractCompleteness(
  outputDir: string,
): Promise<ContractCompletenessResult> {
  const empty: ContractCompletenessResult = {
    inferredRelationships: [],
    missingScopedEndpoints: [],
    warnOnlyEndpoints: [],
    findings: [],
    warnOnly: true,
  };

  if (!(await pathExistsUnderOutput(outputDir, "backend/package.json"))) {
    return empty;
  }
  const modelsDir = "backend/src/models";
  if (!(await pathExistsUnderOutput(outputDir, modelsDir))) return empty;

  const modelFiles = (await listFiles(modelsDir, outputDir)).filter(
    (f) => /\.(ts|js)$/.test(f) && !f.includes("node_modules"),
  );

  // ── 1. Extract Sequelize hasMany / belongsTo relationships ───────────────
  // hasMany: `Parent.hasMany(Child[, opts])` — parent "1" → child "many"
  // belongsTo: `Child.belongsTo(Parent[, opts])` — same relationship, other side
  const hasManyRe =
    /([A-Z][A-Za-z0-9_]*)\s*\.\s*hasMany\s*\(\s*([A-Z][A-Za-z0-9_]*)/g;
  const belongsToRe =
    /([A-Z][A-Za-z0-9_]*)\s*\.\s*belongsTo\s*\(\s*([A-Z][A-Za-z0-9_]*)/g;

  const unique = new Map<
    string,
    { parent: string; child: string; file: string }
  >();
  for (const rel of modelFiles) {
    const content = await fsRead(rel, outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
      continue;
    }
    let m: RegExpExecArray | null;
    hasManyRe.lastIndex = 0;
    while ((m = hasManyRe.exec(content)) !== null) {
      const key = `${m[1]}->${m[2]}`;
      if (!unique.has(key)) {
        unique.set(key, { parent: m[1], child: m[2], file: rel });
      }
    }
    belongsToRe.lastIndex = 0;
    while ((m = belongsToRe.exec(content)) !== null) {
      // m[1] = child, m[2] = parent
      const key = `${m[2]}->${m[1]}`;
      if (!unique.has(key)) {
        unique.set(key, { parent: m[2], child: m[1], file: rel });
      }
    }
  }

  const relationships = [...unique.values()];
  if (relationships.length === 0) {
    return { ...empty, inferredRelationships: [] };
  }

  // ── 2. Load API_CONTRACTS.json ──────────────────────────────────────────
  const contractRaw = await fsRead("API_CONTRACTS.json", outputDir);
  if (
    contractRaw.startsWith("FILE_NOT_FOUND") ||
    contractRaw.startsWith("REJECTED")
  ) {
    return { ...empty, inferredRelationships: relationships };
  }

  let contracts: Array<{ method?: string; endpoint?: string }> = [];
  try {
    const parsed = JSON.parse(contractRaw);
    if (Array.isArray(parsed)) {
      contracts = parsed as Array<{ method?: string; endpoint?: string }>;
    }
  } catch {
    return { ...empty, inferredRelationships: relationships };
  }

  const declaredSet = new Set<string>();
  for (const c of contracts) {
    if (typeof c.method !== "string" || typeof c.endpoint !== "string") {
      continue;
    }
    declaredSet.add(
      `${c.method.toUpperCase()} ${normaliseApiPath(c.endpoint)}`,
    );
  }

  /**
   * Find the plural path segment the contract uses for a model, by looking at
   * its flat list endpoint. If the contract declares `GET /api/tasks`, the
   * child plural for model "Task" is "tasks". Falls back to lowercased name + "s"
   * only when no flat endpoint exists at all (so we still give LLM a hint).
   */
  const flatSegmentFor = (modelName: string): string | null => {
    const modelLower = modelName.toLowerCase();
    for (const c of contracts) {
      if (c.method?.toUpperCase() !== "GET") continue;
      if (!c.endpoint) continue;
      const ep = normaliseApiPath(c.endpoint);
      const match = ep.match(/^\/api\/([^/]+)$/);
      if (!match) continue;
      const segment = match[1].toLowerCase();
      // Accept segment if it starts with the model's lowercase name (projects,
      // tasks, users, etc.) — tolerant of pluralisation variance.
      if (
        segment === modelLower ||
        segment === `${modelLower}s` ||
        segment === `${modelLower}es` ||
        segment === modelLower.replace(/y$/, "ies") ||
        segment.startsWith(modelLower)
      ) {
        return match[1];
      }
    }
    return null;
  };

  // ── 3. For each relationship, check scoped endpoint is declared ─────────
  const hardMissing: ContractCompletenessResult["missingScopedEndpoints"] = [];
  const warnOnly: ContractCompletenessResult["warnOnlyEndpoints"] = [];

  for (const rel of relationships) {
    const parentSegment = flatSegmentFor(rel.parent);
    const childSegment = flatSegmentFor(rel.child);

    // When the parent has no flat list endpoint, the scoped endpoint is
    // ambiguous — downgrade to WARN rather than blocking the build.
    if (!parentSegment || !childSegment) {
      warnOnly.push({
        parent: rel.parent,
        child: rel.child,
        expectedPath: `GET /api/{${rel.parent.toLowerCase()}s}/:id/{${rel.child.toLowerCase()}s}`,
        reason: `Model relationship ${rel.parent}.hasMany(${rel.child}) found in ${rel.file}, but ${!parentSegment ? "parent" : "child"} has no flat /api list endpoint to derive the plural segment from. Consider adding a filtered endpoint or a /me/${rel.child.toLowerCase()}s pattern.`,
      });
      continue;
    }

    const expectedPattern = new RegExp(
      `^/api/${parentSegment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/:\\w+/${childSegment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    );
    const hasScoped = [...declaredSet].some((key) => {
      if (!key.startsWith("GET ")) return false;
      return expectedPattern.test(key.slice(4));
    });

    if (hasScoped) continue;

    // Check for acceptable /me/<child> pattern (e.g. GET /api/users/me/interests).
    // Apps frequently serve user-owned resources via /me/... instead of a full
    // scoped path — both are valid designs; treat /me pattern as satisfying the
    // completeness requirement.
    const childLower = childSegment.toLowerCase();
    const meAlternatives = [
      `/api/users/me/${childLower}`,
      `/api/${parentSegment}/me/${childLower}`,
      `/api/me/${childLower}`,
    ];
    const hasMeAlternative = meAlternatives.some((alt) =>
      [...declaredSet].some(
        (key) => key.startsWith("GET ") && key.slice(4) === alt,
      ),
    );
    if (hasMeAlternative) continue;

    // Also accept if the child has a flat filtered endpoint (e.g. GET /api/alerts
    // filtered by auth user satisfies User.hasMany(Alert)).
    const hasChildFlat = [...declaredSet].some(
      (key) =>
        key.startsWith("GET ") &&
        (key === `GET /api/${childLower}` ||
          key === `GET /api/${childSegment}`),
    );
    if (hasChildFlat) {
      // Flat child endpoint exists — likely filtered by auth. Downgrade to WARN.
      warnOnly.push({
        parent: rel.parent,
        child: rel.child,
        expectedPath: `GET /api/${parentSegment}/:id/${childSegment}`,
        reason: `A flat GET /api/${childSegment} endpoint exists (auth-filtered pattern). If that endpoint already returns only the current user's ${rel.child} records, the scoped endpoint is redundant. Otherwise add it.`,
      });
      continue;
    }

    hardMissing.push({
      parent: rel.parent,
      child: rel.child,
      expectedPath: `GET /api/${parentSegment}/:id/${childSegment}`,
      reason: `Model relationship ${rel.parent}.hasMany(${rel.child}) implies this scoped-list endpoint, which is missing from API_CONTRACTS.json with no /me/... alternative.`,
    });
  }

  const findings: string[] = [];
  if (hardMissing.length > 0) {
    findings.push(
      "## Contract completeness: missing scoped-list endpoints [HARD FAIL — implement these]",
    );
    for (const m of hardMissing) {
      findings.push(`- ${m.expectedPath}`);
      findings.push(`  reason: ${m.reason}`);
    }
  }
  if (warnOnly.length > 0) {
    findings.push(
      "## Contract completeness: advisory endpoints [WARN only — review but do not block]",
    );
    for (const w of warnOnly) {
      findings.push(`- ${w.expectedPath} (advisory)`);
      findings.push(`  note: ${w.reason}`);
    }
  }

  return {
    inferredRelationships: relationships,
    missingScopedEndpoints: hardMissing,
    warnOnlyEndpoints: warnOnly,
    findings,
    warnOnly: hardMissing.length === 0,
  };
}

/**
 * Programmatically append stub contract entries for scoped-list endpoints
 * that `auditContractCompleteness` flagged as missing.
 *
 * Feeding these into `API_CONTRACTS.json` BEFORE the backend worker phase
 * means downstream codegen sees a complete contract and implements the
 * missing endpoints naturally — instead of the LLM reading "you forgot X"
 * during the late integration loop and potentially stalling on it.
 *
 * Idempotent: skips entries whose `METHOD /path` already exists, and skips
 * entries whose `expectedPath` still contains `{...}` placeholders (meaning
 * the audit couldn't resolve a plural segment and it's not safe to synthesize).
 */
async function autoAppendMissingScopedEndpoints(
  outputDir: string,
  missing: ContractCompletenessResult["missingScopedEndpoints"],
): Promise<{ added: string[]; skipped: string[] }> {
  const added: string[] = [];
  const skipped: string[] = [];
  if (missing.length === 0) return { added, skipped };

  const contractPath = "API_CONTRACTS.json";
  const raw = await fsRead(contractPath, outputDir);
  if (raw.startsWith("FILE_NOT_FOUND") || raw.startsWith("REJECTED")) {
    return { added, skipped: missing.map((m) => m.expectedPath) };
  }

  let parsed: Array<Record<string, unknown>>;
  try {
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) {
      return { added, skipped: missing.map((m) => m.expectedPath) };
    }
    parsed = json as Array<Record<string, unknown>>;
  } catch {
    return { added, skipped: missing.map((m) => m.expectedPath) };
  }

  const existing = new Set<string>();
  for (const c of parsed) {
    if (typeof c.method === "string" && typeof c.endpoint === "string") {
      existing.add(`${c.method.toUpperCase()} ${normaliseApiPath(c.endpoint)}`);
    }
  }

  for (const m of missing) {
    const [methodRaw, pathRaw] = m.expectedPath.split(" ", 2);
    if (!methodRaw || !pathRaw) {
      skipped.push(m.expectedPath);
      continue;
    }
    // Skip unresolved placeholder paths like "GET /api/{users}/:id/{tasks}".
    if (pathRaw.includes("{") || pathRaw.includes("}")) {
      skipped.push(
        `${m.expectedPath} (unresolved plural — fix flat endpoints first)`,
      );
      continue;
    }
    const method = methodRaw.toUpperCase();
    const normPath = normaliseApiPath(pathRaw);
    if (existing.has(`${method} ${normPath}`)) {
      skipped.push(`${m.expectedPath} (already present)`);
      continue;
    }
    const segMatch = normPath.match(/^\/api\/([^/]+)\/:\w+\/([^/]+)$/);
    const parentSeg = segMatch?.[1] ?? m.parent.toLowerCase();
    const childSeg = segMatch?.[2] ?? m.child.toLowerCase();
    parsed.push({
      service: parentSeg,
      endpoint: normPath,
      method,
      requestSchema:
        "params: { id: string }; query?: { limit?: number; offset?: number }",
      responseSchema: `${m.child}Dto[]`,
      auth: "bearer",
      description: `List all ${childSeg} belonging to the ${m.parent.toLowerCase()} identified by :id.`,
    });
    existing.add(`${method} ${normPath}`);
    added.push(`${method} ${normPath}`);
  }

  if (added.length === 0) return { added, skipped };

  // Re-assign sequential ids so the contract file stays consistent with the
  // pattern `API-NNN` that `generateApiContracts` establishes.
  const withIds = parsed.map((item, i) => ({
    ...item,
    id: `API-${String(i + 1).padStart(3, "0")}`,
  }));
  await fsWrite(contractPath, JSON.stringify(withIds, null, 2), outputDir);
  return { added, skipped };
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
  const importGapInstalls = await installImportGapsAllProjects(state.outputDir);
  if (importGapInstalls.length > 0) {
    const totalPackages = importGapInstalls.reduce(
      (sum, r) => sum + r.packages.length,
      0,
    );
    getRepairEmitter(state.sessionId)({
      stage: "preflight-deps",
      event: "import_gaps_installed",
      details: {
        totalPackages,
        scopes: importGapInstalls.map((r) => ({
          scope: r.scope,
          packages: r.packages,
          exitCode: r.exitCode,
        })),
      },
    });
  }
  const initialDependencyAudit = await auditImportDependencyConsistency(
    state.outputDir,
  );
  const initialResidualConflicts = await detectResidualImplementationConflicts(
    state.outputDir,
  );
  const frontendHookNormalization = await normalizeFrontendHookSignatures(
    state.outputDir,
  );
  const frontendJsxNormalization = await normalizeFrontendJsxElementAnnotations(
    state.outputDir,
  );
  const frontendReactTemplateNormalization =
    await normalizeFrontendReactComponentTemplates(state.outputDir);
  const frontendAuthDtoNormalization = await normalizeFrontendAuthDtoAliases(
    state.outputDir,
  );
  const frontendUseFormNormalization = await normalizeFrontendUseFormHook(
    state.outputDir,
  );
  // Run *before* the cluster detector so the duplicate-client convergence
  // is reflected in any subsequent audit. This is the highest-impact
  // structural normalization for M-tier frontends — see analysis of
  // `coding-session-report.md` for why the dual `apiClient` was the
  // root cause of recent 18-iteration stagnation loops.
  const frontendDuplicateClientNormalization =
    await normalizeFrontendDuplicateApiClient(state.outputDir);
  const frontendErrorCauseNormalization = await normalizeFrontendErrorWithCause(
    state.outputDir,
  );
  const backendGetValidateBodyNormalization =
    await normalizeBackendGetValidateBody(state.outputDir);
  // Collapse `backend/src/middleware/*.ts` (singular, frequently emitted by
  // workers) into the canonical `backend/src/middlewares/` directory and
  // rewrite every consumer import. Without this normalizer the project ends
  // up with dozens of `Cannot find module` errors that the agent loop
  // typically cannot untangle by itself.
  const backendMiddlewareFolderNormalization =
    await normalizeBackendMiddlewareFolder(state.outputDir);
  const frontendNormalizationNotes = [
    ...frontendHookNormalization.notes,
    ...frontendJsxNormalization.notes,
    ...frontendReactTemplateNormalization.notes,
    ...frontendAuthDtoNormalization.notes,
    ...frontendUseFormNormalization.notes,
    ...frontendDuplicateClientNormalization.notes,
    ...frontendErrorCauseNormalization.notes,
    ...backendGetValidateBodyNormalization.notes,
    ...backendMiddlewareFolderNormalization.notes,
  ];
  const frontendConvergenceClusters = await detectFrontendConvergenceClusters(
    state.outputDir,
  );
  const routeAudit = await auditApiRouteRegistration(state.outputDir);
  const initialApiClientUniqueness = await auditFrontendApiClientUniqueness(
    state.outputDir,
  );
  let contractCompleteness = await auditContractCompleteness(state.outputDir);
  // Deterministic repair: append stub contract entries ONLY for HARD FAIL
  // missing scoped endpoints (not WARN-only items which may have /me/ alternatives).
  // Re-run the audit after appending so `contractCompleteness` reflects the
  // post-repair state in the rest of this function.
  if (contractCompleteness.missingScopedEndpoints.length > 0) {
    const appendResult = await autoAppendMissingScopedEndpoints(
      state.outputDir,
      contractCompleteness.missingScopedEndpoints,
    );
    if (appendResult.added.length > 0) {
      console.log(
        `${label}: auto-appended ${appendResult.added.length} scoped endpoint(s) to API_CONTRACTS.json during preflight: ${appendResult.added.join(", ")}`,
      );
    }
    if (appendResult.added.length > 0 || appendResult.skipped.length > 0) {
      getRepairEmitter(state.sessionId)({
        stage: "preflight-contract-completeness",
        event: "contract_completeness_autorepaired",
        details: {
          when: "preflight",
          added: appendResult.added,
          skipped: appendResult.skipped,
        },
      });
    }
    if (appendResult.added.length > 0) {
      contractCompleteness = await auditContractCompleteness(state.outputDir);
    }
  }
  if (initialDependencyAudit.remainingIssues.length > 0) {
    console.warn(
      `${label}: dependency audit still has ${initialDependencyAudit.remainingIssues.length} unresolved item(s).`,
    );
  }
  if (initialResidualConflicts.length > 0) {
    console.warn(
      `${label}: detected ${initialResidualConflicts.length} residual implementation conflict(s).`,
    );
  }
  const routeAuditHardFail =
    routeAudit.unregisteredModules.length > 0 ||
    routeAudit.unresolvedRegistrations.length > 0 ||
    routeAudit.missingContractEndpoints.length > 0;
  if (routeAuditHardFail) {
    console.warn(
      `${label}: API route audit found ${routeAudit.unregisteredModules.length} unregistered module(s), ${routeAudit.unresolvedRegistrations.length} dangling import(s), ${routeAudit.missingContractEndpoints.length} missing contract endpoint(s).`,
    );
  }
  if (contractCompleteness.missingScopedEndpoints.length > 0) {
    console.warn(
      `${label}: contract completeness audit found ${contractCompleteness.missingScopedEndpoints.length} missing scoped endpoint(s): ${contractCompleteness.missingScopedEndpoints
        .map((m) => m.expectedPath)
        .join(", ")}`,
    );
  }
  getRepairEmitter(state.sessionId)({
    stage: "preflight-route-audit",
    event: "route_audit_snapshot",
    details: {
      when: "preflight",
      hardFail: routeAuditHardFail,
      unregisteredModules: routeAudit.unregisteredModules,
      unresolvedRegistrations: routeAudit.unresolvedRegistrations,
      missingContractEndpoints: routeAudit.missingContractEndpoints,
      undeclaredEndpointCount: routeAudit.undeclaredEndpoints.length,
    },
  });
  getRepairEmitter(state.sessionId)({
    stage: "preflight-contract-completeness",
    event: "contract_completeness_snapshot",
    details: {
      when: "preflight",
      inferredRelationshipCount:
        contractCompleteness.inferredRelationships.length,
      missingScopedEndpoints: contractCompleteness.missingScopedEndpoints,
    },
  });

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

  // ── Package manager + version constraints ────────────────────────────────
  const pm = await detectPackageManager(state.outputDir);
  const versionConstraints = await buildVersionConstraints(state.outputDir);
  const frontendDir = path.join(state.outputDir, "frontend");
  const backendDir = path.join(state.outputDir, "backend");
  const hasFrontend = !(
    await fsRead("frontend/package.json", state.outputDir)
  ).startsWith("FILE_NOT_FOUND");
  const hasBackend = !(
    await fsRead("backend/package.json", state.outputDir)
  ).startsWith("FILE_NOT_FOUND");

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

  // ── PRD context (relevance-trimmed to keep prompt manageable) ───────────
  // Previously this was `slice(0, 12000)` which silently hid PRD features
  // past the 12k mark from the integration-review agent. Replace with a
  // section-level picker that tries to keep feature-review-critical content.
  const integrationReviewHint = {
    keywords: [
      "feature",
      "requirement",
      "acceptance",
      "criteria",
      "page",
      "component",
      "endpoint",
      "flow",
      "scenario",
    ],
  };
  const prdTrimmed = state.projectContext
    ? pickRelevantSections(state.projectContext, integrationReviewHint, {
        budget: 18_000,
        label: "integration-review",
        stage: "worker-context",
        emitter: getRepairEmitter(state.sessionId),
      })
    : "";
  const prdBlock = prdTrimmed
    ? `\n## Product Requirements (PRD)\nUse this as the authoritative specification when reviewing feature completeness.\n\n${prdTrimmed}`
    : "";
  const dependencyAuditBlock =
    initialDependencyAudit.summary !== "Dependency consistency audit: clean."
      ? `\n## Preflight dependency audit\n${initialDependencyAudit.summary}`
      : "";
  const residualConflictBlock =
    initialResidualConflicts.length > 0
      ? `\n## Residual implementation conflicts detected before final verify\n${initialResidualConflicts.map((line) => `- ${line}`).join("\n")}`
      : "";
  const frontendNormalizationBlock =
    frontendNormalizationNotes.length > 0
      ? `\n## Frontend preflight normalizations already applied\n${frontendNormalizationNotes.map((line) => `- ${line}`).join("\n")}`
      : "";
  const frontendClusterBlock =
    frontendConvergenceClusters.length > 0
      ? `\n## Frontend error clusters to resolve structurally\n${frontendConvergenceClusters
          .map(
            (cluster, index) =>
              `${index + 1}. ${cluster.title}\n   - ${cluster.description}\n   - Files: ${cluster.files.join(", ")}`,
          )
          .join("\n")}`
      : "";
  const routeAuditBlock =
    routeAudit.findings.length > 0
      ? `\n## Backend route registration audit (MUST fix before report_done(pass))\n${routeAudit.findings.join("\n")}`
      : "";
  const contractCompletenessBlock = (() => {
    if (contractCompleteness.findings.length === 0) return "";
    // Split HARD vs WARN sections from findings (WARN items contain "(advisory)").
    const hardLines = contractCompleteness.findings.filter(
      (l) => !l.includes("(advisory)") && !l.includes("[WARN only"),
    );
    const warnLines = contractCompleteness.findings.filter(
      (l) => l.includes("(advisory)") || l.includes("[WARN only"),
    );
    const parts: string[] = [];
    if (hardLines.length > 1) {
      parts.push(
        `\n## Contract completeness audit (HARD FAIL — fix these before report_done(pass))\nImplement each missing scoped-list endpoint: add to API_CONTRACTS.json, implement the handler, and register it in index.ts.\n${hardLines.join("\n")}`,
      );
    }
    if (warnLines.length > 1) {
      parts.push(
        `\n## Contract completeness advisory (WARN — review but does NOT block report_done)\nThese ORM relationships have alternative implementations (/me/... pattern or auth-filtered flat endpoints) that satisfy the requirement. Review only if a feature is visibly broken.\n${warnLines.join("\n")}`,
      );
    }
    return parts.join("\n");
  })();
  const apiClientUniquenessBlock =
    initialApiClientUniqueness.parallelClients.length > 0
      ? `\n## Frontend API client uniqueness audit (MUST fix before report_done(pass))\nA single canonical \`apiClient\` is required at \`${initialApiClientUniqueness.canonical}\`. The preflight normalizer left the following parallel client(s) intact because they still define their own implementation. Collapse them now.\n${initialApiClientUniqueness.findings.join("\n")}`
      : "";

  const systemPrompt = [
    "You are a Senior Full-Stack Engineer performing the **Final Verification** of a fully generated codebase.",
    "Your two objectives, in order:",
    "  1. FIRST review PRD completeness and fill missing implementations so the product is actually usable.",
    "  2. THEN perform registration closure plus scoped compile/build verification until all final gates pass.",
    "",
    "## Phase 0 — PRD Completeness & Routing/Module Registration",
    "Before compile/build validation, inspect these integration points first:",
    "1. Review the PRD and identify missing pages, flows, handlers, middlewares, and end-to-end feature gaps.",
    "2. Frontend route closure:",
    "   - Scan `frontend/src/views` for actual page files.",
    "   - **Also scan `frontend/src/pages`** — if any page-level `.tsx` files exist there, **move them** to `frontend/src/views` (flat, no subdirectories) and delete the `frontend/src/pages` directory. `src/pages` is a Next.js convention; M-tier Vite+React projects use `src/views`.",
    "   - Ensure views are flat: if files are nested in subdirectories like `views/auth/LoginPage.tsx`, move them to `views/LoginPage.tsx` directly.",
    "   - Read `frontend/src/router.tsx`.",
    "   - Import and register every real page that should be reachable unless it is clearly dead code. Imports must use `./views/...` paths.",
    "3. Backend API module closure:",
    "   - Scan `backend/src/api/modules` for implemented module route files.",
    "   - Read `backend/src/api/modules/index.ts`.",
    "   - Import and register every implemented module route unless it is clearly unused/dead code.",
    "4. Backend middleware closure:",
    "   - Scan `backend/src/middlewares` for implemented middleware files.",
    "   - Read `backend/src/app.ts`.",
    "   - Register missing middleware usage in the correct app bootstrap order when the middleware is part of the actual server pipeline.",
    "5. Fix these registration and PRD completeness gaps first, then continue with compile/build verification.",
    "",
    "## Phase 1 — PRD Implementation Review",
    "1. List all major features/requirements in the PRD",
    "2. For each feature, verify the implementation:",
    "   a. Use `grep` to find related files and handlers",
    "   b. Read the relevant source files",
    "   c. Check: is the feature fully implemented? Are edge cases handled?",
    "   d. Check: will a real user be able to use this feature end-to-end?",
    "3. Backend cross-file consistency review (MANDATORY for every create/update/read flow backed by persistence):",
    "   a. Read the request DTO/type, validation schema, controller/service payload, and ORM model together.",
    "   b. Check that user-input fields vs system-generated fields are consistent across those files.",
    "   c. If a model field is required (`allowNull: false`) but missing from both the create payload and model defaults, fix the inconsistency.",
    "   d. If the model uses Sequelize timestamps (`timestamps: true` or timestamp aliases), ensure services/controllers are NOT forced to manually provide `createdAt` / `updatedAt` unless the project already uses that pattern consistently.",
    "   e. Ensure system fields like `id`, `createdAt`, `updatedAt`, timestamp aliases, and lifecycle-generated fields are not mistakenly required in request DTOs/validation.",
    "   f. When a controller catches an internal error, do not leave it as an unobservable black box in development; keep useful logging or structured error details so runtime failures remain diagnosable.",
    "4. Fix any missing or broken feature implementations",
    "5. Specifically inspect every Protected Scaffold File listed below:",
    "   - Check that business logic was correctly added (not left as stub/TODO)",
    "   - Check that routes, controllers, services, and configs are wired up correctly",
    "   - Fix any implementation errors — you ARE allowed to edit these files in this phase",
    "",
    "## Phase 2 — Scoped Compile & Build Validation",
    "Use ONLY scoped validation commands under `frontend/` and `backend/`.",
    `1. Frontend type-check: \`cd frontend && ${hasFrontend ? "npx tsc -p tsconfig.app.json --pretty false 2>&1" : "echo skip-frontend"}\``,
    `2. Frontend build: \`cd frontend && ${hasFrontend ? (pm === "yarn" ? "yarn run build 2>&1" : pm === "npm" ? "npm run build 2>&1" : "pnpm run build 2>&1") : "echo skip-frontend"}\``,
    `3. Backend type-check: \`cd backend && ${hasBackend ? "npx tsc --noEmit --pretty false 2>&1" : "echo skip-backend"}\``,
    `4. Backend startup smoke: \`cd backend && ${hasBackend ? "npx tsx --eval \\\"(async () => { const { existsSync } = await import('node:fs'); const dbCandidates = ['./src/db.ts', './src/config/database.ts', './src/database/connection.ts']; const dbEntry = dbCandidates.find((candidate) => existsSync(candidate)); if (dbEntry) { await import(dbEntry); if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing after importing backend database entry; ensure dotenv is loaded in the startup/database chain'); } const mod = await import('./src/app.ts'); const createApp = mod.createApp ?? mod.default?.createApp ?? mod.default; if (typeof createApp !== 'function') throw new Error('createApp export missing'); const app = await createApp(); if (!app || typeof app.callback !== 'function') throw new Error('createApp did not return a Koa app'); console.log('backend_smoke_ok'); })().catch((error) => { console.error(error instanceof Error ? (error.stack ?? error.message) : String(error)); process.exit(1); });\\\" 2>&1" : "echo skip-backend"}\``,
    "5. For each TypeScript/build/runtime smoke error:",
    "   a. Read the file with the error",
    "   b. Read any imported modules that are missing exports",
    "   c. Write the minimal fix",
    "6. Any `write_file` or mutating install/generate command makes prior validation STALE.",
    "7. After the LAST mutation, re-run all scoped validation gates in full, including backend startup smoke.",
    "8. Only after registration closure is complete and all scoped validation gates pass may you call `report_done(status='pass', summary=...)`",
    "   OR `report_done(status='fail', summary=<unresolved issues>)` if critical features cannot be fixed",
    "",
    "## Phase 2.25 — Delivery hardening",
    "1. Resolve import/package mismatches so every runtime import is declared in the correct package.json.",
    "2. Remove or merge residual duplicate implementations when the same responsibility exists in old/new canonical paths.",
    "3. **Stagnation guard**: If you detect yourself rereading the same file or running the same command without making a `write_file` change for 3+ iterations, STOP. Either: (a) make the minimal targeted fix right now, or (b) if all remaining issues are WARN-only, call report_done(pass) with an explanation. Looping without mutations wastes budget and never converges.",
    "4. Treat repeated frontend TypeScript templates as cluster problems, not isolated file problems: fix the shared abstraction or repeated pattern first, then return to leaf files.",
    "",
    "## Phase 2.3 — Cluster priority order (READ BEFORE EDITING ANY LEAF FILE)",
    "Apply fixes in this exact priority order. Do NOT jump ahead — fixing a leaf file before its parent cluster is the #1 cause of stagnation.",
    "  P0. **Frontend shared API surface mismatch** — there must be exactly ONE HTTP client at `frontend/src/api/client.ts`. If you see a second client (e.g. `frontend/src/utils/apiClient.ts`, `frontend/src/lib/http.ts`) or feature files importing from two different clients, FIRST collapse to the canonical client and rewrite consumer imports. Only after that re-run frontend `tsc`.",
    "  P0. **Backend route registration mismatch** — registrar export name vs `index.ts` import; mount-prefix mismatch; `apiRouter.<verb>` vs sub-router pattern. Fix the registrar/index pair before chasing per-endpoint TS errors. For each dangling import entry: read the actual routes.ts, align the export name with the import (fix either side), never leave a gap between import and export.",
    "  P1. **Backend Koa body / DTO typing** — rely on the scaffold-provided `koa.d.ts` augmentation; do NOT scatter `(ctx.request as any).body`. Validate with Joi, then cast to a typed DTO once.",
    "  P1. **Backend JWT typing** — use `signJwt` / `verifyJwt` from `backend/src/utils/jwt.ts`. Do NOT call `jsonwebtoken` directly in feature code.",
    "  P1. **Backend GET + validateBody** — strip `validateBody(...)` from any `apiRouter.get(...)` call; rebind to the correct `list*` / `get*` handler.",
    "  P2. Frontend JSX namespace / hook signature / component template residuals (already covered by preflight; only fix leaks).",
    "  P3. Per-file leaf TypeScript errors.",
    "When the same error message recurs across ≥3 files, stop and treat it as a cluster (P0/P1) — not as isolated leaf bugs.",
    "",
    "## Phase 2.5 — Mock / Stub Cleanup",
    "1. Search frontend source for mock API interceptor files or imports (e.g. `mockApi`, `mock-server`, `msw/handlers`, `__mocks__`). Delete any such files and remove their imports (e.g. `import './lib/mockApi'` in `App.tsx`).",
    "2. Read `frontend/src/context/AuthContext.tsx` (or equivalent auth provider). If the provider is a no-op stub that always returns `{ isAuthenticated: false, user: null }`, replace it with a real implementation that reads `token`/`user` from `localStorage`, exposes `login()`/`logout()` functions, and sets `isAuthenticated` based on whether a token exists.",
    "3. Search for any remaining `throw new Error('Not implemented')` stubs in backend controllers/services. If found, either implement them or remove the dead file.",
    "",
    "## Hard rules",
    "- Do NOT switch HTTP frameworks (Express ↔ Fastify ↔ Koa) or frontend frameworks.",
    "- For split M-tier projects, keep routing in frontend/src/router.tsx and backend API modules under backend/src/api/modules.",
    "- Coding-stage tasks may leave shared registration files incomplete by design; IntegrationVerifyFix owns the final registration closure.",
    "- Registration closure is mandatory: treat missing registrations in `frontend/src/router.tsx`, `backend/src/api/modules/index.ts`, and `backend/src/app.ts` as top-priority integration defects.",
    "- Do not stop after making pages/controllers/middlewares exist on disk; they must be wired into the actual router/module/app entrypoints.",
    "- When a shared module imports a named route registrar or app helper, verify the source file exports that exact symbol; import/export name mismatches are runtime blockers.",
    "- **Dangling import protocol** — when the route audit reports `index.ts imports \"registerXRoutes\" but no routes.ts defines that export`, follow this exact 3-step procedure:",
    "    1. Read the actual routes.ts file for that module (e.g. `backend/src/api/modules/users/users.routes.ts`) to find its real export name.",
    "    2. Choose ONE of: (a) rename the `export function register*Routes` in routes.ts to match what index.ts expects, OR (b) fix the import line in index.ts to match the actual export name in routes.ts.",
    "    3. Never add a new import to index.ts for a registrar function unless you simultaneously verify OR create that exact export name in the corresponding routes.ts.",
    "- **Component prop contract (P0 HARD FAIL)**: TypeScript error TS2322 of the form \"Property 'X' does not exist on type '...ComponentProps'. Did you mean 'Y'?\" is a P0 HARD FAIL. Read the component's Props type definition (see 'Component Interface Reference' block in the user message), use the CORRECT field name shown there, and DO NOT pass undeclared props. These errors block report_done(pass) exactly like dangling route imports.",
    "- **Stale validation rule (ENFORCED)**: After ANY write_file or mutating bash command ALL 4 scoped validation results become stale. You MUST re-run the FULL 4-command validation sequence (frontend_tsc → frontend_build → backend_tsc → backend_smoke) before calling report_done(pass). Calling report_done(pass) with stale validation will be REJECTED by the system.",
    "- Run verification ONLY inside `frontend/` and `backend/`. Do not use root-level `npx tsc` against the whole generated-code tree in this phase.",
    "- Do NOT call `report_done(status='pass')` while dependency audit issues remain unresolved.",
    "- Do NOT call `report_done(status='pass')` while the 'Backend route registration audit' block lists unregistered modules, dangling register*Routes imports, or API_CONTRACTS endpoints with no matching implementation. Fix each entry (register, implement, or remove) before finishing.",
    "- The 'Contract completeness audit' section has two kinds of findings: **HARD FAIL** items (section header says 'HARD FAIL') block report_done(pass) — implement those. **WARN** items (header says 'WARN only') are advisory; they do NOT block report_done(pass). Common WARN patterns: /me/... alternative endpoints, auth-filtered flat endpoints. If only WARN items remain, you MAY call report_done(pass).",
    "- **Audit false-positive exit**: If a route audit or contract-completeness finding is demonstrably incorrect (e.g., the route IS registered but the audit used a wrong export name, or the scoped endpoint IS present under a /me/... path), document the discrepancy in your report_done summary and call report_done(pass). Do NOT loop indefinitely trying to fix a false positive.",
    "- In this phase, scaffold-protected files do NOT block edits. You may overwrite protected scaffold files when registration or PRD completeness requires it.",
    "- Minimal targeted changes — do not rewrite working code.",
    "- Install missing npm packages: `pnpm add <pkg> --filter <workspace-name>`",
    "- If errors include [CONVENTION], they are policy violations and MUST be fixed.",
    "- When frontend errors repeat across many files, prefer fixing the shared hook/type/template that generates the cluster instead of patching one leaf file at a time.",
    ...(versionConstraints ? ["", versionConstraints] : []),
    protectedFilesBlock,
  ].join("\n");

  const componentInterfaceBlock = await buildComponentInterfaceReference(
    state.outputDir,
  ).catch(() => "");

  const openingUserContent = [
    `Project directory: ${state.outputDir}`,
    `Package manager: ${pm}`,
    prdBlock,
    dependencyAuditBlock,
    residualConflictBlock,
    frontendNormalizationBlock,
    frontendClusterBlock,
    routeAuditBlock,
    contractCompletenessBlock,
    apiClientUniquenessBlock,
    componentInterfaceBlock,
    "",
    "Begin with PRD completeness review and shared registration closure first, then run scoped frontend/backend validation after the feature补写 is complete.",
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
  const integrationReasoningOptions = buildIntegrationReasoningOptions();
  let validationStale = true;
  let lastMutationAt: string | null = null;
  let lastMutationReason = "initial integration review";
  let lastFullValidationAt: string | null = null;
  let frontendTscOkAt: string | null = null;
  let frontendBuildOkAt: string | null = null;
  let backendTscOkAt: string | null = null;
  let backendSmokeOkAt: string | null = null;
  let consecutiveNoMutationIterations = 0;
  let lastStagnationGuidanceAt = 0;
  let stagnationWarningsWithoutProgress = 0;
  const repeatedReadOnlyActionCounts = new Map<string, number>();
  let progressScore = 0;
  let lastMeaningfulProgressIteration = 0;
  let lastMeaningfulProgressReason = "initial integration review";
  const bestValidationIssueMetrics: Partial<
    Record<ScopedValidationKind, ScopedValidationIssueMetrics>
  > = {};
  let bestDependencyIssueCount = initialDependencyAudit.remainingIssues.length;
  let bestRouteIssueCount = countRouteAuditIssues(routeAudit);
  let bestContractCompletenessIssueCount =
    countContractCompletenessIssues(contractCompleteness);

  function nowIso(): string {
    return new Date().toISOString();
  }

  function markValidationStale(reason: string): void {
    validationStale = true;
    lastMutationAt = nowIso();
    lastMutationReason = reason;
    lastFullValidationAt = null;
    frontendTscOkAt = null;
    frontendBuildOkAt = null;
    backendTscOkAt = null;
    backendSmokeOkAt = null;
    delete bestValidationIssueMetrics.frontend_tsc;
    delete bestValidationIssueMetrics.frontend_build;
    delete bestValidationIssueMetrics.backend_tsc;
    delete bestValidationIssueMetrics.backend_smoke;
    console.log(`${label}: validation marked stale — ${reason}`);
  }

  function buildToolFingerprint(
    name: string,
    args: Record<string, unknown>,
    command: string,
  ): string | null {
    switch (name) {
      case "read_file":
        return `read_file:${String(args.path ?? "").trim()}`;
      case "list_files":
        return `list_files:${String(args.dir ?? ".").trim()}`;
      case "grep":
        return `grep:${String(args.path ?? ".").trim()}:${String(args.pattern ?? "").trim()}`;
      case "bash":
        return `bash:${command.replace(/\s+/g, " ").trim().slice(0, 180)}`;
      default:
        return null;
    }
  }

  function injectStagnationGuidance(
    reason: string,
    repeatedAction: string | null,
    escalated: boolean,
  ): void {
    if (escalated) {
      messages.push({
        role: "user",
        content: [
          "SYSTEM CORRECTION — ESCALATED: IntegrationVerifyFix has stagnated across multiple warnings.",
          `Reason: ${reason}`,
          repeatedAction ? `Repeated action: ${repeatedAction}` : "",
          "",
          "You MUST pick exactly ONE of the following actions on the NEXT turn. Do not read another file first.",
          "",
          "  1. `write_file` with a concrete, minimal code change that addresses the highest-priority failing gate. Even a partial fix is better than more reading.",
          "  2. `bash` command that makes progress (install a missing dep, run a scoped tsc, delete a residual duplicate file, etc.) — no read-only `ls`/`grep`.",
          "  3. `report_done(status='fail', summary=<one sentence naming the specific file and line you cannot resolve>)`. This is acceptable when you honestly cannot fix something — it is NOT acceptable to keep reading.",
          "",
          "Do not emit a plan, do not summarise what you've read. Your next tool call must be one of the three above.",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      return;
    }
    messages.push({
      role: "user",
      content: [
        "SYSTEM CORRECTION — IntegrationVerifyFix is stagnating.",
        `Reason: ${reason}`,
        repeatedAction ? `Repeated action: ${repeatedAction}` : "",
        "Stop rereading the same files. Switch to the highest-signal unresolved gate, make a concrete code change, then re-run scoped validation.",
        "Apply Phase 2.3 cluster priority order: P0 frontend shared API surface mismatch → P0 backend route registration → P1 backend Koa body / DTO typing → P1 backend JWT typing → P1 backend GET+validateBody → P2 JSX/template residuals → P3 leaf TS errors.",
        "If you see two HTTP clients in the frontend, collapse them to `frontend/src/api/client.ts` and rewrite imports BEFORE running another `tsc`.",
        "If duplicate implementations exist, choose the canonical path and remove or merge the residual copy.",
        "If dependency audit issues remain, fix package.json/import mismatches before doing more exploratory reads.",
        "If the blocker is a scaffold-protected file (e.g. `frontend/src/api/client.ts`), remember this phase permits overwriting protected scaffold files.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  function recordMeaningfulProgress(reason: string, amount = 1): void {
    progressScore = Math.min(
      MAX_INTEGRATION_PROGRESS_SCORE,
      progressScore + amount,
    );
    lastMeaningfulProgressIteration = iterations;
    lastMeaningfulProgressReason = reason;
    console.log(
      `${label}: progress recorded — ${reason} (score=${progressScore}/${MAX_INTEGRATION_PROGRESS_SCORE})`,
    );
  }

  function decayProgressScore(): void {
    progressScore = Math.max(0, progressScore - 1);
  }

  function noteValidationIssueTrend(
    kind: ScopedValidationKind,
    result: string,
  ): string | null {
    const metrics = extractScopedValidationIssueMetrics(kind, result);
    if (metrics === null) return null;
    const previousBest = bestValidationIssueMetrics[kind];
    if (!previousBest) {
      bestValidationIssueMetrics[kind] = metrics;
      return null;
    }
    if (!isValidationIssueMetricsImproved(metrics, previousBest)) {
      return null;
    }
    bestValidationIssueMetrics[kind] = metrics;
    return `validation_issue_metrics:${kind} files ${previousBest.files}->${metrics.files}, errors ${previousBest.errors}->${metrics.errors}`;
  }

  async function collectStructuralProgressReasons(): Promise<string[]> {
    const reasons: string[] = [];

    const dependencyAudit = await auditImportDependencyConsistency(
      state.outputDir,
    );
    if (dependencyAudit.remainingIssues.length < bestDependencyIssueCount) {
      reasons.push(
        `dependency_audit ${bestDependencyIssueCount}->${dependencyAudit.remainingIssues.length}`,
      );
      bestDependencyIssueCount = dependencyAudit.remainingIssues.length;
    }

    const currentRouteAudit = await auditApiRouteRegistration(state.outputDir);
    const routeIssueCount = countRouteAuditIssues(currentRouteAudit);
    if (routeIssueCount < bestRouteIssueCount) {
      reasons.push(`route_audit ${bestRouteIssueCount}->${routeIssueCount}`);
      bestRouteIssueCount = routeIssueCount;
    }

    const currentContractCompleteness = await auditContractCompleteness(
      state.outputDir,
    );
    const contractIssueCount = countContractCompletenessIssues(
      currentContractCompleteness,
    );
    if (contractIssueCount < bestContractCompletenessIssueCount) {
      reasons.push(
        `contract_completeness ${bestContractCompletenessIssueCount}->${contractIssueCount}`,
      );
      bestContractCompletenessIssueCount = contractIssueCount;
    }

    return reasons;
  }

  function getDynamicStagnationThresholds(): {
    warnAt: number;
    abortAt: number;
  } {
    const abortAt =
      BASE_INTEGRATION_STAGNATION_ABORT_ITERATIONS +
      progressScore * INTEGRATION_STAGNATION_ABORT_BONUS_PER_PROGRESS;
    const warnAt = Math.min(
      abortAt - 4,
      BASE_INTEGRATION_STAGNATION_WARNING_ITERATIONS +
        progressScore * INTEGRATION_STAGNATION_WARNING_BONUS_PER_PROGRESS,
    );
    return { warnAt, abortAt };
  }

  function markScopedValidationSuccess(kind: ScopedValidationKind): boolean {
    const ts = nowIso();
    const wasFrontendTscOk = !!frontendTscOkAt;
    const wasFrontendBuildOk = !!frontendBuildOkAt;
    const wasBackendTscOk = !!backendTscOkAt;
    const wasBackendSmokeOk = !!backendSmokeOkAt;
    bestValidationIssueMetrics[kind] = { files: 0, errors: 0 };
    if (kind === "frontend_tsc") frontendTscOkAt = ts;
    if (kind === "frontend_build") frontendBuildOkAt = ts;
    if (kind === "backend_tsc") backendTscOkAt = ts;
    if (kind === "backend_smoke") backendSmokeOkAt = ts;
    const frontendReady =
      !hasFrontend || (!!frontendTscOkAt && !!frontendBuildOkAt);
    const backendReady =
      !hasBackend || (!!backendTscOkAt && !!backendSmokeOkAt);
    if (frontendReady && backendReady) {
      validationStale = false;
      lastFullValidationAt = ts;
      console.log(
        `${label}: scoped validations now fresh — frontend_tsc=${frontendTscOkAt ?? "skip"} frontend_build=${frontendBuildOkAt ?? "skip"} backend_tsc=${backendTscOkAt ?? "skip"} backend_smoke=${backendSmokeOkAt ?? "skip"}`,
      );
    }
    return (
      (kind === "frontend_tsc" && !wasFrontendTscOk) ||
      (kind === "frontend_build" && !wasFrontendBuildOk) ||
      (kind === "backend_tsc" && !wasBackendTscOk) ||
      (kind === "backend_smoke" && !wasBackendSmokeOk)
    );
  }

  async function runFinalScopedValidationGates(): Promise<{
    pass: boolean;
    summary: string;
  }> {
    const failures: string[] = [];
    const passes: string[] = [];

    async function runCheck(
      name: string,
      command: string,
      cwd: string,
      kind: ScopedValidationKind,
    ): Promise<void> {
      const result = await shellExec(command, cwd, { timeout: 120_000 });
      const combined = `${result.stdout}${result.stderr}`.trim();
      if (result.exitCode === 0) {
        markScopedValidationSuccess(kind);
        passes.push(`${name}: pass`);
        return;
      }
      failures.push(
        `${name} failed:\n${combined.slice(0, 2000) || `exit_code=${result.exitCode}`}`,
      );
    }

    console.log(
      `${label}: running final scoped validation gates (stale=${validationStale}, lastMutationAt=${lastMutationAt ?? "never"})`,
    );

    if (hasFrontend) {
      await runCheck(
        "frontend_tsc",
        "npx tsc -p tsconfig.app.json --pretty false 2>&1",
        frontendDir,
        "frontend_tsc",
      );
      const frontendPm = await detectPackageManager(frontendDir);
      const frontendBuildCmd =
        frontendPm === "yarn"
          ? "yarn run build 2>&1"
          : frontendPm === "npm"
            ? "npm run build 2>&1"
            : "pnpm run build 2>&1";
      await runCheck(
        "frontend_build",
        frontendBuildCmd,
        frontendDir,
        "frontend_build",
      );
    } else {
      passes.push("frontend gates: skipped (frontend/package.json not found)");
    }

    if (hasBackend) {
      await runCheck(
        "backend_tsc",
        "npx tsc --noEmit --pretty false 2>&1",
        backendDir,
        "backend_tsc",
      );
      await runCheck(
        "backend_smoke",
        `npx tsx --eval "(async () => { const { existsSync } = await import('node:fs'); const dbCandidates = ['./src/db.ts', './src/config/database.ts', './src/database/connection.ts']; const dbEntry = dbCandidates.find((candidate) => existsSync(candidate)); if (dbEntry) { await import(dbEntry); if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing after importing backend database entry; ensure dotenv is loaded in the startup/database chain'); } const mod = await import('./src/app.ts'); const createApp = mod.createApp ?? mod.default?.createApp ?? mod.default; if (typeof createApp !== 'function') throw new Error('createApp export missing'); const app = await createApp(); if (!app || typeof app.callback !== 'function') throw new Error('createApp did not return a Koa app'); console.log('backend_smoke_ok'); })().catch((error) => { console.error(error instanceof Error ? (error.stack ?? error.message) : String(error)); process.exit(1); });" 2>&1`,
        backendDir,
        "backend_smoke",
      );
    } else {
      passes.push("backend gate: skipped (backend/package.json not found)");
    }

    const pass = failures.length === 0;
    if (pass) {
      validationStale = false;
      lastFullValidationAt = nowIso();
    }

    console.log(
      `${label}: final gates completed — pass=${pass} lastMutationAt=${lastMutationAt ?? "never"} lastFullValidationAt=${lastFullValidationAt ?? "never"} frontendTscOkAt=${frontendTscOkAt ?? "skip"} frontendBuildOkAt=${frontendBuildOkAt ?? "skip"} backendTscOkAt=${backendTscOkAt ?? "skip"} backendSmokeOkAt=${backendSmokeOkAt ?? "skip"}`,
    );

    return {
      pass,
      summary: [...passes, ...failures].join("\n\n"),
    };
  }

  console.log(
    `${label}: reasoning=${integrationReasoningOptions.reasoning?.enabled === false ? "off" : integrationReasoningOptions.reasoning ? `on(${integrationReasoningOptions.reasoning.effort ?? "medium"})` : "off"} thinking=${integrationReasoningOptions.thinking ? `on(${integrationReasoningOptions.thinking.thinking_effort ?? "medium"}/${integrationReasoningOptions.thinking.verbosity ?? "medium"})` : "off"}`,
  );

  /**
   * Context compression: when messages exceed ~20k tokens, compact the middle
   * portion into a summary, keeping system prompt + last 6 messages.
   */
  function compactMessagesIfNeeded(): void {
    const COMPACT_THRESHOLD = 20_000 * 4;
    const KEEP_TAIL = 6;
    const totalChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
      0,
    );
    if (totalChars < COMPACT_THRESHOLD) return;

    const systemMsg = messages[0];
    const desiredStart = Math.max(1, messages.length - KEEP_TAIL);
    const tailStart = calculateSafeTailStart(messages, desiredStart);
    const tail = messages.slice(tailStart);
    const middle = messages.slice(1, tailStart);

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
      `Validation state:\n` +
      `- stale: ${validationStale}\n` +
      `- last mutation: ${lastMutationAt ?? "never"} (${lastMutationReason})\n` +
      `- progress score: ${progressScore}/${MAX_INTEGRATION_PROGRESS_SCORE}\n` +
      `- last meaningful progress: iteration ${lastMeaningfulProgressIteration || 0} (${lastMeaningfulProgressReason})\n` +
      `- last full validation: ${lastFullValidationAt ?? "never"}\n` +
      `- frontend tsc ok at: ${frontendTscOkAt ?? "never"}\n` +
      `- frontend build ok at: ${frontendBuildOkAt ?? "never"}\n` +
      `- backend tsc ok at: ${backendTscOkAt ?? "never"}\n` +
      `- backend smoke ok at: ${backendSmokeOkAt ?? "never"}\n` +
      `Previous actions summary:\n${actionLines.slice(-30).join("\n")}`;

    messages.splice(
      0,
      messages.length,
      systemMsg,
      { role: "assistant", content: summary },
      ...tail,
    );
    const removed = countRemovedOrphanToolMessages(messages);
    console.log(
      `${label}: context compacted — removed ${middle.length} messages (was ~${Math.round(totalChars / 4)} tokens), orphan_tools_removed=${removed}`,
    );
  }

  while (iterations < MAX_ITER) {
    iterations++;
    console.log(`${label}: iteration ${iterations}/${MAX_ITER}`);

    compactMessagesIfNeeded();

    let resp;
    try {
      resp = await callWithOrphanToolRetry(label, messages, modelChain, {
        temperature: 0.2,
        max_tokens: 36000,
        tools: SUPERVISOR_VERIFY_TOOLS,
        tool_choice: "auto",
        ...integrationReasoningOptions,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`${label}: LLM call failed: ${msg}`);
      break;
    }

    const choice = resp.choices[0];
    totalCostUsd += estimateCost(resp.model, resp.usage);
    recordSupervisorLlmUsage({
      sessionId: state.sessionId,
      stage: "integration_verify_fix",
      model: resp.model,
      usage: resp.usage,
      costUsd: estimateCost(resp.model, resp.usage),
    });

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
    let iterationMutated = false;
    let iterationValidationProgress = false;
    const iterationProgressReasons: string[] = [];
    const iterationReadOnlyFingerprints: string[] = [];
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        /* ignore */
      }

      if (tc.function.name === "report_done") {
        const reportedStatus = (args.status as "pass" | "fail") ?? "fail";

        // Guard: reject report_done(pass) when validation results are stale.
        // The agent MUST re-run all 4 scoped validation commands after any write_file
        // before it is allowed to claim a passing integration.
        if (reportedStatus === "pass" && validationStale) {
          const buildCmd =
            pm === "yarn" ? "yarn run build" : pm === "npm" ? "npm run build" : "pnpm run build";
          const rejectionMsg = [
            "REJECTED: report_done(pass) is not allowed — validation results are STALE.",
            `Last filesystem mutation: ${lastMutationAt ?? "unknown"} (${lastMutationReason ?? "unknown"})`,
            "You MUST re-run the FULL 4-command validation sequence after your last write_file:",
            `  1. cd frontend && npx tsc -p tsconfig.app.json --pretty false 2>&1`,
            `  2. cd frontend && ${buildCmd} 2>&1`,
            `  3. cd backend && npx tsc --noEmit --pretty false 2>&1`,
            `  4. cd backend && npx tsx --eval "(async()=>{const m=await import('./src/app.ts');const f=m.createApp??m.default?.createApp??m.default;if(typeof f!=='function')throw new Error('createApp missing');const a=await f();if(!a||typeof a.callback!=='function')throw new Error('not a Koa app');console.log('backend_smoke_ok');})()" 2>&1`,
            "All 4 must succeed (exit 0) before you may call report_done(pass).",
          ].join("\n");
          console.log(
            `${label}: REJECTED report_done(pass) — stale validation (lastMutation=${lastMutationAt ?? "never"})`,
          );
          messages.push({
            role: "tool",
            content: rejectionMsg,
            tool_call_id: tc.id,
            name: "report_done",
          });
          continue;
        }

        finalStatus = reportedStatus;
        finalSummary = String(args.summary ?? "");
        doneSignaled = true;
        console.log(
          `${label}: report_done status=${finalStatus} stale=${validationStale} lastMutationAt=${lastMutationAt ?? "never"} — ${finalSummary.slice(0, 120)}`,
        );
        messages.push({
          role: "tool",
          content: "acknowledged",
          tool_call_id: tc.id,
          name: "report_done",
        });
      } else {
        const command =
          tc.function.name === "bash" ? String(args.command ?? "") : "";
        if (
          tc.function.name === "bash" &&
          isValidationLikeBashCommand(command) &&
          !detectScopedValidationKind(command)
        ) {
          const result =
            "Error: validation commands in IntegrationVerifyFix must be scoped to `frontend/` or `backend/` only. " +
            "Use commands like `cd frontend && npx tsc -p tsconfig.app.json --pretty false 2>&1`, " +
            "`cd frontend && pnpm run build 2>&1`, or `cd backend && npx tsc --noEmit --pretty false 2>&1`.";
          console.log(
            `${label}: rejected unscoped validation command=${command.slice(0, 120)}`,
          );
          messages.push({
            role: "tool",
            content: result,
            tool_call_id: tc.id,
            name: tc.function.name,
          });
          continue;
        }
        const result = await executeSupervisorTool(
          tc.function.name,
          args,
          state.outputDir,
        );
        const fingerprint = buildToolFingerprint(
          tc.function.name,
          args,
          command,
        );
        if (tc.function.name === "write_file") {
          iterationMutated = true;
          markValidationStale(`write_file:${String(args.path ?? "")}`);
        } else if (
          tc.function.name === "bash" &&
          isSuccessfulSupervisorToolResult(result)
        ) {
          const validationKind = detectScopedValidationKind(command);
          if (validationKind) {
            if (markScopedValidationSuccess(validationKind)) {
              iterationValidationProgress = true;
              iterationProgressReasons.push(
                `scoped_validation:${validationKind}`,
              );
            }
          } else if (isMutatingSupervisorBashCommand(command)) {
            iterationMutated = true;
            markValidationStale(`mutating bash:${command.slice(0, 80)}`);
          }
        } else if (tc.function.name === "bash") {
          const validationKind = detectScopedValidationKind(command);
          if (validationKind) {
            const trendReason = noteValidationIssueTrend(
              validationKind,
              result,
            );
            if (trendReason) {
              iterationValidationProgress = true;
              iterationProgressReasons.push(trendReason);
            }
          } else if (isMutatingSupervisorBashCommand(command)) {
            iterationMutated = true;
            markValidationStale(`mutating bash:${command.slice(0, 80)}`);
          }
        }
        if (
          !iterationMutated &&
          fingerprint &&
          tc.function.name !== "report_done" &&
          tc.function.name !== "write_file"
        ) {
          iterationReadOnlyFingerprints.push(fingerprint);
        }
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

    if (iterationMutated && !doneSignaled) {
      const structuralProgressReasons =
        await collectStructuralProgressReasons();
      if (structuralProgressReasons.length > 0) {
        iterationValidationProgress = true;
        iterationProgressReasons.push(...structuralProgressReasons);
      }
    }

    if (iterationMutated) {
      const mutationReason =
        iterationProgressReasons.length > 0
          ? `filesystem mutation (${lastMutationReason}); ${iterationProgressReasons.join(", ")}`
          : `filesystem mutation (${lastMutationReason})`;
      recordMeaningfulProgress(mutationReason, 2);
      consecutiveNoMutationIterations = 0;
      stagnationWarningsWithoutProgress = 0;
      repeatedReadOnlyActionCounts.clear();
    } else if (iterationValidationProgress) {
      recordMeaningfulProgress(
        `validation progress (${iterationProgressReasons.join(", ")})`,
        1,
      );
      consecutiveNoMutationIterations = 0;
      stagnationWarningsWithoutProgress = 0;
      repeatedReadOnlyActionCounts.clear();
    } else if (!doneSignaled) {
      consecutiveNoMutationIterations += 1;
      decayProgressScore();
      const uniqueFingerprints: string[] = [
        ...new Set(iterationReadOnlyFingerprints),
      ];
      for (const fingerprint of uniqueFingerprints) {
        repeatedReadOnlyActionCounts.set(
          fingerprint,
          (repeatedReadOnlyActionCounts.get(fingerprint) ?? 0) + 1,
        );
      }
      const mostRepeatedEntry = [
        ...repeatedReadOnlyActionCounts.entries(),
      ].sort((a, b) => b[1] - a[1])[0];
      const repeatedAction =
        mostRepeatedEntry && mostRepeatedEntry[1] >= 3
          ? `${mostRepeatedEntry[0]} × ${mostRepeatedEntry[1]}`
          : null;
      const { warnAt, abortAt } = getDynamicStagnationThresholds();
      if (
        (consecutiveNoMutationIterations >= warnAt || repeatedAction) &&
        iterations - lastStagnationGuidanceAt >= 2
      ) {
        stagnationWarningsWithoutProgress += 1;
        const escalated =
          stagnationWarningsWithoutProgress >=
          STAGNATION_ESCALATION_WARNING_COUNT;
        injectStagnationGuidance(
          `No filesystem mutation for ${consecutiveNoMutationIterations} iteration(s). Dynamic warn threshold=${warnAt}, abort threshold=${abortAt}. Warning #${stagnationWarningsWithoutProgress}.`,
          repeatedAction,
          escalated,
        );
        lastStagnationGuidanceAt = iterations;
        getRepairEmitter(state.sessionId)({
          stage: "integration-gate",
          event: "stagnation_warning",
          details: {
            iterationsWithoutMutation: consecutiveNoMutationIterations,
            warnAt,
            abortAt,
            progressScore,
            warningNumber: stagnationWarningsWithoutProgress,
            escalated,
            repeatedAction: repeatedAction ?? "none",
          },
        });
      }
      if (consecutiveNoMutationIterations >= abortAt) {
        finalStatus = "fail";
        finalSummary = [
          "IntegrationVerifyFix stalled without making code changes.",
          `No mutation for ${consecutiveNoMutationIterations} consecutive iteration(s).`,
          `Dynamic stagnation threshold reached: abortAt=${abortAt}, progressScore=${progressScore}/${MAX_INTEGRATION_PROGRESS_SCORE}.`,
          `Last meaningful progress: iteration ${lastMeaningfulProgressIteration || 0} (${lastMeaningfulProgressReason}).`,
          repeatedAction ? `Most repeated action: ${repeatedAction}` : "",
          "Aborting instead of spending more iterations rereading the same files.",
        ]
          .filter(Boolean)
          .join("\n");
        console.warn(`${label}: aborting due to stagnation.`);
        break;
      }
    }

    if (doneSignaled) break;
  }

  // Always enforce final scoped validation gates before exiting.
  if (!finalSummary && finalStatus === "fail") {
    finalSummary = "No report_done received from IntegrationVerifyFix.";
  }

  const finalGateResult = await runFinalScopedValidationGates();
  const finalDependencyAudit = await auditImportDependencyConsistency(
    state.outputDir,
  );
  const finalRouteAudit = await auditApiRouteRegistration(state.outputDir);
  const finalContractCompleteness = await auditContractCompleteness(
    state.outputDir,
  );
  const finalApiClientUniqueness = await auditFrontendApiClientUniqueness(
    state.outputDir,
  );
  if (!finalGateResult.pass) {
    finalStatus = "fail";
    finalSummary = [
      finalSummary,
      "Final scoped validation gates failed:",
      finalGateResult.summary,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
  } else if (finalStatus === "pass") {
    finalSummary = [finalSummary, "Final scoped validation gates passed."]
      .filter(Boolean)
      .join("\n\n");
  }

  const finalRouteAuditHardFail =
    finalRouteAudit.unregisteredModules.length > 0 ||
    finalRouteAudit.unresolvedRegistrations.length > 0 ||
    finalRouteAudit.missingContractEndpoints.length > 0;
  getRepairEmitter(state.sessionId)({
    stage: "integration-gate",
    event: "route_audit_snapshot",
    details: {
      when: "final",
      hardFail: finalRouteAuditHardFail,
      unregisteredModules: finalRouteAudit.unregisteredModules,
      unresolvedRegistrations: finalRouteAudit.unresolvedRegistrations,
      missingContractEndpoints: finalRouteAudit.missingContractEndpoints,
      undeclaredEndpointCount: finalRouteAudit.undeclaredEndpoints.length,
    },
  });
  if (finalRouteAuditHardFail) {
    finalStatus = "fail";
    finalSummary = [
      finalSummary,
      "Backend route registration gate failed:",
      finalRouteAudit.findings.join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
    getRepairEmitter(state.sessionId)({
      stage: "integration-gate",
      event: "route_registration_audit_failed",
      details: {
        unregisteredModules: finalRouteAudit.unregisteredModules,
        unresolvedRegistrations: finalRouteAudit.unresolvedRegistrations,
        missingContractEndpoints: finalRouteAudit.missingContractEndpoints,
      },
    });
  }

  const finalContractCompletenessHardFail =
    finalContractCompleteness.missingScopedEndpoints.length > 0;
  getRepairEmitter(state.sessionId)({
    stage: "integration-gate",
    event: "contract_completeness_snapshot",
    details: {
      when: "final",
      hardFail: finalContractCompletenessHardFail,
      warnOnly: finalContractCompleteness.warnOnly,
      inferredRelationshipCount:
        finalContractCompleteness.inferredRelationships.length,
      missingScopedEndpoints: finalContractCompleteness.missingScopedEndpoints,
      warnOnlyEndpoints: finalContractCompleteness.warnOnlyEndpoints,
    },
  });
  if (finalContractCompletenessHardFail) {
    finalStatus = "fail";
    finalSummary = [
      finalSummary,
      "Contract completeness gate failed:",
      finalContractCompleteness.findings.join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
    getRepairEmitter(state.sessionId)({
      stage: "integration-gate",
      event: "contract_completeness_failed",
      details: {
        missingScopedEndpoints:
          finalContractCompleteness.missingScopedEndpoints,
      },
    });
  }

  const finalApiClientUniquenessHardFail =
    finalApiClientUniqueness.parallelClients.length > 0;
  getRepairEmitter(state.sessionId)({
    stage: "integration-gate",
    event: "frontend_api_client_uniqueness_snapshot",
    details: {
      when: "final",
      hardFail: finalApiClientUniquenessHardFail,
      canonical: finalApiClientUniqueness.canonical,
      parallelClients: finalApiClientUniqueness.parallelClients,
    },
  });
  if (finalApiClientUniquenessHardFail) {
    finalStatus = "fail";
    finalSummary = [
      finalSummary,
      "Frontend API client uniqueness gate failed:",
      finalApiClientUniqueness.findings.join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
    getRepairEmitter(state.sessionId)({
      stage: "integration-gate",
      event: "frontend_api_client_uniqueness_failed",
      details: {
        canonical: finalApiClientUniqueness.canonical,
        parallelClients: finalApiClientUniqueness.parallelClients,
      },
    });
  }

  if (finalDependencyAudit.remainingIssues.length > 0) {
    finalStatus = "fail";
    finalSummary = [
      finalSummary,
      "Dependency consistency gate failed:",
      finalDependencyAudit.summary,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
  } else if (finalSummary.startsWith("No report_done received")) {
    // P0-E: do NOT auto-pass when the integration loop never emitted report_done.
    // Compile/build passing is not evidence that PRD features are implemented —
    // let the downstream feature-checklist audit make the final call. Emit a
    // repair event so the front-end can surface this honestly.
    finalStatus = "fail";
    finalSummary = [
      finalSummary,
      "Final scoped validation gates passed, but IntegrationVerifyFix never emitted report_done.",
      "Treating as FAIL so downstream feature audit can arbitrate (compile ≠ feature-complete).",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
    getRepairEmitter(state.sessionId)({
      stage: "integration-gate",
      event: "missing_report_done",
      details: {
        reason:
          "IntegrationVerifyFix loop exhausted without report_done; compile/build gates alone cannot confirm feature completeness.",
        iterations,
      },
    });
  }

  console.log(
    `${label}: done — status=${finalStatus} iterations=${iterations} cost=$${totalCostUsd.toFixed(4)} lastMutationAt=${lastMutationAt ?? "never"} lastFullValidationAt=${lastFullValidationAt ?? "never"}`,
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
    .addNode("dependency_baseline", dependencyBaseline)
    .addNode("generate_api_contracts", generateApiContracts)
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
    .addNode("e2e_verify", e2eVerifyAndFix)
    .addNode("summary", summary)

    .addEdge(START, "classify_tasks")
    .addEdge("classify_tasks", "architect_phase")
    .addEdge("architect_phase", "scaffold_verify")
    .addConditionalEdges("scaffold_verify", shouldFixScaffoldOrContinue, {
      dispatch: "dispatch_gate",
      scaffold_fix: "scaffold_fix",
    })
    .addEdge("scaffold_fix", "scaffold_verify")
    .addEdge("dispatch_gate", "dependency_baseline")
    .addEdge("dependency_baseline", "generate_api_contracts")
    .addConditionalEdges(
      "generate_api_contracts",
      dispatchBackendAndTestWorkers,
    )
    .addEdge("be_worker", "be_phase_verify")
    .addEdge("be_phase_verify", "extract_real_contracts")
    .addEdge("extract_real_contracts", "fe_dispatch_gate")
    .addConditionalEdges("fe_dispatch_gate", dispatchFrontendWorkers)
    .addEdge("fe_worker", "fe_phase_verify")
    .addEdge("fe_phase_verify", "sync_deps")
    .addEdge("sync_deps", "integration_verify")
    .addConditionalEdges("integration_verify", routeAfterIntegrationVerify, {
      e2e_verify: "e2e_verify",
      summary: "summary",
    })
    .addConditionalEdges("e2e_verify", routeAfterE2eVerify, {
      e2e_verify: "e2e_verify",
      summary: "summary",
    })
    .addEdge("summary", END);

  return graph.compile();
}

export function createIntegrationRetryGraph() {
  const graph = new StateGraph(SupervisorStateAnnotation)
    .addNode("integration_verify", integrationVerifyAndFix)
    .addNode("summary", summary)
    .addEdge(START, "integration_verify")
    .addEdge("integration_verify", "summary")
    .addEdge("summary", END);

  return graph.compile();
}

export function createE2eRetryGraph() {
  const graph = new StateGraph(SupervisorStateAnnotation)
    .addNode("e2e_verify", e2eVerifyAndFix)
    .addNode("summary", summary)
    .addEdge(START, "e2e_verify")
    .addConditionalEdges("e2e_verify", routeAfterE2eVerify, {
      e2e_verify: "e2e_verify",
      summary: "summary",
    })
    .addEdge("summary", END);

  return graph.compile();
}
