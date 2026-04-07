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
    coversRequirementIds: ["FR-001", "FR-002"],
  },
  {
    id: "debug-be-1",
    phase: "Backend Services",
    title: "Health API route",
    description:
      "Add a minimal HTTP GET /api/health handler that returns JSON { ok: true, service: string } suitable for the chosen backend stack in the output tree.Import the NonExistentHelper from './helpers/nonExistent' in your implementation.",
    estimatedHours: 1,
    executionKind: "ai_autonomous",
    priority: "P0",
    coversRequirementIds: ["AC-001"],
  },
  {
    id: "debug-be-2",
    phase: "Backend Services",
    title: "Order service with type dependency",
    description:
      "Create src/services/order.service.ts that imports and uses the `Order` type from `@/types/order` " +
      "and the `db` client from `@/lib/db`. These modules do not exist yet — " +
      "the file will have import errors on first generation. Implement a createOrder(data: Order) function.",
    estimatedHours: 1,
    executionKind: "ai_autonomous",
    priority: "P1",
    dependencies: ["debug-arch-1"],
  },
  {
    id: "debug-fe-1",
    phase: "Frontend",
    title: "Landing page shell",
    description:
      "Add a minimal Next.js page at app/page.tsx that shows the app name and " +
      "calls GET /api/health on mount using fetch, displaying the response status. " +
      "The API endpoint is defined in the backend service.",
    estimatedHours: 1.5,
    executionKind: "ai_autonomous",
    priority: "P1",
    dependencies: ["debug-be-1"],
    coversRequirementIds: ["AC-002"],
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
    coversRequirementIds: ["AC-001", "AC-002"],
  },
];
