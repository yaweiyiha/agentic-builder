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
import {
  estimateCost,
  type ChatMessage,
  chatCompletionWithFallback,
} from "@/lib/openrouter";
import { invokeCodegenOrOpenRouter } from "@/lib/codegen-openai-compatible";
import { resolveModel } from "@/lib/openrouter";
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import type {
  CodingAgentRole,
  CodingTask,
  TaskSubStep,
} from "@/lib/pipeline/types";
import type {
  OpenRouterResponse,
  OpenRouterToolDefinition,
} from "@/lib/llm-types";
import { ProgressTracker } from "@/lib/ralph";
import {
  snapshotModifiesFiles,
  verifyTaskFilePlan,
  formatUnfulfilledMessage,
  TASK_FILE_PLAN_UNFULFILLED_REGEX,
} from "./task-file-plan-verifier";
import {
  snapshotTask,
  restoreTask,
  discardTaskSnapshot,
} from "./task-snapshot";
import { pickPrdSpecEntriesForTask } from "./prd-spec-prompt";
import { getRepairEmitter } from "@/lib/pipeline/self-heal";
import { recordCodingSessionLlmUsage } from "@/lib/pipeline/coding-session-report";

const DEFAULT_WORKER_CODEGEN_MAX_OUTPUT_TOKENS = 32768;
const MAX_OUTPUT_TOKENS = (() => {
  const raw = Number(process.env.WORKER_CODEGEN_MAX_OUTPUT_TOKENS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_WORKER_CODEGEN_MAX_OUTPUT_TOKENS;
  }
  return Math.min(Math.max(Math.floor(raw), 1024), 32768);
})();
const MAX_TASK_GENERATION_RETRIES = 2;
const MAX_WORKER_TOOL_ITERATIONS = 6;
const MAX_WORKER_TOOL_OUTPUT_CHARS = 4000;
const WORKER_LLM_HEARTBEAT_MS = 10_000;
const CODEGEN_MULTI_ROUND_ENABLED = (() => {
  const raw = (process.env.CODEGEN_MULTI_ROUND_ENABLED ?? "1")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
})();
const CODEGEN_FILE_BATCH_SIZE = (() => {
  const raw = Number(process.env.CODEGEN_FILE_BATCH_SIZE ?? "2");
  if (!Number.isFinite(raw) || raw <= 0) return 2;
  return Math.min(Math.max(Math.floor(raw), 1), 8);
})();
const CODEGEN_MULTI_ROUND_MAX_ROUNDS = (() => {
  const raw = Number(process.env.CODEGEN_MULTI_ROUND_MAX_ROUNDS ?? "8");
  if (!Number.isFinite(raw) || raw <= 0) return 8;
  return Math.min(Math.max(Math.floor(raw), 1), 20);
})();
const DEFAULT_WORKER_TSC_FIX_MAX_ATTEMPTS = 1;
const DEFAULT_WORKER_TSC_FIX_MAX_ATTEMPTS_RALPH_CAP = 1;
const DEFAULT_WORKER_TSC_ERROR_CONTEXT_MAX_CHARS = 3000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function getWorkerTscFixConfig(): {
  maxFixAttempts: number;
  maxFixAttemptsRalphCap: number;
  errorContextMaxChars: number;
} {
  return {
    maxFixAttempts: readPositiveIntEnv(
      "WORKER_TSC_FIX_MAX_ATTEMPTS",
      DEFAULT_WORKER_TSC_FIX_MAX_ATTEMPTS,
    ),
    maxFixAttemptsRalphCap: readPositiveIntEnv(
      "WORKER_TSC_FIX_MAX_ATTEMPTS_RALPH_CAP",
      DEFAULT_WORKER_TSC_FIX_MAX_ATTEMPTS_RALPH_CAP,
    ),
    errorContextMaxChars: readPositiveIntEnv(
      "WORKER_TSC_ERROR_CONTEXT_MAX_CHARS",
      DEFAULT_WORKER_TSC_ERROR_CONTEXT_MAX_CHARS,
    ),
  };
}

/** Approximate maximum context window for context-rotation threshold calculations. */
const MAX_CONTEXT_TOKENS = 200_000;

/** The exact string the LLM must output to signal intentional task completion. */
const RALPH_COMPLETE_TOKEN = "<promise>TASK_COMPLETE</promise>";
const RALPH_FAILED_RE = /<promise>TASK_FAILED:\s*([\s\S]*?)<\/promise>/;

/**
 * Import path rules injected into frontend/test prompts.
 * Some scaffolds configure `@` → `./src`, while others intentionally do not.
 */
const FRONTEND_IMPORT_RULES = `
## Frontend import path rules
- Read the provided \`vite.config.ts\` / \`tsconfig.json\` context before writing imports.
- If those files show \`@\` mapped to \`./src\`, use the \`@/\` alias for cross-directory imports.
- If no alias is configured, use normal relative imports and do NOT invent \`@/\`.
- If the project includes a shared package, import it using the package name defined in its \`package.json\` (for example \`@project/shared\`), never via deep relative paths into another package.
`;

const WORKER_READONLY_TOOLS_GUIDE = `
## Available read-only tools
- \`read_file(path)\`: read an existing file before editing or importing from it.
- \`list_files(dir?)\`: inspect the current generated project tree when you need to locate files.
- \`grep(pattern, path?)\`: search code/content across the generated project before making assumptions.
- Use these tools whenever the task depends on existing files, exports, routes, or scaffold conventions not fully shown in context.
`;

const WORKER_READONLY_TOOLS: OpenRouterToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a file by relative path from the generated project root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative file path, e.g. frontend/src/router.tsx",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files recursively under a directory relative to the generated project root.",
      parameters: {
        type: "object",
        properties: {
          dir: {
            type: "string",
            description:
              "Directory relative to project root. Omit or use '.' for root.",
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
        "Search for a pattern in project files and return matching lines with file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex or literal text to search for.",
          },
          path: {
            type: "string",
            description:
              "File or directory relative to project root. Defaults to '.'.",
          },
        },
        required: ["pattern"],
      },
    },
  },
];

