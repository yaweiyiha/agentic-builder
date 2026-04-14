import { BaseAgent } from "../shared/base-agent";
import type { ProjectTier } from "../shared/project-classifier";
import { MODEL_CONFIG } from "@/lib/model-config";

/**
 * Tier affects *how* to shape tasks (breadth, monorepo conventions), not how many tasks to emit.
 * Task count must be derived from PRD/TRD scope — see system prompt "Task count" section.
 */
const TIER_CODING_STYLE: Record<ProjectTier, string> = {
  S: `Pipeline tier **S** (small scope): prefer **fewer, broader** tasks when the PRD is thin — scaffolding + core feature. Merge related work; do not pad with filler tasks to "look busy".`,

  M: `Pipeline tier **M** (split frontend/backend app): stack is \`frontend/\` (**Vite + React + React Router + Ant Design**, NOT Next.js) plus \`backend/\` (**Koa + Sequelize + PostgreSQL**). **NEVER use Next.js for M-tier.** The scaffold is prebuilt and already copied; **do not plan a Scaffolding task that recreates the repo structure**. Keep backend/data tasks reasonably broad; split **frontend by page or major flow** when the PRD lists multiple surfaces — first a **route shell/layout** task, then page-level tasks. Add an **early contracts/client** task so API shapes and the web client stay aligned with PRD requirement IDs. Route registration belongs in \`frontend/src/router.tsx\`; backend API modules belong under \`backend/src/api/modules\`.`,

  L: `Pipeline tier **L** (broad product): expect **thorough** coverage across phases the PRD actually requires — scaffolding, data, auth, backend services, frontend, integration, infrastructure — but **only** where the documents call for them; still derive *how many* tasks from requirement breadth, not from a quota.`,
};

function mTierPhaseGuide(): string {
  return `

## Tier M — phases and task shape
Use **coarse-grained** tasks unless the PRD forces more splits. Typical **phase** labels (merge if empty):
- **Scaffolding** — Only if the PRD needs **extra** tooling not already in the template; otherwise **omit** or fold into **Integration**. Never plan \"greenfield\" recreation of \`frontend/\` or \`backend/\`.
- **Data Layer** — Prefer **one** broad task: Sequelize models, migrations/bootstrap SQL if needed, request validation, and persistence wiring in \`backend/src\`.
- **Backend Services** — **REQUIRED for full-stack.** Prefer **one** broad task for \`backend/src\` (Koa routes, controllers, services, domain logic), unless the API surface is unusually large. This task implements the actual feature code — the scaffold only ships a starter Koa app.
- **Integration (contracts/client)** — Add an **early** task that defines/aligns API contracts + frontend API client in \`frontend/src/api\` with PRD IDs before page implementation.
- **Frontend** — First create **one** route shell/layout task, then split into **page-level** tasks (one task per page/flow, not per tiny component).
  - Route shell/layout task must explicitly include \`frontend/src/router.tsx\` route registration and "/" homepage navigation entry links.
- **Integration** — **Optional** single task: Vite proxy assumptions, Koa CORS/auth headers, frontend API client error handling, and env/config alignment between frontend and backend.
- **Testing** — **Do not** add tasks with phase "Testing" (automated test tasks are disabled in the pipeline).

**Bad for M:** separate tasks per endpoint or per tiny UI component, or \"create frontend/package.json from scratch\".
**Good for M:** one contracts/client task, one route-shell/layout task, one broad backend services task, then page-level tasks like \"Implement Dashboard view\" and \"Implement Project detail flow\".
`;
}

