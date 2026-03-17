-- ============================================================
-- Move non-first agent rows from transfer conversations
-- to "Transfer - Service Performance Overview"
-- ============================================================

-- 1. Create the new table with identical columns
CREATE TABLE IF NOT EXISTS "Transfer - Service Performance Overview" (
    id BIGSERIAL PRIMARY KEY,
    conversation_id TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    state TEXT,
    channel TEXT,
    country TEXT,
    assignee_id TEXT,
    assignee_name TEXT,
    team_id TEXT,
    frt_seconds INTEGER,
    art_seconds INTEGER,
    aht_seconds INTEGER,
    wait_time_seconds INTEGER,
    sentiment TEXT,
    csat_rating INTEGER,
    response_count INTEGER,
    is_reopened BOOLEAN,
    reopened_count INTEGER,
    contact_id TEXT,
    tags JSONB,
    synced_at TIMESTAMPTZ,
    "CX score" NUMERIC,
    "Transcript" TEXT,
    "FRT Hit Rate" NUMERIC,
    "ART Hit Rate" NUMERIC,
    "Avg Wait Time" NUMERIC,
    action_performed_by TEXT,
    agent_name TEXT
);

-- 2. Disable RLS on the new table
ALTER TABLE "Transfer - Service Performance Overview" DISABLE ROW LEVEL SECURITY;

-- 3. Insert non-first agent rows into the new table
--    First agent = MIN(id) per conversation_id among transfer conversations
INSERT INTO "Transfer - Service Performance Overview" (
    conversation_id, created_at, updated_at, state, channel, country,
    assignee_id, assignee_name, team_id,
    frt_seconds, art_seconds, aht_seconds, wait_time_seconds,
    sentiment, csat_rating, response_count,
    is_reopened, reopened_count, contact_id, tags, synced_at,
    "CX score", "Transcript", "FRT Hit Rate", "ART Hit Rate", "Avg Wait Time",
    action_performed_by, agent_name
)
SELECT
    conversation_id, created_at, updated_at, state, channel, country,
    assignee_id, assignee_name, team_id,
    frt_seconds, art_seconds, aht_seconds, wait_time_seconds,
    sentiment, csat_rating, response_count,
    is_reopened, reopened_count, contact_id, tags, synced_at,
    "CX score", "Transcript", "FRT Hit Rate", "ART Hit Rate", "Avg Wait Time",
    action_performed_by, agent_name
FROM "Service Performance Overview"
WHERE conversation_id IN (
    SELECT conversation_id
    FROM "Service Performance Overview"
    WHERE conversation_id IS NOT NULL
    GROUP BY conversation_id
    HAVING COUNT(*) > 1
)
AND id NOT IN (
    SELECT MIN(id)
    FROM "Service Performance Overview"
    WHERE conversation_id IS NOT NULL
    GROUP BY conversation_id
    HAVING COUNT(*) > 1
);

-- 4. Delete the moved rows from SPO
DELETE FROM "Service Performance Overview"
WHERE conversation_id IN (
    SELECT conversation_id
    FROM "Service Performance Overview"
    WHERE conversation_id IS NOT NULL
    GROUP BY conversation_id
    HAVING COUNT(*) > 1
)
AND id NOT IN (
    SELECT MIN(id)
    FROM "Service Performance Overview"
    WHERE conversation_id IS NOT NULL
    GROUP BY conversation_id
    HAVING COUNT(*) > 1
);
