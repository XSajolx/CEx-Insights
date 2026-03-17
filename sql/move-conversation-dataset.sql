-- ============================================================
-- Move data from conversation_dataset to target tables
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Move Chat conversations to "Service Performance Overview"
INSERT INTO "Service Performance Overview" (
    conversation_id, created_at, updated_at, channel, country, state,
    assignee_id, assignee_name, team_id
)
SELECT
    conversation_id, created_at, updated_at, channel, country, state,
    assignee_id, assignee_name, team_id
FROM conversation_dataset
WHERE channel = 'Chat'
  AND conversation_id NOT IN (
      SELECT conversation_id FROM "Service Performance Overview" WHERE conversation_id IS NOT NULL
  );

-- 2. Move Email conversations to "Email - Service Performance Overview"
INSERT INTO "Email - Service Performance Overview" (
    conversation_id, created_at, updated_at, channel, country, state,
    assignee_id, assignee_name, team_id
)
SELECT
    conversation_id, created_at, updated_at, channel, country, state,
    assignee_id, assignee_name, team_id
FROM conversation_dataset
WHERE channel = 'Email'
  AND conversation_id NOT IN (
      SELECT conversation_id FROM "Email - Service Performance Overview" WHERE conversation_id IS NOT NULL
  );

-- 3. Move Instagram conversations to "Service Performance Overview"
INSERT INTO "Service Performance Overview" (
    conversation_id, created_at, updated_at, channel, country, state,
    assignee_id, assignee_name, team_id
)
SELECT
    conversation_id, created_at, updated_at, channel, country, state,
    assignee_id, assignee_name, team_id
FROM conversation_dataset
WHERE channel = 'Instagram'
  AND conversation_id NOT IN (
      SELECT conversation_id FROM "Service Performance Overview" WHERE conversation_id IS NOT NULL
  );

-- 4. Move Facebook conversations to "Service Performance Overview"
INSERT INTO "Service Performance Overview" (
    conversation_id, created_at, updated_at, channel, country, state,
    assignee_id, assignee_name, team_id
)
SELECT
    conversation_id, created_at, updated_at, channel, country, state,
    assignee_id, assignee_name, team_id
FROM conversation_dataset
WHERE channel = 'Facebook'
  AND conversation_id NOT IN (
      SELECT conversation_id FROM "Service Performance Overview" WHERE conversation_id IS NOT NULL
  );

-- 5. Delete moved rows from conversation_dataset
DELETE FROM conversation_dataset
WHERE channel IN ('Chat', 'Email', 'Instagram', 'Facebook')
  AND conversation_id IN (
      SELECT conversation_id FROM "Service Performance Overview" WHERE conversation_id IS NOT NULL
      UNION
      SELECT conversation_id FROM "Email - Service Performance Overview" WHERE conversation_id IS NOT NULL
  );

