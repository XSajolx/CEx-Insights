-- =====================================================
-- COMPLETE SETUP: Add columns, disable RLS, import data
-- Run this in Supabase SQL Editor
-- =====================================================

-- Step 1: Add the columns your CSV needs
ALTER TABLE "Intercom topic 01"
  ADD COLUMN IF NOT EXISTS "conversation_id" text,
  ADD COLUMN IF NOT EXISTS "conversation_created_at_bd" text,
  ADD COLUMN IF NOT EXISTS "country" text,
  ADD COLUMN IF NOT EXISTS "last_teammate_rating" text,
  ADD COLUMN IF NOT EXISTS "team_assigned" text,
  ADD COLUMN IF NOT EXISTS "last_teammate_rated" text;

-- Step 2: Disable RLS so we can insert
ALTER TABLE "Intercom topic 01" DISABLE ROW LEVEL SECURITY;

-- Step 3: Verify the table structure
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'Intercom topic 01'
ORDER BY ordinal_position;
