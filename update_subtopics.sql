-- Update the 'Sub-Topics' column by combining 'Topic 1', 'Topic 2', and 'Topic 3' into a JSONB array.
-- We use NULLIF to treat empty strings as NULL, and then array_remove (or jsonb subtraction) to clean up the result.

UPDATE "Intercom Topic"
SET "Sub-Topics" = (
  SELECT jsonb_agg(elem)
  FROM (
    SELECT unnest(ARRAY[
      NULLIF("Topic 1", ''), 
      NULLIF("Topic 2", ''), 
      NULLIF("Topic 3", '')
    ]) AS elem
  ) t
  WHERE elem IS NOT NULL
);
