/**
 * High-level memory recording helpers.
 *
 * All functions are **fire-and-forget**: they never throw, they swallow
 * errors and log to console. Memory writes must never break the primary
 * pipeline (design doc §12.5.1 写入纪律).
 */

import { getProjectMemory } from "./index";
import { memoryEnabled } from "./env";
import { getTraceLogger } from "./trace";
import type { MemoryRecord, SaveInput } from "./types";

export interface SelfHealLogInput {
  outputDir: string;
  /** Stable session id linking this record to the project card. */
  kickoffId: string;
  stage: string;
  event: string;
  outcome: "fixed" | "progress" | "gave_up" | "other";
  attempt?: number;
  taskId?: string;
  missingIds?: string[];
  repairedIds?: string[];
  stillMissing?: string[];
  files?: string[];
  details?: Record<string, unknown>;
  occurredAt: string;
}

export async function recordSelfHealLog(
  input: SelfHealLogInput,
): Promise<MemoryRecord | null> {
  if (!memoryEnabled()) return null;
  try {
    const store = getProjectMemory(input.outputDir);
    // ID encodes (kickoff, stage, attempt, taskId?) so retries on the same
    // (stage, attempt) idempotently overwrite — useful when an emitter
    // re-emits a "final" event.
    const idParts = [
      "SH",
      input.kickoffId.slice(0, 8),
      input.stage,
      input.attempt ?? "x",
      input.taskId ?? "",
    ].filter(Boolean);
    const id = idParts.join("-");

    const tags = [
      `kickoff:${input.kickoffId}`,
      `stage:${input.stage}`,
      `outcome:${input.outcome}`,
      ...(input.taskId ? [`taskId:${input.taskId}`] : []),
      ...inferFileExtensionTags(input.files),
    ];

    const bodyObj = {
      stage: input.stage,
      event: input.event,
      outcome: input.outcome,
      attempt: input.attempt,
      taskId: input.taskId,
      missingIds: input.missingIds,
      repairedIds: input.repairedIds,
      stillMissing: input.stillMissing,
      files: input.files,
      details: input.details,
      occurredAt: input.occurredAt,
    };

    const saved = await store.save({
      id,
      layer: "L2",
      kind: "self-heal-log",
      title: `${input.stage} · ${input.outcome}${input.attempt ? ` · attempt ${input.attempt}` : ""}`,
      body: JSON.stringify(bodyObj),
      tags,
      source: "self-heal",
      refs: { kickoffId: input.kickoffId, taskId: input.taskId },
    });
    await getTraceLogger(input.outputDir).log({
      op: "save",
      layer: "L2",
      kickoffId: input.kickoffId,
      taskId: input.taskId,
      details: { kind: "self-heal-log", id: saved.id, outcome: input.outcome },
    });
    return saved;
  } catch (err) {
    console.warn("[memory] recordSelfHealLog failed:", (err as Error).message);
    return null;
  }
}

function inferFileExtensionTags(files: string[] | undefined): string[] {
  if (!files || files.length === 0) return [];
  const exts = new Set<string>();
  for (const f of files) {
    const m = f.match(/\.([a-z0-9]+)$/i);
    if (m) exts.add(`ext:${m[1]!.toLowerCase()}`);
  }
  return Array.from(exts).slice(0, 5);
}

export interface ProjectCardInput {
  outputDir: string;
  kickoffId: string;
  brief: string;
  classification?: {
    tier?: "S" | "M" | "L";
    type?: string;
    needsBackend?: boolean;
    needsDatabase?: boolean;
    needsAuth?: boolean;
    reasoning?: string;
  };
  injectedPatternIds?: string[];
}

export interface TaskHistoryInput {
  outputDir: string;
  kickoffId: string;
  taskId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  attempts?: number;
  costUsd?: number;
  durationMs?: number;
  /**
   * Total tokens used by this step. Useful as a backup signal when
   * costUsd is 0 (e.g. static-content paths in engine.ts that don't
   * propagate cost). totalTokens > 0 means the step did real work.
   */
  totalTokens?: number;
  files?: string[];
  errorMessage?: string;
  startedAt?: number;
  endedAt?: number;
  /** Free-form tags added to record.tags (in addition to defaults). */
  tags?: string[];
  /** Human title; defaults to `${taskId} (${status})`. */
  title?: string;
}

