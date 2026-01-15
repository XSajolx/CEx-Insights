/**
 * Service Performance API Functions
 * 
 * Fetches data from Supabase for the Service Performance Overview dashboard
 */

import { supabase } from './supabaseClient';

// ============ HELPER FUNCTIONS ============

/**
 * Calculate date range based on filter
 */
export const getDateRange = (dateRange = 'last_30_days') => {
    const now = new Date();
    let startDate, endDate;
    
    endDate = now.toISOString().split('T')[0];
    
    switch (dateRange) {
        case 'today':
            startDate = endDate;
            break;
        case 'last_7_days':
            startDate = new Date(now.setDate(now.getDate() - 7)).toISOString().split('T')[0];
            break;
        case 'last_30_days':
            startDate = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
            break;
        case 'last_90_days':
            startDate = new Date(now.setDate(now.getDate() - 90)).toISOString().split('T')[0];
            break;
        default:
            // Custom range: "custom_2024-01-01_2024-01-31"
            if (dateRange.startsWith('custom_')) {
                const parts = dateRange.split('_');
                startDate = parts[1];
                endDate = parts[2];
            } else {
                startDate = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
            }
    }
    
    return { startDate, endDate };
};

/**
 * Format seconds to human readable time
 */
export const formatTime = (seconds) => {
    if (!seconds) return '-';
    
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
};

// ============ API FUNCTIONS ============

/**
 * Fetch performance summary (scorecards)
 */
export const fetchPerformanceSummary = async (filters = {}) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        const { data, error } = await supabase.rpc('get_spo_summary', {
            p_start_date: startDate,
            p_end_date: endDate
        });
        
        if (error) throw error;
        
        return data || {
            total_knock_count: 0,
            new_conversations: 0,
            reopened_conversations: 0,
            avg_frt_seconds: null,
            avg_art_seconds: null,
            avg_aht_seconds: null,
            avg_wait_time_seconds: null,
            frt_hit_rate: null,
            art_hit_rate: null,
            avg_csat: null
        };
    } catch (error) {
        console.error('Error fetching performance summary:', error);
        throw error;
    }
};

/**
 * Fetch daily trend data (for timeseries charts)
 */
export const fetchDailyTrend = async (filters = {}) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        const { data, error } = await supabase.rpc('get_spo_daily_trend', {
            p_start_date: startDate,
            p_end_date: endDate
        });
        
        if (error) throw error;
        
        return (data || []).map(row => ({
            date: row.date,
            total: row.total_conversations || 0,
            new: row.new_conversations || 0,
            reopened: row.reopened_conversations || 0,
            frt: row.avg_frt_seconds,
            art: row.avg_art_seconds,
            csat: row.avg_csat ? parseFloat(row.avg_csat) : null
        }));
    } catch (error) {
        console.error('Error fetching daily trend:', error);
        throw error;
    }
};

/**
 * Fetch sentiment distribution
 */
export const fetchSentimentDistribution = async (filters = {}) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        const { data, error } = await supabase.rpc('get_spo_sentiment', {
            p_start_date: startDate,
            p_end_date: endDate
        });
        
        if (error) throw error;
        
        return [
            { name: 'Positive', value: data?.positive || 0, color: '#10B981' },
            { name: 'Neutral', value: data?.neutral || 0, color: '#6366F1' },
            { name: 'Negative', value: data?.negative || 0, color: '#EF4444' }
        ];
    } catch (error) {
        console.error('Error fetching sentiment distribution:', error);
        throw error;
    }
};

/**
 * Fetch channel distribution
 */
export const fetchChannelDistribution = async (filters = {}) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        const { data, error } = await supabase.rpc('get_spo_channels', {
            p_start_date: startDate,
            p_end_date: endDate
        });
        
        if (error) throw error;
        
        const colors = {
            'live_chat': '#38BDF8',
            'email': '#A78BFA',
            'instagram': '#F472B6',
            'facebook': '#60A5FA',
            'telegram': '#34D399',
            'unknown': '#94A3B8'
        };
        
        return (data || []).map(row => ({
            name: formatChannelName(row.channel),
            value: parseInt(row.count) || 0,
            color: colors[row.channel?.toLowerCase()] || '#94A3B8'
        }));
    } catch (error) {
        console.error('Error fetching channel distribution:', error);
        throw error;
    }
};

/**
 * Format channel name for display
 */
