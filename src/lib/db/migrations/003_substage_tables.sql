-- Migration 003: add project_substage_snapshot and project_substage_status tables

CREATE TABLE IF NOT EXISTS project_substage_snapshot (
  project_id   TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id     TEXT        NOT NULL,
  sub_stage_id TEXT        NOT NULL,
  snapshot     JSONB       NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, stage_id, sub_stage_id)
);

CREATE TABLE IF NOT EXISTS project_substage_status (
  project_id   TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id     TEXT        NOT NULL,
  sub_stage_id TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'idle',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  context_refs JSONB       NOT NULL DEFAULT '{}',
  step_ids     TEXT[]      NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, stage_id, sub_stage_id)
);
