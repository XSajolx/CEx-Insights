-- =====================================================
-- CSAT Average Rating Trend (Time Series)
-- Returns the average conversation rating per date
-- =====================================================
CREATE OR REPLACE FUNCTION csat_avg_rating_trend(
  p_date_from DATE,
  p_date_to DATE,
  p_countries TEXT[] DEFAULT NULL,
  p_products TEXT[] DEFAULT NULL,
  p_channels TEXT[] DEFAULT NULL,
  p_agents TEXT[] DEFAULT NULL
)
RETURNS TABLE(
  date TEXT,
  avg_rating NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    TO_CHAR(to_date("Date", 'MM/DD/YYYY'), 'YYYY-MM-DD') AS date,
    ROUND(AVG("Conversation rating")::numeric, 2) AS avg_rating
  FROM "CSAT"
  WHERE to_date("Date", 'MM/DD/YYYY') BETWEEN p_date_from AND p_date_to
    AND "Conversation rating" IS NOT NULL
    AND "Conversation rating" BETWEEN 1 AND 5
    AND (p_countries IS NULL OR "Location" = ANY(p_countries))
    AND (p_products IS NULL OR "Product" = ANY(p_products))
    AND (p_channels IS NULL OR "Channel" = ANY(p_channels))
    AND (p_agents IS NULL OR "Agent Name
(Auto Update)" = ANY(p_agents))
  GROUP BY to_date("Date", 'MM/DD/YYYY')
  ORDER BY to_date("Date", 'MM/DD/YYYY');
END;
$$ LANGUAGE plpgsql;
