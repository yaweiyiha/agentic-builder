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

// ─── project_pipeline_state ──────────────────────────────────────────────────

export const projectPipelineState = pgTable("project_pipeline_state", {
  projectId:     text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  featureBrief:  text("feature_brief").notNull().default(""),
  currentStep:   text("current_step"),
  activeTab:     text("active_tab").notNull().default("intent"),
  totalCostUsd:  doublePrecision("total_cost_usd").notNull().default(0),
  isRunning:     boolean("is_running").notNull().default(false),
  fastFromPrd:   boolean("fast_from_prd").notNull().default(true),
  codeOutputDir: text("code_output_dir").notNull().default("generated-code"),
  stepsJson:     jsonb("steps_json").notNull().default({}),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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

// ─── project_substage_status ─────────────────────────────────────────────────

export const projectSubstageStatus = pgTable(
  "project_substage_status",
  {
  projectId:   text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  stageId:     text("stage_id").notNull(),
  subStageId:  text("sub_stage_id").notNull(),
  status:      text("status").notNull().default("idle"),
  startedAt:   timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  contextRefs: jsonb("context_refs").notNull().default({}),
    stepIds:     text("step_ids").array().notNull().default([]),
    updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.stageId, t.subStageId] }),
  ],
);

// ─── Inferred TypeScript types ───────────────────────────────────────────────

export type Project                = typeof projects.$inferSelect;
export type NewProject             = typeof projects.$inferInsert;
export type ProjectPipelineState   = typeof projectPipelineState.$inferSelect;
export type ProjectStageState      = typeof projectStageState.$inferSelect;
export type ProjectSubstageSnapshot = typeof projectSubstageSnapshot.$inferSelect;
export type ProjectSubstageStatus  = typeof projectSubstageStatus.$inferSelect;
