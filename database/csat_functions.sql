-- =====================================================
-- CSAT Dashboard - Supabase RPC Functions
-- =====================================================
-- These functions handle complex CSAT queries with filtering
-- Column names use quotes due to spaces in actual table

-- =====================================================
-- 1. CSAT Metrics (Overall, CEx, Product)
-- =====================================================
CREATE OR REPLACE FUNCTION csat_metrics(
  p_date_from DATE,
  p_date_to DATE,
  p_prev_from DATE,
  p_prev_to DATE,
  p_countries TEXT[] DEFAULT NULL,
  p_products TEXT[] DEFAULT NULL,
  p_channels TEXT[] DEFAULT NULL,
  p_agents TEXT[] DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  cur_valid INT; cur_high INT; cur_low_org INT; cur_low_cex INT; cur_low_prod INT; cur_invalid INT;
  prev_valid INT; prev_high INT; prev_low_org INT; prev_low_cex INT; prev_low_prod INT; prev_invalid INT;
BEGIN
  -- Current Period Metrics
  WITH filtered AS (
    SELECT 
      "Conversation rating",
      "Concern regarding agent",
      "Concern regarding client",
      "Concern regarding product (Catagory)",
      "Concern regarding product (Sub-catagory)"
    FROM "CSAT"
    WHERE to_date("Date", 'MM/DD/YYYY') BETWEEN p_date_from AND p_date_to
      AND (p_countries IS NULL OR "Location" = ANY(p_countries))
      AND (p_products IS NULL OR "Product" = ANY(p_products))
      AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
      AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
  )
  SELECT 
    COUNT(*) FILTER (WHERE "Conversation rating" IN (1,2,3,4,5)),
    COUNT(*) FILTER (WHERE "Conversation rating" IN (4,5)),
    COUNT(*) FILTER (WHERE "Conversation rating" IN (1,2)),
    COUNT(*) FILTER (WHERE "Conversation rating" IN (1,2) 
      AND ("Concern regarding agent" IS NOT NULL OR "Concern regarding client" IS NOT NULL)),
    COUNT(*) FILTER (WHERE "Conversation rating" IN (1,2) 
      AND ("Concern regarding product (Catagory)" IS NOT NULL OR "Concern regarding product (Sub-catagory)" IS NOT NULL)),
    COUNT(*) FILTER (WHERE "Conversation rating" IS NULL 
      OR LOWER("Concern regarding client") LIKE '%invalid%' 
      OR LOWER("Concern regarding client") LIKE '%rating%')
  INTO cur_valid, cur_high, cur_low_org, cur_low_cex, cur_low_prod, cur_invalid
  FROM filtered;

  -- Previous Period Metrics
  WITH filtered AS (
    SELECT 
      "Conversation rating",
      "Concern regarding agent",
      "Concern regarding client",
      "Concern regarding product (Catagory)",
      "Concern regarding product (Sub-catagory)"
    FROM "CSAT"
    WHERE to_date("Date", 'MM/DD/YYYY') BETWEEN p_prev_from AND p_prev_to
      AND (p_countries IS NULL OR "Location" = ANY(p_countries))
      AND (p_products IS NULL OR "Product" = ANY(p_products))
      AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
      AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
  )
  SELECT 
    COUNT(*) FILTER (WHERE "Conversation rating" IN (1,2,3,4,5)),
    COUNT(*) FILTER (WHERE "Conversation rating" IN (4,5)),
    COUNT(*) FILTER (WHERE "Conversation rating" IN (1,2)),
    COUNT(*) FILTER (WHERE "Conversation rating" IN (1,2) 
      AND ("Concern regarding agent" IS NOT NULL OR "Concern regarding client" IS NOT NULL)),
    COUNT(*) FILTER (WHERE "Conversation rating" IN (1,2) 
      AND ("Concern regarding product (Catagory)" IS NOT NULL OR "Concern regarding product (Sub-catagory)" IS NOT NULL)),
    COUNT(*) FILTER (WHERE "Conversation rating" IS NULL 
      OR LOWER("Concern regarding client") LIKE '%invalid%' 
      OR LOWER("Concern regarding client") LIKE '%rating%')
  INTO prev_valid, prev_high, prev_low_org, prev_low_cex, prev_low_prod, prev_invalid
  FROM filtered;

  -- Build JSON result
  result := json_build_object(
    'current', json_build_object(
      'validCSAT', COALESCE(cur_valid, 0),
      'highCSAT', COALESCE(cur_high, 0),
      'lowOrg', COALESCE(cur_low_org, 0),
      'lowCEx', COALESCE(cur_low_cex, 0),
      'lowProd', COALESCE(cur_low_prod, 0),
      'invalid', COALESCE(cur_invalid, 0)
    ),
    'previous', json_build_object(
      'validCSAT', COALESCE(prev_valid, 0),
      'highCSAT', COALESCE(prev_high, 0),
      'lowOrg', COALESCE(prev_low_org, 0),
      'lowCEx', COALESCE(prev_low_cex, 0),
      'lowProd', COALESCE(prev_low_prod, 0),
      'invalid', COALESCE(prev_invalid, 0)
    )
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql;


-- =====================================================
-- 2. Product Dissatisfaction Reasons
-- =====================================================
CREATE OR REPLACE FUNCTION csat_product_reasons(
  p_date_from DATE,
  p_date_to DATE,
  p_prev_from DATE,
  p_prev_to DATE,
  p_countries TEXT[] DEFAULT NULL,
  p_products TEXT[] DEFAULT NULL,
  p_channels TEXT[] DEFAULT NULL,
  p_agents TEXT[] DEFAULT NULL
)
RETURNS TABLE(
  reason TEXT,
  current_count BIGINT,
  previous_count BIGINT,
  diff BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      to_date("Date", 'MM/DD/YYYY') AS d,
      "Conversation rating" AS rating,
      COALESCE(
        NULLIF(TRIM("Concern regarding product (Sub-catagory)"), ''),
        NULLIF(TRIM("Concern regarding product (Catagory)"), '')
      ) AS reason
    FROM "CSAT"
    WHERE (p_countries IS NULL OR "Location" = ANY(p_countries))
      AND (p_products IS NULL OR "Product" = ANY(p_products))
      AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
      AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
  ),
  cur AS (
    SELECT reason, COUNT(*) AS cnt
    FROM base
    WHERE d BETWEEN p_date_from AND p_date_to
      AND rating IN (1,2)
      AND reason IS NOT NULL
    GROUP BY reason
  ),
  prev AS (
    SELECT reason, COUNT(*) AS cnt
    FROM base
    WHERE d BETWEEN p_prev_from AND p_prev_to
      AND rating IN (1,2)
      AND reason IS NOT NULL
    GROUP BY reason
  )
  SELECT
    COALESCE(cur.reason, prev.reason) AS reason,
    COALESCE(cur.cnt, 0) AS current_count,
    COALESCE(prev.cnt, 0) AS previous_count,
    COALESCE(cur.cnt, 0) - COALESCE(prev.cnt, 0) AS diff
  FROM cur
  FULL OUTER JOIN prev ON cur.reason = prev.reason
  WHERE COALESCE(cur.reason, prev.reason) IS NOT NULL
  ORDER BY current_count DESC NULLS LAST
  LIMIT 15;
END;
$$ LANGUAGE plpgsql;


-- =====================================================
-- 3. Support Dissatisfaction Reasons
-- =====================================================
CREATE OR REPLACE FUNCTION csat_support_reasons(
  p_date_from DATE,
  p_date_to DATE,
  p_prev_from DATE,
  p_prev_to DATE,
  p_countries TEXT[] DEFAULT NULL,
  p_products TEXT[] DEFAULT NULL,
  p_channels TEXT[] DEFAULT NULL,
  p_agents TEXT[] DEFAULT NULL
)
RETURNS TABLE(
  reason TEXT,
  current_count BIGINT,
  previous_count BIGINT,
  diff BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      to_date("Date", 'MM/DD/YYYY') AS d,
      "Conversation rating" AS rating,
      COALESCE(
        NULLIF(TRIM("Concern regarding agent"), ''),
        NULLIF(TRIM("Concern regarding client"), '')
      ) AS reason
    FROM "CSAT"
    WHERE (p_countries IS NULL OR "Location" = ANY(p_countries))
      AND (p_products IS NULL OR "Product" = ANY(p_products))
      AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
      AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
  ),
  cur AS (
    SELECT reason, COUNT(*) AS cnt
    FROM base
    WHERE d BETWEEN p_date_from AND p_date_to
      AND rating IN (1,2)
      AND reason IS NOT NULL
    GROUP BY reason
  ),
  prev AS (
    SELECT reason, COUNT(*) AS cnt
    FROM base
    WHERE d BETWEEN p_prev_from AND p_prev_to
      AND rating IN (1,2)
      AND reason IS NOT NULL
    GROUP BY reason
  )
  SELECT
    COALESCE(cur.reason, prev.reason) AS reason,
    COALESCE(cur.cnt, 0) AS current_count,
    COALESCE(prev.cnt, 0) AS previous_count,
    COALESCE(cur.cnt, 0) - COALESCE(prev.cnt, 0) AS diff
  FROM cur
  FULL OUTER JOIN prev ON cur.reason = prev.reason
  WHERE COALESCE(cur.reason, prev.reason) IS NOT NULL
  ORDER BY current_count DESC NULLS LAST
  LIMIT 15;
END;
$$ LANGUAGE plpgsql;


-- =====================================================
-- 4. KYC Issues
-- =====================================================
CREATE OR REPLACE FUNCTION csat_kyc(
  p_date_from DATE,
  p_date_to DATE,
  p_countries TEXT[] DEFAULT NULL,
  p_products TEXT[] DEFAULT NULL,
  p_channels TEXT[] DEFAULT NULL,
  p_agents TEXT[] DEFAULT NULL
)
RETURNS TABLE(
  reason TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(
      NULLIF(TRIM("Concern regarding product (Sub-catagory)"), ''),
      NULLIF(TRIM("Concern regarding product (Catagory)"), '')
    ) AS reason,
    COUNT(*) AS count
  FROM "CSAT"
  WHERE to_date("Date", 'MM/DD/YYYY') BETWEEN p_date_from AND p_date_to
    AND "Conversation rating" IN (1,2)
    AND (
      LOWER("Concern regarding product (Catagory)") LIKE '%kyc%'
      OR LOWER("Concern regarding product (Sub-catagory)") LIKE '%kyc%'
    )
    AND (p_countries IS NULL OR "Location" = ANY(p_countries))
    AND (p_products IS NULL OR "Product" = ANY(p_products))
    AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
    AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
  GROUP BY reason
  ORDER BY count DESC
  LIMIT 15;
END;
$$ LANGUAGE plpgsql;


-- =====================================================
-- 5. Low CSAT Trend (Time Series)
-- =====================================================
CREATE OR REPLACE FUNCTION csat_trend(
  p_date_from DATE,
  p_date_to DATE,
  p_prev_from DATE,
  p_prev_to DATE,
  p_countries TEXT[] DEFAULT NULL,
  p_products TEXT[] DEFAULT NULL,
  p_channels TEXT[] DEFAULT NULL,
  p_agents TEXT[] DEFAULT NULL
)
RETURNS TABLE(
  day DATE,
  current_count BIGINT,
  previous_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d
    FROM generate_series(p_date_from, p_date_to, interval '1 day') gs
  ),
  cur AS (
    SELECT to_date("Date", 'MM/DD/YYYY') AS d, COUNT(*) AS cnt
    FROM "CSAT"
    WHERE to_date("Date", 'MM/DD/YYYY') BETWEEN p_date_from AND p_date_to
      AND "Conversation rating" IN (1,2)
      AND (p_countries IS NULL OR "Location" = ANY(p_countries))
      AND (p_products IS NULL OR "Product" = ANY(p_products))
      AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
      AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
    GROUP BY d
  ),
  prev AS (
    SELECT to_date("Date", 'MM/DD/YYYY') AS d, COUNT(*) AS cnt
    FROM "CSAT"
    WHERE to_date("Date", 'MM/DD/YYYY') BETWEEN p_prev_from AND p_prev_to
      AND "Conversation rating" IN (1,2)
      AND (p_countries IS NULL OR "Location" = ANY(p_countries))
      AND (p_products IS NULL OR "Product" = ANY(p_products))
      AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
      AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
    GROUP BY d
  )
  SELECT 
    days.d AS day,
    COALESCE(cur.cnt, 0) AS current_count,
    COALESCE(prev.cnt, 0) AS previous_count
  FROM days
  LEFT JOIN cur ON cur.d = days.d
  LEFT JOIN prev ON prev.d = (p_prev_from + (days.d - p_date_from))
  ORDER BY days.d;
END;
$$ LANGUAGE plpgsql;


-- =====================================================
-- 6. Low CSAT by Country
-- =====================================================
CREATE OR REPLACE FUNCTION csat_country_low(
  p_date_from DATE,
  p_date_to DATE,
  p_countries TEXT[] DEFAULT NULL,
  p_products TEXT[] DEFAULT NULL,
  p_channels TEXT[] DEFAULT NULL,
  p_agents TEXT[] DEFAULT NULL
)
RETURNS TABLE(
  country TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    "Location" AS country,
    COUNT(*) AS count
  FROM "CSAT"
  WHERE to_date("Date", 'MM/DD/YYYY') BETWEEN p_date_from AND p_date_to
    AND "Conversation rating" IN (1,2)
    AND (p_countries IS NULL OR "Location" = ANY(p_countries))
    AND (p_products IS NULL OR "Product" = ANY(p_products))
    AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
    AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
  GROUP BY "Location"
  ORDER BY count DESC NULLS LAST
  LIMIT 15;
END;
$$ LANGUAGE plpgsql;



-- =====================================================
-- Performance Indexes
-- =====================================================
-- Note: Indexes on computed columns (to_date) are removed as they require IMMUTABLE functions
-- The Date column is stored as text, so we index it directly for string-based filtering
CREATE INDEX IF NOT EXISTS idx_csat_date_text ON "CSAT" ("Date");
CREATE INDEX IF NOT EXISTS idx_csat_rating ON "CSAT" ("Conversation rating");
CREATE INDEX IF NOT EXISTS idx_csat_product ON "CSAT" ("Product");
CREATE INDEX IF NOT EXISTS idx_csat_location ON "CSAT" ("Location");
CREATE INDEX IF NOT EXISTS idx_csat_channel ON "CSAT" ("Channel");
CREATE INDEX IF NOT EXISTS idx_csat_agent ON "CSAT" ("Agent Name
(Auto Update)");

