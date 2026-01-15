/**
 * Intercom to Supabase Sync Script
 * 
 * This script fetches conversation data from Intercom API and stores it in Supabase
 * for the Service Performance Overview dashboard.
 * 
 * Usage:
 *   node sync.js           - Sync last 7 days
 *   node sync.js --full    - Full sync (last 90 days)
 * 
 * Required Environment Variables:
 *   INTERCOM_ACCESS_TOKEN  - Your Intercom API access token
 *   SUPABASE_URL           - Your Supabase project URL
 *   SUPABASE_SERVICE_KEY   - Your Supabase service role key
 */

require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Validate environment
if (!INTERCOM_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing required environment variables!');
    console.error('Please set: INTERCOM_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY');
    process.exit(1);
}

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const intercom = axios.create({
    baseURL: 'https://api.intercom.io',
    headers: {
        'Authorization': `Bearer ${INTERCOM_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Intercom-Version': '2.10'
    }
});

// ============ INTERCOM API FUNCTIONS ============

/**
 * Fetch conversations from Intercom
 */
async function fetchConversations(startDate, endDate) {
    console.log(`📥 Fetching conversations from ${startDate} to ${endDate}...`);
    
    const conversations = [];
    let hasMore = true;
    let startingAfter = null;
    
    while (hasMore) {
        try {
            const params = {
                per_page: 150
            };
            
            if (startingAfter) {
                params.starting_after = startingAfter;
            }
            
            const response = await intercom.get('/conversations', { params });
            const data = response.data;
            
            // Filter by date
            const filtered = (data.conversations || []).filter(conv => {
                const createdAt = new Date(conv.created_at * 1000);
                return createdAt >= startDate && createdAt <= endDate;
            });
            
            conversations.push(...filtered);
            
            // Check pagination
            if (data.pages && data.pages.next) {
                startingAfter = data.pages.next.starting_after;
            } else {
                hasMore = false;
            }
            
            console.log(`  Fetched ${conversations.length} conversations so far...`);
            
            // Rate limiting
            await sleep(200);
            
        } catch (error) {
            console.error('Error fetching conversations:', error.response?.data || error.message);
            hasMore = false;
        }
    }
    
    return conversations;
}

/**
 * Fetch detailed conversation data including metrics
 */
async function fetchConversationDetails(conversationId) {
    try {
        const response = await intercom.get(`/conversations/${conversationId}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching conversation ${conversationId}:`, error.response?.data || error.message);
        return null;
    }
}

/**
 * Fetch team members (admins)
 */
async function fetchTeamMembers() {
    try {
        const response = await intercom.get('/admins');
        return response.data.admins || [];
    } catch (error) {
        console.error('Error fetching team members:', error.response?.data || error.message);
        return [];
    }
}

/**
 * Calculate conversation metrics
 */
function calculateMetrics(conversation) {
    const stats = conversation.statistics || {};
    const source = conversation.source || {};
    
    // First Response Time (seconds)
    const frt = stats.first_response_time_seconds || null;
    
    // Average Response Time - AFTER FRT, excluding FIN/bot responses
    // ART = Average time from user's last message to human agent's response (after FRT)
    let artEvents = [];
    
    if (conversation.conversation_parts && conversation.conversation_parts.conversation_parts) {
        const parts = conversation.conversation_parts.conversation_parts;
        let lastUserMessageTime = null;
        let frtProvided = false;
        
        // Helper to check if author is bot/FIN
        const isBot = (author) => {
            if (!author) return true;
            const name = (author.name || '').toLowerCase();
            const email = (author.email || '').toLowerCase();
            if (author.type === 'bot') return true;
            if (name.includes('fundednext ai')) return true;
            if (name === 'fin') return true;
            if (name.includes('operator')) return true;
            if (name.includes('workflow')) return true;
            if (email.includes('bot')) return true;
            if (email.includes('operator')) return true;
            if (email.includes('intercom')) return true;
            return false;
        };
        
        parts.forEach(part => {
            if (!part.created_at) return;
            
            // Track user messages - always update to get the LAST user message
            if (part.author?.type === 'user') {
                lastUserMessageTime = part.created_at;
                return;
            }
            
            // Check if this is an admin response (comment type only)
            if (part.author?.type === 'admin' && part.part_type === 'comment') {
                // Skip bot/FIN responses entirely
                if (isBot(part.author)) return;
                
                // This is a HUMAN agent response
                if (!frtProvided) {
                    // First HUMAN agent response = FRT
                    frtProvided = true;
                    lastUserMessageTime = null;
                } else if (lastUserMessageTime) {
                    // Human response after FRT with pending user message = ART event
                    const responseTime = part.created_at - lastUserMessageTime;
                    if (responseTime > 0 && responseTime < 86400) {
                        artEvents.push(responseTime);
                    }
                    lastUserMessageTime = null;
                }
            }
        });
    }
    
    // Calculate average of all ART events
    const art = artEvents.length > 0 
        ? Math.round(artEvents.reduce((sum, t) => sum + t, 0) / artEvents.length) 
        : null;
    
    // Average Handle Time (total conversation duration)
    const createdAt = conversation.created_at;
    const updatedAt = conversation.updated_at || conversation.created_at;
    const aht = updatedAt - createdAt;
    
    // Wait time to connect (time from open to first assignment)
    const waitTime = stats.time_to_first_contact_seconds || null;
    
    // Sentiment (from tags or custom attributes)
    let sentiment = 'Neutral';
    if (conversation.tags && conversation.tags.tags) {
        const sentimentTag = conversation.tags.tags.find(t => 
            ['positive', 'negative', 'neutral'].includes(t.name.toLowerCase())
        );
        if (sentimentTag) {
            sentiment = sentimentTag.name;
        }
    }
    
    // CSAT rating
    const csatRating = conversation.conversation_rating?.rating || null;
    
    return {
        frt_seconds: frt,
        art_seconds: art,
        aht_seconds: aht,
        wait_time_seconds: waitTime,
        sentiment,
        csat_rating: csatRating,
        response_count: responseCount
    };
}

// ============ SUPABASE FUNCTIONS ============

/**
 * Upsert conversation to Supabase
 */
async function upsertConversation(conversation, metrics, teammates) {
    const assigneeId = conversation.assignee?.id;
    const assignee = teammates.find(t => t.id === assigneeId);
    
    const record = {
        conversation_id: conversation.id,
        created_at: new Date(conversation.created_at * 1000).toISOString(),
        updated_at: new Date((conversation.updated_at || conversation.created_at) * 1000).toISOString(),
        state: conversation.state,
        channel: conversation.source?.type || 'unknown',
        
        // Contact info
        contact_id: conversation.contacts?.contacts?.[0]?.id || null,
        contact_country: conversation.custom_attributes?.country || null,
        
        // Assignee info
        assignee_id: assigneeId || null,
        assignee_name: assignee?.name || null,
        team_id: conversation.team_assignee_id || null,
        
        // Metrics
        frt_seconds: metrics.frt_seconds,
        art_seconds: metrics.art_seconds,
        aht_seconds: metrics.aht_seconds,
        wait_time_seconds: metrics.wait_time_seconds,
        sentiment: metrics.sentiment,
        csat_rating: metrics.csat_rating,
        response_count: metrics.response_count,
        
        // Status flags
        is_reopened: conversation.statistics?.count_reopens > 0,
        reopened_count: conversation.statistics?.count_reopens || 0,
        
        // Raw data for reference
        raw_data: JSON.stringify({
            tags: conversation.tags?.tags?.map(t => t.name) || [],
            source: conversation.source,
            statistics: conversation.statistics
        })
    };
    
    const { error } = await supabase
        .from('service_conversations')
        .upsert(record, { onConflict: 'conversation_id' });
    
    if (error) {
        console.error('Error upserting conversation:', error);
        return false;
    }
    
    return true;
}

/**
 * Update daily aggregated metrics
 */
async function updateDailyMetrics(date) {
    const dateStr = date.toISOString().split('T')[0];
    
    // Fetch all conversations for this date
    const { data: conversations, error: fetchError } = await supabase
        .from('service_conversations')
        .select('*')
        .gte('created_at', `${dateStr}T00:00:00`)
        .lt('created_at', `${dateStr}T23:59:59`);
    
    if (fetchError) {
        console.error('Error fetching daily conversations:', fetchError);
        return;
    }
    
    if (!conversations || conversations.length === 0) {
        return;
    }
    
    // Calculate aggregates
    const totalCount = conversations.length;
    const newCount = conversations.filter(c => !c.is_reopened).length;
    const reopenedCount = conversations.filter(c => c.is_reopened).length;
    
    const frtValues = conversations.filter(c => c.frt_seconds).map(c => c.frt_seconds);
    const artValues = conversations.filter(c => c.art_seconds).map(c => c.art_seconds);
    const ahtValues = conversations.filter(c => c.aht_seconds).map(c => c.aht_seconds);
    const waitValues = conversations.filter(c => c.wait_time_seconds).map(c => c.wait_time_seconds);
    const csatValues = conversations.filter(c => c.csat_rating).map(c => c.csat_rating);
    
    const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    
    // FRT/ART Hit Rate (assuming targets: FRT < 60s, ART < 120s)
    const FRT_TARGET = 60;
    const ART_TARGET = 120;
    const frtHitRate = frtValues.length > 0 
        ? Math.round((frtValues.filter(v => v <= FRT_TARGET).length / frtValues.length) * 100) 
        : null;
    const artHitRate = artValues.length > 0 
        ? Math.round((artValues.filter(v => v <= ART_TARGET).length / artValues.length) * 100) 
        : null;
    
    // Sentiment distribution
    const sentiments = {
        positive: conversations.filter(c => c.sentiment?.toLowerCase() === 'positive').length,
        neutral: conversations.filter(c => c.sentiment?.toLowerCase() === 'neutral').length,
        negative: conversations.filter(c => c.sentiment?.toLowerCase() === 'negative').length
    };
    
    // Channel distribution
    const channels = {};
    conversations.forEach(c => {
        const ch = c.channel || 'unknown';
        channels[ch] = (channels[ch] || 0) + 1;
    });
    
    const record = {
        date: dateStr,
        total_conversations: totalCount,
        new_conversations: newCount,
        reopened_conversations: reopenedCount,
        avg_frt_seconds: avg(frtValues),
        avg_art_seconds: avg(artValues),
        avg_aht_seconds: avg(ahtValues),
        avg_wait_time_seconds: avg(waitValues),
        frt_hit_rate: frtHitRate,
        art_hit_rate: artHitRate,
        avg_csat: csatValues.length > 0 ? (csatValues.reduce((a, b) => a + b, 0) / csatValues.length).toFixed(2) : null,
        sentiment_distribution: JSON.stringify(sentiments),
        channel_distribution: JSON.stringify(channels)
    };
    
    const { error } = await supabase
        .from('service_daily_metrics')
        .upsert(record, { onConflict: 'date' });
    
    if (error) {
        console.error('Error upserting daily metrics:', error);
    }
}

/**
 * Update teammate metrics
 */
async function updateTeammateMetrics(startDate, endDate) {
    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();
    
    // Fetch conversations in date range
    const { data: conversations, error } = await supabase
        .from('service_conversations')
        .select('*')
        .gte('created_at', startStr)
        .lte('created_at', endStr)
        .not('assignee_id', 'is', null);
    
    if (error || !conversations) {
        console.error('Error fetching conversations for teammate metrics:', error);
        return;
    }
    
    // Group by teammate
    const teammateStats = {};
    
    conversations.forEach(conv => {
        const id = conv.assignee_id;
        if (!id) return;
        
        if (!teammateStats[id]) {
            teammateStats[id] = {
                assignee_id: id,
                assignee_name: conv.assignee_name,
                conversation_count: 0,
                frt_values: [],
                art_values: [],
                aht_values: [],
                csat_values: [],
                sentiments: { positive: 0, neutral: 0, negative: 0 }
            };
        }
        
        const stats = teammateStats[id];
        stats.conversation_count++;
        
        if (conv.frt_seconds) stats.frt_values.push(conv.frt_seconds);
        if (conv.art_seconds) stats.art_values.push(conv.art_seconds);
        if (conv.aht_seconds) stats.aht_values.push(conv.aht_seconds);
        if (conv.csat_rating) stats.csat_values.push(conv.csat_rating);
        
        const sentiment = (conv.sentiment || 'neutral').toLowerCase();
        if (stats.sentiments[sentiment] !== undefined) {
            stats.sentiments[sentiment]++;
        }
    });
    
    // Calculate averages and upsert
    const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const FRT_TARGET = 60;
    const ART_TARGET = 120;
    
    for (const [id, stats] of Object.entries(teammateStats)) {
        const frtHitRate = stats.frt_values.length > 0
            ? Math.round((stats.frt_values.filter(v => v <= FRT_TARGET).length / stats.frt_values.length) * 100)
            : null;
        const artHitRate = stats.art_values.length > 0
            ? Math.round((stats.art_values.filter(v => v <= ART_TARGET).length / stats.art_values.length) * 100)
            : null;
        
        const record = {
            assignee_id: id,
            assignee_name: stats.assignee_name,
            period_start: startStr.split('T')[0],
            period_end: endStr.split('T')[0],
            conversation_count: stats.conversation_count,
            avg_frt_seconds: avg(stats.frt_values),
            avg_art_seconds: avg(stats.art_values),
            avg_aht_seconds: avg(stats.aht_values),
            frt_hit_rate: frtHitRate,
            art_hit_rate: artHitRate,
            avg_csat: stats.csat_values.length > 0 
                ? (stats.csat_values.reduce((a, b) => a + b, 0) / stats.csat_values.length).toFixed(2) 
                : null,
            positive_sentiment_count: stats.sentiments.positive,
            neutral_sentiment_count: stats.sentiments.neutral,
            negative_sentiment_count: stats.sentiments.negative
        };
        
        const { error: upsertError } = await supabase
            .from('service_teammate_metrics')
            .upsert(record, { onConflict: 'assignee_id,period_start,period_end' });
        
        if (upsertError) {
            console.error('Error upserting teammate metrics:', upsertError);
        }
    }
}

// ============ UTILITY FUNCTIONS ============

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ MAIN SYNC FUNCTION ============

async function main() {
    console.log('🚀 Starting Intercom to Supabase sync...\n');
    
    // Parse arguments
    const isFullSync = process.argv.includes('--full');
    const daysBack = isFullSync ? 90 : 7;
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    
    console.log(`📅 Sync period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`📊 Mode: ${isFullSync ? 'Full Sync' : 'Incremental Sync'}\n`);
    
    try {
        // 1. Fetch team members
        console.log('👥 Fetching team members...');
        const teammates = await fetchTeamMembers();
        console.log(`   Found ${teammates.length} team members\n`);
        
        // 2. Fetch conversations
        const conversations = await fetchConversations(startDate, endDate);
        console.log(`\n📬 Total conversations to process: ${conversations.length}\n`);
        
        // 3. Process each conversation
        let processed = 0;
        let errors = 0;
        
        for (const conv of conversations) {
            // Fetch detailed data
            const details = await fetchConversationDetails(conv.id);
            
            if (details) {
                const metrics = calculateMetrics(details);
                const success = await upsertConversation(details, metrics, teammates);
                
                if (success) {
                    processed++;
                } else {
                    errors++;
                }
            } else {
                errors++;
            }
            
            // Progress update
            if ((processed + errors) % 50 === 0) {
                console.log(`   Progress: ${processed + errors}/${conversations.length}`);
            }
            
            // Rate limiting
            await sleep(100);
        }
        
        console.log(`\n✅ Processed: ${processed} conversations`);
        console.log(`❌ Errors: ${errors} conversations\n`);
        
        // 4. Update daily metrics
        console.log('📈 Updating daily aggregated metrics...');
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            await updateDailyMetrics(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }
        console.log('   Daily metrics updated\n');
        
        // 5. Update teammate metrics
        console.log('👤 Updating teammate metrics...');
        await updateTeammateMetrics(startDate, endDate);
        console.log('   Teammate metrics updated\n');
        
        console.log('🎉 Sync completed successfully!');
        
    } catch (error) {
        console.error('❌ Sync failed:', error);
        process.exit(1);
    }
}

// Run
main();