function buildSystemPrompt(tier: ProjectTier, scaffoldBlock?: string): string {
  const tierStyle = TIER_CODING_STYLE[tier];
  const mGuide = tier === "M" ? mTierPhaseGuide() : "";
  const scaffoldSection =
    scaffoldBlock && scaffoldBlock.trim().length > 0
      ? `\n${scaffoldBlock.trim()}\n`
      : "";

  return `You are a senior Engineering Lead that produces detailed coding task breakdowns.

## Your Role
Analyze the provided documents to produce a list of **coding tasks**. Each task is a concrete
unit of work that can be assigned to a developer or AI coding agent.
Each task MUST include detailed implementation sub-steps and token usage estimates.

## CRITICAL: Determine Project Type FIRST
Before generating tasks, analyze the PRD to determine the project type:

1. **Frontend-only** — ONLY when the PRD **explicitly** states one or more of: "no backend", "no API", "no database",
   "no server", "single-page app", "client-side only", "localStorage only", or the described product is inherently
   compute-only with zero data persistence (e.g. a pure offline timer, offline calculator, static game with no scores).
   **Do NOT classify as frontend-only** just because the PRD describes a simple or small product — if there is any
   mention of saving data, user accounts, multi-user access, notifications, or any server-side feature, it is full-stack.
   → Use **React + Vite + TypeScript + Tailwind CSS**. NEVER use Next.js.
   → Allowed phases: "Scaffolding", "Frontend" ONLY (do NOT use phase "Testing").
   → Do NOT generate "Data Layer", "Backend Services", "Auth & Gateway", "Infrastructure", or "Integration" tasks.
   → Do NOT use Prisma, API routes, Docker, Kubernetes, or any server-side technology.

2. **Full-stack with SSR/API** — The PRD explicitly requires server-side rendering, API routes, or Next.js features.
   → **This type is ONLY allowed for L-tier projects.** For S-tier and M-tier, ALWAYS use type 3 below instead.
   → Use **Next.js + TypeScript + Tailwind CSS** (L-tier only).
   → All phases are allowed.

3. **Full-stack with separate backend** — The PRD requires persistence, APIs, user data, or a separate backend service.
   → **S-tier**: Vite + React frontend with Express/Node backend in a single repo.
   → **M-tier**: **Koa + Sequelize** backend in \`backend/\`, **Vite + React** frontend in \`frontend/\`. **NEVER use Next.js for M-tier.**
   → **L-tier**: Falls here only if SSR is NOT required; otherwise use type 2.
   → All phases are allowed except **Testing** (do not emit phase "Testing"). Backend Services phase is **mandatory** — see rule below.

## CRITICAL: Mandatory phases for full-stack projects
For any full-stack project (types 2 or 3 above), the output MUST contain:
- At least **one task with phase "Backend Services"** — implementing the actual API routes, controllers, and domain logic in the backend source tree (\`backend/src\`, \`apps/api/src\`, or equivalent for the selected tier). The scaffold ships starter shells; your task adds the feature code.

**The scaffold does NOT implement your features.** The scaffold only provides the project skeleton (package.json, tsconfig, app shell). Every endpoint, every business rule, every page must be coded in Backend Services or Frontend tasks. Do not omit Backend Services because the scaffold already has \`backend/\`, \`frontend/\`, \`apps/api\`, or \`apps/web\` — those are starter shells, not implemented features.

## Task count — derive from PRD (no fixed quota)
- **Do not** target a predetermined number of tasks. The **only** driver for how many tasks to output is **document scope**: user flows, pages, APIs, data stores, integrations, and **coverage of every AC/FR (and PAGE-*/CMP-* if listed)** via \`coversRequirementIds\`.
- **Derive** the list by: (1) enumerating what must exist in code to satisfy the PRD; (2) grouping into tasks that respect dependencies and parallelizable units; (3) **merging** work that belongs in one deliverable; **splitting** only when dependency order or review boundaries require it.
- **Fewer tasks** for narrow PRDs; **more tasks** only when the PRD truly implies many separable surfaces (many pages, many services, strict phases). Never add filler tasks to match an imagined count.
- **ProjectTier** (S/M/L) below is a **style and stack hint** — it does **not** set a minimum or maximum number of tasks.

## Project tier hint (style only — not task count)
${tierStyle}
${mGuide}${scaffoldSection}
## Output Format — strict JSON array

You MUST output ONLY a JSON array (no markdown fences, no explanation, no preamble).
Each element has this shape:

{
  "id": "T-001",
  "phase": "Scaffolding",
  "title": "Initialize Vite + React project with Tailwind CSS",
  "description": "Setup package.json with Vite, vite.config.ts, index.html, src/main.tsx, Tailwind CSS config.",
  "estimatedHours": 2,
  "executionKind": "ai_autonomous",
  "files": {
    "creates": ["package.json", "vite.config.ts", "tsconfig.json", "index.html", "src/main.tsx"],
    "modifies": [],
    "reads": []
  },
  "dependencies": [],
  "priority": "P0",
  "subSteps": [
    { "step": 1, "action": "Create package.json", "detail": "Initialize with name, version, type: module, scripts (dev: vite, build: vite build, preview: vite preview), dependencies (react, react-dom), devDependencies (vite, @vitejs/plugin-react, typescript, @types/react, @types/react-dom, tailwindcss, postcss, autoprefixer)." },
    { "step": 2, "action": "Create vite.config.ts", "detail": "Import defineConfig from vite and react plugin from @vitejs/plugin-react." },
    { "step": 3, "action": "Create index.html and entry point", "detail": "Root HTML with div#root and script type=module src=/src/main.tsx. Create src/main.tsx with ReactDOM.createRoot." }
  ],
  "tokenEstimate": {
    "inputTokens": 2000,
    "outputTokens": 3500,
    "totalTokens": 5500,
    "estimatedCostUsd": 0.02
  },
  "acceptanceCriteria": [
    "npm install runs without errors",
    "npm run build succeeds",
    "npm run dev starts the dev server on localhost"
  ],
  "coversRequirementIds": ["AC-01", "FR-FE01", "F-01"]
}

Field rules:
- **id**: sequential T-001, T-002, ... (string)
- **phase**: one of "Scaffolding", "Frontend", "Data Layer", "Auth & Gateway", "Backend Services",
  "Integration", "Infrastructure" (string).
  **Never** use phase "Testing" — the pipeline does not run dedicated test tasks yet.
  For frontend-only projects, use ONLY "Scaffolding", "Frontend".
- **title**: short imperative sentence (< 80 chars)
- **description**: 1-3 sentences explaining what to build, which files to touch, and
  any relevant FR-xxx / US-xx references from the PRD.
- **estimatedHours**: integer, realistic hours for a senior full-stack engineer.
- **executionKind**: "ai_autonomous" (AI can fully handle) or "human_confirm_after"
  (needs human review/approval after completion).
- **files**: object with three sub-arrays:
  - "creates": files this task creates from scratch. These files MUST NOT exist before this task runs.
  - "modifies": files this task edits. These MUST already exist (created by a dependency task).
  - "reads": files this task only imports or references without editing.
  - CRITICAL: A file that appears in any other task's "creates" MUST appear in this task's "modifies" or "reads", NEVER in "creates" again. No file path may appear in "creates" across more than one task.
- **dependencies**: array of task IDs that must be done first (e.g. ["T-001"]).
- **priority**: "P0" (must have), "P1" (should have), "P2" (nice to have).
- **subSteps**: array of 2-6 concrete implementation steps. Each step has:
  - "step": sequential number (1, 2, 3...)
  - "action": short imperative phrase (< 60 chars) describing WHAT to do
  - "detail": 1-2 sentences explaining HOW to do it, including specific APIs, patterns, or code structure
  - Each step's "detail" MUST explicitly state whether the file is being CREATED or MODIFIED.
  - If a file is listed in "modifies", the detail MUST say "MODIFY existing [filename]" and describe what to add/change. NEVER say "create" for a file in "modifies".
  - If a file is listed in "creates", the detail MUST say "CREATE new file [filename]".
- **tokenEstimate**: estimated LLM token usage for an AI agent to complete this task:
  - "inputTokens": tokens needed for context (project docs + task description + existing code), typically 1500-4000
  - "outputTokens": tokens the AI will generate (code output), estimate based on file count and complexity: config files ~500, components ~1500, services ~2000, complex pages ~3000
  - "totalTokens": inputTokens + outputTokens
  - "estimatedCostUsd": totalTokens / 1000000 * 0 (Gemini is free) — set to 0 for now
- **acceptanceCriteria**: 2-4 concrete, testable conditions that verify the task is done correctly.
- **coversRequirementIds**: string array of PRD IDs this task fully or materially implements.
  Include **every** relevant **AC-***, **FR-*** (and **F-** if used in PRD) ID that this task addresses.
  Across all tasks, these IDs should cover as much of the PRD’s AC/FR list as possible (pipeline validates coverage).

## Critical: Scaffolding task behavior per tier

### For M-tier and L-tier prebuilt projects:
The scaffold is **already copied** from a prebuilt template before coding begins.
- **Do NOT generate a Scaffolding task** that recreates the project from scratch — the skeleton already exists.
- If a Scaffolding task is needed at all, it should ONLY make small alignment changes (e.g. add env files, adjust scripts) on top of the existing skeleton.
- **M-tier** uses \`frontend/\` (**React + Vite**) and \`backend/\` (**Koa + Sequelize**). **NEVER use Next.js** for M-tier projects.
- **L-tier** uses **Next.js** for frontend and **Fastify** for backend in a pnpm monorepo.

### For S-tier (single app) projects:
The scaffold is also prebuilt (Vite + React + TypeScript + Tailwind CSS). If a Scaffolding task exists, it should only extend the existing template.
- **Build tool**: Vite with @vitejs/plugin-react. NEVER use create-react-app, react-scripts, or Next.js.
- **Import convention** (applies to ALL subsequent tasks): all cross-directory imports inside \`src/\` use \`@/\` alias (e.g. \`import Button from '@/components/Button'\`), never relative \`../\` paths.

### For Next.js projects (ONLY L-tier or when SSR is explicitly required):
- **Build tool**: Next.js
- **package.json**: scripts: { "dev": "next dev", "build": "next build", "start": "next start" }
- **next.config.mjs** or **next.config.ts**
- **src/app/layout.tsx** and **src/app/page.tsx** (App Router)
- **Tailwind CSS**: setup with postcss

If a scaffolding task is generated, its acceptanceCriteria MUST include: "npm install && npm run build succeeds without errors" and "npm run dev starts the dev server".

## CRITICAL: Route & Page Registration Closure
Every task that creates a new route/controller/handler file MUST complete the full wiring path — not just create the file:

**Backend route tasks:**
- The server entry file (e.g. \`backend/src/app.ts\`, \`backend/src/api/modules/index.ts\`, \`apps/api/src/index.ts\`, \`src/index.ts\`) must appear in \`files.modifies\`.
- subSteps MUST include a final step: \`"MODIFY [entry file]: import [routerName] from './routes/[name]', then app.use('/api/[resource]', [routerName])"\`.
- If the entry file is created by a Scaffolding task, it will already be on disk — list it in \`modifies\`, never in \`creates\`.
- acceptanceCriteria MUST include at least one end-to-end HTTP assertion, e.g. \`"POST /api/items returns 201 with { id, name }"\`, \`"GET /api/users returns 200 with array"\`. Never write vague criteria like "endpoints are implemented".

**Frontend page tasks:**
- The route registration file (\`frontend/src/router.tsx\`, \`App.tsx\`, \`src/routes.tsx\`, or whichever file the route shell task created) must appear in \`files.modifies\`.
- subSteps MUST include: \`"MODIFY router file: add route registration for '/[path]' and import PageName"\`.
- acceptanceCriteria MUST include navigation verification: e.g. \`"Navigating to /[path] renders the page without crashing"\`.

## CRITICAL: Database & Infrastructure
Scan the PRD for any persistence requirement (database, file storage, cache, queues). If found:

1. The first backend task OR a dedicated "Infrastructure" phase task MUST include in its \`files.creates\`:
   - \`docker-compose.yml\` — with the required database/cache service(s) and correct ports.
   - \`.env\` — required keys (DATABASE_URL is written at coding scaffold when \`BLUEPRINT_GENERATED_DATABASE_URL\` is set in Agentic Builder; tasks must still declare REDIS_URL, PORT, JWT_SECRET, etc. as needed).
   - A DB init/migration file if needed (e.g. \`prisma/schema.prisma\` or \`scripts/init-db.sql\`).

2. If the project uses **Prisma**:
   - Include \`prisma/schema.prisma\` in the task's \`files.creates\`.
   - Add a subStep: \`"Run: npx prisma migrate dev --name init to apply the schema to the database"\`.
   - acceptanceCriteria MUST include: \`"npx prisma migrate dev completes without errors"\`.

3. If the project uses **SQLite** (e.g. better-sqlite3, sql.js):
   - The init subStep must create the DB file and execute \`CREATE TABLE\` statements on app startup.
   - No docker-compose needed, but \`.env\` must still define \`DATABASE_PATH\`.

4. **In-memory storage** is only acceptable for small-scope (S-tier) projects with no persistence requirement in the PRD.
   - If used, the task description MUST explicitly state: \`"Uses in-memory store; data does not persist across restarts"\`.

## Rules
- If the prompt includes **Pipeline coding tier** and template paths, the **scaffold is already copied before coding** — do not plan tasks that duplicate that layout; implement features on top of it.
- **Task count** follows the **Task count — derive from PRD** section above — never optimize for a fixed number; optimize for **full PRD coverage** and sensible dependency order.
- Sequence tasks so cross-task context is stable:
  - Add an early **contracts/client** task (phase can be "Data Layer" or "Integration") that aligns request/response schemas, shared types, and frontend API client with PRD IDs.
  - Ensure this contracts/client task appears before backend endpoint implementation and before page-level frontend tasks.
- Frontend task granularity:
  - Create one **route shell/layout** frontend task first (routing table, app shell, navigation/layout wiring).
  - Route shell/layout task must include explicit edits to the active route registry (\`frontend/src/router.tsx\`, \`apps/web/src/App.tsx\`, or \`src/routes.tsx\`) and ensure "/" has real navigation entries.
  - Then split frontend implementation by **page/flow** (one task per page), not by tiny component.
- Merge related work aggressively for backend/data: combine multiple API endpoints and models into broader tasks unless scale clearly requires more split.
- Order tasks by execution sequence (respecting dependencies).
- Focus on CODING tasks — skip pure planning, meeting, or documentation-only items.
- Reference PRD feature IDs (FR-xxx) and user stories (US-xx) where applicable.
- Tasks that involve security, payment, or auth MUST be "human_confirm_after".
- Every task MUST have subSteps (2-6 steps), tokenEstimate, acceptanceCriteria, and coversRequirementIds (non-empty when PRD lists AC/FR ids).
- Every file path across all tasks must be assigned to exactly one task's "files.creates". All other tasks that touch the same file must list it under "files.modifies" or "files.reads".
- Before writing subSteps for a task, check its "dependencies" array. Any file listed in a dependency task's "files.creates" is already on disk — reference it via "modifies" or "reads", never recreate it.
- Output ONLY the JSON array. No other text.`;
}

