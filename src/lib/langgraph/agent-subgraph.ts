import path from "path";
import { StateGraph, START, END } from "@langchain/langgraph";
import {
  WorkerStateAnnotation,
  type WorkerState,
  type GeneratedFile,
  type TaskResult,
} from "./state";
import {
  fsWrite,
  fsRead,
  shellExec,
  listFiles,
  detectPackageManager,
  buildAddCommand,
  isAutoInstallableNpmPackageName,
} from "./tools";
import { estimateCost, type ChatMessage, chatCompletionWithFallback } from "@/lib/openrouter";
import { invokeCodegenOrOpenRouter } from "@/lib/codegen-openai-compatible";
import { resolveModel } from "@/lib/openrouter";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import type { CodingAgentRole, CodingTask, TaskSubStep } from "@/lib/pipeline/types";
import { ProgressTracker } from "@/lib/ralph";

const MAX_OUTPUT_TOKENS = 16384;
const MAX_TASK_GENERATION_RETRIES = 2;
/** Per-task tsc fix attempts when RALPH is off. */
const MAX_FIX_ATTEMPTS = 1;
/** Per-task tsc fix attempts cap when RALPH is on. */
const MAX_PER_TASK_FIX_ATTEMPTS = 3;

/** Approximate maximum context window for context-rotation threshold calculations. */
const MAX_CONTEXT_TOKENS = 200_000;

/** The exact string the LLM must output to signal intentional task completion. */
const RALPH_COMPLETE_TOKEN = "<promise>TASK_COMPLETE</promise>";
const RALPH_FAILED_RE = /<promise>TASK_FAILED:\s*([\s\S]*?)<\/promise>/;

/**
 * Vite alias rules injected into every frontend (and test) prompt.
 * The scaffolds configure `@` → `./src` in both vite.config.ts and tsconfig paths.
 */
const VITE_ALIAS_RULES = `
## Import path rules (VITE ALIAS — MANDATORY)
The project uses Vite with \`@\` mapped to \`./src\` (configured in vite.config.ts + tsconfig paths).

ALWAYS use the \`@/\` alias for any import that crosses directory boundaries:
  ✅  import Button from '@/components/Button'
  ✅  import { useAuth } from '@/hooks/useAuth'
  ✅  import { apiClient } from '@/lib/apiClient'
  ✅  import type { User } from '@/types/user'
  ✅  import styles from '@/assets/styles.css'
  ✅  import HomePage from '@/pages/Home'

ONLY use relative imports for files in the SAME directory:
  ✅  import { helper } from './helper'        (same folder)
  ❌  import { helper } from '../lib/helper'   (going up — use @/lib/helper instead)
  ❌  import Button from '../../components/Button'  (going up — use @/components/Button)

For monorepo shared packages use the workspace alias, NOT a relative path:
  ✅  import type { User } from '@project/shared/types/user'
  ❌  import type { User } from '../../../packages/shared/src/types/user'
`;

const ROLE_PROMPTS: Record<CodingAgentRole, string> = {
  architect: `You are a Senior Software Architect Agent.
Generate scaffolding/config/shared foundations for the assigned task.

Rules:
- Follow the scaffold and task scope; prefer extending existing files over creating duplicate structures.
- Use valid JSON/TS syntax.
- For shared package imports, use \`@project/shared/types/*\` and \`@project/shared/schemas/*\` (never \`@shared/*\`).
- For Zod naming, use \`camelCaseSchema\` for runtime values and \`*Input\` / \`*Dto\` for inferred types.
- When generating vite.config.ts, ALWAYS include the \`@\` alias: \`resolve: { alias: { '@': path.resolve(__dirname, './src') } }\`.
- When generating tsconfig.json for a Vite project, ALWAYS include: \`"paths": { "@/*": ["./src/*"] }\` under compilerOptions.
${VITE_ALIAS_RULES}
For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.

When you have successfully generated all required files, end your response with exactly:
${RALPH_COMPLETE_TOKEN}
If you cannot complete the task, end with: <promise>TASK_FAILED: <reason></promise>`,

  frontend: `You are a Senior Frontend Engineer Agent.
Generate React + TypeScript + Tailwind code for the assigned task.

Rules:
- Keep routing/page structure consistent with existing project layout.
- For shared package imports, use \`@project/shared/types/*\` and \`@project/shared/schemas/*\` (never \`@shared/*\`, never \`@repo/shared/*\`).
- When Design Tokens are provided in context, implement them accurately in UI code.
- Keep edits scoped to this task.
- ALWAYS type every event handler and callback parameter explicitly:
    ✅  (e: React.ChangeEvent<HTMLInputElement>) => ...
    ✅  (e: React.FormEvent<HTMLFormElement>) => ...
    ✅  (e: React.MouseEvent<HTMLButtonElement>) => ...
    ❌  (e) => ...   // implicit any — forbidden
- ALWAYS type every function parameter and return value; never rely on implicit \`any\`.
- Only import from files that are listed in "Already generated files" or in this task's file hints.
  If a dependency file does not exist yet, create a minimal stub for it in this same response.
${VITE_ALIAS_RULES}
For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.

When you have successfully generated all required files, end your response with exactly:
${RALPH_COMPLETE_TOKEN}
If you cannot complete the task, end with: <promise>TASK_FAILED: <reason></promise>`,

  backend: `You are a Senior Backend Engineer Agent.
Generate backend code (routes/services/domain logic) for the assigned task.

Rules:
- Keep exports/imports consistent with existing modules and contracts.
- For shared package imports, use \`@project/shared/types/*\` and \`@project/shared/schemas/*\` (never \`@shared/*\`, never \`@repo/shared/*\`).
- Use \`camelCaseSchema\` values and \`*Input\` / \`*Dto\` inferred types.
- Backend (Node/Express/Fastify) does NOT use Vite aliases. Use relative imports or Node path aliases if configured.
- Keep edits scoped to this task.
- **Prisma rule (MANDATORY)**: If the task uses \`@prisma/client\` or creates any \`prisma.*\` helper, you MUST output \`prisma/schema.prisma\` with:
  - A \`generator client\` block (\`provider = "prisma-client-js"\`).
  - A \`datasource db\` block for PostgreSQL: \`provider = "postgresql"\` and \`url = env("DATABASE_URL")\` (standard Prisma 5/6; the repo root \`.env\` is created at scaffold time).
  - All model definitions.
  Do NOT add \`prisma.config.ts\` unless the project already uses Prisma 7 with that layout.
- Stick to the framework already in the project. If \`apps/api/package.json\` depends on **Express**, use Express. Do not introduce Fastify, Hapi, or any other HTTP framework unless the scaffold explicitly uses it.
- Express request params/query/headers typing rules (MANDATORY):
    - \`req.params\` is \`Record<string, string>\` — access as \`req.params.id\` (string, safe).
    - \`req.headers\` values are \`string | string[] | undefined\` — always narrow:
        const auth = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
    - NEVER pass \`req.params.x\` or \`req.headers.x\` directly to a function expecting only \`string\` without narrowing.
- Guard \`req.user\` before use — it is \`Express.User | undefined\`:
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
- ALWAYS type every function parameter explicitly; never use implicit \`any\`.
- Only import types/interfaces that actually exist in the shared package context provided.
  If a shared type is missing, define a local interface instead of importing a non-existent path.

For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.

When you have successfully generated all required files, end your response with exactly:
${RALPH_COMPLETE_TOKEN}
If you cannot complete the task, end with: <promise>TASK_FAILED: <reason></promise>`,

  test: `You are a Senior QA / Test Engineer Agent.
Generate comprehensive test suites: unit, integration, e2e.
Frameworks: Vitest, @testing-library/react, Playwright, k6.
${VITE_ALIAS_RULES}
For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.

When you have successfully generated all required files, end your response with exactly:
${RALPH_COMPLETE_TOKEN}
If you cannot complete the task, end with: <promise>TASK_FAILED: <reason></promise>`,
};

