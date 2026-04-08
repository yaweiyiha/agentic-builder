import type { KickoffWorkItem } from "./types";

/**
 * Full kickoff-style task list for a critical illness (重疾) insurance product.
 * Separate from DEBUG_SAMPLE_KICKOFF_TASKS — use "Debug Coding: Critical Illness" in the pipeline UI.
 * Phases align with supervisor role inference (Scaffolding → architect, etc.).
 */
export const DEBUG_CRITICAL_ILLNESS_KICKOFF_TASKS: KickoffWorkItem[] = [
  // ── Scaffolding (1) ──
  {
    id: "ci-T001",
    phase: "Scaffolding",
    title: "Initialize Next.js project with TypeScript, Tailwind CSS, and Prisma",
    description:
      "Scaffold a Next.js 14 App Router project with TypeScript, Tailwind CSS, ESLint, and Prisma. " +
      "Include root package.json scripts (dev, build, start, lint), prisma/schema.prisma placeholder, and README with project overview for a critical illness insurance member portal.",
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    priority: "P0",
    files: ["package.json", "tsconfig.json", "prisma/schema.prisma"],
    coversRequirementIds: ["FR-001", "FR-002"],
  },
  // ── Data Layer (1) ──
  {
    id: "ci-T002",
    phase: "Data Layer",
    title: "Define Prisma schema for policy, claim, and member profiles",
    description:
      "Model core entities: User (member), Policy (critical illness coverage), Claim (submission workflow), " +
      "DiagnosisRecord (optional ICD hints), and Beneficiary. Include relations, enums for claim status, and indexes on memberId and policyNumber.",
    estimatedHours: 3,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T001"],
    coversRequirementIds: ["FR-010", "FR-011"],
  },
  // ── Auth & Gateway (4) ──
  {
    id: "ci-T003",
    phase: "Auth & Gateway",
    title: "Implement user registration API route",
    description:
      "POST /api/auth/register: validate email/password, hash password (bcrypt or similar), create User via Prisma, return safe JSON (no password hash).",
    estimatedHours: 5,
    executionKind: "human_confirm_after",
    priority: "P0",
    dependencies: ["ci-T002"],
    files: ["src/app/api/auth/register/route.ts"],
    coversRequirementIds: ["FR-020"],
  },
  {
    id: "ci-T004",
    phase: "Auth & Gateway",
    title: "Implement user login API route and session or JWT",
    description:
      "POST /api/auth/login: verify credentials, issue session cookie or JWT consistent with middleware. Return member id and masked email.",
    estimatedHours: 5,
    executionKind: "human_confirm_after",
    priority: "P0",
    dependencies: ["ci-T003"],
    files: ["src/app/api/auth/login/route.ts"],
    coversRequirementIds: ["FR-021"],
  },
  {
    id: "ci-T005",
    phase: "Auth & Gateway",
    title: "Implement user logout API route",
    description:
      "POST /api/auth/logout: clear session cookie or invalidate token strategy used in login.",
    estimatedHours: 1,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T004"],
    files: ["src/app/api/auth/logout/route.ts"],
    coversRequirementIds: ["FR-022"],
  },
  {
    id: "ci-T006",
    phase: "Auth & Gateway",
    title: "Protect API routes with auth middleware",
    description:
      "Next.js middleware or shared helper to require authentication for /api/member/* and /api/claims/* except public health checks.",
    estimatedHours: 3,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T004"],
    files: ["src/middleware.ts"],
    coversRequirementIds: ["FR-023"],
  },
  // ── Backend Services (3) ──
  {
    id: "ci-T007",
    phase: "Backend Services",
    title: "List member policies API",
    description:
      "GET /api/member/policies: return active critical illness policies for the authenticated user with coverage summary and effective dates.",
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T006"],
    coversRequirementIds: ["FR-030"],
  },
  {
    id: "ci-T008",
    phase: "Backend Services",
    title: "Submit and list claims API",
    description:
      "POST /api/claims: create Claim with type, description, attachment metadata. GET /api/claims: paginated list for current user with status.",
    estimatedHours: 6,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T007"],
    coversRequirementIds: ["FR-031", "FR-032"],
  },
  {
    id: "ci-T009",
    phase: "Backend Services",
    title: "Coverage eligibility check API",
    description:
      "GET /api/policies/:id/coverage-check: validate policy belongs to user and return covered conditions summary (read-only, no medical advice).",
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    priority: "P1",
    dependencies: ["ci-T007"],
    coversRequirementIds: ["FR-033"],
  },
  // ── Frontend (10) ──
  {
    id: "ci-T010",
    phase: "Frontend",
    title: "App shell, layout, and navigation",
    description:
      "Root layout with header, footer disclaimer (not medical advice), and nav: Home, My Policies, Claims, Profile. Responsive with Tailwind.",
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T001"],
    coversRequirementIds: ["FR-040"],
  },
  {
    id: "ci-T011",
    phase: "Frontend",
    title: "Registration and login pages",
    description:
      "Forms calling /api/auth/register and /api/auth/login with client-side validation, error states, and redirect after success.",
    estimatedHours: 5,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T010", "ci-T004"],
    coversRequirementIds: ["FR-041"],
  },
  {
    id: "ci-T012",
    phase: "Frontend",
    title: "Member dashboard home",
    description:
      "Dashboard showing welcome, quick links to policies and claims, and last claim status summary.",
    estimatedHours: 3,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T011", "ci-T007"],
    coversRequirementIds: ["FR-042"],
  },
  {
    id: "ci-T013",
    phase: "Frontend",
    title: "My policies list and detail views",
    description:
      "List policies from GET /api/member/policies; detail page or drawer with coverage highlights and document download placeholder.",
    estimatedHours: 5,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T012"],
    coversRequirementIds: ["FR-043"],
  },
  {
    id: "ci-T014",
    phase: "Frontend",
    title: "Claims list and new claim form",
    description:
      "Claims table with status badges; multi-step or single form for POST /api/claims with file upload UI (can mock upload to API).",
    estimatedHours: 6,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T012", "ci-T008"],
    coversRequirementIds: ["FR-044"],
  },
  {
    id: "ci-T015",
    phase: "Frontend",
    title: "Claim detail and timeline",
    description:
      "Detail view for one claim: submitted date, status history (mock or from API), and messaging placeholder.",
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    priority: "P1",
    dependencies: ["ci-T014"],
    coversRequirementIds: ["FR-045"],
  },
  {
    id: "ci-T016",
    phase: "Frontend",
    title: "Profile and beneficiary management UI",
    description:
      "Edit profile fields; list/add beneficiaries with Prisma-backed API or client state until API exists.",
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    priority: "P1",
    dependencies: ["ci-T012"],
    coversRequirementIds: ["FR-046"],
  },
  {
    id: "ci-T017",
    phase: "Frontend",
    title: "Educational content: critical illness FAQ page",
    description:
      "Static or MD-driven FAQ page explaining claim process and disclaimers; no personalized medical advice.",
    estimatedHours: 2,
    executionKind: "ai_autonomous",
    priority: "P2",
    dependencies: ["ci-T010"],
    coversRequirementIds: ["FR-047"],
  },
  {
    id: "ci-T018",
    phase: "Frontend",
    title: "Loading, empty, and error states",
    description:
      "Consistent skeleton loaders, empty lists, and toast or inline errors for all main flows.",
    estimatedHours: 3,
    executionKind: "ai_autonomous",
    priority: "P1",
    dependencies: ["ci-T014"],
    coversRequirementIds: ["FR-048"],
  },
  {
    id: "ci-T019",
    phase: "Frontend",
    title: "Accessibility and keyboard navigation pass",
    description:
      "Ensure focus order, labels on inputs, and contrast for primary flows (login, claims).",
    estimatedHours: 2,
    executionKind: "ai_autonomous",
    priority: "P2",
    dependencies: ["ci-T018"],
    coversRequirementIds: ["FR-049"],
  },
  // ── Testing (3) ──
  {
    id: "ci-T020",
    phase: "Testing",
    title: "API tests for auth routes",
    description:
      "Vitest tests for register/login/logout happy path and validation errors. Use vi.fn mocks for Prisma; import Mock from vitest for types — never use vi.mock as a type.",
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    priority: "P0",
    dependencies: ["ci-T005"],
    coversRequirementIds: ["AC-001"],
  },
  {
    id: "ci-T021",
    phase: "Testing",
    title: "API tests for policies and claims",
    description:
      "Integration-style tests with mocked DB for GET policies and POST/GET claims.",
    estimatedHours: 5,
    executionKind: "ai_autonomous",
    priority: "P1",
    dependencies: ["ci-T008"],
    coversRequirementIds: ["AC-002"],
  },
  {
    id: "ci-T022",
    phase: "Testing",
    title: "Smoke E2E for login and dashboard",
    description:
      "Playwright (or existing e2e runner): open app, register or login fixture, assert dashboard visible.",
    estimatedHours: 4,
    executionKind: "ai_autonomous",
    priority: "P2",
    dependencies: ["ci-T012"],
    coversRequirementIds: ["AC-003"],
  },
  // ── Infrastructure (1) ──
  {
    id: "ci-T023",
    phase: "Infrastructure",
    title: "Environment template and local DB instructions",
    description:
      ".env.example with DATABASE_URL, NEXTAUTH_SECRET or JWT_SECRET, and README section for prisma migrate and seed sample policy data.",
    estimatedHours: 2,
    executionKind: "ai_autonomous",
    priority: "P1",
    dependencies: ["ci-T001"],
    coversRequirementIds: ["FR-050"],
  },
];
