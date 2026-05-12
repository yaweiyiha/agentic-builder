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
  projectSubstageSnapshot,
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

// ─── Sub-Stage Snapshots ──────────────────────────────────────────────────────

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
