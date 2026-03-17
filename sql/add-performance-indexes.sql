-- Speed up dashboard queries on "Service Performance Overview"
-- Run this in Supabase SQL Editor

CREATE INDEX IF NOT EXISTS idx_spo_created_at
    ON "Service Performance Overview" (created_at);

CREATE INDEX IF NOT EXISTS idx_spo_channel
    ON "Service Performance Overview" (channel);

CREATE INDEX IF NOT EXISTS idx_spo_conversation_id
    ON "Service Performance Overview" (conversation_id);

CREATE INDEX IF NOT EXISTS idx_spo_created_channel
    ON "Service Performance Overview" (created_at, channel);
