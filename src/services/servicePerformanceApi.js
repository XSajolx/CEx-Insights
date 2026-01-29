/**
 * Service Performance API Functions
 * 
 * Fetches data from Supabase "Service Performance Overview" table
 */

import { supabase } from './supabaseClient';

const TABLE_NAME = 'Service Performance Overview';

// ============ HELPER FUNCTIONS ============

/**
 * Calculate date range based on filter
 */
export const getDateRange = (dateRange = 'last_30_days') => {
    const now = new Date();
    let startDate, endDate;
    
    endDate = now.toISOString();
    
    switch (dateRange) {
        case 'today':
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            startDate = todayStart.toISOString();
            break;
        case 'last_7_days':
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            startDate = weekAgo.toISOString();
            break;
        case 'last_30_days':
            const monthAgo = new Date(now);
            monthAgo.setDate(monthAgo.getDate() - 30);
            startDate = monthAgo.toISOString();
            break;
        case 'last_90_days':
            const quarterAgo = new Date(now);
            quarterAgo.setDate(quarterAgo.getDate() - 90);
            startDate = quarterAgo.toISOString();
            break;
        default:
            const defaultAgo = new Date(now);
            defaultAgo.setDate(defaultAgo.getDate() - 30);
            startDate = defaultAgo.toISOString();
    }
    
    return { startDate, endDate };
};

/**
 * Format seconds to human readable time
 */
export const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return '-';
    
    const secs = Math.round(seconds);
    if (secs < 60) {
        return `${secs}s`;
    } else if (secs < 3600) {
        const mins = Math.floor(secs / 60);
        const remainingSecs = secs % 60;
        return remainingSecs > 0 ? `${mins}m ${remainingSecs}s` : `${mins}m`;
    } else {
        const hours = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
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
        console.log('📊 Fetching summary for date range:', startDate, 'to', endDate);
        
        // Build query with filters
        let query = supabase
            .from(TABLE_NAME)
            .select('conversation_id, frt_seconds, art_seconds, aht_seconds, "Avg Wait Time", "FRT Hit Rate", "ART Hit Rate", "CX score", is_reopened, assignee_id, country, channel, sentiment')
            .gte('created_at', startDate)
            .lte('created_at', endDate);
        
        // Apply optional filters
        if (filters.country && filters.country !== 'all') {
            query = query.ilike('country', `%${filters.country}%`);
        }
        if (filters.channel && filters.channel !== 'all') {
            query = query.eq('channel', filters.channel);
        }
        if (filters.sentiment && filters.sentiment !== 'all') {
            query = query.ilike('sentiment', `%${filters.sentiment}%`);
        }
        
        const { data, error } = await query;
        
        console.log('📊 Summary query result:', { recordCount: data?.length, error: error?.message });
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return {
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
        }
        
        // Get unique conversation IDs for knock count
        const uniqueConversations = [...new Set(data.map(r => r.conversation_id))];
        const totalKnockCount = uniqueConversations.length;
        
        // Count reopened
        const reopenedConversations = data.filter(r => r.is_reopened).length;
        const newConversations = totalKnockCount - reopenedConversations;
        
        // Calculate averages (only from human agents, not FIN)
        const humanAgentData = data.filter(r => r.assignee_id !== 'FIN');
        
        const frtValues = humanAgentData.filter(r => r.frt_seconds !== null).map(r => r.frt_seconds);
        const artValues = humanAgentData.filter(r => r.art_seconds !== null).map(r => r.art_seconds);
        const ahtValues = humanAgentData.filter(r => r.aht_seconds !== null).map(r => r.aht_seconds);
        const waitTimeValues = data.filter(r => r['Avg Wait Time'] !== null).map(r => r['Avg Wait Time']);
        const csatValues = data.filter(r => r['CX score'] !== null).map(r => r['CX score']);
        
        // FRT Hit Rate: percentage of conversations where FRT <= 30s (hit target)
        const frtHitRateValues = humanAgentData.filter(r => r['FRT Hit Rate'] !== null);
        const frtHitRate = frtHitRateValues.length > 0 
            ? Math.round((frtHitRateValues.filter(r => r['FRT Hit Rate'] === 0).length / frtHitRateValues.length) * 100 * 10) / 10
            : null;
        
        // ART Hit Rate: average of ART hit rate percentages
        const artHitRateValues = humanAgentData.filter(r => r['ART Hit Rate'] !== null).map(r => r['ART Hit Rate']);
        const artHitRate = artHitRateValues.length > 0
            ? Math.round((100 - (artHitRateValues.reduce((a, b) => a + b, 0) / artHitRateValues.length)) * 10) / 10
            : null;
        
        return {
            total_knock_count: totalKnockCount,
            new_conversations: newConversations,
            reopened_conversations: reopenedConversations,
            avg_frt_seconds: frtValues.length > 0 ? Math.round(frtValues.reduce((a, b) => a + b, 0) / frtValues.length) : null,
            avg_art_seconds: artValues.length > 0 ? Math.round(artValues.reduce((a, b) => a + b, 0) / artValues.length) : null,
            avg_aht_seconds: ahtValues.length > 0 ? Math.round(ahtValues.reduce((a, b) => a + b, 0) / ahtValues.length) : null,
            avg_wait_time_seconds: waitTimeValues.length > 0 ? Math.round(waitTimeValues.reduce((a, b) => a + b, 0) / waitTimeValues.length) : null,
            frt_hit_rate: frtHitRate,
            art_hit_rate: artHitRate,
            avg_csat: csatValues.length > 0 ? Math.round((csatValues.reduce((a, b) => a + b, 0) / csatValues.length) * 10) / 10 : null
        };
    } catch (error) {
        console.error('Error fetching performance summary:', error);
        throw error;
    }
};