// ─── Version constraint injection (prevent LLM from using deprecated APIs) ───

const KNOWN_BREAKING_CHANGES: Record<
  string,
  { sinceVersion: string; notes: string }
> = {
  msw: {
    sinceVersion: "2.0.0",
    notes:
      "v2+: use `http.get/post/put/patch/delete` from 'msw', NOT `rest.*`. " +
      "Use `HttpResponse.json(data)` instead of `res(ctx.json(data))`.",
  },
  "react-router-dom": {
    sinceVersion: "6.0.0",
    notes:
      "v6+: use `useNavigate()` NOT `useHistory()`. " +
      "Use `<Routes>` NOT `<Switch>`. " +
      "Route `component` prop is now `element={<Component />}`.",
  },
  "@tanstack/react-query": {
    sinceVersion: "5.0.0",
    notes:
      "v5+: `useQuery` takes a single object param `{ queryKey, queryFn }`. " +
      "No more `onSuccess/onError` callbacks in useQuery options. " +
      "Use `isPending` instead of `isLoading`.",
  },
  "next-auth": {
    sinceVersion: "4.0.0",
    notes:
      "v4+: config is in `app/api/auth/[...nextauth]/route.ts`. " +
      "Use `getServerSession(authOptions)` NOT `getSession()`.",
  },
  prisma: {
    sinceVersion: "7.0.0",
    notes:
      "v5/6 (default for generated apps): `datasource db { provider = \"postgresql\" url = env(\"DATABASE_URL\") }`. " +
      "v7+: `url`/`directUrl` may be omitted from schema; connection via prisma.config.ts — follow the version in package.json. " +
      "v5+: `findUnique` throws if not found when using `findUniqueOrThrow`. `rejectOnNotFound` option removed.",
  },
  "framer-motion": {
    sinceVersion: "11.0.0",
    notes:
      "v11+: `motion` components import from 'framer-motion' directly. " +
      "AnimatePresence `exitBeforeEnter` renamed to `mode='wait'`.",
  },
  "react-hook-form": {
    sinceVersion: "7.0.0",
    notes:
      "v7+: `register` returns an object to spread: `{...register('field')}`. " +
      "No more `ref={register}` pattern.",
  },
};

export async function buildVersionConstraints(outputDir: string): Promise<string> {
  const content = await fsRead("package.json", outputDir);
  if (content.startsWith("FILE_NOT_FOUND")) return "";

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(content);
  } catch {
    return "";
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (Object.keys(allDeps).length === 0) return "";

  const constraints: string[] = [];

  for (const [pkgName, version] of Object.entries(allDeps)) {
    const breaking = KNOWN_BREAKING_CHANGES[pkgName];
    if (!breaking) continue;

    const installedMajor = parseInt(
      version.replace(/^[\^~>=<]/, "").split(".")[0],
      10,
    );
    const breakingMajor = parseInt(breaking.sinceVersion.split(".")[0], 10);

    if (!isNaN(installedMajor) && installedMajor >= breakingMajor) {
      constraints.push(
        `- **${pkgName}** (installed: ${version}): ${breaking.notes}`,
      );
    }
  }

  if (constraints.length === 0) return "";

  return [
    "## Installed package versions — use these APIs (not older ones)",
    "",
    ...constraints,
  ].join("\n");
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

function parseFileBlocksFromContent(
  raw: string,
  _outputDir: string,
): { filePath: string; fileContent: string }[] {
  const parsed = parseFileOutput(raw);
  return Object.entries(parsed).map(([filePath, fileContent]) => ({
    filePath,
    fileContent,
  }));
}

const WORKER_TSC_VERIFY_PREFIX = "## TypeScript errors in task files";

function isWorkerTscVerifyError(verifyErrors: string): boolean {
  return verifyErrors.includes(WORKER_TSC_VERIFY_PREFIX);
}

/**
 * Extract exported names from TypeScript source for building export maps.
 * Catches: export function/const/class/type/interface/enum, export { }, export default.
 */
function extractExportNames(source: string): string[] {
  const names = new Set<string>();

  const namedExportRe =
    /export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = namedExportRe.exec(source)) !== null) {
    names.add(m[1]);
  }

  const braceExportRe = /export\s*\{([^}]+)\}/g;
  while ((m = braceExportRe.exec(source)) !== null) {
    for (const item of m[1].split(",")) {
      const cleaned = item.replace(/\s+as\s+\w+/, "").trim();
      if (cleaned && /^\w+$/.test(cleaned)) names.add(cleaned);
    }
  }

  if (/export\s+default\s/.test(source)) names.add("default");

  return [...names];
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function taskPatternToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").trim();
  const regex = "^" + escapeRegex(normalized).replace(/\\\*/g, ".*") + "$";
  return new RegExp(regex);
}

function matchesTaskPathHint(filePath: string, hint: string): boolean {
  const p = filePath.replace(/\\/g, "/");
  const h = hint.replace(/\\/g, "/").trim();
  if (!h) return false;
  if (h.includes("*")) return taskPatternToRegex(h).test(p);
  if (p === h) return true;
  if (p.endsWith(`/${h}`)) return true;
  return p.startsWith(`${h}/`);
}

function normalizeTaskFileHints(taskFiles: unknown): string[] {
  if (!taskFiles) return [];
  if (Array.isArray(taskFiles)) {
    return taskFiles.filter((f): f is string => typeof f === "string");
  }
  if (typeof taskFiles !== "object") return [];
  const record = taskFiles as Record<string, unknown>;
  const grouped = ["creates", "modifies", "reads"]
    .flatMap((k) => (Array.isArray(record[k]) ? (record[k] as unknown[]) : []))
    .filter((f): f is string => typeof f === "string");
  return grouped;
}

function formatTaskFileHints(taskFiles: unknown): string {
  if (!taskFiles) return "";
  if (Array.isArray(taskFiles)) {
    const rows = taskFiles.filter((f): f is string => typeof f === "string");
    if (rows.length === 0) return "";
    return `\nKey files to create/modify:\n${rows.map((f) => `- ${f}`).join("\n")}`;
  }
  if (typeof taskFiles !== "object") return "";
  const record = taskFiles as Record<string, unknown>;
  const creates = Array.isArray(record.creates)
    ? (record.creates as unknown[]).filter((f): f is string => typeof f === "string")
    : [];
  const modifies = Array.isArray(record.modifies)
    ? (record.modifies as unknown[]).filter((f): f is string => typeof f === "string")
    : [];
  const reads = Array.isArray(record.reads)
    ? (record.reads as unknown[]).filter((f): f is string => typeof f === "string")
    : [];
  const lines: string[] = [];
  if (creates.length > 0) lines.push(`Creates:\n${creates.map((f) => `- ${f}`).join("\n")}`);
  if (modifies.length > 0) lines.push(`Modifies:\n${modifies.map((f) => `- ${f}`).join("\n")}`);
  if (reads.length > 0) lines.push(`Reads:\n${reads.map((f) => `- ${f}`).join("\n")}`);
  return lines.length > 0 ? `\nTask file plan:\n${lines.join("\n")}` : "";
}

