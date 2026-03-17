const { createClient } = require('@supabase/supabase-js');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const BASE = 'https://api.elevenlabs.io/v1/convai';

const AGENTS = {
  'CFD Website': 'agent_01jz2bddgwfef820dmy5g02tcw',
  'Futures Website': 'agent_01jz2ay5q0e388edm6xfnxwk6v'
};

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function getDateRange(dateRange) {
  const now = new Date();
  if (dateRange && dateRange.startsWith('custom_')) {
    const parts = dateRange.split('_');
    return { startDate: parts[1], endDate: parts[2] };
  }
  const dhakaMs = now.getTime() + 6 * 3600000;
  const endDate = new Date(dhakaMs).toISOString().split('T')[0];
  let d = new Date(dhakaMs);
  switch (dateRange) {
    case 'today': break;
    case 'last_7_days': d.setDate(d.getDate() - 7); break;
    case 'last_90_days': d.setDate(d.getDate() - 90); break;
    default: d.setDate(d.getDate() - 30);
  }
  return { startDate: d.toISOString().split('T')[0], endDate };
}

// ============ SYNC: Pull from ElevenLabs → Supabase ============
async function syncConversations(supabase) {
  let totalSynced = 0;
  let detailsSynced = 0;

  // Phase 1: Sync list data for each agent
  for (const [agentName, agentId] of Object.entries(AGENTS)) {
    // Find latest conversation we already have for this agent
    const { data: latest } = await supabase
      .from('elevenlabs_conversations')
      .select('start_time')
      .eq('agent_id', agentId)
      .order('start_time', { ascending: false })
      .limit(1);

    const latestTs = latest?.[0]?.start_time
      ? Math.floor(new Date(latest[0].start_time).getTime() / 1000)
      : 0;

    let cursor = null;
    let hasMore = true;
    let reachedExisting = false;

    while (hasMore && !reachedExisting) {
      const url = new URL(`${BASE}/conversations`);
      url.searchParams.set('agent_id', agentId);
      url.searchParams.set('page_size', '100');
      if (cursor) url.searchParams.set('cursor', cursor);

      const resp = await fetch(url.toString(), {
        headers: { 'xi-api-key': ELEVENLABS_API_KEY }
      });
      if (!resp.ok) throw new Error(`ElevenLabs API: ${resp.status}`);
      const data = await resp.json();

      const rows = [];
      for (const conv of (data.conversations || [])) {
        // Stop if we've reached conversations we already have
        if (conv.start_time_unix_secs <= latestTs) {
          reachedExisting = true;
          break;
        }
        rows.push({
          conversation_id: conv.conversation_id,
          agent_id: conv.agent_id,
          agent_name: conv.agent_name || agentName,
          start_time: new Date(conv.start_time_unix_secs * 1000).toISOString(),
          call_duration_secs: conv.call_duration_secs || 0,
          message_count: conv.message_count || 0,
          status: conv.status,
          call_successful: conv.call_successful,
          call_summary_title: conv.call_summary_title,
          main_language: conv.main_language,
          termination_reason: conv.termination_reason,
          detail_synced: false
        });
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from('elevenlabs_conversations')
          .upsert(rows, { onConflict: 'conversation_id' });
        if (error) throw error;
        totalSynced += rows.length;
      }

      hasMore = data.has_more;
      cursor = data.next_cursor;
    }
  }

  // Phase 2: Fetch details for conversations that don't have them yet (keep small to avoid timeout)
  const { data: needDetails } = await supabase
    .from('elevenlabs_conversations')
    .select('conversation_id')
    .eq('detail_synced', false)
    .order('start_time', { ascending: false })
    .limit(80);

  if (needDetails && needDetails.length > 0) {
    // Single parallel batch — fast
    const results = await Promise.allSettled(
      needDetails.map(row =>
        fetch(`${BASE}/conversations/${row.conversation_id}`, {
          headers: { 'xi-api-key': ELEVENLABS_API_KEY }
        }).then(r => r.ok ? r.json() : null)
      )
    );

    const updates = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const d = r.value;
      const meta = d.metadata || {};
      const charging = meta.charging || {};
      const models = (charging.llm_usage?.irreversible_generation?.model_usage) || {};
      let inputTokens = 0, outputTokens = 0;
      for (const m of Object.values(models)) {
        inputTokens += (m.input?.tokens || 0) + (m.input_cache_read?.tokens || 0);
        outputTokens += m.output_total?.tokens || 0;
      }
      const dc = d.analysis?.data_collection_results || {};

      updates.push({
        conversation_id: d.conversation_id,
        cost: meta.cost || 0,
        llm_price: charging.llm_price || 0,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        topic: dc.topic?.value || null,
        sentiment: dc.sentiment?.value || null,
        transcript_summary: d.analysis?.transcript_summary || null,
        detail_synced: true,
        synced_at: new Date().toISOString()
      });
    }

    // Update each row (Supabase doesn't support batch UPDATE easily)
    const updatePromises = updates.map(upd => {
      const convId = upd.conversation_id;
      delete upd.conversation_id;
      return supabase.from('elevenlabs_conversations').update(upd).eq('conversation_id', convId);
    });
    // Run 10 at a time
    for (let i = 0; i < updatePromises.length; i += 10) {
      await Promise.allSettled(updatePromises.slice(i, i + 10));
    }
    detailsSynced += updates.length;
  }

  // Count remaining unsynced details
  const { count: remaining } = await supabase
    .from('elevenlabs_conversations')
    .select('*', { count: 'exact', head: true })
    .eq('detail_synced', false);

  return { totalSynced, detailsSynced, detailsRemaining: remaining || 0 };
}

