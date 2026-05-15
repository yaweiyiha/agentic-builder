-- Migration 002: add intent conversation columns to project_stage_state
ALTER TABLE project_stage_state
  ADD COLUMN IF NOT EXISTS intent_messages_json  JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS intent_enriched_brief TEXT  NOT NULL DEFAULT '';