async function buildRelevantFileContext(
  state: WorkerState,
  task: CodingTask,
): Promise<string> {
  const hints = normalizeTaskFileHints(task.files).map((f) =>
    f.replace(/\\/g, "/"),
  );
  const candidates = new Set<string>();

  // 1) Direct hint matches from current registry.
  if (hints.length > 0) {
    for (const f of state.fileRegistrySnapshot) {
      const p = f.path.replace(/\\/g, "/");
      if (hints.some((h) => matchesTaskPathHint(p, h))) {
        candidates.add(p);
      }
    }
  }

  // 2) Prefer files created by same role in previous tasks (consistency).
  for (const f of state.fileRegistrySnapshot) {
    if (f.role === state.role) candidates.add(f.path.replace(/\\/g, "/"));
  }

  // 3) Dynamically discover all files under packages/shared/src/ so agents
  //    always see the exact type shapes and don't hallucinate missing exports.
  try {
    const sharedFiles = await listFiles("packages/shared/src", state.outputDir);
    for (const f of sharedFiles) {
      if (/\.(ts|tsx)$/.test(f)) candidates.add(f.replace(/\\/g, "/"));
    }
  } catch {
    // listFiles may throw if the directory doesn't exist (S-tier / frontend-only)
  }
  // Also add flat-layout shared files (non-src/) and key app files.
  [
    "packages/shared/schemas/auth.ts",
    "packages/shared/schemas/tasks.ts",
    "packages/shared/schemas/users.ts",
    "packages/shared/types/auth.ts",
    "packages/shared/types/tasks.ts",
    "packages/shared/types/users.ts",
    "packages/shared/src/index.ts",
    "apps/web/src/lib/apiClient.ts",
    "apps/web/lib/api/auth.client.ts",
    "apps/api/src/routes/auth.ts",
    "API_CONTRACTS.json",
    "SCAFFOLD_SPEC.md",
    "DEPENDENCY_PLAN.md",
  ].forEach((p) => candidates.add(p));

  // RALPH Phase 4: prepend session context summary when context rotation is active
  const contextPreamble: string[] = [];
  if (state.ralphConfig.enabled && state.contextRotationNeeded) {
    const sessionCtx = await fsRead(".ralph/session-context.md", state.outputDir);
    if (!sessionCtx.startsWith("FILE_NOT_FOUND") && !sessionCtx.startsWith("REJECTED")) {
      contextPreamble.push(`## Prior session context (context rotation active)\n${sessionCtx.slice(0, 2000)}`);
    }
  }

  // Build export map from key files so agents know exactly what is available
  const exportMapFiles = [
    "packages/shared/src/index.ts",
    "apps/web/src/lib/api.ts",
    "apps/web/src/lib/apiClient.ts",
    "apps/web/src/lib/auth.ts",
    "apps/web/src/contexts/AuthContext.tsx",
    "apps/web/src/App.tsx",
  ];
  const exportMapLines: string[] = [];
  for (const emf of exportMapFiles) {
    const emContent = await fsRead(emf, state.outputDir);
    if (emContent.startsWith("FILE_NOT_FOUND") || emContent.startsWith("REJECTED")) continue;
    const exports = extractExportNames(emContent);
    if (exports.length > 0) {
      exportMapLines.push(`- \`${emf}\`: ${exports.join(", ")}`);
    }
  }
  if (exportMapLines.length > 0) {
    contextPreamble.push(
      `## Available exports (ONLY import what is listed here)\n${exportMapLines.join("\n")}`,
    );
  }

  // Read up to a bounded set to control context size.
  // When rotation is active, reduce the file limit to leave room for session context.
  const fileLimit = state.contextRotationNeeded ? 12 : 18;
  const selected = [...candidates].slice(0, fileLimit);
  const chunks: string[] = [];
  for (const rel of selected) {
    const content = await fsRead(rel, state.outputDir);
    if (content.startsWith("FILE_NOT_FOUND") || content.startsWith("REJECTED")) {
      continue;
    }
    const block =
      rel.endsWith(".md") || rel.endsWith(".json")
        ? content.slice(0, 1800)
        : content.slice(0, 2200);
    chunks.push(`### ${rel}\n\`\`\`\n${block}\n\`\`\``);
  }

  const allChunks = [...contextPreamble, ...chunks];
  if (allChunks.length === 0) return "";
  return `## Relevant existing files (read before coding)\n${allChunks.join("\n\n")}`;
}

// ─── Dynamic sub-step parsing ───

const PLAN_BLOCK_RE = /<plan>([\s\S]*?)<\/plan>/;

function parsePlanBlock(content: string): TaskSubStep[] {
  const match = PLAN_BLOCK_RE.exec(content);
  if (!match) return [];

  const planText = match[1].trim();
  const lines = planText.split("\n").filter((l) => l.trim().length > 0);

  return lines.map((line, idx) => {
    const cleanLine = line.replace(/^\d+[\.\)]\s*/, "").trim();
    const colonIdx = cleanLine.indexOf(":");
    const action =
      colonIdx > 0 ? cleanLine.slice(0, colonIdx).trim() : cleanLine;
    const detail =
      colonIdx > 0 ? cleanLine.slice(colonIdx + 1).trim() : "";
    return { step: idx + 1, action, detail };
  });
}

// ─── RALPH helpers ───

/**
 * Checks whether the LLM output contains the RALPH completion promise.
 * When Ralph mode is disabled this is only informational (not enforced).
 */
export function extractCompletionPromise(content: string): {
  found: boolean;
  failed: boolean;
  reason?: string;
} {
  if (content.includes(RALPH_COMPLETE_TOKEN)) {
    return { found: true, failed: false };
  }
  const m = RALPH_FAILED_RE.exec(content);
  if (m) {
    return { found: true, failed: true, reason: m[1].trim() };
  }
  return { found: false, failed: false };
}

// ─── Node functions ───

function pickNextTask(state: WorkerState) {
  const idx = state.currentTaskIndex;
  const total = state.tasks.length;
  const currentTask = idx < total ? state.tasks[idx] : null;
  if (currentTask) {
    console.log(`[Worker:${state.workerLabel}] Picking task ${idx + 1}/${total}: ${currentTask.title}`);
  } else {
    console.log(`[Worker:${state.workerLabel}] All ${total} tasks done.`);
  }
  return {
    verifyErrors: "",
    fixAttempts: 0,
    currentTaskRetryCount: 0,
    currentTaskLastError: "",
    currentTaskLastRawContent: "",
    currentTaskGeneratedFiles: [],
    currentTaskCostUsd: 0,
    currentTaskDurationMs: 0,
    currentTaskTokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    ...(currentTask
      ? {
          currentTaskId: currentTask.id,
          currentTaskTitle: currentTask.title,
          currentTaskPhase: currentTask.phase,
        }
      : {}),
  };
}

