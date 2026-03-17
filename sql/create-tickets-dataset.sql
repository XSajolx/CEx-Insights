-- Create tickets_dataset table for Intercom Tickets dataset export
-- Uses JSONB for flexibility since exact columns depend on the export
-- Run this in Supabase SQL Editor before syncing

CREATE TABLE IF NOT EXISTS tickets_dataset (
    id BIGSERIAL PRIMARY KEY,

    -- Core ticket identifiers
    ticket_id TEXT,
    conversation_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    first_response_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,

    -- Ticket metadata
    ticket_type TEXT,
    ticket_category TEXT,
    ticket_state TEXT,
    current_state TEXT,
    channel TEXT,
    priority TEXT,
    source TEXT,

    -- Assignment
    assignee_id TEXT,
    assignee_name TEXT,
    team_id TEXT,
    team_name TEXT,

    -- Contact / User
    user_id TEXT,
    user_name TEXT,
    company_name TEXT,
    country TEXT,

    -- Metrics
    first_response_time TEXT,
    first_response_time_seconds INTEGER,
    handling_time TEXT,
    handling_time_seconds INTEGER,
    time_to_close TEXT,
    time_to_close_seconds INTEGER,
    wait_time TEXT,
    wait_time_seconds INTEGER,
    number_of_reassignments INTEGER,
    teammate_replies_count INTEGER,
    user_replies_count INTEGER,

    -- Rating / Satisfaction
    csat_rating INTEGER,
    last_teammate_rating INTEGER,

    -- Tags & Topics
    tags TEXT,
    topics TEXT,

    -- Sync metadata
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS to allow service-role inserts
ALTER TABLE tickets_dataset DISABLE ROW LEVEL SECURITY;

-- Index on ticket_id for deduplication
CREATE INDEX IF NOT EXISTS idx_tickets_dataset_ticket_id ON tickets_dataset(ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_dataset_created_at ON tickets_dataset(created_at);