/**
 * Helper to apply common filters to a query
 */
const applyFilters = (query, filters) => {
    if (filters.country && filters.country !== 'all') {
        query = query.ilike('country', `%${filters.country}%`);
    }
    if (filters.channel && filters.channel !== 'all') {
        query = query.eq('channel', filters.channel);
    }
    if (filters.sentiment && filters.sentiment !== 'all') {
        query = query.ilike('sentiment', `%${filters.sentiment}%`);
    }
    return query;
};

/**
 * Fetch daily trend data (for timeseries charts)
 */
export const fetchDailyTrend = async (filters = {}) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        let query = supabase
            .from(TABLE_NAME)
            .select('conversation_id, created_at, is_reopened, country, channel, sentiment')
            .gte('created_at', startDate)
            .lte('created_at', endDate);
        
        query = applyFilters(query, filters);
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Group by date
        const dailyData = {};
        (data || []).forEach(row => {
            const date = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (!dailyData[date]) {
                dailyData[date] = { total: new Set(), new: 0, reopened: 0 };
            }
            dailyData[date].total.add(row.conversation_id);
            if (row.is_reopened) {
                dailyData[date].reopened++;
            } else {
                dailyData[date].new++;
            }
        });
        
        return Object.entries(dailyData).map(([date, counts]) => ({
            date,
            total: counts.total.size,
            new: counts.new,
            reopened: counts.reopened
        })).sort((a, b) => new Date(a.date) - new Date(b.date));
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
        
        let query = supabase
            .from(TABLE_NAME)
            .select('conversation_id, sentiment, country, channel')
            .gte('created_at', startDate)
            .lte('created_at', endDate);
        
        query = applyFilters(query, filters);
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Get unique conversations and their sentiment
        const conversationSentiment = {};
        (data || []).forEach(row => {
            if (row.sentiment && !conversationSentiment[row.conversation_id]) {
                conversationSentiment[row.conversation_id] = row.sentiment;
            }
        });
        
        const sentiments = Object.values(conversationSentiment);
        const positive = sentiments.filter(s => s === 'Positive').length;
        const neutral = sentiments.filter(s => s === 'Neutral').length;
        const negative = sentiments.filter(s => s === 'Negative').length;
        
        return [
            { name: 'Positive', value: positive, color: '#10B981' },
            { name: 'Neutral', value: neutral, color: '#6366F1' },
            { name: 'Negative', value: negative, color: '#EF4444' }
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
        
        let query = supabase
            .from(TABLE_NAME)
            .select('conversation_id, channel, country, sentiment')
            .gte('created_at', startDate)
            .lte('created_at', endDate);
        
        query = applyFilters(query, filters);
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Get unique conversations per channel
        const channelCounts = {};
        const seenConversations = new Set();
        
        (data || []).forEach(row => {
            if (!seenConversations.has(row.conversation_id)) {
                seenConversations.add(row.conversation_id);
                const channel = row.channel || 'unknown';
                channelCounts[channel] = (channelCounts[channel] || 0) + 1;
            }
        });
        
        const colors = {
            'live_chat': '#38BDF8',
            'email': '#A78BFA',
            'instagram': '#F472B6',
            'facebook': '#60A5FA',
            'telegram': '#34D399',
            'unknown': '#94A3B8'
        };
        
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
        
        return Object.entries(channelCounts)
            .map(([channel, count]) => ({
                name: formatChannelName(channel),
                value: count,
                color: colors[channel?.toLowerCase()] || '#94A3B8'
            }))
            .sort((a, b) => b.value - a.value);
    } catch (error) {
        console.error('Error fetching channel distribution:', error);
        throw error;
    }
};