function shouldContinueOrEnd(state: WorkerState): string {
  if (state.currentTaskIndex >= state.tasks.length) return "__end__";
  return "generate_code";
}

function routeAfterGenerate(state: WorkerState): string {
  // Generation threw an exception — always retry up to the configured limit.
  if (state.currentTaskLastError) {
    const maxRetries = state.ralphConfig.enabled
      ? state.ralphConfig.maxIterationsPerTask - 1
      : MAX_TASK_GENERATION_RETRIES;
    if (state.currentTaskRetryCount <= maxRetries) return "generate_code";
    return "task_failed";
  }

  // In Ralph mode: require the completion promise before accepting the output.
  if (state.ralphConfig.enabled) {
    const promise = extractCompletionPromise(state.currentTaskLastRawContent ?? "");
    if (promise.failed) {
      // LLM explicitly signalled failure — escalate immediately.
      return "task_failed";
    }
    if (!promise.found) {
      // Promise absent — treat as incomplete and retry.
      const maxRetries = state.ralphConfig.maxIterationsPerTask - 1;
      if (state.currentTaskRetryCount <= maxRetries) return "generate_code";
      return "task_failed";
    }
  }

  return "verify";
}

async function generateCode(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];
  const attempt = state.currentTaskRetryCount + 1;

  try {
    console.log(
      `[Worker:${state.workerLabel}] Generating code for: "${task.title}" (attempt ${attempt}/${MAX_TASK_GENERATION_RETRIES + 1}) ...`,
    );

    const contextParts: string[] = [];
    if (state.projectContext) {
      contextParts.push(state.projectContext);
    }
    if (state.fileRegistrySnapshot.length > 0) {
      const listing = state.fileRegistrySnapshot
        .slice(0, 30)
        .map((f) => {
          const exportsNote =
            f.exports && f.exports.length > 0
              ? ` | exports: ${f.exports.slice(0, 8).join(", ")}`
              : "";
          return `- ${f.path} (${f.role}): ${f.summary}${exportsNote}`;
        })
        .join("\n");
      contextParts.push(`## Already generated files\n${listing}`);
    }

    const skeletonFiles = state.fileRegistrySnapshot.filter(
      (f) =>
        f.role === "architect" &&
        f.summary.startsWith("Interface skeleton") &&
        /\.(ts|tsx)$/.test(f.path),
    );

    if (skeletonFiles.length > 0) {
      const skeletonContents: string[] = [];
      for (const sf of skeletonFiles.slice(0, 8)) {
        const content = await fsRead(sf.path, state.outputDir);
        if (!content.startsWith("FILE_NOT_FOUND")) {
          skeletonContents.push(
            `### ${sf.path}\n\`\`\`typescript\n${content.slice(0, 1500)}\n\`\`\``,
          );
        }
      }
      if (skeletonContents.length > 0) {
        contextParts.push(
          `## Interface contracts (implement these exactly — do not rename exports)\n${skeletonContents.join("\n\n")}`,
        );
      }
    }

    if (state.apiContractsSnapshot.length > 0) {
      const apis = state.apiContractsSnapshot
        .map((a) => `- ${a.method} ${a.endpoint} (${a.service})`)
        .join("\n");
      contextParts.push(`## Available API endpoints\n${apis}`);
    }

    const relevantFilesContext = await buildRelevantFileContext(state, task);
    if (relevantFilesContext) {
      contextParts.push(relevantFilesContext);
    }

    const versionConstraints = await buildVersionConstraints(state.outputDir);
    if (versionConstraints) {
      contextParts.push(versionConstraints);
    }

    const fileHint = formatTaskFileHints(task.files);

    const messages: ChatMessage[] = [
      { role: "system", content: ROLE_PROMPTS[state.role] },
    ];
    if (contextParts.length > 0) {
      messages.push({
        role: "system",
        content: `## Project Context\n${contextParts.join("\n\n")}`,
      });
    }
    const subStepsHint = task.subSteps && task.subSteps.length > 0
      ? `\n\nPre-defined sub-steps:\n${task.subSteps.map((s) => `${s.step}. ${s.action}: ${s.detail}`).join("\n")}`
      : "";

    messages.push({
      role: "user",
      content: `## Task: ${task.title}\n\n${task.description}${fileHint}${subStepsHint}\n\nFirst, output a brief implementation plan inside <plan> tags (one numbered step per line).\nThen generate the complete code for this task.\n\nBefore writing, read and follow existing file contracts in context (imports, exports, naming, and paths). Extend existing modules instead of creating duplicate paths when possible.\n\nACCEPTANCE CRITERIA:\n1. Every button has a real onClick handler that updates state or triggers navigation.\n2. Every form has onSubmit with validation logic.\n3. Every input/toggle/select is controlled with useState + onChange.\n4. Links navigate to real routes (React Router Link or useNavigate).\n5. Timer/counter/animation logic uses real useEffect + setInterval/setTimeout.\n6. If Design Tokens are in context, match every color, size, gap, padding, radius, and font exactly using Tailwind arbitrary values.`,
    });

    const startMs = Date.now();
    const response = await invokeCodegenOrOpenRouter(messages, {
      temperature: 0.3,
      max_tokens: MAX_OUTPUT_TOKENS,
      openRouterVariant: "codeGen",
    });
    const durationMs = Date.now() - startMs;

    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);
    const usage = response.usage as
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        }
      | undefined;
    const promptTokens = usage?.prompt_tokens ?? usage?.promptTokens ?? 0;
    const completionTokens =
      usage?.completion_tokens ?? usage?.completionTokens ?? 0;
    const totalTokens =
      usage?.total_tokens ?? usage?.totalTokens ?? promptTokens + completionTokens;
    const parsedFiles = parseFileOutput(content);

    const fsOpts =
      state.scaffoldProtectedPaths.length > 0
        ? { scaffoldProtectedPaths: state.scaffoldProtectedPaths }
        : undefined;

    const writtenFiles: string[] = [];
    const newFileEntries: GeneratedFile[] = [];
    for (const [fp, fc] of Object.entries(parsedFiles)) {
      const msg = await fsWrite(fp, fc, state.outputDir, fsOpts);
      if (msg.startsWith("SKIPPED_PROTECTED")) {
        console.log(`[Worker:${state.workerLabel}] ${msg}`);
        continue;
      }
      writtenFiles.push(fp);
      newFileEntries.push({
        path: fp,
        role: state.role,
        summary: `Generated for task: ${task.title}`,
      });
    }

    console.log(
      `[Worker:${state.workerLabel}] Generated ${writtenFiles.length} files in ${(durationMs / 1000).toFixed(1)}s (model=${response.model}, cost: $${costUsd.toFixed(4)})`,
    );

    // RALPH: check for missing promise and log a warning (enforcement happens in routeAfterGenerate)
    if (state.ralphConfig.enabled) {
      const promise = extractCompletionPromise(content);
      if (!promise.found) {
        console.warn(
          `[Worker:${state.workerLabel}] RALPH: completion promise absent for "${task.title}" (attempt ${attempt})`,
        );
      }
    }

    // Parse dynamic sub-steps from the LLM output
    const dynamicSubSteps = parsePlanBlock(content);
    if (dynamicSubSteps.length > 0) {
      console.log(
        `[Worker:${state.workerLabel}] Parsed ${dynamicSubSteps.length} dynamic sub-step(s) for "${task.title}"`,
      );
    }

    // RALPH Phase 4: accumulate context tokens for rotation detection
    const contextRotationNeeded =
      state.ralphConfig.enabled &&
      state.ralphConfig.contextRotationThreshold > 0 &&
      state.estimatedContextTokens + promptTokens >
        state.ralphConfig.contextRotationThreshold * MAX_CONTEXT_TOKENS;

    return {
      generatedFiles: newFileEntries,
      currentTaskGeneratedFiles: writtenFiles,
      currentTaskCostUsd: costUsd,
      currentTaskDurationMs: durationMs,
      currentTaskTokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      workerCostUsd: costUsd,
      verifyErrors: "",
      fixAttempts: 0,
      currentTaskLastError: "",
      currentTaskLastRawContent: content,
      currentTaskSubSteps: dynamicSubSteps,
      // Accumulate for context-rotation tracking (additive reducer)
      estimatedContextTokens: promptTokens,
      contextRotationNeeded,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryCount = state.currentTaskRetryCount + 1;
    console.warn(
      `[Worker:${state.workerLabel}] Task "${task.title}" generation failed (attempt ${retryCount}/${MAX_TASK_GENERATION_RETRIES + 1}): ${message}`,
    );
    return {
      currentTaskRetryCount: retryCount,
      currentTaskLastError: message.slice(0, 2000),
      currentTaskLastRawContent: "",
    };
  }
}

