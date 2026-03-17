-- =====================================================
-- Conversation Actions table (Intercom Data Export)
-- Run in Supabase SQL Editor once.
-- =====================================================
-- Export: Conversation actions dataset from Intercom
-- Filter: Action performed by = agent only (exclude FundedNext AI)
-- =====================================================

-- Drop if re-creating with updated types
-- DROP TABLE IF EXISTS conversation_actions;

CREATE TABLE IF NOT EXISTS conversation_actions (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT,
  conversation_started_at TEXT,
  channel TEXT,
  last_teammate_rating TEXT,
  fin_ai_agent_rating TEXT,
  conversation_tag TEXT,
  action_performed_by TEXT,
  copilot_used TEXT,
  action_time TEXT,
  team_assigned TEXT,
  teammate_assigned TEXT,
  teammate TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for common filters
CREATE INDEX IF NOT EXISTS idx_ca_conversation_id ON conversation_actions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_ca_action_time ON conversation_actions (action_time);
CREATE INDEX IF NOT EXISTS idx_ca_action_performed_by ON conversation_actions (action_performed_by);

COMMENT ON TABLE conversation_actions IS 'Intercom Conversation actions dataset (agent-only); imported from CSV.';
