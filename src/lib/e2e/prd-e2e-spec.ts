import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import {
  chatCompletionWithFallback,
  estimateCost,
  resolveModel,
  type ChatMessage,
} from "@/lib/openrouter";
import type { KickoffWorkItem } from "@/lib/pipeline/types";
import { extractPrdRequirementIndex } from "@/lib/requirements/extract-prd-spec";
import { formatPrdSpecForContext } from "@/lib/requirements/prd-spec-extractor";
import type { PrdSpec } from "@/lib/requirements/prd-spec-types";

export interface PrdE2eScenarioStep {
  action: string;
  target: string;
  assertion: string;
}

export interface PrdE2eScenario {
  id: string;
  title: string;
  route: string;
  persona: string;
  priority: "P0" | "P1" | "P2";
  preconditions: string[];
  expectedOutcome: string;
  coversRequirementIds: string[];
  steps: PrdE2eScenarioStep[];
}

export interface PrdE2eSpec {
  personas: string[];
  notes: string[];
  scenarios: PrdE2eScenario[];
}

export interface PrdE2eExtractionResult {
  spec: PrdE2eSpec | null;
  model: string;
  costUsd: number;
  durationMs: number;
  parseFailed: boolean;
  rawOutput: string;
}

export interface E2eCoverageReport {
  totalRequirementIds: string[];
  coveredRequirementIds: string[];
  missingRequirementIds: string[];
  scenarioCount: number;
  coveredScenarioIds: string[];
  uncoveredScenarioIds: string[];
}

const E2E_SPEC_PROMPT = `You are a senior QA architect.
Convert the PRD into a compact E2E verification spec for browser automation.

Return ONLY one valid JSON object using this exact shape:
{
  "personas": ["Owner", "Member"],
  "notes": ["short note"],
  "scenarios": [
    {
      "id": "E2E-001",
      "title": "Create task from board",
      "route": "/tasks",
      "persona": "Owner",
      "priority": "P0",
      "preconditions": ["User is logged in"],
      "expectedOutcome": "Task appears in board and persists after refresh",
      "coversRequirementIds": ["AC-001", "FR-TS01"],
      "steps": [
        {
          "action": "Open board page",
          "target": "Task board route",
          "assertion": "Board loads with create action visible"
        }
      ]
    }
  ]
}

Rules:
- Focus on browser-executable user journeys, not unit tests.
- Cover as many AC-*, FR-*, US-*, PAGE-* and CMP-* IDs as possible when they exist.
- Prefer 4-12 scenarios. Merge closely related steps into one scenario instead of creating filler cases.
- "route" must be a concrete route when known, otherwise "/".
- Each scenario must contain 2-8 steps.
- "assertion" must describe a user-visible or API-visible outcome.
- "notes" should mention important gaps, fixtures, or role assumptions.
- Keep every string concise.`;

function uniq(values: Iterable<string>): string[] {
  return [...new Set([...values].map((v) => v.trim()).filter(Boolean))];
}

function normalizeStep(
  raw: Record<string, unknown>,
  idx: number,
): PrdE2eScenarioStep {
  return {
    action:
      typeof raw.action === "string" && raw.action.trim()
        ? raw.action.trim()
        : `Step ${idx + 1}`,
    target: typeof raw.target === "string" ? raw.target.trim() : "",
    assertion: typeof raw.assertion === "string" ? raw.assertion.trim() : "",
  };
}