// ─── Verify helpers: error classification + auto dep install ───
// Exported for use by supervisor's integration verify/fix.

export interface TscErrorClassification {
  missingDeps: string[];
  crossRefErrors: string[];
  realErrors: string[];
  hasMissingDeps: boolean;
  hasCrossRefOnly: boolean;
  hasRealErrors: boolean;
}

export function classifyTscErrors(output: string): TscErrorClassification {
  const lines = output.split("\n").filter((l) => l.includes("error TS"));

  const missingDeps: string[] = [];
  const crossRefErrors: string[] = [];
  const realErrors: string[] = [];

  for (const line of lines) {
    if (
      line.includes("Cannot find module") ||
      line.includes("Could not find a declaration file")
    ) {
      const moduleMatch = line.match(/['"]([^'"]+)['"]/);
      const modulePath = moduleMatch?.[1] ?? "";
      if (
        modulePath.startsWith(".") ||
        modulePath.startsWith("/") ||
        isPathAlias(modulePath)
      ) {
        crossRefErrors.push(line);
      } else {
        missingDeps.push(line);
      }
    } else if (line.includes("Cannot find name")) {
      if (
        /describe|it\b|expect|test\b|beforeEach|afterEach|afterAll|beforeAll|vi\b/.test(
          line,
        )
      ) {
        missingDeps.push(line);
      } else if (
        /toBeInTheDocument|toHaveTextContent|toBeVisible|toBeDisabled|toHaveClass|toHaveStyle|toBeChecked|toHaveFocus/.test(
          line,
        )
      ) {
        missingDeps.push(line);
      } else {
        realErrors.push(line);
      }
    } else {
      realErrors.push(line);
    }
  }

  return {
    missingDeps,
    crossRefErrors,
    realErrors,
    hasMissingDeps: missingDeps.length > 0,
    hasCrossRefOnly:
      crossRefErrors.length > 0 &&
      realErrors.length === 0 &&
      missingDeps.length === 0,
    hasRealErrors: realErrors.length > 0,
  };
}

export function isPathAlias(specifier: string): boolean {
  return (
    specifier.startsWith("@/") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("#/")
  );
}

export function extractMissingPackages(tscOutput: string): string[] {
  const pkgs = new Set<string>();
  const moduleRe = /Cannot find module ['"]([^'"]+)['"]/g;
  let m;
  while ((m = moduleRe.exec(tscOutput)) !== null) {
    const mod = m[1];
    if (mod.startsWith(".") || mod.startsWith("/")) continue;
    if (isPathAlias(mod)) continue;
    const pkg = mod.startsWith("@")
      ? mod.split("/").slice(0, 2).join("/")
      : mod.split("/")[0];
    pkgs.add(pkg);
  }
  const declRe = /Could not find a declaration file for module ['"]([^'"]+)['"]/g;
  while ((m = declRe.exec(tscOutput)) !== null) {
    const mod = m[1];
    if (mod.startsWith(".") || mod.startsWith("/")) continue;
    if (isPathAlias(mod)) continue;
    const pkg = mod.startsWith("@")
      ? mod.split("/").slice(0, 2).join("/")
      : mod.split("/")[0];
    pkgs.add(`@types/${pkg.replace(/^@/, "").replace(/\//, "__")}`);
  }
  if (
    /Cannot find name.*(describe|it\b|expect|test\b|beforeEach|afterEach|afterAll|beforeAll|vi)\b/.test(
      tscOutput,
    )
  ) {
    pkgs.add("vitest");
  }
  if (
    /toBeInTheDocument|toHaveTextContent|toBeVisible|toBeDisabled|toHaveClass/.test(
      tscOutput,
    )
  ) {
    pkgs.add("@testing-library/jest-dom");
  }
  return [...pkgs].filter(isAutoInstallableNpmPackageName);
}

