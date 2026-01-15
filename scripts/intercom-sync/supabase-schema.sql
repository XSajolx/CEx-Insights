-- =====================================================
-- SUPABASE SCHEMA FOR SERVICE PERFORMANCE DASHBOARD
-- =====================================================
-- Run this SQL in your Supabase SQL Editor to create the required tables

-- 1. Individual Conversation Metrics Table
CREATE TABLE IF NOT EXISTS service_conversations (
    id SERIAL PRIMARY KEY,
    conversation_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ,
    state TEXT,
    channel TEXT,
    
    -- Contact info
    contact_id TEXT,
    contact_country TEXT,
    
    -- Assignee info
    assignee_id TEXT,
    assignee_name TEXT,
    team_id TEXT,
    
    -- Performance Metrics
    frt_seconds INTEGER,           -- First Response Time in seconds
    art_seconds INTEGER,           -- Average Response Time in seconds
    aht_seconds INTEGER,           -- Average Handle Time in seconds
    wait_time_seconds INTEGER,     -- Wait time to connect
    
    -- Quality Metrics
    sentiment TEXT,                -- Positive, Neutral, Negative
    csat_rating INTEGER,           -- 1-5 rating
    response_count INTEGER,        -- Number of responses
    
    -- Status
    is_reopened BOOLEAN DEFAULT FALSE,
    reopened_count INTEGER DEFAULT 0,
    
    -- Raw data for debugging
    raw_data JSONB,
    
    -- Timestamps
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_service_conversations_created_at ON service_conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_service_conversations_assignee ON service_conversations(assignee_id);
CREATE INDEX IF NOT EXISTS idx_service_conversations_channel ON service_conversations(channel);
CREATE INDEX IF NOT EXISTS idx_service_conversations_country ON service_conversations(contact_country);

-- 2. Daily Aggregated Metrics Table
CREATE TABLE IF NOT EXISTS service_daily_metrics (
    id SERIAL PRIMARY KEY,
    date DATE UNIQUE NOT NULL,
    
    -- Conversation Counts
    total_conversations INTEGER DEFAULT 0,
    new_conversations INTEGER DEFAULT 0,
    reopened_conversations INTEGER DEFAULT 0,
    
    -- Average Metrics
    avg_frt_seconds INTEGER,
    avg_art_seconds INTEGER,
    avg_aht_seconds INTEGER,
    avg_wait_time_seconds INTEGER,
    
    -- Hit Rates (percentage)
    frt_hit_rate INTEGER,          -- % of conversations with FRT under target
    art_hit_rate INTEGER,          -- % of conversations with ART under target
    
    -- Quality Metrics
    avg_csat DECIMAL(3,2),
    
    -- Distributions (JSON)
    sentiment_distribution JSONB,  -- {"positive": 10, "neutral": 20, "negative": 5}
    channel_distribution JSONB,    -- {"live_chat": 25, "email": 10, ...}
    hourly_distribution JSONB,     -- {"0": 5, "1": 3, ...} for heatmap
    
    -- Timestamps
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_daily_metrics_date ON service_daily_metrics(date);

-- 3. Teammate Performance Metrics Table
CREATE TABLE IF NOT EXISTS service_teammate_metrics (
    id SERIAL PRIMARY KEY,
    assignee_id TEXT NOT NULL,
    assignee_name TEXT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Conversation Count
    conversation_count INTEGER DEFAULT 0,
    
    -- Average Metrics
    avg_frt_seconds INTEGER,
    avg_art_seconds INTEGER,
    avg_aht_seconds INTEGER,
    
    -- Hit Rates
    frt_hit_rate INTEGER,
    art_hit_rate INTEGER,
    
    -- Quality Metrics
    avg_csat DECIMAL(3,2),
    positive_sentiment_count INTEGER DEFAULT 0,
    neutral_sentiment_count INTEGER DEFAULT 0,
    negative_sentiment_count INTEGER DEFAULT 0,
    
    -- Timestamps
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(assignee_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_service_teammate_metrics_assignee ON service_teammate_metrics(assignee_id);
CREATE INDEX IF NOT EXISTS idx_service_teammate_metrics_period ON service_teammate_metrics(period_start, period_end);

-- 4. Hourly Volume Table (for Heatmap)
CREATE TABLE IF NOT EXISTS service_hourly_volume (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday
    
    conversation_count INTEGER DEFAULT 0,
    unassigned_count INTEGER DEFAULT 0,  -- For backlog heatmap
    
    UNIQUE(date, hour)
);

CREATE INDEX IF NOT EXISTS idx_service_hourly_volume_date ON service_hourly_volume(date);

-- 5. Country/Region Metrics Table
CREATE TABLE IF NOT EXISTS service_country_metrics (
    id SERIAL PRIMARY KEY,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    country TEXT NOT NULL,
    region TEXT,
    
    conversation_count INTEGER DEFAULT 0,
    avg_frt_seconds INTEGER,
    avg_csat DECIMAL(3,2),
    
    UNIQUE(period_start, period_end, country)
);

-- =====================================================
-- RPC FUNCTIONS FOR EFFICIENT DATA RETRIEVAL
-- =====================================================

-- Get Service Performance Summary (for scorecards)
CREATE OR REPLACE FUNCTION get_service_performance_summary(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_knock_count', COALESCE(SUM(total_conversations), 0),
        'new_conversations', COALESCE(SUM(new_conversations), 0),
        'reopened_conversations', COALESCE(SUM(reopened_conversations), 0),
        'avg_frt_seconds', ROUND(AVG(avg_frt_seconds)),
        'avg_art_seconds', ROUND(AVG(avg_art_seconds)),
        'avg_aht_seconds', ROUND(AVG(avg_aht_seconds)),
        'avg_wait_time_seconds', ROUND(AVG(avg_wait_time_seconds)),
        'frt_hit_rate', ROUND(AVG(frt_hit_rate)),
        'art_hit_rate', ROUND(AVG(art_hit_rate)),
        'avg_csat', ROUND(AVG(avg_csat)::numeric, 2)
    ) INTO result
    FROM service_daily_metrics
    WHERE date >= p_start_date AND date <= p_end_date;
    
    RETURN result;
END;
$$;

-- Get Daily Trend Data
CREATE OR REPLACE FUNCTION get_service_daily_trend(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    date DATE,
    total_conversations INTEGER,
    new_conversations INTEGER,
    reopened_conversations INTEGER,
    avg_frt_seconds INTEGER,
    avg_art_seconds INTEGER,
    avg_csat DECIMAL
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.date,
        d.total_conversations,
        d.new_conversations,
        d.reopened_conversations,
        d.avg_frt_seconds,
        d.avg_art_seconds,
        d.avg_csat
    FROM service_daily_metrics d
    WHERE d.date >= p_start_date AND d.date <= p_end_date
    ORDER BY d.date;
END;
$$;

-- Get Teammate Leaderboard
CREATE OR REPLACE FUNCTION get_service_teammate_leaderboard(
    p_start_date DATE,
    p_end_date DATE,
    p_metric TEXT DEFAULT 'conversation_count',
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    assignee_id TEXT,
    assignee_name TEXT,
    conversation_count INTEGER,
    avg_frt_seconds INTEGER,
    avg_art_seconds INTEGER,
    avg_aht_seconds INTEGER,
    frt_hit_rate INTEGER,
    art_hit_rate INTEGER,
    avg_csat DECIMAL
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.assignee_id,
        t.assignee_name,
        t.conversation_count,
        t.avg_frt_seconds,
        t.avg_art_seconds,
        t.avg_aht_seconds,
        t.frt_hit_rate,
        t.art_hit_rate,
        t.avg_csat
    FROM service_teammate_metrics t
    WHERE t.period_start >= p_start_date AND t.period_end <= p_end_date
    ORDER BY 
        CASE p_metric
            WHEN 'conversation_count' THEN t.conversation_count
            WHEN 'frt' THEN -t.avg_frt_seconds  -- Lower is better
            WHEN 'art' THEN -t.avg_art_seconds
            WHEN 'csat' THEN t.avg_csat::integer * 100
            ELSE t.conversation_count
        END DESC NULLS LAST
    LIMIT p_limit;
END;
$$;

-- Get Sentiment Distribution
CREATE OR REPLACE FUNCTION get_service_sentiment_distribution(
    p_start_date DATE,
    p_end_date DATE
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
    FROM service_conversations
    WHERE created_at >= p_start_date AND created_at <= p_end_date + INTERVAL '1 day';
    
    RETURN result;
END;
$$;

-- Get Channel Distribution
CREATE OR REPLACE FUNCTION get_service_channel_distribution(
    p_start_date DATE,
    p_end_date DATE
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
        COALESCE(c.channel, 'unknown') as channel,
        COUNT(*) as count
    FROM service_conversations c
    WHERE c.created_at >= p_start_date AND c.created_at <= p_end_date + INTERVAL '1 day'
    GROUP BY c.channel
    ORDER BY count DESC;
END;
$$;

-- Get Hourly Heatmap Data
CREATE OR REPLACE FUNCTION get_service_volume_heatmap(
    p_start_date DATE,
    p_end_date DATE
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
        EXTRACT(DOW FROM c.created_at)::INTEGER as day_of_week,
        EXTRACT(HOUR FROM c.created_at)::INTEGER as hour,
        COUNT(*) as total_count
    FROM service_conversations c
    WHERE c.created_at >= p_start_date AND c.created_at <= p_end_date + INTERVAL '1 day'
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour;
END;
$$;

-- Get Country Distribution
CREATE OR REPLACE FUNCTION get_service_country_distribution(
    p_start_date DATE,
    p_end_date DATE,
    p_limit INTEGER DEFAULT 10
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
        COALESCE(c.contact_country, 'Unknown') as country,
        COUNT(*) as count
    FROM service_conversations c
    WHERE c.created_at >= p_start_date AND c.created_at <= p_end_date + INTERVAL '1 day'
    GROUP BY c.contact_country
    ORDER BY count DESC
    LIMIT p_limit;
END;
$$;

-- =====================================================
-- GRANTS (Adjust based on your security needs)
-- =====================================================
-- Grant access to authenticated users (or anon if needed)
GRANT SELECT ON service_conversations TO authenticated;
GRANT SELECT ON service_daily_metrics TO authenticated;
GRANT SELECT ON service_teammate_metrics TO authenticated;
GRANT SELECT ON service_hourly_volume TO authenticated;
GRANT SELECT ON service_country_metrics TO authenticated;

-- For the sync script (service role has full access by default)
-- No additional grants needed for service_role

COMMENT ON TABLE service_conversations IS 'Individual conversation metrics synced from Intercom';
COMMENT ON TABLE service_daily_metrics IS 'Daily aggregated metrics for Service Performance dashboard';
COMMENT ON TABLE service_teammate_metrics IS 'Teammate performance metrics for leaderboard';