const formatChannelName = (channel) => {
    const names = {
        'live_chat': 'Live Chat',
        'email': 'Email',
        'instagram': 'Instagram',
        'facebook': 'Facebook',
        'telegram': 'Telegram',
        'in_app': 'In-App',
        'unknown': 'Other'
    };
    return names[channel?.toLowerCase()] || channel || 'Other';
};

/**
 * Fetch volume heatmap data
 */
export const fetchVolumeHeatmap = async (filters = {}) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        const { data, error } = await supabase.rpc('get_spo_heatmap', {
            p_start_date: startDate,
            p_end_date: endDate
        });
        
        if (error) throw error;
        
        // Transform to heatmap format
        return (data || []).map(row => ({
            dayIdx: row.day_of_week,
            day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][row.day_of_week],
            hour: row.hour,
            value: parseInt(row.total_count) || 0
        }));
    } catch (error) {
        console.error('Error fetching volume heatmap:', error);
        throw error;
    }
};

/**
 * Fetch teammate leaderboard
 */
export const fetchTeammateLeaderboard = async (filters = {}, metric = 'conversation_count', limit = 20) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        const { data, error } = await supabase.rpc('get_spo_teammates', {
            p_start_date: startDate,
            p_end_date: endDate,
            p_limit: limit
        });
        
        if (error) throw error;
        
        return (data || []).map(row => ({
            name: row.assignee_name || 'Unknown',
            conversations: row.conversation_count || 0,
            FRT: row.avg_frt,
            ART: row.avg_art,
            AHT: row.avg_aht,
            'FRT Hit Rate': row.frt_hit_rate,
            'ART Hit Rate': row.art_hit_rate,
            CSAT: row.avg_csat ? parseFloat(row.avg_csat) : null
        }));
    } catch (error) {
        console.error('Error fetching teammate leaderboard:', error);
        throw error;
    }
};

/**
 * Fetch country distribution
 */
export const fetchCountryDistribution = async (filters = {}, limit = 15) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        const { data, error } = await supabase.rpc('get_spo_countries', {
            p_start_date: startDate,
            p_end_date: endDate,
            p_limit: limit
        });
        
        if (error) throw error;
        
        return (data || []).map(row => ({
            name: row.country || 'Unknown',
            knockCount: parseInt(row.count) || 0
        }));
    } catch (error) {
        console.error('Error fetching country distribution:', error);
        throw error;
    }
};

/**
 * Fetch performance metric timeseries (for the dropdown chart)
 */
export const fetchPerformanceTimeseries = async (filters = {}, metric = 'FRT') => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        // Use the daily trend RPC and transform it
        const { data, error } = await supabase.rpc('get_spo_daily_trend', {
            p_start_date: startDate,
            p_end_date: endDate
        });
        
        if (error) throw error;
        
        const metricMap = {
            'FRT': 'avg_frt',
            'ART': 'avg_art',
            'AHT': 'avg_aht',
            'CSAT': 'avg_csat'
        };
        
        const dbColumn = metricMap[metric] || 'avg_frt';
        
        return (data || []).map(row => ({
            date: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            [metric]: row[dbColumn] ? (metric === 'CSAT' ? parseFloat(row[dbColumn]) : parseInt(row[dbColumn])) : null
        }));
    } catch (error) {
        console.error('Error fetching performance timeseries:', error);
        throw error;
    }
};

/**
 * Fetch active hours distribution
 */
export const fetchActiveHours = async (filters = {}) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        // Use heatmap data and aggregate by hour
        const { data, error } = await supabase.rpc('get_spo_heatmap', {
            p_start_date: startDate,
            p_end_date: endDate
        });
        
        if (error) throw error;
        
        // Aggregate by hour across all days
        const hourCounts = Array(24).fill(0);
        (data || []).forEach(row => {
            hourCounts[row.hour] += parseInt(row.total_count) || 0;
        });
        
        // Calculate days in range for average
        const days = Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)));
        
        return hourCounts.map((count, hour) => ({
            hour: `${hour}:00`,
            avgActive: Math.round(count / days)
        }));
    } catch (error) {
        console.error('Error fetching active hours:', error);
        throw error;
    }
};

/**
 * Check if service performance data exists
 */
export const checkDataExists = async () => {
    try {
        const { count, error } = await supabase
            .from('Service Performance Overview')
            .select('*', { count: 'exact', head: true });
        
        if (error) {
            // Table might not exist
            return { exists: false, count: 0, error: error.message };
        }
        
        return { exists: count > 0, count: count || 0, error: null };
    } catch (error) {
        return { exists: false, count: 0, error: error.message };
    }
};

