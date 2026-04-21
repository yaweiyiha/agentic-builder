import fs from "fs/promises";
import path from "path";
import type { GeneratedFile } from "@/lib/langgraph/state";
import type { AuditTaskSummary, FeatureChecklistAuditResult } from "@/lib/pipeline/self-heal";

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

async function readRepairEventSummary(
  outputDir: string,
): Promise<RepairEventSummary> {
  const filePath = path.join(outputDir, ".ralph", "repair-log.jsonl");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const byStage: Record<string, number> = {};
    const byEvent: Record<string, number> = {};
    let totalEvents = 0;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as {
          stage?: string;
          event?: string;
        };
        totalEvents += 1;
        if (parsed.stage) byStage[parsed.stage] = (byStage[parsed.stage] ?? 0) + 1;
        if (parsed.event) byEvent[parsed.event] = (byEvent[parsed.event] ?? 0) + 1;
      } catch {
        // Ignore malformed lines; report generation must stay best-effort.
      }
    }
    return { totalEvents, byStage, byEvent };
  } catch {
    return { totalEvents: 0, byStage: {}, byEvent: {} };
  }
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

function scoreCodingSession(input: {
  status: "pass" | "fail" | "aborted";
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
  uncoveredCount: number;
  taskResults: AuditTaskSummary[];
  repairSummary: RepairEventSummary;
}): ScoreBreakdown {
  let score = 100;
  const reasons: string[] = [];
  if (input.status !== "pass") {
    score -= input.status === "aborted" ? 30 : 20;
    reasons.push(`Run status is ${input.status}.`);
  }
  if (input.integrationErrors?.trim()) {
    score -= 20;
    reasons.push("Integration verification still has blocking errors.");
  }
  if (input.runtimeVerifyErrors?.trim()) {
    score -= 15;
    reasons.push("Runtime verification still has blocking errors.");
  }
  if (input.e2eVerifyErrors?.trim()) {
    score -= 20;
    reasons.push("E2E verification still has blocking errors.");
  }
  if (input.uncoveredCount > 0) {
    const penalty = Math.min(25, input.uncoveredCount);
    score -= penalty;
    reasons.push(`${input.uncoveredCount} PRD requirement id(s) remain uncovered.`);
  }
  const failedTasks = input.taskResults.filter((task) => task.status === "failed").length;
  if (failedTasks > 0) {
    score -= Math.min(15, failedTasks * 5);
    reasons.push(`${failedTasks} coding task(s) failed.`);
  }
  const unknownTasks = input.taskResults.filter((task) => task.status === "unknown").length;
  if (unknownTasks > 0) {
    score -= Math.min(10, unknownTasks * 2);
    reasons.push(`${unknownTasks} coding task(s) never produced a final status.`);
  }
  const truncationSignals = input.repairSummary.byEvent.doc_truncated ?? 0;
  if (truncationSignals > 0) {
    score -= Math.min(8, truncationSignals * 2);
    reasons.push(`Context truncation happened ${truncationSignals} time(s).`);
  }
  const planUnfulfilledSignals =
    input.repairSummary.byEvent.task_plan_unfulfilled ?? 0;
  if (planUnfulfilledSignals > 0) {
    score -= Math.min(8, planUnfulfilledSignals * 2);
    reasons.push(
      `Task plan/file-plan mismatches happened ${planUnfulfilledSignals} time(s).`,
    );
  }

  score = Math.max(0, Math.min(100, score));
  const grade =
    score >= 90
      ? "A"
      : score >= 80
        ? "B"
        : score >= 70
          ? "C"
          : score >= 60
            ? "D"
            : "F";
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
  taskResults: AuditTaskSummary[];
  fileRegistry: GeneratedFile[];
  repairSummary: RepairEventSummary;
  finalAudit?: FeatureChecklistAuditResult | null;
  fatalError?: string;
  suggestions: string[];
  integrationErrors?: string;
  runtimeVerifyErrors?: string;
  e2eVerifyErrors?: string;
}): string {
  const completed = input.taskResults.filter((task) => task.status === "completed").length;
  const warnings = input.taskResults.filter(
    (task) => task.status === "completed_with_warnings",
  ).length;
  const failed = input.taskResults.filter((task) => task.status === "failed").length;
  const unknown = input.taskResults.filter((task) => task.status === "unknown").length;
  const totalCostUsd = input.modelUsage.reduce((sum, entry) => sum + entry.costUsd, 0);
  const totalCalls = input.modelUsage.reduce((sum, entry) => sum + entry.calls, 0);
  const uncoveredIds = input.finalAudit?.uncovered.map((entry) => entry.id) ?? [];

  const lines: string[] = [
    "# Coding Session Report",
    "",
    `- Session ID: \`${input.sessionId}\``,
    `- Status: **${input.status.toUpperCase()}**`,
    `- Score: **${input.score.score}/100 (${input.score.grade})**`,
    `- Started at: ${input.startedAt}`,
    `- Ended at: ${input.endedAt}`,
    `- Total LLM calls: ${totalCalls}`,
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

  lines.push("## Quality Gates");
  lines.push(
    `- Integration verify: ${input.integrationErrors?.trim() ? "FAIL" : "PASS"}`,
  );
  lines.push(
    `- Runtime verify: ${input.runtimeVerifyErrors?.trim() ? "FAIL" : "PASS"}`,
  );
  lines.push(`- E2E verify: ${input.e2eVerifyErrors?.trim() ? "FAIL" : "PASS"}`);
  lines.push(
    `- Feature audit: ${
      input.finalAudit
        ? input.finalAudit.passed
          ? "PASS"
          : `FAIL (${uncoveredIds.length} uncovered)`
        : "UNKNOWN"
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
  const repairSummary = await readRepairEventSummary(input.outputDir);
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

  const jsonPayload = {
    sessionId: input.sessionId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    status: input.status,
    terminalSummary: input.terminalSummary,
    fatalError: input.fatalError ?? "",
    score,
    gateErrors: {
      integrationErrors: input.integrationErrors ?? "",
      runtimeVerifyErrors: input.runtimeVerifyErrors ?? "",
      e2eVerifyErrors: input.e2eVerifyErrors ?? "",
    },
    taskResults: input.taskResults,
    fileRegistryCount: input.fileRegistry.length,
    modelUsage,
    repairSummary,
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
    taskResults: input.taskResults,
    fileRegistry: input.fileRegistry,
    repairSummary,
    finalAudit: input.finalAudit,
    fatalError: input.fatalError,
    suggestions,
    integrationErrors: input.integrationErrors,
    runtimeVerifyErrors: input.runtimeVerifyErrors,
    e2eVerifyErrors: input.e2eVerifyErrors,
  });

  const latestJsonPath = path.join(ralphDir, "coding-session-report.json");
  const latestMdPath = path.join(ralphDir, "coding-session-report.md");
  const sessionJsonPath = path.join(
    ralphDir,
    `coding-session-report.${input.sessionId}.json`,
  );
  const sessionMdPath = path.join(
    ralphDir,
    `coding-session-report.${input.sessionId}.md`,
  );

  await Promise.all([
    fs.writeFile(latestJsonPath, JSON.stringify(jsonPayload, null, 2), "utf-8"),
    fs.writeFile(latestMdPath, markdown, "utf-8"),
    fs.writeFile(sessionJsonPath, JSON.stringify(jsonPayload, null, 2), "utf-8"),
    fs.writeFile(sessionMdPath, markdown, "utf-8"),
  ]);
}
