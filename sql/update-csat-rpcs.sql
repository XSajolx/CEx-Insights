-- Update csat_metrics RPC to use "CSAT New" table
CREATE OR REPLACE FUNCTION csat_metrics(
    p_date_from TEXT,
    p_date_to TEXT,
    p_prev_from TEXT,
    p_prev_to TEXT,
    p_countries TEXT[] DEFAULT NULL,
    p_products TEXT[] DEFAULT NULL,
    p_channels TEXT[] DEFAULT NULL,
    p_agents TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
DECLARE
    result JSONB;
BEGIN
    WITH cur AS (
        SELECT
            "Conversation rating" AS rating,
            "Concern regarding CEx support (Catagory)" AS cex_cat,
            "Concern regarding product (Catagory)" AS prod_cat
        FROM "CSAT New"
        WHERE "Date" >= p_date_from
          AND "Date" <= p_date_to
          AND "Conversation rating" IS NOT NULL
          AND (p_countries IS NULL OR "Location" = ANY(p_countries))
          AND (p_products IS NULL OR "Product" = ANY(p_products))
    ),
    prev AS (
        SELECT
            "Conversation rating" AS rating,
            "Concern regarding CEx support (Catagory)" AS cex_cat,
            "Concern regarding product (Catagory)" AS prod_cat
        FROM "CSAT New"
        WHERE "Date" >= p_prev_from
          AND "Date" <= p_prev_to
          AND "Conversation rating" IS NOT NULL
          AND (p_countries IS NULL OR "Location" = ANY(p_countries))
          AND (p_products IS NULL OR "Product" = ANY(p_products))
    ),
    cur_stats AS (
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE rating >= 4) AS high,
            COUNT(*) FILTER (WHERE rating <= 2) AS low_org,
            COUNT(*) FILTER (WHERE rating <= 2 AND cex_cat IS NOT NULL AND cex_cat != '' AND cex_cat != 'NULL') AS low_cex,
            COUNT(*) FILTER (WHERE rating <= 2 AND prod_cat IS NOT NULL AND prod_cat != '' AND prod_cat != 'NULL') AS low_prod,
            COUNT(*) FILTER (WHERE rating NOT BETWEEN 1 AND 5) AS invalid,
            ROUND(100.0 * COUNT(*) FILTER (WHERE rating >= 4) / NULLIF(COUNT(*), 0), 2) AS overall_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE rating <= 2 AND cex_cat IS NOT NULL AND cex_cat != '' AND cex_cat != 'NULL') / NULLIF(COUNT(*), 0), 2) AS cex_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE rating <= 2 AND prod_cat IS NOT NULL AND prod_cat != '' AND prod_cat != 'NULL') / NULLIF(COUNT(*), 0), 2) AS prod_pct
        FROM cur
    ),
    prev_stats AS (
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE rating >= 4) AS high,
            COUNT(*) FILTER (WHERE rating <= 2) AS low_org,
            COUNT(*) FILTER (WHERE rating <= 2 AND cex_cat IS NOT NULL AND cex_cat != '' AND cex_cat != 'NULL') AS low_cex,
            COUNT(*) FILTER (WHERE rating <= 2 AND prod_cat IS NOT NULL AND prod_cat != '' AND prod_cat != 'NULL') AS low_prod,
            COUNT(*) FILTER (WHERE rating NOT BETWEEN 1 AND 5) AS invalid,
            ROUND(100.0 * COUNT(*) FILTER (WHERE rating >= 4) / NULLIF(COUNT(*), 0), 2) AS overall_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE rating <= 2 AND cex_cat IS NOT NULL AND cex_cat != '' AND cex_cat != 'NULL') / NULLIF(COUNT(*), 0), 2) AS cex_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE rating <= 2 AND prod_cat IS NOT NULL AND prod_cat != '' AND prod_cat != 'NULL') / NULLIF(COUNT(*), 0), 2) AS prod_pct
        FROM prev
    )
    SELECT jsonb_build_object(
        'overall_pct', COALESCE(c.overall_pct, 0),
        'cex_pct', COALESCE(c.cex_pct, 0),
        'prod_pct', COALESCE(c.prod_pct, 0),
        'total', COALESCE(c.total, 0),
        'high', COALESCE(c.high, 0),
        'low_org', COALESCE(c.low_org, 0),
        'low_cex', COALESCE(c.low_cex, 0),
        'low_prod', COALESCE(c.low_prod, 0),
        'invalid', COALESCE(c.invalid, 0),
        'prev_overall_pct', COALESCE(p.overall_pct, 0),
        'prev_cex_pct', COALESCE(p.cex_pct, 0),
        'prev_prod_pct', COALESCE(p.prod_pct, 0),
        'prev_total', COALESCE(p.total, 0),
        'prev_high', COALESCE(p.high, 0),
        'prev_low_org', COALESCE(p.low_org, 0),
        'prev_low_cex', COALESCE(p.low_cex, 0),
        'prev_low_prod', COALESCE(p.low_prod, 0),
        'prev_invalid', COALESCE(p.invalid, 0)
    ) INTO result
    FROM cur_stats c, prev_stats p;

    RETURN result;
