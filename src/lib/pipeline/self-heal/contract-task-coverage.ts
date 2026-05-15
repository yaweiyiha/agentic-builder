/**
 * Contract → task coverage gate.
 *
 * Symptom this prevents:
 *   `generate_api_contracts` emits N endpoints (e.g. POST /api/scoring/run,
 *   GET /api/meta/stablecoins). Task breakdown ran BEFORE contracts were
 *   generated, so no `T-XXX` task lists `backend/src/api/modules/scoring`
 *   or `…/meta` in its `files`. Workers never implement these modules.
 *   Integration gate later reports them as `missingContractEndpoints` and
 *   the LLM-driven verify-fix worker stagnates because it lacks an explicit
 *   "implement file X with handler Y" instruction.
 *
 * What this module does:
 *   1. Read API_CONTRACTS.json + the current task list.
 *   2. For each non-admin contract endpoint, derive the canonical backend
 *      module path it ought to live in (e.g. `/api/scoring/run` →
 *      `backend/src/api/modules/scoring/scoring.routes.ts`).
 *   3. Mark the endpoint as covered iff at least one task's `files`
 *      list (creates / modifies / reads) mentions the same module dir.
 *   4. Persist the gap report to `.ralph/contract-task-gap.json` so the
 *      integration verify-fix worker can consume it as a deterministic
 *      instruction list (parallel to `contract-usage-coverage.json`).
 *   5. Optionally render a markdown block (`formatContractTaskGapBlock`)
 *      that gets prepended to the verify-fix user message.
 *
 * This audit is non-destructive — it never mutates contracts or tasks.
 * Pruning belongs to `runContractUsageCoverage` (the PRD-justification
 * layer); this module is purely about "is anyone scheduled to implement
 * the backend route?".
 */

import path from "path";
import { fsRead, fsWrite } from "@/lib/langgraph/tools";
import type { CodingTask } from "@/lib/pipeline/types";
import type { RepairEmitter } from "./events";

const REPORT_REL = path.join(".ralph", "contract-task-gap.json");

/** Endpoints we never expect a coding task to "own" — covered by scaffold/baseline. */
const SCAFFOLD_OWNED_ENDPOINTS: ReadonlyArray<{
  method: string;
  pathRe: RegExp;
}> = [
  { method: "GET", pathRe: /^\/(api\/)?health\/?$/ },
  { method: "POST", pathRe: /^\/(api\/)?auth\/login\/?$/ },
  { method: "POST", pathRe: /^\/(api\/)?auth\/logout\/?$/ },
  { method: "POST", pathRe: /^\/(api\/)?auth\/refresh\/?$/ },
  { method: "GET", pathRe: /^\/(api\/)?auth\/me\/?$/ },
  { method: "GET", pathRe: /^\/(api\/)?auth\/session\/?$/ },
];

export interface ContractTaskCoverageInput {
  outputDir: string;
  tasks: CodingTask[];
  emitter?: RepairEmitter;
  sessionId?: string;
}

export interface ContractTaskGap {
  method: string;
  endpoint: string;
  /** Suggested module dir under backend/src/api/modules. */
  suggestedModuleDir: string;
  /** Suggested routes file path. */
  suggestedRoutesFile: string;
  /** Suggested controller file path. */
  suggestedControllerFile: string;
  audience?: "user" | "admin";
  prdJustification?: string;
}

export interface ContractTaskCoverageResult {
  totals: {
    contractEntries: number;
    skippedScaffold: number;
    coveredByTask: number;
    uncovered: number;
    adminSkipped: number;
  };
  gaps: ContractTaskGap[];
}

interface RawContractEntry {
  method?: string;
  endpoint?: string;
  audience?: string;
  prdJustification?: string;
}

function isScaffoldOwned(method: string, endpoint: string): boolean {
  const m = method.toUpperCase();
  return SCAFFOLD_OWNED_ENDPOINTS.some(
    (rule) => rule.method === m && rule.pathRe.test(endpoint),
  );
}

/**
 * Pull the first non-`api` segment from a path like `/api/scoring/run` → `scoring`.
 * Used as the suggested module name. Falls back to `misc` when nothing matches.
 */
function deriveModuleName(endpoint: string): string {
  const parts = endpoint
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith(":") && !p.startsWith("{"));
  for (const seg of parts) {
    if (/^api$/i.test(seg)) continue;
    return seg.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  }
  return "misc";
}

function collectTaskPaths(task: CodingTask): string[] {
  const out: string[] = [];
  if (Array.isArray(task.files)) {
    for (const f of task.files) {
      if (typeof f === "string" && f.trim().length > 0) out.push(f);
    }
  } else if (task.files && typeof task.files === "object") {
    const rec = task.files as { creates?: unknown; modifies?: unknown; reads?: unknown };
    for (const list of [rec.creates, rec.modifies, rec.reads]) {
      if (Array.isArray(list)) {
        for (const f of list) {
          if (typeof f === "string" && f.trim().length > 0) out.push(f);
        }
      }
    }
  }
  return out;
}

async function loadContracts(outputDir: string): Promise<RawContractEntry[]> {
  const raw = await fsRead("API_CONTRACTS.json", outputDir);
  if (raw.startsWith("FILE_NOT_FOUND") || raw.startsWith("REJECTED")) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RawContractEntry[];
  } catch {
    return [];
  }
}

