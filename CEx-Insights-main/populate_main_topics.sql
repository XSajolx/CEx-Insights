-- Update 'Main-Topics' by mapping values from 'Sub-Topics' array
UPDATE "Intercom Topic" t
SET "Main-Topics" = (
  SELECT jsonb_agg(DISTINCT m.main_topic)
  FROM jsonb_array_elements_text(t."Sub-Topics") AS elem
  JOIN "all_topics_with_main" m ON m.topic = elem
)
WHERE t."Sub-Topics" IS NOT NULL 
  AND jsonb_array_length(t."Sub-Topics") > 0;
