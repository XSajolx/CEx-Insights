/**
 * Vercel Serverless API - Analyze Conversation Topics
 * 
 * Fetches conversations from Intercom, analyzes with OpenAI, stores in Supabase
 */

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// AI Categorization Prompt
const CATEGORIZATION_PROMPT = `# FundedNext AI Categorization — Compressed v4.5 (GPT-4.1 Mini Optimized)

**Input:** Intercom support chat transcript provided below.

## 🎯 Task
Read entire conversation (user + agent). Identify client's main frustration topics from actual discussion, not button clicks.

## 🧩 Output Format (JSON STRICT)
\`\`\`json
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
\`\`\`

**Rules:**
- Default: ONE main + ONE sub-category
- Multi-topic: 2-5 categories if equally dominant
- Exact spelling/casing from taxonomy
- If no match: "Undefined Topic"

**Sentiment values ONLY:**
- "Very Negative" | "Negative" | "Neutral" | "Positive" | "Very Positive"

**Resolution outcome:**
- "Yes" - Issue resolved in client's favor
- "No" - Issue NOT resolved in client's favor
- "Pending" - No resolution yet

## 🧠 Topic Taxonomy

### 🔐 KYC & Verification
Veriff Doesn't Accept KYC Documents | Waiting For KYC Verification | KYC Verification Delay Issue | KYC Done Yet to Receive FundedNext Account | Eligible for KYC But Pop-Up Missing | TRM Email Issue | AI Interview / HireFlix Issue | Live Interview – No One Joined | Underage | Swift KYC Not Eligible | KYC Eligibility Inquiry

### 📊 Dashboard & Account Access
Account Breach Issue | Dashboard update delay | Balance Mismatch | OTP Not Received | 2FA Issue | Unable to Create an Account | Did not receive Phase 2 Account | Fundednext Account Query

### 📐 Rules & Scaling
Challenge Rule Clarification | Scaling Rule Clarification | Scale-Up Eligibility Inquiry | Profit Target Reached but Minimum Trading Days Incomplete | Minimum Trading Days Confusion | Challenge Account Query

### 💻 Platform & Trading Performance
Trading Disabled | Platform Freeze | Market Data Delayed Issue | Slippage Issue | MT5 Platform Login Issues | Tradovate login Issue | TradingView login Issue | MT4 Login Issue

### 💳 Payment, Purchase & Refunds
Facing Payment Error | Payment Method Not Available | Account Not Provided Instantly (Crypto) | Crypto Payment Not Reflected | Wrong Network Payment | Double Charged | Refund Delay | Wrong Account Model Purchase

### 💰 Payout & Profit-Share
Payout On Hold | Payout Delay Issue | Not Eligible for Payout | Payout Discrepancy | Unable to See Payout Proof | Payout Related Query

### 🎁 Offers, Coupons & Giveaway
Coupon Code Not Working | Missing Free BOGO Account | Offer Related Query | Halloween Offer Query | Looking for coupon code

### 🏆 Certificates & Competition
Elite Trader Certificate | Competition Rule Clarification | Unable to register in the Monthly Competition

### ⚙️ Technical / Country / Compliance
Restricted Country Issue | Location Related Issue | Account Deactivation Due to Abusive Activities | Verdict from CPM | Verdict from Trading & Ethics

### 🧑💼 Support & Response
Delay in Receiving Customer Support

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
    
    if (conv.source?.body) {
        const body = htmlToText(conv.source.body);
        if (body) {
            messages.push({ role: 'USER', body, created_at: conv.created_at || 0 });
        }
    }
    
    const parts = conv.conversation_parts?.conversation_parts || [];
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
    const response = await fetch(`https://api.intercom.io${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${INTERCOM_TOKEN}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Intercom-Version': '2.10',
            ...options.headers
        }
    });
    return response.json();
}

async function analyzeWithAI(transcript) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'system', content: 'You are a support ticket categorization AI. Always respond with valid JSON only.' },
                { role: 'user', content: CATEGORIZATION_PROMPT + '\n\n' + transcript }
            ],
            temperature: 0,
            max_tokens: 1000
        })
    });
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/```$/, '');
    else if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```\s*/, '').replace(/```$/, '');
    
    try {
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

async function saveToSupabase(record) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/Intercom Topic`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(record)
    });
    return response.ok;
}