END;
$$;

-- Update csat_support_reasons RPC to use "CSAT New" table
CREATE OR REPLACE FUNCTION csat_support_reasons(
    p_date_from TEXT,
    p_date_to TEXT,
    p_prev_from TEXT,
    p_prev_to TEXT,
    p_countries TEXT[] DEFAULT NULL,
    p_products TEXT[] DEFAULT NULL,
    p_channels TEXT[] DEFAULT NULL,
    p_agents TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
DECLARE
    result JSONB;
BEGIN
    WITH cur AS (
        SELECT "Concern regarding CEx support (Catagory)" AS reason
        FROM "CSAT New"
        WHERE "Date" >= p_date_from
          AND "Date" <= p_date_to
          AND "Conversation rating" IS NOT NULL
          AND "Conversation rating" <= 2
          AND "Concern regarding CEx support (Catagory)" IS NOT NULL
          AND "Concern regarding CEx support (Catagory)" != ''
          AND "Concern regarding CEx support (Catagory)" != 'NULL'
          AND (p_countries IS NULL OR "Location" = ANY(p_countries))
          AND (p_products IS NULL OR "Product" = ANY(p_products))
    ),
    prev AS (
        SELECT "Concern regarding CEx support (Catagory)" AS reason
        FROM "CSAT New"
        WHERE "Date" >= p_prev_from
          AND "Date" <= p_prev_to
          AND "Conversation rating" IS NOT NULL
          AND "Conversation rating" <= 2
          AND "Concern regarding CEx support (Catagory)" IS NOT NULL
          AND "Concern regarding CEx support (Catagory)" != ''
          AND "Concern regarding CEx support (Catagory)" != 'NULL'
          AND (p_countries IS NULL OR "Location" = ANY(p_countries))
          AND (p_products IS NULL OR "Product" = ANY(p_products))
    ),
    cur_counts AS (
        SELECT reason, COUNT(*) AS cnt FROM cur GROUP BY reason
    ),
    prev_counts AS (
        SELECT reason, COUNT(*) AS cnt FROM prev GROUP BY reason
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'reason', COALESCE(c.reason, p.reason),
            'current_count', COALESCE(c.cnt, 0),
            'previous_count', COALESCE(p.cnt, 0),
            'diff', COALESCE(c.cnt, 0) - COALESCE(p.cnt, 0)
        ) ORDER BY COALESCE(c.cnt, 0) DESC
    ), '[]'::jsonb) INTO result
    FROM cur_counts c
    FULL OUTER JOIN prev_counts p ON c.reason = p.reason;

    RETURN result;
END;
$$;
