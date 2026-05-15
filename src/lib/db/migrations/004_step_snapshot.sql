-- Create the flat per-step snapshot table (keyed by stepId, no stage/subStage)
CREATE TABLE IF NOT EXISTS project_step_snapshot (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id    text NOT NULL,
  snapshot   jsonb NOT NULL DEFAULT '{}',
  updated_at timestamp with time zone NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, step_id)
);
