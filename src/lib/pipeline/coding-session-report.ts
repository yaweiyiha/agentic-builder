import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { GeneratedFile } from "@/lib/langgraph/state";
import type { AuditTaskSummary, FeatureChecklistAuditResult } from "@/lib/pipeline/self-heal";
import {
  readTddEvidenceSummary,
  type TddEvidenceSummary,
} from "@/lib/pipeline/tdd-evidence";

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

/**
 * Snapshot of `<outputDir>/.ralph/runtime-integration-audit.json` (produced
 * by `runRuntimeIntegrationAudit` during integration preflight). Used as the
 * "Runtime readiness" header signal — see CODEGEN_HARDENING_PLAN.md §6.2.
 *
 * `present=false` means the audit was never persisted (typically because
 * integration verify aborted before preflight even ran). Treat that as a
 * neutral "unknown", NOT a clean pass.
 */
interface RuntimeReadinessSummary {
  present: boolean;
  clean: boolean;
  hasError: boolean;
  findingsTotal: number;
  errorCount: number;
  warnCount: number;
  byRule: Record<string, number>;
  topFindings: Array<{
    ruleId: string;
    severity: string;
    file: string;
    line: number;
  }>;
  disabledRules: Array<{ ruleId: string; reason: string }>;
}

interface MigrationCoverageSummary {
  /** True when `.ralph/migration-coverage.json` was present and parsed. */
  present: boolean;
  /** Distinct source tasks that touched a model file. */
  tasksTouchedModels: number;
  /** Source tasks that touched a model without a migration. */
  tasksWithGaps: number;
  /** Sum of model-file gaps across all tasks. */
  totalGaps: number;
  /** Up to 10 example gaps for the report archive. */
  topGaps: Array<{
    sourceTaskId: string;
    modelPath: string;
    modelName: string;
  }>;
}

const EMPTY_MIGRATION_COVERAGE: MigrationCoverageSummary = {
  present: false,
  tasksTouchedModels: 0,
  tasksWithGaps: 0,
  totalGaps: 0,
  topGaps: [],
};

const EMPTY_RUNTIME_READINESS: RuntimeReadinessSummary = {
  present: false,
  clean: false,
  hasError: false,
  findingsTotal: 0,
  errorCount: 0,
  warnCount: 0,
  byRule: {},
  topFindings: [],
  disabledRules: [],
};

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
  /**
   * Runtime-integration-audit snapshot (CODEGEN_HARDENING_PLAN.md §6.2).
   * `runtimeReadinessFindings = -1` means the audit didn't run / wasn't
   * persisted (typically because integration verify aborted before
   * preflight). `0` is a real "clean" pass.
   */
  runtimeReadinessFindings?: number;
  runtimeReadinessErrors?: number;
  runtimeReadinessWarnings?: number;
  runtimeReadinessHasError?: boolean;
  /**
   * Sequelize migration-coverage gaps observed across all tasks this
   * session (CODEGEN_HARDENING_PLAN.md §4 — Sequelize migration RULE).
   * `migrationCoverageGaps = -1` means the report wasn't found (no
   * Sequelize models touched, or M-tier wasn't used). `0` is a real
   * "every model that changed got a migration" pass.
   */
  migrationCoverageGaps?: number;
  migrationCoverageTasksWithGaps?: number;
  migrationCoverageTasksTouched?: number;
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
    "| Ended At | Status | Score | Runtime | Migrations | Duration | Calls | Tokens | Cost | Primary Model | Model Score | Report |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |",
  );
  const fmtRuntime = (entry: CodingSessionReportHistoryEntry): string => {
    const f = entry.runtimeReadinessFindings;
    if (f === undefined || f < 0) return "n/a";
    if (f === 0) return "✅ 0";
    return `${f} (${entry.runtimeReadinessErrors ?? 0}E/${entry.runtimeReadinessWarnings ?? 0}W)`;
  };
  const fmtMigration = (entry: CodingSessionReportHistoryEntry): string => {
    const g = entry.migrationCoverageGaps;
    if (g === undefined || g < 0) return "n/a";
    const touched = entry.migrationCoverageTasksTouched ?? 0;
    if (g === 0) return touched > 0 ? `✅ 0/${touched}` : "✅ 0";
    return `${g} gap (${entry.migrationCoverageTasksWithGaps ?? 0}/${touched} task)`;
  };
  for (const entry of entries) {
    lines.push(
      `| ${entry.endedAt} | ${entry.status.toUpperCase()} | ${entry.score}/100 (${entry.grade}) | ${fmtRuntime(entry)} | ${fmtMigration(entry)} | ${formatDuration(entry.durationMs)} | ${entry.totalCalls} | ${entry.totalTokens} | $${entry.totalCostUsd.toFixed(4)} | ${entry.primaryModel} | ${entry.primaryModelScore}/100 (${entry.primaryModelGrade}) | [view](./report-history/${entry.archiveMdFile}) |`,
    );
  }
  lines.push("");

  // CODEGEN_HARDENING_PLAN.md §6.2 trigger: "若三次 run 仍然 ≥1 → 升级对应
  // prompt". Surface a callout when the last 3 sessions all carry runtime
  // findings — this is the operator's signal that the audit pattern has
  // outgrown its prompt-level fix and needs to be promoted to L1 (scaffold)
  // or L4 (auto-repair).
  const last3WithRuntime = entries
    .slice(-3)
    .filter(
      (e) =>
        e.runtimeReadinessFindings !== undefined &&
        e.runtimeReadinessFindings >= 0,
    );
  if (
    last3WithRuntime.length === 3 &&
    last3WithRuntime.every((e) => (e.runtimeReadinessFindings ?? 0) >= 1)
  ) {
    lines.push(
      "> ⚠️ **Runtime readiness trend alert (§6.2)** — 3 consecutive sessions reported ≥1 runtime-integration-audit finding. The corresponding rule(s) should be promoted from L3 prompt-level (current) to L1 (scaffold-level fix) or L4 (auto-repair task). See `CODEGEN_HARDENING_PLAN.md` §6.3.",
      "",
    );
  }

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

async function readMigrationCoverageSummary(
  outputDir: string,
): Promise<MigrationCoverageSummary> {
  const filePath = path.join(outputDir, ".ralph", "migration-coverage.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      tasks?: Record<
        string,
        {
          taskId?: string;
          ok?: boolean;
          modelFilesTouched?: string[];
          gaps?: Array<{ modelPath?: string; modelName?: string }>;
        }
      >;
    };
    const tasks = parsed.tasks ?? {};
    let tasksTouchedModels = 0;
    let tasksWithGaps = 0;
    let totalGaps = 0;
    const topGaps: MigrationCoverageSummary["topGaps"] = [];
    for (const entry of Object.values(tasks)) {
      if (!entry) continue;
      const touched = Array.isArray(entry.modelFilesTouched)
        ? entry.modelFilesTouched.length
        : 0;
      if (touched > 0) tasksTouchedModels++;
      if (entry.ok === false && Array.isArray(entry.gaps) && entry.gaps.length) {
        tasksWithGaps++;
        for (const gap of entry.gaps) {
          totalGaps++;
          if (
            topGaps.length < 10 &&
            gap &&
            typeof gap.modelPath === "string" &&
            typeof gap.modelName === "string" &&
            typeof entry.taskId === "string"
          ) {
            topGaps.push({
              sourceTaskId: entry.taskId,
              modelPath: gap.modelPath,
              modelName: gap.modelName,
            });
          }
        }
      }
    }
    return {
      present: true,
      tasksTouchedModels,
      tasksWithGaps,
      totalGaps,
      topGaps,
    };
  } catch {
    return { ...EMPTY_MIGRATION_COVERAGE };
  }
}

