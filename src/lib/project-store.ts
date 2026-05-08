/**
 * PostgreSQL-backed project store — powered by Drizzle ORM.
 *
 * NOTE: This module is Node.js-only (runs in API routes / server actions).
 * Configure DATABASE_URL in .env.local, e.g.:
 *   DATABASE_URL=postgresql://localhost:5432/agentic_builder
 */

import { and, desc, eq, like, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  projectPipelineState,
  projects,
  projectStageState,
  projectSubstageSnapshot,
  projectSubstageStatus,
} from "@/lib/db/schema";
import type { Project } from "@/types/project";

// ─── Projects CRUD ────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  const rows = await db
    .select({
      id:        projects.id,
      slug:      projects.slug,
      name:      projects.name,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .orderBy(desc(projects.createdAt));

  return rows as Project[];
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const rows = await db
    .select({
      id:        projects.id,
      slug:      projects.slug,
      name:      projects.name,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  return (rows[0] as Project) ?? null;
}

export async function createProject(name: string): Promise<Project> {
  const baseSlug =
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    `project-${Date.now()}`;

  const existing = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(like(projects.slug, `${baseSlug}%`));

  const taken = new Set(existing.map((r) => r.slug));
  let finalSlug = baseSlug;
  let counter = 2;
  while (taken.has(finalSlug)) {
    finalSlug = `${baseSlug}-${counter++}`;
  }

  const id = crypto.randomUUID();
  const rows = await db
    .insert(projects)
    .values({ id, slug: finalSlug, name: name.trim() })
    .returning({
      id:        projects.id,
      slug:      projects.slug,
      name:      projects.name,
      createdAt: projects.createdAt,
    });

  return rows[0] as Project;
}

export async function updateProjectName(projectId: string, name: string): Promise<void> {
  await db
    .update(projects)
    .set({ name: name.trim() })
    .where(eq(projects.id, projectId));
}

// ─── Pipeline State ───────────────────────────────────────────────────────────

export interface PipelineStateRow {
  featureBrief:  string;
  currentStep:   string | null;
  activeTab:     string;
  totalCostUsd:  number;
  isRunning:     boolean;
  fastFromPrd:   boolean;
  codeOutputDir: string;
  stepsJson:     Record<string, unknown>;
}

export async function getPipelineState(projectId: string): Promise<PipelineStateRow | null> {
  const rows = await db
    .select({
      featureBrief:  projectPipelineState.featureBrief,
      currentStep:   projectPipelineState.currentStep,
      activeTab:     projectPipelineState.activeTab,
      totalCostUsd:  projectPipelineState.totalCostUsd,
      isRunning:     projectPipelineState.isRunning,
      fastFromPrd:   projectPipelineState.fastFromPrd,
      codeOutputDir: projectPipelineState.codeOutputDir,
      stepsJson:     projectPipelineState.stepsJson,
    })
    .from(projectPipelineState)
    .where(eq(projectPipelineState.projectId, projectId))
    .limit(1);

  if (!rows[0]) return null;
  return rows[0] as PipelineStateRow;
}

export async function upsertPipelineState(
  projectId: string,
  state: Partial<PipelineStateRow>,
): Promise<void> {
  const values = {
    projectId,
    featureBrief:  state.featureBrief  ?? "",
    currentStep:   state.currentStep   ?? null,
    activeTab:     state.activeTab     ?? "intent",
    totalCostUsd:  state.totalCostUsd  ?? 0,
    isRunning:     state.isRunning     ?? false,
    fastFromPrd:   state.fastFromPrd   ?? true,
    codeOutputDir: state.codeOutputDir ?? "generated-code",
    stepsJson:     (state.stepsJson    ?? {}) as Record<string, unknown>,
    updatedAt:     new Date(),
  };

  await db
    .insert(projectPipelineState)
    .values(values)
    .onConflictDoUpdate({
      target: projectPipelineState.projectId,
      set: {
        featureBrief:  values.featureBrief,
        currentStep:   values.currentStep,
        activeTab:     values.activeTab,
        totalCostUsd:  values.totalCostUsd,
        isRunning:     values.isRunning,
        fastFromPrd:   values.fastFromPrd,
        codeOutputDir: values.codeOutputDir,
        stepsJson:     values.stepsJson,
        updatedAt:     sql`NOW()`,
      },
    });
}

// ─── Stage State ──────────────────────────────────────────────────────────────

export interface StageStateRow {
  activeStage:         string;
  activeSubStages:     Record<string, string>;
  projectName:         string;
  intentMessages:      unknown[];
  intentEnrichedBrief: string;
}

export async function getStageState(projectId: string): Promise<StageStateRow | null> {
  const rows = await db
    .select({
      activeStage:         projectStageState.activeStage,
      activeSubStages:     projectStageState.activeSubStages,
      projectName:         projectStageState.projectName,
      intentMessages:      projectStageState.intentMessagesJson,
      intentEnrichedBrief: projectStageState.intentEnrichedBrief,
    })
    .from(projectStageState)
    .where(eq(projectStageState.projectId, projectId))
    .limit(1);

  if (!rows[0]) return null;
  return rows[0] as StageStateRow;
}

export async function upsertStageState(
  projectId: string,
  state: Partial<StageStateRow>,
): Promise<void> {
  const values = {
    projectId,
    activeStage:         state.activeStage          ?? "preparation",
    activeSubStages:     (state.activeSubStages      ?? {}) as Record<string, string>,
    projectName:         state.projectName          ?? "New Project",
    intentMessagesJson:  (state.intentMessages       ?? []) as unknown[],
    intentEnrichedBrief: state.intentEnrichedBrief  ?? "",
    updatedAt:           new Date(),
  };

  await db
    .insert(projectStageState)
    .values(values)
    .onConflictDoUpdate({
      target: projectStageState.projectId,
      set: {
        activeStage:         values.activeStage,
        activeSubStages:     values.activeSubStages,
        projectName:         values.projectName,
        intentMessagesJson:  values.intentMessagesJson,
        intentEnrichedBrief: values.intentEnrichedBrief,
        updatedAt:           sql`NOW()`,
      },
    });
}

// ─── Sub-Stage Snapshots ──────────────────────────────────────────────────────

/** Full pipeline state persisted per (project, stage, sub-stage). */
export interface SubStageSnapshot {
  featureBrief:  string;
  currentStep:   string | null;
  activeTab:     string;
  totalCostUsd:  number;
  isRunning:     boolean;
  fastFromPrd:   boolean;
  codeOutputDir: string;
  steps:         Record<string, unknown>;
  designStyles?:           Record<string, unknown>[] | null;
  designStylesLoading?:    boolean;
  designStylesError?:      string | null;
  selectedDesignStyleId?:  string | null;
  intentMessages?:         unknown[];
  intentEnrichedBrief?:    string;
}

// ─── Sub-Stage Status ─────────────────────────────────────────────────────────

export type SubStageStatusValue = "idle" | "running" | "completed" | "error";

export interface SubStageStatusRow {
  stageId:      string;
  subStageId:   string;
  status:       SubStageStatusValue;
  startedAt:    string | null;
  completedAt:  string | null;
  contextRefs:  Record<string, unknown>;
  stepIds:      string[];
  updatedAt:    string;
}

export async function upsertSubStageSnapshot(
  projectId: string,
  stageId: string,
  subStageId: string,
  snapshot: SubStageSnapshot,
): Promise<void> {
  await db
    .insert(projectSubstageSnapshot)
    .values({
      projectId,
      stageId,
      subStageId,
      snapshot: snapshot as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        projectSubstageSnapshot.projectId,
        projectSubstageSnapshot.stageId,
        projectSubstageSnapshot.subStageId,
      ],
      set: {
        snapshot:  snapshot as Record<string, unknown>,
        updatedAt: sql`NOW()`,
      },
    });
}

export async function getSubStageSnapshot(
  projectId: string,
  stageId: string,
  subStageId: string,
): Promise<SubStageSnapshot | null> {
  const rows = await db
    .select({ snapshot: projectSubstageSnapshot.snapshot })
    .from(projectSubstageSnapshot)
    .where(
      and(
        eq(projectSubstageSnapshot.projectId,  projectId),
        eq(projectSubstageSnapshot.stageId,    stageId),
        eq(projectSubstageSnapshot.subStageId, subStageId),
      ),
    )
    .limit(1);

  return (rows[0]?.snapshot as SubStageSnapshot) ?? null;
}

export async function upsertSubStageStatus(
  projectId: string,
  stageId: string,
  subStageId: string,
  status: SubStageStatusValue,
  opts?: {
    contextRefs?: Record<string, unknown>;
    stepIds?: string[];
  },
): Promise<void> {
  const now = new Date();

  await db
    .insert(projectSubstageStatus)
    .values({
      projectId,
      stageId,
      subStageId,
      status,
      contextRefs: (opts?.contextRefs ?? {}) as Record<string, unknown>,
      stepIds:     opts?.stepIds ?? [],
      updatedAt:   now,
      startedAt:   status === "running"   ? now : null,
      completedAt: status === "completed" ? now : null,
    })
    .onConflictDoUpdate({
      target: [
        projectSubstageStatus.projectId,
        projectSubstageStatus.stageId,
        projectSubstageStatus.subStageId,
      ],
      set: {
        status:      status,
        contextRefs: (opts?.contextRefs ?? {}) as Record<string, unknown>,
        stepIds:     opts?.stepIds ?? [],
        updatedAt:   sql`NOW()`,
        ...(status === "running"   ? { startedAt:   sql`NOW()` } : {}),
        ...(status === "completed" ? { completedAt: sql`NOW()` } : {}),
      },
    });
}

export async function getSubStageStatus(
  projectId: string,
  stageId: string,
  subStageId: string,
): Promise<SubStageStatusRow | null> {
  const rows = await db
    .select({
      stageId:     projectSubstageStatus.stageId,
      subStageId:  projectSubstageStatus.subStageId,
      status:      projectSubstageStatus.status,
      startedAt:   projectSubstageStatus.startedAt,
      completedAt: projectSubstageStatus.completedAt,
      contextRefs: projectSubstageStatus.contextRefs,
      stepIds:     projectSubstageStatus.stepIds,
      updatedAt:   projectSubstageStatus.updatedAt,
    })
    .from(projectSubstageStatus)
    .where(
      and(
        eq(projectSubstageStatus.projectId,  projectId),
        eq(projectSubstageStatus.stageId,    stageId),
        eq(projectSubstageStatus.subStageId, subStageId),
      ),
    )
    .limit(1);

  if (!rows[0]) return null;
  const r = rows[0];
  return {
    stageId:     r.stageId,
    subStageId:  r.subStageId,
    status:      r.status as SubStageStatusValue,
    startedAt:   r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    contextRefs: r.contextRefs as Record<string, unknown>,
    stepIds:     r.stepIds ?? [],
    updatedAt:   r.updatedAt.toISOString(),
  };
}

export async function listSubStageStatuses(
  projectId: string,
): Promise<SubStageStatusRow[]> {
  const rows = await db
    .select({
      stageId:     projectSubstageStatus.stageId,
      subStageId:  projectSubstageStatus.subStageId,
      status:      projectSubstageStatus.status,
      startedAt:   projectSubstageStatus.startedAt,
      completedAt: projectSubstageStatus.completedAt,
      contextRefs: projectSubstageStatus.contextRefs,
      stepIds:     projectSubstageStatus.stepIds,
      updatedAt:   projectSubstageStatus.updatedAt,
    })
    .from(projectSubstageStatus)
    .where(eq(projectSubstageStatus.projectId, projectId))
    .orderBy(projectSubstageStatus.updatedAt);

  return rows.map((r) => ({
    stageId:     r.stageId,
    subStageId:  r.subStageId,
    status:      r.status as SubStageStatusValue,
    startedAt:   r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    contextRefs: r.contextRefs as Record<string, unknown>,
    stepIds:     r.stepIds ?? [],
    updatedAt:   r.updatedAt.toISOString(),
  }));
}

const SUB_STAGE_ORDER_BY_STAGE: Record<string, string[]> = {
  preparation: ["initial", "intent", "prd", "trd", "sysdesign", "implguide", "design", "pencil", "mockup", "qa"],
  kickoff:     ["env-setup", "task-breakdown"],
  coding:      ["architect", "backend", "frontend", "test", "verify"],
  preview:     ["serve", "e2e"],
};

export async function getActiveSubStageSnapshot(
  projectId: string,
): Promise<{ stageId: string; subStageId: string; snapshot: SubStageSnapshot | null }> {
  const stageRow = await getStageState(projectId);
  const stageId    = stageRow?.activeStage ?? "preparation";
  const subStageId = (stageRow?.activeSubStages?.[stageId] as string | undefined) ?? "initial";

  const exactSnapshot = await getSubStageSnapshot(projectId, stageId, subStageId);
  if (exactSnapshot) return { stageId, subStageId, snapshot: exactSnapshot };

  const order = SUB_STAGE_ORDER_BY_STAGE[stageId] ?? [];
  const currentIdx = order.indexOf(subStageId);
  for (let i = currentIdx - 1; i >= 0; i--) {
    const prevSnapshot = await getSubStageSnapshot(projectId, stageId, order[i]);
    if (prevSnapshot) {
      return { stageId, subStageId, snapshot: prevSnapshot };
    }
  }

  return { stageId, subStageId, snapshot: null };
}
