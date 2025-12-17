-- Delete rows where Sub-Topics is NULL or an empty JSON array
DELETE FROM "Intercom Topic"
WHERE "Sub-Topics" IS NULL 
   OR "Sub-Topics" = '[]'::jsonb;
