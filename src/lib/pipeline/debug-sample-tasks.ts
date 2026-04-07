import type { KickoffWorkItem } from "./types";

/**
 * Minimal task list for local debugging of the LangGraph coding pipeline
 * without running kick-off or git setup. Phases align with supervisor role inference.
 */
export const DEBUG_SAMPLE_KICKOFF_TASKS: KickoffWorkItem[] = [
  {
    id: "debug-arch-1",
    phase: "Scaffolding",
    title: "Monorepo scaffold and shared config",
    description:
      "Create apps/ and packages/ layout, root package.json with workspaces, shared tsconfig base, and a README describing the repo structure.",
    estimatedHours: 2,
    executionKind: "ai_autonomous",
    priority: "P0",
    files: ["package.json", "tsconfig.json"],
  },
  {
    id: "debug-be-1",
    phase: "Backend Services",
    title: "Health API route",
    description:
      "Add a minimal HTTP GET /api/health handler that returns JSON { ok: true, service: string } suitable for the chosen backend stack in the output tree.",
    estimatedHours: 1,
    executionKind: "ai_autonomous",
    priority: "P0",
  },
  {
    id: "debug-fe-1",
    phase: "Frontend",
    title: "Landing page shell",
    description:
      "Add a minimal Next.js (or framework already in repo) page that shows the app name and links to /api/health if applicable.",
    estimatedHours: 1.5,
    executionKind: "ai_autonomous",
    priority: "P1",
  },
  {
    id: "debug-test-1",
    phase: "Testing",
    title: "Smoke test for health endpoint",
    description:
      "Add one Vitest (or existing test runner) test that asserts the health response shape or a trivial pass if no server in test env.",
    estimatedHours: 1,
    executionKind: "ai_autonomous",
    priority: "P2",
  },
];