export async function recordProjectCard(
  input: ProjectCardInput,
): Promise<MemoryRecord | null> {
  if (!memoryEnabled()) return null;
  try {
    const store = getProjectMemory(input.outputDir);
    const id = `PC-${input.kickoffId}`;
    const body = renderProjectCardMarkdown(input);
    const tags = [
      `kickoff:${input.kickoffId}`,
      ...(input.classification?.tier ? [`tier:${input.classification.tier}`] : []),
      ...(input.classification?.type ? [`type:${input.classification.type}`] : []),
    ];
    const saved = await store.save({
      id,
      layer: "L2",
      kind: "project-card",
      title: `Project card · ${input.kickoffId}`,
      body,
      tags,
      source: "orchestrator",
      refs: { kickoffId: input.kickoffId },
    });
    await getTraceLogger(input.outputDir).log({
      op: "save",
      layer: "L2",
      kickoffId: input.kickoffId,
      details: { kind: "project-card", id: saved.id },
    });
    return saved;
  } catch (err) {
    console.warn("[memory] recordProjectCard failed:", (err as Error).message);
    return null;
  }
}

export async function recordTaskHistory(
  input: TaskHistoryInput,
): Promise<MemoryRecord | null> {
  if (!memoryEnabled()) return null;
  try {
    const store = getProjectMemory(input.outputDir);
    const id = `TH-${input.kickoffId}-${input.taskId}`;
    const bodyObj = {
      status: input.status,
      attempts: input.attempts ?? 1,
      costUsd: input.costUsd,
      durationMs: input.durationMs,
      totalTokens: input.totalTokens,
      files: input.files ?? [],
      errorMessage: input.errorMessage,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    };
    const saveInput: SaveInput = {
      id,
      layer: "L2",
      kind: "task-history",
      title: input.title ?? `${input.taskId} (${input.status})`,
      body: JSON.stringify(bodyObj),
      tags: [
        `kickoff:${input.kickoffId}`,
        `taskId:${input.taskId}`,
        `status:${input.status}`,
        ...(input.tags ?? []),
      ],
      source: "orchestrator",
      refs: { kickoffId: input.kickoffId, taskId: input.taskId },
    };
    const saved = await store.save(saveInput);
    await getTraceLogger(input.outputDir).log({
      op: "save",
      layer: "L2",
      kickoffId: input.kickoffId,
      taskId: input.taskId,
      details: { kind: "task-history", id: saved.id, status: input.status },
    });
    return saved;
  } catch (err) {
    console.warn("[memory] recordTaskHistory failed:", (err as Error).message);
    return null;
  }
}

function renderProjectCardMarkdown(c: ProjectCardInput): string {
  const cls = c.classification ?? {};
  const briefSummary = c.brief.length > 280
    ? c.brief.slice(0, 280) + "…"
    : c.brief;
  return [
    `# Project Card`,
    "",
    `- **kickoff**: ${c.kickoffId}`,
    cls.tier ? `- **tier**: ${cls.tier}` : null,
    cls.type ? `- **type**: ${cls.type}` : null,
    cls.needsBackend !== undefined ? `- **backend**: ${cls.needsBackend}` : null,
    cls.needsDatabase !== undefined ? `- **database**: ${cls.needsDatabase}` : null,
    cls.needsAuth !== undefined ? `- **auth**: ${cls.needsAuth}` : null,
    "",
    `## Brief`,
    "",
    briefSummary,
    cls.reasoning ? `\n## Classification reasoning\n\n${cls.reasoning}` : null,
    c.injectedPatternIds?.length
      ? `\n## Injected L1 patterns\n\n${c.injectedPatternIds.map((id) => `- ${id}`).join("\n")}`
      : null,
  ]
    .filter((x): x is string => x != null)
    .join("\n");
}
