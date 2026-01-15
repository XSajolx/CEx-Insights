-- =====================================================
-- ADD COLUMNS TO "Service Performance Overview" TABLE
-- =====================================================
-- Run this in Supabase SQL Editor

-- Add all required columns to the existing table
ALTER TABLE "Service Performance Overview" 
ADD COLUMN IF NOT EXISTS conversation_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS channel TEXT,
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS assignee_id TEXT,
ADD COLUMN IF NOT EXISTS assignee_name TEXT,
ADD COLUMN IF NOT EXISTS team_id TEXT,
ADD COLUMN IF NOT EXISTS frt_seconds INTEGER,
ADD COLUMN IF NOT EXISTS art_seconds INTEGER,
ADD COLUMN IF NOT EXISTS aht_seconds INTEGER,
ADD COLUMN IF NOT EXISTS wait_time_seconds INTEGER,
ADD COLUMN IF NOT EXISTS sentiment TEXT,
ADD COLUMN IF NOT EXISTS csat_rating INTEGER,
ADD COLUMN IF NOT EXISTS response_count INTEGER,
ADD COLUMN IF NOT EXISTS is_reopened BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reopened_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS contact_id TEXT,
ADD COLUMN IF NOT EXISTS tags JSONB,
ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT NOW();

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_spo_created_at ON "Service Performance Overview"(created_at);
CREATE INDEX IF NOT EXISTS idx_spo_assignee ON "Service Performance Overview"(assignee_id);
CREATE INDEX IF NOT EXISTS idx_spo_channel ON "Service Performance Overview"(channel);
CREATE INDEX IF NOT EXISTS idx_spo_country ON "Service Performance Overview"(country);
CREATE INDEX IF NOT EXISTS idx_spo_conversation_id ON "Service Performance Overview"(conversation_id);

-- =====================================================
-- RPC FUNCTIONS FOR DASHBOARD
-- =====================================================

-- Get performance summary (for scorecards)
CREATE OR REPLACE FUNCTION get_spo_summary(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_knock_count', COUNT(*),
        'new_conversations', COUNT(*) FILTER (WHERE is_reopened = FALSE OR is_reopened IS NULL),
        'reopened_conversations', COUNT(*) FILTER (WHERE is_reopened = TRUE),
        'avg_frt_seconds', ROUND(AVG(frt_seconds)),
        'avg_art_seconds', ROUND(AVG(art_seconds)),
        'avg_aht_seconds', ROUND(AVG(aht_seconds)),
        'avg_wait_time_seconds', ROUND(AVG(wait_time_seconds)),
        'frt_hit_rate', ROUND(COUNT(*) FILTER (WHERE frt_seconds <= 60)::numeric / NULLIF(COUNT(*) FILTER (WHERE frt_seconds IS NOT NULL), 0) * 100),
        'art_hit_rate', ROUND(COUNT(*) FILTER (WHERE art_seconds <= 120)::numeric / NULLIF(COUNT(*) FILTER (WHERE art_seconds IS NOT NULL), 0) * 100),
        'avg_csat', ROUND(AVG(csat_rating)::numeric, 2)
    ) INTO result
    FROM "Service Performance Overview"
    WHERE created_at >= p_start_date AND created_at <= p_end_date;
    
    RETURN result;
END;
$$;