function normalizeScenario(
  raw: Record<string, unknown>,
  idx: number,
): PrdE2eScenario {
  const priorityRaw =
    typeof raw.priority === "string" ? raw.priority.trim().toUpperCase() : "P1";
  const priority =
    priorityRaw === "P0" || priorityRaw === "P2" ? priorityRaw : "P1";
  const stepsRaw = Array.isArray(raw.steps)
    ? raw.steps.filter(
        (s): s is Record<string, unknown> => !!s && typeof s === "object",
      )
    : [];

  return {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : `E2E-${String(idx + 1).padStart(3, "0")}`,
    title:
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : `Scenario ${idx + 1}`,
    route:
      typeof raw.route === "string" && raw.route.trim()
        ? raw.route.trim()
        : "/",
    persona:
      typeof raw.persona === "string" && raw.persona.trim()
        ? raw.persona.trim()
        : "Default user",
    priority,
    preconditions: Array.isArray(raw.preconditions)
      ? raw.preconditions.filter((v): v is string => typeof v === "string")
      : [],
    expectedOutcome:
      typeof raw.expectedOutcome === "string" ? raw.expectedOutcome.trim() : "",
    coversRequirementIds: Array.isArray(raw.coversRequirementIds)
      ? uniq(raw.coversRequirementIds.filter((v): v is string => typeof v === "string"))
      : [],
    steps: stepsRaw.map((step, stepIdx) => normalizeStep(step, stepIdx)),
  };
}

