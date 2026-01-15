/**
 * Intercom to Supabase Sync Script
 * 
 * Syncs conversation data from Intercom to "Service Performance Overview" table
 * 
 * Usage:
 *   node sync-to-supabase.js              - Sync last 7 days
 *   node sync-to-supabase.js --days=30    - Sync last 30 days
 *   node sync-to-supabase.js --full       - Sync last 90 days
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// ============ CONFIGURATION ============
// Load from environment variables or .env file
require('dotenv').config();
const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLE_NAME = 'Service Performance Overview';

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

// ============ HELPER FUNCTIONS ============
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs() {
    const args = process.argv.slice(2);
    let days = 7;
    
    for (const arg of args) {
        if (arg === '--full') days = 90;
        else if (arg.startsWith('--days=')) days = parseInt(arg.split('=')[1]) || 7;
    }
    
    return { days };
}

// ============ INTERCOM API FUNCTIONS ============

async function fetchTeamMembers() {
    try {
        const response = await intercom.get('/admins');
        const admins = response.data.admins || [];
        const map = {};
        admins.forEach(a => {
            map[a.id] = a.name || a.email || 'Unknown';
        });
        return map;
    } catch (error) {
        console.error('Error fetching team members:', error.message);
        return {};
    }
}

async function fetchConversations(startDate, endDate, onProgress) {
    const conversations = [];
    let hasMore = true;
    let startingAfter = null;
    let page = 0;
    
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    
    while (hasMore) {
        try {
            const params = { per_page: 150 };
            if (startingAfter) params.starting_after = startingAfter;
            
            const response = await intercom.get('/conversations', { params });
            const data = response.data;
            const batch = data.conversations || [];
            
            // Filter by date
            const filtered = batch.filter(conv => {
                return conv.created_at >= startTimestamp;
            });
            
            // Check if we've gone past our date range
            if (batch.length > 0) {
                const oldestInBatch = Math.min(...batch.map(c => c.created_at));
                if (oldestInBatch < startTimestamp) {
                    // We've fetched all conversations in range
                    conversations.push(...filtered);
                    hasMore = false;
                    break;
                }
            }
            
            conversations.push(...filtered);
            page++;
            
            if (onProgress) onProgress(conversations.length, page);
            
            // Pagination
            if (data.pages && data.pages.next && data.pages.next.starting_after) {
                startingAfter = data.pages.next.starting_after;
            } else {
                hasMore = false;
            }
            
            // Rate limiting
            await sleep(150);
            
        } catch (error) {
            console.error('Error fetching conversations:', error.response?.data?.message || error.message);
            hasMore = false;
        }
    }
    
    return conversations;
}

async function fetchConversationDetails(conversationId) {
    try {
        const response = await intercom.get(`/conversations/${conversationId}`);
        return response.data;
    } catch (error) {
        // Don't log every error, just return null
        return null;
    }
}

function calculateMetrics(conv) {
    const stats = conv.statistics || {};
    
    // First Response Time
    const frt = stats.first_response_time || stats.first_admin_reply_at 
        ? (stats.first_admin_reply_at - conv.created_at) 
        : null;
    
    // Average Handle Time
    const aht = conv.updated_at ? (conv.updated_at - conv.created_at) : null;
    
    // Calculate ART from conversation parts - AFTER FRT, excluding FIN/bot responses
    // ART = Average time from user's last message to human agent's response (after FRT)
    let art = null;
    if (conv.conversation_parts && conv.conversation_parts.conversation_parts) {
        const parts = conv.conversation_parts.conversation_parts;
        let artEvents = [];
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
        
        for (const part of parts) {
            if (!part.created_at) continue;
            
            // Track user messages - always update to get the LAST user message
            if (part.author?.type === 'user') {
                lastUserMessageTime = part.created_at;
                continue;
            }
            
            // Check if this is an admin response (comment type only)
            if (part.author?.type === 'admin' && part.part_type === 'comment') {
                // Skip bot/FIN responses entirely
                if (isBot(part.author)) continue;
                
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
        }
        
        // Calculate average of all ART events
        if (artEvents.length > 0) {
            art = Math.round(artEvents.reduce((sum, t) => sum + t, 0) / artEvents.length);
        }
    }
    
    // Wait time (time to assignment)
    const waitTime = stats.time_to_assignment || stats.time_to_first_close || null;
    
    // Sentiment from tags
    let sentiment = null;
    if (conv.tags?.tags) {
        for (const tag of conv.tags.tags) {
            const name = (tag.name || '').toLowerCase();
            if (name.includes('positive') || name.includes('happy') || name.includes('satisfied')) {
                sentiment = 'Positive';
                break;
            } else if (name.includes('negative') || name.includes('angry') || name.includes('frustrated')) {
                sentiment = 'Negative';
                break;
            } else if (name.includes('neutral')) {
                sentiment = 'Neutral';
                break;
            }
        }
    }
    
    // CSAT
    const csat = conv.conversation_rating?.rating || null;
    
    return { frt, art, aht, waitTime, sentiment, csat };
}

// ============ SUPABASE FUNCTIONS ============

async function upsertConversation(conv, metrics, adminMap) {
    let assigneeName = conv.assignee?.id ? adminMap[conv.assignee.id] : null;
    
    // If assigned to FundedNext AI, show as "FIN"
    if (assigneeName && (assigneeName.toLowerCase().includes('fundednext ai') || assigneeName.toLowerCase() === 'fin')) {
        assigneeName = 'FIN';
    }
    
    // Get channel type
    let channel = conv.source?.type || 'unknown';
    if (channel === 'conversation') channel = 'live_chat';
    
    // Get country from custom attributes or contacts
    let country = null;
    if (conv.custom_attributes?.country) {
        country = conv.custom_attributes.country;
    } else if (conv.contacts?.contacts?.[0]?.custom_attributes?.country) {
        country = conv.contacts.contacts[0].custom_attributes.country;
    }
    
    const record = {
        conversation_id: String(conv.id),
        created_at: new Date(conv.created_at * 1000).toISOString(),
        updated_at: conv.updated_at ? new Date(conv.updated_at * 1000).toISOString() : null,
        state: conv.state,
        channel: channel,
        country: country,
        assignee_id: conv.assignee?.id ? String(conv.assignee.id) : null,
        assignee_name: assigneeName,
        team_id: conv.team_assignee_id ? String(conv.team_assignee_id) : null,
        frt_seconds: metrics.frt,
        art_seconds: metrics.art,
        aht_seconds: metrics.aht,
        wait_time_seconds: metrics.waitTime,
        sentiment: metrics.sentiment,
        csat_rating: metrics.csat,
        response_count: conv.statistics?.count_admin_replies || 0,
        is_reopened: (conv.statistics?.count_reopens || 0) > 0,
        reopened_count: conv.statistics?.count_reopens || 0,
        contact_id: conv.contacts?.contacts?.[0]?.id ? String(conv.contacts.contacts[0].id) : null,
        tags: conv.tags?.tags ? JSON.stringify(conv.tags.tags.map(t => t.name)) : null,
        synced_at: new Date().toISOString()
    };
    
    const { error } = await supabase
        .from(TABLE_NAME)
        .upsert(record, { onConflict: 'conversation_id' });
    
    if (error) {
        // Log only if it's not a duplicate
        if (!error.message.includes('duplicate')) {
            console.error('Upsert error:', error.message);
        }
        return false;
    }
    
    return true;
}

// ============ MAIN SYNC ============

async function main() {
    const { days } = parseArgs();
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('   INTERCOM → SUPABASE SYNC');
    console.log('   Service Performance Overview');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    console.log(`📅 Date Range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`📊 Syncing last ${days} days\n`);
    
    // 1. Fetch team members
    console.log('👥 Fetching team members...');
    const adminMap = await fetchTeamMembers();
    console.log(`   Found ${Object.keys(adminMap).length} team members\n`);
    
    // 2. Fetch conversations
    console.log('📬 Fetching conversations from Intercom...');
    const conversations = await fetchConversations(startDate, endDate, (count, page) => {
        process.stdout.write(`\r   Fetched ${count} conversations (page ${page})...`);
    });
    console.log(`\n   Total: ${conversations.length} conversations\n`);
    
    if (conversations.length === 0) {
        console.log('⚠️ No conversations found in date range');
        return;
    }
    
    // Filter to only closed conversations
    const closedConversations = conversations.filter(c => c.state === 'closed');
    console.log(`   Closed conversations: ${closedConversations.length} (skipping ${conversations.length - closedConversations.length} open/snoozed)\n`);
    
    if (closedConversations.length === 0) {
        console.log('⚠️ No closed conversations found in date range');
        return;
    }
    
    // 3. Process and sync
    console.log('🔄 Processing and syncing to Supabase...');
    let processed = 0;
    let errors = 0;
    let withDetails = 0;
    
    // Process in batches
    const BATCH_SIZE = 20;
    for (let i = 0; i < closedConversations.length; i += BATCH_SIZE) {
        const batch = closedConversations.slice(i, i + BATCH_SIZE);
        
        // Fetch details for conversations that need it
        const detailedBatch = await Promise.all(
            batch.map(async (conv) => {
                // Fetch details if we need metrics
                if (!conv.statistics) {
                    const details = await fetchConversationDetails(conv.id);
                    if (details) {
                        withDetails++;
                        return details;
                    }
                }
                return conv;
            })
        );
        
        // Process and upsert
        for (const conv of detailedBatch) {
            const metrics = calculateMetrics(conv);
            const success = await upsertConversation(conv, metrics, adminMap);
            
            if (success) {
                processed++;
            } else {
                errors++;
            }
        }
        
        // Progress
        const progress = Math.round(((i + batch.length) / closedConversations.length) * 100);
        process.stdout.write(`\r   Progress: ${progress}% (${processed} synced, ${errors} errors)`);
        
        // Rate limiting
        await sleep(100);
    }
    
    console.log('\n');
    
    // 4. Summary
    console.log('═══════════════════════════════════════════════════════');
    console.log('   SYNC COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   ✅ Synced: ${processed} conversations`);
    console.log(`   📊 With detailed metrics: ${withDetails}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Verify count
    const { count } = await supabase
        .from(TABLE_NAME)
        .select('*', { count: 'exact', head: true });
    
    console.log(`📊 Total records in "${TABLE_NAME}": ${count || 0}\n`);
}

main().catch(console.error);

