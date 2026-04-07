import { StateGraph, START, END, Send } from "@langchain/langgraph";
import {
  SupervisorStateAnnotation,
  type SupervisorState,
  type WorkerState,
  type PhaseResult,
  type GeneratedFile,
} from "./state";
import { createWorkerSubGraph } from "./agent-subgraph";
import { shellExec, fsWrite, fsRead, listFiles } from "./tools";
import {
  chatCompletion,
  resolveModel,
  estimateCost,
  type ChatMessage,
} from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";
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
  if (/scaffold|infra|docker|helm|ci\/cd|deploy|config|schema|migrat/.test(lower))
    return "architect";
  if (/frontend|react|component|page|ui|css|tailwind|hook|store|vite/.test(lower))
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
    console.log("[Supervisor] Detected frontend-only project (no backend tasks).");
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

async function runArchitectPhase(state: SupervisorState) {
  if (state.architectTasks.length === 0) {
    console.log("[Supervisor] Architect phase: no tasks, skipping.");
    return {};
  }

  console.log(`[Supervisor] Architect phase: starting ${state.architectTasks.length} tasks...`);
  const result = await workerGraph.invoke(
    {
      role: "architect" as CodingAgentRole,
      workerLabel: "Architect",
      tasks: state.architectTasks,
      outputDir: state.outputDir,
      projectContext: state.projectContext,
      fileRegistrySnapshot: state.fileRegistry,
      apiContractsSnapshot: state.apiContracts,
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

  console.log(`[Supervisor] Architect phase done: ${workerState.taskResults.length} task results, ${workerState.generatedFiles.length} files.`);

  return {
    phaseResults: [phaseResult],
    fileRegistry: workerState.generatedFiles,
    totalCostUsd: workerState.workerCostUsd,
  };
}

// ─── Scaffold verification (Strategy C) ───

const MAX_SCAFFOLD_FIX_ATTEMPTS = 2;
const SCAFFOLD_INSTALL_TIMEOUT_MS = 60_000;
const SCAFFOLD_BUILD_TIMEOUT_MS = 60_000;

async function scaffoldVerify(state: SupervisorState) {
  console.log("[Supervisor] Scaffold verify: running npm install...");

  const installResult = await shellExec(
    "npm install --prefer-offline 2>&1 | tail -20",
    state.outputDir,
    { timeout: SCAFFOLD_INSTALL_TIMEOUT_MS },
  );

  if (installResult.exitCode !== 0) {
    const errorMsg = `npm install failed (exit ${installResult.exitCode}):\n${installResult.stderr || installResult.stdout}`.slice(0, 2000);
    console.log(`[Supervisor] Scaffold verify: npm install FAILED.\n${errorMsg.slice(0, 300)}`);
    return { scaffoldErrors: errorMsg };
  }

  console.log("[Supervisor] Scaffold verify: npm install OK. Running npm run build...");
  const buildResult = await shellExec(
    "npm run build 2>&1 | tail -40",
    state.outputDir,
    { timeout: SCAFFOLD_BUILD_TIMEOUT_MS },
  );

  if (buildResult.exitCode !== 0) {
    const errorMsg = `npm run build failed (exit ${buildResult.exitCode}):\n${buildResult.stderr || buildResult.stdout}`.slice(0, 2000);
    console.log(`[Supervisor] Scaffold verify: build FAILED.\n${errorMsg.slice(0, 300)}`);
    return { scaffoldErrors: errorMsg };
  }

  console.log("[Supervisor] Scaffold verify: build OK. Scaffold is runnable.");
  return { scaffoldErrors: "" };
}

function shouldFixScaffoldOrContinue(state: SupervisorState): string {
  if (!state.scaffoldErrors) return "dispatch";
  if (state.scaffoldFixAttempts >= MAX_SCAFFOLD_FIX_ATTEMPTS) {
    console.log(`[Supervisor] Scaffold fix: max attempts (${MAX_SCAFFOLD_FIX_ATTEMPTS}) reached, proceeding anyway.`);
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
  console.log(`[Supervisor] Scaffold fix: attempt ${attempt}/${MAX_SCAFFOLD_FIX_ATTEMPTS}...`);

  const errorFiles = extractBuildErrorFiles(state.scaffoldErrors);
  const fileContents: string[] = [];
  for (const ef of errorFiles.slice(0, 5)) {
    const content = await fsRead(ef, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileContents.push(`### ${ef}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``);
    }
  }

  const configFiles = ["package.json", "vite.config.ts", "tsconfig.json", "index.html", "next.config.mjs", "next.config.ts"];
  for (const cf of configFiles) {
    if (errorFiles.includes(cf)) continue;
    const content = await fsRead(cf, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileContents.push(`### ${cf}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``);
    }
  }

  const model = resolveModel(MODEL_CONFIG.codeFix);
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
        fileContents.length > 0 ? `## Current Files\n${fileContents.join("\n\n")}` : "",
        "",
        "Fix all errors so npm install && npm run build passes. Output corrected files.",
      ].join("\n"),
    },
  ];

  const response = await chatCompletion(messages, {
    model,
    temperature: 0.2,
    max_tokens: 16384,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const costUsd = estimateCost(response.model, response.usage);
  const fixes = parseFileOutput(content);

  const fixedFiles: GeneratedFile[] = [];
  for (const [fp, fc] of Object.entries(fixes)) {
    await fsWrite(fp, fc, state.outputDir);
    fixedFiles.push({
      path: fp,
      role: "architect",
      summary: `Scaffold fix attempt ${attempt}`,
    });
  }

  console.log(`[Supervisor] Scaffold fix: wrote ${fixedFiles.length} files (cost: $${costUsd.toFixed(4)})`);

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

// ─── Parallel dispatch ───

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
    console.log(`[Supervisor] Parallel worker ${input.workerLabel}: no tasks, skipping.`);
    return {};
  }

  console.log(`[Supervisor] Parallel worker ${input.workerLabel}: starting ${input.tasks.length} tasks...`);
  const result = await workerGraph.invoke(input, { recursionLimit: 150 });
  const workerState = result as WorkerState;

  const phaseResult: PhaseResult = {
    role: input.role,
    workerLabel: input.workerLabel,
    taskResults: workerState.taskResults,
    totalCostUsd: workerState.workerCostUsd,
  };

  console.log(`[Supervisor] Parallel worker ${input.workerLabel} done: ${workerState.taskResults.length} results.`);

  return {
    phaseResults: [phaseResult],
    fileRegistry: workerState.generatedFiles,
    totalCostUsd: workerState.workerCostUsd,
  };
}

// ─── Dependency sync: scan imports → install missing packages ───

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "http2",
  "https", "inspector", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream",
  "string_decoder", "sys", "timers", "tls", "trace_events", "tty", "url",
  "util", "v8", "vm", "wasi", "worker_threads", "zlib",
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

async function syncDeps(state: SupervisorState) {
  console.log("[Supervisor] syncDeps: scanning imports...");

  const files = await listFiles(".", state.outputDir);
  const sourceFiles = files.filter((f) =>
    /\.(tsx?|jsx?|mjs|cjs)$/.test(f) && !f.includes("node_modules"),
  );

  const importedPkgs = new Set<string>();
  for (const file of sourceFiles) {
    const content = await fsRead(file, state.outputDir);
    if (content.startsWith("FILE_NOT_FOUND") || content.startsWith("REJECTED")) continue;

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

  if (importedPkgs.size === 0) {
    console.log("[Supervisor] syncDeps: no external imports found.");
    return {};
  }

  const pkgJsonContent = await fsRead("package.json", state.outputDir);
  if (pkgJsonContent.startsWith("FILE_NOT_FOUND")) {
    console.log("[Supervisor] syncDeps: no package.json found, skipping.");
    return {};
  }

  let pkgJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkgJson = JSON.parse(pkgJsonContent);
  } catch {
    console.warn("[Supervisor] syncDeps: invalid package.json, skipping.");
    return {};
  }

  const declared = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ]);

  const missing = [...importedPkgs].filter((pkg) => !declared.has(pkg));

  if (missing.length === 0) {
    console.log("[Supervisor] syncDeps: all imports satisfied.");
    return {};
  }

  console.log(`[Supervisor] syncDeps: ${missing.length} missing → ${missing.join(", ")}`);

  const installCmd = `npm install --save ${missing.join(" ")} 2>&1 | tail -10`;
  const { stdout, stderr, exitCode } = await shellExec(installCmd, state.outputDir, {
    timeout: 120_000,
  });

  if (exitCode === 0) {
    console.log(`[Supervisor] syncDeps: installed ${missing.length} packages OK.`);
  } else {
    console.warn(
      `[Supervisor] syncDeps: npm install exited ${exitCode}. stderr: ${(stderr || stdout).slice(0, 300)}`,
    );
  }

  return {};
}