/**
 * Fetch volume heatmap data
 */
export const fetchVolumeHeatmap = async (filters = {}) => {
    try {
        const { startDate, endDate } = getDateRange(filters.dateRange);
        
        let query = supabase
            .from(TABLE_NAME)
            .select('conversation_id, created_at, country, channel, sentiment')
            .gte('created_at', startDate)
            .lte('created_at', endDate);
        
        query = applyFilters(query, filters);
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Group by day of week and hour
        const heatmapData = {};
        const seenConversations = new Set();
        
        (data || []).forEach(row => {
            if (!seenConversations.has(row.conversation_id)) {
                seenConversations.add(row.conversation_id);
                const date = new Date(row.created_at);
                const dayIdx = date.getDay();
                const hour = date.getHours();
                const key = `${dayIdx}-${hour}`;
                heatmapData[key] = (heatmapData[key] || 0) + 1;
            }
        });
        
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const result = [];
        
        for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
            for (let hour = 0; hour < 24; hour++) {
                result.push({
                    dayIdx,
                    day: days[dayIdx],
                    hour,
                    value: heatmapData[`${dayIdx}-${hour}`] || 0
                });
            }
        }
        
        return result;
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
        
        let query = supabase
            .from(TABLE_NAME)
            .select('assignee_id, assignee_name, conversation_id, frt_seconds, art_seconds, aht_seconds, "FRT Hit Rate", "ART Hit Rate", "CX score", country, channel, sentiment')
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .neq('assignee_id', 'FIN');
        
        query = applyFilters(query, filters);
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Group by assignee
        const teammateData = {};
        (data || []).forEach(row => {
            const id = row.assignee_id || 'Unknown';
            if (!teammateData[id]) {
                teammateData[id] = {
                    name: row.assignee_name || 'Unknown',
                    conversations: new Set(),
                    frtValues: [],
                    artValues: [],
                    ahtValues: [],
                    frtHitRates: [],
                    artHitRates: [],
                    csatValues: []
                };
            }
            teammateData[id].conversations.add(row.conversation_id);
            if (row.frt_seconds !== null) teammateData[id].frtValues.push(row.frt_seconds);
            if (row.art_seconds !== null) teammateData[id].artValues.push(row.art_seconds);
            if (row.aht_seconds !== null) teammateData[id].ahtValues.push(row.aht_seconds);
            if (row['FRT Hit Rate'] !== null) teammateData[id].frtHitRates.push(row['FRT Hit Rate']);
            if (row['ART Hit Rate'] !== null) teammateData[id].artHitRates.push(row['ART Hit Rate']);
            if (row['CX score'] !== null) teammateData[id].csatValues.push(row['CX score']);
        });
        
        const avg = arr => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
        
        return Object.entries(teammateData)
            .map(([id, data]) => ({
                name: data.name,
                conversations: data.conversations.size,
                FRT: avg(data.frtValues),
                ART: avg(data.artValues),
                AHT: avg(data.ahtValues),
                'FRT Hit Rate': data.frtHitRates.length > 0 
                    ? Math.round((data.frtHitRates.filter(r => r === 0).length / data.frtHitRates.length) * 100) 
                    : null,
                'ART Hit Rate': data.artHitRates.length > 0 
                    ? Math.round(100 - avg(data.artHitRates)) 
                    : null,
                CSAT: data.csatValues.length > 0 ? Math.round(avg(data.csatValues) * 10) / 10 : null
            }))
            .sort((a, b) => b.conversations - a.conversations)
            .slice(0, limit);
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
        
        let query = supabase
            .from(TABLE_NAME)
            .select('conversation_id, country, channel, sentiment')
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .not('country', 'is', null);
        
        query = applyFilters(query, filters);
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Count unique conversations per country
        const countryCounts = {};
        const seenConversations = new Set();
        
        (data || []).forEach(row => {
            if (row.country && !seenConversations.has(row.conversation_id)) {
                seenConversations.add(row.conversation_id);
                countryCounts[row.country] = (countryCounts[row.country] || 0) + 1;
            }
        });
        
        return Object.entries(countryCounts)
            .map(([country, count]) => ({
                name: country,
                knockCount: count
            }))
            .sort((a, b) => b.knockCount - a.knockCount)
            .slice(0, limit);
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
        
        let query = supabase
            .from(TABLE_NAME)
            .select('created_at, frt_seconds, art_seconds, aht_seconds, "Avg Wait Time", "FRT Hit Rate", "ART Hit Rate", "CX score", assignee_id, country, channel, sentiment')
            .gte('created_at', startDate)
            .lte('created_at', endDate)
            .neq('assignee_id', 'FIN');
        
        query = applyFilters(query, filters);
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Group by date
        const dailyData = {};
        (data || []).forEach(row => {
            const date = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (!dailyData[date]) {
                dailyData[date] = { frt: [], art: [], aht: [], waitTime: [], frtHit: [], artHit: [], csat: [] };
            }
            if (row.frt_seconds !== null) dailyData[date].frt.push(row.frt_seconds);
            if (row.art_seconds !== null) dailyData[date].art.push(row.art_seconds);
            if (row.aht_seconds !== null) dailyData[date].aht.push(row.aht_seconds);
            if (row['Avg Wait Time'] !== null) dailyData[date].waitTime.push(row['Avg Wait Time']);
            if (row['FRT Hit Rate'] !== null) dailyData[date].frtHit.push(row['FRT Hit Rate']);
            if (row['ART Hit Rate'] !== null) dailyData[date].artHit.push(row['ART Hit Rate']);
            if (row['CX score'] !== null) dailyData[date].csat.push(row['CX score']);
        });
        
        const avg = arr => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
        
        const metricMap = {
            'FRT': data => avg(data.frt),
            'ART': data => avg(data.art),
            'AHT': data => avg(data.aht),
            'Wait Time': data => avg(data.waitTime),
            'FRT Hit Rate': data => data.frtHit.length > 0 ? Math.round((data.frtHit.filter(r => r === 0).length / data.frtHit.length) * 100) : null,
            'ART Hit Rate': data => data.artHit.length > 0 ? Math.round(100 - avg(data.artHit)) : null,
            'CSAT': data => data.csat.length > 0 ? Math.round(avg(data.csat) * 10) / 10 : null
        };
        
        return Object.entries(dailyData)
            .map(([date, values]) => ({
                date,
                [metric]: metricMap[metric] ? metricMap[metric](values) : null
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
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
        
        let query = supabase
            .from(TABLE_NAME)
            .select('conversation_id, created_at, country, channel, sentiment')
            .gte('created_at', startDate)
            .lte('created_at', endDate);
        
        query = applyFilters(query, filters);
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Group by hour
        const hourCounts = Array(24).fill(0);
        const seenConversations = new Set();
        
        (data || []).forEach(row => {
            if (!seenConversations.has(row.conversation_id)) {
                seenConversations.add(row.conversation_id);
                const hour = new Date(row.created_at).getHours();
                hourCounts[hour]++;
            }
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
        console.log('🔍 Checking if data exists in:', TABLE_NAME);
        
        const { count, error } = await supabase
            .from(TABLE_NAME)
            .select('*', { count: 'exact', head: true });
        
        if (error) {
            console.error('❌ Error checking data:', error);
            return { exists: false, count: 0, error: error.message };
        }
        
        console.log(`✅ Service Performance Overview has ${count} records`);
        return { exists: count > 0, count: count || 0, error: null };
    } catch (error) {
        console.error('❌ Exception checking data:', error);
        return { exists: false, count: 0, error: error.message };
    }
};
