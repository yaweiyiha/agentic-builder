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
  projects,
  projectStageState,
  projectStepSnapshot,
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

export async function createProject(name: string, clientId?: string): Promise<Project> {
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

  const id = clientId ?? crypto.randomUUID();
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

// ─── Step Snapshots (flat, keyed by stepId) ────────────────────────────────────

/** Per-step snapshot — only contains this step's own data. */
export interface StepSnapshot {
  content?:   string | null;
  metadata?:  Record<string, unknown> | null;
  status?:    string;
  costUsd?:   number;
  durationMs?: number;
  error?:     string | null;
  model?:     string | null;
}

export async function upsertStepSnapshot(
  projectId: string,
  stepId: string,
  snapshot: StepSnapshot,
): Promise<void> {
  await db
    .insert(projectStepSnapshot)
    .values({
      projectId,
      stepId,
      snapshot: snapshot as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [projectStepSnapshot.projectId, projectStepSnapshot.stepId],
      set: {
        snapshot:  snapshot as Record<string, unknown>,
        updatedAt: sql`NOW()`,
      },
    });
}

/** Fetch all step snapshots for a project, returned as { stepId: snapshot, ... }. */
export async function getAllStepSnapshots(
  projectId: string,
): Promise<Record<string, StepSnapshot>> {
  const rows = await db
    .select({ stepId: projectStepSnapshot.stepId, snapshot: projectStepSnapshot.snapshot })
    .from(projectStepSnapshot)
    .where(eq(projectStepSnapshot.projectId, projectId));

  const result: Record<string, StepSnapshot> = {};
  for (const row of rows) {
    result[row.stepId] = row.snapshot as StepSnapshot;
  }
  return result;
}

export async function getStepSnapshot(
  projectId: string,
  stepId: string,
): Promise<StepSnapshot | null> {
  const rows = await db
    .select({ snapshot: projectStepSnapshot.snapshot })
    .from(projectStepSnapshot)
    .where(
      and(
        eq(projectStepSnapshot.projectId, projectId),
        eq(projectStepSnapshot.stepId,    stepId),
      ),
    )
    .limit(1);

  return (rows[0]?.snapshot as StepSnapshot) ?? null;
}

// ─── Sub-Stage Snapshots (legacy, used by pipeline-store) ──────────────────────

/** Full pipeline state persisted per (project, stage, sub-stage). */
export interface SubStageSnapshot {
  featureBrief:  string;
  currentStep:   string | null;
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

export async function upsertSubStageSnapshot(
  projectId: string,
  _stageId: string,
  subStageId: string,
  snapshot: SubStageSnapshot,
): Promise<void> {
  // Map to the flat project_step_snapshot table using subStageId as stepId
  await db
    .insert(projectStepSnapshot)
    .values({
      projectId,
      stepId: subStageId,
      snapshot: snapshot as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [projectStepSnapshot.projectId, projectStepSnapshot.stepId],
      set: {
        snapshot:  snapshot as Record<string, unknown>,
        updatedAt: sql`NOW()`,
      },
    });
}

export async function getSubStageSnapshot(
  projectId: string,
  _stageId: string,
  subStageId: string,
): Promise<SubStageSnapshot | null> {
  const rows = await db
    .select({ snapshot: projectStepSnapshot.snapshot })
    .from(projectStepSnapshot)
    .where(
      and(
        eq(projectStepSnapshot.projectId, projectId),
        eq(projectStepSnapshot.stepId,    subStageId),
      ),
    )
    .limit(1);

  return (rows[0]?.snapshot as SubStageSnapshot) ?? null;
}
