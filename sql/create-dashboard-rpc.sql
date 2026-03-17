-- Dashboard aggregation function — runs entirely in PostgreSQL
-- Returns all dashboard data as a single JSON object
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION get_dashboard_data(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_channel TEXT DEFAULT NULL,
    p_country TEXT DEFAULT NULL,
    p_sentiment TEXT DEFAULT NULL,
    p_agent TEXT DEFAULT NULL,
    p_product TEXT DEFAULT NULL,
    p_metric TEXT DEFAULT 'FRT'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
DECLARE
    result JSONB;
    v_summary JSONB;
    v_trend JSONB;
    v_sentiment JSONB;
    v_channels JSONB;
    v_heatmap JSONB;
    v_teammates JSONB;
    v_countries JSONB;
    v_active_hours JSONB;
    v_timeseries JSONB;
    v_row_count INT;
    v_days INT;
    v_product_pattern TEXT;
BEGIN
    v_days := GREATEST(1, EXTRACT(EPOCH FROM (p_end_date - p_start_date)) / 86400)::INT;
    -- Map product filter to team_id pattern: 'CFD' -> '%(CFD)%', 'Futures' -> '%(FUT)%'
    IF p_product = 'CFD' THEN v_product_pattern := '%(CFD)%';
    ELSIF p_product = 'Futures' THEN v_product_pattern := '%(FUT)%';
    ELSE v_product_pattern := NULL;
    END IF;

    -- Common filter: exclude agents flagged exclude_from_metrics from ALL counts
    -- Used via: AND NOT COALESCE(m.exclude_from_metrics, false)  [joined sections]
    -- Or via:   AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)  [non-joined sections]

    -- Summary
    SELECT jsonb_build_object(
        'total_knock_count', COUNT(DISTINCT s.conversation_id),
        'new_conversations', COUNT(DISTINCT s.conversation_id) FILTER (WHERE NOT COALESCE(s.is_reopened, false)),
        'reopened_conversations', COUNT(DISTINCT s.conversation_id) FILTER (WHERE s.is_reopened = true),
        'avg_frt_seconds', ROUND(AVG(s.frt_seconds) FILTER (WHERE s.assignee_id != 'FIN' AND s.frt_seconds IS NOT NULL)),
        'avg_art_seconds', ROUND(AVG(s.art_seconds) FILTER (WHERE s.assignee_id != 'FIN' AND s.art_seconds IS NOT NULL)),
        'avg_aht_seconds', ROUND(AVG(s.aht_seconds) FILTER (WHERE s.assignee_id != 'FIN' AND s.aht_seconds IS NOT NULL)),
        'avg_wait_time_seconds', ROUND((SELECT AVG(wt) FROM (SELECT DISTINCT ON (conversation_id) "Avg Wait Time" AS wt FROM "Service Performance Overview" WHERE created_at >= p_start_date AND created_at <= p_end_date AND "Avg Wait Time" IS NOT NULL AND (p_channel IS NULL OR channel = p_channel) AND (p_country IS NULL OR country ILIKE '%' || p_country || '%') AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%') AND (p_agent IS NULL OR agent_name = p_agent) AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern) AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)) sub)),
        'avg_csat', ROUND((SELECT AVG(cx)::NUMERIC FROM (SELECT DISTINCT ON (conversation_id) "CX score" AS cx FROM "Service Performance Overview" WHERE created_at >= p_start_date AND created_at <= p_end_date AND "CX score" IS NOT NULL AND (p_channel IS NULL OR channel = p_channel) AND (p_country IS NULL OR country ILIKE '%' || p_country || '%') AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%') AND (p_agent IS NULL OR agent_name = p_agent) AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern) AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)) sub), 1),
        'frt_hit_rate', (SELECT ROUND(COUNT(*) FILTER (WHERE sp."FRT Hit Rate" = 0)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) FROM "Service Performance Overview" sp WHERE sp.created_at >= p_start_date AND sp.created_at <= p_end_date AND sp.assignee_id != 'FIN' AND sp."FRT Hit Rate" IS NOT NULL AND (p_channel IS NULL OR sp.channel = p_channel) AND (p_country IS NULL OR sp.country ILIKE '%' || p_country || '%') AND (p_sentiment IS NULL OR sp.sentiment ILIKE '%' || p_sentiment || '%') AND (p_agent IS NULL OR sp.agent_name = p_agent) AND (v_product_pattern IS NULL OR sp.team_id ILIKE v_product_pattern) AND sp.action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)),
        'art_hit_rate', (SELECT ROUND(100 - AVG(sp."ART Hit Rate")::NUMERIC, 1) FROM "Service Performance Overview" sp WHERE sp.created_at >= p_start_date AND sp.created_at <= p_end_date AND sp.assignee_id != 'FIN' AND sp."ART Hit Rate" IS NOT NULL AND (p_channel IS NULL OR sp.channel = p_channel) AND (p_country IS NULL OR sp.country ILIKE '%' || p_country || '%') AND (p_sentiment IS NULL OR sp.sentiment ILIKE '%' || p_sentiment || '%') AND (p_agent IS NULL OR sp.agent_name = p_agent) AND (v_product_pattern IS NULL OR sp.team_id ILIKE v_product_pattern) AND sp.action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true))
    ) INTO v_summary
    FROM "Service Performance Overview" s
    LEFT JOIN agent_name_mapping m ON s.action_performed_by = m.intercom_name
    WHERE s.created_at >= p_start_date AND s.created_at <= p_end_date
        AND NOT COALESCE(m.exclude_from_metrics, false)
        AND (p_channel IS NULL OR s.channel = p_channel)
        AND (p_country IS NULL OR s.country ILIKE '%' || p_country || '%')
        AND (p_sentiment IS NULL OR s.sentiment ILIKE '%' || p_sentiment || '%')
        AND (p_agent IS NULL OR s.agent_name = p_agent)
        AND (v_product_pattern IS NULL OR s.team_id ILIKE v_product_pattern);

    -- Row count
    SELECT COUNT(*) INTO v_row_count
    FROM "Service Performance Overview"
    WHERE created_at >= p_start_date AND created_at <= p_end_date
        AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)
        AND (p_channel IS NULL OR channel = p_channel)
        AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
        AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%')
        AND (p_agent IS NULL OR agent_name = p_agent)
        AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern);

    -- Daily trend (unique conversations per day)
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date), '[]'::jsonb) INTO v_trend
    FROM (
        SELECT TO_CHAR(created_at, 'Mon DD') AS date,
               COUNT(DISTINCT conversation_id) AS total,
               COUNT(DISTINCT conversation_id) FILTER (WHERE NOT COALESCE(is_reopened, false)) AS new,
               COUNT(DISTINCT conversation_id) FILTER (WHERE is_reopened = true) AS reopened
        FROM "Service Performance Overview"
        WHERE created_at >= p_start_date AND created_at <= p_end_date
            AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)
            AND (p_channel IS NULL OR channel = p_channel)
            AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
            AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%')
            AND (p_agent IS NULL OR agent_name = p_agent)
            AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern)
        GROUP BY TO_CHAR(created_at, 'Mon DD'), created_at::date
        ORDER BY created_at::date
    ) t;

    -- Sentiment distribution
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', s.sentiment, 'value', s.cnt, 'color',
        CASE s.sentiment WHEN 'Positive' THEN '#10B981' WHEN 'Neutral' THEN '#6366F1' WHEN 'Negative' THEN '#EF4444' ELSE '#94A3B8' END
    )), '[]'::jsonb) INTO v_sentiment
    FROM (
        SELECT sentiment, COUNT(DISTINCT conversation_id) AS cnt
        FROM "Service Performance Overview"
        WHERE created_at >= p_start_date AND created_at <= p_end_date AND sentiment IS NOT NULL
            AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)
            AND (p_channel IS NULL OR channel = p_channel)
            AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
            AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%')
            AND (p_agent IS NULL OR agent_name = p_agent)
            AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern)
        GROUP BY sentiment
    ) s;

    -- Channel distribution
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', CASE LOWER(c.channel) WHEN 'chat' THEN 'Live Chat' WHEN 'live_chat' THEN 'Live Chat' WHEN 'email' THEN 'Email' WHEN 'instagram' THEN 'Instagram' WHEN 'facebook' THEN 'Facebook' WHEN 'telegram' THEN 'Telegram' ELSE COALESCE(c.channel, 'Other') END,
        'value', c.cnt,
        'color', CASE LOWER(c.channel) WHEN 'chat' THEN '#38BDF8' WHEN 'live_chat' THEN '#38BDF8' WHEN 'email' THEN '#A78BFA' WHEN 'instagram' THEN '#F472B6' WHEN 'facebook' THEN '#60A5FA' WHEN 'telegram' THEN '#34D399' ELSE '#94A3B8' END
    ) ORDER BY c.cnt DESC), '[]'::jsonb) INTO v_channels
    FROM (
        SELECT COALESCE(channel, 'unknown') AS channel, COUNT(DISTINCT conversation_id) AS cnt
        FROM "Service Performance Overview"
        WHERE created_at >= p_start_date AND created_at <= p_end_date
            AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)
            AND (p_channel IS NULL OR channel = p_channel)
            AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
            AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%')
            AND (p_agent IS NULL OR agent_name = p_agent)
            AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern)
        GROUP BY channel
    ) c;

    -- Heatmap (day-of-week x hour)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'dayIdx', d.dow, 'day', CASE d.dow WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat' END,
        'hour', d.hr, 'value', d.cnt
    )), '[]'::jsonb) INTO v_heatmap
    FROM (
        SELECT EXTRACT(DOW FROM created_at)::INT AS dow, EXTRACT(HOUR FROM created_at)::INT AS hr, COUNT(DISTINCT conversation_id) AS cnt
        FROM "Service Performance Overview"
        WHERE created_at >= p_start_date AND created_at <= p_end_date
            AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)
            AND (p_channel IS NULL OR channel = p_channel)
            AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
            AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%')
            AND (p_agent IS NULL OR agent_name = p_agent)
            AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern)
        GROUP BY dow, hr
    ) d;

    -- Teammate leaderboard (top 20, shows real agent name)
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.conversations DESC), '[]'::jsonb) INTO v_teammates
    FROM (
        SELECT COALESCE(mp.agent_name, sp.assignee_name) AS name,
               COUNT(DISTINCT sp.conversation_id) AS conversations,
               ROUND(AVG(sp.frt_seconds) FILTER (WHERE sp.frt_seconds IS NOT NULL)) AS "FRT",
               ROUND(AVG(sp.art_seconds) FILTER (WHERE sp.art_seconds IS NOT NULL)) AS "ART",
               ROUND(AVG(sp.aht_seconds) FILTER (WHERE sp.aht_seconds IS NOT NULL)) AS "AHT",
               CASE WHEN COUNT(*) FILTER (WHERE sp."FRT Hit Rate" IS NOT NULL) > 0
                    THEN ROUND(COUNT(*) FILTER (WHERE sp."FRT Hit Rate" = 0)::NUMERIC / COUNT(*) FILTER (WHERE sp."FRT Hit Rate" IS NOT NULL) * 100)
                    ELSE NULL END AS "FRT Hit Rate",
               CASE WHEN COUNT(*) FILTER (WHERE sp."ART Hit Rate" IS NOT NULL) > 0
                    THEN ROUND(100 - AVG(sp."ART Hit Rate") FILTER (WHERE sp."ART Hit Rate" IS NOT NULL)::NUMERIC)
                    ELSE NULL END AS "ART Hit Rate",
               CASE WHEN COUNT(*) FILTER (WHERE sp."CX score" IS NOT NULL) > 0
                    THEN ROUND(AVG(sp."CX score") FILTER (WHERE sp."CX score" IS NOT NULL)::NUMERIC, 1)
                    ELSE NULL END AS "CSAT"
        FROM "Service Performance Overview" sp
        LEFT JOIN agent_name_mapping mp ON sp.action_performed_by = mp.intercom_name
        WHERE sp.created_at >= p_start_date AND sp.created_at <= p_end_date
            AND sp.assignee_id != 'FIN'
            AND NOT COALESCE(mp.exclude_from_metrics, false)
            AND (p_channel IS NULL OR sp.channel = p_channel)
            AND (p_country IS NULL OR sp.country ILIKE '%' || p_country || '%')
            AND (p_sentiment IS NULL OR sp.sentiment ILIKE '%' || p_sentiment || '%')
            AND (p_agent IS NULL OR sp.agent_name = p_agent)
            AND (v_product_pattern IS NULL OR sp.team_id ILIKE v_product_pattern)
        GROUP BY COALESCE(mp.agent_name, sp.assignee_name)
        ORDER BY COUNT(DISTINCT sp.conversation_id) DESC
        LIMIT 20
    ) t;

    -- Country distribution (top 15)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', c.country, 'knockCount', c.cnt) ORDER BY c.cnt DESC), '[]'::jsonb) INTO v_countries
    FROM (
        SELECT country, COUNT(DISTINCT conversation_id) AS cnt
        FROM "Service Performance Overview"
        WHERE created_at >= p_start_date AND created_at <= p_end_date AND country IS NOT NULL
            AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)
            AND (p_channel IS NULL OR channel = p_channel)
            AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
            AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%')
            AND (p_agent IS NULL OR agent_name = p_agent)
            AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern)
        GROUP BY country
        ORDER BY cnt DESC
        LIMIT 15
    ) c;

    -- Active hours
    SELECT COALESCE(jsonb_agg(jsonb_build_object('hour', h.hr || ':00', 'avgActive', ROUND(h.cnt::NUMERIC / v_days)) ORDER BY h.hr), '[]'::jsonb) INTO v_active_hours
    FROM (
        SELECT EXTRACT(HOUR FROM created_at)::INT AS hr, COUNT(DISTINCT conversation_id) AS cnt
        FROM "Service Performance Overview"
        WHERE created_at >= p_start_date AND created_at <= p_end_date
            AND action_performed_by NOT IN (SELECT intercom_name FROM agent_name_mapping WHERE exclude_from_metrics = true)
            AND (p_channel IS NULL OR channel = p_channel)
            AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
            AND (p_sentiment IS NULL OR sentiment ILIKE '%' || p_sentiment || '%')
            AND (p_agent IS NULL OR agent_name = p_agent)
            AND (v_product_pattern IS NULL OR team_id ILIKE v_product_pattern)
        GROUP BY hr
    ) h;

    -- Performance timeseries (excluding FIN and excluded agents)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', t.date,
        p_metric, CASE p_metric
            WHEN 'FRT' THEN t.avg_frt
            WHEN 'ART' THEN t.avg_art
            WHEN 'AHT' THEN t.avg_aht
            WHEN 'Wait Time' THEN t.avg_wait
            WHEN 'FRT Hit Rate' THEN t.frt_hit
            WHEN 'ART Hit Rate' THEN t.art_hit
            WHEN 'CSAT' THEN t.avg_csat
            ELSE t.avg_frt
        END
    ) ORDER BY t.d), '[]'::jsonb) INTO v_timeseries
    FROM (
        SELECT TO_CHAR(sp.created_at, 'Mon DD') AS date,
               sp.created_at::date AS d,
               ROUND(AVG(sp.frt_seconds) FILTER (WHERE sp.frt_seconds IS NOT NULL)) AS avg_frt,
               ROUND(AVG(sp.art_seconds) FILTER (WHERE sp.art_seconds IS NOT NULL)) AS avg_art,
               ROUND(AVG(sp.aht_seconds) FILTER (WHERE sp.aht_seconds IS NOT NULL)) AS avg_aht,
               ROUND(AVG(sp."Avg Wait Time") FILTER (WHERE sp."Avg Wait Time" IS NOT NULL)) AS avg_wait,
               CASE WHEN COUNT(*) FILTER (WHERE sp."FRT Hit Rate" IS NOT NULL) > 0
                    THEN ROUND(COUNT(*) FILTER (WHERE sp."FRT Hit Rate" = 0)::NUMERIC / COUNT(*) FILTER (WHERE sp."FRT Hit Rate" IS NOT NULL) * 100)
                    ELSE NULL END AS frt_hit,
               CASE WHEN COUNT(*) FILTER (WHERE sp."ART Hit Rate" IS NOT NULL) > 0
                    THEN ROUND(100 - AVG(sp."ART Hit Rate") FILTER (WHERE sp."ART Hit Rate" IS NOT NULL)::NUMERIC)
                    ELSE NULL END AS art_hit,
               CASE WHEN COUNT(*) FILTER (WHERE sp."CX score" IS NOT NULL) > 0
                    THEN ROUND(AVG(sp."CX score") FILTER (WHERE sp."CX score" IS NOT NULL)::NUMERIC, 1)
                    ELSE NULL END AS avg_csat
        FROM "Service Performance Overview" sp
        LEFT JOIN agent_name_mapping mp ON sp.action_performed_by = mp.intercom_name
        WHERE sp.created_at >= p_start_date AND sp.created_at <= p_end_date
            AND sp.assignee_id != 'FIN'
            AND NOT COALESCE(mp.exclude_from_metrics, false)
            AND (p_channel IS NULL OR sp.channel = p_channel)
            AND (p_country IS NULL OR sp.country ILIKE '%' || p_country || '%')
            AND (p_sentiment IS NULL OR sp.sentiment ILIKE '%' || p_sentiment || '%')
            AND (p_agent IS NULL OR sp.agent_name = p_agent)
            AND (v_product_pattern IS NULL OR sp.team_id ILIKE v_product_pattern)
        GROUP BY TO_CHAR(sp.created_at, 'Mon DD'), sp.created_at::date
        ORDER BY sp.created_at::date
    ) t;

    result := jsonb_build_object(
        'success', true,
        'rowCount', v_row_count,
        'summary', v_summary,
        'trend', v_trend,
        'sentiment', v_sentiment,
        'channels', v_channels,
        'heatmap', v_heatmap,
        'teammates', v_teammates,
        'countries', v_countries,
        'activeHours', v_active_hours,
        'timeseries', v_timeseries
    );

    RETURN result;
END;
$$;

-- Helper: find conversation_ids with multiple agent rows (transfer chats)
CREATE OR REPLACE FUNCTION get_transfer_conversation_ids(p_limit INT DEFAULT 50)
RETURNS TABLE(conversation_id TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT s.conversation_id
    FROM "Service Performance Overview" s
    WHERE s.conversation_id IS NOT NULL
    GROUP BY s.conversation_id
    HAVING COUNT(*) > 1
    LIMIT p_limit;
$$;
