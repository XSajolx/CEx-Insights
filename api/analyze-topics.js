/**
 * Vercel Serverless API - Analyze Conversation Topics
 * 
 * Fetches conversations from Intercom, analyzes with OpenAI, stores in Supabase
 */

// AI Categorization Prompt (shortened for efficiency)
const CATEGORIZATION_PROMPT = `# FundedNext AI Categorization

**Input:** Intercom support chat transcript provided below.

## Task
Read entire conversation (user + agent). Identify client's main frustration topics from actual discussion.

## Output Format (JSON STRICT)
{
  "Main Category": ["<category>"],
  "Sub category": ["<sub-category>"],
  "Customer sentiment": {
    "beginning": "<sentiment>",
    "end": "<sentiment>"
  },
  "Resolution outcome": "<Yes/No/Pending>",
  "Suggestions & feedback": ["<suggestion 1>", "<suggestion 2>"]
}

**Sentiment values:** "Very Negative" | "Negative" | "Neutral" | "Positive" | "Very Positive"
**Resolution:** "Yes" (resolved for client) | "No" (not resolved) | "Pending" (ongoing)

## Topic Taxonomy
KYC & Verification: Veriff Doesn't Accept KYC Documents, Waiting For KYC Verification, KYC Verification Delay Issue, KYC Done Yet to Receive FundedNext Account, TRM Email Issue, KYC Eligibility Inquiry
Dashboard & Account Access: Account Breach Issue, Dashboard update delay, Balance Mismatch, OTP Not Received, 2FA Issue, Did not receive Phase 2 Account
Rules & Scaling: Challenge Rule Clarification, Scaling Rule Clarification, Scale-Up Eligibility Inquiry, Minimum Trading Days Confusion
Platform & Trading: Trading Disabled, Platform Freeze, Market Data Delayed Issue, Slippage Issue, MT5/MT4/Tradovate/TradingView login Issue
Payment & Refunds: Facing Payment Error, Payment Method Not Available, Crypto Payment Not Reflected, Wrong Network Payment, Double Charged, Refund Delay
Payout: Payout On Hold, Payout Delay Issue, Not Eligible for Payout, Payout Discrepancy, Unable to See Payout Proof, Payout Related Query
Offers & Coupons: Coupon Code Not Working, Missing Free BOGO Account, Offer Related Query, Looking for coupon code
Certificates & Competition: Elite Trader Certificate, Competition Rule Clarification, Unable to register in the Monthly Competition
Compliance: Restricted Country Issue, Location Related Issue, Account Deactivation Due to Abusive Activities
Support: Delay in Receiving Customer Support

Now analyze this transcript:
`;

// Helper functions
function htmlToText(html) {
    if (!html) return '';
    let text = String(html);
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
               .replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<br\s*\/?>/gi, '\n')
               .replace(/<\/p>/gi, '\n');
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&#39;/g, "'")
               .replace(/&quot;/g, '"');
    return text.trim();
}

function extractTranscript(conv) {
    const messages = [];
    
    if (conv.source && conv.source.body) {
        const body = htmlToText(conv.source.body);
        if (body) {
            messages.push({ role: 'USER', body, created_at: conv.created_at || 0 });
        }
    }
    
    const parts = (conv.conversation_parts && conv.conversation_parts.conversation_parts) || [];
    for (const part of parts) {
        if (part.part_type !== 'comment' || !part.body) continue;
        const author = part.author || {};
        let role = author.type === 'user' ? 'USER' : author.type === 'admin' ? 'AGENT' : null;
        if (!role) continue;
        const text = htmlToText(part.body);
        if (text) messages.push({ role, body: text, created_at: part.created_at || 0 });
    }
    
    messages.sort((a, b) => a.created_at - b.created_at);
    return messages.map(m => `${m.role}: ${m.body}`).join('\n');
}