async function readRuntimeReadinessSummary(
  outputDir: string,
): Promise<RuntimeReadinessSummary> {
  const filePath = path.join(
    outputDir,
    ".ralph",
    "runtime-integration-audit.json",
  );
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      clean?: boolean;
      hasError?: boolean;
      findings?: Array<{
        ruleId?: string;
        severity?: string;
        file?: string;
        line?: number;
      }>;
      byRule?: Record<string, number>;
      bySeverity?: Record<string, number>;
      disabledRules?: Array<{ ruleId?: string; reason?: string }>;
    };
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const byRule = parsed.byRule ?? {};
    const bySeverity = parsed.bySeverity ?? {};
    const disabledRules = (parsed.disabledRules ?? [])
      .filter(
        (d): d is { ruleId: string; reason: string } =>
          !!d &&
          typeof d.ruleId === "string" &&
          typeof d.reason === "string",
      )
      .map((d) => ({ ruleId: d.ruleId, reason: d.reason }));

    const ranked = [...findings]
      .filter((f) => typeof f.ruleId === "string" && typeof f.file === "string")
      .sort((a, b) => {
        const sevRank = (s?: string) =>
          s === "error" ? 0 : s === "warn" ? 1 : 2;
        const r = sevRank(a.severity) - sevRank(b.severity);
        return r !== 0 ? r : (a.ruleId ?? "").localeCompare(b.ruleId ?? "");
      })
      .slice(0, 10)
      .map((f) => ({
        ruleId: f.ruleId as string,
        severity: typeof f.severity === "string" ? f.severity : "unknown",
        file: f.file as string,
        line: typeof f.line === "number" ? f.line : 0,
      }));

    return {
      present: true,
      clean: !!parsed.clean,
      hasError: !!parsed.hasError,
      findingsTotal: findings.length,
      errorCount: bySeverity.error ?? 0,
      warnCount: bySeverity.warn ?? 0,
      byRule,
      topFindings: ranked,
      disabledRules,
    };
  } catch {
    return EMPTY_RUNTIME_READINESS;
  }
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
      ...repairEntries.map((entry) => (entry.stillMissing ?? []).filter((id) => !/^IC-\d+$/i.test(id)).length),
      input.finalAudit && stage === "post-gen-audit"
        ? (input.finalAudit.hardUncovered?.length ?? input.finalAudit.uncovered.filter((e) => !/^IC-\d+$/i.test(e.id)).length)
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

interface CodegenRetrofitSuggestion {
  /** Stable id for grouping / deduping across sessions. */
  id: string;
  /** high = pipeline-blocking, medium = quality drop, low = cost / efficiency. */
  severity: "high" | "medium" | "low";
  /** Short headline (single sentence). */
  title: string;
  /** Bullet list of evidence quoted from this run's signals. */
  evidence: string[];
  /** Concrete change to make in the codegen pipeline. */
  recommendation: string;
  /**
   * Cross-reference to CODEGEN_HARDENING_PLAN.md section (e.g. "§7.1") when
   * the rule already exists. Null means no documented rule yet — open ticket.
   */
  planRef: string | null;
}

/**
 * Parse the speculative-CRUD smell out of the route audit's
 * `missingContractEndpoints`. We treat a resource root (path stem like
 * `/api/users` or `/api/cached-markets`) as "speculative CRUD" when at least
 * 3 of {GET-list, POST, PATCH:id, DELETE:id} were declared in the contract
 * but never implemented. This is the exact pattern that wedged
 * session 52851b86 (45 missing endpoints, all CRUD).
 */
function detectSpeculativeCrudResources(
  missing: Array<{ method: string; endpoint: string }>,
): { resources: string[]; verbsByResource: Map<string, Set<string>> } {
  const verbsByResource = new Map<string, Set<string>>();
  for (const m of missing) {
    const path = m.endpoint;
    const stemMatch = path.match(/^(\/api\/[^/:?]+)/);
    if (!stemMatch) continue;
    const stem = stemMatch[1];
    const set = verbsByResource.get(stem) ?? new Set<string>();
    const isIdPath = /\/:[\w-]+$/.test(path);
    const verb = m.method.toUpperCase();
    if (verb === "GET" && !isIdPath) set.add("LIST");
    else if (verb === "POST" && !isIdPath) set.add("POST");
    else if (verb === "PATCH" || verb === "PUT") set.add("UPDATE");
    else if (verb === "DELETE") set.add("DELETE");
    verbsByResource.set(stem, set);
  }
  const resources = [...verbsByResource.entries()]
    .filter(([, verbs]) => verbs.size >= 3)
    .map(([stem]) => stem)
    .sort();
  return { resources, verbsByResource };
}

/**
 * Mine concrete codegen-pipeline retrofits from this run's signals.
 * Each suggestion cites exact evidence (counts, paths, costs) and references
 * the matching CODEGEN_HARDENING_PLAN.md section so the reader can act on it.
 */