export async function installMissingDeps(
  tscOutput: string,
  outputDir: string,
  options?: { scaffoldProtectedPaths?: string[] },
): Promise<void> {
  const pkgs = extractMissingPackages(tscOutput);
  const toolOpts =
    options?.scaffoldProtectedPaths && options.scaffoldProtectedPaths.length > 0
      ? {
          scaffoldProtectedPaths: options.scaffoldProtectedPaths,
          forceProtectedOverwrite: true,
        }
      : undefined;

  const needsJestDom =
    /toBeInTheDocument|toHaveTextContent|toBeVisible/.test(tscOutput);

  if (needsJestDom) {
    pkgs.push("@testing-library/jest-dom");
    const setupPath = "src/test/setup.ts";
    const existingSetup = await fsRead(setupPath, outputDir);
    if (existingSetup.startsWith("FILE_NOT_FOUND")) {
      await fsWrite(
        setupPath,
        `import '@testing-library/jest-dom';\n`,
        outputDir,
        toolOpts,
      );
      console.log(`[Verify] Created test setup file: ${setupPath}`);

      const vitestConfig = await fsRead("vitest.config.ts", outputDir);
      if (
        !vitestConfig.startsWith("FILE_NOT_FOUND") &&
        !vitestConfig.includes("setupFiles")
      ) {
        const updated = vitestConfig.replace(
          /test:\s*\{/,
          `test: {\n    setupFiles: ['./src/test/setup.ts'],`,
        );
        if (updated !== vitestConfig) {
          await fsWrite("vitest.config.ts", updated, outputDir, toolOpts);
          console.log(`[Verify] Updated vitest.config.ts with setupFiles`);
        }
      }
    }
  }

  const unique = [...new Set(pkgs)];
  if (unique.length === 0) return;
  console.log(
    `[Verify] Installing ${unique.length} missing package(s): ${unique.join(", ")}`,
  );
  const pm = await detectPackageManager(outputDir);
  await shellExec(
    buildAddCommand(pm, unique),
    outputDir,
    { timeout: 60_000 },
  );
}

export async function findBestTsconfigForFiles(
  taskFiles: string[],
  outputDir: string,
): Promise<string | null> {
  if (taskFiles.length === 0) return null;

  const dirs = new Set(
    taskFiles
      .map((f) => f.split("/").slice(0, -1).join("/"))
      .filter((d) => d.length > 0),
  );

  const commonPrefix =
    dirs.size === 1
      ? [...dirs][0]
      : taskFiles[0]
          .split("/")
          .slice(0, -1)
          .reduce((prefix, part, i) => {
            if (
              taskFiles.every(
                (f) => f.split("/")[i] === part,
              )
            ) {
              return prefix ? `${prefix}/${part}` : part;
            }
            return prefix;
          }, "");

  const parts = commonPrefix ? commonPrefix.split("/") : [];
  for (let i = parts.length; i >= 1; i--) {
    const candidate = parts.slice(0, i).join("/") + "/tsconfig.json";
    const content = await fsRead(candidate, outputDir);
    if (!content.startsWith("FILE_NOT_FOUND") && !content.startsWith("REJECTED")) {
      return candidate;
    }
  }

  return null;
}

// ─── Verify node: per-task `tsc`; Worker `task_fix` closes the loop on tsc errors ───

async function verifyCode(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];

  // Scope to the current task's outputs. Phase-level verify (Supervisor) still
  // handles cross-task integration after all workers finish.
  const taskFiles =
    state.currentTaskGeneratedFiles.length > 0
      ? state.currentTaskGeneratedFiles
      : state.generatedFiles.filter((f) => f.role === state.role).map((f) => f.path);

  if (taskFiles.length === 0) {
    console.log(
      `[Worker:${state.workerLabel}] Verify: no files generated for "${task.title}" — marking as warning`,
    );
    return {
      verifyErrors: `No files generated for task: ${task.title}`,
      fixAttempts: state.fixAttempts,
    };
  }

  const issues: string[] = [];

  for (const filePath of taskFiles) {
    const normalizedPath = path.normalize(filePath);
    if (path.isAbsolute(normalizedPath) || normalizedPath.includes("..")) {
      issues.push(`Unsafe path rejected: ${filePath}`);
      continue;
    }

    const content = await fsRead(filePath, state.outputDir);
    if (content.startsWith("FILE_NOT_FOUND")) {
      issues.push(`File not found after write: ${filePath}`);
      continue;
    }
  }

  if (issues.length > 0) {
    const errorMsg = issues.join("\n");
    console.log(
      `[Worker:${state.workerLabel}] Verify FAILED (pre-tsc) for "${task.title}":\n${errorMsg}`,
    );
    return {
      verifyErrors: errorMsg,
      fixAttempts: state.fixAttempts,
    };
  }

  const tsFiles = taskFiles.filter((f) => /\.(ts|tsx)$/.test(f));
  if (tsFiles.length === 0) {
    console.log(
      `[Worker:${state.workerLabel}] No TypeScript files in task — skip tsc for "${task.title}"`,
    );
    return { verifyErrors: "", fixAttempts: state.fixAttempts };
  }

  const tsconfig = await findBestTsconfigForFiles(tsFiles, state.outputDir);
  const tscCmd = tsconfig
    ? `npx tsc --noEmit --skipLibCheck --pretty false --project ${tsconfig} 2>&1`
    : `npx tsc --noEmit --skipLibCheck --pretty false 2>&1`;

  console.log(
    `[Worker:${state.workerLabel}] Per-task tsc check for "${task.title}"...`,
  );

  const tscResult = await shellExec(tscCmd, state.outputDir, {
    timeout: 60_000,
  });
  const tscOutput = (tscResult.stderr || tscResult.stdout || "").trim();

  if (
    (tscResult.exitCode !== 0 || tscOutput.includes("error TS")) &&
    tscOutput.includes("error TS")
  ) {
    const errorLines = tscOutput.split("\n").filter((l) => l.includes("error TS"));
    const taskFileSet = new Set(tsFiles.map((f) => f.replace(/\\/g, "/")));
    const relevantErrors = errorLines.filter((line) =>
      [...taskFileSet].some((tf) => line.includes(tf)),
    );

    if (relevantErrors.length > 0) {
      const tscErrors = relevantErrors.slice(0, 20).join("\n");
      console.log(
        `[Worker:${state.workerLabel}] Per-task tsc FAILED for "${task.title}" (${relevantErrors.length} error(s)) — worker task_fix may retry.`,
      );
      return {
        verifyErrors: `${WORKER_TSC_VERIFY_PREFIX}\n${tscErrors}`,
        fixAttempts: state.fixAttempts,
      };
    }
  }

  console.log(
    `[Worker:${state.workerLabel}] Per-task tsc PASSED for "${task.title}"`,
  );

  return { verifyErrors: "", fixAttempts: state.fixAttempts };
}

function routeAfterVerify(state: WorkerState): string {
  if (!state.verifyErrors) return "task_done";
  if (!isWorkerTscVerifyError(state.verifyErrors)) return "task_done";
  const maxFix = state.ralphConfig.enabled
    ? Math.min(state.ralphConfig.maxIterationsPerTask, MAX_PER_TASK_FIX_ATTEMPTS)
    : MAX_FIX_ATTEMPTS;
  if (state.fixAttempts >= maxFix) {
    console.log(
      `[Worker:${state.workerLabel}] Per-task tsc fix: max attempts (${maxFix}) reached, continuing with warnings.`,
    );
    return "task_done";
  }
  return "task_fix";
}

function logCodeFixErrorDetail(
  workerLabel: string,
  taskId: string,
  taskTitle: string,
  verifyErrors: string,
): void {
  const body = verifyErrors
    .replace(new RegExp(`^${WORKER_TSC_VERIFY_PREFIX}\\s*`, "m"), "")
    .trim();
  const lines = body.split("\n").filter((l) => l.length > 0);
  console.log(
    `[Worker:${workerLabel}] codeFix: task=${taskId} "${taskTitle.slice(0, 80)}" — ` +
      `repairing ${lines.length} tsc error line(s) (per-task TypeScript check).`,
  );
  console.log(
    `[Worker:${workerLabel}] codeFix: tsc detail (first 4000 chars):\n${body.slice(0, 4000)}`,
  );
}