// ============ QUERY: Read aggregated data from Supabase (RPC) ============
async function queryDashboard(supabase, dateRange) {
  const { startDate, endDate } = getDateRange(dateRange);
  const from = startDate + 'T00:00:00+06:00';
  const to = endDate + 'T23:59:59+06:00';

  const { data, error } = await supabase.rpc('get_fundee_dashboard', {
    p_from: from,
    p_to: to
  });

  if (error) throw error;
  const raw = data || {};

  // Ensure both agents exist in stats
  const agents = raw.agents || {};
  for (const name of Object.keys(AGENTS)) {
    if (!agents[name]) agents[name] = { count: 0, totalDuration: 0, successCount: 0, failCount: 0 };
  }

  const t = raw.totals || {};
  const totalCount = parseInt(t.total_conversations) || 0;
  const detailedCount = parseInt(t.detailed_count) || 0;
  const totalSuccess = parseInt(t.total_success) || 0;
  const totalFail = parseInt(t.total_fail) || 0;
  const totalWithOutcome = totalSuccess + totalFail;
  const totalDuration = parseInt(t.total_duration) || 0;

  // Extrapolate cost/tokens from detailed sample
  const ratio = detailedCount > 0 && detailedCount < totalCount ? totalCount / detailedCount : 1;
  const isEstimated = detailedCount < totalCount;
  const sampleCost = parseInt(t.sample_cost) || 0;
  const sampleLlm = parseFloat(t.sample_llm_usd) || 0;
  const sampleIn = parseInt(t.sample_input_tokens) || 0;
  const sampleOut = parseInt(t.sample_output_tokens) || 0;

  // Add colors to sentiment
  const colorMap = { Positive: '#10B981', Neutral: '#F59E0B', Negative: '#EF4444' };
  const sentimentBreakdown = (raw.sentimentBreakdown || []).map(s => ({
    ...s,
    color: colorMap[s.name] || '#94A3B8'
  }));
  // Ensure all 3 sentiments present
  for (const [name, color] of Object.entries(colorMap)) {
    if (!sentimentBreakdown.find(s => s.name === name)) {
      sentimentBreakdown.push({ name, value: 0, color });
    }
  }

  return {
    agents,
    totals: {
      totalConversations: totalCount,
      totalMinutes: parseFloat((totalDuration / 60).toFixed(1)),
      avgDurationSecs: parseFloat(t.avg_duration) || 0,
      successRate: totalWithOutcome > 0 ? parseFloat(((totalSuccess / totalWithOutcome) * 100).toFixed(1)) : 0,
      totalCost: isEstimated ? Math.round(sampleCost * ratio) : sampleCost,
      totalLlmCostUsd: parseFloat((sampleLlm * ratio).toFixed(2)),
      totalInputTokens: Math.round(sampleIn * ratio),
      totalOutputTokens: Math.round(sampleOut * ratio),
      isEstimated,
      detailedPct: totalCount > 0 ? Math.round((detailedCount / totalCount) * 100) : 0
    },
    dailyTrend: raw.dailyTrend || [],
    topicDistribution: raw.topicDistribution || [],
    sentimentBreakdown
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  const { action, dateRange } = req.body || {};

  try {
    if (action === 'sync') {
      if (!ELEVENLABS_API_KEY) {
        return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
      }
      const result = await syncConversations(supabase);
      return res.status(200).json({ success: true, ...result });
    }

    // Default: query dashboard
    const result = await queryDashboard(supabase, dateRange);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Fundee API error:', error);
    return res.status(500).json({ error: error.message || 'Failed' });
  }
};

module.exports.maxDuration = 60;