/**
 * Run the audit. Always safe — never mutates contracts/tasks. Writes a
 * gap report to `.ralph/contract-task-gap.json` (best-effort).
 */
export async function runContractTaskCoverage(
  input: ContractTaskCoverageInput,
): Promise<ContractTaskCoverageResult> {
  const contracts = await loadContracts(input.outputDir);
  const taskPaths = input.tasks.flatMap(collectTaskPaths);
  const taskPathSet = new Set(
    taskPaths.map((p) => p.replace(/\\/g, "/").toLowerCase()),
  );

  const totals = {
    contractEntries: contracts.length,
    skippedScaffold: 0,
    coveredByTask: 0,
    uncovered: 0,
    adminSkipped: 0,
  };
  const gaps: ContractTaskGap[] = [];

  for (const c of contracts) {
    const method = String(c.method ?? "GET").toUpperCase();
    const endpoint = String(c.endpoint ?? "/");
    const audience = c.audience === "admin" ? "admin" : "user";

    if (isScaffoldOwned(method, endpoint)) {
      totals.skippedScaffold += 1;
      continue;
    }

    const moduleName = deriveModuleName(endpoint);
    const moduleDir = `backend/src/api/modules/${moduleName}`;
    const routesFile = `${moduleDir}/${moduleName}.routes.ts`;
    const controllerFile = `${moduleDir}/${moduleName}.controller.ts`;

    // A task covers the endpoint iff it lists ANY file under the same
    // module directory. Substring match is intentional — task plans are
    // not always perfectly normalised, and "covers the same module" is
    // the relevant signal, not "creates the exact routes.ts".
    const moduleDirLower = moduleDir.toLowerCase();
    const covered = [...taskPathSet].some((p) => p.includes(moduleDirLower));

    if (covered) {
      totals.coveredByTask += 1;
      continue;
    }

    // We still report admin endpoints separately so the worker knows the
    // gap exists — but they're typically internal/dashboard surfaces.
    if (audience === "admin") {
      totals.adminSkipped += 1;
    } else {
      totals.uncovered += 1;
    }

    gaps.push({
      method,
      endpoint,
      suggestedModuleDir: moduleDir,
      suggestedRoutesFile: routesFile,
      suggestedControllerFile: controllerFile,
      audience,
      prdJustification:
        typeof c.prdJustification === "string" ? c.prdJustification : undefined,
    });
  }

  const result: ContractTaskCoverageResult = { totals, gaps };

  try {
    await fsWrite(
      REPORT_REL.split(path.sep).join("/"),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), ...result },
        null,
        2,
      ),
      input.outputDir,
    );
  } catch {
    /* persistence is best-effort */
  }

  if (input.emitter) {
    input.emitter({
      stage: "preflight-contract-completeness",
      sessionId: input.sessionId,
      event: "contract_task_coverage_audit",
      details: {
        ...totals,
        sample: gaps.slice(0, 6).map((g) => `${g.method} ${g.endpoint}`),
      },
    });
  }

  return result;
}

/**
 * Render the gap list as a markdown block suitable for prepending to the
 * verify-fix user message. Returns an empty string when there are no gaps.
 */
export function formatContractTaskGapBlock(
  result: ContractTaskCoverageResult,
): string {
  if (result.gaps.length === 0) return "";
  const lines: string[] = [];
  lines.push("");
  lines.push(
    "## Backend route gap (CONTRACT vs TASK PLAN — MUST IMPLEMENT NOW)",
  );
  lines.push(
    `${result.totals.uncovered} contract endpoint(s) had **no coding task assigned to implement them** before integration. The task list was frozen before contracts were generated, so no worker created the routes/controller/service for these endpoints. You MUST implement them in this verify-fix loop using the suggested file paths.`,
  );
  lines.push("");
  for (const gap of result.gaps.slice(0, 12)) {
    lines.push(
      `- **${gap.method} ${gap.endpoint}** ${gap.audience === "admin" ? "(admin)" : ""}`,
    );
    lines.push(
      `  - create routes: \`${gap.suggestedRoutesFile}\` (export \`register${capitalize(deriveModuleName(gap.endpoint))}Routes\`)`,
    );
    lines.push(
      `  - create controller: \`${gap.suggestedControllerFile}\``,
    );
    lines.push(
      `  - register in: \`backend/src/api/modules/index.ts\``,
    );
    if (gap.prdJustification && gap.prdJustification.trim().length > 0) {
      lines.push(
        `  - PRD: ${gap.prdJustification.trim().slice(0, 160)}${gap.prdJustification.length > 160 ? "…" : ""}`,
      );
    }
  }
  if (result.gaps.length > 12) {
    lines.push(
      `- … (+${result.gaps.length - 12} more — full list in \`.ralph/contract-task-gap.json\`)`,
    );
  }
  lines.push("");
  lines.push(
    "After implementing, register each new module in `backend/src/api/modules/index.ts` and re-run `backend_smoke` + `backend_tsc`.",
  );
  return lines.join("\n");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s
    .split(/[-_]/)
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase())
    .join("");
}
