/**
 * Drizzle ORM schema — single source of truth for all database tables.
 * Run `pnpm db:generate` to produce migrations from this file.
 * Run `pnpm db:migrate` to apply pending migrations.
 */

import {
  boolean,
  doublePrecision,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ─── projects ────────────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id:        text("id").primaryKey(),
  slug:      text("slug").notNull().unique(),
  name:      text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── project_stage_state ─────────────────────────────────────────────────────

export const projectStageState = pgTable("project_stage_state", {
  projectId:           text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  activeStage:         text("active_stage").notNull().default("preparation"),
  activeSubStages:     jsonb("active_sub_stages").notNull().default({}),
  projectName:         text("project_name").notNull().default("New Project"),
  intentMessagesJson:  jsonb("intent_messages_json").notNull().default([]),
  intentEnrichedBrief: text("intent_enriched_brief").notNull().default(""),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── project_substage_snapshot ───────────────────────────────────────────────

export const projectSubstageSnapshot = pgTable(
  "project_substage_snapshot",
  {
    projectId:  text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stageId:    text("stage_id").notNull(),
    subStageId: text("sub_stage_id").notNull(),
    snapshot:   jsonb("snapshot").notNull().default({}),
    updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.stageId, t.subStageId] }),
  ],
);

// ─── project_step_navigation ─────────────────────────────────────────────────
// Tracks which step each project is currently on (source of truth for page.tsx)

export const projectStepNavigation = pgTable("project_step_navigation", {
  projectId:   text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  activeStep:  text("active_step").notNull().default("initial"),
  tier:        text("tier").notNull().default("M"),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── project_step_artifacts ──────────────────────────────────────────────────
// Records input/output artifacts for each step execution per project

export const projectStepArtifacts = pgTable(
  "project_step_artifacts",
  {
    projectId:  text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stepId:     text("step_id").notNull(),
    runIndex:   text("run_index").notNull().default("0"),
    status:     text("status").notNull().default("idle"),  // idle | running | completed | failed
    input:      jsonb("input").notNull().default({}),
    output:     jsonb("output").notNull().default({}),
    costUsd:    doublePrecision("cost_usd").notNull().default(0),
    durationMs: doublePrecision("duration_ms").notNull().default(0),
    model:      text("model"),
    traceId:    text("trace_id"),
    error:      text("error"),
    startedAt:  timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.stepId, t.runIndex] }),
  ],
);

// ─── Inferred TypeScript types ───────────────────────────────────────────────

export type Project                 = typeof projects.$inferSelect;
export type NewProject              = typeof projects.$inferInsert;
export type ProjectStageState       = typeof projectStageState.$inferSelect;
export type ProjectSubstageSnapshot = typeof projectSubstageSnapshot.$inferSelect;
export type ProjectStepNavigation   = typeof projectStepNavigation.$inferSelect;
export type ProjectStepArtifact     = typeof projectStepArtifacts.$inferSelect;
