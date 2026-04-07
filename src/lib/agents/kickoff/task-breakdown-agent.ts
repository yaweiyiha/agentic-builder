import { BaseAgent } from "../shared/base-agent";
import type { ProjectTier } from "../shared/project-classifier";
import { MODEL_CONFIG } from "@/lib/model-config";

const TIER_TASK_LIMITS: Record<ProjectTier, { min: number; max: number; guidance: string }> = {
  S: {
    min: 3,
    max: 6,
    guidance:
      "This is a SIMPLE project. Keep the task list minimal — only the essential scaffolding, core feature, and a basic smoke test. Merge related work into fewer, broader tasks. Do NOT over-engineer.",
  },
  M: {
    min: 5,
    max: 10,
    guidance:
      "This is a MEDIUM project. STRICTLY limit to 5-10 tasks. Aggressively merge related work — e.g. combine all backend CRUD endpoints into ONE task, all frontend pages into ONE task, all config/setup into ONE task. Do NOT create separate tasks for individual API endpoints, individual pages, or individual models. Think in broad strokes: scaffolding, data layer, backend API, frontend app, testing.",
  },
  L: {
    min: 15,
    max: 30,
    guidance:
      "This is a LARGE project. Create thorough tasks across all phases — scaffolding, data layer, auth, backend services, frontend, integration, testing, and infrastructure.",
  },
};