const ROLE_PROMPTS: Record<CodingAgentRole, string> = {
  architect: `You are a Senior Software Architect Agent.
Generate scaffolding/config/shared foundations for the assigned task.

Rules:
- Follow the scaffold and task scope; prefer extending existing files over creating duplicate structures.
- Use valid JSON/TS syntax.
- If the project includes a shared package, import it using the actual package name shown in context (never invent \`@shared/*\` aliases).
- For Zod naming, use \`camelCaseSchema\` for runtime values and \`*Input\` / \`*Dto\` for inferred types.
- If you create a brand new Vite project from scratch and choose to use the \`@\` alias, wire it consistently in both \`vite.config.ts\` and \`tsconfig.json\`.
- In React/TSX files, do NOT annotate component return types as bare \`JSX.Element\`. Prefer inferred return types; if an explicit annotation is truly needed, use \`React.JSX.Element\`.
- Do NOT alias API response DTOs directly to persistence/entity model types (for example \`type MeResponseDto = User\`). Define a dedicated DTO shape that exposes only the fields the API actually returns.
${FRONTEND_IMPORT_RULES}
${WORKER_READONLY_TOOLS_GUIDE}
For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.

When you have successfully generated all required files, end your response with exactly:
${RALPH_COMPLETE_TOKEN}
If you cannot complete the task, end with: <promise>TASK_FAILED: <reason></promise>`,

  frontend: `You are a Senior Frontend Engineer Agent.
Generate React + TypeScript + Tailwind code for the assigned task.

Rules:
- Keep routing/page structure consistent with existing project layout.
- **Directory convention (MANDATORY for M-tier / Vite+React projects)**:
  - Page-level view components MUST be placed under \`frontend/src/views/\` (e.g. \`frontend/src/views/LoginPage.tsx\`, \`frontend/src/views/DashboardPage.tsx\`).
  - NEVER place pages under \`frontend/src/pages/\` — that path is for Next.js projects only. This project uses Vite + React Router.
  - Use a **flat** structure inside \`views/\`: one file per page, do NOT nest into subdirectories like \`views/auth/LoginPage.tsx\`. Instead use \`views/LoginPage.tsx\`, \`views/RegisterPage.tsx\`, etc.
  - Route registration lives in \`frontend/src/router.tsx\`; import page components from \`./views/...\`.
- If the project includes a shared package, import it using the actual package name shown in context (never invent \`@shared/*\` or \`@repo/shared/*\`).
- **Design compliance (MANDATORY)**: The merged **Project Context** includes \`## Design Specification\`, \`## Pencil design (implementation summary)\`, and often an English \`## Codegen handoff\` block (per-screen colors, typography, layout, route hints, PNG mapping). Treat these as the source of truth above generic templates; **Codegen handoff** is the structured counterpart to exported PNGs.
  - Match page structure, section order, and component hierarchy from Design Specification.
  - Apply colors, typography, spacing, and radii stated in the Pencil summary or Design Specification using Tailwind (use exact values, e.g. arbitrary colors \`bg-[#0a0a0a]\` when specified).
  - If **Design assets on disk** lists files under \`public/design/\`, reference them in JSX (e.g. \`<img src="/design/..." />\` or imports) where they correspond to screens in the spec.
  - Do not replace the design-driven layout with a minimal placeholder UI when the spec is present.
- Keep edits scoped to this task.
- ALWAYS type every event handler and callback parameter explicitly:
    ✅  (e: React.ChangeEvent<HTMLInputElement>) => ...
    ✅  (e: React.FormEvent<HTMLFormElement>) => ...
    ✅  (e: React.MouseEvent<HTMLButtonElement>) => ...
    ❌  (e) => ...   // implicit any — forbidden
- ALWAYS type every function parameter and return value; never rely on implicit \`any\`.
- In React/TSX files, do NOT write bare \`JSX.Element\` return types. Prefer inferred component return types; if an explicit annotation is required, use \`React.JSX.Element\`.
- For auth/session API types, never alias DTOs directly to broad model/entity types like \`User\`. Define a narrow DTO shape (for example id/name/email/avatar/timezone plus explicitly optional auth-only fields) so frontend auth flows do not inherit unrelated model unions.

## MANDATORY: Single canonical API client (M-tier)
- The scaffold ships exactly ONE HTTP client at \`frontend/src/api/client.ts\` exporting \`apiClient\` with methods \`get / post / put / patch / delete\` and an options bag \`{ auth?, headers?, query?, signal? }\`.
- Feature code MUST import from \`./client\`, \`../api/client\`, or \`@/api/client\`. NEVER create \`frontend/src/utils/apiClient.ts\`, \`frontend/src/utils/api.ts\`, \`frontend/src/lib/http.ts\`, \`frontend/src/services/http.ts\`, or any other parallel HTTP wrapper.
- Pass query params via \`apiClient.get(path, { query: { foo: 1 } })\`. NEVER stringify queries into the path. NEVER add a second positional \`auth\` argument; auth is read from \`opts.auth\` (defaults to true).
- Use \`apiClient.patch\` for partial updates. Never call \`.patch\` on an alternative client that lacks it.
- When throwing wrapped errors, write \`throw new Error(message, { cause: e })\` — never \`throw new Error(message, e)\` (the second positional arg is invalid and will fail \`tsc\`).

## MANDATORY: useEffect / useLayoutEffect typing
- Do NOT annotate effect callbacks with \`(): void =>\`. The callback may return a cleanup function so the type must be inferred. Write \`useEffect(() => { ... })\`.

- Only import from files that are listed in "Already generated files" or in this task's file hints.
  If a dependency file does not exist yet, create a minimal stub for it in this same response.

## MANDATORY: No Mock / Hardcoded Data — Real API Calls Only
These rules are NON-NEGOTIABLE and override any other consideration:
- ❌ FORBIDDEN: \`const mockData = [...]\`, \`const fakeItems = [...]\`, \`useState([{ id: 1, ... }])\` initialized with hardcoded objects, any inline array literal used as substitute for API data.
- ❌ FORBIDDEN: \`// TODO: replace with real API\`, \`// temporary mock\`, placeholder data of any kind.
- ❌ FORBIDDEN: Creating ANY mock/fake API interceptor file (e.g. \`mockApi.ts\`, \`mock-server.ts\`, \`msw/handlers.ts\`, \`__mocks__/*\`). NEVER import or create such files. NEVER add \`import "./lib/mockApi"\` or similar side-effect imports that intercept \`fetch\`/\`XMLHttpRequest\`.
- ✅ REQUIRED: Every list, table, card grid, or detail view that displays data from the backend MUST use \`useEffect\` + the existing API client (\`frontend/src/api/client.ts\` or equivalent) to fetch from the real endpoint.
- ✅ REQUIRED: Before coding, use the \`read_file\` tool to read \`frontend/src/api/client.ts\` and any relevant backend route files to know exactly which endpoints exist and what they return.
- ✅ REQUIRED: Show a loading state while data is being fetched (e.g. \`isLoading\` flag) and an error state if the fetch fails. Render the real response data, not static arrays.
- ✅ REQUIRED: All mutations (create, update, delete) MUST call the corresponding API endpoint via the API client, not update local state only.
- If an endpoint is listed in the task description, use that exact path. If not listed, use the \`grep\` tool to find the backend route files and determine the correct endpoint path before coding.

## MANDATORY: AuthContext / AuthProvider must be functional
- If the task creates or modifies \`AuthContext\` or \`AuthProvider\`, it MUST implement real auth state management:
  - Read \`token\` / \`user\` from \`localStorage\` on mount.
  - Expose \`login(token, user)\`, \`logout()\` functions that update both state and \`localStorage\`.
  - Set \`isAuthenticated\` based on whether a valid token exists.
  - NEVER ship a no-op provider that always returns \`{ isAuthenticated: false, user: null }\`.

## MANDATORY: Observable loading / disabled transitions
Any transient UI state that the PRD or E2E test observes (loading spinner, disabled submit button, "Loading" / "Submitting" text, skeleton placeholder) MUST remain visible for **at least 300–500 ms** after the state enters. A local backend — or a Playwright \`route.fulfill\` mock — can resolve in under 50 ms, which is shorter than the poll interval of both human eyes and most E2E assertion frameworks. Without a minimum duration, assertions like \`expect(button).toBeDisabled()\` or \`expect(locator('text=Loading')).toBeVisible()\` will flake even though the feature works.

- ✅ REQUIRED: Wrap awaited network calls that drive a loading state with a minimum-duration helper, e.g.
  \`\`\`ts
  const MIN_TRANSIENT_MS = 400;
  const withMinDuration = <T,>(p: Promise<T>, ms: number) =>
    Promise.all([p, new Promise(r => setTimeout(r, ms))]).then(([v]) => v as T);
  await withMinDuration(apiClient.post("/records", payload), MIN_TRANSIENT_MS);
  \`\`\`
- ✅ REQUIRED: Keep \`isSubmitting\` / \`isLoading\` / \`disabled\` flags \`true\` for the full minimum window, even when the backend is fast.
- ❌ FORBIDDEN: Relying on the backend latency alone to make a spinner visible. This is flaky in CI and fails against mocked responses.

${FRONTEND_IMPORT_RULES}
${WORKER_READONLY_TOOLS_GUIDE}
For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.

When you have successfully generated all required files, end your response with exactly:
${RALPH_COMPLETE_TOKEN}
If you cannot complete the task, end with: <promise>TASK_FAILED: <reason></promise>`,

  backend: `You are a Senior Backend Engineer Agent.
Generate backend code (routes/services/domain logic) for the assigned task.

Rules:
- Keep exports/imports consistent with existing modules and contracts.
- **Skeleton override rule**: If a file listed in this task already exists on disk with only placeholder stubs (e.g. \`throw new Error("Not implemented")\`), you MUST **replace the entire file** with a complete, working implementation. Read the existing file first, then output the full replacement via \`\`\`file:<path>\`. Do NOT leave any \`throw new Error("Not implemented")\` stubs in your output.
- If the project includes a shared package, import it using the actual package name shown in context (never invent \`@shared/*\` or \`@repo/shared/*\`).
- Use \`camelCaseSchema\` values and \`*Input\` / \`*Dto\` inferred types.
- Backend code does NOT use Vite aliases. Use relative imports or backend-specific path aliases only if the project config explicitly defines them.
- Keep edits scoped to this task.
- **Sequelize / persistence consistency rule (MANDATORY)**:
  - Treat \`id\`, \`createdAt\`, \`updatedAt\`, \`deletedAt\`, timestamps, slugs, and similar lifecycle/generated fields as **system fields** unless the PRD explicitly says the user submits them.
  - For every create/update flow, keep these four layers consistent: request DTO/types, request validation schema, service/controller payload, and ORM model definition.
  - If a model field is \`allowNull: false\`, then exactly one of the following must be true:
    1. the create/update payload explicitly provides it;
    2. the model defines a \`defaultValue\`;
    3. the ORM/database lifecycle automatically fills it and the model configuration fully supports that behavior.
  - If a model uses Sequelize \`timestamps: true\`, do NOT require services/controllers to manually pass \`createdAt\` / \`updatedAt\` unless the project already follows that convention consistently.
  - Create DTOs / validation schemas MUST NOT require system-generated fields.
  - Before finalizing backend code, cross-check: the fields accepted by validation, the fields in the DTO/type, the fields passed into \`Model.create\` / \`Model.update\`, and the model's required/defaulted fields must agree.
- Stick to the framework already in the project. Read \`package.json\`, \`app.ts\`, and route entry files in context first. If the project uses **Koa**, keep Koa. If it uses **Express**, keep Express. If it uses **Fastify**, keep Fastify. Do not switch frameworks.

## MANDATORY: Koa request body access (M-tier)
- The scaffold provides a global \`koa\` module augmentation at \`backend/src/types/koa.d.ts\` so \`ctx.request.body\` is typed as \`unknown\`. Read it directly: \`const body = ctx.request.body;\`. NEVER write \`(ctx.request as any).body\` and never duplicate the augmentation in feature files.
- Validate the body with Joi (or another typed schema) before consuming it; do NOT keep \`unknown\` flowing into business logic.
- When you need a typed Koa context, import \`AppKoaContext\` from \`backend/src/types/koa.ts\`. Do NOT redefine \`Context\` per file.

## MANDATORY: Koa routing semantics
- \`validateBody(schema)\` is for request bodies and MUST only appear on \`apiRouter.post / .put / .patch / .delete\` routes that actually receive a JSON body. NEVER attach \`validateBody\` to \`apiRouter.get\`.
- Handler naming must match the HTTP verb: \`GET\` → \`list* / get* / fetch*\`; \`POST\` → \`create*\`; \`PUT / PATCH\` → \`update*\`; \`DELETE\` → \`remove* / delete*\`. Do NOT bind a \`createXxx\` handler to a \`GET\` route.
- Each domain owns ONE registrar function (e.g. \`registerAuthRoutes\`). Do NOT split the same domain across multiple files that both register overlapping paths (e.g. \`/invitations\` declared in both \`workspaces.routes.ts\` and \`invitations.routes.ts\`).
- Use the canonical signature \`export function registerXxxRoutes(apiRouter: Router): void\` and call \`apiRouter.<verb>(...)\` directly so the route audit can recognise the bindings.
- Every endpoint declared in \`API_CONTRACTS.json\` for your domain MUST be implemented and registered (e.g. \`POST /api/auth/reset-password\`, \`PATCH /api/users/me\`). Do not silently skip contract entries.

## MANDATORY: JWT (M-tier)
- Import \`signJwt\` and \`verifyJwt\` from \`backend/src/utils/jwt.ts\` (canonical helper). Do NOT call \`jsonwebtoken\` directly in feature code, do NOT redeclare \`expiresIn\` typing, and do NOT recreate \`utils/jwt.ts\`.
- Read \`JWT_SECRET\` only inside \`utils/jwt.ts\`; feature code relies on the helper to throw a meaningful error if the secret is missing.

## MANDATORY: Sequelize model field declarations
- Field declarations on model classes MUST use \`declare\`:
    \`declare id: string;\`
    \`declare email: string;\`
  Without \`declare\`, public class fields shadow Sequelize accessors at runtime so \`instance.id\` is always \`undefined\`.

## MANDATORY: Enum / literal narrowing
- When narrowing user input to a string-literal union (e.g. project status), use \`parseEnumLiteral(value, ["active", "archived"])\` from \`backend/src/utils/narrow.ts\` instead of unchecked \`as\`-casts.
- When the project uses Express, these typing rules are mandatory:
    - \`req.params\` is \`Record<string, string>\` — access as \`req.params.id\` (string, safe).
    - \`req.headers\` values are \`string | string[] | undefined\` — always narrow:
        const auth = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
    - NEVER pass \`req.params.x\` or \`req.headers.x\` directly to a function expecting only \`string\` without narrowing.
- Guard \`req.user\` before use — it is \`Express.User | undefined\`:
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
- ALWAYS type every function parameter explicitly; never use implicit \`any\`.
- Only import types/interfaces that actually exist in the shared package context provided.
  If a shared type is missing, define a local interface instead of importing a non-existent path.
${WORKER_READONLY_TOOLS_GUIDE}

For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.

When you have successfully generated all required files, end your response with exactly:
${RALPH_COMPLETE_TOKEN}
If you cannot complete the task, end with: <promise>TASK_FAILED: <reason></promise>`,

  test: `You are a Senior QA / Test Engineer Agent.
Generate comprehensive test suites: unit, integration, e2e.
Frameworks: Vitest, @testing-library/react, Playwright, k6.
${FRONTEND_IMPORT_RULES}
${WORKER_READONLY_TOOLS_GUIDE}
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
      'v5/6 (default for generated apps): `datasource db { provider = "postgresql" url = env("DATABASE_URL") }`. ' +
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

export async function buildVersionConstraints(
  outputDir: string,
): Promise<string> {
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

function getResponseUsageCounts(response: OpenRouterResponse): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
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
    usage?.total_tokens ??
    usage?.totalTokens ??
    promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function buildSearchMatcher(pattern: string): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern, "i");
    return (line: string) => regex.test(line);
  } catch {
    const lowered = pattern.toLowerCase();
    return (line: string) => line.toLowerCase().includes(lowered);
  }
}

async function executeWorkerReadonlyTool(
  name: string,
  args: Record<string, unknown>,
  outputDir: string,
): Promise<string> {
  switch (name) {
    case "read_file": {
      const filePath = String(args.path ?? "").trim();
      if (!filePath) return "Error: path is required";
      const content = await fsRead(filePath, outputDir);
      return content.slice(0, MAX_WORKER_TOOL_OUTPUT_CHARS);
    }
    case "list_files": {
      const dir = String(args.dir ?? ".").trim() || ".";
      const files = await listFiles(dir, outputDir);
      return (files.join("\n") || "(no files found)").slice(
        0,
        MAX_WORKER_TOOL_OUTPUT_CHARS,
      );
    }
    case "grep": {
      const pattern = String(args.pattern ?? "").trim();
      const searchPath = String(args.path ?? ".").trim() || ".";
      if (!pattern) return "Error: pattern is required";

      const matcher = buildSearchMatcher(pattern);
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
        if (!/\.(ts|tsx|js|jsx|json|css|md)$/.test(relPath)) continue;
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

      return (matches.join("\n") || "No matches found.").slice(
        0,
        MAX_WORKER_TOOL_OUTPUT_CHARS,
      );
    }
    default:
      return `Error: unknown tool '${name}'`;
  }
}

async function runCodegenWorkerLoop(
  messages: ChatMessage[],
  outputDir: string,
  sessionId?: string,
  workerLabel?: string,
): Promise<{
  content: string;
  rawContent: string;
  model: string;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}> {
  let totalCostUsd = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  for (let i = 0; i < MAX_WORKER_TOOL_ITERATIONS; i++) {
    const callStartedAt = Date.now();
    const heartbeat = setInterval(() => {
      const waitedSec = Math.floor((Date.now() - callStartedAt) / 1000);
      console.log(
        `[Worker] codegen still waiting... loop=${i + 1}/${MAX_WORKER_TOOL_ITERATIONS} waited=${waitedSec}s`,
      );
    }, WORKER_LLM_HEARTBEAT_MS);
    const response = await invokeCodegenOrOpenRouter(messages, {
      temperature: 0.3,
      max_tokens: MAX_OUTPUT_TOKENS,
      openRouterVariant: "codeGen",
      tools: WORKER_READONLY_TOOLS,
      tool_choice: "auto",
    }).finally(() => {
      clearInterval(heartbeat);
    });
    const choice = response.choices[0];
    const finishReason = choice?.finish_reason ?? "stop";
    const content = choice?.message?.content ?? "";
    const toolCalls = choice?.message?.tool_calls ?? [];
    const usage = getResponseUsageCounts(response);
    totalCostUsd += estimateCost(response.model, response.usage);
    promptTokens += usage.promptTokens;
    completionTokens += usage.completionTokens;
    totalTokens += usage.totalTokens;
    if (sessionId) {
      recordCodingSessionLlmUsage({
        sessionId,
        stage: "worker_codegen",
        label: workerLabel,
        model: response.model,
        costUsd: estimateCost(response.model, response.usage),
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      });
    }

    if (finishReason === "length") {
      throw new Error(
        `Worker codegen output truncated (finish_reason=length, model=${response.model})`,
      );
    }

    messages.push({
      role: "assistant",
      content,
      tool_calls: toolCalls,
    });

    if (toolCalls.length === 0) {
      return {
        content,
        rawContent: content,
        model: response.model,
        costUsd: totalCostUsd,
        promptTokens,
        completionTokens,
        totalTokens,
      };
    }

    for (const toolCall of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        args = {};
      }
      const result = await executeWorkerReadonlyTool(
        toolCall.function.name,
        args,
        outputDir,
      );
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: result,
      });
    }
  }

  throw new Error(
    `Worker tool loop exceeded ${MAX_WORKER_TOOL_ITERATIONS} iterations without final code output.`,
  );
}

interface MalformedFileBlock {
  filePath: string;
  headerLine: number;
  reason: string;
}

interface ParsedFileOutput {
  files: Record<string, string>;
  malformed: MalformedFileBlock[];
  /** Total number of file-block headers we encountered (valid + malformed). */
  headerCount: number;
}

/**
 * State-machine file-block parser.
 *
 * Accepts any of the following header forms (case-insensitive, tolerant
 * of leading whitespace):
 *   ```file:path/to/foo.ts
 *   ```ts file:path/to/foo.ts
 *   ```typescript file:path/to/foo.ts
 *   ````file:path/to/foo.ts      (4+ backticks)
 *
 * The closing fence must have the same run-length as the opener, which
 * lets file content itself contain nested triple-backtick fences without
 * confusing the parser.
 *
 * Any block that starts but never closes is recorded in `malformed` so the
 * caller can surface a structured repair event rather than silently
 * dropping file(s).
 */
function parseFileOutputRobust(raw: string): ParsedFileOutput {
  const out: ParsedFileOutput = { files: {}, malformed: [], headerCount: 0 };
  if (!raw) return out;

  const lines = raw.split("\n");
  // Match: optional leading whitespace, 3+ backticks, optional language word,
  // the literal `file:`, and then the path (no internal whitespace allowed).
  const HEADER = /^\s*(`{3,})\s*(?:[A-Za-z0-9_+-]+\s+)?file:(\S+?)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const m = HEADER.exec(lines[i]);
    if (!m) continue;
    out.headerCount += 1;

    const fence = m[1];
    const rawFilePath = m[2];
    const filePath = rawFilePath.trim();
    const headerLine = i + 1;

    if (!filePath || isUnsafePath(filePath)) {
      out.malformed.push({
        filePath: rawFilePath,
        headerLine,
        reason: filePath ? "unsafe path (absolute or traversal)" : "empty path",
      });
      // Skip this block entirely but keep scanning for later ones.
      const closer = findMatchingFence(lines, i + 1, fence);
      if (closer >= 0) i = closer;
      continue;
    }

    const closer = findMatchingFence(lines, i + 1, fence);
    if (closer < 0) {
      out.malformed.push({
        filePath,
        headerLine,
        reason: "unclosed fence — end of output reached before matching closer",
      });
      break;
    }
    const body = lines.slice(i + 1, closer).join("\n");
    out.files[filePath] = body;
    i = closer;
  }

  return out;
}

function findMatchingFence(
  lines: string[],
  startIdx: number,
  fence: string,
): number {
  const closer = new RegExp(`^\\s*${fence}\\s*$`);
  for (let j = startIdx; j < lines.length; j++) {
    if (closer.test(lines[j])) return j;
  }
  return -1;
}

function isUnsafePath(filePath: string): boolean {
  if (filePath.includes("..")) return true;
  if (/^[\\/]/.test(filePath)) return true;
  if (/^[A-Za-z]:[\\/]/.test(filePath)) return true;
  return false;
}

function parseFileOutput(raw: string): Record<string, string> {
  return parseFileOutputRobust(raw).files;
}

function validateCodegenFileOutput(raw: string): void {
  const parsed = parseFileOutputRobust(raw);
  if (parsed.headerCount === 0) return;

  const parsedCount = Object.keys(parsed.files).length;
  if (parsed.malformed.length > 0 || parsedCount < parsed.headerCount) {
    const reasons = parsed.malformed
      .map((m) => `${m.filePath}@L${m.headerLine}: ${m.reason}`)
      .slice(0, 5)
      .join("; ");
    throw new Error(
      `Incomplete file output detected: parsed ${parsedCount}/${parsed.headerCount} file block(s). ` +
        `Refusing to write partial content.${reasons ? " Issues: " + reasons : ""}`,
    );
  }
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

function getTaskFilePlanBuckets(taskFiles: unknown): {
  creates: string[];
  modifies: string[];
  reads: string[];
} {
  if (!taskFiles || typeof taskFiles !== "object" || Array.isArray(taskFiles)) {
    return { creates: [], modifies: [], reads: [] };
  }
  const record = taskFiles as Record<string, unknown>;
  const readBucket = (key: "creates" | "modifies" | "reads"): string[] =>
    Array.isArray(record[key])
      ? (record[key] as unknown[]).filter(
          (f): f is string => typeof f === "string",
        )
      : [];
  return {
    creates: readBucket("creates"),
    modifies: readBucket("modifies"),
    reads: readBucket("reads"),
  };
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
    ? (record.creates as unknown[]).filter(
        (f): f is string => typeof f === "string",
      )
    : [];
  const modifies = Array.isArray(record.modifies)
    ? (record.modifies as unknown[]).filter(
        (f): f is string => typeof f === "string",
      )
    : [];
  const reads = Array.isArray(record.reads)
    ? (record.reads as unknown[]).filter(
        (f): f is string => typeof f === "string",
      )
    : [];
  const lines: string[] = [];
  if (creates.length > 0)
    lines.push(`Creates:\n${creates.map((f) => `- ${f}`).join("\n")}`);
  if (modifies.length > 0)
    lines.push(`Modifies:\n${modifies.map((f) => `- ${f}`).join("\n")}`);
  if (reads.length > 0)
    lines.push(`Reads:\n${reads.map((f) => `- ${f}`).join("\n")}`);
  return lines.length > 0 ? `\nTask file plan:\n${lines.join("\n")}` : "";
}

function getRemainingPlannedCreates(
  task: CodingTask,
  writtenFiles: string[],
): string[] {
  const { creates } = getTaskFilePlanBuckets(task.files);
  const writtenSet = new Set(
    writtenFiles.map((file) => file.replace(/\\/g, "/")),
  );
  return creates.filter((file) => !writtenSet.has(file.replace(/\\/g, "/")));
}

function scoreGeneratedFileForTask(
  file: GeneratedFile,
  task: CodingTask,
  workerRole: CodingAgentRole,
): number {
  const normalizedPath = file.path.replace(/\\/g, "/");
  const hints = normalizeTaskFileHints(task.files).map((f) =>
    f.replace(/\\/g, "/"),
  );
  let score = 0;

  for (const hint of hints) {
    if (normalizedPath === hint) {
      score += 1000;
      continue;
    }
    if (matchesTaskPathHint(normalizedPath, hint)) {
      score += 700;
    }
  }

  if (file.role === workerRole) score += 240;

  const basename = path.posix.basename(normalizedPath);
  if (
    normalizedPath === "frontend/src/api/client.ts" ||
    normalizedPath === "frontend/src/router.tsx" ||
    normalizedPath === "frontend/src/main.tsx" ||
    normalizedPath === "backend/src/app.ts" ||
    normalizedPath === "backend/src/server.ts" ||
    normalizedPath === "backend/src/api/modules/index.ts" ||
    normalizedPath === "packages/shared/src/index.ts" ||
    normalizedPath === "API_CONTRACTS.json" ||
    normalizedPath === "SCAFFOLD_SPEC.md"
  ) {
    score += 140;
  }

  if (basename === "index.ts" || basename === "index.tsx") score += 40;
  if (file.exports && file.exports.length > 0) score += 20;

  return score;
}

function buildGeneratedFileRegistryListing(
  state: WorkerState,
  task: CodingTask,
  limit = 30,
): string {
  const ranked = state.fileRegistrySnapshot
    .map((file, index) => ({
      file,
      index,
      score: scoreGeneratedFileForTask(file, task, state.role),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.index - a.index;
    })
    .slice(0, limit)
    .map(({ file }) => {
      const exportsNote =
        file.exports && file.exports.length > 0
          ? ` | exports: ${file.exports.slice(0, 8).join(", ")}`
          : "";
      return `- ${file.path} (${file.role}): ${file.summary}${exportsNote}`;
    });

  return ranked.join("\n");
}

function scoreCandidatePathForTask(
  normalizedPath: string,
  task: CodingTask,
  workerRole: CodingAgentRole,
  registryMeta?: GeneratedFile,
): number {
  if (registryMeta) {
    return scoreGeneratedFileForTask(registryMeta, task, workerRole);
  }

  const hints = normalizeTaskFileHints(task.files).map((f) =>
    f.replace(/\\/g, "/"),
  );
  let score = 0;

  for (const hint of hints) {
    if (normalizedPath === hint) {
      score += 1000;
      continue;
    }
    if (matchesTaskPathHint(normalizedPath, hint)) {
      score += 700;
    }
  }

  if (
    (workerRole === "frontend" && normalizedPath.startsWith("frontend/src/")) ||
    (workerRole === "backend" && normalizedPath.startsWith("backend/src/")) ||
    (workerRole === "architect" &&
      (normalizedPath.startsWith("packages/shared/") ||
        normalizedPath.endsWith("SCAFFOLD_SPEC.md") ||
        normalizedPath.endsWith("DEPENDENCY_PLAN.md"))) ||
    (workerRole === "test" &&
      (normalizedPath.includes("/e2e/") ||
        normalizedPath.includes(".spec.") ||
        normalizedPath.endsWith("playwright.config.ts")))
  ) {
    score += 240;
  }

  const basename = path.posix.basename(normalizedPath);
  if (
    normalizedPath === "frontend/src/api/client.ts" ||
    normalizedPath === "frontend/src/router.tsx" ||
    normalizedPath === "frontend/src/main.tsx" ||
    normalizedPath === "backend/src/app.ts" ||
    normalizedPath === "backend/src/server.ts" ||
    normalizedPath === "backend/src/api/modules/index.ts" ||
    normalizedPath === "packages/shared/src/index.ts" ||
    normalizedPath === "API_CONTRACTS.json" ||
    normalizedPath === "SCAFFOLD_SPEC.md" ||
    normalizedPath === "DEPENDENCY_PLAN.md"
  ) {
    score += 140;
  }

  if (basename === "index.ts" || basename === "index.tsx") score += 40;

  return score;
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

  // 3) Dynamically discover shared/frontend/backend source files so agents
  //    see the current scaffold layout and don't hallucinate old paths.
  try {
    const sharedFiles = await listFiles("packages/shared/src", state.outputDir);
    for (const f of sharedFiles) {
      if (/\.(ts|tsx)$/.test(f)) candidates.add(f.replace(/\\/g, "/"));
    }
  } catch {
    // listFiles may throw if the directory doesn't exist
  }
  try {
    const frontendFiles = await listFiles("frontend/src", state.outputDir);
    for (const f of frontendFiles) {
      if (/\.(ts|tsx|css)$/.test(f)) candidates.add(f.replace(/\\/g, "/"));
    }
  } catch {
    // non-M-tier layouts may not have frontend/
  }
  try {
    const backendFiles = await listFiles("backend/src", state.outputDir);
    for (const f of backendFiles) {
      if (/\.(ts|tsx)$/.test(f)) candidates.add(f.replace(/\\/g, "/"));
    }
  } catch {
    // non-M-tier layouts may not have backend/
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
    "frontend/package.json",
    "frontend/vite.config.ts",
    "frontend/tsconfig.json",
    "frontend/src/main.tsx",
    "frontend/src/router.tsx",
    "frontend/src/api/client.ts",
    "backend/package.json",
    "backend/src/app.ts",
    "backend/src/server.ts",
    "backend/src/api/modules/index.ts",
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
    const sessionCtx = await fsRead(
      ".ralph/session-context.md",
      state.outputDir,
    );
    if (
      !sessionCtx.startsWith("FILE_NOT_FOUND") &&
      !sessionCtx.startsWith("REJECTED")
    ) {
      contextPreamble.push(
        `## Prior session context (context rotation active)\n${sessionCtx.slice(0, 2000)}`,
      );
    }
  }

  // Build export map from key files so agents know exactly what is available
  const exportMapFiles = [
    "packages/shared/src/index.ts",
    "frontend/src/api/client.ts",
    "frontend/src/router.tsx",
    "frontend/src/main.tsx",
    "apps/web/src/lib/api.ts",
    "apps/web/src/lib/apiClient.ts",
    "apps/web/src/lib/auth.ts",
    "apps/web/src/contexts/AuthContext.tsx",
    "apps/web/src/App.tsx",
  ];
  const exportMapLines: string[] = [];
  for (const emf of exportMapFiles) {
    const emContent = await fsRead(emf, state.outputDir);
    if (
      emContent.startsWith("FILE_NOT_FOUND") ||
      emContent.startsWith("REJECTED")
    )
      continue;
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
  const registryByPath = new Map(
    state.fileRegistrySnapshot.map((file) => [
      file.path.replace(/\\/g, "/"),
      file,
    ]),
  );
  const selected = [...candidates]
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreCandidatePathForTask(
        candidate,
        task,
        state.role,
        registryByPath.get(candidate),
      ),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .slice(0, fileLimit)
    .map(({ candidate }) => candidate);
  const chunks: string[] = [];
  for (const rel of selected) {
    const content = await fsRead(rel, state.outputDir);
    if (
      content.startsWith("FILE_NOT_FOUND") ||
      content.startsWith("REJECTED")
    ) {
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
    const detail = colonIdx > 0 ? cleanLine.slice(colonIdx + 1).trim() : "";
    return { step: idx + 1, action, detail };
  });
}