async function taskFix(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];
  const attempt = state.fixAttempts + 1;
  console.log(
    `[Worker:${state.workerLabel}] Per-task tsc fix attempt ${attempt} for "${task.title}" (MODEL_CONFIG.codeFix chain)...`,
  );

  logCodeFixErrorDetail(
    state.workerLabel,
    task.id,
    task.title,
    state.verifyErrors,
  );

  const taskFiles = state.currentTaskGeneratedFiles;
  if (taskFiles.length === 0) {
    console.warn(
      `[Worker:${state.workerLabel}] codeFix: skip LLM — no currentTaskGeneratedFiles for task ${task.id}.`,
    );
    return { fixAttempts: attempt, verifyErrors: state.verifyErrors };
  }

  console.log(
    `[Worker:${state.workerLabel}] codeFix: task files in scope (${taskFiles.length}): ${taskFiles.slice(0, 12).join(", ")}${taskFiles.length > 12 ? " …" : ""}`,
  );

  const alreadyRead = new Set<string>();
  const fileContents: string[] = [];

  for (const filePath of taskFiles.slice(0, 8)) {
    alreadyRead.add(filePath);
    const content = await fsRead(filePath, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND") && !content.startsWith("REJECTED")) {
      fileContents.push(`### ${filePath}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
    }
  }

  const errorFilePattern = /([^\s:(]+\.(?:tsx?|jsx?|json))\(/g;
  const mentionedInErrors = new Set<string>();
  let em: RegExpExecArray | null;
  while ((em = errorFilePattern.exec(state.verifyErrors)) !== null) {
    const f = em[1].replace(/\\/g, "/");
    if (!f.includes("node_modules")) mentionedInErrors.add(f);
  }
  for (const ef of [...mentionedInErrors].slice(0, 4)) {
    if (alreadyRead.has(ef)) continue;
    alreadyRead.add(ef);
    const content = await fsRead(ef, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND") && !content.startsWith("REJECTED")) {
      fileContents.push(
        `### ${ef} (referenced in errors — read-only context)\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``,
      );
    }
  }

  const configFiles = await inferRelatedConfigFiles(
    state.verifyErrors,
    state.outputDir,
    taskFiles,
  );
  for (const cf of configFiles.slice(0, 3)) {
    if (alreadyRead.has(cf)) continue;
    alreadyRead.add(cf);
    const content = await fsRead(cf, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND") && !content.startsWith("REJECTED")) {
      fileContents.push(`### ${cf}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``);
    }
  }

  const versionConstraints = await buildVersionConstraints(state.outputDir);

  const codeFixChain = resolveModelChain(MODEL_CONFIG.codeFix ?? "gpt-4o", resolveModel);
  console.log(
    `[Worker:${state.workerLabel}] codeFix: model chain (fallback order): ${codeFixChain.join(" -> ")}`,
  );
  const ctxPaths = [
    ...[...mentionedInErrors].slice(0, 4),
    ...configFiles.slice(0, 3),
  ].filter((p, i, a) => a.indexOf(p) === i);
  if (ctxPaths.length > 0) {
    console.log(
      `[Worker:${state.workerLabel}] codeFix: extra context paths: ${ctxPaths.join(", ")}`,
    );
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a TypeScript fix specialist. Fix the errors shown below.",
        "Output ONLY the corrected file(s) using ```file:path/to/file``` blocks.",
        "Do NOT remove existing functionality. Only fix the errors.",
        "Do NOT add explanations or markdown outside the file blocks.",
        "Files marked '(referenced in errors — read-only context)' are for reference only; do NOT rewrite them.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `## Errors (attempt ${attempt})`,
        "```",
        state.verifyErrors.slice(0, 3000),
        "```",
        "",
        versionConstraints
          ? `## Installed package versions (use these APIs)\n${versionConstraints}\n`
          : "",
        "## Current file contents",
        ...fileContents,
      ].join("\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(messages, codeFixChain, {
      temperature: 0.2,
      max_tokens: MAX_OUTPUT_TOKENS,
    });

    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);

    const fixedFiles = parseFileBlocksFromContent(content, state.outputDir);
    if (fixedFiles.length === 0) {
      console.warn(
        `[Worker:${state.workerLabel}] codeFix: model=${response.model} returned no file: code blocks — nothing written.`,
      );
    } else {
      const paths = fixedFiles.map((f) => f.filePath);
      console.log(
        `[Worker:${state.workerLabel}] codeFix: applying patches to ${fixedFiles.length} file(s): ${paths.join(", ")}`,
      );
    }
    for (const { filePath, fileContent } of fixedFiles) {
      await fsWrite(filePath, fileContent, state.outputDir, {
        scaffoldProtectedPaths: state.scaffoldProtectedPaths,
      });
    }

    const mergedTaskFiles = [
      ...new Set([
        ...state.currentTaskGeneratedFiles,
        ...fixedFiles.map((f) => f.filePath),
      ]),
    ];

    console.log(
      `[Worker:${state.workerLabel}] codeFix: done attempt ${attempt} — wrote ${fixedFiles.length} file(s), model=${response.model}, cost=$${costUsd.toFixed(4)}; will re-run tsc in verify.`,
    );

    return {
      fixAttempts: attempt,
      verifyErrors: "",
      currentTaskGeneratedFiles: mergedTaskFiles,
      currentTaskCostUsd: state.currentTaskCostUsd + costUsd,
      workerCostUsd: costUsd,
    };
  } catch (e) {
    console.warn(
      `[Worker:${state.workerLabel}] Per-task tsc fix failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { fixAttempts: attempt, verifyErrors: state.verifyErrors };
  }
}

async function taskDone(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];
  console.log(`[Worker:${state.workerLabel}] Task done: "${task.title}" (${state.currentTaskIndex + 1}/${state.tasks.length})`);
  const filesForTask = state.currentTaskGeneratedFiles;

  // ── RALPH Phase 4: context rotation — write session-context.md when threshold hit ──
  if (state.ralphConfig.enabled && state.contextRotationNeeded) {
    const tracker = new ProgressTracker(state.outputDir);
    const completedTasks = state.taskResults;
    const recentFiles = state.generatedFiles.slice(-20).map((f) => `- ${f.path} (${f.role}): ${f.summary}`).join("\n");
    const contextSummary = [
      `# Session Context (auto-generated for context rotation)`,
      `> Worker: ${state.workerLabel} | Role: ${state.role}`,
      `> Rotation triggered at ~${state.estimatedContextTokens.toLocaleString()} context tokens`,
      ``,
      `## Tasks completed so far (${completedTasks.length})`,
      completedTasks
        .map((r) => `- ${r.taskId}: ${r.status} (${r.generatedFiles.length} files)`)
        .join("\n"),
      ``,
      `## Recently generated files (last 20)`,
      recentFiles,
    ].join("\n");
    try {
      await tracker.writeSessionContext(contextSummary);
      console.log(`[Worker:${state.workerLabel}] RALPH: context rotation triggered — session-context.md written.`);
    } catch (e) {
      console.warn(`[Worker:${state.workerLabel}] RALPH: failed to write session context: ${e}`);
    }
  }

  // ── RALPH Phase 3: persist progress + optional git commit ──────────────────
  let commitHash: string | undefined;
  if (state.ralphConfig.enabled) {
    const tracker = new ProgressTracker(state.outputDir);
    try {
      if (state.ralphConfig.enableGitCommits) {
        // Ensure git is initialised (no-op if already a repo)
        await shellExec("git init", state.outputDir, { timeout: 10_000 });
        // Stage all generated files for this task
        if (filesForTask.length > 0) {
          const filePaths = filesForTask.map((f) => `"${f}"`).join(" ");
          await shellExec(`git add ${filePaths}`, state.outputDir, { timeout: 15_000 });
        }
        const msg = `feat(agent): complete ${task.id}: ${task.title.slice(0, 72)}`;
        const commitOut = await shellExec(
          `git commit -m "${msg.replace(/"/g, "'")}" --allow-empty`,
          state.outputDir,
          { timeout: 20_000 },
        );
        const commitOutText = (commitOut.stdout || commitOut.stderr || "").trim();
        const hashMatch = /\[[\w/]+ ([a-f0-9]{7,})\]/.exec(commitOutText);
        commitHash = hashMatch?.[1];
        if (commitHash) {
          console.log(`[Worker:${state.workerLabel}] RALPH: committed ${task.id} → ${commitHash}`);
        }
      }
      await tracker.markComplete(task.id, filesForTask, commitHash);
      await tracker.addCost(state.currentTaskCostUsd);
    } catch (e) {
      // Progress tracking / git errors must never abort the pipeline
      console.warn(`[Worker:${state.workerLabel}] RALPH progress write failed: ${e}`);
    }
  }

  const result: TaskResult = {
    taskId: task.id,
    status: state.verifyErrors ? "completed_with_warnings" : "completed",
    generatedFiles: filesForTask,
    costUsd: state.currentTaskCostUsd,
    durationMs: state.currentTaskDurationMs,
    tokenUsage: state.currentTaskTokenUsage,
    verifyPassed: !state.verifyErrors,
    fixCycles: state.fixAttempts,
    warnings: state.verifyErrors
      ? [state.verifyErrors.slice(0, 8000)]
      : undefined,
    subSteps:
      state.currentTaskSubSteps.length > 0
        ? state.currentTaskSubSteps
        : undefined,
  };

  return {
    taskResults: [result],
    fileRegistrySnapshot: state.generatedFiles,
    currentTaskIndex: state.currentTaskIndex + 1,
    verifyErrors: "",
    fixAttempts: 0,
    currentTaskGeneratedFiles: [],
    currentTaskCostUsd: 0,
    currentTaskDurationMs: 0,
    currentTaskTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    currentTaskRetryCount: 0,
    currentTaskLastError: "",
    currentTaskLastRawContent: "",
    currentTaskSubSteps: [],
  };
}

