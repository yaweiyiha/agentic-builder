-- Migration 001: initial schema
-- Run once: npx tsx src/lib/db/migrate.ts

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
