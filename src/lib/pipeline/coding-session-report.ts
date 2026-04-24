import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { GeneratedFile } from "@/lib/langgraph/state";
import type { AuditTaskSummary, FeatureChecklistAuditResult } from "@/lib/pipeline/self-heal";

const execFileAsync = promisify(execFile);

export interface CodingSessionLlmUsageEvent {
  timestamp: string;
  sessionId: string;
  stage: string;
  label?: string;
  model: string;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface RepairEventSummary {
  totalEvents: number;
  byStage: Record<string, number>;
  byEvent: Record<string, number>;
  entries: RepairEventEntry[];
}

interface RepairEventEntry {
  stage: string;
  event: string;
  timestamp?: string;
  details?: Record<string, unknown>;
  missingIds?: string[];
  stillMissing?: string[];
  taskId?: string;
}

export interface WriteCodingSessionReportInput {
  sessionId: string;
  outputDir: string;
  startedAt: string;
  endedAt: string;
  status: "pass" | "fail" | "aborted";
  terminalSummary: string;
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  finalAudit?: FeatureChecklistAuditResult | null;
  taskResults: AuditTaskSummary[];
  fileRegistry: GeneratedFile[];
  fatalError?: string;
  /**
   * Max `scaffoldFixAttempts` observed across phase-verify-and-fix runs.
   * Surfaced in the report to show how many iterations the scaffold/fix
   * phase burned before converging (or bailing).
   */
  scaffoldFixAttempts?: number;
  /** Same for integrationFixAttempts from integration verify/fix. */
  integrationFixAttempts?: number;
  /**
   * Whether each top-level quality gate actually executed. Lets the report
   * render SKIPPED for aborted/unreached gates instead of showing a misleading
   * PASS just because no error string was populated.
   */
  gatesExecuted?: {
    integrationVerify: boolean;
    runtimeVerify: boolean;
    e2eVerify: boolean;
  };
}

interface AggregatedModelUsage {
  model: string;
  calls: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  stages: string[];
}

interface ScoreBreakdown {
  score: number;
  grade: string;
  reasons: string[];
}

interface CodingSessionReportHistoryEntry {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  status: "pass" | "fail" | "aborted";
  score: number;
  grade: string;
  durationMs: number;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  primaryModel: string;
  primaryModelScore: number;
  primaryModelGrade: string;
  archiveJsonFile: string;
  archiveMdFile: string;
}

interface StageUsageSummary {
  stage: string;
  startAt: string | null;
  endAt: string | null;
  durationMs: number;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  models: string[];
  labels: string[];
  repairEvents: number;
  score: number;
  grade: string;
  reasons: string[];
}

interface ModelPerformanceSummary {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  stages: string[];
  score: number;
  grade: string;
  reasons: string[];
}

interface ConventionAutofixLedger {
  invocations: number;
  totalFixedFiles: number;
  totalUnfixable: number;
  notes: string[];
  unfixable: string[];
}

interface RouteAuditSnapshot {
  when: "preflight" | "final";
  hardFail: boolean;
  unregisteredModules: string[];
  unresolvedRegistrations: string[];
  missingContractEndpoints: Array<{ method: string; endpoint: string }>;
  undeclaredEndpointCount: number;
}

interface RouteAuditLedger {
  preflight: RouteAuditSnapshot | null;
  final: RouteAuditSnapshot | null;
}

interface ImportGapInstallScope {
  scope: string;
  packages: string[];
  exitCode: number;
}

interface ImportGapLedger {
  totalPackages: number;
  scopes: ImportGapInstallScope[];
}

interface ContractCompletenessSnapshot {
  when: "post-generate" | "preflight" | "final";
  inferredRelationshipCount: number;
  missingScopedEndpoints: Array<{
    parent: string;
    child: string;
    expectedPath: string;
    reason: string;
  }>;
  hardFail: boolean;
}

interface ContractCompletenessLedger {
  postGenerate: ContractCompletenessSnapshot | null;
  preflight: ContractCompletenessSnapshot | null;
  final: ContractCompletenessSnapshot | null;
}

interface PreflightAutomationLedger {
  conventionAutofix: ConventionAutofixLedger;
  routeAudit: RouteAuditLedger;
  importGapInstalls: ImportGapLedger;
  contractCompleteness: ContractCompletenessLedger;
}

type DefectGateState = "pass" | "fail" | "warn" | "unknown";

interface DefectCategory {
  key: string;
  label: string;
  state: DefectGateState;
  evidence: string[];
}

const _llmUsageRegistry = new Map<string, CodingSessionLlmUsageEvent[]>();

export function recordCodingSessionLlmUsage(
  event: Omit<CodingSessionLlmUsageEvent, "timestamp"> & { timestamp?: string },
): void {
  const list = _llmUsageRegistry.get(event.sessionId) ?? [];
  list.push({
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  });
  _llmUsageRegistry.set(event.sessionId, list);
}

export function getCodingSessionLlmUsage(
  sessionId: string,
): CodingSessionLlmUsageEvent[] {
  return [...(_llmUsageRegistry.get(sessionId) ?? [])];
}

export function clearCodingSessionLlmUsage(sessionId: string): void {
  _llmUsageRegistry.delete(sessionId);
}

async function ensureRalphDir(outputDir: string): Promise<string> {
  const dir = path.join(outputDir, ".ralph");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function formatDuration(durationMs: number): string {
  if (durationMs <= 0) return "0s";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function isTimestampInRange(
  timestamp: string | undefined,
  startedAt: string,
  endedAt: string,
): boolean {
  if (!timestamp) return false;
  const value = Date.parse(timestamp);
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (
    Number.isNaN(value) ||
    Number.isNaN(start) ||
    Number.isNaN(end)
  ) {
    return false;
  }
  return value >= start && value <= end;
}

function summarizeReasonList(reasons: string[]): string[] {
  return reasons.length > 0 ? reasons.slice(0, 4) : ["No strong negative signal captured."];
}

function toArchiveTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function formatHistoryMarkdown(
  entries: CodingSessionReportHistoryEntry[],
): string {
  const lines: string[] = [
    "# Coding Session Report History",
    "",
    `- Total archived reports: ${entries.length}`,
    "",
    "## Sessions",
  ];

  if (entries.length === 0) {
    lines.push("- No archived reports yet.", "");
    return lines.join("\n");
  }

  lines.push("## Compare Table", "");
  lines.push(
    "| Ended At | Status | Score | Duration | Calls | Tokens | Cost | Primary Model | Model Score | Report |",
  );
  lines.push(
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |",
  );
  for (const entry of entries) {
    lines.push(
      `| ${entry.endedAt} | ${entry.status.toUpperCase()} | ${entry.score}/100 (${entry.grade}) | ${formatDuration(entry.durationMs)} | ${entry.totalCalls} | ${entry.totalTokens} | $${entry.totalCostUsd.toFixed(4)} | ${entry.primaryModel} | ${entry.primaryModelScore}/100 (${entry.primaryModelGrade}) | [view](./report-history/${entry.archiveMdFile}) |`,
    );
  }
  lines.push("");

  for (const entry of entries) {
    lines.push(
      `- [${entry.endedAt} | ${entry.status.toUpperCase()} | ${entry.score}/100 (${entry.grade})](./report-history/${entry.archiveMdFile})`,
    );
    lines.push(
      `  duration=${formatDuration(entry.durationMs)}, calls=${entry.totalCalls}, tokens=${entry.totalTokens}, cost=$${entry.totalCostUsd.toFixed(4)}, primaryModel=${entry.primaryModel} ${entry.primaryModelScore}/100 (${entry.primaryModelGrade}), session=\`${entry.sessionId}\``,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function updateReportHistoryIndex(
  ralphDir: string,
  entry: CodingSessionReportHistoryEntry,
): Promise<void> {
  const archiveDir = path.join(ralphDir, "report-history");
  await fs.mkdir(archiveDir, { recursive: true });

  const entries: CodingSessionReportHistoryEntry[] = [entry];
  const archiveFiles = await fs.readdir(archiveDir);
  for (const file of archiveFiles) {
    if (!file.endsWith(".json") || file === entry.archiveJsonFile) continue;
    try {
      const raw = await fs.readFile(path.join(archiveDir, file), "utf-8");
      const parsed = JSON.parse(raw) as {
        sessionId?: string;
        startedAt?: string;
        endedAt?: string;
        status?: "pass" | "fail" | "aborted";
        score?: { score?: number; grade?: string };
        modelUsage?: Array<{
          model?: string;
          calls?: number;
          costUsd?: number;
          totalTokens?: number;
        }>;
        modelPerformance?: Array<{
          model?: string;
          score?: number;
          grade?: string;
          totalTokens?: number;
          calls?: number;
        }>;
      };
      const totalCalls = (parsed.modelUsage ?? []).reduce(
        (sum, item) => sum + (item.calls ?? 0),
        0,
      );
      const totalTokens = (parsed.modelUsage ?? []).reduce(
        (sum, item) => sum + (item.totalTokens ?? 0),
        0,
      );
      const totalCostUsd = (parsed.modelUsage ?? []).reduce(
        (sum, item) => sum + (item.costUsd ?? 0),
        0,
      );
      const durationMs = Math.max(
        0,
        Date.parse(parsed.endedAt ?? "") - Date.parse(parsed.startedAt ?? ""),
      );
      const primaryModelPerformance =
        [...(parsed.modelPerformance ?? [])].sort(
          (a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0) || (b.calls ?? 0) - (a.calls ?? 0),
        )[0] ?? null;
      const primaryModelUsage =
        [...(parsed.modelUsage ?? [])].sort(
          (a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0) || (b.calls ?? 0) - (a.calls ?? 0),
        )[0] ?? null;
      if (!parsed.sessionId || !parsed.startedAt || !parsed.endedAt || !parsed.status) {
        continue;
      }
      entries.push({
        sessionId: parsed.sessionId,
        startedAt: parsed.startedAt,
        endedAt: parsed.endedAt,
        status: parsed.status,
        score: parsed.score?.score ?? 0,
        grade: parsed.score?.grade ?? "F",
        durationMs: Number.isFinite(durationMs) ? durationMs : 0,
        totalCalls,
        totalTokens,
        totalCostUsd,
        primaryModel:
          primaryModelPerformance?.model ??
          primaryModelUsage?.model ??
          "(unknown)",
        primaryModelScore: Number(
          (primaryModelPerformance?.score ?? 0).toFixed(1),
        ),
        primaryModelGrade: primaryModelPerformance?.grade ?? "N/A",
        archiveJsonFile: file,
        archiveMdFile: file.replace(/\.json$/, ".md"),
      });
    } catch {
      // Keep history generation best-effort.
    }
  }

  entries.sort(
    (a, b) =>
      new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime(),
  );

  await Promise.all([
    fs.writeFile(
      path.join(ralphDir, "coding-session-report-history.json"),
      JSON.stringify(entries, null, 2),
      "utf-8",
    ),
    fs.writeFile(
      path.join(ralphDir, "coding-session-report-history.md"),
      formatHistoryMarkdown(entries),
      "utf-8",
    ),
  ]);
}

async function readRepairEventSummary(
  outputDir: string,
  startedAt: string,
  endedAt: string,
): Promise<RepairEventSummary> {
  const filePath = path.join(outputDir, ".ralph", "repair-log.jsonl");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const byStage: Record<string, number> = {};
    const byEvent: Record<string, number> = {};
    const entries: RepairEventEntry[] = [];
    let totalEvents = 0;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as {
          stage?: string;
          event?: string;
          timestamp?: string;
          details?: Record<string, unknown>;
          missingIds?: string[];
          stillMissing?: string[];
          taskId?: string;
        };
        if (!isTimestampInRange(parsed.timestamp, startedAt, endedAt)) continue;
        totalEvents += 1;
        if (parsed.stage) byStage[parsed.stage] = (byStage[parsed.stage] ?? 0) + 1;
        if (parsed.event) byEvent[parsed.event] = (byEvent[parsed.event] ?? 0) + 1;
        if (parsed.stage && parsed.event) {
          entries.push({
            stage: parsed.stage,
            event: parsed.event,
            timestamp: parsed.timestamp,
            details: parsed.details,
            missingIds: parsed.missingIds,
            stillMissing: parsed.stillMissing,
            taskId: parsed.taskId,
          });
        }
      } catch {
        // Ignore malformed lines; report generation must stay best-effort.
      }
    }
    return { totalEvents, byStage, byEvent, entries };
  } catch {
    return { totalEvents: 0, byStage: {}, byEvent: {}, entries: [] };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

function toEndpointArray(
  value: unknown,
): Array<{ method: string; endpoint: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ method: string; endpoint: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { method?: unknown; endpoint?: unknown };
    if (typeof rec.method === "string" && typeof rec.endpoint === "string") {
      out.push({ method: rec.method, endpoint: rec.endpoint });
    }
  }
  return out;
}

function buildPreflightLedger(
  repairSummary: RepairEventSummary,
): PreflightAutomationLedger {
  const conventionAutofix: ConventionAutofixLedger = {
    invocations: 0,
    totalFixedFiles: 0,
    totalUnfixable: 0,
    notes: [],
    unfixable: [],
  };
  const routeAudit: RouteAuditLedger = { preflight: null, final: null };
  const importGap: ImportGapLedger = { totalPackages: 0, scopes: [] };
  const contractCompleteness: ContractCompletenessLedger = {
    postGenerate: null,
    preflight: null,
    final: null,
  };

  const toScopedMissing = (
    value: unknown,
  ): ContractCompletenessSnapshot["missingScopedEndpoints"] => {
    if (!Array.isArray(value)) return [];
    const out: ContractCompletenessSnapshot["missingScopedEndpoints"] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as {
        parent?: unknown;
        child?: unknown;
        expectedPath?: unknown;
        reason?: unknown;
      };
      if (
        typeof rec.parent === "string" &&
        typeof rec.child === "string" &&
        typeof rec.expectedPath === "string"
      ) {
        out.push({
          parent: rec.parent,
          child: rec.child,
          expectedPath: rec.expectedPath,
          reason: typeof rec.reason === "string" ? rec.reason : "",
        });
      }
    }
    return out;
  };

  for (const entry of repairSummary.entries) {
    const details = (entry.details ?? {}) as Record<string, unknown>;
    if (entry.event === "convention_autofix_applied") {
      conventionAutofix.invocations += 1;
      const fixedCount =
        typeof details.fixedFileCount === "number"
          ? details.fixedFileCount
          : 0;
      conventionAutofix.totalFixedFiles += fixedCount;
      const unfixable = toStringArray(details.unfixable);
      conventionAutofix.totalUnfixable += unfixable.length;
      conventionAutofix.notes.push(...toStringArray(details.notes));
      conventionAutofix.unfixable.push(...unfixable);
      continue;
    }
    if (entry.event === "route_audit_snapshot") {
      const snapshot: RouteAuditSnapshot = {
        when: details.when === "final" ? "final" : "preflight",
        hardFail: details.hardFail === true,
        unregisteredModules: toStringArray(details.unregisteredModules),
        unresolvedRegistrations: toStringArray(
          details.unresolvedRegistrations,
        ),
        missingContractEndpoints: toEndpointArray(
          details.missingContractEndpoints,
        ),
        undeclaredEndpointCount:
          typeof details.undeclaredEndpointCount === "number"
            ? details.undeclaredEndpointCount
            : 0,
      };
      if (snapshot.when === "final") {
        routeAudit.final = snapshot;
      } else {
        routeAudit.preflight = snapshot;
      }
      continue;
    }
    if (entry.event === "import_gaps_installed") {
      importGap.totalPackages +=
        typeof details.totalPackages === "number"
          ? details.totalPackages
          : 0;
      if (Array.isArray(details.scopes)) {
        for (const raw of details.scopes) {
          if (!raw || typeof raw !== "object") continue;
          const s = raw as {
            scope?: unknown;
            packages?: unknown;
            exitCode?: unknown;
          };
          importGap.scopes.push({
            scope: typeof s.scope === "string" ? s.scope : "(unknown)",
            packages: toStringArray(s.packages),
            exitCode: typeof s.exitCode === "number" ? s.exitCode : 0,
          });
        }
      }
      continue;
    }
    if (entry.event === "contract_completeness_snapshot") {
      const snapshot: ContractCompletenessSnapshot = {
        when:
          details.when === "post-generate"
            ? "post-generate"
            : details.when === "final"
              ? "final"
              : "preflight",
        inferredRelationshipCount:
          typeof details.inferredRelationshipCount === "number"
            ? details.inferredRelationshipCount
            : 0,
        missingScopedEndpoints: toScopedMissing(details.missingScopedEndpoints),
        hardFail: details.hardFail === true,
      };
      if (snapshot.when === "post-generate") {
        contractCompleteness.postGenerate = snapshot;
      } else if (snapshot.when === "final") {
        contractCompleteness.final = snapshot;
      } else {
        contractCompleteness.preflight = snapshot;
      }
    }
  }

  return {
    conventionAutofix,
    routeAudit,
    importGapInstalls: importGap,
    contractCompleteness,
  };
}

function buildDefectCategories(input: {
  ledger: PreflightAutomationLedger;
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  finalAudit?: FeatureChecklistAuditResult | null;
  gatesExecuted?: {
    integrationVerify: boolean;
    runtimeVerify: boolean;
    e2eVerify: boolean;
  };
}): DefectCategory[] {
  const categories: DefectCategory[] = [];
  const integrationRan = input.gatesExecuted?.integrationVerify === true;
  const integrationFailed = !!input.integrationErrors?.trim();

  // ── Dependency sync ────────────────────────────────────────────────────
  const depsEvidence: string[] = [];
  if (input.ledger.importGapInstalls.totalPackages > 0) {
    depsEvidence.push(
      `Auto-installed ${input.ledger.importGapInstalls.totalPackages} missing package(s) during preflight across ${input.ledger.importGapInstalls.scopes.length} scope(s).`,
    );
  }
  const depsGateFailed =
    integrationFailed &&
    /dependency consistency|dependency audit|Root package imports are missing/i.test(
      input.integrationErrors ?? "",
    );
  categories.push({
    key: "dependency-sync",
    label: "Dependency sync",
    state: !integrationRan
      ? "unknown"
      : depsGateFailed
        ? "fail"
        : input.ledger.importGapInstalls.totalPackages > 0
          ? "warn"
          : "pass",
    evidence: depsEvidence.length
      ? depsEvidence
      : ["No missing-import installs were needed."],
  });

  // ── Directory / implementation dedup ───────────────────────────────────
  const dedupEvidence: string[] = [];
  if (input.ledger.conventionAutofix.totalFixedFiles > 0) {
    dedupEvidence.push(
      `Convention auto-fix rewrote ${input.ledger.conventionAutofix.totalFixedFiles} file(s) across ${input.ledger.conventionAutofix.invocations} invocation(s).`,
    );
  }
  if (input.ledger.conventionAutofix.unfixable.length > 0) {
    dedupEvidence.push(
      `${input.ledger.conventionAutofix.unfixable.length} conflict(s) could not be auto-merged (both canonical and residual paths existed).`,
    );
  }
  categories.push({
    key: "directory-dedup",
    label: "Directory / implementation dedup",
    state:
      input.ledger.conventionAutofix.unfixable.length > 0
        ? "warn"
        : input.ledger.conventionAutofix.totalFixedFiles > 0
          ? "pass"
          : "pass",
    evidence: dedupEvidence.length
      ? dedupEvidence
      : ["No convention violations needed to be auto-fixed."],
  });

  // ── Env alignment ──────────────────────────────────────────────────────
  const envGateFailed =
    integrationFailed &&
    /DATABASE_URL|\.env|env\(|CORS_ORIGIN|JWT_SECRET/.test(
      input.integrationErrors ?? "",
    );
  categories.push({
    key: "env-alignment",
    label: "Env variable alignment",
    state: !integrationRan ? "unknown" : envGateFailed ? "fail" : "pass",
    evidence: envGateFailed
      ? ["Integration gate error text references env variables — inspect it."]
      : [
          "No env alignment signal — generator injected DATABASE_URL defaults and no gate flagged env drift.",
        ],
  });

  // ── API contract consistency ──────────────────────────────────────────
  const routeAudit = input.ledger.routeAudit;
  const routeEvidence: string[] = [];
  if (routeAudit.preflight) {
    routeEvidence.push(
      `Preflight: ${routeAudit.preflight.unregisteredModules.length} unregistered module(s), ${routeAudit.preflight.missingContractEndpoints.length} missing contract endpoint(s), ${routeAudit.preflight.unresolvedRegistrations.length} dangling registration import(s).`,
    );
  }
  if (routeAudit.final) {
    routeEvidence.push(
      `Final gate: ${routeAudit.final.unregisteredModules.length} unregistered, ${routeAudit.final.missingContractEndpoints.length} missing contract, ${routeAudit.final.unresolvedRegistrations.length} dangling${routeAudit.final.hardFail ? " (HARD FAIL)" : ""}.`,
    );
  }
  const contractState: DefectGateState = !integrationRan
    ? "unknown"
    : routeAudit.final?.hardFail
      ? "fail"
      : routeAudit.preflight &&
          (routeAudit.preflight.unregisteredModules.length > 0 ||
            routeAudit.preflight.missingContractEndpoints.length > 0 ||
            routeAudit.preflight.unresolvedRegistrations.length > 0)
        ? "warn"
        : "pass";
  categories.push({
    key: "contract-consistency",
    label: "API contract consistency",
    state: contractState,
    evidence: routeEvidence.length
      ? routeEvidence
      : [
          "No route audit snapshots captured — either the project has no backend or integration verify did not run.",
        ],
  });

  // ── API contract completeness (PRD → model → scoped-endpoint) ──────────
  const completeness = input.ledger.contractCompleteness;
  const completenessEvidence: string[] = [];
  const anyCompletenessSnapshot =
    completeness.postGenerate ??
    completeness.preflight ??
    completeness.final ??
    null;
  if (completeness.postGenerate) {
    completenessEvidence.push(
      `Post-generate: ${completeness.postGenerate.inferredRelationshipCount} ORM relationship(s), ${completeness.postGenerate.missingScopedEndpoints.length} scoped endpoint(s) missing.`,
    );
  }
  if (completeness.preflight) {
    completenessEvidence.push(
      `Preflight: ${completeness.preflight.inferredRelationshipCount} relationship(s), ${completeness.preflight.missingScopedEndpoints.length} missing.`,
    );
  }
  if (completeness.final) {
    completenessEvidence.push(
      `Final gate: ${completeness.final.missingScopedEndpoints.length} missing${completeness.final.hardFail ? " (HARD FAIL)" : ""}.`,
    );
    if (completeness.final.missingScopedEndpoints.length > 0) {
      completenessEvidence.push(
        `  e.g. ${completeness.final.missingScopedEndpoints
          .slice(0, 3)
          .map((m) => m.expectedPath)
          .join(", ")}`,
      );
    }
  }
  const completenessState: DefectGateState = !anyCompletenessSnapshot
    ? "unknown"
    : completeness.final?.hardFail
      ? "fail"
      : (completeness.preflight?.missingScopedEndpoints.length ?? 0) > 0
        ? "warn"
        : "pass";
  categories.push({
    key: "contract-completeness",
    label: "API contract completeness (ORM-derived)",
    state: completenessState,
    evidence: completenessEvidence.length
      ? completenessEvidence
      : [
          "No ORM relationships detected (or no backend). Nothing to audit for scoped-list endpoints.",
        ],
  });

  // ── Build verification ────────────────────────────────────────────────
  const buildEvidence: string[] = [];
  if (input.integrationErrors?.trim()) {
    const tscErrors =
      (input.integrationErrors.match(/error TS\d+/g) ?? []).length;
    if (tscErrors > 0) {
      buildEvidence.push(`${tscErrors} TS error line(s) in integration output.`);
    }
    if (/build failed/i.test(input.integrationErrors)) {
      buildEvidence.push("Build command reported failure during integration.");
    }
  }
  if (input.runtimeVerifyErrors?.trim()) {
    buildEvidence.push("Runtime verify reported blocking errors.");
  }
  const buildState: DefectGateState = !integrationRan
    ? "unknown"
    : integrationFailed || input.runtimeVerifyErrors?.trim()
      ? "fail"
      : "pass";
  categories.push({
    key: "build-verification",
    label: "Build & runtime verification",
    state: buildState,
    evidence: buildEvidence.length
      ? buildEvidence
      : ["Integration and runtime gates produced no blocking output."],
  });

  return categories;
}

/**
 * Resolve the generator repo's short git SHA so reports are attributable to a
 * specific generator commit.
 *
 * The original implementation used `path.resolve(__dirname, "..", "..", ...)`,
 * which broke once Next.js built the server bundle into `.next/server/chunks`
 * — `__dirname` no longer sits inside the repo. We now walk up from
 * `process.cwd()` looking for a `.git` directory, then run git there.
 *
 * Returns `null` when no `.git` is found within 6 levels, when `git` is not
 * on PATH, or when the command fails — the report renders `(unknown)` in that
 * case rather than blocking report generation.
 */
async function resolveGeneratorGitSha(): Promise<string | null> {
  async function findGitRoot(start: string): Promise<string | null> {
    let current = path.resolve(start);
    for (let depth = 0; depth < 6; depth += 1) {
      try {
        const stat = await fs.stat(path.join(current, ".git"));
        if (stat.isDirectory() || stat.isFile()) return current;
      } catch {
        // keep walking
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  const envHint = process.env.AGENTIC_BUILDER_ROOT?.trim();
  const candidateStarts = [envHint, process.cwd()].filter(
    (x): x is string => !!x && x.length > 0,
  );

  for (const start of candidateStarts) {
    const root = await findGitRoot(start);
    if (!root) continue;
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["rev-parse", "--short", "HEAD"],
        { cwd: root, timeout: 5_000 },
      );
      const sha = stdout.trim();
      if (sha) return sha;
    } catch {
      // Try the next candidate start path.
    }
  }

  return null;
}

function aggregateModelUsage(
  usage: CodingSessionLlmUsageEvent[],
): AggregatedModelUsage[] {
  const map = new Map<string, AggregatedModelUsage>();
  for (const event of usage) {
    const current = map.get(event.model) ?? {
      model: event.model,
      calls: 0,
      costUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      stages: [],
    };
    current.calls += 1;
    current.costUsd += event.costUsd;
    current.promptTokens += event.promptTokens;
    current.completionTokens += event.completionTokens;
    current.totalTokens += event.totalTokens;
    const stageLabel = event.label ? `${event.stage}:${event.label}` : event.stage;
    if (!current.stages.includes(stageLabel)) current.stages.push(stageLabel);
    map.set(event.model, current);
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

function aggregateStageUsage(input: {
  usage: CodingSessionLlmUsageEvent[];
  repairSummary: RepairEventSummary;
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  finalAudit?: FeatureChecklistAuditResult | null;
  taskResults: AuditTaskSummary[];
}): StageUsageSummary[] {
  const stageNames = new Set<string>();
  for (const event of input.usage) stageNames.add(event.stage);
  for (const entry of input.repairSummary.entries) stageNames.add(entry.stage);

  const warningTasks = input.taskResults.filter(
    (task) => task.status === "completed_with_warnings",
  ).length;
  const failedTasks = input.taskResults.filter((task) => task.status === "failed").length;

  const results: StageUsageSummary[] = [];
  for (const stage of stageNames) {
    const usageEvents = input.usage.filter((event) => event.stage === stage);
    const repairEntries = input.repairSummary.entries.filter((entry) => entry.stage === stage);
    const timestamps = [...usageEvents.map((event) => event.timestamp), ...repairEntries.map((entry) => entry.timestamp)]
      .map((value) => (value ? Date.parse(value) : Number.NaN))
      .filter((value) => !Number.isNaN(value))
      .sort((a, b) => a - b);

    const startAt = timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null;
    const endAt =
      timestamps.length > 0
        ? new Date(timestamps[timestamps.length - 1]).toISOString()
        : null;
    const durationMs =
      timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;

    const docTruncated = repairEntries.filter((entry) => entry.event === "doc_truncated").length;
    const truncationDetected = repairEntries.filter(
      (entry) => entry.event === "truncation_detected",
    ).length;
    const taskPlanUnfulfilled = repairEntries.filter(
      (entry) => entry.event === "task_plan_unfulfilled",
    ).length;
    const stagnationWarnings = repairEntries.filter(
      (entry) => entry.event === "stagnation_warning",
    ).length;
    const unresolvedIds = Math.max(
      0,
      ...repairEntries.map((entry) => entry.stillMissing?.length ?? 0),
      input.finalAudit && stage === "post-gen-audit"
        ? input.finalAudit.uncovered.length
        : 0,
    );

    let score = 100;
    const reasons: string[] = [];
    if (docTruncated > 0 || truncationDetected > 0) {
      const count = docTruncated + truncationDetected;
      score -= Math.min(24, count * 6);
      reasons.push(`Context was truncated ${count} time(s).`);
    }
    if (taskPlanUnfulfilled > 0) {
      score -= Math.min(32, taskPlanUnfulfilled * 8);
      reasons.push(`Task/file plan mismatches happened ${taskPlanUnfulfilled} time(s).`);
    }
    if (stagnationWarnings > 0) {
      score -= Math.min(36, stagnationWarnings * 10);
      reasons.push(`Stagnation warnings triggered ${stagnationWarnings} time(s).`);
    }
    if (stage === "worker_codegen" && warningTasks > 0) {
      score -= Math.min(15, warningTasks * 4);
      reasons.push(`${warningTasks} generated task(s) completed with warnings.`);
    }
    if (stage === "worker_codegen" && failedTasks > 0) {
      score -= Math.min(20, failedTasks * 6);
      reasons.push(`${failedTasks} generated task(s) failed.`);
    }
    if (stage === "integration_verify_fix" && input.integrationErrors?.trim()) {
      score -= 28;
      reasons.push("Stage ended with blocking integration errors.");
    }
    if (stage === "phase_verify_fix" && input.integrationErrors?.trim()) {
      score -= 10;
      reasons.push("Earlier phase verify/fix did not fully prevent later integration failures.");
    }
    if (stage === "e2e_source_repair" && input.e2eVerifyErrors?.trim()) {
      score -= 20;
      reasons.push("E2E source repair still left blocking e2e errors.");
    }
    if (stage === "post-gen-audit" && unresolvedIds > 0) {
      score -= Math.min(45, unresolvedIds);
      reasons.push(`${unresolvedIds} requirement id(s) remained unresolved after audit.`);
    }
    if (stage === "runtime_verify" && input.runtimeVerifyErrors?.trim()) {
      score -= 20;
      reasons.push("Runtime verification still had blocking errors.");
    }

    score = clampScore(score);
    results.push({
      stage,
      startAt,
      endAt,
      durationMs,
      llmCalls: usageEvents.length,
      promptTokens: usageEvents.reduce((sum, event) => sum + event.promptTokens, 0),
      completionTokens: usageEvents.reduce(
        (sum, event) => sum + event.completionTokens,
        0,
      ),
      totalTokens: usageEvents.reduce((sum, event) => sum + event.totalTokens, 0),
      costUsd: usageEvents.reduce((sum, event) => sum + event.costUsd, 0),
      models: [...new Set(usageEvents.map((event) => event.model))],
      labels: [...new Set(usageEvents.map((event) => event.label).filter(Boolean) as string[])],
      repairEvents: repairEntries.length,
      score,
      grade: scoreToGrade(score),
      reasons: summarizeReasonList(reasons),
    });
  }

  return results.sort((a, b) => {
    const aTime = a.startAt ? Date.parse(a.startAt) : Number.MAX_SAFE_INTEGER;
    const bTime = b.startAt ? Date.parse(b.startAt) : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function aggregateModelPerformance(input: {
  usage: CodingSessionLlmUsageEvent[];
  stageUsage: StageUsageSummary[];
}): ModelPerformanceSummary[] {
  const stageMap = new Map(input.stageUsage.map((stage) => [stage.stage, stage]));
  const map = new Map<string, ModelPerformanceSummary>();

  for (const event of input.usage) {
    const current = map.get(event.model) ?? {
      model: event.model,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      stages: [],
      score: 0,
      grade: "F",
      reasons: [],
    };
    current.calls += 1;
    current.promptTokens += event.promptTokens;
    current.completionTokens += event.completionTokens;
    current.totalTokens += event.totalTokens;
    current.costUsd += event.costUsd;
    if (!current.stages.includes(event.stage)) current.stages.push(event.stage);
    map.set(event.model, current);
  }

  for (const current of map.values()) {
    const modelEvents = input.usage.filter((event) => event.model === current.model);
    let weightedScore = 0;
    let weightTotal = 0;
    const reasons = new Set<string>();

    for (const stage of current.stages) {
      const stageSummary = stageMap.get(stage);
      if (!stageSummary) continue;
      const stageTokens = modelEvents
        .filter((event) => event.stage === stage)
        .reduce((sum, event) => sum + Math.max(event.totalTokens, 1), 0);
      const weight = stageTokens > 0 ? stageTokens : 1;
      weightedScore += stageSummary.score * weight;
      weightTotal += weight;
      for (const reason of stageSummary.reasons) {
        if (reason !== "No strong negative signal captured.") reasons.add(reason);
      }
    }

    const score = clampScore(
      weightTotal > 0 ? weightedScore / weightTotal : 100,
    );
    current.score = Number(score.toFixed(1));
    current.grade = scoreToGrade(score);
    current.reasons = summarizeReasonList([...reasons]);
  }

  return [...map.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls,
  );
}

/**
 * E2E telemetry parsed from the gate's plain-text output. The supervisor
 * doesn't expose a structured object, so we sniff the well-known patterns
 * Playwright + e2e-triage emit (`X failed`, `X passed`, `triage: A deterministic, B flaky, C infra`).
 * All counts default to 0 when the corresponding line is absent.
 */
interface E2eTelemetry {
  failed: number;
  passed: number;
  total: number;
  /** True when triage classified the failure as pure infra and zero deterministic. */
  pureInfra: boolean;
  deterministic: number;
  flaky: number;
  infra: number;
}

function parseE2eTelemetry(errorBlob: string | undefined): E2eTelemetry {
  const out: E2eTelemetry = {
    failed: 0,
    passed: 0,
    total: 0,
    pureInfra: false,
    deterministic: 0,
    flaky: 0,
    infra: 0,
  };
  if (!errorBlob) return out;
  // Playwright lines are wrapped in ANSI; strip them before matching.
  const plain = errorBlob.replace(/\x1b\[[0-9;]*m/g, "");

  const failedMatch = plain.match(/(\d+)\s+failed/i);
  if (failedMatch) out.failed = parseInt(failedMatch[1], 10);
  const passedMatch = plain.match(/(\d+)\s+passed/i);
  if (passedMatch) out.passed = parseInt(passedMatch[1], 10);
  out.total = out.failed + out.passed;

  const triageMatch = plain.match(
    /triage:\s*(\d+)\s*deterministic,\s*(\d+)\s*flaky,\s*(\d+)\s*infra/i,
  );
  if (triageMatch) {
    out.deterministic = parseInt(triageMatch[1], 10);
    out.flaky = parseInt(triageMatch[2], 10);
    out.infra = parseInt(triageMatch[3], 10);
    out.pureInfra =
      out.deterministic === 0 && out.flaky === 0 && out.infra > 0;
  }
  return out;
}

interface ScoreLine {
  /** Negative for penalty, positive for bonus. */
  delta: number;
  /** Short label used in the readable formula; e.g. "fail status". */
  label: string;
  /** Long-form reason printed in the bullet list. */
  reason: string;
}

/**
 * Coding session score calculator (v2).
 *
 * Design goals (vs v1):
 *  1. **No double-jeopardy on fail status.** The 20-point fail penalty already
 *     reflects "something went wrong"; we no longer also subtract a flat 20
 *     for the *specific* gate that triggered it. Instead the gate penalty is
 *     proportional to how broken the gate actually is (e2e pass-rate, gate
 *     count, etc.), so a run that passes 5/6 e2e specs scores far higher than
 *     one that fails all 6.
 *  2. **E2E penalty scales with pass-rate.** -25 * (failed/total).
 *  3. **Pure-infra e2e failure is forgiven.** If e2e-triage flagged the
 *     failure as 0 deterministic / 0 flaky / N infra, the e2e penalty is
 *     halved (the code is fine, the runtime/host wasn't).
 *  4. **Completion bonus.** When all coding tasks completed and every quality
 *     gate that was attempted produced no blocking output, +5. Encourages the
 *     "almost everything works" outcome instead of treating it identically to
 *     "everything broke".
 *  5. **Self-explanatory formula.** Returns a one-line breakdown like
 *     `100 − 20(fail) − 16(e2e:5/6 failed × 0.5 infra) − 4(trunc) = 60` so the
 *     reader doesn't have to reverse-engineer the report.
 */
function scoreCodingSession(input: {
  status: "pass" | "fail" | "aborted";
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  uncoveredCount: number;
  taskResults: AuditTaskSummary[];
  repairSummary: RepairEventSummary;
}): ScoreBreakdown {
  const lines: ScoreLine[] = [];

  const isFail = input.status !== "pass";
  if (isFail) {
    const delta = input.status === "aborted" ? -30 : -20;
    lines.push({
      delta,
      label: input.status === "aborted" ? "aborted" : "fail",
      reason: `Run status is ${input.status}.`,
    });
  }

  const integrationFailed = !!input.integrationErrors?.trim();
  const runtimeFailed = !!input.runtimeVerifyErrors?.trim();
  const e2eErrors = input.e2eVerifyErrors?.trim();
  const e2eTel = parseE2eTelemetry(e2eErrors);

  // Gate penalties — when run status is fail we already paid 20 above, so
  // skipping a flat per-gate penalty avoids double-counting. We still scale
  // by *how badly* each gate failed so partial successes get credit.
  if (integrationFailed) {
    // Integration is binary (no useful sub-metric in the blob), so apply a
    // smaller flat penalty: half of the legacy -20.
    const delta = isFail ? -10 : -20;
    lines.push({
      delta,
      label: "integration",
      reason: "Integration verification still has blocking errors.",
    });
  }
  if (runtimeFailed) {
    const delta = isFail ? -8 : -15;
    lines.push({
      delta,
      label: "runtime",
      reason: "Runtime verification still has blocking errors.",
    });
  }
  if (e2eErrors) {
    const e2eMaxPenalty = isFail ? 20 : 25;
    const passRatio =
      e2eTel.total > 0 ? e2eTel.failed / e2eTel.total : 1;
    let delta = -Math.round(e2eMaxPenalty * passRatio);
    let detail =
      e2eTel.total > 0
        ? `e2e:${e2eTel.failed}/${e2eTel.total} failed`
        : "e2e:blocking errors";
    if (e2eTel.pureInfra) {
      delta = Math.round(delta / 2);
      detail += " ×0.5 infra";
    }
    if (delta === 0 && e2eTel.total > 0) {
      // Edge case: 0 failed but errors string non-empty — no penalty.
    } else {
      lines.push({
        delta,
        label: detail,
        reason:
          e2eTel.total > 0
            ? `E2E gate: ${e2eTel.failed} failed / ${e2eTel.passed} passed${
                e2eTel.pureInfra
                  ? " (triage flagged infra-only — penalty halved)"
                  : ""
              }.`
            : "E2E verification still has blocking errors.",
      });
    }
  }

  if (input.uncoveredCount > 0) {
    const delta = -Math.min(25, input.uncoveredCount);
    lines.push({
      delta,
      label: `uncovered:${input.uncoveredCount}`,
      reason: `${input.uncoveredCount} PRD requirement id(s) remain uncovered.`,
    });
  }

  const failedTasks = input.taskResults.filter(
    (task) => task.status === "failed",
  ).length;
  if (failedTasks > 0) {
    lines.push({
      delta: -Math.min(15, failedTasks * 5),
      label: `tasks-failed:${failedTasks}`,
      reason: `${failedTasks} coding task(s) failed.`,
    });
  }

  const unknownTasks = input.taskResults.filter(
    (task) => task.status === "unknown",
  ).length;
  if (unknownTasks > 0) {
    lines.push({
      delta: -Math.min(10, unknownTasks * 2),
      label: `tasks-unknown:${unknownTasks}`,
      reason: `${unknownTasks} coding task(s) never produced a final status.`,
    });
  }

  const truncationSignals = input.repairSummary.byEvent.doc_truncated ?? 0;
  if (truncationSignals > 0) {
    lines.push({
      delta: -Math.min(8, truncationSignals * 2),
      label: `trunc:${truncationSignals}`,
      reason: `Context truncation happened ${truncationSignals} time(s).`,
    });
  }

  const planUnfulfilledSignals =
    input.repairSummary.byEvent.task_plan_unfulfilled ?? 0;
  if (planUnfulfilledSignals > 0) {
    lines.push({
      delta: -Math.min(8, planUnfulfilledSignals * 2),
      label: `plan-unfulfilled:${planUnfulfilledSignals}`,
      reason: `Task plan/file-plan mismatches happened ${planUnfulfilledSignals} time(s).`,
    });
  }

  // Completion bonus — applied last, after all penalties are determined.
  const totalTasks = input.taskResults.length;
  const completedTasks = input.taskResults.filter(
    (task) => task.status === "completed",
  ).length;
  const allTasksDone = totalTasks > 0 && completedTasks === totalTasks;
  const noBlockingGates =
    !integrationFailed &&
    !runtimeFailed &&
    (e2eTel.total === 0 || e2eTel.failed === 0 || e2eTel.pureInfra);
  if (allTasksDone && noBlockingGates && input.uncoveredCount === 0) {
    lines.push({
      delta: +5,
      label: "all-tasks-done",
      reason: `Bonus: all ${totalTasks} coding task(s) completed and no code-bug gate failed.`,
    });
  }

  let runningTotal = 100;
  for (const ln of lines) runningTotal += ln.delta;
  const score = clampScore(runningTotal);
  const grade = scoreToGrade(score);

  // Build a one-line readable formula. e.g.
  //   "100 − 20(fail) − 16(e2e:5/6 failed ×0.5 infra) − 4(trunc:2) = 60"
  const formulaParts: string[] = ["100"];
  for (const ln of lines) {
    const sign = ln.delta < 0 ? "−" : "+";
    formulaParts.push(`${sign} ${Math.abs(ln.delta)}(${ln.label})`);
  }
  formulaParts.push(`= ${score}`);
  const formula = formulaParts.join(" ");

  const reasons: string[] = [`Score formula: ${formula}`];
  for (const ln of lines) reasons.push(ln.reason);

  return { score, grade, reasons };
}

function buildImprovementSuggestions(input: {
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  finalAudit?: FeatureChecklistAuditResult | null;
  repairSummary: RepairEventSummary;
  llmUsage: AggregatedModelUsage[];
}): string[] {
  const suggestions: string[] = [];
  if (input.finalAudit && !input.finalAudit.passed) {
    suggestions.push(
      "Strengthen requirement coverage closure: improve task breakdown coverage and keep feature audit as a hard pass gate until uncovered ids reach zero.",
    );
  }
  if ((input.repairSummary.byEvent.doc_truncated ?? 0) > 0) {
    suggestions.push(
      "Reduce context loss: improve section selection / budget allocation so critical PRD and implementation context is not truncated.",
    );
  }
  if ((input.repairSummary.byEvent.task_plan_unfulfilled ?? 0) > 0) {
    suggestions.push(
      "Tighten task-to-file planning: the worker should either write the planned files or immediately repair the missing file-plan deltas.",
    );
  }
  if (input.integrationErrors?.includes("Dependency consistency gate failed")) {
    suggestions.push(
      "Strengthen dependency alignment: enforce import/package.json consistency before final verification starts, not only at the end.",
    );
  }
  if (input.integrationErrors?.trim()) {
    suggestions.push(
      "Improve final integration convergence: prioritize the highest-signal failing gate first and keep stagnation detection enabled to avoid read-only loops.",
    );
  }
  if (input.runtimeVerifyErrors?.trim()) {
    suggestions.push(
      "Improve runtime readiness: add stronger startup health checks and env/config normalization before runtime verification.",
    );
  }
  if (input.e2eVerifyErrors?.trim()) {
    suggestions.push(
      "Improve end-to-end reliability: keep smoke/e2e scenarios aligned with PRD flows and feed deterministic failure context back into source repair.",
    );
  }
  const expensiveModels = input.llmUsage.filter((entry) => entry.costUsd > 0.02);
  if (expensiveModels.length > 0) {
    suggestions.push(
      "Optimize model spend: reduce repeated high-cost iterations by improving preflight checks, duplicate-file cleanup, and stricter early gates.",
    );
  }
  if (suggestions.length === 0) {
    suggestions.push(
      "Keep iterating on stricter preflight checks and report quality, but the current run data does not show an obvious systemic bottleneck.",
    );
  }
  return suggestions;
}

function formatMarkdownReport(input: {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  status: "pass" | "fail" | "aborted";
  terminalSummary: string;
  score: ScoreBreakdown;
  modelUsage: AggregatedModelUsage[];
  modelPerformance: ModelPerformanceSummary[];
  stageUsage: StageUsageSummary[];
  taskResults: AuditTaskSummary[];
  fileRegistry: GeneratedFile[];
  repairSummary: RepairEventSummary;
  finalAudit?: FeatureChecklistAuditResult | null;
  fatalError?: string;
  suggestions: string[];
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  preflightLedger: PreflightAutomationLedger;
  defectCategories: DefectCategory[];
  scaffoldFixAttempts?: number;
  integrationFixAttempts?: number;
  gatesExecuted?: {
    integrationVerify: boolean;
    runtimeVerify: boolean;
    e2eVerify: boolean;
  };
  generatorGitSha?: string | null;
}): string {
  const completed = input.taskResults.filter((task) => task.status === "completed").length;
  const warnings = input.taskResults.filter(
    (task) => task.status === "completed_with_warnings",
  ).length;
  const failed = input.taskResults.filter((task) => task.status === "failed").length;
  const unknown = input.taskResults.filter((task) => task.status === "unknown").length;
  const totalCostUsd = input.modelUsage.reduce((sum, entry) => sum + entry.costUsd, 0);
  const totalCalls = input.modelUsage.reduce((sum, entry) => sum + entry.calls, 0);
  const totalTokens = input.modelUsage.reduce((sum, entry) => sum + entry.totalTokens, 0);
  const uncoveredIds = input.finalAudit?.uncovered.map((entry) => entry.id) ?? [];

  const lines: string[] = [
    "# Coding Session Report",
    "",
    `- Session ID: \`${input.sessionId}\``,
    `- Status: **${input.status.toUpperCase()}**`,
    `- Score: **${input.score.score}/100 (${input.score.grade})**`,
    `- Started at: ${input.startedAt}`,
    `- Ended at: ${input.endedAt}`,
    `- Generator git: \`${input.generatorGitSha ?? "(unknown)"}\``,
    `- Scaffold fix attempts: ${input.scaffoldFixAttempts ?? 0}`,
    `- Integration fix attempts: ${input.integrationFixAttempts ?? 0}`,
    `- Total LLM calls: ${totalCalls}`,
    `- Total LLM tokens: ${totalTokens}`,
    `- Total LLM cost: $${totalCostUsd.toFixed(4)}`,
    `- Generated/known files in registry: ${input.fileRegistry.length}`,
    "",
    "## Summary",
    input.terminalSummary || "(no terminal summary captured)",
    "",
  ];

  if (input.fatalError) {
    lines.push("## Fatal Error", input.fatalError, "");
  }

  lines.push(
    "## Task Outcome",
    `- Completed: ${completed}`,
    `- Completed with warnings: ${warnings}`,
    `- Failed: ${failed}`,
    `- Unknown: ${unknown}`,
    "",
  );

  lines.push(
    "## Scoring Notes",
    ...input.score.reasons.map((reason) => `- ${reason}`),
    "",
  );

  lines.push("## Model Usage");
  if (input.modelUsage.length === 0) {
    lines.push("- No LLM usage events were captured for this run.", "");
  } else {
    for (const usage of input.modelUsage) {
      lines.push(
        `- \`${usage.model}\`: calls=${usage.calls}, cost=$${usage.costUsd.toFixed(4)}, tokens=${usage.totalTokens}, stages=${usage.stages.join(", ")}`,
      );
    }
    lines.push("");
  }

  lines.push("## Stage Diagnostics");
  if (input.stageUsage.length === 0) {
    lines.push("- No stage-level telemetry could be derived for this run.", "");
  } else {
    for (const stage of input.stageUsage) {
      lines.push(
        `- \`${stage.stage}\`: duration=${formatDuration(stage.durationMs)}, calls=${stage.llmCalls}, tokens=${stage.totalTokens} (prompt=${stage.promptTokens}, completion=${stage.completionTokens}), cost=$${stage.costUsd.toFixed(4)}, score=${stage.score}/100 (${stage.grade}), models=${stage.models.join(", ") || "(none)"}`,
      );
      if (stage.labels.length > 0) {
        lines.push(`  labels=${stage.labels.join(", ")}`);
      }
      lines.push(`  notes=${stage.reasons.join(" | ")}`);
    }
    lines.push("");
  }

  lines.push("## Model Effectiveness");
  if (input.modelPerformance.length === 0) {
    lines.push("- No model effectiveness telemetry could be derived for this run.", "");
  } else {
    for (const model of input.modelPerformance) {
      lines.push(
        `- \`${model.model}\`: score=${model.score}/100 (${model.grade}), calls=${model.calls}, tokens=${model.totalTokens}, cost=$${model.costUsd.toFixed(4)}, stages=${model.stages.join(", ")}`,
      );
      lines.push(`  notes=${model.reasons.join(" | ")}`);
    }
    lines.push("");
  }

  const gateState = (
    executed: boolean | undefined,
    errors: string | undefined,
  ): "PASS" | "FAIL" | "SKIPPED" => {
    if (errors?.trim()) return "FAIL";
    if (!executed) return "SKIPPED";
    return "PASS";
  };

  lines.push("## Quality Gates");
  lines.push(
    `- Integration verify: ${gateState(input.gatesExecuted?.integrationVerify, input.integrationErrors)}`,
  );
  lines.push(
    `- Runtime verify: ${gateState(input.gatesExecuted?.runtimeVerify, input.runtimeVerifyErrors)}`,
  );
  lines.push(
    `- E2E verify: ${gateState(input.gatesExecuted?.e2eVerify, input.e2eVerifyErrors)}`,
  );
  lines.push(
    `- Feature audit: ${
      input.finalAudit
        ? input.finalAudit.passed
          ? "PASS"
          : `FAIL (${uncoveredIds.length} uncovered)`
        : "SKIPPED"
    }`,
  );
  lines.push("");

  if (input.integrationErrors?.trim()) {
    lines.push("### Integration Errors", "```", input.integrationErrors.trim(), "```", "");
  }
  if (input.runtimeVerifyErrors?.trim()) {
    lines.push("### Runtime Verify Errors", "```", input.runtimeVerifyErrors.trim(), "```", "");
  }
  if (input.e2eVerifyErrors?.trim()) {
    lines.push("### E2E Verify Errors", "```", input.e2eVerifyErrors.trim(), "```", "");
  }

  lines.push("## Feature Audit");
  if (!input.finalAudit) {
    lines.push("- No final audit snapshot captured.", "");
  } else if (input.finalAudit.passed) {
    lines.push("- All audited requirement ids are covered.", "");
  } else {
    lines.push(
      `- Uncovered ids (${uncoveredIds.length}): ${uncoveredIds.join(", ") || "(none listed)"}`,
      "",
    );
  }

  // ── Preflight Automation Ledger ────────────────────────────────────────
  lines.push("## Preflight Automation Ledger");
  const { conventionAutofix, routeAudit, importGapInstalls } =
    input.preflightLedger;
  lines.push("### Convention auto-fix");
  if (conventionAutofix.invocations === 0) {
    lines.push("- Not invoked this run.");
  } else {
    lines.push(
      `- Invocations: ${conventionAutofix.invocations} | files rewritten: ${conventionAutofix.totalFixedFiles} | unfixable conflicts: ${conventionAutofix.totalUnfixable}`,
    );
    for (const note of conventionAutofix.notes.slice(0, 8)) {
      lines.push(`  - ${note}`);
    }
    if (conventionAutofix.unfixable.length > 0) {
      lines.push("  - Unfixable:");
      for (const u of conventionAutofix.unfixable.slice(0, 8)) {
        lines.push(`    - ${u}`);
      }
    }
  }

  lines.push("### Missing-import installs");
  if (importGapInstalls.totalPackages === 0) {
    lines.push("- No missing packages needed to be installed during preflight.");
  } else {
    lines.push(
      `- Auto-installed ${importGapInstalls.totalPackages} package(s) across ${importGapInstalls.scopes.length} scope(s).`,
    );
    for (const scope of importGapInstalls.scopes) {
      lines.push(
        `  - \`${scope.scope}\` (exit=${scope.exitCode}): ${scope.packages.join(", ") || "(none)"}`,
      );
    }
  }

  lines.push("### Route registration audit");
  const renderRouteSnapshot = (
    label: string,
    snapshot: RouteAuditSnapshot | null,
  ): void => {
    if (!snapshot) {
      lines.push(`- ${label}: not captured.`);
      return;
    }
    lines.push(
      `- ${label}: ${snapshot.hardFail ? "HARD FAIL" : "clean"} (unregistered=${snapshot.unregisteredModules.length}, dangling=${snapshot.unresolvedRegistrations.length}, missingContracts=${snapshot.missingContractEndpoints.length}, undeclaredImplemented=${snapshot.undeclaredEndpointCount})`,
    );
    for (const m of snapshot.unregisteredModules.slice(0, 6)) {
      lines.push(`    - unregistered: ${m}`);
    }
    for (const m of snapshot.unresolvedRegistrations.slice(0, 6)) {
      lines.push(`    - dangling: ${m}`);
    }
    for (const m of snapshot.missingContractEndpoints.slice(0, 8)) {
      lines.push(`    - missing contract endpoint: ${m.method} ${m.endpoint}`);
    }
  };
  renderRouteSnapshot("Preflight", routeAudit.preflight);
  renderRouteSnapshot("Final", routeAudit.final);

  lines.push("### Contract completeness audit (ORM-derived)");
  const completeness = input.preflightLedger.contractCompleteness;
  const renderCompletenessSnapshot = (
    label: string,
    snapshot: ContractCompletenessSnapshot | null,
  ): void => {
    if (!snapshot) {
      lines.push(`- ${label}: not captured.`);
      return;
    }
    lines.push(
      `- ${label}: ${snapshot.hardFail ? "HARD FAIL" : snapshot.missingScopedEndpoints.length > 0 ? "warn" : "clean"} (relationships=${snapshot.inferredRelationshipCount}, missingScoped=${snapshot.missingScopedEndpoints.length})`,
    );
    for (const m of snapshot.missingScopedEndpoints.slice(0, 8)) {
      lines.push(
        `    - ${m.expectedPath} — ${m.parent}.hasMany(${m.child})`,
      );
    }
  };
  renderCompletenessSnapshot("Post-generate", completeness.postGenerate);
  renderCompletenessSnapshot("Preflight", completeness.preflight);
  renderCompletenessSnapshot("Final", completeness.final);
  lines.push("");

  // ── Defect Category Summary ────────────────────────────────────────────
  lines.push("## Defect Category Summary");
  lines.push(
    "Each category aggregates audit results relevant to the 5 ways generated code typically fails to 'just run'.",
  );
  lines.push("");
  lines.push("| Category | State | Evidence |");
  lines.push("| --- | --- | --- |");
  for (const cat of input.defectCategories) {
    const stateLabel =
      cat.state === "pass"
        ? "✅ PASS"
        : cat.state === "fail"
          ? "❌ FAIL"
          : cat.state === "warn"
            ? "⚠️ WARN"
            : "— UNKNOWN";
    const evidenceCell =
      cat.evidence.length > 0
        ? cat.evidence.join("<br/>").replace(/\|/g, "\\|")
        : "(none)";
    lines.push(`| ${cat.label} | ${stateLabel} | ${evidenceCell} |`);
  }
  lines.push("");

  lines.push("## Repair / Self-Heal Telemetry");
  lines.push(`- Total repair events: ${input.repairSummary.totalEvents}`);
  const stageEntries = Object.entries(input.repairSummary.byStage).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [stage, count] of stageEntries) {
    lines.push(`- Stage \`${stage}\`: ${count}`);
  }
  lines.push("");

  lines.push("## Recommended Improvements");
  for (const suggestion of input.suggestions) {
    lines.push(`- ${suggestion}`);
  }
  lines.push("");

  return lines.join("\n");
}

export async function writeCodingSessionReport(
  input: WriteCodingSessionReportInput,
): Promise<void> {
  const ralphDir = await ensureRalphDir(input.outputDir);
  const usage = getCodingSessionLlmUsage(input.sessionId);
  const modelUsage = aggregateModelUsage(usage);
  const repairSummary = await readRepairEventSummary(
    input.outputDir,
    input.startedAt,
    input.endedAt,
  );
  const stageUsage = aggregateStageUsage({
    usage,
    repairSummary,
    integrationErrors: input.integrationErrors,
    runtimeVerifyErrors: input.runtimeVerifyErrors,
    e2eVerifyErrors: input.e2eVerifyErrors,
    finalAudit: input.finalAudit,
    taskResults: input.taskResults,
  });
  const modelPerformance = aggregateModelPerformance({
    usage,
    stageUsage,
  });
  const score = scoreCodingSession({
    status: input.status,
    integrationErrors: input.integrationErrors,
    runtimeVerifyErrors: input.runtimeVerifyErrors,
    e2eVerifyErrors: input.e2eVerifyErrors,
    uncoveredCount: input.finalAudit?.uncovered.length ?? 0,
    taskResults: input.taskResults,
    repairSummary,
  });
  const suggestions = buildImprovementSuggestions({
    integrationErrors: input.integrationErrors,
    runtimeVerifyErrors: input.runtimeVerifyErrors,
    e2eVerifyErrors: input.e2eVerifyErrors,
    finalAudit: input.finalAudit,
    repairSummary,
    llmUsage: modelUsage,
  });
  const preflightLedger = buildPreflightLedger(repairSummary);
  const defectCategories = buildDefectCategories({
    ledger: preflightLedger,
    integrationErrors: input.integrationErrors,
    runtimeVerifyErrors: input.runtimeVerifyErrors,
    e2eVerifyErrors: input.e2eVerifyErrors,
    finalAudit: input.finalAudit,
    gatesExecuted: input.gatesExecuted,
  });
  const generatorGitSha = await resolveGeneratorGitSha();

  const renderGateState = (
    executed: boolean | undefined,
    errors: string | undefined,
  ): "pass" | "fail" | "skipped" => {
    if (errors?.trim()) return "fail";
    if (!executed) return "skipped";
    return "pass";
  };

  const jsonPayload = {
    sessionId: input.sessionId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    status: input.status,
    terminalSummary: input.terminalSummary,
    fatalError: input.fatalError ?? "",
    generatorGitSha: generatorGitSha ?? null,
    scaffoldFixAttempts: input.scaffoldFixAttempts ?? 0,
    integrationFixAttempts: input.integrationFixAttempts ?? 0,
    score,
    gateErrors: {
      integrationErrors: input.integrationErrors ?? "",
      runtimeVerifyErrors: input.runtimeVerifyErrors ?? "",
      e2eVerifyErrors: input.e2eVerifyErrors ?? "",
    },
    gateStates: {
      integrationVerify: renderGateState(
        input.gatesExecuted?.integrationVerify,
        input.integrationErrors,
      ),
      runtimeVerify: renderGateState(
        input.gatesExecuted?.runtimeVerify,
        input.runtimeVerifyErrors,
      ),
      e2eVerify: renderGateState(
        input.gatesExecuted?.e2eVerify,
        input.e2eVerifyErrors,
      ),
      featureAudit: input.finalAudit
        ? input.finalAudit.passed
          ? "pass"
          : "fail"
        : "skipped",
    },
    taskResults: input.taskResults,
    fileRegistryCount: input.fileRegistry.length,
    llmUsageEvents: usage,
    modelUsage,
    modelPerformance,
    stageUsage,
    repairSummary,
    preflightLedger,
    defectCategories,
    finalAudit: input.finalAudit ?? null,
    suggestions,
  };

  const markdown = formatMarkdownReport({
    sessionId: input.sessionId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    status: input.status,
    terminalSummary: input.terminalSummary,
    score,
    modelUsage,
    modelPerformance,
    stageUsage,
    taskResults: input.taskResults,
    fileRegistry: input.fileRegistry,
    repairSummary,
    finalAudit: input.finalAudit,
    fatalError: input.fatalError,
    suggestions,
    integrationErrors: input.integrationErrors,
    runtimeVerifyErrors: input.runtimeVerifyErrors,
    e2eVerifyErrors: input.e2eVerifyErrors,
    preflightLedger,
    defectCategories,
    scaffoldFixAttempts: input.scaffoldFixAttempts,
    integrationFixAttempts: input.integrationFixAttempts,
    gatesExecuted: input.gatesExecuted,
    generatorGitSha,
  });

  const latestJsonPath = path.join(ralphDir, "coding-session-report.json");
  const latestMdPath = path.join(ralphDir, "coding-session-report.md");
  const archiveDir = path.join(ralphDir, "report-history");
  const archiveStamp = toArchiveTimestamp(input.endedAt);
  const sessionJsonPath = path.join(
    ralphDir,
    `coding-session-report.${input.sessionId}.json`,
  );
  const sessionMdPath = path.join(
    ralphDir,
    `coding-session-report.${input.sessionId}.md`,
  );
  const archiveJsonFile = `coding-session-report.${archiveStamp}.${input.sessionId}.json`;
  const archiveMdFile = `coding-session-report.${archiveStamp}.${input.sessionId}.md`;
  const archiveJsonPath = path.join(archiveDir, archiveJsonFile);
  const archiveMdPath = path.join(archiveDir, archiveMdFile);

  await fs.mkdir(archiveDir, { recursive: true });

  await Promise.all([
    fs.writeFile(latestJsonPath, JSON.stringify(jsonPayload, null, 2), "utf-8"),
    fs.writeFile(latestMdPath, markdown, "utf-8"),
    fs.writeFile(sessionJsonPath, JSON.stringify(jsonPayload, null, 2), "utf-8"),
    fs.writeFile(sessionMdPath, markdown, "utf-8"),
    fs.writeFile(archiveJsonPath, JSON.stringify(jsonPayload, null, 2), "utf-8"),
    fs.writeFile(archiveMdPath, markdown, "utf-8"),
  ]);

  await updateReportHistoryIndex(ralphDir, {
    sessionId: input.sessionId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    status: input.status,
    score: score.score,
    grade: score.grade,
    durationMs: Math.max(
      0,
      Date.parse(input.endedAt) - Date.parse(input.startedAt),
    ),
    totalCalls: modelUsage.reduce((sum, item) => sum + item.calls, 0),
    totalTokens: modelUsage.reduce((sum, item) => sum + item.totalTokens, 0),
    totalCostUsd: modelUsage.reduce((sum, item) => sum + item.costUsd, 0),
    primaryModel: modelPerformance[0]?.model ?? modelUsage[0]?.model ?? "(unknown)",
    primaryModelScore: Number((modelPerformance[0]?.score ?? 0).toFixed(1)),
    primaryModelGrade: modelPerformance[0]?.grade ?? "N/A",
    archiveJsonFile,
    archiveMdFile,
  });
}