async function taskFailed(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];
  const failureMsg =
    state.currentTaskLastError ||
    "Task generation failed after retries. No additional error details.";
  console.warn(
    `[Worker:${state.workerLabel}] Task failed after retries: "${task.title}" (${state.currentTaskRetryCount}/${MAX_TASK_GENERATION_RETRIES + 1})`,
  );

  // ── RALPH Phase 3: persist failure in progress files ───────────────────────
  if (state.ralphConfig.enabled) {
    const tracker = new ProgressTracker(state.outputDir);
    try {
      await tracker.markFailed(task.id, failureMsg);
      await tracker.recordError(task.id, state.currentTaskRetryCount, failureMsg);
    } catch (e) {
      console.warn(`[Worker:${state.workerLabel}] RALPH progress write failed: ${e}`);
    }
  }

  const result: TaskResult = {
    taskId: task.id,
    status: "failed",
    generatedFiles: state.currentTaskGeneratedFiles,
    costUsd: state.currentTaskCostUsd,
    durationMs: state.currentTaskDurationMs,
    tokenUsage: state.currentTaskTokenUsage,
    verifyPassed: false,
    fixCycles: state.currentTaskRetryCount,
    warnings: [failureMsg.slice(0, 500)],
  };

  return {
    taskResults: [result],
    fileRegistrySnapshot: state.generatedFiles,
    currentTaskIndex: state.currentTaskIndex + 1,
    verifyErrors: "",
    fixAttempts: 0,
    currentTaskGeneratedFiles: [],
    currentTaskCostUsd: 0,
    currentTaskDurationMs: 0,
    currentTaskTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    currentTaskRetryCount: 0,
    currentTaskLastError: "",
    currentTaskLastRawContent: "",
  };
}

export function extractErrorFiles(stderr: string): string[] {
  const fileSet = new Set<string>();
  const regex = /([^\s(]+\.tsx?)\(\d+,\d+\):/g;
  let match;
  while ((match = regex.exec(stderr)) !== null) {
    fileSet.add(match[1]);
  }
  return [...fileSet];
}

const CONFIG_ERROR_PATTERNS: {
  pattern: RegExp;
  configFiles: string[];
}[] = [
  {
    pattern: /TS17004|TS1484|--jsx/,
    configFiles: ["tsconfig.json", "tsconfig.node.json", "tsconfig.app.json"],
  },
  {
    pattern: /TS5023|TS5024|TS6046/,
    configFiles: ["tsconfig.json", "tsconfig.node.json"],
  },
  {
    pattern: /TS2307.*Cannot find module/,
    configFiles: ["package.json", "tsconfig.json"],
  },
];

export async function inferRelatedConfigFiles(
  errors: string,
  outputDir: string,
  taskFiles: string[],
): Promise<string[]> {
  const candidates = new Set<string>();

  for (const { pattern, configFiles } of CONFIG_ERROR_PATTERNS) {
    if (pattern.test(errors)) {
      for (const cf of configFiles) candidates.add(cf);
    }
  }

  candidates.add("package.json");

  const taskDirs = new Set(
    taskFiles
      .map((f) => f.split("/").slice(0, -1).join("/"))
      .filter((d) => d.length > 0),
  );

  for (const dir of taskDirs) {
    candidates.add(`${dir}/tsconfig.json`);
    candidates.add(`${dir}/package.json`);
    const parts = dir.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      candidates.add(`${parent}/tsconfig.json`);
      candidates.add(`${parent}/package.json`);
    }
  }

  const found: string[] = [];
  for (const candidate of candidates) {
    const content = await fsRead(candidate, outputDir);
    if (!content.startsWith("FILE_NOT_FOUND") && !content.startsWith("REJECTED")) {
      found.push(candidate);
    }
  }
  return found;
}

export function hasConfigErrors(errors: string): boolean {
  return /TS17004|TS1484|TS5023|TS5024|TS6046|--jsx/.test(errors);
}

// ─── Build the subgraph ───

export function createWorkerSubGraph() {
  const graph = new StateGraph(WorkerStateAnnotation)
    .addNode("pick_next_task", pickNextTask)
    .addNode("generate_code", generateCode)
    .addNode("verify", verifyCode)
    .addNode("task_fix", taskFix)
    .addNode("task_done", taskDone)
    .addNode("task_failed", taskFailed)

    .addEdge(START, "pick_next_task")
    .addConditionalEdges("pick_next_task", shouldContinueOrEnd, {
      generate_code: "generate_code",
      __end__: END,
    })
    .addConditionalEdges("generate_code", routeAfterGenerate, {
      generate_code: "generate_code",
      verify: "verify",
      task_failed: "task_failed",
    })
    .addConditionalEdges("verify", routeAfterVerify, {
      task_done: "task_done",
      task_fix: "task_fix",
      task_failed: "task_failed",
    })
    .addEdge("task_fix", "verify")
    .addEdge("task_done", "pick_next_task")
    .addEdge("task_failed", "pick_next_task");

  return graph.compile();
}
