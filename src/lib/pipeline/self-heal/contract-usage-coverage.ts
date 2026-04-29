/**
 * Contract Usage Coverage audit (CODEGEN_HARDENING_PLAN.md §7.1 / §7.2).
 *
 * Goal: catch the "speculative CRUD" failure mode where `generate_api_contracts`
 * over-specified API_CONTRACTS.json with endpoints nobody calls and PRD never
 * required. Without this audit, those endpoints reach the route-registration
 * gate as "missing implementations" and wedge `integration_verify_fix` in a
 * stagnation loop trying to either implement them (impossible — no spec) or
 * delete them (no permission given).
 *
 * The audit performs a 4-quadrant classification across:
 *   • API_CONTRACTS.json (what the contract claims)
 *   • frontend/src/**\/* (what the UI actually calls)
 *   • PRD.md (what the user asked for — via `prdJustification` + keyword grep)
 *
 * Default behaviour ("prune"): SURPLUS contract entries are removed from
 * API_CONTRACTS.json on the spot so the downstream route audit never sees
 * them. Other classifications are written to
 * `.ralph/contract-usage-coverage.json` as `pendingRepairTasks` for the
 * `integration_verify_fix` worker to consume as deterministic instructions
 * (instead of having to re-derive them and stagnate).
 *
 * Policy is configurable via `CONTRACT_USAGE_COVERAGE_POLICY` env var:
 *   • "prune" (default) — auto-prune surplus
 *   • "warn"            — flag surplus but keep contract intact
 *   • "fail"            — emit + throw, surfacing for human review
 */

import path from "path";
import { fsRead, fsWrite, listFiles } from "@/lib/langgraph/tools";
import type { RepairEmitter } from "./events";

export type CoverageCaseId =
  | "consistent"
  | "frontend-wiring-missing"
  | "contract-surplus"
  | "contract-gap-add-and-impl"
  | "frontend-rogue-call"
  | "admin-audience-skipped";

export interface ContractEntryRef {
  method: string;
  endpoint: string;
  audience?: "user" | "admin";
  prdJustification?: string;
}

export interface FrontendCallSiteRef {
  method: string;
  endpoint: string;
  /** Source path (relative to outputDir) where the call appears. */
  sourcePath: string;
  /** Approximate line where the regex matched. */
  line: number;
}

export interface CoverageClassification {
  case: CoverageCaseId;
  contract?: ContractEntryRef;
  callSite?: FrontendCallSiteRef;
  prdJustified: boolean;
  reason: string;
}

export interface CoverageRepairTask {
  /** Stable id so verify-fix can dedupe across retries. */
  id: string;
  case: CoverageCaseId;
  role: "frontend" | "backend";
  /** Short imperative directive for the worker. */
  directive: string;
  /** The endpoint involved (canonical form). */
  endpoint: string;
  method: string;
  /** Where the call lives (only for frontend tasks). */
  sourcePath?: string;
}

export type CoveragePolicy = "prune" | "warn" | "fail";

export interface ContractUsageCoverageInput {
  outputDir: string;
  /** Optional override; defaults to `process.env.CONTRACT_USAGE_COVERAGE_POLICY`. */
  policy?: CoveragePolicy;
  emitter?: RepairEmitter;
  sessionId?: string;
  /**
   * "post-contract": runs immediately after generate_api_contracts; the frontend
   *                  has NOT been generated yet, so there are zero call sites.
   *                  In this phase only the surplus-prune action fires; we DO
   *                  NOT queue `frontend-wiring-missing` tasks (frontend doesn't
   *                  exist yet — those would be premature and noisy).
   * "pre-integration": runs after worker codegen, before the route-registration
   *                  gate. The full 4-quadrant analysis applies; all repair
   *                  tasks (cases 1, 3, 4) are queued for the verify-fix worker.
   *
   * Defaults to "pre-integration" to preserve the strictest behaviour for
   * callers that don't specify.
   */
  phase?: "post-contract" | "pre-integration";
}

