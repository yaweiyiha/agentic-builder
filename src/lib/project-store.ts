/**
 * PostgreSQL-backed project store.
 * Replaces the previous in-memory store.
 *
 * NOTE: This module is Node.js-only (runs in API routes / server actions).
 * Configure DATABASE_URL in .env.local, e.g.:
 *   DATABASE_URL=postgresql://localhost:5432/agentic_builder
 */

import { db } from "@/lib/db/client";
import type { Project } from "@/types/project";

// ─── Auto-init tables (runs lazily on first query) ────────────────────────────
const _g = globalThis as typeof globalThis & { __dbInitPromise?: Promise<void> };

async function ensureTablesExist(): Promise<void> {
  if (_g.__dbInitPromise) return _g.__dbInitPromise;
  _g.__dbInitPromise = db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT        PRIMARY KEY,
      slug       TEXT        NOT NULL UNIQUE,
      name       TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS project_pipeline_state (
      project_id      TEXT        PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      feature_brief   TEXT        NOT NULL DEFAULT '',
      current_step    TEXT,
      active_tab      TEXT        NOT NULL DEFAULT 'intent',
      total_cost_usd  FLOAT8      NOT NULL DEFAULT 0,
      is_running      BOOLEAN     NOT NULL DEFAULT FALSE,
      fast_from_prd   BOOLEAN     NOT NULL DEFAULT TRUE,
      code_output_dir TEXT        NOT NULL DEFAULT 'generated-code',
      steps_json      JSONB       NOT NULL DEFAULT '{}',
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS project_stage_state (
      project_id        TEXT        PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      active_stage      TEXT        NOT NULL DEFAULT 'preparation',
      active_sub_stages JSONB       NOT NULL DEFAULT '{}',
      project_name      TEXT        NOT NULL DEFAULT 'New Project',
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE project_stage_state
      ADD COLUMN IF NOT EXISTS intent_messages_json  JSONB NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS intent_enriched_brief TEXT  NOT NULL DEFAULT '';
  `).then(() => undefined).catch((err) => {
    // Reset so next request retries init.
    _g.__dbInitPromise = undefined;
    throw err;
  });
  return _g.__dbInitPromise;
}

// ─── Projects CRUD ────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  await ensureTablesExist();
  const { rows } = await db.query<{ id: string; slug: string; name: string; createdAt: string }>(
    `SELECT id, slug, name, created_at AS "createdAt" FROM projects ORDER BY created_at DESC`,
  );
  return rows;
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  await ensureTablesExist();
  const { rows } = await db.query<{ id: string; slug: string; name: string; createdAt: string }>(
    `SELECT id, slug, name, created_at AS "createdAt" FROM projects WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function createProject(name: string): Promise<Project> {
  await ensureTablesExist();
  const baseSlug =
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    `project-${Date.now()}`;

  // Ensure slug uniqueness
  const { rows: existing } = await db.query<{ slug: string }>(
    "SELECT slug FROM projects WHERE slug LIKE $1",
    [`${baseSlug}%`],
  );
  const taken = new Set(existing.map((r) => r.slug));
  let finalSlug = baseSlug;
  let counter = 2;
  while (taken.has(finalSlug)) {
    finalSlug = `${baseSlug}-${counter++}`;
  }

  const id = crypto.randomUUID();
  const { rows } = await db.query<{ id: string; slug: string; name: string; createdAt: string }>(
    `INSERT INTO projects (id, slug, name)
     VALUES ($1, $2, $3)
     RETURNING id, slug, name, created_at AS "createdAt"`,
    [id, finalSlug, name.trim()],
  );
  return rows[0];
}

export async function updateProjectName(projectId: string, name: string): Promise<void> {
  await ensureTablesExist();
  await db.query(
    `UPDATE projects SET name = $1 WHERE id = $2`,
    [name.trim(), projectId],
  );
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
  await ensureTablesExist();
  const { rows } = await db.query(
    `SELECT
       feature_brief   AS "featureBrief",
       current_step    AS "currentStep",
       active_tab      AS "activeTab",
       total_cost_usd  AS "totalCostUsd",
       is_running      AS "isRunning",
       fast_from_prd   AS "fastFromPrd",
       code_output_dir AS "codeOutputDir",
       steps_json      AS "stepsJson"
     FROM project_pipeline_state
     WHERE project_id = $1`,
    [projectId],
  );
  return rows[0] ?? null;
}

export async function upsertPipelineState(
  projectId: string,
  state: Partial<PipelineStateRow>,
): Promise<void> {
  await ensureTablesExist();
  await db.query(
    `INSERT INTO project_pipeline_state
       (project_id, feature_brief, current_step, active_tab, total_cost_usd,
        is_running, fast_from_prd, code_output_dir, steps_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (project_id) DO UPDATE SET
       feature_brief   = EXCLUDED.feature_brief,
       current_step    = EXCLUDED.current_step,
       active_tab      = EXCLUDED.active_tab,
       total_cost_usd  = EXCLUDED.total_cost_usd,
       is_running      = EXCLUDED.is_running,
       fast_from_prd   = EXCLUDED.fast_from_prd,
       code_output_dir = EXCLUDED.code_output_dir,
       steps_json      = EXCLUDED.steps_json,
       updated_at      = NOW()`,
    [
      projectId,
      state.featureBrief  ?? "",
      state.currentStep   ?? null,
      state.activeTab     ?? "intent",
      state.totalCostUsd  ?? 0,
      state.isRunning     ?? false,
      state.fastFromPrd   ?? true,
      state.codeOutputDir ?? "generated-code",
      JSON.stringify(state.stepsJson ?? {}),
    ],
  );
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
  await ensureTablesExist();
  const { rows } = await db.query(
    `SELECT
       active_stage            AS "activeStage",
       active_sub_stages       AS "activeSubStages",
       project_name            AS "projectName",
       intent_messages_json    AS "intentMessages",
       intent_enriched_brief   AS "intentEnrichedBrief"
     FROM project_stage_state
     WHERE project_id = $1`,
    [projectId],
  );
  return rows[0] ?? null;
}

export async function upsertStageState(
  projectId: string,
  state: Partial<StageStateRow>,
): Promise<void> {
  await ensureTablesExist();
  await db.query(
    `INSERT INTO project_stage_state
       (project_id, active_stage, active_sub_stages, project_name,
        intent_messages_json, intent_enriched_brief, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (project_id) DO UPDATE SET
       active_stage          = EXCLUDED.active_stage,
       active_sub_stages     = EXCLUDED.active_sub_stages,
       project_name          = EXCLUDED.project_name,
       intent_messages_json  = EXCLUDED.intent_messages_json,
       intent_enriched_brief = EXCLUDED.intent_enriched_brief,
       updated_at            = NOW()`,
    [
      projectId,
      state.activeStage          ?? "preparation",
      JSON.stringify(state.activeSubStages  ?? {}),
      state.projectName          ?? "New Project",
      JSON.stringify(state.intentMessages   ?? []),
      state.intentEnrichedBrief  ?? "",
    ],
  );
}