function buildCodegenRetrofitSuggestions(input: {
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  finalAudit?: FeatureChecklistAuditResult | null;
  repairSummary: RepairEventSummary;
  modelUsage: AggregatedModelUsage[];
  stageUsage: StageUsageSummary[];
  preflightLedger: PreflightAutomationLedger;
  taskResults: AuditTaskSummary[];
  gatesExecuted?: {
    integrationVerify: boolean;
    runtimeVerify: boolean;
    e2eVerify: boolean;
  };
}): CodegenRetrofitSuggestion[] {
  const out: CodegenRetrofitSuggestion[] = [];
  const repairByEvent = input.repairSummary.byEvent ?? {};
  const integrationFailed = !!input.integrationErrors?.trim();
  const runtimeFailed = !!input.runtimeVerifyErrors?.trim();
  const e2eFailed = !!input.e2eVerifyErrors?.trim();
  const route = input.preflightLedger.routeAudit;
  const completeness = input.preflightLedger.contractCompleteness;
  const stageMap = new Map(input.stageUsage.map((s) => [s.stage, s]));

  // ── Rule 1 — Speculative CRUD in API_CONTRACTS.json ────────────────────
  const missingFromFinal = route.final?.missingContractEndpoints ?? [];
  const missingFromPreflight = route.preflight?.missingContractEndpoints ?? [];
  const missing = missingFromFinal.length > 0 ? missingFromFinal : missingFromPreflight;
  if (missing.length >= 8) {
    const { resources } = detectSpeculativeCrudResources(missing);
    if (resources.length >= 2) {
      out.push({
        id: "contract-speculative-crud",
        severity: "high",
        title:
          "API_CONTRACTS.json declared speculative CRUD endpoints that nothing implements or calls",
        evidence: [
          `Route audit: ${missing.length} contract endpoint(s) had no backend implementation.`,
          `${resources.length} resource root(s) show full CRUD shape (GET-list / POST / PATCH:id / DELETE:id) without justification: ${resources.slice(0, 6).join(", ")}${resources.length > 6 ? ", …" : ""}.`,
          `Sample missing: ${missing
            .slice(0, 4)
            .map((m) => `${m.method} ${m.endpoint}`)
            .join("; ")}.`,
        ],
        recommendation:
          "Tighten `generate_api_contracts` prompt with the Contract Scope Rule: every endpoint must carry `prdJustification` (verbatim PRD line) and `audience` (user|admin); reject default-enumerated CRUD when the model isn't named in PRD user flows. Add a `contract-usage-coverage` audit (4-quadrant decision tree) to prune surplus before integration_verify_fix is invoked.",
        planRef: "§7.1 (Contract scope rule) + §7.2 (4-quadrant decision tree)",
      });
    }
  }

  // ── Rule 2 — integration_verify_fix stagnated → pipeline aborted ───────
  const stagnationCount = repairByEvent.stagnation_warning ?? 0;
  const verifyFixStage = stageMap.get("integration_verify_fix");
  if (
    stagnationCount >= 2 ||
    (integrationFailed && (verifyFixStage?.llmCalls ?? 0) >= 20)
  ) {
    out.push({
      id: "verify-fix-stagnation",
      severity: "high",
      title:
        "`integration_verify_fix` looped without producing mutations and ran out of budget",
      evidence: [
        `stagnation_warning events: ${stagnationCount}.`,
        `integration_verify_fix: calls=${verifyFixStage?.llmCalls ?? 0}, cost=$${(verifyFixStage?.costUsd ?? 0).toFixed(4)}, duration=${formatDuration(verifyFixStage?.durationMs ?? 0)}.`,
        integrationFailed
          ? "Stage exited with blocking integration errors still present."
          : "Stage burned budget without final failure (still suboptimal).",
      ],
      recommendation:
        "Inject the four-quadrant decision tree into `integration_verify_fix`'s system prompt: explicitly authorise (a) implement, (b) prune contract, (c) add to contract, (d) delete frontend rogue call, (e) implement backend route. Also wire the stagnation fallback: when the in-loop watcher trips, issue ONE batch-classify prompt (read-once / classify-once / write-once) and cap at 2 more iterations.",
      planRef: "§7.2 + §7.4 (stagnation fallback)",
    });
  }

  // ── Rule 3 — Single gate failure halted runtime/E2E entirely ───────────
  const integrationRan = input.gatesExecuted?.integrationVerify === true;
  const runtimeRan = input.gatesExecuted?.runtimeVerify === true;
  const e2eRan = input.gatesExecuted?.e2eVerify === true;
  if (integrationFailed && integrationRan && (!runtimeRan || !e2eRan)) {
    out.push({
      id: "gate-cascade-skip",
      severity: "high",
      title:
        "Integration gate failure short-circuited runtime/E2E verification",
      evidence: [
        `Integration verify: FAIL.`,
        `Runtime verify: ${runtimeRan ? "PASS/FAIL (executed)" : "SKIPPED"}.`,
        `E2E verify: ${e2eRan ? "PASS/FAIL (executed)" : "SKIPPED"}.`,
        "Skipped gates leave the report blind to whether the project actually starts and serves traffic.",
      ],
      recommendation:
        "Switch the orchestrator's gate policy from `graph_error` to `FAILED_BUT_CONTINUED`: integration FAIL records the failure but lets runtime + E2E + e2e-triage still run. Only runtime FAIL should block E2E (since the app can't serve traffic). Surface gates as PASS / FAIL / FAIL_CONTINUED / SKIPPED in the report.",
      planRef: "§7.3 (one gate FAIL ≠ pipeline halt)",
    });
  }

  // ── Rule 4 — Worker context truncation ─────────────────────────────────
  const truncated =
    (repairByEvent.doc_truncated ?? 0) +
    (repairByEvent.truncation_detected ?? 0) +
    (repairByEvent.worker_context_trimmed ?? 0);
  if (truncated >= 1) {
    out.push({
      id: "worker-context-truncation",
      severity: truncated >= 4 ? "medium" : "low",
      title: "PRD / implementation context was truncated for workers",
      evidence: [
        `doc_truncated=${repairByEvent.doc_truncated ?? 0}, truncation_detected=${repairByEvent.truncation_detected ?? 0}, worker_context_trimmed=${repairByEvent.worker_context_trimmed ?? 0}.`,
      ],
      recommendation:
        "Increase `WORKER_CONTEXT_BUDGET_CHARS` for large-window providers (DeepSeek V4 Pro 1M, Gemini 1M). Improve `doc-section-picker.ts` priority so contract-relevant sections + PRD user flows are never the ones dropped first. Consider per-role budgets (frontend gets API client + design spec; backend gets contract + ORM models).",
      planRef: null,
    });
  }

  // ── Rule 5 — task ↔ file plan mismatches ───────────────────────────────
  const planUnfulfilled = repairByEvent.task_plan_unfulfilled ?? 0;
  if (planUnfulfilled >= 2) {
    out.push({
      id: "task-plan-unfulfilled",
      severity: "medium",
      title: "Workers' file plans repeatedly diverged from the files they wrote",
      evidence: [`task_plan_unfulfilled events: ${planUnfulfilled}.`],
      recommendation:
        "Tighten `task-file-plan-verifier`: after the worker emits its plan, gate the worker so it cannot complete until either every planned path was written OR an explicit `<plan-amendment>` block justifies the delta. This converts silent mismatches into a fast-fail loop instead of accumulating noise.",
      planRef: null,
    });
  }

  // ── Rule 6 — Convention auto-fix did heavy rewrites ────────────────────
  const conv = input.preflightLedger.conventionAutofix;
  if (conv.totalFixedFiles >= 5) {
    out.push({
      id: "convention-baked-into-scaffold",
      severity: "low",
      title:
        "Workers wrote files using non-canonical paths; convention auto-fix had to rewrite them",
      evidence: [
        `conventionAutofix: invocations=${conv.invocations}, files rewritten=${conv.totalFixedFiles}, unfixable=${conv.totalUnfixable}.`,
        `Sample notes: ${conv.notes.slice(0, 3).join(" | ")}`,
      ],
      recommendation:
        "Promote the canonical paths the auto-fixer keeps writing back (e.g. `frontend/src/contexts/`, `backend/src/middleware/`) into `ROLE_PROMPTS` 'Project-specific conventions' as HARD RULES with explicit anti-patterns. Each canonical path that triggered ≥2 rewrites this session should become an example in the prompt.",
      planRef: "§4 (Worker prompt 'Project-specific conventions')",
    });
  }

  // ── Rule 7 — Missing-import auto-installs ──────────────────────────────
  const importGap = input.preflightLedger.importGapInstalls;
  if (importGap.totalPackages >= 2) {
    const pkgList = importGap.scopes
      .flatMap((s) => s.packages.map((p) => `${s.scope}:${p}`))
      .slice(0, 6);
    out.push({
      id: "missing-deps-auto-install",
      severity: "low",
      title:
        "Workers imported packages without declaring them in package.json",
      evidence: [
        `Auto-installed ${importGap.totalPackages} package(s) across ${importGap.scopes.length} scope(s): ${pkgList.join(", ")}.`,
      ],
      recommendation:
        "Either (a) add the well-known feature packages (the optional scaffold's `extraDeps`) so the dep is present from day one, or (b) inject a HARD RULE in worker prompts: 'before importing a package, ensure it appears in `package.json`; emit a separate `package.json` patch in the same response if missing'.",
      planRef: "§4.1 (Conditional scaffold extraDeps) + §4.10 (manifest)",
    });
  }

  // ── Rule 8 — ORM-derived contract completeness gap ─────────────────────
  const completenessGap =
    completeness.preflight?.missingScopedEndpoints.length ??
    completeness.postGenerate?.missingScopedEndpoints.length ??
    0;
  if (completenessGap >= 2) {
    const samples =
      completeness.preflight?.missingScopedEndpoints.slice(0, 3) ??
      completeness.postGenerate?.missingScopedEndpoints.slice(0, 3) ??
      [];
    out.push({
      id: "contract-orm-scoped-gap",
      severity: "medium",
      title:
        "Generated contract missed scoped-list endpoints derivable from ORM relationships",
      evidence: [
        `${completenessGap} scoped-list endpoint(s) inferred from ORM hasMany relationships were absent in API_CONTRACTS.json.`,
        `Examples: ${samples.map((m) => `${m.expectedPath} (${m.parent}→${m.child})`).join("; ")}.`,
      ],
      recommendation:
        "Move the ORM-relationship inference UPSTREAM into `generate_api_contracts` (currently it's only caught post-hoc by the completeness audit). Feed the agent the parsed Sequelize model relationships as input; require it to emit scoped endpoints when a hasMany is present AND the PRD describes a parent-detail page.",
      planRef: null,
    });
  }

  // ── Rule 9 — Backend modules exported but never registered ─────────────
  const unregistered = route.preflight?.unregisteredModules ?? [];
  const dangling = route.preflight?.unresolvedRegistrations ?? [];
  if (unregistered.length + dangling.length >= 1) {
    out.push({
      id: "backend-route-registration-gap",
      severity: "medium",
      title:
        "Backend route registrars existed but weren't wired into the app router",
      evidence: [
        `Unregistered modules: ${unregistered.length} (${unregistered.slice(0, 3).join(", ") || "—"}).`,
        `Dangling registration imports: ${dangling.length} (${dangling.slice(0, 3).join(", ") || "—"}).`,
      ],
      recommendation:
        "Add to `ROLE_PROMPTS.backend` 'Project-specific conventions': **after** creating any `register<Domain>Routes()`, you MUST import + call it inside `apiRouter` (or the canonical aggregator) in the SAME response. Provide the exact aggregator file path in the Project Convention Card.",
      planRef: "§4.4 (Background jobs / route registration)",
    });
  }

  // ── Rule 10 — Cost-heavy repair stage relative to generation ───────────
  const codegenStage = stageMap.get("worker_codegen");
  const totalRepairCost =
    (stageMap.get("integration_verify_fix")?.costUsd ?? 0) +
    (stageMap.get("phase_verify_fix")?.costUsd ?? 0) +
    (stageMap.get("worker_codefix")?.costUsd ?? 0);
  const codegenCost = codegenStage?.costUsd ?? 0;
  // Either a high absolute spend OR repair > 0.5x of codegen.
  if (totalRepairCost >= 1.0 && totalRepairCost >= codegenCost * 0.5) {
    out.push({
      id: "repair-spend-imbalance",
      severity: "low",
      title:
        "Repair / verify stages cost as much (or more) than first-pass codegen",
      evidence: [
        `worker_codegen cost=$${codegenCost.toFixed(4)}.`,
        `integration_verify_fix=$${(stageMap.get("integration_verify_fix")?.costUsd ?? 0).toFixed(4)}, phase_verify_fix=$${(stageMap.get("phase_verify_fix")?.costUsd ?? 0).toFixed(4)}, worker_codefix=$${(stageMap.get("worker_codefix")?.costUsd ?? 0).toFixed(4)}.`,
        `Repair total / codegen ratio = ${(codegenCost > 0 ? totalRepairCost / codegenCost : Infinity).toFixed(2)}.`,
      ],
      recommendation:
        "Push fixes upstream: the cheapest dollar is the one not spent on repair. Strengthen preflight (route audit, contract completeness, dep audit) so issues fail fast at low cost; route the most common repair patterns (4-quadrant contract, missing routers) into deterministic codemods rather than LLM iteration.",
      planRef: "§3 (L4 Static Audit) + §7.1 + §7.2",
    });
  }

  // ── Rule 11 — Runtime verify failure with no actionable signal ─────────
  if (runtimeFailed) {
    out.push({
      id: "runtime-verify-failure",
      severity: "medium",
      title: "Runtime verify reported blocking errors",
      evidence: [
        `Runtime errors (truncated): ${input.runtimeVerifyErrors!.split("\n").slice(0, 3).join(" | ")}.`,
      ],
      recommendation:
        "Add structured runtime probes: dedicated health endpoint (`/api/health`), env presence check, DB connect check, queue connect check, LLM client smoke. The runtime verify gate should categorise failures (env / db / queue / external API) instead of dumping a raw error blob, and feed the category into the next repair worker as context.",
      planRef: "§4.4 (Background jobs) + §4.5 (LLM client) + §4.6 (Auth state)",
    });
  }

  // ── Rule 12 — E2E verify failure (only when telemetry exists) ──────────
  if (e2eFailed) {
    out.push({
      id: "e2e-verify-failure",
      severity: "medium",
      title: "E2E verify still has failing scenarios",
      evidence: [
        `E2E error blob (truncated): ${input.e2eVerifyErrors!.split("\n").slice(0, 3).join(" | ")}.`,
      ],
      recommendation:
        "Pair e2e-triage output with the integration_verify_fix decision tree: deterministic failures should auto-dispatch a `worker_codefix` task scoped to the failing spec's surface area; flaky failures should be retried in isolation; infra-only failures should NOT count against the gate (already halved in scoring — keep that).",
      planRef: null,
    });
  }

  return out;
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
  runtimeReadiness: RuntimeReadinessSummary;
  migrationCoverage: MigrationCoverageSummary;
  finalAudit?: FeatureChecklistAuditResult | null;
  fatalError?: string;
  suggestions: string[];
  codegenRetrofits: CodegenRetrofitSuggestion[];
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  preflightLedger: PreflightAutomationLedger;
  defectCategories: DefectCategory[];
  tddEvidenceSummary: TddEvidenceSummary;
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
  // Use hardUncovered (excludes IC-xx soft interaction specs) for gate display.
  const hardUncoveredIds = input.finalAudit?.hardUncovered?.map((entry) => entry.id) ?? input.finalAudit?.uncovered.filter((e) => !/^IC-\d+$/i.test(e.id)).map((entry) => entry.id) ?? [];
  const softUncoveredIds = input.finalAudit?.uncovered.filter((e) => /^IC-\d+$/i.test(e.id)).map((e) => e.id) ?? [];
  const uncoveredIds = hardUncoveredIds;

  // Runtime Readiness header signal (CODEGEN_HARDENING_PLAN.md §6.2):
  // surfaces the runtime-integration-audit verdict at the very top so
  // operators don't have to scroll. Three states:
  //   • not present  → audit didn't run (preflight aborted)
  //   • clean        → 0 findings
  //   • findings     → "N findings (X error, Y warn)"
  const readiness = input.runtimeReadiness;
  const readinessHeader = !readiness.present
    ? "not run (preflight skipped)"
    : readiness.clean
      ? "✅ CLEAN (0 findings)"
      : `${readiness.findingsTotal} finding(s) — ${readiness.errorCount} error, ${readiness.warnCount} warn`;

  const lines: string[] = [
    "# Coding Session Report",
    "",
    `- Session ID: \`${input.sessionId}\``,
    `- Status: **${input.status.toUpperCase()}**`,
    `- Score: **${input.score.score}/100 (${input.score.grade})**`,
    `- Runtime readiness: ${readinessHeader}`,
    `- Started at: ${input.startedAt}`,
    `- Ended at: ${input.endedAt}`,
    `- Total duration: ${formatDuration(Date.parse(input.endedAt) - Date.parse(input.startedAt))}`,
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

  // ── Migration Coverage section ──────────────────────────────────────────
  // Detailed breakdown of `.ralph/migration-coverage.json`. Renders only
  // when at least one task touched a Sequelize model — non-Sequelize
  // projects never produce the report.
  const migration = input.migrationCoverage;
  if (migration.present && migration.tasksTouchedModels > 0) {
    lines.push("## Migration Coverage");
    lines.push(
      "Per-task check that any change under `backend/src/models/` is " +
        "accompanied by a new migration under `backend/src/database/migrations/`. Full " +
        "report: `.ralph/migration-coverage.json`.",
    );
    lines.push("");
    if (migration.tasksWithGaps === 0) {
      lines.push(
        `✅ **Clean.** ${migration.tasksTouchedModels} task(s) touched models; every model change shipped with a migration.`,
      );
    } else {
      lines.push(
        `⚠️ **${migration.totalGaps} gap(s)** across ${migration.tasksWithGaps} task(s) ` +
          `(${migration.tasksTouchedModels} task(s) touched models in total).`,
      );
      lines.push("");
      lines.push("| Source task | Model file | Model name |");
      lines.push("| --- | --- | --- |");
      for (const g of migration.topGaps) {
        lines.push(`| \`${g.sourceTaskId}\` | \`${g.modelPath}\` | \`${g.modelName}\` |`);
      }
      if (migration.totalGaps > migration.topGaps.length) {
        lines.push(
          `_… (+${migration.totalGaps - migration.topGaps.length} more, see full JSON)_`,
        );
      }
    }
    lines.push("");
  }

  // ── Runtime Readiness section (CODEGEN_HARDENING_PLAN.md §6.2) ──────────
  // Detailed breakdown of `runtime-integration-audit.json`. Renders even in
  // the CLEAN case so operators get an explicit "audit ran, found nothing"
  // signal — a missing section means the audit never ran.
  if (readiness.present) {
    lines.push("## Runtime Readiness");
    lines.push(
      "Static §4.2/§4.3/§4.4/§4.5/§4.7 audit of generated source. Findings here mean known runtime pitfalls slipped past the verify-fix worker. Full report: `.ralph/runtime-integration-audit.json`.",
    );
    lines.push("");
    if (readiness.clean) {
      lines.push("✅ **No findings.** All 8 rules either passed or were correctly skipped (see Disabled rules below).");
    } else {
      lines.push(
        `**${readiness.findingsTotal} finding(s)** — ${readiness.errorCount} error, ${readiness.warnCount} warn.`,
      );
      lines.push("");
      lines.push("| Rule | Severity | Locations |");
      lines.push("| --- | --- | --- |");
      const grouped = new Map<
        string,
        { sev: string; locs: string[] }
      >();
      for (const f of readiness.topFindings) {
        const g = grouped.get(f.ruleId) ?? { sev: f.severity, locs: [] };
        g.locs.push(`${f.file}:${f.line}`);
        grouped.set(f.ruleId, g);
      }
      for (const [ruleId, g] of grouped) {
        const totalForRule = readiness.byRule[ruleId] ?? g.locs.length;
        const more =
          totalForRule > g.locs.length
            ? ` (+${totalForRule - g.locs.length} more)`
            : "";
        lines.push(
          `| \`${ruleId}\` | ${g.sev.toUpperCase()} | ${g.locs.join(", ")}${more} |`,
        );
      }
    }
    if (readiness.disabledRules.length > 0) {
      lines.push("");
      lines.push("**Disabled rules:**");
      for (const d of readiness.disabledRules) {
        lines.push(`- \`${d.ruleId}\` — ${d.reason}`);
      }
    }
    lines.push("");
  }

  // Only render Fatal Error if it carries distinct information from the summary.
  if (
    input.fatalError &&
    input.fatalError.trim() !== input.terminalSummary.trim()
  ) {
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

  // ── Scoring breakdown table ───────────────────────────────────────────
  lines.push("## Scoring Breakdown");
  lines.push("");
  // First line of reasons is the formula; the rest are per-rule explanations.
  const [formulaLine, ...ruleBullets] = input.score.reasons;
  if (formulaLine) {
    lines.push(`**Formula:** \`${formulaLine.replace(/^Score formula:\s*/, "")}\``);
    lines.push("");
  }
  lines.push(
    "| Rule | Max deduction | Applied | Reason |",
    "| --- | --- | --- | --- |",
  );
  const SCORING_RULES: Array<{
    label: string;
    condition: string;
    maxDelta: number;
    bonus?: boolean;
  }> = [
    { label: "Run status fail",     condition: "status=fail",    maxDelta: 20 },
    { label: "Run status aborted",  condition: "status=aborted", maxDelta: 30 },
    { label: "Integration gate",    condition: "integration errors present", maxDelta: 10 },
    { label: "Runtime gate",        condition: "runtime errors present",     maxDelta: 8  },
    { label: "E2E gate",            condition: "e2e errors present (scales with fail ratio)", maxDelta: 20 },
    { label: "Uncovered requirements", condition: "PRD requirement ids unresolved", maxDelta: 25 },
    { label: "Failed tasks",        condition: "coding tasks status=failed", maxDelta: 15 },
    { label: "Unknown tasks",       condition: "coding tasks status=unknown", maxDelta: 10 },
    { label: "Context truncation",  condition: "doc_truncated events",       maxDelta: 8  },
    { label: "Plan mismatches",     condition: "task_plan_unfulfilled events", maxDelta: 8 },
    { label: "All tasks done bonus", condition: "all tasks complete + no blocking gates", maxDelta: 5, bonus: true },
  ];
  // Build a map of applied deltas from the formula line
  const appliedMap = new Map<string, { delta: number; reason: string }>();
  for (const rule of ruleBullets) {
    // Match each rule bullet to a known label via keyword
    const matchReason = rule.trim();
    if (/fail/i.test(matchReason) && /status/i.test(matchReason)) {
      appliedMap.set("Run status fail", { delta: -20, reason: matchReason });
    } else if (/aborted/i.test(matchReason)) {
      appliedMap.set("Run status aborted", { delta: -30, reason: matchReason });
    } else if (/integration/i.test(matchReason)) {
      appliedMap.set("Integration gate", { delta: -10, reason: matchReason });
    } else if (/runtime/i.test(matchReason)) {
      appliedMap.set("Runtime gate", { delta: -8, reason: matchReason });
    } else if (/e2e/i.test(matchReason)) {
      appliedMap.set("E2E gate", { delta: -20, reason: matchReason });
    } else if (/uncovered|requirement/i.test(matchReason)) {
      appliedMap.set("Uncovered requirements", { delta: 0, reason: matchReason });
    } else if (/task.*fail|fail.*task/i.test(matchReason)) {
      appliedMap.set("Failed tasks", { delta: 0, reason: matchReason });
    } else if (/unknown.*task|task.*unknown/i.test(matchReason)) {
      appliedMap.set("Unknown tasks", { delta: 0, reason: matchReason });
    } else if (/truncat/i.test(matchReason)) {
      appliedMap.set("Context truncation", { delta: 0, reason: matchReason });
    } else if (/plan.*mismatch|unfulfill/i.test(matchReason)) {
      appliedMap.set("Plan mismatches", { delta: 0, reason: matchReason });
    } else if (/bonus/i.test(matchReason)) {
      appliedMap.set("All tasks done bonus", { delta: 5, reason: matchReason });
    }
  }
  // Extract actual deltas from the formula string
  if (formulaLine) {
    const formulaStr = formulaLine.replace(/^Score formula:\s*/, "");
    // Parse tokens like "− 20(fail)" or "+ 5(all-tasks-done)"
    const tokenRe = /([−+])\s*(\d+)\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(formulaStr)) !== null) {
      const sign = m[1] === "−" ? -1 : 1;
      const abs = parseInt(m[2], 10);
      const tag = m[3].toLowerCase();
      const delta = sign * abs;
      if (tag.startsWith("fail")) appliedMap.set("Run status fail", { delta, reason: "" });
      else if (tag.startsWith("abort")) appliedMap.set("Run status aborted", { delta, reason: "" });
      else if (tag.startsWith("integration")) appliedMap.set("Integration gate", { delta, reason: "" });
      else if (tag.startsWith("runtime")) appliedMap.set("Runtime gate", { delta, reason: "" });
      else if (tag.startsWith("e2e")) appliedMap.set("E2E gate", { delta, reason: "" });
      else if (tag.startsWith("uncovered")) appliedMap.set("Uncovered requirements", { delta, reason: "" });
      else if (tag.startsWith("tasks-failed")) appliedMap.set("Failed tasks", { delta, reason: "" });
      else if (tag.startsWith("tasks-unknown")) appliedMap.set("Unknown tasks", { delta, reason: "" });
      else if (tag.startsWith("trunc")) appliedMap.set("Context truncation", { delta, reason: "" });
      else if (tag.startsWith("plan")) appliedMap.set("Plan mismatches", { delta, reason: "" });
      else if (tag.startsWith("all-tasks")) appliedMap.set("All tasks done bonus", { delta, reason: "" });
    }
  }
  for (const rule of SCORING_RULES) {
    const applied = appliedMap.get(rule.label);
    const maxCell = rule.bonus ? `+${rule.maxDelta}` : `−${rule.maxDelta}`;
    const appliedCell = applied
      ? applied.delta > 0
        ? `**+${applied.delta}** ✅`
        : `**${applied.delta}** ❌`
      : "0 (not triggered)";
    const reasonCell = (applied?.reason || rule.condition).replace(/\|/g, "\\|");
    lines.push(`| ${rule.label} | ${maxCell} | ${appliedCell} | ${reasonCell} |`);
  }
  lines.push("");

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

  // FAIL_CONTINUED policy (CODEGEN_HARDENING_PLAN.md §7.3): a gate that
  // failed but did NOT block the next gate in the pipeline is labelled
  // "FAIL (continued)". This makes it visible that the failure was treated
  // as soft — downstream gates still produced evidence — versus a
  // hard "FAIL" that aborted the pipeline.
  //
  // Concretely:
  //   • integration_verify failed AND e2e_verify executed
  //         → "FAIL (continued)"  ← what session 52851b86 should have shown
  //   • integration_verify failed AND e2e_verify did not execute
  //         → "FAIL"               ← genuine pipeline abort
  //   • integration_verify failed AND e2e_verify failed too
  //         → integration is "FAIL (continued)" (it didn't block e2e),
  //           e2e is "FAIL".
  const e2eRanForFailContinuedCheck =
    input.gatesExecuted?.e2eVerify === true;
  const integrationFailContinued =
    input.gatesExecuted?.integrationVerify === true &&
    !!input.integrationErrors?.trim() &&
    e2eRanForFailContinuedCheck;
  const runtimeFailContinued =
    input.gatesExecuted?.runtimeVerify === true &&
    !!input.runtimeVerifyErrors?.trim() &&
    e2eRanForFailContinuedCheck;

  const gateState = (
    executed: boolean | undefined,
    errors: string | undefined,
    failContinued = false,
  ): "PASS" | "FAIL" | "FAIL (continued)" | "SKIPPED" => {
    if (errors?.trim()) return failContinued ? "FAIL (continued)" : "FAIL";
    if (!executed) return "SKIPPED";
    return "PASS";
  };

  lines.push("## Quality Gates");
  lines.push(
    `- Integration verify: ${gateState(input.gatesExecuted?.integrationVerify, input.integrationErrors, integrationFailContinued)}`,
  );
  lines.push(
    `- Runtime verify: ${gateState(input.gatesExecuted?.runtimeVerify, input.runtimeVerifyErrors, runtimeFailContinued)}`,
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

  lines.push("## TDD Gate");
  const tdd = input.tddEvidenceSummary;
  if (!tdd.manifestPresent && !tdd.evidencePresent) {
    lines.push(
      "- Not run yet. No `.ralph/test-manifest.json` or `.ralph/tdd-evidence.jsonl` was found.",
      "",
    );
  } else {
    const p0 = tdd.byPriority.P0;
    const p1 = tdd.byPriority.P1;
    const p2 = tdd.byPriority.P2;
    lines.push(`- Manifest: ${tdd.manifestPresent ? "present" : "missing"}`);
    lines.push(`- Evidence events: ${tdd.totalEvidenceEvents}`);
    lines.push(
      `- RED evidence: ${tdd.redValid}/${tdd.totalManifestTests || tdd.totalEvidenceEvents}`,
    );
    lines.push(
      `- GREEN passed: ${tdd.greenPassed}/${tdd.totalManifestTests || tdd.totalEvidenceEvents}`,
    );
    lines.push(
      `- Priority coverage: P0 ${p0.greenPassed}/${p0.total}, P1 ${p1.greenPassed}/${p1.total}, P2 ${p2.greenPassed}/${p2.total}`,
    );
    lines.push(
      `- Reviewer: ${tdd.reviewPresent ? `${tdd.reviewFindingCount} finding(s), ${tdd.reviewP0ErrorCount} P0 error(s)` : "not run"}`,
    );
    if (tdd.p0BlockingFailures.length > 0) {
      lines.push(
        `- Blocking P0 TDD gaps: ${tdd.p0BlockingFailures.slice(0, 12).join(", ")}`,
      );
    } else if (tdd.totalManifestTests > 0) {
      lines.push("- Blocking P0 TDD gaps: none");
    }
    if (tdd.missingRedEvidence.length > 0) {
      lines.push(
        `- Missing RED evidence: ${tdd.missingRedEvidence.slice(0, 12).join(", ")}`,
      );
    }
    if (tdd.missingGreenEvidence.length > 0) {
      lines.push(
        `- Missing GREEN evidence: ${tdd.missingGreenEvidence.slice(0, 12).join(", ")}`,
      );
    }
    if (tdd.p0Details.length > 0) {
      lines.push("");
      lines.push("### P0 TDD Evidence");
      lines.push("| Test | Task | Requirements | RED | GREEN | Command | Evidence |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- |");
      for (const detail of tdd.p0Details.slice(0, 20)) {
        const evidence = (detail.failureExcerpt ?? "")
          .replace(/\|/g, "\\|")
          .replace(/\s+/g, " ")
          .slice(0, 180);
        lines.push(
          `| \`${detail.id}\` | ${detail.taskId ? `\`${detail.taskId}\`` : ""} | ${detail.requirementIds.join(", ") || ""} | ${detail.redStatus ?? ""} | ${detail.greenStatus ?? ""} | \`${(detail.command ?? "").replace(/\|/g, "\\|")}\` | ${evidence} |`,
        );
      }
      if (tdd.p0Details.length > 20) {
        lines.push(`_… (+${tdd.p0Details.length - 20} more P0 tests)_`);
      }
    }
    lines.push("");
  }

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
    lines.push("- All hard requirement ids are covered.", "");
    if (softUncoveredIds.length > 0) {
      lines.push(
        `- Soft warnings (IC-xx interaction specs, do not block gate): ${softUncoveredIds.join(", ")}`,
        "",
      );
    }
  } else {
    lines.push(
      `- Hard uncovered ids (${hardUncoveredIds.length}): ${hardUncoveredIds.join(", ") || "(none listed)"}`,
      "",
    );
    if (softUncoveredIds.length > 0) {
      lines.push(
        `- Soft warnings (IC-xx interaction specs, do not block gate): ${softUncoveredIds.join(", ")}`,
        "",
      );
    }
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

  // ── Pipeline Anomalies (CODEGEN_HARDENING_PLAN.md §7.4) ────────────────
  // Stagnation, fallback prompts, contract pruning and contract-scope-rule
  // violations are SIGNALS ABOUT THE PIPELINE — not about model quality.
  // Surfacing them separately stops the model-scoring system from
  // misattributing "session bombed" to "deepseek-v4-pro is bad" when the
  // root cause was actually pipeline-level (contract over-spec, gate
  // short-circuit, etc.).
  const repairByEventForAnomalies = input.repairSummary.byEvent ?? {};
  const stagnationWarningCount =
    repairByEventForAnomalies.stagnation_warning ?? 0;
  const stagnationFallbackInjectedCount =
    repairByEventForAnomalies.stagnation_fallback_injected ?? 0;
  const stagnationFallbackPassedCount =
    repairByEventForAnomalies.stagnation_fallback_passed ?? 0;
  const stagnationFallbackExhaustedCount =
    repairByEventForAnomalies.stagnation_fallback_exhausted ?? 0;
  const contractScopeViolationCount =
    repairByEventForAnomalies.contract_scope_rule_violation ?? 0;
  const contractUsageCoverageCount =
    repairByEventForAnomalies.contract_usage_coverage_audit ?? 0;
  const contractUsageCoverageFailCount =
    repairByEventForAnomalies.contract_usage_coverage_fail ?? 0;
  const truncationCount = repairByEventForAnomalies.doc_truncated ?? 0;
  // Runtime integration audit (CODEGEN_HARDENING_PLAN.md §4.2 / §4.3 / §4.4 /
  // §4.5 / §4.7). Static grep audit emitted as `runtime_integration_audit`
  // (always, once per integration-gate iteration); when findings exist it
  // additionally emits `runtime_integration_audit_failure` (severity=error)
  // OR `runtime_integration_audit_warning` (warn-only).
  const runtimeAuditRunCount =
    repairByEventForAnomalies.runtime_integration_audit ?? 0;
  const runtimeAuditFailureCount =
    repairByEventForAnomalies.runtime_integration_audit_failure ?? 0;
  const runtimeAuditWarningCount =
    repairByEventForAnomalies.runtime_integration_audit_warning ?? 0;
  const anomalyTotal =
    stagnationWarningCount +
    stagnationFallbackInjectedCount +
    contractScopeViolationCount +
    contractUsageCoverageFailCount +
    runtimeAuditFailureCount +
    runtimeAuditWarningCount +
    truncationCount;
  if (
    anomalyTotal > 0 ||
    contractUsageCoverageCount > 0 ||
    runtimeAuditRunCount > 0
  ) {
    lines.push("## Pipeline Anomalies");
    lines.push(
      "Pipeline-level events that affect interpretation of model scores. These reflect the orchestrator behaviour, not the LLM's code quality.",
    );
    lines.push("");
    lines.push("| Event | Count | What it means |");
    lines.push("| --- | --- | --- |");
    if (stagnationWarningCount > 0) {
      lines.push(
        `| stagnation_warning | ${stagnationWarningCount} | Worker re-read the same files without writing. Threshold-driven nudge. |`,
      );
    }
    if (stagnationFallbackInjectedCount > 0) {
      const recovered = stagnationFallbackPassedCount;
      const exhausted = stagnationFallbackExhaustedCount;
      const verdict =
        recovered > 0
          ? `recovered: ${recovered}`
          : exhausted > 0
            ? `aborted after fallback: ${exhausted}`
            : "in-flight";
      lines.push(
        `| stagnation_fallback_injected | ${stagnationFallbackInjectedCount} | Pre-abort batch-classify retry was injected (CODEGEN_HARDENING_PLAN.md §7.4). ${verdict}. |`,
      );
    }
    if (contractScopeViolationCount > 0) {
      lines.push(
        `| contract_scope_rule_violation | ${contractScopeViolationCount} | Generated contract entries lacked \`prdJustification\` — at risk of being pruned by usage-coverage audit. |`,
      );
    }
    if (contractUsageCoverageCount > 0) {
      lines.push(
        `| contract_usage_coverage_audit | ${contractUsageCoverageCount} | 4-quadrant audit ran (post-contract / pre-integration). Decisions in \`.ralph/contract-usage-coverage.json\`. |`,
      );
    }
    if (contractUsageCoverageFailCount > 0) {
      lines.push(
        `| contract_usage_coverage_fail | ${contractUsageCoverageFailCount} | Surplus contract entries detected with \`policy=fail\` — operator review required. |`,
      );
    }
    if (truncationCount > 0) {
      lines.push(
        `| doc_truncated | ${truncationCount} | Context budget exhausted; relevance picker dropped sections. Symptoms include "lost" PRD detail. |`,
      );
    }
    if (runtimeAuditRunCount > 0) {
      lines.push(
        `| runtime_integration_audit | ${runtimeAuditRunCount} | Static §4.2/§4.3/§4.4/§4.5/§4.7 grep audit ran. Findings persisted to \`.ralph/runtime-integration-audit.json\`. |`,
      );
    }
    if (runtimeAuditFailureCount > 0) {
      lines.push(
        `| runtime_integration_audit_failure | ${runtimeAuditFailureCount} | Audit found ERROR-severity violations (useSyncExternalStore not cached, useBlocker w/o data router, external-id used as DB PK, SSE not branched on \`inproc:\`, direct vendor LLM SDK import). The verify-fix worker received a deterministic repair directive for each. |`,
      );
    }
    if (runtimeAuditWarningCount > 0) {
      lines.push(
        `| runtime_integration_audit_warning | ${runtimeAuditWarningCount} | Audit found WARN-severity issues (missing \`clearActiveRunsForUser\`, worker not started in server.ts, aggregation throws on empty result). Worker repair directives surfaced. |`,
      );
    }
    lines.push("");
    if (
      stagnationWarningCount > 0 &&
      stagnationFallbackInjectedCount === 0
    ) {
      lines.push(
        "> Worker stagnated but the fallback retry was not triggered — verify the integration stagnation abort threshold; or check whether the abort happened mid-iteration.",
        "",
      );
    }
  }

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

  // ── Codegen Retrofit Suggestions (inferred from this run) ──────────────
  lines.push("## Codegen Retrofit Suggestions (inferred from this run)");
  if (input.codegenRetrofits.length === 0) {
    lines.push(
      "- This run produced no signals that map to a known codegen retrofit. The pipeline behaved as designed.",
      "",
    );
  } else {
    lines.push(
      "Concrete codegen-pipeline changes derived from the signals above. Cross-references point at `CODEGEN_HARDENING_PLAN.md` sections so each item is actionable.",
      "",
    );
    const severityRank = { high: 0, medium: 1, low: 2 } as const;
    const sorted = [...input.codegenRetrofits].sort(
      (a, b) => severityRank[a.severity] - severityRank[b.severity],
    );
    const sevBadge = (s: CodegenRetrofitSuggestion["severity"]): string => {
      if (s === "high") return "🔴 HIGH";
      if (s === "medium") return "🟡 MED";
      return "🟢 LOW";
    };
    lines.push(
      "| # | Severity | Issue | Plan ref |",
      "| --- | --- | --- | --- |",
    );
    sorted.forEach((s, i) => {
      lines.push(
        `| ${i + 1} | ${sevBadge(s.severity)} | ${s.title.replace(/\|/g, "\\|")} | ${(s.planRef ?? "_(no rule yet — open ticket)_").replace(/\|/g, "\\|")} |`,
      );
    });
    lines.push("");
    sorted.forEach((s, i) => {
      lines.push(
        `### ${i + 1}. ${sevBadge(s.severity)} — ${s.title}`,
        "",
        `- **id**: \`${s.id}\``,
        `- **plan ref**: ${s.planRef ?? "_(no rule yet — open ticket)_"}`,
        "- **evidence**:",
        ...s.evidence.map((e) => `    - ${e}`),
        `- **recommendation**: ${s.recommendation}`,
        "",
      );
    });
  }

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
  const runtimeReadiness = await readRuntimeReadinessSummary(input.outputDir);
  const migrationCoverage = await readMigrationCoverageSummary(input.outputDir);
  const tddEvidenceSummary = await readTddEvidenceSummary(input.outputDir);
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
    // IC-xx items are soft interaction spec warnings that do not block the gate.
    // Use only hard-uncovered ids (non IC-xx) for the scoring deduction so that
    // soft warnings do not inflate the penalty.
    uncoveredCount: input.finalAudit
      ? (input.finalAudit.hardUncovered?.length
          ?? input.finalAudit.uncovered.filter((e) => !/^IC-\d+$/i.test(e.id)).length)
      : 0,
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
  const codegenRetrofits = buildCodegenRetrofitSuggestions({
    integrationErrors: input.integrationErrors,
    runtimeVerifyErrors: input.runtimeVerifyErrors,
    e2eVerifyErrors: input.e2eVerifyErrors,
    finalAudit: input.finalAudit,
    repairSummary,
    modelUsage,
    stageUsage,
    preflightLedger,
    taskResults: input.taskResults,
    gatesExecuted: input.gatesExecuted,
  });
  const generatorGitSha = await resolveGeneratorGitSha();

  // CODEGEN_HARDENING_PLAN.md §7.3 — JSON twin of the markdown gateState:
  // a gate is "fail_continued" when it failed but the next gate still ran.
  const jsonE2eRan = input.gatesExecuted?.e2eVerify === true;
  const renderGateState = (
    executed: boolean | undefined,
    errors: string | undefined,
    failContinued = false,
  ): "pass" | "fail" | "fail_continued" | "skipped" => {
    if (errors?.trim()) return failContinued ? "fail_continued" : "fail";
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
        input.gatesExecuted?.integrationVerify === true &&
          !!input.integrationErrors?.trim() &&
          jsonE2eRan,
      ),
      runtimeVerify: renderGateState(
        input.gatesExecuted?.runtimeVerify,
        input.runtimeVerifyErrors,
        input.gatesExecuted?.runtimeVerify === true &&
          !!input.runtimeVerifyErrors?.trim() &&
          jsonE2eRan,
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
    runtimeReadiness,
    migrationCoverage,
    tddEvidenceSummary,
    preflightLedger,
    defectCategories,
    finalAudit: input.finalAudit ?? null,
    suggestions,
    codegenRetrofits,
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
    runtimeReadiness,
    migrationCoverage,
    tddEvidenceSummary,
    finalAudit: input.finalAudit,
    fatalError: input.fatalError,
    suggestions,
    codegenRetrofits,
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
    runtimeReadinessFindings: runtimeReadiness.present
      ? runtimeReadiness.findingsTotal
      : -1,
    runtimeReadinessErrors: runtimeReadiness.errorCount,
    runtimeReadinessWarnings: runtimeReadiness.warnCount,
    runtimeReadinessHasError: runtimeReadiness.hasError,
    migrationCoverageGaps: migrationCoverage.present
      ? migrationCoverage.totalGaps
      : -1,
    migrationCoverageTasksWithGaps: migrationCoverage.tasksWithGaps,
    migrationCoverageTasksTouched: migrationCoverage.tasksTouchedModels,
  });
}
