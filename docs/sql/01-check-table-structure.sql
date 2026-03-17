-- =====================================================
-- STEP 1: Check your table structure
-- Run this first to see your column names
-- =====================================================

-- See all columns in your "Intercom topic 01" table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'Intercom topic 01'
ORDER BY ordinal_position;

-- =====================================================
-- Expected output will show something like:
-- column_name         | data_type | is_nullable
-- --------------------+-----------+-------------
-- conversation_id     | text      | NO
-- created_at_bd       | text      | YES
-- country             | text      | YES
-- ... etc
-- =====================================================
