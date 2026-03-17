const { createClient } = require('@supabase/supabase-js');

function getDateRange(dateRange) {
    const DHAKA_OFFSET = '+06:00';
    if (dateRange && dateRange.startsWith('custom_')) {
        const parts = dateRange.split('_');
        if (parts.length === 3) {
            const startDate = new Date(parts[1] + 'T00:00:00' + DHAKA_OFFSET).toISOString();
            const endDate = new Date(parts[2] + 'T23:59:59' + DHAKA_OFFSET).toISOString();
            return { startDate, endDate };
        }
    }
    const now = new Date();
    const dhakaHour = now.getUTCHours() + 6;
    const dhakaToday = new Date(now);
    if (dhakaHour >= 24) dhakaToday.setUTCDate(dhakaToday.getUTCDate() + 1);
    const dhakaDateStr = dhakaToday.toISOString().split('T')[0];
    const endDate = new Date(dhakaDateStr + 'T23:59:59' + DHAKA_OFFSET).toISOString();
    let startDate;
    switch (dateRange) {
        case 'today':
            startDate = new Date(dhakaDateStr + 'T00:00:00' + DHAKA_OFFSET).toISOString(); break;
        case 'last_7_days': {
            const d = new Date(dhakaToday); d.setUTCDate(d.getUTCDate() - 7);
            startDate = new Date(d.toISOString().split('T')[0] + 'T00:00:00' + DHAKA_OFFSET).toISOString(); break;
        }
        case 'last_90_days': {
            const d = new Date(dhakaToday); d.setUTCDate(d.getUTCDate() - 90);
            startDate = new Date(d.toISOString().split('T')[0] + 'T00:00:00' + DHAKA_OFFSET).toISOString(); break;
        }
        default: {
            const d = new Date(dhakaToday); d.setUTCDate(d.getUTCDate() - 30);
            startDate = new Date(d.toISOString().split('T')[0] + 'T00:00:00' + DHAKA_OFFSET).toISOString();
        }
    }
    return { startDate, endDate };
}

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return null;
    return createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

    const body = req.body || {};
    const noFilter = (v) => !v || v === 'all' || v === 'All';

    // Return agent list for filter dropdown
    if (body.action === 'get-agents') {
        try {
            const { data, error } = await supabase
                .from('agent_name_mapping')
                .select('agent_name')
                .eq('exclude_from_metrics', false)
                .order('agent_name');
            if (error) return res.status(200).json({ agents: [] });
            const agents = [...new Set((data || []).map(r => r.agent_name))].sort();
            return res.status(200).json({ agents });
        } catch (e) {
            return res.status(200).json({ agents: [] });
        }
    }

    const { dateRange, country, channel, sentiment, agent, product, metric } = body;
    const { startDate, endDate } = getDateRange(dateRange || 'last_30_days');

    try {
        const { data, error } = await supabase.rpc('get_dashboard_data', {
            p_start_date: startDate,
            p_end_date: endDate,
            p_channel: noFilter(channel) ? null : channel,
            p_country: noFilter(country) ? null : country,
            p_sentiment: noFilter(sentiment) ? null : sentiment,
            p_agent: noFilter(agent) ? null : agent,
            p_product: noFilter(product) ? null : product,
            p_metric: metric || 'FRT'
        });

        if (error) {
            return res.status(200).json({ success: false, error: error.message });
        }

        return res.status(200).json(data);
    } catch (e) {
        return res.status(200).json({ success: false, error: e.message || String(e) });
    }
};

module.exports.config = { maxDuration: 30 };