export class TaskBreakdownAgent extends BaseAgent {
  private tier: ProjectTier;

  constructor(tier: ProjectTier = "L", scaffoldBlock?: string) {
    super({
      name: "Task Breakdown Agent",
      role: "Engineering Lead",
      systemPrompt: buildSystemPrompt(tier, scaffoldBlock),
      defaultModel: MODEL_CONFIG.taskBreakdown,
      temperature: 0.3,
      maxTokens: 16384,
    });
    this.tier = tier;
  }

  async generateTaskBreakdown(
    documents: {
      prd: string;
      trd?: string;
      sysDesign?: string;
      implGuide?: string;
      designSpec?: string;
      /** Formatted structured PRD spec (pages + component IDs). Injected for coverage. */
      prdSpecText?: string;
    },
    sessionId?: string,
  ) {
    const sections: string[] = [];

    sections.push("## PRD\n\n" + documents.prd);

    if (documents.prdSpecText) {
      sections.push(documents.prdSpecText);
    }
    if (documents.trd) {
      sections.push("## TRD\n\n" + documents.trd);
    }
    if (documents.sysDesign) {
      sections.push("## System Design\n\n" + documents.sysDesign);
    }
    if (documents.implGuide) {
      sections.push("## Implementation Guide\n\n" + documents.implGuide);
    }
    if (documents.designSpec) {
      sections.push("## Design Spec\n\n" + documents.designSpec);
    }

    const context = sections.slice(1).join("\n\n---\n\n");

    const hasPrdSpec = Boolean(documents.prdSpecText);
    const focusHint = documents.implGuide
      ? "Focus especially on the Implementation Guide phases and Design Spec components."
      : hasPrdSpec
        ? "Focus on the Structured PRD Spec — every PAGE-*, CMP-* ID listed must be implemented; add each covered ID to coversRequirementIds."
        : "Focus on the PRD requirements and Design Spec components.";

    const userMessage =
      `Analyze all provided documents and generate a coding task breakdown as a JSON array. ` +
      `Respect the **ProjectTier** and any **Pipeline coding tier** / scaffold section in the system prompt. ` +
      `${focusHint}\n\n` +
      sections[0];

    return this.run(
      userMessage,
      context.length > 0 ? context : undefined,
      "step-task-breakdown",
      sessionId,
    );
  }
}