-- Get daily trend
CREATE OR REPLACE FUNCTION get_spo_daily_trend(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
    date DATE,
    total_conversations BIGINT,
    new_conversations BIGINT,
    reopened_conversations BIGINT,
    avg_frt INTEGER,
    avg_art INTEGER,
    avg_csat NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_conversations,
        COUNT(*) FILTER (WHERE is_reopened = FALSE OR is_reopened IS NULL) as new_conversations,
        COUNT(*) FILTER (WHERE is_reopened = TRUE) as reopened_conversations,
        ROUND(AVG(frt_seconds))::INTEGER as avg_frt,
        ROUND(AVG(art_seconds))::INTEGER as avg_art,
        ROUND(AVG(csat_rating)::numeric, 2) as avg_csat
    FROM "Service Performance Overview"
    WHERE created_at >= p_start_date AND created_at <= p_end_date
    GROUP BY DATE(created_at)
    ORDER BY date;
END;
$$;

-- Get sentiment distribution
CREATE OR REPLACE FUNCTION get_spo_sentiment(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'positive', COUNT(*) FILTER (WHERE LOWER(sentiment) = 'positive'),
        'neutral', COUNT(*) FILTER (WHERE LOWER(sentiment) = 'neutral'),
        'negative', COUNT(*) FILTER (WHERE LOWER(sentiment) = 'negative')
    ) INTO result
    FROM "Service Performance Overview"
    WHERE created_at >= p_start_date AND created_at <= p_end_date;
    
    RETURN result;
END;
$$;

-- Get channel distribution
CREATE OR REPLACE FUNCTION get_spo_channels(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
    channel TEXT,
    count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(s.channel, 'unknown') as channel,
        COUNT(*) as count
    FROM "Service Performance Overview" s
    WHERE s.created_at >= p_start_date AND s.created_at <= p_end_date
    GROUP BY s.channel
    ORDER BY count DESC;
END;
$$;

-- Get volume heatmap
CREATE OR REPLACE FUNCTION get_spo_heatmap(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
    day_of_week INTEGER,
    hour INTEGER,
    total_count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        EXTRACT(DOW FROM created_at)::INTEGER as day_of_week,
        EXTRACT(HOUR FROM created_at)::INTEGER as hour,
        COUNT(*) as total_count
    FROM "Service Performance Overview"
    WHERE created_at >= p_start_date AND created_at <= p_end_date
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour;
END;
$$;

-- Get teammate leaderboard
CREATE OR REPLACE FUNCTION get_spo_teammates(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    assignee_name TEXT,
    conversation_count BIGINT,
    avg_frt INTEGER,
    avg_art INTEGER,
    avg_aht INTEGER,
    frt_hit_rate INTEGER,
    art_hit_rate INTEGER,
    avg_csat NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.assignee_name,
        COUNT(*) as conversation_count,
        ROUND(AVG(s.frt_seconds))::INTEGER as avg_frt,
        ROUND(AVG(s.art_seconds))::INTEGER as avg_art,
        ROUND(AVG(s.aht_seconds))::INTEGER as avg_aht,
        ROUND(COUNT(*) FILTER (WHERE s.frt_seconds <= 60)::numeric / NULLIF(COUNT(*) FILTER (WHERE s.frt_seconds IS NOT NULL), 0) * 100)::INTEGER as frt_hit_rate,
        ROUND(COUNT(*) FILTER (WHERE s.art_seconds <= 120)::numeric / NULLIF(COUNT(*) FILTER (WHERE s.art_seconds IS NOT NULL), 0) * 100)::INTEGER as art_hit_rate,
        ROUND(AVG(s.csat_rating)::numeric, 2) as avg_csat
    FROM "Service Performance Overview" s
    WHERE s.created_at >= p_start_date AND s.created_at <= p_end_date
      AND s.assignee_name IS NOT NULL
    GROUP BY s.assignee_name
    ORDER BY conversation_count DESC
    LIMIT p_limit;
END;
$$;

-- Get country distribution
CREATE OR REPLACE FUNCTION get_spo_countries(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 15
)
RETURNS TABLE (
    country TEXT,
    count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(s.country, 'Unknown') as country,
        COUNT(*) as count
    FROM "Service Performance Overview" s
    WHERE s.created_at >= p_start_date AND s.created_at <= p_end_date
    GROUP BY s.country
    ORDER BY count DESC
    LIMIT p_limit;
END;
$$;

-- Grant permissions
GRANT SELECT ON "Service Performance Overview" TO authenticated;
GRANT SELECT ON "Service Performance Overview" TO anon;

SELECT 'Table columns and functions created successfully!' as status;