function parseCodegenRoundStatus(content: string): "done" | "continue" | null {
  const m = /STATUS:\s*(DONE|CONTINUE)/i.exec(content);
  if (!m) return null;
  return m[1].toUpperCase() === "DONE" ? "done" : "continue";
}

function parseTaskFilePlanFailureDetails(verifyErrors: string): {
  missingCreates: string[];
  unmodified: string[];
} {
  const parseList = (label: "missingCreates" | "unmodified"): string[] => {
    const match = new RegExp(`${label}=\\[([^\\]]*)\\]`).exec(verifyErrors);
    if (!match) return [];
    return match[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };
  return {
    missingCreates: parseList("missingCreates"),
    unmodified: parseList("unmodified"),
  };
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

async function pickNextTask(state: WorkerState) {
  const idx = state.currentTaskIndex;
  const total = state.tasks.length;
  const currentTask = idx < total ? state.tasks[idx] : null;
  if (currentTask) {
    console.log(
      `[Worker:${state.workerLabel}] Picking task ${idx + 1}/${total}: ${currentTask.title}`,
    );
  } else {
    console.log(`[Worker:${state.workerLabel}] All ${total} tasks done.`);
  }

  // Snapshot sha256 of the files the task plans to modify, so the post-gen
  // verifier can tell the difference between "LLM actually edited the file"
  // and "LLM said it would but didn't".
  const modifiesSnapshot = currentTask
    ? await snapshotModifiesFiles(currentTask, state.outputDir)
    : {};

  // Capture an on-disk rollback snapshot of everything the task plans to
  // touch. If the task fails after partial writes, `taskFailed` restores
  // the pre-task state — keeps a broken attempt from contaminating later
  // tasks or subsequent retries.
  if (currentTask) {
    await snapshotTask(currentTask, state.outputDir);
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
    currentTaskModifiesSnapshot: modifiesSnapshot,
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
    const promise = extractCompletionPromise(
      state.currentTaskLastRawContent ?? "",
    );
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
    // PrdSpec (PAGE-*/CMP-*) entries for this task — only useful for
    // frontend/test workers, but cheap to include for others too when the
    // task explicitly covers a page or component id.
    const prdSpecBlock = pickPrdSpecEntriesForTask(task, state.prdSpec);
    if (prdSpecBlock) {
      contextParts.push(prdSpecBlock);
    }
    if (state.fileRegistrySnapshot.length > 0) {
      const listing = buildGeneratedFileRegistryListing(state, task);
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
        .map((a) => {
          const parts = [
            `- **${a.method} ${a.endpoint}** [auth: ${a.authType ?? "none"}]`,
          ];
          if (a.requestFields && a.requestFields !== "none") {
            parts.push(`  - Request: \`${a.requestFields}\``);
          }
          if (a.responseFields && a.responseFields !== "none") {
            parts.push(`  - Response: \`${a.responseFields}\``);
          } else if (
            a.schema &&
            a.schema !== "extracted from source" &&
            a.schema !== "extracted by regex"
          ) {
            parts.push(`  - Schema: ${a.schema}`);
          }
          if (a.description) {
            parts.push(`  - ${a.description}`);
          }
          return parts.join("\n");
        })
        .join("\n");
      contextParts.push(
        `## Available API endpoints\n⚠️ Use ONLY these real endpoints. Do NOT use mock data or invent endpoints.\n${apis}`,
      );
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
    const subStepsHint =
      task.subSteps && task.subSteps.length > 0
        ? `\n\nPre-defined sub-steps:\n${task.subSteps.map((s) => `${s.step}. ${s.action}: ${s.detail}`).join("\n")}`
        : "";

    const multiRoundInstruction = CODEGEN_MULTI_ROUND_ENABLED
      ? `\n\nMULTI-ROUND OUTPUT MODE:\n- In this round, output at most ${CODEGEN_FILE_BATCH_SIZE} file block(s) using \`\`\`file:path\`\`\` format.\n- Prefer continuing with files not yet generated in this task.\n- However, if any previously generated file needs correction, completion, API wiring, import/export alignment, consistency fixes, or error fixes, you SHOULD rewrite that file in this round.\n- Do NOT preserve an incorrect earlier version just to avoid rewriting.\n- If more files are still needed for this task, end your response with: STATUS: CONTINUE\n- If task implementation is complete, end your response with: STATUS: DONE`
      : "";

    messages.push({
      role: "user",
      content: `## Task: ${task.title}\n\n${task.description}${fileHint}${subStepsHint}\n\nFirst, output a brief implementation plan inside <plan> tags (one numbered step per line).\nThen generate code for this task.${multiRoundInstruction}\n\nBefore writing, read and follow existing file contracts in context (imports, exports, naming, and paths). Extend existing modules instead of creating duplicate paths when possible. When context is insufficient, use the available read-only tools (\`read_file\`, \`list_files\`, \`grep\`) to inspect the generated project before coding.\n\nACCEPTANCE CRITERIA:\n1. Every button has a real onClick handler that updates state or triggers navigation.\n2. Every form has onSubmit with validation logic.\n3. Every input/toggle/select is controlled with useState + onChange.\n4. Links navigate to real routes (React Router Link or useNavigate).\n5. Timer/counter/animation logic uses real useEffect + setInterval/setTimeout.\n6. If Design Tokens are in context, match every color, size, gap, padding, radius, and font exactly using Tailwind arbitrary values.\n7. [FRONTEND DATA RULE] If this task renders any list, table, card grid, or detail view that displays backend data: ALL data MUST be fetched from the real API endpoint via the API client. ZERO hardcoded arrays, ZERO mock objects, ZERO placeholder data. Use useEffect + loading/error state. Read \`frontend/src/api/client.ts\` with read_file before coding to get the correct method signatures.`,
    });

    const startMs = Date.now();
    const fsOpts =
      state.scaffoldProtectedPaths.length > 0
        ? { scaffoldProtectedPaths: state.scaffoldProtectedPaths }
        : undefined;

    const writtenFiles: string[] = [];
    const writtenSet = new Set<string>();
    const newFileEntries: GeneratedFile[] = [];
    let totalCostUsd = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let aggregateRawContent = "";
    let rounds = 0;
    let lastModel = "unknown";

    while (rounds < CODEGEN_MULTI_ROUND_MAX_ROUNDS) {
      rounds += 1;
      const response = await runCodegenWorkerLoop(
        messages,
        state.outputDir,
        state.sessionId,
        state.workerLabel,
      );
      const content = response.content;
      validateCodegenFileOutput(content);
      const parsedFiles = parseFileOutput(content);
      const roundStatus = parseCodegenRoundStatus(content);
      totalCostUsd += response.costUsd;
      promptTokens += response.promptTokens;
      completionTokens += response.completionTokens;
      totalTokens += response.totalTokens;
      aggregateRawContent +=
        `\n\n<!-- round:${rounds} model:${response.model} -->\n` +
        response.rawContent;
      lastModel = response.model;

      let roundWrites = 0;
      for (const [fp, fc] of Object.entries(parsedFiles)) {
        const msg = await fsWrite(fp, fc, state.outputDir, fsOpts);
        if (msg.startsWith("SKIPPED_PROTECTED")) {
          console.log(`[Worker:${state.workerLabel}] ${msg}`);
          continue;
        }
        if (!writtenSet.has(fp)) {
          writtenSet.add(fp);
          writtenFiles.push(fp);
        }
        newFileEntries.push({
          path: fp,
          role: state.role,
          summary: `Generated for task: ${task.title}`,
        });
        roundWrites += 1;
      }

      console.log(
        `[Worker:${state.workerLabel}] codegen round ${rounds}/${CODEGEN_MULTI_ROUND_MAX_ROUNDS}: wrote ${roundWrites} file(s), status=${roundStatus ?? "implicit_done"}, model=${response.model}`,
      );

      const remainingCreates = getRemainingPlannedCreates(task, writtenFiles);
      const forcedContinue =
        CODEGEN_MULTI_ROUND_ENABLED &&
        remainingCreates.length > 0 &&
        rounds < CODEGEN_MULTI_ROUND_MAX_ROUNDS;
      if (forcedContinue && roundStatus !== "continue") {
        console.warn(
          `[Worker:${state.workerLabel}] codegen round ${rounds}: file plan still missing ${remainingCreates.length} create(s); overriding ${roundStatus ?? "implicit_done"} -> continue.`,
        );
      }
      const shouldContinue =
        CODEGEN_MULTI_ROUND_ENABLED &&
        (roundStatus === "continue" || forcedContinue) &&
        rounds < CODEGEN_MULTI_ROUND_MAX_ROUNDS;
      if (!shouldContinue) break;

      const knownFiles = writtenFiles
        .slice(-40)
        .map((f) => `- ${f}`)
        .join("\n");
      messages.push({
        role: "user",
        content: [
          "Continue with the next batch of files for this SAME task.",
          `Output at most ${CODEGEN_FILE_BATCH_SIZE} file block(s) in this round.`,
          "Prefer files not yet generated in this task.",
          "If any previously generated file is incomplete, inconsistent, miswired, or needs correction, rewrite it in this round.",
          "Do not preserve an incorrect earlier version just to avoid rewriting.",
          remainingCreates.length > 0
            ? `You still MUST create these planned file(s) before finishing:\n${remainingCreates.map((file) => `- ${file}`).join("\n")}`
            : "",
          "End with STATUS: CONTINUE or STATUS: DONE.",
          "",
          knownFiles ? `Already generated files:\n${knownFiles}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }
    const durationMs = Date.now() - startMs;

    console.log(
      `[Worker:${state.workerLabel}] Generated ${writtenFiles.length} files in ${(durationMs / 1000).toFixed(1)}s (rounds=${rounds}, model=${lastModel}, cost: $${totalCostUsd.toFixed(4)})`,
    );

    // RALPH: check for missing promise and log a warning (enforcement happens in routeAfterGenerate)
    if (state.ralphConfig.enabled) {
      const promise = extractCompletionPromise(aggregateRawContent);
      if (!promise.found) {
        console.warn(
          `[Worker:${state.workerLabel}] RALPH: completion promise absent for "${task.title}" (attempt ${attempt})`,
        );
      }
    }

    // Parse dynamic sub-steps from the LLM output
    const dynamicSubSteps = parsePlanBlock(aggregateRawContent);
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
      currentTaskCostUsd: totalCostUsd,
      currentTaskDurationMs: durationMs,
      currentTaskTokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      workerCostUsd: totalCostUsd,
      verifyErrors: "",
      fixAttempts: 0,
      currentTaskLastError: "",
      currentTaskLastRawContent: aggregateRawContent,
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
  const declRe =
    /Could not find a declaration file for module ['"]([^'"]+)['"]/g;
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

  const needsJestDom = /toBeInTheDocument|toHaveTextContent|toBeVisible/.test(
    tscOutput,
  );

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
  await shellExec(buildAddCommand(pm, unique), outputDir, { timeout: 60_000 });
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
            if (taskFiles.every((f) => f.split("/")[i] === part)) {
              return prefix ? `${prefix}/${part}` : part;
            }
            return prefix;
          }, "");

  const parts = commonPrefix ? commonPrefix.split("/") : [];
  for (let i = parts.length; i >= 1; i--) {
    const candidate = parts.slice(0, i).join("/") + "/tsconfig.json";
    const content = await fsRead(candidate, outputDir);
    if (
      !content.startsWith("FILE_NOT_FOUND") &&
      !content.startsWith("REJECTED")
    ) {
      return candidate;
    }
  }

  return null;
}

// ─── Verify node: file presence/safety only; project `tsc` runs in supervisor phase verify ───

async function verifyCode(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];

  // Scope to the current task's outputs. Phase-level verify (Supervisor) still
  // handles cross-task integration after all workers finish.
  const taskFiles =
    state.currentTaskGeneratedFiles.length > 0
      ? state.currentTaskGeneratedFiles
      : state.generatedFiles
          .filter((f) => f.role === state.role)
          .map((f) => f.path);

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

  // P0-B: task file-plan completeness. If the task promised to create file
  // `A.ts` or modify `B.ts` and neither shows up in the generated-files list
  // (and the `modifies` hash is unchanged), this run is incomplete. Surface
  // a structured error so `routeAfterVerify` can route back to `task_fix`.
  const planResult = await verifyTaskFilePlan(
    task,
    state.currentTaskGeneratedFiles,
    state.currentTaskModifiesSnapshot ?? {},
    state.outputDir,
  );
  if (!planResult.passed) {
    const msg = formatUnfulfilledMessage(planResult);
    console.log(
      `[Worker:${state.workerLabel}] Verify FAILED (file plan) for "${task.title}": ${msg}`,
    );
    getRepairEmitter(state.sessionId)({
      stage: "worker-verify",
      event: "task_plan_unfulfilled",
      taskId: task.id,
      files: [...planResult.missingCreates, ...planResult.unmodified],
      details: {
        missingCreates: planResult.missingCreates,
        unmodified: planResult.unmodified,
        fixAttempts: state.fixAttempts,
      },
    });
    return {
      verifyErrors: msg,
      fixAttempts: state.fixAttempts,
    };
  }

  const tsFiles = taskFiles.filter((f) => /\.(ts|tsx)$/.test(f));
  if (tsFiles.length === 0) {
    console.log(
      `[Worker:${state.workerLabel}] No TypeScript files in task — skip compile check for "${task.title}"`,
    );
    return { verifyErrors: "", fixAttempts: state.fixAttempts };
  }

  console.log(
    `[Worker:${state.workerLabel}] Task output OK for "${task.title}" (${tsFiles.length} TS file(s)) — per-task tsc disabled; project-wide tsc runs in supervisor verify.`,
  );

  return { verifyErrors: "", fixAttempts: state.fixAttempts };
}

function isWorkerFixEligibleError(verifyErrors: string): boolean {
  if (!verifyErrors) return false;
  if (isWorkerTscVerifyError(verifyErrors)) return true;
  if (TASK_FILE_PLAN_UNFULFILLED_REGEX.test(verifyErrors)) return true;
  return false;
}

function routeAfterVerify(state: WorkerState): string {
  if (!state.verifyErrors) return "task_done";
  // P0-C: file-plan failures (TASK_FILE_PLAN_UNFULFILLED) are now fixable
  // alongside TypeScript errors. Other verify errors still fall through to
  // `task_done` with warnings (unchanged legacy behaviour).
  if (!isWorkerFixEligibleError(state.verifyErrors)) return "task_done";
  const cfg = getWorkerTscFixConfig();
  const maxFix = state.ralphConfig.enabled
    ? Math.min(
        state.ralphConfig.maxIterationsPerTask,
        cfg.maxFixAttemptsRalphCap,
      )
    : cfg.maxFixAttempts;
  if (state.fixAttempts >= maxFix) {
    console.log(
      `[Worker:${state.workerLabel}] Per-task fix: max attempts (${maxFix}) reached, continuing with warnings.`,
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
  const cfg = getWorkerTscFixConfig();
  const isFilePlanFix = TASK_FILE_PLAN_UNFULFILLED_REGEX.test(
    state.verifyErrors,
  );
  const fixKind = isFilePlanFix ? "file-plan" : "tsc";
  console.log(
    `[Worker:${state.workerLabel}] Per-task ${fixKind} fix attempt ${attempt} for "${task.title}"...`,
  );
  console.log(
    `[Worker:${state.workerLabel}] codeFix env: WORKER_TSC_FIX_MAX_ATTEMPTS=${cfg.maxFixAttempts}, WORKER_TSC_FIX_MAX_ATTEMPTS_RALPH_CAP=${cfg.maxFixAttemptsRalphCap}, WORKER_TSC_ERROR_CONTEXT_MAX_CHARS=${cfg.errorContextMaxChars}`,
  );

  if (!isFilePlanFix) {
    logCodeFixErrorDetail(
      state.workerLabel,
      task.id,
      task.title,
      state.verifyErrors,
    );
  } else {
    console.log(
      `[Worker:${state.workerLabel}] codeFix: task=${task.id} — file-plan unfulfilled, asking LLM to produce the missing artefacts.`,
    );
  }

  const filePlanDetails = isFilePlanFix
    ? parseTaskFilePlanFailureDetails(state.verifyErrors)
    : { missingCreates: [], unmodified: [] };
  const planBuckets = getTaskFilePlanBuckets(task.files);
  const taskFiles = isFilePlanFix
    ? [
        ...new Set([
          ...state.currentTaskGeneratedFiles,
          ...filePlanDetails.unmodified,
          ...planBuckets.modifies,
          ...planBuckets.reads,
        ]),
      ]
    : state.currentTaskGeneratedFiles;
  // For file-plan fixes, we explicitly handle the case of "no generated files
  // yet" — the fix is literally to produce them. Only short-circuit when we
  // have neither files nor a task plan to satisfy.
  if (taskFiles.length === 0 && !isFilePlanFix) {
    console.warn(
      `[Worker:${state.workerLabel}] codeFix: skip LLM — no currentTaskGeneratedFiles for task ${task.id}.`,
    );
    return { fixAttempts: attempt, verifyErrors: state.verifyErrors };
  }

  console.log(
    `[Worker:${state.workerLabel}] codeFix: task files in scope (${taskFiles.length}): ${taskFiles.slice(0, 12).join(", ")}${taskFiles.length > 12 ? " …" : ""}`,
  );
  if (isFilePlanFix) {
    console.log(
      `[Worker:${state.workerLabel}] codeFix: missing creates (${filePlanDetails.missingCreates.length}): ${filePlanDetails.missingCreates.slice(0, 12).join(", ")}${filePlanDetails.missingCreates.length > 12 ? " …" : ""}`,
    );
  }

  const alreadyRead = new Set<string>();
  const fileContents: string[] = [];

  for (const filePath of taskFiles.slice(0, 8)) {
    alreadyRead.add(filePath);
    const content = await fsRead(filePath, state.outputDir);
    if (
      !content.startsWith("FILE_NOT_FOUND") &&
      !content.startsWith("REJECTED")
    ) {
      fileContents.push(
        `### ${filePath}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``,
      );
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
    if (
      !content.startsWith("FILE_NOT_FOUND") &&
      !content.startsWith("REJECTED")
    ) {
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
    if (
      !content.startsWith("FILE_NOT_FOUND") &&
      !content.startsWith("REJECTED")
    ) {
      fileContents.push(`### ${cf}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``);
    }
  }

  const versionConstraints = await buildVersionConstraints(state.outputDir);

  const overrideModelChainRaw = process.env.CODEFIX_MODEL_CHAIN?.trim() ?? "";
  const overrideModelChain = overrideModelChainRaw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const codeFixChain =
    overrideModelChain.length > 0
      ? resolveModelChain(overrideModelChain, resolveModel)
      : resolveModelChain(MODEL_CONFIG.codeFix ?? "gpt-4o", resolveModel);
  if (overrideModelChain.length > 0) {
    console.log(
      `[Worker:${state.workerLabel}] codeFix: using CODEFIX_MODEL_CHAIN override (${overrideModelChainRaw})`,
    );
  }
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

  const filePlanInstruction = isFilePlanFix
    ? [
        "You are completing an incomplete coding task. The previous attempt did NOT",
        "produce every file the task promised. Your job is to EMIT THE MISSING FILES",
        "and/or MODIFY the files that should have been edited, so the task plan is",
        "fully satisfied.",
        "",
        "Output ONLY the required file(s) using ```file:path/to/file``` blocks.",
        "For a `missingCreates` entry, write the full new file from scratch.",
        "For an `unmodified` entry, read its current contents from the context below",
        "and emit the full updated file (never diffs).",
        "Do NOT drop functionality that already exists in other files.",
        "Do NOT add explanations outside the file blocks.",
      ].join("\n")
    : [
        "You are a TypeScript fix specialist. Fix the errors shown below.",
        "Output ONLY the corrected file(s) using ```file:path/to/file``` blocks.",
        "Do NOT remove existing functionality. Only fix the errors.",
        "Do NOT add explanations or markdown outside the file blocks.",
        "Files marked '(referenced in errors — read-only context)' are for reference only; do NOT rewrite them.",
      ].join("\n");

  const userHeader = isFilePlanFix
    ? `## Task file plan not yet fulfilled (attempt ${attempt})`
    : `## Errors (attempt ${attempt})`;

  const filePlanBlock = isFilePlanFix
    ? [
        "### Task metadata",
        `- id: ${task.id}`,
        `- title: ${task.title}`,
        task.description ? `- description: ${task.description}` : "",
        filePlanDetails.missingCreates.length > 0
          ? `- missingCreates:\n${filePlanDetails.missingCreates.map((file) => `  - ${file}`).join("\n")}`
          : "",
        filePlanDetails.unmodified.length > 0
          ? `- unmodified:\n${filePlanDetails.unmodified.map((file) => `  - ${file}`).join("\n")}`
          : "",
        formatTaskFileHints(task.files),
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: filePlanInstruction,
    },
    {
      role: "user",
      content: [
        userHeader,
        "```",
        state.verifyErrors.slice(0, cfg.errorContextMaxChars),
        "```",
        "",
        filePlanBlock,
        "",
        versionConstraints
          ? `## Installed package versions (use these APIs)\n${versionConstraints}\n`
          : "",
        "## Current file contents",
        ...fileContents,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  try {
    const response = await chatCompletionWithFallback(messages, codeFixChain, {
      temperature: 0.2,
      max_tokens: MAX_OUTPUT_TOKENS,
    });

    const content = response.choices[0]?.message?.content ?? "";
    const costUsd = estimateCost(response.model, response.usage);
    const usage = getResponseUsageCounts(response);
    recordCodingSessionLlmUsage({
      sessionId: state.sessionId,
      stage: "worker_codefix",
      label: state.workerLabel,
      model: response.model,
      costUsd,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });

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
  console.log(
    `[Worker:${state.workerLabel}] Task done: "${task.title}" (${state.currentTaskIndex + 1}/${state.tasks.length})`,
  );
  const filesForTask = state.currentTaskGeneratedFiles;

  // Discard the rollback snapshot — task was accepted, its changes are the
  // new source of truth.
  await discardTaskSnapshot(task, state.outputDir);
  getRepairEmitter(state.sessionId)({
    stage: "task",
    event: "snapshot_cleaned",
    taskId: task.id,
  });

  // ── RALPH Phase 4: context rotation — write session-context.md when threshold hit ──
  if (state.ralphConfig.enabled && state.contextRotationNeeded) {
    const tracker = new ProgressTracker(state.outputDir);
    const completedTasks = state.taskResults;
    const recentFiles = state.generatedFiles
      .slice(-20)
      .map((f) => `- ${f.path} (${f.role}): ${f.summary}`)
      .join("\n");
    const contextSummary = [
      `# Session Context (auto-generated for context rotation)`,
      `> Worker: ${state.workerLabel} | Role: ${state.role}`,
      `> Rotation triggered at ~${state.estimatedContextTokens.toLocaleString()} context tokens`,
      ``,
      `## Tasks completed so far (${completedTasks.length})`,
      completedTasks
        .map(
          (r) =>
            `- ${r.taskId}: ${r.status} (${r.generatedFiles.length} files)`,
        )
        .join("\n"),
      ``,
      `## Recently generated files (last 20)`,
      recentFiles,
    ].join("\n");
    try {
      await tracker.writeSessionContext(contextSummary);
      console.log(
        `[Worker:${state.workerLabel}] RALPH: context rotation triggered — session-context.md written.`,
      );
    } catch (e) {
      console.warn(
        `[Worker:${state.workerLabel}] RALPH: failed to write session context: ${e}`,
      );
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
          await shellExec(`git add ${filePaths}`, state.outputDir, {
            timeout: 15_000,
          });
        }
        const msg = `feat(agent): complete ${task.id}: ${task.title.slice(0, 72)}`;
        const commitOut = await shellExec(
          `git commit -m "${msg.replace(/"/g, "'")}" --allow-empty`,
          state.outputDir,
          { timeout: 20_000 },
        );
        const commitOutText = (
          commitOut.stdout ||
          commitOut.stderr ||
          ""
        ).trim();
        const hashMatch = /\[[\w/]+ ([a-f0-9]{7,})\]/.exec(commitOutText);
        commitHash = hashMatch?.[1];
        if (commitHash) {
          console.log(
            `[Worker:${state.workerLabel}] RALPH: committed ${task.id} → ${commitHash}`,
          );
        }
      }
      await tracker.markComplete(task.id, filesForTask, commitHash);
      await tracker.addCost(state.currentTaskCostUsd);
    } catch (e) {
      // Progress tracking / git errors must never abort the pipeline
      console.warn(
        `[Worker:${state.workerLabel}] RALPH progress write failed: ${e}`,
      );
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
    currentTaskTokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
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

  // Roll everything the task touched back to its pre-task state. This
  // guarantees a partial failure never leaves broken half-files behind to
  // break later tasks or downstream verify passes.
  try {
    const rollback = await restoreTask(task, state.outputDir);
    getRepairEmitter(state.sessionId)({
      stage: "task",
      event: "snapshot_restored",
      taskId: task.id,
      files: [
        ...rollback.restored,
        ...rollback.deleted.map((f) => `deleted:${f}`),
      ],
      details: {
        restored: rollback.restored.length,
        deleted: rollback.deleted.length,
        skipped: rollback.skipped.length,
      },
    });
  } catch (err) {
    console.warn(
      `[Worker:${state.workerLabel}] Task snapshot restore failed:`,
      err instanceof Error ? err.message : err,
    );
  }

  // ── RALPH Phase 3: persist failure in progress files ───────────────────────
  if (state.ralphConfig.enabled) {
    const tracker = new ProgressTracker(state.outputDir);
    try {
      await tracker.markFailed(task.id, failureMsg);
      await tracker.recordError(
        task.id,
        state.currentTaskRetryCount,
        failureMsg,
      );
    } catch (e) {
      console.warn(
        `[Worker:${state.workerLabel}] RALPH progress write failed: ${e}`,
      );
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
    currentTaskTokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
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
    if (
      !content.startsWith("FILE_NOT_FOUND") &&
      !content.startsWith("REJECTED")
    ) {
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