function buildSystemPrompt(tier: ProjectTier): string {
  const limits = TIER_TASK_LIMITS[tier];
  return `You are a senior Engineering Lead that produces detailed coding task breakdowns.

## Your Role
Analyze the provided documents to produce a list of **coding tasks**. Each task is a concrete
unit of work that can be assigned to a developer or AI coding agent.
Each task MUST include detailed implementation sub-steps and token usage estimates.

## CRITICAL: Determine Project Type FIRST
Before generating tasks, analyze the PRD to determine the project type:

1. **Frontend-only** — The PRD says "no backend", "no API", "no database", "no server", "single-page app",
   "client-side only", "localStorage", etc. OR the project clearly has no server-side requirements
   (e.g. a timer app, calculator, static dashboard, game).
   → Use **React + Vite + TypeScript + Tailwind CSS**. NEVER use Next.js.
   → Allowed phases: "Scaffolding", "Frontend", "Testing" ONLY.
   → Do NOT generate "Data Layer", "Backend Services", "Auth & Gateway", "Infrastructure", or "Integration" tasks.
   → Do NOT use Prisma, API routes, Docker, Kubernetes, or any server-side technology.

2. **Full-stack with SSR/API** — The PRD explicitly requires server-side rendering, API routes, or Next.js features.
   → Use **Next.js + TypeScript + Tailwind CSS**.
   → All phases are allowed.

3. **Full-stack with separate backend** — The PRD requires a separate backend (Express, Fastify, NestJS, etc.).
   → Use appropriate tech stack.
   → All phases are allowed.

## Project Scale
${limits.guidance}

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
  "files": ["package.json", "vite.config.ts", "tsconfig.json", "index.html", "src/main.tsx"],
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
  "Integration", "Testing", "Infrastructure" (string).
  For frontend-only projects, use ONLY "Scaffolding", "Frontend", "Testing".
- **title**: short imperative sentence (< 80 chars)
- **description**: 1-3 sentences explaining what to build, which files to touch, and
  any relevant FR-xxx / US-xx references from the PRD.
- **estimatedHours**: integer, realistic hours for a senior full-stack engineer.
- **executionKind**: "ai_autonomous" (AI can fully handle) or "human_confirm_after"
  (needs human review/approval after completion).
- **files**: array of key file paths or patterns this task touches.
- **dependencies**: array of task IDs that must be done first (e.g. ["T-001"]).
- **priority**: "P0" (must have), "P1" (should have), "P2" (nice to have).
- **subSteps**: array of 2-6 concrete implementation steps. Each step has:
  - "step": sequential number (1, 2, 3...)
  - "action": short imperative phrase (< 60 chars) describing WHAT to do
  - "detail": 1-2 sentences explaining HOW to do it, including specific APIs, patterns, or code structure
- **tokenEstimate**: estimated LLM token usage for an AI agent to complete this task:
  - "inputTokens": tokens needed for context (project docs + task description + existing code), typically 1500-4000
  - "outputTokens": tokens the AI will generate (code output), estimate based on file count and complexity: config files ~500, components ~1500, services ~2000, complex pages ~3000
  - "totalTokens": inputTokens + outputTokens
  - "estimatedCostUsd": totalTokens / 1000000 * 0 (Gemini is free) — set to 0 for now
- **acceptanceCriteria**: 2-4 concrete, testable conditions that verify the task is done correctly.
- **coversRequirementIds**: string array of PRD IDs this task fully or materially implements.
  Include **every** relevant **AC-***, **FR-*** (and **F-** if used in PRD) ID that this task addresses.
  Across all tasks, these IDs should cover as much of the PRD’s AC/FR list as possible (pipeline validates coverage).

## Critical: Scaffolding task MUST include build tooling
The FIRST task (T-001, phase "Scaffolding") MUST set up a COMPLETE, runnable project skeleton.
This means it MUST explicitly include:

### For frontend-only projects (DEFAULT — use this unless Next.js is explicitly required):
- **Build tool**: Vite with @vitejs/plugin-react. NEVER use create-react-app, react-scripts, or Next.js.
- **package.json**: Must have "type": "module", scripts: { "dev": "vite", "build": "vite build", "preview": "vite preview" }
- **vite.config.ts**: with react plugin configured
- **index.html**: Root HTML file in project root with <div id="root"> and <script type="module" src="/src/main.tsx">
- **src/main.tsx**: React entry point with ReactDOM.createRoot
- **tsconfig.json**: with jsx: "react-jsx", module: "ESNext", moduleResolution: "bundler"
- **Tailwind CSS**: tailwind.config.ts, postcss.config.js, CSS file with @tailwind directives

### For Next.js projects (ONLY when SSR or API routes are needed):
- **Build tool**: Next.js
- **package.json**: scripts: { "dev": "next dev", "build": "next build", "start": "next start" }
- **next.config.mjs** or **next.config.ts**
- **src/app/layout.tsx** and **src/app/page.tsx** (App Router)
- **Tailwind CSS**: setup with postcss

The scaffolding task's acceptanceCriteria MUST include: "npm install && npm run build succeeds without errors" and "npm run dev starts the dev server".

## Rules
- Generate EXACTLY **${limits.min}–${limits.max} tasks**. NEVER exceed ${limits.max}. If you generate more than ${limits.max} tasks, your output will be REJECTED.
- Merge related work aggressively: combine multiple API endpoints, multiple pages, or multiple models into broader tasks.
- Order tasks by execution sequence (respecting dependencies).
- Focus on CODING tasks — skip pure planning, meeting, or documentation-only items.
- Reference PRD feature IDs (FR-xxx) and user stories (US-xx) where applicable.
- Tasks that involve security, payment, or auth MUST be "human_confirm_after".
- Every task MUST have subSteps (2-6 steps), tokenEstimate, acceptanceCriteria, and coversRequirementIds (non-empty when PRD lists AC/FR ids).
- Output ONLY the JSON array. No other text.`;
}

export class TaskBreakdownAgent extends BaseAgent {
  private tier: ProjectTier;

  constructor(tier: ProjectTier = "L") {
    super({
      name: "Task Breakdown Agent",
      role: "Engineering Lead",
      systemPrompt: buildSystemPrompt(tier),
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
      `Analyze all provided documents and generate a coding task breakdown as a JSON array. ${focusHint}\n\n` +
      sections[0];

    return this.run(
      userMessage,
      context.length > 0 ? context : undefined,
      "step-task-breakdown",
      sessionId,
    );
  }
}
