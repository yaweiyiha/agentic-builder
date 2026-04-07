import path from "path";
import { StateGraph, START, END } from "@langchain/langgraph";
import {
  WorkerStateAnnotation,
  type WorkerState,
  type GeneratedFile,
  type TaskResult,
} from "./state";
import { fsWrite, fsRead, shellExec, listFiles } from "./tools";
import { estimateCost, type ChatMessage } from "@/lib/openrouter";
import { invokeCodegenOrOpenRouter } from "@/lib/codegen-openai-compatible";
import type { CodingAgentRole, CodingTask } from "@/lib/pipeline/types";

const MAX_FIX_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 16384;

const ROLE_PROMPTS: Record<CodingAgentRole, string> = {
  architect: `You are a Senior Software Architect Agent.
Generate project scaffolding, configuration files, shared types, and foundational infrastructure code.
Your output forms the base that frontend, backend, and test agents build upon.

## Critical: Determine project type from context
Read the project context and task description carefully to determine whether this is:
- **Frontend-only**: No backend, no API, no database, single-page app, uses localStorage, etc.
  → Use React + Vite + TypeScript + Tailwind CSS. NEVER use Next.js for frontend-only projects.
- **Full-stack with SSR**: Needs server-side rendering, API routes, etc.
  → Use Next.js.

## Critical: Scaffolding MUST be runnable
The project MUST pass "npm install && npm run build && npm run dev" without errors.

### For React + Vite (DEFAULT for frontend-only projects):
1. **package.json** — Must include:
   - "type": "module"
   - scripts: { "dev": "vite", "build": "vite build", "preview": "vite preview" }
   - dependencies: react, react-dom (use latest versions like "^18.3.1" or "^19.0.0")
   - devDependencies: vite, @vitejs/plugin-react, typescript, @types/react, @types/react-dom
   - NO comments in JSON (comments make npm install fail)
2. **vite.config.ts** — Must import @vitejs/plugin-react and configure plugins
3. **tsconfig.json** — Must set jsx: "react-jsx", module: "ESNext", moduleResolution: "bundler", target: "ES2020"
4. **tsconfig.node.json** — For vite.config.ts
5. **index.html** — Root HTML in project root with <div id="root"> and <script type="module" src="/src/main.tsx">
6. **src/main.tsx** — React entry point with ReactDOM.createRoot
7. **src/App.tsx** — Root app component
8. **src/vite-env.d.ts** — Vite client type reference: /// <reference types="vite/client" />

### For Next.js (ONLY when SSR or API routes are required):
1. **package.json** with next, react, react-dom and scripts (dev/build/start). NO comments in JSON.
2. **next.config.mjs** or **next.config.ts**
3. **tsconfig.json** with Next.js-compatible settings
4. **src/app/layout.tsx** and **src/app/page.tsx** (App Router)

### Rules:
- NEVER use create-react-app or react-scripts — they are deprecated.
- NEVER put comments (// ...) in package.json — it causes npm install to fail.
- Default to Vite unless the project specifically requires Next.js (SSR, API routes, etc.)
- Always include Tailwind CSS setup: tailwindcss, postcss, autoprefixer, tailwind.config.ts, postcss.config.js, and the @tailwind directives in a CSS file.
- All file paths must be relative (no leading slash).

### Interactive shell (frontend / Vite apps)
- App.tsx, routes, and layout must not ship dead controls: primary navigation and actions use React Router (Link, useNavigate) or real onClick with state updates — no empty handlers.

For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.`,

  frontend: `You are a Senior Frontend Engineer Agent.
Generate production-quality React frontend code: components, pages, hooks, stores, and styles.
Tech: React 18, TypeScript, Tailwind CSS, Zustand for state, TanStack Query for data fetching.

### CRITICAL: Interactive UI must work
- No dead buttons: every \`<button>\` MUST have an \`onClick\` handler or \`type="submit"\` inside a \`<form onSubmit>\`.
- Links: use React Router \`<Link to="...">\` or \`useNavigate()\` — NEVER use empty \`href="#"\` or \`href=""\`.
- Inputs, toggles, sliders, selects: controlled with \`useState\` + \`onChange\`/\`value\`.
- Timers, counters, intervals: implement real \`useEffect\` + \`setInterval\` logic as described in the PRD.
- Forms: implement real \`onSubmit\` with validation and state updates; NEVER leave forms without submit handling.
- Modals/drawers: implement open/close state management; connect trigger buttons to state.
- Every interactive component from the PRD spec (CMP-*) MUST be implemented with its specified interaction and effect.

### CRITICAL: Pencil Design Tokens adherence
If the project context includes **Design Tokens**, you MUST faithfully reproduce the design:

1. **Screen → Route mapping**: each Screen section = a separate route or view. Create a React component for each.
2. **Component tree**: the indented hierarchy under each Screen maps directly to your JSX nesting. Each named element (bold text in tokens) = a React element or component.
3. **Colors (EXACT)**: use Tailwind arbitrary values for every color from the tokens: \`bg-[#1E293B]\`, \`text-[#F1F5F9]\`. Never approximate or substitute.
4. **Sizing (EXACT)**: widths, heights, gaps, padding from tokens → Tailwind arbitrary values: \`w-[720px]\`, \`h-[64px]\`, \`gap-[24px]\`, \`p-[32px]\`, \`px-[24px]\`.
5. **Typography (EXACT)**: font size and weight from tokens → \`text-[20px] font-bold\` etc.
6. **Layout**: \`layout: horizontal\` → \`flex flex-row\`, \`layout: vertical\` → \`flex flex-col\`. Apply \`items-center\`, \`justify-between\` etc. per tokens.
7. **Corner radius**: \`rounded-[16px]\`, \`rounded-[12px]\` etc.
8. **Icons**: use Lucide React icons matching the icon names in tokens.
9. **fill_container** → \`w-full\` / \`h-full\`; **fit_content** → \`w-fit\` / \`h-fit\`.

If token data is missing for a specific value, use the closest design-standard value from the Extracted Tokens section.

### Rules:
- Import paths must match the project structure created by the architect (e.g. ./components/Foo, ../hooks/useBar).
- All components must be TypeScript (.tsx). All utilities must be TypeScript (.ts).
- Use functional components with hooks exclusively. No class components.
- All file paths must be relative (no leading slash).

For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.`,

  backend: `You are a Senior Backend Engineer Agent.
Generate production-quality backend code: API endpoints, services, DB queries, business logic.
Responsibilities: route handlers, service layer, ORM models, auth middleware, validation, event handlers.
For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.`,

  test: `You are a Senior QA / Test Engineer Agent.
Generate comprehensive test suites: unit, integration, e2e.
Frameworks: Vitest, @testing-library/react, Playwright, k6.
For each file output: \`\`\`file:<relative-path>\n<contents>\n\`\`\`
Output ONLY code blocks with the file: prefix. No explanatory text outside code blocks.`,
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
    sinceVersion: "5.0.0",
    notes:
      "v5+: `findUnique` throws if not found when using `findUniqueOrThrow`. " +
      "`rejectOnNotFound` option removed.",
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

async function buildVersionConstraints(outputDir: string): Promise<string> {
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

// ─── Node functions ───

function pickNextTask(state: WorkerState) {
  const idx = state.currentTaskIndex;
  const total = state.tasks.length;
  if (idx < total) {
    console.log(`[Worker:${state.workerLabel}] Picking task ${idx + 1}/${total}: ${state.tasks[idx].title}`);
  } else {
    console.log(`[Worker:${state.workerLabel}] All ${total} tasks done.`);
  }
  return {
    verifyErrors: "",
    fixAttempts: 0,
  };
}

function shouldContinueOrEnd(state: WorkerState): string {
  if (state.currentTaskIndex >= state.tasks.length) return "__end__";
  return "generate_code";
}

async function generateCode(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];

  console.log(`[Worker:${state.workerLabel}] Generating code for: "${task.title}" ...`);

  const contextParts: string[] = [];
  if (state.projectContext) {
    contextParts.push(state.projectContext);
  }
  if (state.fileRegistrySnapshot.length > 0) {
    const listing = state.fileRegistrySnapshot
      .slice(0, 30)
      .map((f) => `- ${f.path} (${f.role}): ${f.summary}`)
      .join("\n");
    contextParts.push(`## Already generated files\n${listing}`);
  }
  if (state.apiContractsSnapshot.length > 0) {
    const apis = state.apiContractsSnapshot
      .map((a) => `- ${a.method} ${a.endpoint} (${a.service})`)
      .join("\n");
    contextParts.push(`## Available API endpoints\n${apis}`);
  }

  const versionConstraints = await buildVersionConstraints(state.outputDir);
  if (versionConstraints) {
    contextParts.push(versionConstraints);
  }

  const fileHint =
    task.files && task.files.length > 0
      ? `\nKey files to create/modify:\n${task.files.map((f) => `- ${f}`).join("\n")}`
      : "";

  const messages: ChatMessage[] = [
    { role: "system", content: ROLE_PROMPTS[state.role] },
  ];
  if (contextParts.length > 0) {
    messages.push({
      role: "system",
      content: `## Project Context\n${contextParts.join("\n\n")}`,
    });
  }
  messages.push({
    role: "user",
    content: `## Task: ${task.title}\n\n${task.description}${fileHint}\n\nGenerate the complete code for this task.\n\nACCEPTANCE CRITERIA:\n1. Every button has a real onClick handler that updates state or triggers navigation.\n2. Every form has onSubmit with validation logic.\n3. Every input/toggle/select is controlled with useState + onChange.\n4. Links navigate to real routes (React Router Link or useNavigate).\n5. Timer/counter/animation logic uses real useEffect + setInterval/setTimeout.\n6. If Design Tokens are in context, match every color, size, gap, padding, radius, and font exactly using Tailwind arbitrary values.`,
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
  const parsedFiles = parseFileOutput(content);

  const writtenFiles: string[] = [];
  const newFileEntries: GeneratedFile[] = [];
  for (const [fp, fc] of Object.entries(parsedFiles)) {
    await fsWrite(fp, fc, state.outputDir);
    writtenFiles.push(fp);
    newFileEntries.push({
      path: fp,
      role: state.role,
      summary: `Generated for task: ${task.title}`,
    });
  }

  console.log(`[Worker:${state.workerLabel}] Generated ${writtenFiles.length} files in ${(durationMs / 1000).toFixed(1)}s (cost: $${costUsd.toFixed(4)})`);

  return {
    generatedFiles: newFileEntries,
    workerCostUsd: costUsd,
    verifyErrors: "",
    fixAttempts: 0,
  };
}

// ─── Verify helpers: error classification + auto dep install ───

interface TscErrorClassification {
  missingDeps: string[];
  crossRefErrors: string[];
  realErrors: string[];
  hasMissingDeps: boolean;
  hasCrossRefOnly: boolean;
  hasRealErrors: boolean;
}

function classifyTscErrors(output: string): TscErrorClassification {
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

function isPathAlias(specifier: string): boolean {
  return (
    specifier.startsWith("@/") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("#/")
  );
}

function extractMissingPackages(tscOutput: string): string[] {
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
  return [...pkgs];
}

async function installMissingDeps(
  tscOutput: string,
  outputDir: string,
): Promise<void> {
  const pkgs = extractMissingPackages(tscOutput);

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
          await fsWrite("vitest.config.ts", updated, outputDir);
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
  await shellExec(
    `npm install --save ${unique.join(" ")} 2>&1 | tail -5`,
    outputDir,
    { timeout: 60_000 },
  );
}

async function findBestTsconfigForFiles(
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

// ─── Verify node ───

async function verifyCode(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];

  const taskFiles = state.generatedFiles
    .filter((f) => f.role === state.role)
    .map((f) => f.path)
    .filter((p) => /\.(ts|tsx)$/.test(p));

  if (taskFiles.length === 0) {
    console.log(
      `[Worker:${state.workerLabel}] Verify: no TS files to check for "${task.title}"`,
    );
    return { verifyErrors: "", fixAttempts: state.fixAttempts };
  }

  console.log(
    `[Worker:${state.workerLabel}] Verify: running tsc on ${taskFiles.length} file(s) for "${task.title}"...`,
  );

  const tscProject = await findBestTsconfigForFiles(taskFiles, state.outputDir);
  const tscCmd = tscProject
    ? `npx tsc --noEmit --pretty false --skipLibCheck --project ${tscProject} 2>&1`
    : `npx tsc --noEmit --pretty false --skipLibCheck 2>&1`;

  if (tscProject) {
    console.log(
      `[Worker:${state.workerLabel}] Verify: using --project ${tscProject}`,
    );
  }

  const runTsc = async (): Promise<{ output: string; exitCode: number }> => {
    const result = await shellExec(tscCmd, state.outputDir, {
      timeout: 30_000,
    });
    return {
      output: (result.stderr || result.stdout || "").trim(),
      exitCode: result.exitCode,
    };
  };

  const filterForTask = (raw: string): string =>
    raw
      .split("\n")
      .filter(
        (line) =>
          line.includes("error TS") &&
          taskFiles.some((f) => line.includes(f)),
      )
      .slice(0, 50)
      .join("\n");

  let { output, exitCode } = await runTsc();

  if (exitCode === 0 || !output.includes("error TS")) {
    console.log(
      `[Worker:${state.workerLabel}] Verify PASSED for "${task.title}"`,
    );
    return { verifyErrors: "", fixAttempts: state.fixAttempts };
  }

  const relevantOutput = filterForTask(output);
  if (!relevantOutput) {
    console.log(
      `[Worker:${state.workerLabel}] Verify: errors exist but none in task files, PASSED for "${task.title}"`,
    );
    return { verifyErrors: "", fixAttempts: state.fixAttempts };
  }

  const classification = classifyTscErrors(relevantOutput);

  // Type A: missing deps → install first, re-run tsc, no fixAttempts consumed
  if (classification.hasMissingDeps) {
    console.log(
      `[Worker:${state.workerLabel}] Verify: missing deps detected, installing before fix cycle...`,
    );
    await installMissingDeps(relevantOutput, state.outputDir);
    const retry = await runTsc();

    if (retry.exitCode === 0 || !retry.output.includes("error TS")) {
      console.log(
        `[Worker:${state.workerLabel}] Verify PASSED after dep install for "${task.title}"`,
      );
      return { verifyErrors: "", fixAttempts: state.fixAttempts };
    }

    const retryRelevant = filterForTask(retry.output);
    if (!retryRelevant) {
      console.log(
        `[Worker:${state.workerLabel}] Verify PASSED after dep install for "${task.title}"`,
      );
      return { verifyErrors: "", fixAttempts: state.fixAttempts };
    }

    const afterInstall = classifyTscErrors(retryRelevant);
    if (!afterInstall.hasRealErrors) {
      console.log(
        `[Worker:${state.workerLabel}] Verify: only cross-ref errors remain after dep install, skipping for "${task.title}"`,
      );
      return { verifyErrors: "", fixAttempts: state.fixAttempts };
    }
    output = afterInstall.realErrors.join("\n").slice(0, 2000);
  }
  // Type B: cross-ref only → skip, other files not generated yet
  else if (classification.hasCrossRefOnly) {
    console.log(
      `[Worker:${state.workerLabel}] Verify: cross-ref errors only (other files not generated yet), skipping for "${task.title}"`,
    );
    return { verifyErrors: "", fixAttempts: state.fixAttempts };
  }
  // Type C: real code errors → enter fix loop
  else {
    output = classification.realErrors.join("\n").slice(0, 2000);
  }

  const errorPreview = output.slice(0, 200).replace(/\n/g, " | ");
  console.log(
    `[Worker:${state.workerLabel}] Verify FAILED (attempt ${state.fixAttempts + 1}/${MAX_FIX_ATTEMPTS}): ${errorPreview}`,
  );
  return {
    verifyErrors: output,
    fixAttempts: state.fixAttempts,
  };
}

function shouldFixOrProceed(state: WorkerState): string {
  if (!state.verifyErrors) return "task_done";
  if (state.fixAttempts >= MAX_FIX_ATTEMPTS) return "task_done";
  return "fix_errors";
}

async function fixErrors(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];

  const errFiles = extractErrorFiles(state.verifyErrors);
  const taskFiles = state.generatedFiles
    .filter((f) => f.role === state.role)
    .map((f) => f.path);

  const fileContents: string[] = [];
  const addedPaths = new Set<string>();

  for (const ef of errFiles.slice(0, 5)) {
    const content = await fsRead(ef, state.outputDir);
    if (!content.startsWith("FILE_NOT_FOUND")) {
      fileContents.push(`### ${ef}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
      addedPaths.add(ef);
    }
  }

  const configFiles = await inferRelatedConfigFiles(
    state.verifyErrors,
    state.outputDir,
    taskFiles,
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

  const isConfigError = hasConfigErrors(state.verifyErrors);
  const configHint = isConfigError
    ? "**IMPORTANT**: These errors are likely caused by tsconfig.json misconfiguration " +
      '(e.g. missing `"jsx": "react-jsx"` or wrong `compilerOptions`). ' +
      "If the fix requires changing tsconfig.json or other config files, " +
      "output the corrected config file(s) as well.\n"
    : "";

  const versionConstraints = await buildVersionConstraints(state.outputDir);

  const messages: ChatMessage[] = [
    { role: "system", content: ROLE_PROMPTS[state.role] },
    {
      role: "user",
      content: [
        `## Fix TypeScript Errors for task: ${task.title}`,
        "",
        "### Errors",
        "```",
        state.verifyErrors,
        "```",
        "",
        configHint,
        versionConstraints
          ? `### Installed package versions (use these APIs, not older ones)\n${versionConstraints}`
          : "",
        fileContents.length > 0
          ? `### Current file contents\n${fileContents.join("\n\n")}`
          : "",
        "",
        "Output ONLY the corrected files using ```file:<path> format.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const startMs = Date.now();
  const response = await invokeCodegenOrOpenRouter(messages, {
    temperature: 0.2,
    max_tokens: MAX_OUTPUT_TOKENS,
    openRouterVariant: "codeFix",
  });

  const content = response.choices[0]?.message?.content ?? "";
  const costUsd = estimateCost(response.model, response.usage);
  const fixes = parseFileOutput(content);

  const updatedFiles: GeneratedFile[] = [];
  for (const [fp, fc] of Object.entries(fixes)) {
    await fsWrite(fp, fc, state.outputDir);
    updatedFiles.push({
      path: fp,
      role: state.role,
      summary: `Fix attempt ${state.fixAttempts} for: ${task.title}`,
    });
  }

  return {
    generatedFiles: updatedFiles,
    workerCostUsd: costUsd,
    verifyErrors: "",
    fixAttempts: state.fixAttempts + 1,
  };
}

function taskDone(state: WorkerState) {
  const task = state.tasks[state.currentTaskIndex];
  console.log(`[Worker:${state.workerLabel}] Task done: "${task.title}" (${state.currentTaskIndex + 1}/${state.tasks.length})`);
  const filesForTask = state.generatedFiles
    .filter((f) => f.summary.includes(task.title) || f.summary.includes(task.id))
    .map((f) => f.path);

  const result: TaskResult = {
    taskId: task.id,
    status: state.verifyErrors
      ? "completed_with_warnings"
      : "completed",
    generatedFiles: filesForTask,
    costUsd: state.workerCostUsd,
    durationMs: 0,
    verifyPassed: !state.verifyErrors,
    fixCycles: state.fixAttempts,
    warnings: state.verifyErrors
      ? [state.verifyErrors.slice(0, 500)]
      : undefined,
  };

  return {
    taskResults: [result],
    currentTaskIndex: state.currentTaskIndex + 1,
    verifyErrors: "",
    fixAttempts: 0,
  };
}

function extractErrorFiles(stderr: string): string[] {
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

async function inferRelatedConfigFiles(
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

function hasConfigErrors(errors: string): boolean {
  return /TS17004|TS1484|TS5023|TS5024|TS6046|--jsx/.test(errors);
}

// ─── Build the subgraph ───

export function createWorkerSubGraph() {
  const graph = new StateGraph(WorkerStateAnnotation)
    .addNode("pick_next_task", pickNextTask)
    .addNode("generate_code", generateCode)
    .addNode("verify", verifyCode)
    .addNode("fix_errors", fixErrors)
    .addNode("task_done", taskDone)

    .addEdge(START, "pick_next_task")
    .addConditionalEdges("pick_next_task", shouldContinueOrEnd, {
      generate_code: "generate_code",
      __end__: END,
    })
    .addEdge("generate_code", "verify")
    .addConditionalEdges("verify", shouldFixOrProceed, {
      task_done: "task_done",
      fix_errors: "fix_errors",
    })
    .addEdge("fix_errors", "verify")
    .addEdge("task_done", "pick_next_task");

  return graph.compile();
}
