import fs from "fs/promises";
import path from "path";
import type { ScaffoldTier } from "./scaffold-copy";

const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);

/** Injected into tier L SCAFFOLD_SPEC.md and task-breakdown scaffold block. */
const MONOREPO_SHARED_IMPORTS_AND_ZOD = [
  "## Imports and Zod (monorepo)",
  "",
  "- Import shared types and schemas using the **workspace package name** from `packages/shared/package.json` (default **`@project/shared`**), e.g. `@project/shared/types/auth`, `@project/shared/schemas/auth`.",
  "- **Never** use `@shared/`, bare `shared/`, or other aliases unless this repo already defines them in `tsconfig.json` / `vite.config.ts`.",
  "- **Zod**: export runtime validators as **camelCase** + `Schema` (`loginSchema`, `registerSchema`). Export inferred value types as **`LoginInput`**, **`RegisterInput`** (PascalCase + `Input`).",
  "- Do **not** use a type name that only differs from the schema by capitalization (avoid `registerSchema` + exported type `RegisterSchema`).",
  '- In UI code: call `registerSchema.safeParse(...)` or `.parse(...)`; use `import type { RegisterInput } from "@project/shared/schemas/auth"` for form state.',
  "",
].join("\n");

function shouldOmitFromPathSummary(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  if (LOCKFILE_NAMES.has(base)) return true;
  if (rel.endsWith(".DS_Store") || rel.endsWith(".swp")) return true;
  return false;
}

/**
 * Cap and normalize template paths for LLM prompts (task breakdown, etc.).
 */
export function summarizeTemplatePathsForPrompt(
  paths: string[],
  maxLines = 50,
): string {
  const filtered = paths
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !shouldOmitFromPathSummary(p))
    .sort();
  const lines = filtered.slice(0, maxLines);
  const more =
    filtered.length > maxLines
      ? `\n... and ${filtered.length - maxLines} more path(s)`
      : "";
  return (lines.length ? lines.join("\n") : "(no paths)") + more;
}

function tierScaffoldBrief(tier: ScaffoldTier): string {
  switch (tier) {
    case "S":
      return [
        "- Single **Vite + React + TypeScript** app at repository root.",
        "- Entry: `index.html`, `src/main.tsx`, `src/App.tsx`; Tailwind + PostCSS at root.",
        "- Use **Vitest** under `src/test/` when adding tests.",
        "- Do **not** introduce Next.js unless the PRD explicitly requires SSR or Next.js API routes.",
      ].join("\n");
    case "M":
      return [
        "- Root layout: `frontend/`, `backend/`, `PRD.md`, `README.md`.",
        "- **`frontend/`**: Vite + React + TypeScript + React Router + Tailwind CSS + Ant Design.",
        "- **`backend/`**: Koa + TypeScript + Sequelize + PostgreSQL.",
        "- Frontend API requests use `/api`; Vite dev server proxies `/api` to `http://localhost:4000`.",
        "- Backend entrypoints: `src/app.ts` assembles Koa middleware/routes, `src/server.ts` starts the service, `src/api/modules/*` contains business modules.",
        "- Run apps separately: `cd frontend && pnpm dev`, `cd backend && pnpm dev`.",
      ].join("\n");
    case "L":
      return [
        "- **pnpm workspace**: root `package.json` + `pnpm-workspace.yaml`.",
        "- **`apps/web`**: **Next.js** App Router (`app/`, `layout.tsx`, `page.tsx`), Tailwind.",
        "- **`apps/api`**: **Fastify** HTTP API (`src/index.ts` and routes).",
        "- **`packages/shared`**: shared types and utilities consumed via `workspace:*`.",
        "- Shared imports: `@project/shared/types/...`, `@project/shared/schemas/...` only (never `@shared/`). Zod: `fooSchema` + type `FooInput`.",
        "- Run from root: `pnpm dev` (parallel dev), `pnpm build`, `pnpm test`.",
      ].join("\n");
    default:
      return "";
  }
}

/**
 * Short block for task-breakdown system/user context (prebuilt scaffold awareness).
 */
export function buildTaskBreakdownScaffoldBlock(
  tier: ScaffoldTier,
  templateRelativePaths: string[],
): string {
  const pathBlock = summarizeTemplatePathsForPrompt(templateRelativePaths, 50);
  const prebuiltNote =
    tier === "S"
      ? 'The template already ships a runnable Vite app. **Do not** plan a greenfield "create Vite from zero" task unless the PRD requires replacing the stack. Plan Frontend tasks to implement the actual product features (do not add phase "Testing" tasks — automated tests are not scheduled in the pipeline yet).'
      : tier === "M"
        ? 'The template already ships a runnable **frontend/backend split skeleton** (`frontend/`, `backend/`, base configs, health route, router shell). **Do not** recreate that structure. You **MUST** still plan Backend Services tasks (to implement real API routes/logic in `backend/src`) and Frontend tasks (to implement real pages/flows in `frontend/src`) — the scaffold ships shells, not product features. Do not add phase "Testing" tasks until the pipeline runs test workers.'
        : 'The template already ships the monorepo **skeleton** (`pnpm-workspace.yaml`, empty `apps/web`, empty `apps/api`). **Do not** recreate that skeleton structure. You **MUST** still plan Backend Services tasks (to implement API routes/logic in `apps/api/src`) — the scaffold ships empty shells, not implemented features. Do not add phase "Testing" tasks until the pipeline runs test workers.';

  return [
    `## Pipeline coding tier: **${tier}**`,
    "",
    "Before coding agents run, the pipeline **copies the tier scaffold** into the output directory.",
    prebuiltNote,
    "Plan **product features** on top of the paths below.",
    "",
    "### Layout (abbrev.)",
    tierScaffoldBrief(tier),
    ...(tier === "L" ? ["", MONOREPO_SHARED_IMPORTS_AND_ZOD] : []),
    "",
    "### Representative template paths (lockfiles omitted)",
    "```text",
    pathBlock,
    "```",
    "",
  ].join("\n");
}