async function updateInSupabase(conversationId, data) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/Intercom Topic?Conversation ID=eq.${conversationId}`, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    return response.ok;
}

// Main handler
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { action, conversationId, dateFrom, dateTo, limit = 10 } = req.body;
    
    try {
        if (action === 'fetch-single') {
            // Fetch and analyze a single conversation by ID
            const conv = await fetchFromIntercom(`/conversations/${conversationId}?display_as=plaintext`);
            
            if (!conv || conv.type !== 'conversation') {
                return res.status(404).json({ error: 'Conversation not found' });
            }
            
            // Get contact details for country
            const contactId = conv.source?.author?.id || conv.contacts?.contacts?.[0]?.id;
            let contactDetails = null;
            if (contactId) {
                contactDetails = await fetchFromIntercom(`/contacts/${contactId}`);
            }
            
            // Extract transcript
            const transcript = extractTranscript(conv);
            
            // Analyze with AI
            const aiResult = await analyzeWithAI(transcript);
            
            const result = {
                'Conversation ID': String(conv.id),
                'created_at': conv.created_at,
                'Email': conv.source?.author?.email || null,
                'Transcript': transcript,
                'Country': contactDetails?.location?.country || null,
                'Region': contactDetails?.location?.region || null,
                'User ID': contactId || null,
                'Assigned Channel ID': conv.team_assignee_id ? String(conv.team_assignee_id) : null,
                'Main-Topics': aiResult?.main_category || [],
                'Sub-Topics': aiResult?.sub_category || [],
                'Sentiment Start': aiResult?.sentiment_start || null,
                'Sentiment End': aiResult?.sentiment_end || null,
                'Feedbacks': aiResult?.feedbacks || [],
                'Was it in client\'s favor?': aiResult?.resolution_outcome || null
            };
            
            return res.status(200).json({ success: true, data: result });
            
        } else if (action === 'fetch-range') {
            // Fetch conversations in date range
            const fromTs = Math.floor(new Date(dateFrom).getTime() / 1000);
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
                    pagination: { per_page: Math.min(limit, 150) }
                })
            });
            
            const conversations = searchResult.conversations || [];
            const results = [];
            
            for (const conv of conversations.slice(0, limit)) {
                // Fetch full details
                const details = await fetchFromIntercom(`/conversations/${conv.id}?display_as=plaintext`);
                if (!details) continue;
                
                // Get contact
                const contactId = details.source?.author?.id || details.contacts?.contacts?.[0]?.id;
                let contactDetails = null;
                if (contactId) {
                    contactDetails = await fetchFromIntercom(`/contacts/${contactId}`);
                }
                
                // Extract transcript
                const transcript = extractTranscript(details);
                
                // Analyze with AI
                const aiResult = await analyzeWithAI(transcript);
                
                const result = {
                    'Conversation ID': String(details.id),
                    'created_at': details.created_at,
                    'Email': details.source?.author?.email || null,
                    'Transcript': transcript.substring(0, 500) + (transcript.length > 500 ? '...' : ''),
                    'Country': contactDetails?.location?.country || null,
                    'Region': contactDetails?.location?.region || null,
                    'Main-Topics': aiResult?.main_category || [],
                    'Sub-Topics': aiResult?.sub_category || [],
                    'Sentiment Start': aiResult?.sentiment_start || null,
                    'Sentiment End': aiResult?.sentiment_end || null,
                    'Feedbacks': aiResult?.feedbacks || [],
                    'Was it in client\'s favor?': aiResult?.resolution_outcome || null
                };
                
                results.push(result);
            }
            
            return res.status(200).json({ success: true, data: results, total: conversations.length });
            
        } else if (action === 'save') {
            // Save analyzed data to Supabase
            const { data } = req.body;
            const saved = await saveToSupabase(data);
            return res.status(200).json({ success: saved });
            
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }
        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