async function integrationVerify(state: SupervisorState) {
  const { stderr, exitCode } = await shellExec(
    "npx tsc --noEmit 2>&1 | tail -40",
    state.outputDir,
  );

  const hasErrors = exitCode !== 0 && stderr && /error TS/.test(stderr);
  return {
    integrationErrors: hasErrors ? stderr.slice(-2000) : "",
  };
}

function shouldFixIntegrationOrSummarize(state: SupervisorState): string {
  if (!state.integrationErrors) return "summary";
  if (state.integrationFixAttempts >= 2) return "summary";
  return "integration_fix";
}

async function integrationFix(state: SupervisorState) {
  return {
    integrationFixAttempts: state.integrationFixAttempts + 1,
    integrationErrors: "",
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
  const graph = new StateGraph(SupervisorStateAnnotation)
    .addNode("classify_tasks", classifyTasks)
    .addNode("architect_phase", runArchitectPhase)
    .addNode("scaffold_verify", scaffoldVerify)
    .addNode("scaffold_fix", scaffoldFix)
    .addNode("dispatch_gate", dispatchGate)
    .addNode("parallel_worker", parallelWorkerNode)
    .addNode("sync_deps", syncDeps)
    .addNode("integration_verify", integrationVerify)
    .addNode("integration_fix", integrationFix)
    .addNode("summary", summary)

    .addEdge(START, "classify_tasks")
    .addEdge("classify_tasks", "architect_phase")
    .addEdge("architect_phase", "scaffold_verify")
    .addConditionalEdges(
      "scaffold_verify",
      shouldFixScaffoldOrContinue,
      {
        dispatch: "dispatch_gate",
        scaffold_fix: "scaffold_fix",
      },
    )
    .addEdge("scaffold_fix", "scaffold_verify")
    .addConditionalEdges("dispatch_gate", dispatchParallelWorkers)
    .addEdge("parallel_worker", "sync_deps")
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
