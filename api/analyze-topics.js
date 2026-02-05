/**
 * Vercel Serverless API - Analyze Conversation Topics
 * Using https module instead of fetch for compatibility
 */

const https = require('https');

// Helper to make HTTPS requests
function httpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// AI Categorization Prompt
const CATEGORIZATION_PROMPT = `Analyze this support conversation transcript and return JSON only:
{
  "Main Category": ["category"],
  "Sub category": ["sub-category"],
  "Customer sentiment": {"beginning": "sentiment", "end": "sentiment"},
  "Resolution outcome": "Yes/No/Pending",
  "Suggestions & feedback": ["suggestion"]
}

Sentiment values: Very Negative, Negative, Neutral, Positive, Very Positive
Categories: KYC & Verification, Dashboard & Account Access, Rules & Scaling, Platform & Trading, Payment & Refunds, Payout, Offers & Coupons, Certificates & Competition, Compliance, Support

Transcript:
`;

function htmlToText(html) {
    if (!html) return '';
    return String(html)
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

function extractTranscript(conv) {
    const messages = [];
    
    if (conv.source && conv.source.body) {
        const body = htmlToText(conv.source.body);
        if (body) messages.push({ role: 'USER', body });
    }
    
    const parts = (conv.conversation_parts && conv.conversation_parts.conversation_parts) || [];
    for (const part of parts) {
        if (part.part_type !== 'comment' || !part.body) continue;
        const author = part.author || {};
        const role = author.type === 'user' ? 'USER' : author.type === 'admin' ? 'AGENT' : null;
        if (!role) continue;
        const text = htmlToText(part.body);
        if (text) messages.push({ role, body: text });
    }
    
    return messages.map(m => `${m.role}: ${m.body}`).join('\n');
}

async function fetchIntercom(endpoint, options = {}) {
    const url = `https://api.intercom.io${endpoint}`;
    return httpsRequest(url, {
        method: options.method || 'GET',
        headers: {
            'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Intercom-Version': '2.10'
        },
        body: options.body
    });
}

async function analyzeWithAI(transcript) {
    const response = await httpsRequest('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'system', content: 'You are a support ticket categorization AI. Respond with valid JSON only.' },
                { role: 'user', content: CATEGORIZATION_PROMPT + transcript }
            ],
            temperature: 0,
            max_tokens: 500
        })
    });

    if (!response.ok) return null;
    
    const content = response.data.choices?.[0]?.message?.content || '';
    try {
        let jsonStr = content.trim().replace(/^```json\s*/, '').replace(/```$/, '');
        const parsed = JSON.parse(jsonStr);
        return {
            main_category: parsed['Main Category'] || [],
            sub_category: parsed['Sub category'] || [],
            sentiment_start: parsed['Customer sentiment']?.beginning || 'Unknown',
            sentiment_end: parsed['Customer sentiment']?.end || 'Unknown',
            resolution_outcome: parsed['Resolution outcome'] || 'Pending',
            feedbacks: parsed['Suggestions & feedback'] || []
        };
    } catch (e) {
        return null;
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Health check
    if (req.method === 'GET') {
        return res.status(200).json({ 
            status: 'ok', 
            hasIntercomToken: !!process.env.INTERCOM_ACCESS_TOKEN,
            hasOpenAIKey: !!process.env.OPENAI_API_KEY
        });
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!process.env.INTERCOM_ACCESS_TOKEN) {
        return res.status(500).json({ error: 'INTERCOM_ACCESS_TOKEN not configured' });
    }
    
    const { action, conversationId, dateFrom, dateTo, timeFrom, timeTo, startingAfter } = req.body || {};
    
    try {
        // Action: Analyze a single conversation with AI
        if (action === 'analyze-single') {
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId required' });
            }
            
            if (!process.env.OPENAI_API_KEY) {
                return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
            }
            
            const convResp = await fetchIntercom(`/conversations/${conversationId}?display_as=plaintext`);
            if (!convResp.ok) {
                return res.status(404).json({ error: 'Conversation not found' });
            }
            
            const conv = convResp.data;
            const transcript = extractTranscript(conv);
            const aiResult = await analyzeWithAI(transcript);
            
            return res.status(200).json({
                success: true,
                data: {
                    'Conversation ID': String(conv.id),
                    'Main-Topics': aiResult?.main_category || [],
                    'Sub-Topics': aiResult?.sub_category || [],
                    'Sentiment Start': aiResult?.sentiment_start || null,
                    'Sentiment End': aiResult?.sentiment_end || null,
                    'Feedbacks': aiResult?.feedbacks || [],
                    'Was it in client\'s favor?': aiResult?.resolution_outcome || null
                }
            });
        }
        
        // Action: Fetch a single conversation (for legacy/single mode)
        if (action === 'fetch-single') {
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId required' });
            }
            
            const convResp = await fetchIntercom(`/conversations/${conversationId}?display_as=plaintext`);
            if (!convResp.ok) {
                return res.status(404).json({ error: 'Conversation not found' });
            }
            
            const conv = convResp.data;
            const transcript = extractTranscript(conv);
            
            // Get contact for country
            let country = null, region = null;
            const contactId = conv.contacts?.contacts?.[0]?.id;
            if (contactId) {
                const contactResp = await fetchIntercom(`/contacts/${contactId}`);
                if (contactResp.ok) {
                    country = contactResp.data.location?.country;
                    region = contactResp.data.location?.region;
                }
            }
            
            // Also run AI analysis for single fetch
            let aiResult = null;
            if (process.env.OPENAI_API_KEY) {
                aiResult = await analyzeWithAI(transcript);
            }
            
            return res.status(200).json({
                success: true,
                data: {
                    'Conversation ID': String(conv.id),
                    'created_at': conv.created_at,
                    'Email': conv.source?.author?.email || null,
                    'Transcript': transcript,
                    'Country': country,
                    'Region': region,
                    'Main-Topics': aiResult?.main_category || [],
                    'Sub-Topics': aiResult?.sub_category || [],
                    'Sentiment Start': aiResult?.sentiment_start || null,
                    'Sentiment End': aiResult?.sentiment_end || null,
                    'Feedbacks': aiResult?.feedbacks || [],
                    'Was it in client\'s favor?': aiResult?.resolution_outcome || null
                }
            });
        }
        
        // Action: Fetch conversation IDs only (fast) - for pagination
        if (action === 'fetch-ids') {
            if (!dateFrom || !dateTo) {
                return res.status(400).json({ error: 'dateFrom and dateTo required' });
            }
            
            const fromStr = dateFrom.includes('T') ? dateFrom : dateFrom + 'T' + (timeFrom || '00:00') + ':00Z';
            const toStr = dateTo.includes('T') ? dateTo : dateTo + 'T' + (timeTo || '23:59') + ':59Z';
            const fromTs = Math.floor(new Date(fromStr).getTime() / 1000);
            const toTs = Math.floor(new Date(toStr).getTime() / 1000);
            
            const searchBody = {
                query: {
                    operator: 'AND',
                    value: [
                        { field: 'created_at', operator: '>=', value: fromTs },
                        { field: 'created_at', operator: '<=', value: toTs }
                    ]
                },
                pagination: { per_page: 150 }
            };
            
            if (startingAfter) {
                searchBody.pagination.starting_after = startingAfter;
            }
            
            const searchResp = await fetchIntercom('/conversations/search', {
                method: 'POST',
                body: JSON.stringify(searchBody)
            });
            
            if (!searchResp.ok) {
                console.error('Intercom search failed:', searchResp.status, searchResp.data);
                return res.status(500).json({ 
                    error: 'Failed to search conversations',
                    details: searchResp.data
                });
            }
            
            const conversations = searchResp.data.conversations || [];
            const totalCount = searchResp.data.total_count || 0;
            const pages = searchResp.data.pages;
            const nextStartingAfter = pages?.next?.starting_after || null;
            
            // Return minimal records for Phase 1: Conversation ID + created_at (150 per page)
            const data = conversations.map(c => ({
                'Conversation ID': String(c.id),
                'created_at': c.created_at != null ? String(c.created_at) : null
            }));
            
            return res.status(200).json({
                success: true,
                data,
                totalCount,
                nextStartingAfter,
                hasMore: !!nextStartingAfter
            });
        }
        
        // Action: Debug - return raw conversation and contact data to inspect field structure
        if (action === 'debug') {
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId required' });
            }
            
            const convResp = await fetchIntercom(`/conversations/${conversationId}?display_as=plaintext`);
            if (!convResp.ok) {
                return res.status(404).json({ error: 'Conversation not found' });
            }
            
            const conv = convResp.data;
            
            // Get contact if available
            let contact = null;
            const contactId = conv.contacts?.contacts?.[0]?.id;
            if (contactId) {
                const contactResp = await fetchIntercom(`/contacts/${contactId}`);
                if (contactResp.ok) {
                    contact = contactResp.data;
                }
            }
            
            // Return raw data for debugging
            return res.status(200).json({
                success: true,
                conversation: {
                    id: conv.id,
                    custom_attributes: conv.custom_attributes,
                    tags: conv.tags,
                    topics: conv.topics,
                    source: conv.source,
                    conversation_rating: conv.conversation_rating,
                    all_keys: Object.keys(conv)
                },
                contact: contact ? {
                    id: contact.id,
                    external_id: contact.external_id,
                    location: contact.location,
                    custom_attributes: contact.custom_attributes,
                    all_keys: Object.keys(contact)
                } : null
            });
        }

        // Action: Fetch full details for a single conversation (for saving to Supabase)
        if (action === 'fetch-details') {
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId required' });
            }
            
            const convResp = await fetchIntercom(`/conversations/${conversationId}?display_as=plaintext`);
            if (!convResp.ok) {
                return res.status(404).json({ error: 'Conversation not found' });
            }
            
            const conv = convResp.data;
            const transcript = extractTranscript(conv);
            
            // Get contact details by fetching the contact (Country, Region from contact.location)
            let contactData = { Country: null, Region: null, 'User ID': null };
            let contactResp = null;
            const contactId = conv.contacts?.contacts?.[0]?.id;
            if (contactId) {
                contactResp = await fetchIntercom(`/contacts/${contactId}`);
                if (contactResp.ok) {
                    const contact = contactResp.data;
                    contactData = {
                        'Country': contact.location?.country || null,
                        'Region': contact.location?.region || null,
                        'User ID': contact.external_id || contact.id || null
                    };
                }
            }
            
            // Get team/channel assignment
            const teamAssigneeId = conv.team_assignee_id;
            
            // Conversation rating (Intercom conversation_rating.rating)
            const rating = conv.conversation_rating?.rating;
            
            // Product: Check MULTIPLE sources for product data
            // Known product values to look for in tags/topics
            const KNOWN_PRODUCTS = ['CFD', 'CFDs', 'Futures', 'Forex', 'Stocks', 'Crypto', 'Options', 'Commodities', 'Indices', 'ETF', 'Bonds'];
            
            let product = null;
            
            // Source 1: Conversation custom_attributes
            const customAttrs = conv.custom_attributes || {};
            product = customAttrs.product ?? customAttrs.Product ?? customAttrs.product_name ?? customAttrs.channel ?? null;
            
            // Scan all custom_attributes keys for any containing "product" (case-insensitive)
            if (!product) {
                for (const [k, v] of Object.entries(customAttrs)) {
                    if (v != null && String(v).trim() !== '' && /product|channel/i.test(k)) {
                        product = String(v);
                        break;
                    }
                }
            }
            
            // Source 2: Tags - check if any tag name matches known products
            if (!product && conv.tags?.tags?.length > 0) {
                for (const tag of conv.tags.tags) {
                    const tagName = tag.name || tag;
                    // Check if tag name contains a known product
                    for (const knownProduct of KNOWN_PRODUCTS) {
                        if (String(tagName).toLowerCase().includes(knownProduct.toLowerCase())) {
                            product = knownProduct;
                            break;
                        }
                    }
                    // Also check if tag name contains "product" in the key
                    if (!product && /product/i.test(String(tagName))) {
                        product = String(tagName).replace(/product[:\s]*/i, '').trim() || tagName;
                    }
                    if (product) break;
                }
            }
            
            // Source 3: Topics - might have product info
            if (!product && conv.topics) {
                const topicsArr = Array.isArray(conv.topics) ? conv.topics : (conv.topics.topics || []);
                for (const topic of topicsArr) {
                    const topicName = topic.name || topic;
                    for (const knownProduct of KNOWN_PRODUCTS) {
                        if (String(topicName).toLowerCase().includes(knownProduct.toLowerCase())) {
                            product = knownProduct;
                            break;
                        }
                    }
                    if (product) break;
                }
            }
            
            // Source 4: Contact custom_attributes (if we fetched contact data)
            if (!product && contactResp?.data?.custom_attributes) {
                const contactAttrs = contactResp.data.custom_attributes;
                product = contactAttrs.product ?? contactAttrs.Product ?? contactAttrs.channel ?? null;
                if (!product) {
                    for (const [k, v] of Object.entries(contactAttrs)) {
                        if (v != null && String(v).trim() !== '' && /product|channel/i.test(k)) {
                            product = String(v);
                            break;
                        }
                    }
                }
            }
            
            // Source 5: Check conversation source metadata
            if (!product && conv.source?.custom_attributes) {
                const srcAttrs = conv.source.custom_attributes;
                product = srcAttrs.product ?? srcAttrs.Product ?? null;
            }
            
            // Build the full record with all available data
            const record = {
                'Conversation ID': String(conv.id),
                'created_at': conv.created_at,
                'Email': conv.source?.author?.email || null,
                'Transcript': transcript || null,
                'User ID': contactData['User ID'] || conv.source?.author?.id || null,
                'Country': contactData['Country'] || null,
                'Region': contactData['Region'] || null,
                'Assigned Channel ID': teamAssigneeId ? String(teamAssigneeId) : null,
                'CX Score Rating': rating != null ? String(rating) : null,
                'Conversation Rating': rating != null ? String(rating) : null,
                'Product': product
            };
            
            return res.status(200).json({
                success: true,
                data: record
            });
        }
        
        // Legacy: Fetch one page of conversations (150 per page) - NO AI analysis
        if (action === 'fetch-page') {
            if (!dateFrom || !dateTo) {
                return res.status(400).json({ error: 'dateFrom and dateTo required' });
            }
            
            const fromStr = dateFrom.includes('T') ? dateFrom : dateFrom + 'T' + (timeFrom || '00:00') + ':00Z';
            const toStr = dateTo.includes('T') ? dateTo : dateTo + 'T' + (timeTo || '23:59') + ':59Z';
            const fromTs = Math.floor(new Date(fromStr).getTime() / 1000);
            const toTs = Math.floor(new Date(toStr).getTime() / 1000);
            
            const searchBody = {
                query: {
                    operator: 'AND',
                    value: [
                        { field: 'created_at', operator: '>=', value: fromTs },
                        { field: 'created_at', operator: '<=', value: toTs }
                    ]
                },
                pagination: { per_page: 150 }
            };
            
            if (startingAfter) {
                searchBody.pagination.starting_after = startingAfter;
            }
            
            const searchResp = await fetchIntercom('/conversations/search', {
                method: 'POST',
                body: JSON.stringify(searchBody)
            });
            
            if (!searchResp.ok) {
                console.error('Intercom search failed:', searchResp.status, searchResp.data);
                return res.status(500).json({ 
                    error: 'Failed to search conversations',
                    details: searchResp.data
                });
            }
            
            const conversations = searchResp.data.conversations || [];
            const totalCount = searchResp.data.total_count || 0;
            const pages = searchResp.data.pages;
            const nextStartingAfter = pages?.next?.starting_after || null;
            
            // Return basic info - full details fetched separately
            const results = conversations.map(conv => ({
                'Conversation ID': String(conv.id),
                'created_at': conv.created_at
            }));
            
            return res.status(200).json({
                success: true,
                data: results,
                totalCount,
                pageSize: conversations.length,
                nextStartingAfter,
                hasMore: !!nextStartingAfter
            });
        }
        
        return res.status(400).json({ error: 'Invalid action. Use: fetch-page, fetch-single, or analyze-single' });
        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