async function fetchFromIntercom(endpoint, options = {}) {
    const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
    const url = `https://api.intercom.io${endpoint}`;
    
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${INTERCOM_TOKEN}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Intercom-Version': '2.10',
            ...(options.headers || {})
        }
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Intercom API error: ${response.status} - ${text}`);
    }
    
    return response.json();
}

async function analyzeWithAI(transcript) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'system', content: 'You are a support ticket categorization AI. Always respond with valid JSON only, no markdown.' },
                { role: 'user', content: CATEGORIZATION_PROMPT + '\n\n' + transcript }
            ],
            temperature: 0,
            max_tokens: 1000
        })
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${text}`);
    }
    
    const data = await response.json();
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/```$/, '');
    else if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```\s*/, '').replace(/```$/, '');
    
    try {
        const parsed = JSON.parse(jsonStr);
        return {
            main_category: parsed['Main Category'] || [],
            sub_category: parsed['Sub category'] || [],
            sentiment_start: (parsed['Customer sentiment'] && parsed['Customer sentiment'].beginning) || 'Unknown',
            sentiment_end: (parsed['Customer sentiment'] && parsed['Customer sentiment'].end) || 'Unknown',
            resolution_outcome: parsed['Resolution outcome'] || 'Pending',
            feedbacks: parsed['Suggestions & feedback'] || []
        };
    } catch (e) {
        console.error('Failed to parse AI response:', jsonStr);
        return null;
    }
}

// Main handler - CommonJS export for Vercel
module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    console.log('API called:', req.method, req.url);
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method === 'GET') {
        // Health check
        return res.status(200).json({ 
            status: 'ok', 
            hasIntercomToken: !!process.env.INTERCOM_ACCESS_TOKEN,
            hasOpenAIKey: !!process.env.OPENAI_API_KEY
        });
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('Request body:', JSON.stringify(req.body));

    // Check environment variables
    if (!process.env.INTERCOM_ACCESS_TOKEN) {
        console.error('Missing INTERCOM_ACCESS_TOKEN');
        return res.status(500).json({ error: 'INTERCOM_ACCESS_TOKEN not configured in Vercel' });
    }
    if (!process.env.OPENAI_API_KEY) {
        console.error('Missing OPENAI_API_KEY');
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured in Vercel' });
    }
    
    const { action, conversationId, dateFrom, dateTo, limit = 10 } = req.body || {};
    console.log('Action:', action, 'ConversationId:', conversationId, 'DateFrom:', dateFrom, 'DateTo:', dateTo);
    
    try {
        if (action === 'fetch-single') {
            // Fetch and analyze a single conversation by ID
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId is required' });
            }
            
            const conv = await fetchFromIntercom(`/conversations/${conversationId}?display_as=plaintext`);
            
            if (!conv || conv.type !== 'conversation') {
                return res.status(404).json({ error: 'Conversation not found' });
            }
            
            // Get contact details for country
            const contactId = (conv.source && conv.source.author && conv.source.author.id) || 
                            (conv.contacts && conv.contacts.contacts && conv.contacts.contacts[0] && conv.contacts.contacts[0].id);
            let contactDetails = null;
            if (contactId) {
                try {
                    contactDetails = await fetchFromIntercom(`/contacts/${contactId}`);
                } catch (e) {
                    // Contact fetch failed, continue without it
                }
            }
            
            // Extract transcript
            const transcript = extractTranscript(conv);
            
            // Analyze with AI
            const aiResult = await analyzeWithAI(transcript);
            
            const result = {
                'Conversation ID': String(conv.id),
                'created_at': conv.created_at,
                'Email': (conv.source && conv.source.author && conv.source.author.email) || null,
                'Transcript': transcript,
                'Country': (contactDetails && contactDetails.location && contactDetails.location.country) || null,
                'Region': (contactDetails && contactDetails.location && contactDetails.location.region) || null,
                'User ID': contactId || null,
                'Assigned Channel ID': conv.team_assignee_id ? String(conv.team_assignee_id) : null,
                'Main-Topics': aiResult ? aiResult.main_category : [],
                'Sub-Topics': aiResult ? aiResult.sub_category : [],
                'Sentiment Start': aiResult ? aiResult.sentiment_start : null,
                'Sentiment End': aiResult ? aiResult.sentiment_end : null,
                'Feedbacks': aiResult ? aiResult.feedbacks : [],
                'Was it in client\'s favor?': aiResult ? aiResult.resolution_outcome : null
            };
            
            return res.status(200).json({ success: true, data: result });
            
        } else if (action === 'fetch-range') {
            // Fetch conversations in date range
            if (!dateFrom || !dateTo) {
                return res.status(400).json({ error: 'dateFrom and dateTo are required' });
            }
            
            const fromTs = Math.floor(new Date(dateFrom + 'T00:00:00Z').getTime() / 1000);
            const toTs = Math.floor(new Date(dateTo + 'T23:59:59Z').getTime() / 1000);
            
            const searchResult = await fetchFromIntercom('/conversations/search', {
                method: 'POST',
                body: JSON.stringify({
                    query: {
                        operator: 'AND',
                        value: [
                            { field: 'created_at', operator: '>=', value: fromTs },
                            { field: 'created_at', operator: '<=', value: toTs }
                        ]
                    },
                    pagination: { per_page: Math.min(parseInt(limit) || 10, 150) }
                })
            });
            
            const conversations = searchResult.conversations || [];
            const results = [];
            const maxToProcess = Math.min(parseInt(limit) || 10, conversations.length);
            
            for (let i = 0; i < maxToProcess; i++) {
                const conv = conversations[i];
                
                try {
                    // Fetch full details
                    const details = await fetchFromIntercom(`/conversations/${conv.id}?display_as=plaintext`);
                    if (!details) continue;
                    
                    // Get contact
                    const contactId = (details.source && details.source.author && details.source.author.id) || 
                                    (details.contacts && details.contacts.contacts && details.contacts.contacts[0] && details.contacts.contacts[0].id);
                    let contactDetails = null;
                    if (contactId) {
                        try {
                            contactDetails = await fetchFromIntercom(`/contacts/${contactId}`);
                        } catch (e) {
                            // Continue without contact details
                        }
                    }
                    
                    // Extract transcript
                    const transcript = extractTranscript(details);
                    
                    // Analyze with AI
                    const aiResult = await analyzeWithAI(transcript);
                    
                    const result = {
                        'Conversation ID': String(details.id),
                        'created_at': details.created_at,
                        'Email': (details.source && details.source.author && details.source.author.email) || null,
                        'Transcript': transcript.length > 500 ? transcript.substring(0, 500) + '...' : transcript,
                        'Country': (contactDetails && contactDetails.location && contactDetails.location.country) || null,
                        'Region': (contactDetails && contactDetails.location && contactDetails.location.region) || null,
                        'Main-Topics': aiResult ? aiResult.main_category : [],
                        'Sub-Topics': aiResult ? aiResult.sub_category : [],
                        'Sentiment Start': aiResult ? aiResult.sentiment_start : null,
                        'Sentiment End': aiResult ? aiResult.sentiment_end : null,
                        'Feedbacks': aiResult ? aiResult.feedbacks : [],
                        'Was it in client\'s favor?': aiResult ? aiResult.resolution_outcome : null
                    };
                    
                    results.push(result);
                } catch (e) {
                    console.error(`Error processing conversation ${conv.id}:`, e.message);
                }
            }
            
            return res.status(200).json({ success: true, data: results, total: conversations.length });
            
        } else {
            return res.status(400).json({ error: 'Invalid action. Use "fetch-single" or "fetch-range"' });
        }
        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    }
};