export interface ContractUsageCoverageResult {
  policy: CoveragePolicy;
  totals: {
    contractEntries: number;
    frontendCalls: number;
    consistent: number;
    surplus: number;
    frontendWiringMissing: number;
    contractGap: number;
    frontendRogue: number;
    adminSkipped: number;
  };
  classifications: CoverageClassification[];
  pendingRepairTasks: CoverageRepairTask[];
  /** Endpoints actually removed from API_CONTRACTS.json. */
  pruned: Array<{ method: string; endpoint: string }>;
}

const COVERAGE_REPORT_REL = path.join(".ralph", "contract-usage-coverage.json");

const FRONTEND_SCAN_DIRS = [
  "frontend/src/api",
  "frontend/src/views",
  "frontend/src/pages",
  "frontend/src/components",
  "frontend/src/hooks",
  "frontend/src/store",
  "frontend/src/services",
];

/** apiClient.get("/x"), api.post(`/x`), client.delete('/x'), http.put("...") */
const API_METHOD_CALL_RE =
  /\b(?:apiClient|api|client|http|axios|request)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*[`"']([^`"']+)[`"']/gi;
/** fetch("/api/...") — only matches when the literal starts with /api */
const FETCH_LITERAL_RE =
  /\bfetch\s*\(\s*[`"'](\/api\/[^`"']+)[`"']/gi;

function resolvePolicy(input: ContractUsageCoverageInput): CoveragePolicy {
  if (input.policy) return input.policy;
  const env = (process.env.CONTRACT_USAGE_COVERAGE_POLICY ?? "prune")
    .trim()
    .toLowerCase();
  if (env === "warn" || env === "fail" || env === "prune") return env;
  return "prune";
}

/**
 * Canonicalise an endpoint for matching: lower-case method, strip query string,
 * collapse `${userId}` / `:userId` / `:id` style param holes to `:id`, and
 * normalise leading/trailing slashes. Returns "GET /api/users/:id".
 */
function canonicaliseEndpoint(method: string, path: string): string {
  let p = path.trim();
  // strip template string params: ${anything} or ${expr.member}
  p = p.replace(/\$\{[^}]+\}/g, ":id");
  // strip :paramName → :id (uniform comparison)
  p = p.replace(/:[A-Za-z_][\w]*/g, ":id");
  // strip query string + hash
  p = p.replace(/[?#].*$/, "");
  // ensure leading slash
  if (!p.startsWith("/")) p = `/${p}`;
  // collapse double slashes
  p = p.replace(/\/{2,}/g, "/");
  // strip trailing slash (except root)
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return `${method.toUpperCase()} ${p}`;
}

/**
 * Build the comparison set for a contract endpoint. Frontend may call with or
 * without the `/api` prefix (depending on whether `apiClient` already injects
 * the base URL). We accept both forms.
 */
function endpointComparators(method: string, endpoint: string): Set<string> {
  const out = new Set<string>();
  out.add(canonicaliseEndpoint(method, endpoint));
  if (endpoint.startsWith("/api/")) {
    out.add(canonicaliseEndpoint(method, endpoint.slice(4)));
  } else if (endpoint.startsWith("/")) {
    out.add(canonicaliseEndpoint(method, `/api${endpoint}`));
  }
  return out;
}

/**
 * Decide whether the endpoint is "PRD-required":
 *   1. If `contract.prdJustification` is non-empty AND a reasonable fragment
 *      can be found verbatim in PRD.md → required.
 *   2. Otherwise tokenise the path (`/api/cached-markets/:id` → ["cached",
 *      "markets"]) and grep PRD case-insensitively. If at least 1 distinctive
 *      token (length >= 4) hits, treat as required.
 *   3. Else: not required.
 */
function isPrdRequired(
  contract: ContractEntryRef,
  prdLowerCase: string,
): { required: boolean; reason: string } {
  if (prdLowerCase.length === 0) {
    // No PRD available; default to "required" so we never aggressively prune.
    return { required: true, reason: "no-prd-available-defaulting-required" };
  }
  const justification = (contract.prdJustification ?? "").trim();
  if (justification.length >= 8) {
    const needle = justification.toLowerCase().slice(0, 80);
    if (prdLowerCase.includes(needle.slice(0, 24))) {
      return { required: true, reason: "prdJustification-quote-found" };
    }
  }
  const tokens = contract.endpoint
    .split(/[\/:?#]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && !/^api$/i.test(s) && !/^[A-Z_]+$/.test(s));
  for (const t of tokens) {
    if (prdLowerCase.includes(t.toLowerCase())) {
      return { required: true, reason: `prd-keyword-hit:${t}` };
    }
  }
  return { required: false, reason: "no-prd-evidence" };
}

async function scanFrontendApiCalls(
  outputDir: string,
): Promise<FrontendCallSiteRef[]> {
  const seen = new Set<string>();
  const out: FrontendCallSiteRef[] = [];
  for (const dir of FRONTEND_SCAN_DIRS) {
    const files = await listFiles(dir, outputDir);
    for (const rel of files) {
      if (!/\.(ts|tsx|js|jsx)$/.test(rel)) continue;
      if (rel.includes("node_modules")) continue;
      const content = await fsRead(rel, outputDir);
      if (
        content.startsWith("FILE_NOT_FOUND") ||
        content.startsWith("REJECTED")
      ) {
        continue;
      }
      const pushUnique = (
        method: string,
        endpoint: string,
        offset: number,
      ): void => {
        const line = content.slice(0, offset).split("\n").length;
        const key = `${method.toUpperCase()} ${endpoint}@${rel}:${line}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ method: method.toUpperCase(), endpoint, sourcePath: rel, line });
      };
      let m: RegExpExecArray | null;
      API_METHOD_CALL_RE.lastIndex = 0;
      while ((m = API_METHOD_CALL_RE.exec(content)) !== null) {
        pushUnique(m[1], m[2], m.index);
      }
      FETCH_LITERAL_RE.lastIndex = 0;
      while ((m = FETCH_LITERAL_RE.exec(content)) !== null) {
        pushUnique("GET", m[1], m.index);
      }
    }
  }
  return out;
}

interface RawContractEntry {
  service?: string;
  endpoint?: string;
  method?: string;
  audience?: string;
  prdJustification?: string;
  description?: string;
  id?: string;
  [k: string]: unknown;
}

async function loadContract(
  outputDir: string,
): Promise<{ raw: RawContractEntry[]; refs: ContractEntryRef[] }> {
  const raw = await fsRead("API_CONTRACTS.json", outputDir);
  if (raw.startsWith("FILE_NOT_FOUND") || raw.startsWith("REJECTED")) {
    return { raw: [], refs: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { raw: [], refs: [] };
  }
  if (!Array.isArray(parsed)) return { raw: [], refs: [] };
  const items = parsed as RawContractEntry[];
  const refs: ContractEntryRef[] = items.map((item) => ({
    method: String(item.method ?? "GET").toUpperCase(),
    endpoint: String(item.endpoint ?? "/"),
    audience: item.audience === "admin" ? "admin" : "user",
    prdJustification:
      typeof item.prdJustification === "string"
        ? item.prdJustification
        : undefined,
  }));
  return { raw: items, refs };
}

async function loadPrdLowerCase(outputDir: string): Promise<string> {
  // Try both the generated-code root PRD and the kickoff input PRD.
  const candidates = ["PRD.md", "../.blueprint/PRD.md", "blueprint/PRD.md"];
  for (const candidate of candidates) {
    const content = await fsRead(candidate, outputDir);
    if (
      !content.startsWith("FILE_NOT_FOUND") &&
      !content.startsWith("REJECTED")
    ) {
      return content.toLowerCase();
    }
  }
  return "";
}

/**
 * Run the audit. Idempotent — repeated runs produce identical decisions
 * given the same input files.
 */
export async function runContractUsageCoverage(
  input: ContractUsageCoverageInput,
): Promise<ContractUsageCoverageResult> {
  const policy = resolvePolicy(input);
  const phase = input.phase ?? "pre-integration";
  const { raw: rawContracts, refs: contractRefs } = await loadContract(
    input.outputDir,
  );
  const callSites = await scanFrontendApiCalls(input.outputDir);
  const prdLower = await loadPrdLowerCase(input.outputDir);

  const callIndex = new Set<string>();
  const callIndexByCanonical = new Map<string, FrontendCallSiteRef>();
  for (const c of callSites) {
    const canon = canonicaliseEndpoint(c.method, c.endpoint);
    callIndex.add(canon);
    if (!callIndexByCanonical.has(canon)) {
      callIndexByCanonical.set(canon, c);
    }
    // Also register the /api-prefixed variant so contract entries written
    // with /api prefix can match calls written without it.
    if (c.endpoint.startsWith("/")) {
      const alt = canonicaliseEndpoint(c.method, `/api${c.endpoint}`);
      callIndex.add(alt);
      if (!callIndexByCanonical.has(alt)) {
        callIndexByCanonical.set(alt, c);
      }
    }
  }

  const classifications: CoverageClassification[] = [];
  const pendingRepairTasks: CoverageRepairTask[] = [];
  const surplusKeys = new Set<string>();

  // ── Pass 1: each contract entry → case (1) / (2) / (3-skip-admin) / consistent
  for (const c of contractRefs) {
    const variants = endpointComparators(c.method, c.endpoint);
    const matchedByFrontend = [...variants].some((v) => callIndex.has(v));
    if (c.audience === "admin") {
      classifications.push({
        case: "admin-audience-skipped",
        contract: c,
        prdJustified: true,
        reason:
          "audience=admin — internal endpoint, frontend call coverage is not required",
      });
      continue;
    }
    if (matchedByFrontend) {
      classifications.push({
        case: "consistent",
        contract: c,
        prdJustified: true,
        reason: "frontend has at least one call site for this endpoint",
      });
      continue;
    }
    const prdCheck = isPrdRequired(c, prdLower);
    if (prdCheck.required) {
      // Case (1) — frontend defect. Contract stays. Queue a frontend wiring
      // task ONLY in the pre-integration phase: at the post-contract phase
      // the frontend hasn't been generated yet, so "missing wiring" is the
      // expected default state (every contract entry is unwired) and queuing
      // tasks would just produce noise.
      classifications.push({
        case: "frontend-wiring-missing",
        contract: c,
        prdJustified: true,
        reason: prdCheck.reason,
      });
      if (phase === "pre-integration") {
        pendingRepairTasks.push({
          id: `wire-${c.method}-${c.endpoint}`.toLowerCase(),
          case: "frontend-wiring-missing",
          role: "frontend",
          directive: `Wire up frontend to call ${c.method} ${c.endpoint} from the appropriate page/component (PRD describes this flow). Use the canonical apiClient. Do NOT alter API_CONTRACTS.json — it is correct.`,
          endpoint: c.endpoint,
          method: c.method,
        });
      }
      continue;
    }
    // Case (2) — surplus. Mark for prune (or warn, depending on policy).
    classifications.push({
      case: "contract-surplus",
      contract: c,
      prdJustified: false,
      reason:
        "no frontend call site AND no PRD evidence (justification quote / keyword grep)",
    });
    surplusKeys.add(`${c.method.toUpperCase()} ${c.endpoint}`);
  }

  // ── Pass 2: each frontend call → case (3) / (4) / (already consistent)
  const contractIndex = new Set<string>();
  for (const c of contractRefs) {
    for (const v of endpointComparators(c.method, c.endpoint)) {
      contractIndex.add(v);
    }
  }
  for (const call of callSites) {
    const canon = canonicaliseEndpoint(call.method, call.endpoint);
    if (contractIndex.has(canon)) continue; // already paired in pass 1
    // Try the /api-prefixed variant before declaring it missing.
    const altCanon = canonicaliseEndpoint(call.method, `/api${call.endpoint}`);
    if (call.endpoint.startsWith("/") && contractIndex.has(altCanon)) continue;
    // Contract lacks this call; PRD decides between case (3) and case (4).
    const prdCheck = isPrdRequired(
      { method: call.method, endpoint: call.endpoint },
      prdLower,
    );
    if (prdCheck.required) {
      classifications.push({
        case: "contract-gap-add-and-impl",
        callSite: call,
        prdJustified: true,
        reason: prdCheck.reason,
      });
      pendingRepairTasks.push({
        id: `add-${call.method}-${call.endpoint}`.toLowerCase(),
        case: "contract-gap-add-and-impl",
        role: "backend",
        directive: `Add ${call.method} ${call.endpoint} to API_CONTRACTS.json (infer schema from the call site at ${call.sourcePath}:${call.line}) AND implement the backend route. The frontend already calls this — it is missing on the contract / backend side.`,
        endpoint: call.endpoint,
        method: call.method,
        sourcePath: call.sourcePath,
      });
    } else {
      classifications.push({
        case: "frontend-rogue-call",
        callSite: call,
        prdJustified: false,
        reason: prdCheck.reason,
      });
      pendingRepairTasks.push({
        id: `rogue-${call.method}-${call.endpoint}`.toLowerCase(),
        case: "frontend-rogue-call",
        role: "frontend",
        directive: `Remove or replace the frontend call ${call.method} ${call.endpoint} at ${call.sourcePath}:${call.line}. PRD does not describe this endpoint and no contract entry exists. Use the canonical contract endpoint instead, or delete the call entirely if it is dead code.`,
        endpoint: call.endpoint,
        method: call.method,
        sourcePath: call.sourcePath,
      });
    }
  }

  // ── Apply policy (prune surplus from API_CONTRACTS.json) ────────────────
  const pruned: Array<{ method: string; endpoint: string }> = [];
  if (surplusKeys.size > 0 && policy === "prune") {
    const keepers = rawContracts.filter((item) => {
      const key = `${String(item.method ?? "GET").toUpperCase()} ${item.endpoint ?? "/"}`;
      const drop = surplusKeys.has(key);
      if (drop) {
        pruned.push({
          method: String(item.method ?? "GET").toUpperCase(),
          endpoint: String(item.endpoint ?? "/"),
        });
      }
      return !drop;
    });
    // Re-number ids after pruning so the file stays tidy.
    const renumbered = keepers.map((item, i) => ({
      ...item,
      id: `API-${String(i + 1).padStart(3, "0")}`,
    }));
    await fsWrite(
      "API_CONTRACTS.json",
      JSON.stringify(renumbered, null, 2),
      input.outputDir,
    );
  }

  const totals = {
    contractEntries: contractRefs.length,
    frontendCalls: callSites.length,
    consistent: classifications.filter((c) => c.case === "consistent").length,
    surplus: classifications.filter((c) => c.case === "contract-surplus")
      .length,
    frontendWiringMissing: classifications.filter(
      (c) => c.case === "frontend-wiring-missing",
    ).length,
    contractGap: classifications.filter(
      (c) => c.case === "contract-gap-add-and-impl",
    ).length,
    frontendRogue: classifications.filter(
      (c) => c.case === "frontend-rogue-call",
    ).length,
    adminSkipped: classifications.filter(
      (c) => c.case === "admin-audience-skipped",
    ).length,
  };

  const result: ContractUsageCoverageResult = {
    policy,
    totals,
    classifications,
    pendingRepairTasks,
    pruned,
  };

  // Persist a machine-readable artefact for verify-fix to consume as
  // deterministic instructions (CODEGEN_HARDENING_PLAN.md §7.2). Best-effort:
  // failures here must never break the audit.
  try {
    await fsWrite(
      COVERAGE_REPORT_REL,
      JSON.stringify(result, null, 2),
      input.outputDir,
    );
  } catch {
    /* ignore — emitter still carries the data */
  }

  // Emit telemetry. The retrofit-suggestion detector in coding-session-report
  // uses these counts; the verify-fix worker uses pendingRepairTasks.
  if (input.emitter) {
    input.emitter({
      stage: "preflight-contract-completeness",
      event: "contract_usage_coverage_audit",
      details: {
        phase,
        policy,
        totals,
        prunedCount: pruned.length,
        pendingRepairTaskCount: pendingRepairTasks.length,
        prunedSample: pruned.slice(0, 8),
      },
    });
    if (policy === "fail" && totals.surplus > 0) {
      // Caller decides whether to throw based on this signal.
      input.emitter({
        stage: "preflight-contract-completeness",
        event: "contract_usage_coverage_fail",
        details: { surplus: totals.surplus, sample: [...surplusKeys].slice(0, 8) },
      });
    }
  }

  return result;
}