/**
 * Full markdown written to the generated repo as `SCAFFOLD_SPEC.md` and injected into coding context.
 * Kept in English for agent/human consumption in the output project.
 */
export function getTierScaffoldSpecMarkdown(tier: ScaffoldTier): string {
  const brief = tierScaffoldBrief(tier);
  switch (tier) {
    case "S":
      return [
        "# Scaffold specification (tier S)",
        "",
        "This project was bootstrapped from the **S-tier** scaffold (single Vite + React app).",
        "",
        "## Layout",
        brief,
        "",
        "## Where to implement",
        "- UI and routes: `src/` (components, pages, hooks, stores).",
        "- Styles: Tailwind + `src/index.css` (`@tailwind` directives).",
        "- Tests: colocate `*.test.ts(x)` or under `src/test/`.",
        "",
        "## Commands",
        "- `pnpm install` — install dependencies.",
        "- `pnpm dev` — Vite dev server.",
        "- `pnpm build` — production build.",
        "- `pnpm test` — Vitest.",
        "",
        "## Do not",
        "- Add Next.js or a second frontend app unless the PRD explicitly requires it.",
        "",
      ].join("\n");
    case "M":
      return [
        "# Scaffold specification (tier M)",
        "",
        "This project was bootstrapped from the **M-tier** scaffold: separate `frontend` + `backend` applications with a shared product-level root.",
        "",
        "## Layout",
        brief,
        "",
        "## Where to implement",
        "- **Backend**: `backend/src` for Koa app assembly, API modules, models, DB config, middleware, and services.",
        "- **Backend routing policy**: register API resources under `backend/src/api/modules`, then wire them through `backend/src/api/modules/index.ts` and `backend/src/app.ts`.",
        "- **Frontend**: `frontend/src` for routes, page-level views, reusable components, API client helpers, and state.",
        "- **Frontend page policy**: prefer page-level screens under `frontend/src/views`; keep route registration in `frontend/src/router.tsx` and mount it from `frontend/src/main.tsx` / `frontend/src/App.tsx` as appropriate.",
        "- **Navigation policy**: `/` must expose visible navigation entry links/buttons to the main product flows.",
        "",
        "## Commands",
        "- `cd frontend && pnpm install && pnpm dev`",
        "- `cd frontend && pnpm build`",
        "- `cd backend && pnpm install && pnpm dev`",
        "- `cd backend && pnpm build`",
        "",
        "## Protected / prebuilt files",
        "- Config and app shells from the scaffold should be **extended**, not replaced wholesale.",
        "- After coding starts, see also `ARCHITECTURE_SCAFFOLD.md` for the concrete file list registered for this run.",
        "",
      ].join("\n");
    case "L":
      return [
        "# Scaffold specification (tier L)",
        "",
        "This project was bootstrapped from the **L-tier** scaffold: **pnpm monorepo** with **Next.js** web + **Fastify** API + shared package.",
        "",
        "## Layout",
        brief,
        "",
        "## Where to implement",
        "- **Shared contracts**: `packages/shared/src`.",
        "- **Backend**: `apps/api/src` (Fastify plugins, routes, services).",
        "- **Frontend**: `apps/web/app` (App Router), components colocated or under `components/`, shared UI utilities as needed.",
        "",
        "## Commands (from repository root)",
        "- `pnpm install`",
        "- `pnpm dev` — parallel dev for web and api.",
        "- `pnpm build` — recursive build.",
        "- `pnpm test` — recursive tests.",
        "",
        "## Workspace",
        "- Package names: `@project/web`, `@project/api`, `@project/shared` (match `package.json`).",
        "",
        MONOREPO_SHARED_IMPORTS_AND_ZOD,
        "## Protected / prebuilt files",
        "- Prefer extending Next.js and Fastify app structure rather than regenerating from scratch.",
        "- See `ARCHITECTURE_SCAFFOLD.md` for the file registry for this run.",
        "",
      ].join("\n");
    default:
      return "# Scaffold specification\n\nUnknown tier.\n";
  }
}

const SCAFFOLD_SPEC_MAX_CONTEXT_CHARS = 6000;

/** Truncated spec for appending to supervisor `projectContext`. */
export function getTierScaffoldSpecForCodingContext(
  tier: ScaffoldTier,
): string {
  const full = getTierScaffoldSpecMarkdown(tier);
  if (full.length <= SCAFFOLD_SPEC_MAX_CONTEXT_CHARS) return full;
  return `${full.slice(0, SCAFFOLD_SPEC_MAX_CONTEXT_CHARS)}\n\n[SCAFFOLD_SPEC truncated for context length]\n`;
}

/**
 * Writes `SCAFFOLD_SPEC.md` into the output directory (always overwrites).
 * Call after `copyScaffold` so the doc is present for humans and agents.
 */
export async function writeScaffoldSpecFile(
  outputDir: string,
  tier: ScaffoldTier,
): Promise<void> {
  const md = getTierScaffoldSpecMarkdown(tier);
  await fs.writeFile(path.join(outputDir, "SCAFFOLD_SPEC.md"), md, "utf-8");
}
