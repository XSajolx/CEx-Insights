-- =====================================================
-- Fixed: Product Dissatisfaction Reasons
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
    SELECT base.reason AS reason, COUNT(*) AS cnt
    FROM base
    WHERE d BETWEEN p_date_from AND p_date_to
      AND rating IN (1,2)
      AND base.reason IS NOT NULL
    GROUP BY base.reason
  ),
  prev AS (
    SELECT base.reason AS reason, COUNT(*) AS cnt
    FROM base
    WHERE d BETWEEN p_prev_from AND p_prev_to
      AND rating IN (1,2)
      AND base.reason IS NOT NULL
    GROUP BY base.reason
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
