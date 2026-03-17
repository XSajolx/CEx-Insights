/**
 * Service Performance API Functions
 * 
 * Uses server-side API endpoint (/api/dashboard-data) for fast aggregation.
 * The heavy Supabase query + computation runs on the server, not in the browser.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api/dashboard-data';

// ============ HELPER FUNCTIONS ============

export const formatTime = (seconds) => {
    if (!seconds && seconds !== 0) return '-';
    const secs = Math.round(seconds);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) {
        const mins = Math.floor(secs / 60);
        const rem = secs % 60;
        return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
    }
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

export const checkDataExists = async () => {
    try {
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dateRange: 'last_90_days' })
        });
        const data = await resp.json();
        if (data.success && data.summary) {
            return { exists: data.summary.total_knock_count > 0, count: data.summary.total_knock_count, error: null };
        }
        return { exists: false, count: 0, error: data.error || null };
    } catch (error) {
        return { exists: false, count: 0, error: error.message };
    }
};

/**
 * Fetches all dashboard data via server-side API.
 * Server does the Supabase query + aggregation; returns only computed results (~5KB).
 */
export const fetchAllDashboardData = async (filters = {}) => {
    console.log('📊 Fetching dashboard data via API...');
    const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dateRange: filters.dateRange || 'last_30_days',
            country: filters.country,
            channel: filters.channel,
            sentiment: filters.sentiment,
            agent: filters.agent,
            product: filters.product,
            metric: 'FRT'
        })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Server returned error');
    console.log(`📈 Server processed ${data.rowCount} rows`);
    return {
        summary: data.summary,
        trend: data.trend,
        sentiment: data.sentiment,
        channels: data.channels,
        heatmap: data.heatmap,
        teammates: data.teammates,
        countries: data.countries,
        activeHours: data.activeHours
    };
};

/**
 * Fetches performance timeseries via the same server-side API.
 */
export const fetchPerformanceTimeseries = async (filters = {}, metric = 'FRT') => {
    console.log('📊 Fetching timeseries via API...');
    const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dateRange: filters.dateRange || 'last_30_days',
            country: filters.country,
            channel: filters.channel,
            sentiment: filters.sentiment,
            agent: filters.agent,
            product: filters.product,
            metric
        })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Server returned error');
    return data.timeseries || [];
};