function parsePrdE2eSpec(raw: string): PrdE2eSpec | null {
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const scenariosRaw = Array.isArray(parsed.scenarios)
      ? parsed.scenarios.filter(
          (s): s is Record<string, unknown> => !!s && typeof s === "object",
        )
      : [];
    const spec: PrdE2eSpec = {
      personas: Array.isArray(parsed.personas)
        ? uniq(parsed.personas.filter((v): v is string => typeof v === "string"))
        : [],
      notes: Array.isArray(parsed.notes)
        ? uniq(parsed.notes.filter((v): v is string => typeof v === "string"))
        : [],
      scenarios: scenariosRaw.map((scenario, idx) =>
        normalizeScenario(scenario, idx),
      ),
    };
    return spec.scenarios.length > 0 ? spec : null;
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function nextTaskId(existingIds: Set<string>, preferred: string): string {
  if (!existingIds.has(preferred)) {
    existingIds.add(preferred);
    return preferred;
  }
  let idx = 2;
  while (existingIds.has(`${preferred}-${idx}`)) idx++;
  const resolved = `${preferred}-${idx}`;
  existingIds.add(resolved);
  return resolved;
}

export async function extractPrdE2eSpec(
  prdMarkdown: string,
  prdSpec?: PrdSpec | null,
): Promise<PrdE2eExtractionResult> {
  const modelChain = resolveModelChain(MODEL_CONFIG.e2eGen, resolveModel);
  const messages: ChatMessage[] = [
    { role: "system", content: E2E_SPEC_PROMPT },
    {
      role: "user",
      content: [
        "Build an E2E verification spec from this PRD.",
        "",
        "## PRD",
        prdMarkdown.slice(0, 20000),
        "",
        prdSpec ? formatPrdSpecForContext(prdSpec).slice(0, 8000) : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const startMs = Date.now();
  try {
    const response = await chatCompletionWithFallback(messages, modelChain, {
      temperature: 0.1,
      max_tokens: 8192,
    });
    const durationMs = Date.now() - startMs;
    const rawOutput = response.choices[0]?.message?.content ?? "";
    const spec = parsePrdE2eSpec(rawOutput);
    return {
      spec,
      model: response.model,
      costUsd: estimateCost(response.model, response.usage),
      durationMs,
      parseFailed: spec === null,
      rawOutput,
    };
  } catch (error) {
    console.error(
      "[PrdE2eSpec] extraction failed:",
      error instanceof Error ? error.message : error,
    );
    return {
      spec: null,
      model: modelChain[0] ?? "unknown",
      costUsd: 0,
      durationMs: Date.now() - startMs,
      parseFailed: true,
      rawOutput: "",
    };
  }
}

export function formatPrdE2eSpecForContext(spec: PrdE2eSpec): string {
  const lines: string[] = ["## PRD E2E Spec", ""];
  if (spec.personas.length > 0) {
    lines.push(`Personas: ${spec.personas.join(", ")}`);
    lines.push("");
  }
  for (const scenario of spec.scenarios) {
    lines.push(
      `### ${scenario.id} — ${scenario.title} (${scenario.priority}, ${scenario.persona}, route: ${scenario.route})`,
    );
    if (scenario.preconditions.length > 0) {
      lines.push(`Preconditions: ${scenario.preconditions.join("; ")}`);
    }
    lines.push(`Expected: ${scenario.expectedOutcome}`);
    lines.push(
      `Requirement IDs: ${scenario.coversRequirementIds.join(", ") || "(none)"}`,
    );
    if (scenario.steps.length > 0) {
      lines.push("Steps:");
      scenario.steps.forEach((step, idx) => {
        lines.push(
          `${idx + 1}. ${step.action} | target: ${step.target} | assert: ${step.assertion}`,
        );
      });
    }
    lines.push("");
  }
  if (spec.notes.length > 0) {
    lines.push("Notes:");
    spec.notes.forEach((note) => lines.push(`- ${note}`));
  }
  return lines.join("\n").trim();
}

export function serializePrdE2eSpec(spec: PrdE2eSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

export function buildE2eCoverageReport(
  spec: PrdE2eSpec,
  tasks: KickoffWorkItem[],
): E2eCoverageReport {
  const prdIndex = extractPrdRequirementIndex(
    spec.scenarios
      .map((scenario) => scenario.coversRequirementIds.join("\n"))
      .join("\n"),
  );
  const allRequirementIds = uniq([
    ...prdIndex.acceptanceCriteriaIds,
    ...prdIndex.featureIds,
    ...prdIndex.userStoryIds,
    ...spec.scenarios.flatMap((scenario) => scenario.coversRequirementIds),
  ]);
  const taskIds = new Set(
    tasks.flatMap((task) =>
      Array.isArray(task.coversRequirementIds) ? task.coversRequirementIds : [],
    ),
  );
  const coveredScenarioIds: string[] = [];
  const uncoveredScenarioIds: string[] = [];
  for (const scenario of spec.scenarios) {
    const isCovered = scenario.coversRequirementIds.some((id) => taskIds.has(id));
    if (isCovered) coveredScenarioIds.push(scenario.id);
    else uncoveredScenarioIds.push(scenario.id);
  }
  const coveredRequirementIds = allRequirementIds.filter((id) => taskIds.has(id));
  const missingRequirementIds = allRequirementIds.filter((id) => !taskIds.has(id));
  return {
    totalRequirementIds: allRequirementIds,
    coveredRequirementIds,
    missingRequirementIds,
    scenarioCount: spec.scenarios.length,
    coveredScenarioIds,
    uncoveredScenarioIds,
  };
}

export function formatE2eCoverageReport(report: E2eCoverageReport): string {
  const lines: string[] = [
    "# E2E Coverage Report",
    "",
    `Total requirement IDs: ${report.totalRequirementIds.length}`,
    `Covered requirement IDs: ${report.coveredRequirementIds.length}`,
    `Missing requirement IDs: ${report.missingRequirementIds.length}`,
    `Scenario count: ${report.scenarioCount}`,
    `Covered scenarios: ${report.coveredScenarioIds.length}`,
    `Uncovered scenarios: ${report.uncoveredScenarioIds.length}`,
    "",
  ];
  if (report.missingRequirementIds.length > 0) {
    lines.push("## Missing requirement IDs");
    report.missingRequirementIds.forEach((id) => lines.push(`- ${id}`));
    lines.push("");
  }
  if (report.uncoveredScenarioIds.length > 0) {
    lines.push("## Uncovered scenarios");
    report.uncoveredScenarioIds.forEach((id) => lines.push(`- ${id}`));
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function hasTestingTasks(tasks: KickoffWorkItem[]): boolean {
  return tasks.some((task) => {
    const lower = `${task.phase} ${task.title} ${task.description}`.toLowerCase();
    return task.phase === "Testing" || /playwright|e2e|qa|test/.test(lower);
  });
}

export function deriveFallbackE2eTasks(
  spec: PrdE2eSpec,
  existingTasks: KickoffWorkItem[],
): KickoffWorkItem[] {
  if (spec.scenarios.length === 0 || hasTestingTasks(existingTasks)) return [];

  const existingIds = new Set(existingTasks.map((task) => task.id));
  const harnessTaskId = nextTaskId(existingIds, "T-E2E-001");
  const scenarioTaskId = nextTaskId(existingIds, "T-E2E-002");
  const scenarioFiles = spec.scenarios
    .slice(0, 6)
    .map(
      (scenario) =>
        `frontend/tests/e2e/generated/${scenario.id.toLowerCase()}-${slugify(scenario.title)}.spec.ts`,
    );
  const topRequirementIds = uniq(
    spec.scenarios.flatMap((scenario) => scenario.coversRequirementIds),
  );

  const harnessTask: KickoffWorkItem = {
    id: harnessTaskId,
    phase: "Testing",
    title: "Set up Playwright E2E harness",
    description:
      "Create the shared Playwright configuration, npm script, fixtures, and reusable helpers required to execute browser-based PRD verification.",
    estimatedHours: 3,
    executionKind: "ai_autonomous",
    files: {
      creates: [
        "frontend/playwright.config.ts",
        "frontend/tests/e2e/fixtures.ts",
        "frontend/tests/e2e/utils.ts",
      ],
      modifies: ["frontend/package.json"],
      reads: ["PRD_E2E_SPEC.md", "E2E_COVERAGE.md"],
    },
    dependencies: [],
    priority: "P0",
    subSteps: [
      {
        step: 1,
        action: "Create Playwright config",
        detail:
          "CREATE new file frontend/playwright.config.ts with baseURL, webServer, trace, screenshot, and retry settings aligned to the generated frontend stack.",
      },
      {
        step: 2,
        action: "Wire frontend script",
        detail:
          "MODIFY existing frontend/package.json to add the Playwright dependency and an executable e2e script without breaking existing dev/build scripts.",
      },
      {
        step: 3,
        action: "Add shared fixtures",
        detail:
          "CREATE new files under frontend/tests/e2e for reusable login/navigation/test data helpers that later scenario specs can import.",
      },
    ],
    acceptanceCriteria: [
      "frontend exposes a working e2e command",
      "Playwright config starts the app or reuses an existing local server",
      "Shared E2E helpers can be imported by generated spec files",
    ],
    coversRequirementIds: [],
  };

  const scenarioTask: KickoffWorkItem = {
    id: scenarioTaskId,
    phase: "Testing",
    title: "Implement PRD browser journeys",
    description: [
      "Implement Playwright browser journeys from PRD_E2E_SPEC.md.",
      ...spec.scenarios
        .slice(0, 6)
        .map(
          (scenario) =>
            `${scenario.id} (${scenario.priority}) ${scenario.title} -> ${scenario.expectedOutcome}`,
        ),
    ].join(" "),
    estimatedHours: Math.max(4, Math.min(10, spec.scenarios.length + 2)),
    executionKind: "ai_autonomous",
    files: {
      creates: scenarioFiles,
      modifies: [],
      reads: ["PRD_E2E_SPEC.md", "E2E_COVERAGE.md", "frontend/playwright.config.ts"],
    },
    dependencies: [harnessTaskId],
    priority: "P0",
    subSteps: [
      {
        step: 1,
        action: "Map scenarios to specs",
        detail:
          "CREATE new Playwright spec files under frontend/tests/e2e/generated and map each PRD E2E scenario to a concrete browser flow with readable test names.",
      },
      {
        step: 2,
        action: "Assert visible outcomes",
        detail:
          "CREATE strong assertions for each scenario step so the tests verify user-visible outcomes, persisted state, redirects, and error handling rather than only page load success.",
      },
      {
        step: 3,
        action: "Cover high-priority flows",
        detail:
          "CREATE P0 and P1 journeys first, making sure every listed AC/FR requirement ID from PRD_E2E_SPEC.md is referenced in the relevant spec coverage comments or test names.",
      },
    ],
    acceptanceCriteria: [
      "High-priority PRD journeys have executable Playwright coverage",
      "Generated specs reference the shared fixtures/helpers instead of duplicating setup logic",
      "Running the frontend e2e command executes the generated browser scenarios",
    ],
    coversRequirementIds: topRequirementIds,
  };

  return [harnessTask, scenarioTask];
}
