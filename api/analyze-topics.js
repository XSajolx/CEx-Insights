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
    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }
    
    const { action, conversationId, dateFrom, dateTo, limit = 5 } = req.body || {};
    
    try {
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
            const aiResult = await analyzeWithAI(transcript);
            
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
            
        } else if (action === 'fetch-range') {
            if (!dateFrom || !dateTo) {
                return res.status(400).json({ error: 'dateFrom and dateTo required' });
            }
            
            const fromTs = Math.floor(new Date(dateFrom + 'T00:00:00Z').getTime() / 1000);
            const toTs = Math.floor(new Date(dateTo + 'T23:59:59Z').getTime() / 1000);
            
            const searchResp = await fetchIntercom('/conversations/search', {
                method: 'POST',
                body: JSON.stringify({
                    query: {
                        operator: 'AND',
                        value: [
                            { field: 'created_at', operator: '>=', value: fromTs },
                            { field: 'created_at', operator: '<=', value: toTs }
                        ]
                    },
                    pagination: { per_page: Math.min(parseInt(limit) || 5, 20) }
                })
            });
            
            if (!searchResp.ok) {
                console.error('Intercom search failed:', searchResp.status, searchResp.data);
                return res.status(500).json({ 
                    error: 'Failed to search conversations',
                    details: searchResp.data,
                    hasToken: !!process.env.INTERCOM_ACCESS_TOKEN,
                    tokenStart: process.env.INTERCOM_ACCESS_TOKEN?.substring(0, 10) + '...'
                });
            }
            
            const conversations = searchResp.data.conversations || [];
            const results = [];
            const maxProcess = Math.min(parseInt(limit) || 5, conversations.length, 10);
            
            for (let i = 0; i < maxProcess; i++) {
                const convId = conversations[i].id;
                
                const convResp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
                if (!convResp.ok) continue;
                
                const conv = convResp.data;
                const transcript = extractTranscript(conv);
                const aiResult = await analyzeWithAI(transcript);
                
                let country = null;
                const contactId = conv.contacts?.contacts?.[0]?.id;
                if (contactId) {
                    const contactResp = await fetchIntercom(`/contacts/${contactId}`);
                    if (contactResp.ok) country = contactResp.data.location?.country;
                }
                
                results.push({
                    'Conversation ID': String(conv.id),
                    'created_at': conv.created_at,
                    'Email': conv.source?.author?.email || null,
                    'Transcript': transcript.substring(0, 300) + (transcript.length > 300 ? '...' : ''),
                    'Country': country,
                    'Main-Topics': aiResult?.main_category || [],
                    'Sub-Topics': aiResult?.sub_category || [],
                    'Sentiment Start': aiResult?.sentiment_start || null,
                    'Sentiment End': aiResult?.sentiment_end || null,
                    'Feedbacks': aiResult?.feedbacks || [],
                    'Was it in client\'s favor?': aiResult?.resolution_outcome || null
                });
            }
            
            return res.status(200).json({ success: true, data: results, total: conversations.length });
            
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }
        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
