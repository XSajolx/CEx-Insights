#!/usr/bin/env node
/**
 * Update ART for existing conversations in Supabase
 * Fetches conversation details from Intercom and recalculates ART
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// ============ CONFIGURATION ============
require('dotenv').config();
const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'Service Performance Overview';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const intercomApi = axios.create({
    baseURL: 'https://api.intercom.io',
    headers: {
        'Authorization': `Bearer ${INTERCOM_TOKEN}`,
        'Accept': 'application/json',
        'Intercom-Version': '2.11'
    }
});

// Check if author is a bot/FIN (not a human agent)
function isBot(author) {
    if (!author) return true;
    
    const name = (author.name || '').toLowerCase();
    const email = (author.email || '').toLowerCase();
    const type = author.type || '';
    
    // Check for bot type
    if (type === 'bot') return true;
    
    // Check for FIN / FundedNext AI
    if (name.includes('fundednext ai')) return true;
    if (name === 'fin') return true;
    if (name.includes('operator')) return true;
    if (name.includes('workflow')) return true;
    
    // Check email patterns
    if (email.includes('bot')) return true;
    if (email.includes('operator')) return true;
    if (email.includes('intercom')) return true;
    
    return false;
}

// Calculate ART from conversation parts
// ART = Average time from user's last message to human agent's response (after FRT)
function calculateART(conv) {
    if (!conv.conversation_parts?.conversation_parts) return null;
    
    const parts = conv.conversation_parts.conversation_parts;
    let artEvents = [];
    let lastUserMessageTime = null;
    let frtProvided = false;
    
    for (const part of parts) {
        if (!part.created_at) continue;
        
        // Track user messages - always update to get the LAST user message before agent responds
        if (part.author?.type === 'user') {
            lastUserMessageTime = part.created_at;
            continue;
        }
        
        // Check if this is an admin/agent response (comment type only)
        if (part.author?.type === 'admin' && part.part_type === 'comment') {
            
            // Skip bot/FIN responses entirely
            if (isBot(part.author)) {
                continue;
            }
            
            // This is a HUMAN agent response
            if (!frtProvided) {
                // First HUMAN agent response = FRT, mark as provided but don't count for ART
                frtProvided = true;
                lastUserMessageTime = null; // Reset after FRT
            } else if (lastUserMessageTime) {
                // Human agent response after FRT, with a pending user message
                const responseTime = part.created_at - lastUserMessageTime;
                if (responseTime > 0 && responseTime < 86400) { // Max 24 hours
                    artEvents.push(responseTime);
                }
                lastUserMessageTime = null; // Reset after counting
            }
        }
    }
    
    // Calculate average of all ART events
    if (artEvents.length > 0) {
        const total = artEvents.reduce((sum, t) => sum + t, 0);
        return Math.round(total / artEvents.length);
    }
    
    return null;
}

// Fetch single conversation from Intercom
async function fetchConversation(conversationId) {
    try {
        const response = await intercomApi.get(`/conversations/${conversationId}`, {
            params: { display_as: 'plaintext' }
        });
        return response.data;
    } catch (error) {
        if (error.response?.status === 404) {
            console.log(`  ⚠️ Conversation ${conversationId} not found in Intercom`);
            return null;
        }
        throw error;
    }
}

// Update ART in Supabase
async function updateART(conversationId, artSeconds) {
    const { error } = await supabase
        .from(TABLE_NAME)
        .update({ art_seconds: artSeconds })
        .eq('conversation_id', conversationId);
    
    if (error) {
        console.error(`  ❌ Failed to update ${conversationId}:`, error.message);
        return false;
    }
    return true;
}

// Main function
async function main() {
    console.log('🔄 Updating ART for existing conversations...\n');
    
    // Get only CLOSED conversation IDs from Supabase
    const { data: records, error } = await supabase
        .from(TABLE_NAME)
        .select('conversation_id')
        .eq('state', 'closed')
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error('❌ Failed to fetch conversation IDs:', error.message);
        process.exit(1);
    }
    
    console.log(`📊 Found ${records.length} conversations to update\n`);
    
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    for (let i = 0; i < records.length; i++) {
        const { conversation_id } = records[i];
        process.stdout.write(`\r⏳ Processing ${i + 1}/${records.length}: ${conversation_id}`);
        
        try {
            // Fetch conversation from Intercom
            const conv = await fetchConversation(conversation_id);
            
            if (!conv) {
                skipped++;
                continue;
            }
            
            // Calculate new ART
            const art = calculateART(conv);
            
            // Update in Supabase
            const success = await updateART(conversation_id, art);
            
            if (success) {
                updated++;
            } else {
                failed++;
            }
            
            // Rate limiting - 100ms between requests
            await new Promise(r => setTimeout(r, 100));
            
        } catch (error) {
            console.error(`\n❌ Error processing ${conversation_id}:`, error.message);
            failed++;
            
            // If rate limited, wait longer
            if (error.response?.status === 429) {
                console.log('⏳ Rate limited, waiting 60 seconds...');
                await new Promise(r => setTimeout(r, 60000));
            }
        }
    }
    
    console.log('\n\n✅ Update complete!');
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Failed: ${failed}`);
}

main().catch(console.error);
