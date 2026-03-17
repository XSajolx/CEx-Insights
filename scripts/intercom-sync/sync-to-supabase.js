/**
 * Intercom to Supabase Sync Script
 * 
 * Syncs conversation data from Intercom to "Service Performance Overview" table
 * 
 * Usage:
 *   node sync-to-supabase.js                    - Sync last 7 days
 *   node sync-to-supabase.js --days=30          - Sync last 30 days
 *   node sync-to-supabase.js --full             - Sync last 90 days
 *   node sync-to-supabase.js --limit=100        - Sync only 100 conversations (for testing)
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// ============ CONFIGURATION ============
// Load from environment variables or .env file
// Try current directory first, then parent directory
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Try to load .env from current directory
if (fs.existsSync(path.join(__dirname, '.env'))) {
    dotenv.config({ path: path.join(__dirname, '.env') });
} else if (fs.existsSync(path.join(__dirname, '../../.env'))) {
    // Try parent directory (root of project)
    dotenv.config({ path: path.join(__dirname, '../../.env') });
} else {
    // Try default .env location
    dotenv.config();
}

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Validate required environment variables
if (!INTERCOM_TOKEN) {
    console.error('❌ ERROR: INTERCOM_ACCESS_TOKEN is required!');
    console.error('   Please add it to your .env file:');
    console.error('   INTERCOM_ACCESS_TOKEN=your_token_here');
    console.error('   Or set it as an environment variable:');
    console.error('   $env:INTERCOM_ACCESS_TOKEN = "your_token_here"');
    process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required!');
    process.exit(1);
}

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
    let limit = null; // No limit by default
    
    for (const arg of args) {
        if (arg === '--full') days = 90;
        else if (arg.startsWith('--days=')) days = parseInt(arg.split('=')[1]) || 7;
        else if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]) || null;
    }
    
    return { days, limit };
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

async function fetchConversations(startDate, endDate, onProgress, limit = null) {
    const conversations = [];
    let hasMore = true;
    let startingAfter = null;
    let page = 0;
    let totalFetched = 0;
    
    const startTimestamp = limit ? 0 : Math.floor(startDate.getTime() / 1000); // 0 = no date filter
    const endTimestamp = limit ? Number.MAX_SAFE_INTEGER : Math.floor(endDate.getTime() / 1000);
    
    if (!limit) {
        console.log(`   Date range: ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);
    } else {
        console.log(`   Fetching conversations from Intercom (no date filter when limit is set)`);
    }
    
    // Try using search API first if limit is set
    if (limit) {
        try {
            console.log('   Trying Intercom Search API...');
            // First try to find closed conversations
            let searchResponse = await intercom.post('/conversations/search', {
                query: {
                    operator: 'AND',
                    value: [
                        {
                            field: 'state',
                            operator: '=',
                            value: 'closed'
                        }
                    ]
                },
                pagination: {
                    per_page: limit > 150 ? 150 : limit
                },
                sort: {
                    field: 'created_at',
                    order: 'descending'
                }
            });
            
            if (searchResponse.data && searchResponse.data.conversations && searchResponse.data.conversations.length > 0) {
                const searchResults = searchResponse.data.conversations;
                console.log(`   ✅ Search API found ${searchResults.length} closed conversations`);
                return searchResults;
            }
            
            // If no closed conversations, try to get any conversations
            console.log('   No closed conversations found, trying to fetch any conversations...');
            searchResponse = await intercom.post('/conversations/search', {
                pagination: {
                    per_page: limit > 150 ? 150 : limit
                },
                sort: {
                    field: 'created_at',
                    order: 'descending'
                }
            });
            
            if (searchResponse.data && searchResponse.data.conversations) {
                const searchResults = searchResponse.data.conversations;
                console.log(`   ✅ Search API found ${searchResults.length} conversations (any state)`);
                return searchResults;
            }
        } catch (searchError) {
            console.log(`   ⚠️  Search API not available: ${searchError.response?.status || searchError.message}`);
            if (searchError.response?.data) {
                console.log(`   Error: ${JSON.stringify(searchError.response.data)}`);
            }
            console.log('   Falling back to list API...\n');
        }
    }
    
    while (hasMore && page < 50) { // Increase page limit to find more closed conversations
        try {
            const params = { 
                per_page: 150,
                // Try to filter by state if possible
                // Note: Intercom API might not support state filter in list endpoint
            };
            if (startingAfter) params.starting_after = startingAfter;
            
            const response = await intercom.get('/conversations', { params });
            const data = response.data;
            const batch = data.conversations || [];
            
            totalFetched += batch.length;
            const closedCount = batch.filter(c => c.state === 'closed').length;
            console.log(`   Page ${page + 1}: Fetched ${batch.length} conversations (${closedCount} closed, total fetched: ${totalFetched})`);
            
            if (batch.length === 0) {
                console.log('   No more conversations available');
                hasMore = false;
                break;
            }
            
            // Include ALL conversations regardless of state
            // We want to sync any conversation that exists, whether open or closed
            let filtered = batch;
            const states = [...new Set(batch.map(c => c.state))];
            console.log(`   Page ${page + 1}: Found ${filtered.length} conversations (states: ${states.join(', ')})`);
            
            // If we specifically want only closed and limit is not set, optionally filter
            // But for now, we'll include all to maximize sync coverage
            
            // Include ALL conversations - no date filtering for now to ensure we sync what's available
            // Date filtering can be added back once we verify the sync works
            console.log(`   Page ${page + 1}: Including all ${filtered.length} conversations (no date filter)`);
            
            // Log date range of conversations for debugging
            if (filtered.length > 0) {
                const dates = filtered.map(c => c.created_at);
                const oldest = new Date(Math.min(...dates) * 1000).toISOString();
                const newest = new Date(Math.max(...dates) * 1000).toISOString();
                console.log(`   Page ${page + 1}: Date range: ${oldest} to ${newest}`);
            }
            
            if (filtered.length > 0) {
                console.log(`   Page ${page + 1}: ${filtered.length} closed conversations (${limit ? `target: ${limit}` : 'in date range'})`);
            }
            
            // Check if we've gone past our date range (oldest conversation is before start date)
            // Only do this check when NOT using limit mode
            if (batch.length > 0 && !limit) {
                const oldestInBatch = Math.min(...batch.map(c => c.created_at));
                const newestInBatch = Math.max(...batch.map(c => c.created_at));
                console.log(`   Page ${page + 1}: Oldest: ${new Date(oldestInBatch * 1000).toISOString()}, Newest: ${new Date(newestInBatch * 1000).toISOString()}`);
                
                if (oldestInBatch < startTimestamp && newestInBatch < startTimestamp) {
                    // All conversations in this batch are older than our range
                    console.log('   All conversations older than date range, stopping...');
                    conversations.push(...filtered);
                    hasMore = false;
                    break;
                }
            }
            
            // When using limit mode, continue fetching until we have enough closed conversations
            if (limit && conversations.length + filtered.length >= limit) {
                const needed = limit - conversations.length;
                filtered = filtered.slice(0, needed);
                conversations.push(...filtered);
                console.log(`   Reached limit of ${limit} closed conversations, stopping...`);
                hasMore = false;
                break;
            }
            
            conversations.push(...filtered);
            page++;
            
            if (onProgress) onProgress(conversations.length, page);
            
            // Pagination - use the pagination object from Intercom
            if (data.pages && data.pages.next) {
                if (data.pages.next.starting_after) {
                startingAfter = data.pages.next.starting_after;
                    console.log(`   Page ${page + 1}: Has next page, continuing...`);
                } else {
                    hasMore = false;
                    console.log(`   Page ${page + 1}: No more pages available`);
                }
            } else {
                hasMore = false;
                console.log(`   Page ${page + 1}: No pagination info, stopping`);
            }
            
            // If we haven't found enough closed conversations and limit is set, but no more pages
            if (limit && conversations.length < limit && !hasMore && batch.length > 0) {
                console.log(`   ⚠️  Only found ${conversations.length} closed conversations (target: ${limit})`);
                console.log(`   No more pages available from Intercom API`);
            }
            
            // Rate limiting
            await sleep(200);
            
        } catch (error) {
            console.error('\n❌ Error fetching conversations:');
            if (error.response) {
                console.error(`   Status: ${error.response.status} ${error.response.statusText}`);
                if (error.response.data) {
                    console.error('   Error details:', JSON.stringify(error.response.data, null, 2));
                }
            } else {
                console.error('   Error message:', error.message);
            }
            
            // Retry once if it's a server error
            if (error.response?.status === 500 && page === 0) {
                console.log('   Retrying after 2 seconds...');
                await sleep(2000);
                continue;
            }
            
            hasMore = false;
        }
    }
    
    console.log(`   Total conversations fetched: ${totalFetched}, in date range: ${conversations.length}`);
    return conversations;
}

async function fetchContactDetails(contactId) {
    if (!contactId) return null;
    try {
        const response = await intercom.get(`/contacts/${contactId}`);
        return response.data;
    } catch (error) {
        // Silently fail - contact details are optional
        return null;
    }
}

async function fetchConversationDetails(conversationId) {
    try {
        // Fetch full conversation with all parts and statistics
        const response = await intercom.get(`/conversations/${conversationId}`, {
            params: {
                display_as: 'plaintext'
            }
        });
        const data = response.data;
        
        // Debug: Log conversation structure
        console.log(`\n   Debug: Fetched conversation ${conversationId}`);
        console.log(`   - State: ${data.state}`);
        console.log(`   - Has statistics: ${!!data.statistics}`);
        console.log(`   - Has conversation_parts: ${!!data.conversation_parts}`);
        if (data.conversation_parts) {
            const parts = data.conversation_parts?.conversation_parts || data.conversation_parts;
            console.log(`   - Number of parts: ${Array.isArray(parts) ? parts.length : 'not an array'}`);
        }
        console.log(`   - Assignee: ${data.assignee?.name || data.assignee?.email || 'none'}`);
        console.log(`   - Team assignee: ${data.team_assignee_id || 'none'}`);
        console.log(`   - CSAT Rating: ${data.conversation_rating?.rating || 'none'}`);
        
        // Fetch contact details to get country
        const contactId = data.contacts?.contacts?.[0]?.id;
        if (contactId) {
            const contactDetails = await fetchContactDetails(contactId);
            if (contactDetails) {
                // Store contact location in conversation data
                data._contactLocation = contactDetails.location;
                data._contactCustomAttributes = contactDetails.custom_attributes;
                if (contactDetails.location?.country) {
                    console.log(`   - Contact Country: ${contactDetails.location.country}`);
                }
            }
        }
        
        return data;
    } catch (error) {
        console.error(`   Error fetching conversation ${conversationId}:`, error.response?.status || error.message);
        if (error.response?.data) {
            console.error(`   Details:`, JSON.stringify(error.response.data));
        }
        return null;
    }
}
        
        // Helper to check if author is bot/FIN
function isBot(author) {
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
}

// Get agent identifier (ID or name)
function getAgentId(author) {
    if (!author || isBot(author)) return null;
    return author.id ? String(author.id) : (author.name || null);
}

// Get agent name
function getAgentName(author, adminMap) {
    if (!author || isBot(author)) return null;
    if (author.id && adminMap[author.id]) {
        return adminMap[author.id];
    }
    return author.name || null;
}

function calculateMetricsPerAgent(conv, adminMap) {
    const stats = conv.statistics || {};
    const conversationCreatedAt = conv.created_at;
    const conversationUpdatedAt = conv.updated_at || conv.created_at;
    
    // Track metrics per agent
    const agentMetrics = {}; // key: agentId, value: { agentId, agentName, frt, artEvents, firstResponseTime, lastResponseTime, responseCount }
    
    // Global metrics (shared across all agents)
    const waitTime = stats.time_to_assignment || stats.time_to_first_close || null;
    
    // Track "Connect to an agent" event and assignment time for wait time calculation
    let connectToAgentTime = null; // When user clicked "Connect to an agent"
    let assignmentTime = null; // When conversation was assigned to an agent (first assignment)
    
    // Track assignment time PER AGENT for accurate FRT calculation
    const agentAssignmentTimes = {}; // key: agentId, value: assignment timestamp
    
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
    
    // Track conversation-level state
    let globalFrtProvided = false; // Track if ANY agent has provided FRT
    let lastUserMessageTime = null;
    
    if (conv.conversation_parts && conv.conversation_parts.conversation_parts) {
        const parts = conv.conversation_parts.conversation_parts;
        
        // Track user messages per agent (each agent tracks their own pending user messages)
        const agentUserMessageTime = {}; // key: agentId, value: last user message time before agent's response
        
        for (const part of parts) {
            if (!part.created_at) continue;
            
            // Track user messages - update for all agents
            if (part.author?.type === 'user') {
                // Check if this is a "Connect to an agent" message or button click
                if (part.body) {
                    const bodyText = typeof part.body === 'string' ? part.body : JSON.stringify(part.body);
                    const bodyLower = bodyText.toLowerCase();
                    if (bodyLower.includes('connect to an agent') || 
                        bodyLower.includes('connect to agent') ||
                        bodyLower.includes('quick reply') && bodyLower.includes('connect')) {
                        if (!connectToAgentTime) {
                            connectToAgentTime = part.created_at;
                        }
                    }
                }
                
                // Update last user message time for all agents (they all see this message)
                for (const agentId in agentMetrics) {
                    agentUserMessageTime[agentId] = part.created_at;
                }
                // Also track globally for first agent FRT
                lastUserMessageTime = part.created_at;
                continue;
            }
            
            // Track assignment events (system events when conversation is assigned)
            // This captures various assignment types in Intercom
            const isAssignmentEvent = 
                part.part_type === 'assignment' || 
                part.part_type === 'message_strategy_assignment' ||  // This is agent assignment!
                part.part_type === 'default_assignment' ||
                part.type === 'assignment' ||
                (part.body && typeof part.body === 'string' && part.body.toLowerCase().includes('assignment:'));
            
            if (isAssignmentEvent) {
                // Check assigned_to field (more reliable than assignee)
                const assignedTo = part.assigned_to;
                if (assignedTo && assignedTo.type === 'admin') {
                    // This is an assignment to a specific agent!
                    const agentId = String(assignedTo.id);
                    if (!agentAssignmentTimes[agentId]) {
                        agentAssignmentTimes[agentId] = part.created_at;
                    }
                    // Also track first overall agent assignment time
                    if (!assignmentTime) {
                        assignmentTime = part.created_at;
                    }
                }
                
                // Legacy check: assignee field
                if (part.assignee && !isBot(part.assignee)) {
                    const assignedAgentId = getAgentId(part.assignee);
                    if (assignedAgentId && !agentAssignmentTimes[assignedAgentId]) {
                        agentAssignmentTimes[assignedAgentId] = part.created_at;
                        if (!assignmentTime) {
                            assignmentTime = part.created_at;
                        }
                    }
                }
                
                // Also try to extract agent name from body text like "Assignment: Skylar Maddison"
                if (part.body && typeof part.body === 'string') {
                    const bodyText = part.body;
                    const assignmentMatch = bodyText.match(/Assignment:\s*([^(]+)/i);
                    if (assignmentMatch) {
                        const agentName = assignmentMatch[1].trim();
                        for (const [id, name] of Object.entries(adminMap)) {
                            if (name && name.toLowerCase() === agentName.toLowerCase()) {
                                if (!agentAssignmentTimes[id]) {
                                    agentAssignmentTimes[id] = part.created_at;
                                }
                                break;
                            }
                        }
                    }
                }
            }
            
            // Also check for assignment in other system messages
            if (part.body && typeof part.body === 'string') {
                const bodyLower = part.body.toLowerCase();
                if (bodyLower.includes('balanced assignment') || 
                    (bodyLower.includes('assigned') && !bodyLower.includes('team assignment'))) {
                    if (!assignmentTime && part.created_at) {
                        assignmentTime = part.created_at;
                    }
                }
            }
            
            // Check if this is an admin response (comment type only)
            if (part.author?.type === 'admin' && part.part_type === 'comment') {
                // Skip bot/FIN responses entirely
                if (isBot(part.author)) continue;
                
                const agentId = getAgentId(part.author);
                if (!agentId) continue;
                
                // Initialize agent metrics if not exists
                if (!agentMetrics[agentId]) {
                    agentMetrics[agentId] = {
                        agentId: agentId,
                        agentName: getAgentName(part.author, adminMap),
                        frt: null,
                        artEvents: [],
                        firstResponseTime: part.created_at,
                        lastResponseTime: part.created_at,
                        responseCount: 0
                    };
                    agentUserMessageTime[agentId] = null;
                }
                
                const agent = agentMetrics[agentId];
                agent.responseCount++;
                agent.lastResponseTime = part.created_at;
                
                // Calculate FRT for this agent (first response by this agent)
                if (agent.frt === null) {
                    // FRT = time from agent's ASSIGNMENT to agent's first response
                    // This matches Intercom's definition: Assignment → First Response
                    const agentAssignTime = agentAssignmentTimes[agentId];
                    
                    if (agentAssignTime && part.created_at > agentAssignTime) {
                        // Use agent-specific assignment time
                        agent.frt = part.created_at - agentAssignTime;
                    } else if (assignmentTime && part.created_at > assignmentTime) {
                        // Fallback to global assignment time
                        agent.frt = part.created_at - assignmentTime;
                    } else {
                        // Last fallback: use conversation creation (shouldn't happen often)
                        agent.frt = part.created_at - conversationCreatedAt;
                    }
                    
                    // Mark global FRT as provided if this is the first agent to respond
                    if (!globalFrtProvided) {
                        globalFrtProvided = true;
                        lastUserMessageTime = null; // Reset after first agent response
                        
                        // If we haven't found assignment time yet, use first agent's first response as assignment
                        if (!assignmentTime) {
                            assignmentTime = part.created_at;
                        }
                    }
                    
                    // Initialize user message tracking for this agent
                    agentUserMessageTime[agentId] = null;
                }
                
                // Calculate ART for this agent (after their FRT, when user has pending message)
                // ART = time from user's last message to this agent's response
                if (agent.frt !== null && agentUserMessageTime[agentId]) {
                    const responseTime = part.created_at - agentUserMessageTime[agentId];
                    if (responseTime > 0 && responseTime < 86400) { // Valid range: 0 to 24 hours
                        agent.artEvents.push(responseTime);
                    }
                    agentUserMessageTime[agentId] = null; // Reset after agent responds
                }
            }
        }
    }
    
    // Calculate Avg Wait Time: from "Connect to an agent" to assignment
    let avgWaitTime = null;
    if (connectToAgentTime && assignmentTime && assignmentTime > connectToAgentTime) {
        avgWaitTime = assignmentTime - connectToAgentTime;
    } else if (connectToAgentTime && !assignmentTime) {
        // If we detected "Connect to an agent" but no assignment event in parts,
        // check if conversation has assignee and use first agent response time
        if (conv.assignee && !isBot(conv.assignee)) {
            // Use the first agent's first response time as assignment time
            const firstAgent = Object.values(agentMetrics)[0];
            if (firstAgent && firstAgent.firstResponseTime > connectToAgentTime) {
                avgWaitTime = firstAgent.firstResponseTime - connectToAgentTime;
            }
        }
    } else if (!connectToAgentTime && assignmentTime) {
        // If assignment detected but no "Connect to an agent", 
        // use conversation creation as start time
        if (assignmentTime > conversationCreatedAt) {
            avgWaitTime = assignmentTime - conversationCreatedAt;
        }
    }
    
    // Convert agent metrics to array format
    const result = Object.values(agentMetrics).map(agent => {
        // Calculate ART (average of all ART events for this agent)
        let art = null;
        if (agent.artEvents.length > 0) {
            art = Math.round(agent.artEvents.reduce((sum, t) => sum + t, 0) / agent.artEvents.length);
        }
        
        // Calculate AHT for this agent (from their first response to their last response, or conversation end)
        const aht = agent.lastResponseTime - agent.firstResponseTime;
        
        // Calculate FRT Hit Rate: 1 if FRT > 30 seconds, 0 if FRT <= 30 seconds
        let frtHitRate = null;
        if (agent.frt !== null) {
            frtHitRate = agent.frt > 30 ? 1 : 0;
        }
        
        // Calculate ART Hit Rate: percentage of ART events > 60 seconds
        // Example: 6 out of 10 events > 60s = 60%
        let artHitRate = null;
        if (agent.artEvents.length > 0) {
            const eventsOver60 = agent.artEvents.filter(t => t > 60).length;
            artHitRate = Math.round((eventsOver60 / agent.artEvents.length) * 100);
        }
        
        return {
            agentId: agent.agentId,
            agentName: agent.agentName,
            frt: agent.frt,
            art: art,
            aht: aht > 0 ? aht : null,
            waitTime: waitTime,
            avgWaitTime: avgWaitTime,
            frtHitRate: frtHitRate,
            artHitRate: artHitRate,
            artEventCount: agent.artEvents.length, // Total number of ART events
            sentiment: sentiment,
            csat: csat,
            responseCount: agent.responseCount
        };
    });
    
    // If no agents found, return empty array (or could return a default entry)
    return result;
}

// ============ TRANSCRIPT EXTRACTION ============

function extractTranscript(conv) {
    const messages = [];
    
    // Add initial message from source body if exists
    if (conv.source?.body) {
        const body = conv.source.body;
        const cleanBody = typeof body === 'string' ? body.replace(/<[^>]*>/g, ' ').trim() : '';
        if (cleanBody) {
            messages.push(`[Customer]: ${cleanBody}`);
        }
    }
    
    // Extract messages from conversation parts
    if (conv.conversation_parts?.conversation_parts) {
        const parts = conv.conversation_parts.conversation_parts;
        
        for (const part of parts) {
            if (!part.body) continue;
            
            // Clean HTML from body
            const body = typeof part.body === 'string' ? part.body.replace(/<[^>]*>/g, ' ').trim() : '';
            if (!body || body.length < 2) continue;
            
            // Skip system messages
            if (part.part_type === 'assignment' || part.part_type === 'close' || 
                part.part_type === 'open' || part.part_type === 'entity_linked' ||
                part.part_type === 'ticket_state_updated_by_admin') {
                continue;
            }
            
            // Determine speaker
            let speaker = 'System';
            if (part.author?.type === 'user') {
                speaker = 'Customer';
            } else if (part.author?.type === 'admin') {
                speaker = part.author.name || 'Agent';
                // Check if bot
                if (isBot(part.author)) {
                    speaker = 'FIN (Bot)';
                }
            } else if (part.author?.type === 'bot') {
                speaker = 'FIN (Bot)';
            }
            
            messages.push(`[${speaker}]: ${body}`);
        }
    }
    
    return messages.join('\n\n');
}

// ============ SUPABASE FUNCTIONS ============

async function upsertConversation(conv, agentMetricsArray, adminMap) {
    // Get channel type
    let channel = conv.source?.type || 'unknown';
    if (channel === 'conversation') channel = 'live_chat';
    
    // Get country from multiple possible locations (priority order)
    let country = null;
    
    // 1. Check fetched contact location (most reliable - from separate API call)
    if (conv._contactLocation?.country) {
        country = conv._contactLocation.country;
    }
    // 2. Check fetched contact custom attributes
    else if (conv._contactCustomAttributes?.country) {
        country = conv._contactCustomAttributes.country;
    }
    // 3. Check conversation custom attributes
    else if (conv.custom_attributes?.country) {
        country = conv.custom_attributes.country;
    }
    // 4. Check contact custom attributes from conversation
    else if (conv.contacts?.contacts?.[0]?.custom_attributes?.country) {
        country = conv.contacts.contacts[0].custom_attributes.country;
    }
    // 5. Check contact location from conversation
    else if (conv.contacts?.contacts?.[0]?.location?.country) {
        country = conv.contacts.contacts[0].location.country;
    }
    // 6. Check source custom attributes
    else if (conv.source?.custom_attributes?.country) {
        country = conv.source.custom_attributes.country;
    }
    
    // Log country extraction for debugging
    if (country) {
        console.log(`   🌍 Country: ${country}`);
    } else {
        console.log(`   ⚠️  No country found`);
    }
    
    // Get CSAT rating (1-5 scale)
    const csatRating = conv.conversation_rating?.rating || null;
    if (csatRating) {
        console.log(`   ⭐ CSAT: ${csatRating}`);
    }
    
    // Extract transcript
    const transcript = extractTranscript(conv);
    
    // Get shared metrics (conversation-level)
    const sharedMetrics = agentMetricsArray.length > 0 ? agentMetricsArray[0] : {};
    const waitTime = sharedMetrics.waitTime || null;
    const avgWaitTime = sharedMetrics.avgWaitTime || null;
    const sentiment = sharedMetrics.sentiment || null;
    
    // If no agents found, create a bot-handled record
    if (!agentMetricsArray || agentMetricsArray.length === 0) {
        console.log(`   📝 Recording bot-handled conversation ${conv.id}`);
        
        const botRecord = {
            conversation_id: String(conv.id),
            created_at: new Date(conv.created_at * 1000).toISOString(),
            updated_at: conv.updated_at ? new Date(conv.updated_at * 1000).toISOString() : null,
            state: conv.state,
            channel: channel,
            country: country,
            assignee_id: 'FIN',
            assignee_name: 'FIN (Bot)',
            team_id: conv.team_assignee_id ? String(conv.team_assignee_id) : null,
            frt_seconds: null,
            art_seconds: null,
            aht_seconds: null,
            wait_time_seconds: waitTime,
            "Avg Wait Time": avgWaitTime,
            "FRT Hit Rate": null,
            "ART Hit Rate": null,
            sentiment: sentiment,
            csat_rating: csatRating,
            "CX score": csatRating,
            response_count: 0,
            is_reopened: (conv.statistics?.count_reopens || 0) > 0,
            reopened_count: conv.statistics?.count_reopens || 0,
            contact_id: conv.contacts?.contacts?.[0]?.id ? String(conv.contacts.contacts[0].id) : null,
            tags: conv.tags?.tags ? JSON.stringify(conv.tags.tags.map(t => t.name)) : null,
            "Transcript": transcript,
            synced_at: new Date().toISOString()
        };
        
        const { error } = await supabase
            .from(TABLE_NAME)
            .upsert(botRecord, { 
                onConflict: 'conversation_id,assignee_id'
            });
        
        if (error) {
            console.error(`Upsert error for bot conversation ${conv.id}:`, error.message);
            return 0;
        }
        
        return 1;
    }
    
    // Create one record per agent
    const records = agentMetricsArray.map(metrics => {
        let assigneeName = metrics.agentName;
    
    // If assigned to FundedNext AI, show as "FIN"
    if (assigneeName && (assigneeName.toLowerCase().includes('fundednext ai') || assigneeName.toLowerCase() === 'fin')) {
        assigneeName = 'FIN';
    }
    
        return {
        conversation_id: String(conv.id),
        created_at: new Date(conv.created_at * 1000).toISOString(),
        updated_at: conv.updated_at ? new Date(conv.updated_at * 1000).toISOString() : null,
        state: conv.state,
        channel: channel,
        country: country,
            assignee_id: metrics.agentId,
        assignee_name: assigneeName,
        team_id: conv.team_assignee_id ? String(conv.team_assignee_id) : null,
        frt_seconds: metrics.frt,
        art_seconds: metrics.art,
        aht_seconds: metrics.aht,
        wait_time_seconds: metrics.waitTime,
            "Avg Wait Time": metrics.avgWaitTime,
            "FRT Hit Rate": metrics.frtHitRate,
            "ART Hit Rate": metrics.artHitRate,
        sentiment: metrics.sentiment,
            csat_rating: csatRating,
            "CX score": csatRating,
            response_count: metrics.responseCount,
        is_reopened: (conv.statistics?.count_reopens || 0) > 0,
        reopened_count: conv.statistics?.count_reopens || 0,
        contact_id: conv.contacts?.contacts?.[0]?.id ? String(conv.contacts.contacts[0].id) : null,
        tags: conv.tags?.tags ? JSON.stringify(conv.tags.tags.map(t => t.name)) : null,
            "Transcript": transcript,
        synced_at: new Date().toISOString()
    };
    });
    
    // Upsert all records (one per agent)
    const { error } = await supabase
        .from(TABLE_NAME)
        .upsert(records, { 
            onConflict: 'conversation_id,assignee_id'
        });
    
    if (error) {
        console.error(`Upsert error for conversation ${conv.id}:`, error.message);
        return 0;
    }
    
    return records.length;
}

// ============ MAIN SYNC ============

async function main() {
    const { days, limit } = parseArgs();
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('   INTERCOM → SUPABASE SYNC');
    console.log('   Service Performance Overview');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const endDate = new Date();
    const startDate = new Date();
    
    // If limit is set, we'll ignore date filter and fetch ANY closed conversations
    if (limit) {
        // Set a very wide date range, but we'll ignore it in fetchConversations
        startDate.setFullYear(2020, 0, 1); // Very old date
        endDate.setFullYear(2030, 11, 31); // Very future date
        console.log(`📅 Fetching ANY closed conversations (no date restriction)`);
        console.log(`📊 Target: ${limit} closed conversations\n`);
    } else {
    startDate.setDate(startDate.getDate() - days);
    console.log(`📅 Date Range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`📊 Syncing last ${days} days\n`);
    }
    
    // 1. Fetch team members
    console.log('👥 Fetching team members...');
    const adminMap = await fetchTeamMembers();
    console.log(`   Found ${Object.keys(adminMap).length} team members\n`);
    
    // 2. Fetch conversations
    console.log('📬 Fetching conversations from Intercom...');
    const conversations = await fetchConversations(startDate, endDate, (count, page) => {
        process.stdout.write(`\r   Fetched ${count} conversations (page ${page})...`);
    }, limit);
    console.log(`\n   Total: ${conversations.length} conversations\n`);
    
    if (conversations.length === 0) {
        console.log('⚠️ No conversations found in date range');
        return;
    }
    
    // Conversations are already filtered to closed in fetchConversations
    // When limit is set, process ANY conversations (for testing)
    // Otherwise, only process closed conversations
    let conversationsToProcess;
    if (limit) {
        // For testing: process all conversations regardless of state
        conversationsToProcess = conversations;
        const closedCount = conversations.filter(c => c.state === 'closed').length;
        console.log(`   Total conversations: ${conversations.length} (${closedCount} closed, ${conversations.length - closedCount} other states)\n`);
        
        if (conversations.length === 0) {
            console.log('⚠️ No conversations found from Intercom');
            return;
        }
    } else {
        // Normal mode: process all conversations (not just closed) to handle any state
        // This allows syncing conversations that are still open or snoozed
        conversationsToProcess = conversations;
        const closedCount = conversations.filter(c => c.state === 'closed').length;
        console.log(`   Total conversations: ${conversations.length} (${closedCount} closed, ${conversations.length - closedCount} open/other)\n`);
        
        if (conversations.length === 0) {
            console.log('⚠️ No conversations found');
        return;
        }
    }
    
    // 3. Process and sync
    console.log('🔄 Processing and syncing to Supabase...');
    let processed = 0;
    let errors = 0;
    let withDetails = 0;
    
    // Process in batches
    const BATCH_SIZE = 20;
    for (let i = 0; i < conversationsToProcess.length; i += BATCH_SIZE) {
        const batch = conversationsToProcess.slice(i, i + BATCH_SIZE);
        
        // Always fetch full details to get conversation parts for agent detection
        const detailedBatch = await Promise.all(
            batch.map(async (conv) => {
                // Always fetch full details to ensure we have conversation_parts
                    const details = await fetchConversationDetails(conv.id);
                    if (details) {
                        withDetails++;
                    // Merge statistics if they exist in original
                    if (conv.statistics && !details.statistics) {
                        details.statistics = conv.statistics;
                    }
                        return details;
                }
                return conv;
            })
        );
        
        // Process and upsert
        let botHandled = 0;
        for (const conv of detailedBatch) {
            try {
                // Calculate metrics per agent (returns array of agent metrics)
                const agentMetricsArray = calculateMetricsPerAgent(conv, adminMap);
                
                // Upsert conversation - handles both human agents and bot-only conversations
                const rowsCreated = await upsertConversation(conv, agentMetricsArray, adminMap);
                
                if (rowsCreated > 0) {
                processed++;
                    if (!agentMetricsArray || agentMetricsArray.length === 0) {
                        botHandled++;
                        console.log(`   🤖 Conversation ${conv.id}: Bot-handled, transcript saved`);
                    } else {
                        console.log(`   ✅ Conversation ${conv.id}: Created ${rowsCreated} row(s) for ${agentMetricsArray.length} agent(s)`);
                    }
            } else {
                    errors++;
                    console.log(`   ❌ Conversation ${conv.id}: Failed to upsert`);
                }
            } catch (error) {
                console.error(`   ❌ Error processing conversation ${conv.id}:`, error.message);
                errors++;
            }
        }
        
        // Progress
        const progress = Math.round(((i + batch.length) / conversationsToProcess.length) * 100);
        process.stdout.write(`\r   Progress: ${progress}% (${processed} conversations, ${errors} errors)`);
        
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
    console.log('   📝 Note: Multiple rows created per conversation (one per agent)');
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Verify count
    const { count } = await supabase
        .from(TABLE_NAME)
        .select('*', { count: 'exact', head: true });
    
    console.log(`📊 Total records in "${TABLE_NAME}": ${count || 0}`);
    
    // Show sample of conversations with multiple agents
    const { data: sampleData } = await supabase
        .from(TABLE_NAME)
        .select('conversation_id, assignee_name, frt_seconds, art_seconds, aht_seconds, frt_hit_rate, art_hit_rate, avg_wait_time_seconds')
        .order('conversation_id', { ascending: false })
        .limit(10);
    
    if (sampleData && sampleData.length > 0) {
        console.log('\n📋 Sample records (showing conversation_id, agent, and metrics):');
        const grouped = {};
        sampleData.forEach(row => {
            if (!grouped[row.conversation_id]) {
                grouped[row.conversation_id] = [];
            }
            grouped[row.conversation_id].push(row);
        });
        
        Object.entries(grouped).slice(0, 3).forEach(([convId, rows]) => {
            console.log(`   Conversation ${convId}: ${rows.length} agent(s)`);
            rows.forEach(row => {
                console.log(`      - ${row.assignee_name}: FRT=${row.frt_seconds}s (Hit: ${row.frt_hit_rate}), ART=${row.art_seconds}s (Hit: ${row.art_hit_rate}), AHT=${row.aht_seconds}s, Wait=${row.avg_wait_time_seconds}s`);
            });
        });
    }
    console.log('');
}

main().catch(console.error);

