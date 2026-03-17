/**
 * Vercel Serverless API - Analyze Conversation Topics
 * Using https module instead of fetch for compatibility
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

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

// Binary download (e.g. for https://api.intercom.io/download/reporting_data/{jobId})
function httpsRequestBinary(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };
        const chunks = [];
        const req = https.request(reqOptions, (res) => {
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    buffer
                });
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
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

// Match n8n export: strip script/style, preserve line breaks, replace image-only with [IMAGE]
function htmlToText(html) {
    if (html == null) return '';
    const hasImg = /<img\b/i.test(html);
    let text = typeof html !== 'string' ? String(html) : html;

    text = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '');

    text = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n');

    text = text.replace(/<[^>]*>/g, '');

    text = text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');

    text = text.replace(/[ \t]+\n/g, '\n').trim();

    if (!text && hasImg) return '[IMAGE]';
    return text;
}

// Build transcript like n8n: only comment parts, USER/AGENT, sorted by created_at
function extractTranscript(conv) {
    if (!conv || typeof conv !== 'object') return '';
    const messages = [];

    try {
        // Initial message from source
        if (conv.source && conv.source.body) {
            const body = htmlToText(conv.source.body);
            if (body) {
                messages.push({
                    role: 'USER',
                    body,
                    created_at: typeof conv.created_at === 'number' ? conv.created_at : 0
                });
            }
        }

        const parts = conv.conversation_parts?.conversation_parts || [];
        if (!Array.isArray(parts)) {
            return messages.map(m => `${m.role}: ${m.body}`).join('\n');
        }

        for (const part of parts) {
            if (part.part_type !== 'comment' || !part.body) continue;

            const author = part.author || {};
            let role = 'UNKNOWN';
            if (author.type === 'user' || author.type === 'lead' || author.type === 'contact') role = 'USER';
            else if (author.type === 'admin' || author.type === 'bot' || author.type === 'team') role = 'AGENT';

            if (role === 'UNKNOWN') continue;

            const text = htmlToText(part.body);
            if (!text) continue;

            messages.push({
                role,
                body: text,
                created_at: typeof part.created_at === 'number' ? part.created_at : 0
            });
        }

        // Sort by timestamp (like n8n) then format as "ROLE: body"
        messages.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
        return messages.map(m => `${m.role}: ${m.body}`).join('\n');
    } catch (e) {
        return messages.map(m => `${m.role}: ${m.body}`).join('\n');
    }
}

// Structured transcript for drill-in UI: JSON array of { role, author, body, time }
function extractStructuredTranscript(conv) {
    if (!conv || typeof conv !== 'object') return '[]';
    const messages = [];
    try {
        if (conv.source && conv.source.body) {
            const body = htmlToText(conv.source.body);
            if (body) {
                const authorName = conv.source?.author?.name || conv.source?.author?.email || 'Customer';
                messages.push({
                    role: 'USER',
                    author: authorName,
                    body,
                    time: typeof conv.created_at === 'number' ? conv.created_at : 0
                });
            }
        }
        const parts = conv.conversation_parts?.conversation_parts || [];
        if (!Array.isArray(parts)) return JSON.stringify(messages);
        for (const part of parts) {
            if (part.part_type !== 'comment' || !part.body) continue;
            const author = part.author || {};
            let role = 'UNKNOWN';
            if (author.type === 'user' || author.type === 'lead' || author.type === 'contact') role = 'USER';
            else if (author.type === 'admin' || author.type === 'bot' || author.type === 'team') role = 'AGENT';
            if (role === 'UNKNOWN') continue;
            const text = htmlToText(part.body);
            if (!text) continue;
            const isBot = author.type === 'bot' || (author.name || '').toLowerCase() === 'fin' || (author.name || '').toLowerCase().includes('operator');
            messages.push({
                role,
                author: author.name || author.email || (role === 'USER' ? 'Customer' : 'Agent'),
                body: text,
                time: typeof part.created_at === 'number' ? part.created_at : 0,
                ...(isBot ? { bot: true } : {})
            });
        }
        messages.sort((a, b) => (a.time || 0) - (b.time || 0));
        return JSON.stringify(messages);
    } catch (e) {
        return JSON.stringify(messages);
    }
}

async function fetchIntercom(endpoint, options = {}) {
    const url = `https://api.intercom.io${endpoint}`;
    return httpsRequest(url, {
        method: options.method || 'GET',
        headers: {
            'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Intercom-Version': '2.14'
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

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    const { action, conversationId, dateFrom, dateTo, timeFrom, timeTo, timezoneOffset, startingAfter } = body || {};
    
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
        
        // Action: CSAT sub-category classification (replicates n8n cSAT Automation workflow)
        if (action === 'csat-classify') {
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId required' });
            }
            if (!process.env.OPENAI_API_KEY) {
                return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
            }

            // 1. Fetch conversation from Intercom
            const convResp = await fetchIntercom(`/conversations/${conversationId}?display_as=plaintext`);
            if (!convResp.ok) {
                return res.status(200).json({ success: false, error: 'Conversation not found', conversationId });
            }

            const conv = convResp.data;

            // 2. Build transcript (reuse existing function)
            const transcript = extractTranscript(conv);
            if (!transcript || transcript === '[EMPTY]') {
                return res.status(200).json({ success: false, error: 'Empty transcript', conversationId });
            }

            // 3. Extract conversation rating + remark
            const ratingObj = conv.conversation_rating || null;
            const rating = ratingObj?.rating ?? null;
            const remark = ratingObj?.remark ?? null;

            // 4. Append rating to transcript (like n8n workflow)
            let fullTranscript = transcript;
            if (remark || rating !== null) {
                fullTranscript += '\n---';
                if (rating !== null) fullTranscript += `\nConversation Rating: ${rating}`;
                if (remark) fullTranscript += `\nRemark: ${remark}`;
            }

            // 5. Load the CSAT prompt template
            let csatPromptTemplate;
            try {
                csatPromptTemplate = fs.readFileSync(path.join(__dirname, 'csat-prompt.txt'), 'utf8');
            } catch (e) {
                return res.status(500).json({ error: 'CSAT prompt template not found' });
            }

            // 6. Replace placeholders with actual data
            let systemPrompt = csatPromptTemplate
                .replace('{{ $json.ExtractedTranscript }}', fullTranscript)
                .replace('{{ $json.ConversationRatingRemark }}', remark || '');

            // 7. Call OpenAI (o4-mini like n8n, fallback to gpt-4.1-mini)
            const aiResponse = await httpsRequest('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4.1-mini',
                    messages: [
                        { role: 'system', content: systemPrompt }
                    ],
                    temperature: 0,
                    max_tokens: 200
                })
            });

            if (!aiResponse.ok) {
                return res.status(200).json({ success: false, error: 'AI call failed', conversationId });
            }

            const subCategory = (aiResponse.data.choices?.[0]?.message?.content || '').trim();

            return res.status(200).json({
                success: true,
                conversationId,
                subCategory: subCategory === 'None' ? null : subCategory
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
        
        // Filter timezone: 0 = GMT+0 (UTC), 6 = GMT+6 (Bangladesh). Your From/To = this timezone.
        const TZ_OFFSET_HOURS = typeof timezoneOffset === 'number' ? timezoneOffset : 0;
        function parseTime(str, defaultHour, defaultMin, defaultSec) {
            if (!str || typeof str !== 'string') return { hour: defaultHour, min: defaultMin, sec: defaultSec };
            const parts = str.trim().split(':').map(Number);
            return {
                hour: Number.isNaN(parts[0]) ? defaultHour : parts[0],
                min: Number.isNaN(parts[1]) ? defaultMin : parts[1],
                sec: Number.isNaN(parts[2]) ? defaultSec : (parts[2] ?? defaultSec)
            };
        }
        // (date + time in selected TZ, currently GMT+0) -> Unix seconds
        function filterDateTimeToUnix(y, m, d, hour, min, sec) {
            const ms = Date.UTC(y, m - 1, d, hour - TZ_OFFSET_HOURS, min, sec);
            return Math.floor(ms / 1000);
        }

        // Action: Fetch conversation IDs only (fast) - for pagination
        // Query uses precise UNIX range: From/To = your date+time in GMT+0 (UTC).
        if (action === 'fetch-ids') {
            if (!dateFrom || !dateTo) {
                return res.status(400).json({ error: 'dateFrom and dateTo required' });
            }
            
            const [fromYear, fromMonth, fromDay] = dateFrom.split('-').map(Number);
            const [toYear, toMonth, toDay] = dateTo.split('-').map(Number);
            const tFrom = parseTime(timeFrom, 0, 0, 0);
            const tTo = parseTime(timeTo, 23, 59, 59);
            const fromTs = filterDateTimeToUnix(fromYear, fromMonth, fromDay, tFrom.hour, tFrom.min, tFrom.sec);
            const toTs = filterDateTimeToUnix(toYear, toMonth, toDay, tTo.hour, tTo.min, tTo.sec);
            const fromDate = new Date(fromTs * 1000);
            const toDate = new Date(toTs * 1000);
            const tzLabel = TZ_OFFSET_HOURS === 6 ? 'GMT+6' : 'GMT+0';
            const fromLabel = `${dateFrom} ${timeFrom || '00:00'} ${tzLabel}`;
            const toLabel = `${dateTo} ${timeTo || '23:59'} ${tzLabel}`;
            console.log('fetch-ids (filter window):', { start: fromLabel, end: toLabel, fromTs, toTs });
            
            // Search by created_at (= Conversation started at)
            // For Feb 8 BD (GMT+6): Start = 2026-02-08 00:00:00 BD = 2026-02-07 18:00:00 UTC (1738958400)
            // End = 2026-02-08 23:59:59 BD = 2026-02-08 17:59:59 UTC (1739044799)
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
            
            console.log('Intercom search body:', JSON.stringify(searchBody));
            
            const searchResp = await fetchIntercom('/conversations/search', {
                method: 'POST',
                body: JSON.stringify(searchBody)
            });
            
            console.log('Intercom search response:', { 
                ok: searchResp.ok, 
                status: searchResp.status,
                totalCount: searchResp.data?.total_count,
                conversationsCount: searchResp.data?.conversations?.length
            });
            
            if (!searchResp.ok) {
                console.error('Intercom search failed:', searchResp.status, JSON.stringify(searchResp.data));
                return res.status(200).json({ 
                    success: false,
                    error: 'Failed to search conversations',
                    details: searchResp.data,
                    debug: { fromTs, toTs, fromDateISO: fromDate.toISOString(), toDateISO: toDate.toISOString() }
                });
            }
            
            let conversations = searchResp.data.conversations || [];
            const totalCountRaw = searchResp.data.total_count || 0;
            const pages = searchResp.data.pages;
            const nextStartingAfter = pages?.next?.starting_after || null;
            
            // Normalize created_at to seconds (API may return seconds or ms); filter to exact Dhaka day.
            function toSeconds(ts) {
                if (ts == null || typeof ts !== 'number') return null;
                return ts > 1e12 ? Math.floor(ts / 1000) : ts;
            }
            conversations = conversations.filter(c => {
                const createdSec = toSeconds(c.created_at);
                return createdSec != null && createdSec >= fromTs && createdSec <= toTs;
            });
            
            // Return minimal records for Phase 1: Conversation ID + created_at + created_at_bd (150 per page)
            const data = conversations.map(c => {
                const createdSec = toSeconds(c.created_at);
                return {
                    'Conversation ID': String(c.id),
                    'created_at': createdSec != null ? String(createdSec) : null,
                    'created_at_bd': createdSec != null ? new Date(createdSec * 1000).toISOString() : null
                };
            });
            
            return res.status(200).json({
                success: true,
                data,
                totalCount: totalCountRaw,
                filteredCount: data.length,
                nextStartingAfter,
                hasMore: !!nextStartingAfter,
                debug: {
                    inputDateFrom: dateFrom,
                    inputDateTo: dateTo,
                    queryFromTs: fromTs,
                    queryToTs: toTs,
                    queryFromDate: fromDate.toISOString(),
                    queryToDate: toDate.toISOString(),
                    timezone: TZ_OFFSET_HOURS === 6 ? 'GMT+6 (Bangladesh)' : 'GMT+0 (UTC)',
                    filterBy: 'Conversation started at (created_at)',
                    timeFrom: timeFrom || '00:00',
                    timeTo: timeTo || '23:59',
                    intercomResponseCount: searchResp.data.conversations?.length ?? 0,
                    afterBDFilter: data.length
                }
            });
        }
        
        // Action: Test Intercom connection - list recent conversations without date filter
        if (action === 'test-intercom') {
            try {
                // Simple test: list conversations without any filters
                const listResp = await fetchIntercom('/conversations?per_page=5');
                console.log('Test Intercom response:', { ok: listResp.ok, status: listResp.status });
                
                if (!listResp.ok) {
                    return res.status(200).json({
                        success: false,
                        error: `Intercom API error: ${listResp.status}`,
                        details: listResp.data
                    });
                }
                
                const conversations = listResp.data.conversations || [];
                return res.status(200).json({
                    success: true,
                    message: `Token is working! Found ${conversations.length} recent conversations.`,
                    totalCount: listResp.data.total_count || 0,
                    sampleIds: conversations.slice(0, 3).map(c => ({ 
                        id: c.id, 
                        created_at: c.created_at,
                        created_date: new Date(c.created_at * 1000).toISOString()
                    }))
                });
            } catch (e) {
                return res.status(200).json({
                    success: false,
                    error: 'Test failed: ' + (e.message || String(e))
                });
            }
        }

        // Action: List available datasets from Reporting Data Export API
        if (action === 'list-datasets') {
            try {
                const resp = await fetchIntercom('/export/reporting_data/get_datasets');
                if (!resp.ok) {
                    return res.status(200).json({
                        success: false,
                        error: `Intercom returned ${resp.status}: ${JSON.stringify(resp.data)}`
                    });
                }
                return res.status(200).json({
                    success: true,
                    datasets: resp.data
                });
            } catch (e) {
                return res.status(200).json({
                    success: false,
                    error: 'Failed to fetch datasets: ' + (e.message || String(e))
                });
            }
        }

        // Action: Enqueue a reporting data export job
        if (action === 'enqueue-export') {
            const { dataset, attributes, dateFrom, dateTo } = req.body;
            if (!dataset) {
                return res.status(400).json({ error: 'dataset required (e.g., "conversations")' });
            }
            
            const exportBody = {
                dataset,
                attributes: attributes || undefined,
                filters: {}
            };
            
            // Add date range if provided (interpret as BD: start of from-date, end of to-date)
            if (dateFrom && typeof dateFrom === 'string') {
                const parts = dateFrom.split('T')[0].split('-').map(Number);
                if (parts.length >= 3) {
                    const fromTs = filterDateTimeToUnix(parts[0], parts[1], parts[2], 0, 0, 0);
                    exportBody.filters.created_at = exportBody.filters.created_at || {};
                    exportBody.filters.created_at.gte = fromTs;
                }
            }
            if (dateTo && typeof dateTo === 'string') {
                const parts = dateTo.split('T')[0].split('-').map(Number);
                if (parts.length >= 3) {
                    const toTs = filterDateTimeToUnix(parts[0], parts[1], parts[2], 23, 59, 59);
                    exportBody.filters.created_at = exportBody.filters.created_at || {};
                    exportBody.filters.created_at.lte = toTs;
                }
            }
            
            try {
                const resp = await fetchIntercom('/export/reporting_data/enqueue', {
                    method: 'POST',
                    body: JSON.stringify(exportBody)
                });
                if (!resp.ok) {
                    return res.status(200).json({
                        success: false,
                        error: `Intercom returned ${resp.status}: ${JSON.stringify(resp.data)}`
                    });
                }
                return res.status(200).json({
                    success: true,
                    job: resp.data
                });
            } catch (e) {
                return res.status(200).json({
                    success: false,
                    error: 'Failed to enqueue export: ' + (e.message || String(e))
                });
            }
        }

        // Action: Check export job status
        if (action === 'export-status') {
            const { jobId } = req.body;
            if (!jobId) {
                return res.status(400).json({ error: 'jobId required' });
            }
            try {
                const resp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!resp.ok) {
                    return res.status(200).json({
                        success: false,
                        error: `Intercom returned ${resp.status}: ${JSON.stringify(resp.data)}`
                    });
                }
                return res.status(200).json({
                    success: true,
                    job: resp.data
                });
            } catch (e) {
                return res.status(200).json({
                    success: false,
                    error: 'Failed to check status: ' + (e.message || String(e))
                });
            }
        }

        // Action: Download completed export
        if (action === 'download-export') {
            const { jobId } = req.body;
            if (!jobId) {
                return res.status(400).json({ error: 'jobId required' });
            }
            try {
                const resp = await fetchIntercom(`/download/reporting_data/${jobId}`);
                if (!resp.ok) {
                    return res.status(200).json({
                        success: false,
                        error: `Intercom returned ${resp.status}: ${JSON.stringify(resp.data)}`
                    });
                }
                return res.status(200).json({
                    success: true,
                    data: resp.data
                });
            } catch (e) {
                return res.status(200).json({
                    success: false,
                    error: 'Failed to download export: ' + (e.message || String(e))
                });
            }
        }

        // --- Conversation Actions: 3-step flow so frontend can show progress ---

        // Step 1: Discover dataset + enqueue export
        if (action === 'ca-enqueue') {
            const dateFrom = (body && body.dateFrom) || '2026-02-01';
            const dateTo = (body && body.dateTo) || '2026-02-17';
            try {
                const dsResp = await fetchIntercom('/export/reporting_data/get_datasets');
                if (!dsResp.ok) {
                    return res.status(200).json({ success: false, error: `get_datasets failed: ${dsResp.status} ${JSON.stringify(dsResp.data)}` });
                }
                const rawDatasets = dsResp.data?.data ?? dsResp.data ?? [];
                const datasets = Array.isArray(rawDatasets) ? rawDatasets : [rawDatasets];
                const conversationActionsDs = datasets.find(
                    d => (d.id && String(d.id).toLowerCase().includes('conversation_action')) ||
                         (d.name && String(d.name).toLowerCase().includes('conversation action'))
                ) || datasets.find(d => d.id === 'conversation_actions');
                const datasetId = conversationActionsDs?.id || 'conversation_actions';
                let attributeIds = [];
                if (conversationActionsDs?.attributes && Array.isArray(conversationActionsDs.attributes)) {
                    attributeIds = conversationActionsDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a));
                }
                if (attributeIds.length === 0) {
                    attributeIds = [
                        'conversation_id', 'action_id', 'conversation_started_at', 'action_time',
                        'channel', 'last_teammate_rating', 'conversation_tags', 'started_by',
                        'state', 'action_type', 'action_performed_by', 'action_performed_by_id',
                        'teammate_assigned', 'teammate_assigned_id', 'teammate_subsequent_response_time_seconds'
                    ];
                }
                const DHAKA_OFFSET = 6 * 3600;
                const partsFrom = dateFrom.split('T')[0].split('-').map(Number);
                const partsTo = dateTo.split('T')[0].split('-').map(Number);
                const fromTs = partsFrom.length >= 3 ? Math.floor(Date.UTC(partsFrom[0], partsFrom[1] - 1, partsFrom[2]) / 1000) - DHAKA_OFFSET : 1738368000;
                const toTs = partsTo.length >= 3 ? Math.floor(Date.UTC(partsTo[0], partsTo[1] - 1, partsTo[2], 23, 59, 59) / 1000) - DHAKA_OFFSET : 1739750399;
                const enqResp = await fetchIntercom('/export/reporting_data/enqueue', {
                    method: 'POST',
                    body: JSON.stringify({ start_time: fromTs, end_time: toTs, dataset_id: datasetId, attribute_ids: attributeIds })
                });
                if (!enqResp.ok) {
                    return res.status(200).json({ success: false, error: `enqueue failed: ${enqResp.status} ${JSON.stringify(enqResp.data)}` });
                }
                const jobId = enqResp.data?.job_identifier ?? enqResp.data?.job_id ?? enqResp.data?.id;
                if (!jobId) {
                    return res.status(200).json({ success: false, error: 'Enqueue response missing job_identifier', raw: enqResp.data });
                }
                return res.status(200).json({ success: true, jobId, status: enqResp.data?.status || 'pending', datasetId, attributeCount: attributeIds.length });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'ca-enqueue failed: ' + (e.message || String(e)) });
            }
        }

        // Step 2: Poll job status (frontend calls repeatedly)
        if (action === 'ca-poll') {
            const { jobId } = body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            try {
                const statusResp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!statusResp.ok) {
                    return res.status(200).json({ success: false, error: `poll failed: ${statusResp.status}` });
                }
                return res.status(200).json({ success: true, status: statusResp.data?.status || 'unknown', job: statusResp.data });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'ca-poll failed: ' + (e.message || String(e)) });
            }
        }

        // Step 3: Download, parse, filter agent-only, insert into Supabase
        if (action === 'ca-download-import') {
            const { jobId } = body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_*) must be set in the API environment.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, {
                auth: { autoRefreshToken: false, persistSession: false }
            });
            // Flexible header mapper: CSV header → Supabase "Conversation Actions" column
            // Handles: human-readable (with/without timezone suffix), snake_case API variants
            function mapHeader(h) {
                const raw = h.trim();
                // Strip timezone suffix like " (Asia/Dhaka)" or " (UTC)" for matching
                const stripped = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
                const lower = stripped.toLowerCase();
                // Only columns that exist in the "Conversation Actions" table:
                // conversation_id, action_id, conversation_started_at, action_time,
                // channel, last_teammate_rating, conversation_tags, started_by, state,
                // action_type, action_performed_by, action_performed_by_id,
                // teammate_assigned, teammate_assigned_id,
                // teammate_subsequent_response_time_seconds
                const MAP = {
                    'conversation id': 'conversation_id',
                    'conversation started at': 'conversation_started_at',
                    'channel': 'channel',
                    'last teammate rating': 'last_teammate_rating',
                    'conversation tag': 'conversation_tags',
                    'conversation tags': 'conversation_tags',
                    'started by': 'started_by',
                    'action time': 'action_time',
                    'action performed by': 'action_performed_by',
                    'teammate assigned': 'teammate_assigned',
                    'teammate assigned when action performed': 'teammate_assigned_id',
                    'action id': 'action_id',
                    'action type': 'action_type',
                    'action performed by automation': 'action_performed_by_id',
                    'teammate subsequent response time (seconds)': 'teammate_subsequent_response_time_seconds',
                    'teammate subsequent response time seconds': 'teammate_subsequent_response_time_seconds',
                    'state': 'state',
                };
                // Try stripped lowercase first
                if (MAP[lower]) return MAP[lower];
                // Try raw lowercase (with timezone suffix removed)
                const rawLower = raw.toLowerCase();
                if (MAP[rawLower]) return MAP[rawLower];
                // Also handle commas in header like "Teammate subsequent response time, within office hours (seconds)"
                // These don't map to any existing column, so fall through to snake_case check

                // Snake_case API export headers (actual Intercom Reporting Data Export attribute IDs)
                const SNAKE = {
                    'conversation_id': 'conversation_id',
                    'action_id': 'action_id',
                    'conversation_started_at': 'conversation_started_at',
                    'action_time': 'action_time',
                    'channel': 'channel',
                    'last_teammate_rating': 'last_teammate_rating',
                    'state': 'state',
                    'action_type': 'action_type',
                    // Actual API header names (differ from human-readable UI export)
                    'action_performed_by_teammate_id': 'action_performed_by',
                    'action_teammate_assignee_id': 'teammate_assigned',
                    'teammate_assignee_at_action_time': 'teammate_assigned_id',
                    'teammate_subsequent_response_time': 'teammate_subsequent_response_time_seconds',
                    'action_by_automation': 'action_performed_by_id',
                    'conversation_started_by': 'started_by',
                    'conversation_tag_ids': 'conversation_tags',
                    // Fallbacks in case Intercom ever uses these simpler names
                    'action_performed_by': 'action_performed_by',
                    'action_performed_by_id': 'action_performed_by_id',
                    'teammate_assigned': 'teammate_assigned',
                    'teammate_assigned_id': 'teammate_assigned_id',
                    'started_by': 'started_by',
                    'conversation_tags': 'conversation_tags',
                    'conversation_tag': 'conversation_tags',
                    'teammate_subsequent_response_time_seconds': 'teammate_subsequent_response_time_seconds',
                };
                if (SNAKE[raw]) return SNAKE[raw];
                if (SNAKE[lower]) return SNAKE[lower];
                return null; // unmapped column – skip
            }
            const DHAKA_OFFSET_MS_CA = 6 * 3600 * 1000;
            const toGMT6_CA = (dateVal) => {
                const d = new Date(dateVal);
                if (isNaN(d.getTime())) return null;
                return new Date(d.getTime() + DHAKA_OFFSET_MS_CA).toISOString().replace('Z', '+06:00');
            };
            const AI_NAMES_TO_EXCLUDE = ['fundednext ai', 'fin ai', 'fin'];
            const TIMESTAMP_COLS = new Set(['conversation_started_at', 'action_time']);
            const INTEGER_COLS = new Set(['teammate_subsequent_response_time_seconds']);
            const AUTOMATION_DB_COL = 'action_performed_by_id';
            // Full CSV parser that handles multiline quoted fields and escaped quotes
            function parseFullCSV(csvText) {
                const rows = [];
                let row = [];
                let field = '';
                let inQuotes = false;
                for (let i = 0; i < csvText.length; i++) {
                    const c = csvText[i];
                    if (c === '"') {
                        if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') {
                            field += '"'; i++;
                        } else {
                            inQuotes = !inQuotes;
                        }
                    } else if (c === ',' && !inQuotes) {
                        row.push(field.trim()); field = '';
                    } else if (c === '\n' && !inQuotes) {
                        row.push(field.trim());
                        if (row.some(f => f !== '')) rows.push(row);
                        row = []; field = '';
                    } else if (c === '\r' && !inQuotes) {
                        // skip carriage return
                    } else {
                        field += c;
                    }
                }
                row.push(field.trim());
                if (row.some(f => f !== '')) rows.push(row);
                return rows;
            }
            try {
                const downloadUrl = `https://api.intercom.io/download/reporting_data/${jobId}`;
                const dlResp = await httpsRequestBinary(downloadUrl, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, 'Accept': 'application/octet-stream', 'Intercom-Version': '2.14' }
                });
                if (!dlResp.ok) {
                    return res.status(200).json({ success: false, error: `Download failed: ${dlResp.status}`, jobId });
                }
                let csvBuffer = dlResp.buffer;
                if (csvBuffer[0] === 0x1f && csvBuffer[1] === 0x8b) csvBuffer = zlib.gunzipSync(csvBuffer);
                const csvText = csvBuffer.toString('utf8');
                const allRows = parseFullCSV(csvText);
                if (allRows.length < 2) {
                    return res.status(200).json({ success: true, imported: 0, totalCsvRows: 0, message: 'Export contained no data rows.' });
                }
                const headers = allRows[0];
                const colMap = headers.map(h => mapHeader(h));
                const actionPerformedByIdx = colMap.indexOf('action_performed_by');
                const automationIdx = colMap.indexOf(AUTOMATION_DB_COL);
                const mappedCount = colMap.filter(Boolean).length;
                const rows = [];
                for (let i = 1; i < allRows.length; i++) {
                    const csvRow = allRows[i];
                    // Filter out AI/automation: check "action_by_automation" flag first, then name
                    if (automationIdx >= 0) {
                        const autoVal = (csvRow[automationIdx] || '').trim().toLowerCase();
                        if (autoVal === 'true') continue;
                    }
                    if (actionPerformedByIdx >= 0) {
                        const performer = (csvRow[actionPerformedByIdx] || '').trim().toLowerCase();
                        if (AI_NAMES_TO_EXCLUDE.some(name => performer.includes(name))) continue;
                        if (!performer && automationIdx < 0) continue;
                    }
                    const record = {};
                    for (let c = 0; c < headers.length; c++) {
                        const dbCol = colMap[c];
                        if (!dbCol) continue;
                        let val = csvRow[c] ?? '';
                        if (val === '') val = null;
                        if (val && TIMESTAMP_COLS.has(dbCol)) {
                            val = toGMT6_CA(val);
                        }
                        if (val && INTEGER_COLS.has(dbCol)) {
                            const n = parseInt(val, 10);
                            val = isNaN(n) ? null : n;
                        }
                        record[dbCol] = val;
                    }
                    if (Object.keys(record).length > 0) {
                        record.synced_at = new Date(Date.now() + DHAKA_OFFSET_MS_CA).toISOString().replace('Z', '+06:00');
                        rows.push(record);
                    }
                }
                const BATCH = 1000;
                let imported = 0;
                for (let start = 0; start < rows.length; start += BATCH) {
                    const chunk = rows.slice(start, start + BATCH);
                    const { error: insertErr } = await supabase.from('Conversation Actions').insert(chunk);
                    if (insertErr) {
                        return res.status(200).json({ success: false, error: 'Supabase insert failed: ' + insertErr.message, imported, detail: insertErr });
                    }
                    imported += chunk.length;
                }
                return res.status(200).json({ success: true, imported, totalCsvRows: allRows.length - 1, filteredRows: rows.length, jobId, csvHeaders: headers, mappedColumns: mappedCount });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'ca-download-import failed: ' + (e.message || String(e)) });
            }
        }

        // --- Conversation Dataset: 3-step flow for "Service Performance Overview" table ---

        // Step 1: Discover "Conversation dataset" + enqueue export
        if (action === 'cd-enqueue') {
            const dateFrom = (body && body.dateFrom) || '2026-02-01';
            const dateTo = (body && body.dateTo) || '2026-02-17';
            try {
                const dsResp = await fetchIntercom('/export/reporting_data/get_datasets');
                if (!dsResp.ok) {
                    return res.status(200).json({ success: false, error: `get_datasets failed: ${dsResp.status} ${JSON.stringify(dsResp.data)}` });
                }
                const rawDatasets = dsResp.data?.data ?? dsResp.data ?? [];
                const datasets = Array.isArray(rawDatasets) ? rawDatasets : [rawDatasets];
                const convDs = datasets.find(
                    d => (d.id && String(d.id).toLowerCase() === 'conversations') ||
                         (d.name && String(d.name).toLowerCase().includes('conversation dataset'))
                ) || datasets.find(
                    d => d.id && String(d.id).toLowerCase().includes('conversation') &&
                         !String(d.id).toLowerCase().includes('action')
                );
                const datasetId = convDs?.id || 'conversations';
                let attributeIds = [];
                if (convDs?.attributes && Array.isArray(convDs.attributes)) {
                    attributeIds = convDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a));
                }
                const DHAKA_OFFSET = 6 * 3600;
                const partsFrom = dateFrom.split('T')[0].split('-').map(Number);
                const partsTo = dateTo.split('T')[0].split('-').map(Number);
                const fromTs = partsFrom.length >= 3 ? Math.floor(Date.UTC(partsFrom[0], partsFrom[1] - 1, partsFrom[2]) / 1000) - DHAKA_OFFSET : 1738368000;
                const toTs = partsTo.length >= 3 ? Math.floor(Date.UTC(partsTo[0], partsTo[1] - 1, partsTo[2], 23, 59, 59) / 1000) - DHAKA_OFFSET : 1739750399;
                const enqBody = { start_time: fromTs, end_time: toTs, dataset_id: datasetId };
                if (attributeIds.length > 0) enqBody.attribute_ids = attributeIds;
                const enqResp = await fetchIntercom('/export/reporting_data/enqueue', {
                    method: 'POST',
                    body: JSON.stringify(enqBody)
                });
                if (!enqResp.ok) {
                    return res.status(200).json({ success: false, error: `enqueue failed: ${enqResp.status} ${JSON.stringify(enqResp.data)}` });
                }
                const jobId = enqResp.data?.job_identifier ?? enqResp.data?.job_id ?? enqResp.data?.id;
                if (!jobId) {
                    return res.status(200).json({ success: false, error: 'Enqueue response missing job_identifier', raw: enqResp.data });
                }
                return res.status(200).json({ success: true, jobId, status: enqResp.data?.status || 'pending', datasetId, attributeCount: attributeIds.length });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'cd-enqueue failed: ' + (e.message || String(e)) });
            }
        }

        // Step 3: Download Conversation dataset CSV, map to "Service Performance Overview", insert
        if (action === 'cd-download-import') {
            const { jobId } = body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, {
                auth: { autoRefreshToken: false, persistSession: false }
            });

            function mapCDHeader(h) {
                const raw = h.trim();
                const stripped = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
                const lower = stripped.toLowerCase();
                const MAP = {
                    'conversation id': 'conversation_id',
                    'conversation started at': 'created_at',
                    'conversation first closed at': 'updated_at',
                    'conversation last closed at': 'updated_at',
                    'conversation first replied at': 'frt_seconds',
                    'channel': 'channel',
                    'country': 'country',
                    'current conversation state': 'state',
                    'state': 'state',
                    'last teammate rating': 'csat_rating',
                    'conversation tag': 'tags',
                    'topics': 'tags',
                    'teammate currently assigned': 'assignee_id',
                    'team currently assigned': 'team_id',
                    'first response time': 'frt_seconds',
                    'handling time': 'aht_seconds',
                    'time to close': 'wait_time_seconds',
                    'time to first close': 'aht_seconds',
                    'user id': 'contact_id',
                    'user name': 'assignee_name',
                    'number of reassignments': 'reopened_count',
                    'fin ai agent involved': 'FIN AI Agent involved',
                    'fin ai agent deflected': 'FIN AI Agent deflected',
                };
                if (MAP[lower]) return MAP[lower];
                const rawLower = raw.toLowerCase();
                if (MAP[rawLower]) return MAP[rawLower];
                const SNAKE = {
                    'conversation_id': 'conversation_id',
                    'conversation_started_at': 'created_at',
                    'conversation_first_closed_at': 'updated_at',
                    'conversation_last_closed_at': 'updated_at',
                    'conversation_first_teammate_reply_at': 'frt_seconds',
                    'channel': 'channel',
                    'user_location_country_code': 'country',
                    'current_conversation_state': 'state',
                    'currently_assigned_teammate_id': 'assignee_id',
                    'currently_assigned_team_id': 'team_id',
                    'last_teammate_rating': 'csat_rating',
                    'conversation_tag_ids': 'tags',
                    'topics': 'tags',
                    'user_id': 'contact_id',
                    'user_name': 'assignee_name',
                    'conversation_first_response_time': 'frt_seconds',
                    'first_response_time_excluding_bot_inbox': 'frt_seconds',
                    'conversation_handling_time': 'aht_seconds',
                    'conversation_time_to_close': 'wait_time_seconds',
                    'time_to_first_close': 'aht_seconds',
                    'time_to_close_excluding_bot_inbox': 'wait_time_seconds',
                    'reassignments_count': 'reopened_count',
                    'teammate_replies_count': 'reopened_count',
                    'is_resolved_on_first_contact': 'is_reopened',
                    'fin_ai_agent_involved': 'FIN AI Agent involved',
                    'fin_ai_agent_deflected': 'FIN AI Agent deflected',
                };
                if (SNAKE[raw]) return SNAKE[raw];
                if (SNAKE[lower]) return SNAKE[lower];
                return null;
            }
            const DHAKA_OFFSET_MS = 6 * 3600 * 1000;
            const toGMT6 = (dateVal) => {
                const d = new Date(dateVal);
                if (isNaN(d.getTime())) return null;
                const shifted = new Date(d.getTime() + DHAKA_OFFSET_MS);
                return shifted.toISOString().replace('Z', '+06:00');
            };
            const nowGMT6 = () => {
                const d = new Date(Date.now() + DHAKA_OFFSET_MS);
                return d.toISOString().replace('Z', '+06:00');
            };
            const TIMESTAMP_COLS = new Set(['created_at', 'updated_at']);
            const INTEGER_COLS = new Set(['csat_rating', 'frt_seconds', 'art_seconds', 'aht_seconds', 'wait_time_seconds', 'response_count', 'reopened_count']);
            const BOOLEAN_COLS = new Set(['is_reopened']);

            function parseFullCSV(csvText) {
                const rows = [];
                let row = [];
                let field = '';
                let inQuotes = false;
                for (let i = 0; i < csvText.length; i++) {
                    const c = csvText[i];
                    if (c === '"') {
                        if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') {
                            field += '"'; i++;
                        } else {
                            inQuotes = !inQuotes;
                        }
                    } else if (c === ',' && !inQuotes) {
                        row.push(field.trim()); field = '';
                    } else if (c === '\n' && !inQuotes) {
                        row.push(field.trim());
                        if (row.some(f => f !== '')) rows.push(row);
                        row = []; field = '';
                    } else if (c === '\r' && !inQuotes) {
                        // skip
                    } else {
                        field += c;
                    }
                }
                row.push(field.trim());
                if (row.some(f => f !== '')) rows.push(row);
                return rows;
            }

            try {
                const downloadUrl = `https://api.intercom.io/download/reporting_data/${jobId}`;
                const dlResp = await httpsRequestBinary(downloadUrl, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, 'Accept': 'application/octet-stream', 'Intercom-Version': '2.14' }
                });
                if (!dlResp.ok) {
                    return res.status(200).json({ success: false, error: `Download failed: ${dlResp.status}`, jobId });
                }
                let csvBuffer = dlResp.buffer;
                if (csvBuffer[0] === 0x1f && csvBuffer[1] === 0x8b) csvBuffer = zlib.gunzipSync(csvBuffer);
                const csvText = csvBuffer.toString('utf8');
                const allRows = parseFullCSV(csvText);
                if (allRows.length < 2) {
                    return res.status(200).json({ success: true, imported: 0, totalCsvRows: 0, message: 'Export contained no data rows.' });
                }
                const headers = allRows[0];
                const colMap = headers.map(h => mapCDHeader(h));
                const mappedCount = colMap.filter(Boolean).length;
                const rows = [];
                for (let i = 1; i < allRows.length; i++) {
                    const csvRow = allRows[i];
                    const record = {};
                    for (let c = 0; c < headers.length; c++) {
                        const dbCol = colMap[c];
                        if (!dbCol) continue;
                        let val = csvRow[c] ?? '';
                        if (val === '') val = null;
                        if (val === null && record[dbCol] != null) continue;
                        if (val && TIMESTAMP_COLS.has(dbCol)) {
                            val = toGMT6(val);
                        }
                        if (val && INTEGER_COLS.has(dbCol)) {
                            const n = parseInt(val, 10);
                            val = isNaN(n) ? null : n;
                        }
                        if (BOOLEAN_COLS.has(dbCol)) {
                            val = val === 'true' || val === '1' || val === true;
                        }
                        record[dbCol] = val;
                    }
                    if (record.conversation_id) {
                        record.synced_at = nowGMT6();
                        rows.push(record);
                    }
                }
                const BATCH = 1000;
                let imported = 0;
                for (let start = 0; start < rows.length; start += BATCH) {
                    const chunk = rows.slice(start, start + BATCH);
                    const { error: insertErr } = await supabase.from('conversation_dataset').insert(chunk);
                    if (insertErr) {
                        return res.status(200).json({ success: false, error: 'Supabase insert failed: ' + insertErr.message, imported, detail: insertErr });
                    }
                    imported += chunk.length;
                }
                const unmappedHeaders = headers.filter((h, i) => !colMap[i]);
                const mappedDetail = headers.map((h, i) => colMap[i] ? `${h} → ${colMap[i]}` : null).filter(Boolean);
                const sampleRow = allRows.length > 1 ? Object.fromEntries(headers.map((h, i) => [h, allRows[1][i] ?? ''])) : {};

                const MOVE_COLS = 'conversation_id, created_at, updated_at, channel, country, state, assignee_id, assignee_name, team_id, "FIN AI Agent involved", "FIN AI Agent deflected"';
                let movedToSpo = 0;
                let movedToFin = 0;
                let movedToEmail = 0;
                let moveErrors = [];

                // Move Chat/Instagram/Facebook rows to SPO (FIN sync handled separately by sync-fin-conversations Edge Function)
                const { data: spoRows, error: spoFetchErr } = await supabase
                    .from('conversation_dataset')
                    .select(MOVE_COLS)
                    .in('channel', ['Chat', 'Instagram', 'Facebook'])
                    .not('conversation_id', 'is', null);
                if (spoFetchErr) {
                    moveErrors.push('SPO fetch: ' + spoFetchErr.message);
                } else if (spoRows && spoRows.length > 0) {
                    const { data: existingSpo } = await supabase
                        .from('Service Performance Overview')
                        .select('conversation_id')
                        .not('conversation_id', 'is', null);
                    const existingSpoIds = new Set((existingSpo || []).map(r => r.conversation_id));
                    const newSpoRows = spoRows.filter(r => !existingSpoIds.has(r.conversation_id));
                    if (newSpoRows.length > 0) {
                        for (let s = 0; s < newSpoRows.length; s += BATCH) {
                            const chunk = newSpoRows.slice(s, s + BATCH);
                            const { error: spoInsErr } = await supabase.from('Service Performance Overview').insert(chunk);
                            if (spoInsErr) { moveErrors.push('SPO insert: ' + spoInsErr.message); break; }
                            movedToSpo += chunk.length;
                        }
                    }
                }

                const { data: emailRows, error: emailFetchErr } = await supabase
                    .from('conversation_dataset')
                    .select(MOVE_COLS)
                    .eq('channel', 'Email')
                    .not('conversation_id', 'is', null);
                if (emailFetchErr) {
                    moveErrors.push('Email fetch: ' + emailFetchErr.message);
                } else if (emailRows && emailRows.length > 0) {
                    const { data: existingEmail } = await supabase
                        .from('Email - Service Performance Overview')
                        .select('conversation_id')
                        .not('conversation_id', 'is', null);
                    const existingEmailIds = new Set((existingEmail || []).map(r => r.conversation_id));
                    const newEmailRows = emailRows.filter(r => !existingEmailIds.has(r.conversation_id));
                    if (newEmailRows.length > 0) {
                        for (let s = 0; s < newEmailRows.length; s += BATCH) {
                            const chunk = newEmailRows.slice(s, s + BATCH);
                            const { error: emailInsErr } = await supabase.from('Email - Service Performance Overview').insert(chunk);
                            if (emailInsErr) { moveErrors.push('Email insert: ' + emailInsErr.message); break; }
                            movedToEmail += chunk.length;
                        }
                    }
                }

                if (movedToSpo > 0 || movedToEmail > 0) {
                    await supabase.from('conversation_dataset')
                        .delete()
                        .in('channel', ['Chat', 'Email', 'Instagram', 'Facebook'])
                        .not('conversation_id', 'is', null);
                }

                return res.status(200).json({ success: true, imported, movedToSpo, movedToFin, movedToEmail, moveErrors: moveErrors.length > 0 ? moveErrors : undefined, totalCsvRows: allRows.length - 1, filteredRows: rows.length, jobId, csvHeaders: headers, mappedColumns: mappedCount, unmappedHeaders, mappedDetail, sampleRow });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'cd-download-import failed: ' + (e.message || String(e)) });
            }
        }

        // ============ TICKETS DATASET: Enqueue export ============
        if (action === 'tickets-enqueue') {
            const dateFrom = (body && body.dateFrom) || '2025-06-01';
            const dateTo = (body && body.dateTo) || '2026-02-17';
            try {
                const dsResp = await fetchIntercom('/export/reporting_data/get_datasets');
                if (!dsResp.ok) {
                    return res.status(200).json({ success: false, error: `get_datasets failed: ${dsResp.status} ${JSON.stringify(dsResp.data)}` });
                }
                const rawDatasets = dsResp.data?.data ?? dsResp.data ?? [];
                const datasets = Array.isArray(rawDatasets) ? rawDatasets : [rawDatasets];
                const ticketDs = datasets.find(
                    d => (d.id && String(d.id).toLowerCase() === 'tickets') ||
                         (d.name && String(d.name).toLowerCase().includes('ticket'))
                ) || datasets.find(
                    d => d.id && String(d.id).toLowerCase().includes('ticket')
                );
                if (!ticketDs) {
                    return res.status(200).json({ success: false, error: 'Tickets dataset not found. Available: ' + datasets.map(d => `${d.id}(${d.name || ''})`).join(', ') });
                }
                const datasetId = ticketDs.id;
                let attributeIds = [];
                if (ticketDs.attributes && Array.isArray(ticketDs.attributes)) {
                    attributeIds = ticketDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a));
                }
                const DHAKA_OFFSET = 6 * 3600;
                const partsFrom = dateFrom.split('T')[0].split('-').map(Number);
                const partsTo = dateTo.split('T')[0].split('-').map(Number);
                const fromTs = partsFrom.length >= 3 ? Math.floor(Date.UTC(partsFrom[0], partsFrom[1] - 1, partsFrom[2]) / 1000) - DHAKA_OFFSET : 1738368000;
                const toTs = partsTo.length >= 3 ? Math.floor(Date.UTC(partsTo[0], partsTo[1] - 1, partsTo[2], 23, 59, 59) / 1000) - DHAKA_OFFSET : 1739750399;
                const enqBody = { start_time: fromTs, end_time: toTs, dataset_id: datasetId };
                if (attributeIds.length > 0) enqBody.attribute_ids = attributeIds;
                const enqResp = await fetchIntercom('/export/reporting_data/enqueue', {
                    method: 'POST',
                    body: JSON.stringify(enqBody)
                });
                if (!enqResp.ok) {
                    return res.status(200).json({ success: false, error: `enqueue failed: ${enqResp.status} ${JSON.stringify(enqResp.data)}` });
                }
                const jobId = enqResp.data?.job_identifier ?? enqResp.data?.job_id ?? enqResp.data?.id;
                if (!jobId) {
                    return res.status(200).json({ success: false, error: 'Enqueue response missing job_identifier', raw: enqResp.data });
                }
                return res.status(200).json({ success: true, jobId, status: enqResp.data?.status || 'pending', datasetId, attributeCount: attributeIds.length });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'tickets-enqueue failed: ' + (e.message || String(e)) });
            }
        }

        // ============ TICKETS DATASET: Download CSV & import to Supabase ============
        if (action === 'tickets-download-import') {
            const { jobId } = body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, {
                auth: { autoRefreshToken: false, persistSession: false }
            });

            function parseFullCSV(csvText) {
                const rows = [];
                let row = [];
                let field = '';
                let inQuotes = false;
                for (let i = 0; i < csvText.length; i++) {
                    const c = csvText[i];
                    if (c === '"') {
                        if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') {
                            field += '"'; i++;
                        } else {
                            inQuotes = !inQuotes;
                        }
                    } else if (c === ',' && !inQuotes) {
                        row.push(field.trim()); field = '';
                    } else if (c === '\n' && !inQuotes) {
                        row.push(field.trim());
                        if (row.some(f => f !== '')) rows.push(row);
                        row = []; field = '';
                    } else if (c === '\r' && !inQuotes) {
                        // skip
                    } else {
                        field += c;
                    }
                }
                row.push(field.trim());
                if (row.some(f => f !== '')) rows.push(row);
                return rows;
            }

            try {
                const downloadUrl = `https://api.intercom.io/download/reporting_data/${jobId}`;
                const dlResp = await httpsRequestBinary(downloadUrl, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, 'Accept': 'application/octet-stream', 'Intercom-Version': '2.14' }
                });
                if (!dlResp.ok) {
                    return res.status(200).json({ success: false, error: `Download failed: ${dlResp.status}`, jobId });
                }
                let csvBuffer = dlResp.buffer;
                if (csvBuffer[0] === 0x1f && csvBuffer[1] === 0x8b) csvBuffer = zlib.gunzipSync(csvBuffer);
                const csvText = csvBuffer.toString('utf8');
                const allRows = parseFullCSV(csvText);
                if (allRows.length < 2) {
                    return res.status(200).json({ success: true, imported: 0, totalCsvRows: 0, message: 'Export contained no data rows.' });
                }
                const headers = allRows[0];

                // Convert all headers to snake_case
                const allColMap = headers.map(h => {
                    const raw = h.trim();
                    const snake = raw.replace(/\s*\([^)]*\)\s*$/, '').trim()
                        .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
                    return snake || null;
                });

                // Build rows with ALL columns as text (no type casting on first pass)
                const rawRows = [];
                for (let i = 1; i < allRows.length; i++) {
                    const csvRow = allRows[i];
                    const record = {};
                    for (let c = 0; c < headers.length; c++) {
                        const dbCol = allColMap[c];
                        if (!dbCol || dbCol === 'id') continue;
                        let val = csvRow[c] ?? '';
                        if (val === '') val = null;
                        if (val === null && record[dbCol] != null) continue;
                        record[dbCol] = val;
                    }
                    record.synced_at = new Date(Date.now() + 6 * 3600 * 1000).toISOString().replace('Z', '+06:00');
                    rawRows.push(record);
                }

                if (rawRows.length === 0) {
                    return res.status(200).json({ success: true, imported: 0, totalCsvRows: allRows.length - 1, message: 'No data rows after processing.' });
                }

                // Try inserting first row to detect which columns the table accepts
                let badColumns = new Set();
                const MAX_RETRIES = 20;
                for (let retry = 0; retry < MAX_RETRIES; retry++) {
                    const testRow = { ...rawRows[0] };
                    badColumns.forEach(col => delete testRow[col]);
                    const { error: testErr } = await supabase.from('tickets_dataset').insert([testRow]);
                    if (!testErr) {
                        // First row inserted, delete it to avoid duplicate (we'll batch-insert all including this one)
                        // Actually just break; we'll re-insert in batch below
                        break;
                    }
                    const errMsg = testErr.message || '';
                    // PostgREST error: "Could not find the 'X' column of 'tickets_dataset' in the schema cache"
                    const colMatch = errMsg.match(/Could not find the '([^']+)' column/i) ||
                                     errMsg.match(/column "([^"]+)" of relation/i) ||
                                     errMsg.match(/column ['"]([^'"]+)['"]/i);
                    if (colMatch) {
                        badColumns.add(colMatch[1]);
                        continue;
                    }
                    // Unknown error — return it for debugging
                    return res.status(200).json({
                        success: false,
                        error: 'Supabase insert failed: ' + errMsg,
                        csvHeaders: headers,
                        snakeHeaders: allColMap,
                        sampleRow: rawRows[0],
                        detail: testErr
                    });
                }

                // Delete the test row we just inserted
                if (rawRows[0].synced_at) {
                    await supabase.from('tickets_dataset').delete().eq('synced_at', rawRows[0].synced_at).limit(1);
                }

                // Strip bad columns from all rows
                const rows = rawRows.map(r => {
                    const clean = { ...r };
                    badColumns.forEach(col => delete clean[col]);
                    return clean;
                });

                const BATCH = 1000;
                let imported = 0;
                for (let start = 0; start < rows.length; start += BATCH) {
                    const chunk = rows.slice(start, start + BATCH);
                    const { error: insertErr } = await supabase.from('tickets_dataset').insert(chunk);
                    if (insertErr) {
                        return res.status(200).json({ success: false, error: 'Supabase batch insert failed: ' + insertErr.message, imported, batchStart: start, detail: insertErr, badColumns: [...badColumns] });
                    }
                    imported += chunk.length;
                }
                const acceptedCols = allColMap.filter(c => c && c !== 'id' && !badColumns.has(c));
                const skippedCols = [...badColumns];
                const mappedDetail = headers.map((h, i) => {
                    const col = allColMap[i];
                    if (!col || col === 'id') return null;
                    if (badColumns.has(col)) return `${h} → ${col} (SKIPPED - column not in table)`;
                    return `${h} → ${col}`;
                }).filter(Boolean);
                const sampleRow = allRows.length > 1 ? Object.fromEntries(headers.map((h, i) => [h, allRows[1][i] ?? ''])) : {};
                return res.status(200).json({ success: true, imported, totalCsvRows: allRows.length - 1, filteredRows: rows.length, jobId, csvHeaders: headers, mappedColumns: acceptedCols.length, skippedColumns: skippedCols, mappedDetail, sampleRow });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'tickets-download-import failed: ' + (e.message || String(e)) });
            }
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
            
            // Extract transcript for debugging
            const transcript = extractTranscript(conv);
            
            // Summarize conversation_parts for debugging
            const parts = conv.conversation_parts?.conversation_parts || [];
            const partsSummary = parts.slice(0, 5).map(p => ({
                part_type: p.part_type,
                author_type: p.author?.type,
                has_body: !!p.body,
                body_preview: p.body ? htmlToText(p.body).substring(0, 100) : null
            }));
            
            // Return raw data for debugging
            return res.status(200).json({
                success: true,
                conversation: {
                    id: conv.id,
                    custom_attributes: conv.custom_attributes,
                    tags: conv.tags,
                    topics: conv.topics,
                    source: {
                        body: conv.source?.body ? htmlToText(conv.source.body).substring(0, 200) : null,
                        author: conv.source?.author,
                        delivered_as: conv.source?.delivered_as
                    },
                    conversation_rating: conv.conversation_rating,
                    conversation_parts_count: parts.length,
                    conversation_parts_sample: partsSummary,
                    all_keys: Object.keys(conv)
                },
                contact: contact ? {
                    id: contact.id,
                    external_id: contact.external_id,
                    location: contact.location,
                    custom_attributes: contact.custom_attributes,
                    all_keys: Object.keys(contact)
                } : null,
                extracted_transcript: transcript ? transcript.substring(0, 500) : null,
                transcript_length: transcript ? transcript.length : 0
            });
        }

        // Action: Fetch full details for a single conversation (for saving to Supabase)
        if (action === 'fetch-details') {
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId required' });
            }
            
            let convResp;
            try {
                convResp = await fetchIntercom(`/conversations/${conversationId}?display_as=plaintext`);
            } catch (e) {
                return res.status(200).json({ success: false, error: 'Intercom request failed: ' + (e.message || String(e)) });
            }
            
            if (!convResp.ok) {
                const errMsg = convResp.data?.error?.message || convResp.data?.message || ('Intercom ' + convResp.status);
                return res.status(200).json({ success: false, error: errMsg, status: convResp.status });
            }
            
            const conv = convResp.data;
            if (!conv || typeof conv !== 'object' || conv.type === 'error.list') {
                return res.status(200).json({ success: false, error: 'Invalid conversation response from Intercom' });
            }
            if (conv.id == null) {
                return res.status(200).json({ success: false, error: 'Conversation missing id' });
            }
            
            let transcript;
            try {
                transcript = extractTranscript(conv);
            } catch (e) {
                transcript = '';
            }
            
            let contactData = { Country: null, Region: null, 'User ID': null };
            let contactResp = null;
            try {
                const contactId = conv.contacts?.contacts?.[0]?.id;
                if (contactId) {
                    contactResp = await fetchIntercom(`/contacts/${contactId}`);
                    if (contactResp.ok && contactResp.data && typeof contactResp.data === 'object') {
                        const contact = contactResp.data;
                        contactData = {
                            'Country': contact.location?.country || null,
                            'Region': contact.location?.region || null,
                            'User ID': contact.external_id || contact.id || null
                        };
                    }
                }
            } catch (e) {
                // Continue without contact data
            }
            
            const teamAssigneeId = conv.team_assignee_id;
            const rating = conv.conversation_rating?.rating;
            
            let product = null;
            try {
                const KNOWN_PRODUCTS = ['CFD', 'CFDs', 'Futures', 'Forex', 'Stocks', 'Crypto', 'Options', 'Commodities', 'Indices', 'ETF', 'Bonds'];
                const customAttrs = conv.custom_attributes || {};
                product = customAttrs.product ?? customAttrs.Product ?? customAttrs.product_name ?? customAttrs.channel ?? null;
                
                if (!product) {
                    for (const [k, v] of Object.entries(customAttrs)) {
                        if (v != null && String(v).trim() !== '' && /product|channel/i.test(k)) {
                            product = String(v);
                            break;
                        }
                    }
                }
                
                if (!product && conv.tags?.tags?.length > 0) {
                    for (const tag of conv.tags.tags) {
                        const tagName = tag.name ?? tag;
                        for (const knownProduct of KNOWN_PRODUCTS) {
                            if (String(tagName).toLowerCase().includes(knownProduct.toLowerCase())) {
                                product = knownProduct;
                                break;
                            }
                        }
                        if (!product && /product/i.test(String(tagName))) {
                            product = String(tagName).replace(/product[:\s]*/i, '').trim() || tagName;
                        }
                        if (product) break;
                    }
                }
                
                if (!product && conv.topics) {
                    const topicsArr = Array.isArray(conv.topics) ? conv.topics : (conv.topics?.topics || []);
                    for (const topic of topicsArr) {
                        const topicName = topic?.name ?? topic;
                        for (const knownProduct of KNOWN_PRODUCTS) {
                            if (String(topicName).toLowerCase().includes(knownProduct.toLowerCase())) {
                                product = knownProduct;
                                break;
                            }
                        }
                        if (product) break;
                    }
                }
                
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
                
                if (!product && conv.source?.custom_attributes) {
                    const srcAttrs = conv.source.custom_attributes;
                    product = srcAttrs.product ?? srcAttrs.Product ?? null;
                }
            } catch (e) {
                // Leave product as null
            }
            
            const record = {
                'Conversation ID': String(conv.id),
                'created_at': conv.created_at,
                'created_at_bd': conv.created_at != null ? new Date(conv.created_at * 1000).toISOString() : null,
                'Email': conv.source?.author?.email || null,
                'Transcript': transcript || null,
                'User ID': contactData['User ID'] || conv.source?.author?.id || null,
                'Country': contactData['Country'] || null,
                'Region': contactData['Region'] || null,
                'Assigned Channel ID': teamAssigneeId != null ? String(teamAssigneeId) : null,
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
            
            const [fromYear, fromMonth, fromDay] = dateFrom.split('-').map(Number);
            const [toYear, toMonth, toDay] = dateTo.split('-').map(Number);
            const tFrom = parseTime(timeFrom, 0, 0, 0);
            const tTo = parseTime(timeTo, 23, 59, 59);
            const fromTs = filterDateTimeToUnix(fromYear, fromMonth, fromDay, tFrom.hour, tFrom.min, tFrom.sec);
            const toTs = filterDateTimeToUnix(toYear, toMonth, toDay, tTo.hour, tTo.min, tTo.sec);
            
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
        
        // ============ SPO ENRICH: Fetch per-agent FRT/ART/AHT from Intercom ============
        function _isBot(author) {
            if (!author) return true;
            const name = (author.name || '').toLowerCase();
            const email = (author.email || '').toLowerCase();
            if (author.type === 'bot') return true;
            if (name.includes('fundednext ai') || name === 'fin') return true;
            if (name.includes('operator') || name.includes('workflow')) return true;
            if (email.includes('bot') || email.includes('operator') || email.includes('intercom')) return true;
            return false;
        }
        function _getAgentId(author) {
            if (!author || _isBot(author)) return null;
            return author.id ? String(author.id) : (author.name || null);
        }
        function _getAgentName(author, adminMap) {
            if (!author || _isBot(author)) return null;
            if (author.id && adminMap[author.id]) return adminMap[author.id];
            return author.name || null;
        }

        function _calcMetrics(conv, adminMap) {
                const stats = conv.statistics || {};
                const convCreated = conv.created_at;
                const agentMetrics = {};
                const waitTime = stats.time_to_assignment || stats.time_to_first_close || null;
                let connectToAgentTime = null;
                let assignmentTime = null;
                const agentAssignTimes = {};
                let sentiment = null;
                if (conv.tags?.tags) {
                    for (const tag of conv.tags.tags) {
                        const n = (tag.name || '').toLowerCase();
                        if (n.includes('positive') || n.includes('happy') || n.includes('satisfied')) { sentiment = 'Positive'; break; }
                        else if (n.includes('negative') || n.includes('angry') || n.includes('frustrated')) { sentiment = 'Negative'; break; }
                        else if (n.includes('neutral')) { sentiment = 'Neutral'; break; }
                    }
                }
                const csat = conv.conversation_rating?.rating || null;
                let globalFrtDone = false;
                if (conv.conversation_parts && conv.conversation_parts.conversation_parts) {
                    const parts = conv.conversation_parts.conversation_parts;
                    const agentUserMsg = {};
                    let lastUserMsgTime = null;
                    let lastAssignTime = null;
                    let conversationClosed = false;
                    let isAfterReopen = false;
                    for (const part of parts) {
                        if (!part.created_at) continue;
                        const pt = part.part_type || '';
                        if (pt === 'close' || pt === 'conversation_close') {
                            conversationClosed = true;
                            continue;
                        }
                        if (conversationClosed && part.author?.type === 'user') {
                            isAfterReopen = true;
                        }
                        if (part.author?.type === 'user') {
                            if (part.body) {
                                const bl = (typeof part.body === 'string' ? part.body : '').toLowerCase();
                                if (bl.includes('connect to an agent') || bl.includes('connect to agent')) {
                                    if (!connectToAgentTime) connectToAgentTime = part.created_at;
                                }
                            }
                            lastUserMsgTime = part.created_at;
                            for (const aid in agentMetrics) agentUserMsg[aid] = part.created_at;
                            continue;
                        }
                        const isAssign = pt === 'assignment' || pt === 'message_strategy_assignment' || pt === 'default_assignment' || part.type === 'assignment' || (part.body && typeof part.body === 'string' && part.body.toLowerCase().includes('assignment:'));
                        if (isAssign) {
                            lastAssignTime = part.created_at;
                            const at = part.assigned_to;
                            if (at && at.type === 'admin') {
                                const aid = String(at.id);
                                agentAssignTimes[aid] = part.created_at;
                                if (!assignmentTime) assignmentTime = part.created_at;
                            }
                            if (part.assignee && !_isBot(part.assignee)) {
                                const aid2 = _getAgentId(part.assignee);
                                if (aid2) { agentAssignTimes[aid2] = part.created_at; if (!assignmentTime) assignmentTime = part.created_at; }
                            }
                            if (part.body && typeof part.body === 'string') {
                                const m = part.body.match(/Assignment:\s*([^(]+)/i);
                                if (m) { const an = m[1].trim(); for (const [id, nm] of Object.entries(adminMap)) { if (nm && nm.toLowerCase() === an.toLowerCase()) { agentAssignTimes[id] = part.created_at; break; } } }
                            }
                        }
                        if (part.body && typeof part.body === 'string') {
                            const bl = part.body.toLowerCase();
                            if ((bl.includes('balanced assignment') || (bl.includes('assigned') && !bl.includes('team assignment'))) && !assignmentTime) assignmentTime = part.created_at;
                        }
                        if (part.author?.type === 'admin' && pt === 'comment') {
                            if (_isBot(part.author)) continue;
                            const agentId = _getAgentId(part.author);
                            if (!agentId) continue;
                            if (!agentMetrics[agentId]) {
                                agentMetrics[agentId] = { agentId, agentName: _getAgentName(part.author, adminMap), frt: null, artEvents: [], firstResponseTime: part.created_at, lastResponseTime: part.created_at, responseCount: 0 };
                                agentUserMsg[agentId] = null;
                            }
                            const ag = agentMetrics[agentId];
                            ag.responseCount++;
                            ag.lastResponseTime = part.created_at;
                            if (ag.frt === null) {
                                if (isAfterReopen) {
                                    ag.frt = -1;
                                } else {
                                    const aat = agentAssignTimes[agentId];
                                    if (aat && part.created_at > aat) {
                                        ag.frt = part.created_at - aat;
                                    } else if (lastAssignTime && part.created_at > lastAssignTime) {
                                        ag.frt = part.created_at - lastAssignTime;
                                    } else if (assignmentTime && part.created_at > assignmentTime) {
                                        ag.frt = part.created_at - assignmentTime;
                                    } else if (lastUserMsgTime && part.created_at > lastUserMsgTime) {
                                        ag.frt = part.created_at - lastUserMsgTime;
                                    } else {
                                        ag.frt = -1;
                                    }
                                }
                                if (!globalFrtDone) { globalFrtDone = true; if (!assignmentTime) assignmentTime = part.created_at; }
                                agentUserMsg[agentId] = null;
                            }
                            if (ag.frt !== null && agentUserMsg[agentId]) {
                                const rt = part.created_at - agentUserMsg[agentId];
                                if (rt > 0 && rt < 86400) ag.artEvents.push(rt);
                                agentUserMsg[agentId] = null;
                            }
                        }
                    }
                }
                let avgWaitTime = null;
                if (connectToAgentTime && assignmentTime && assignmentTime > connectToAgentTime) avgWaitTime = assignmentTime - connectToAgentTime;
                else if (connectToAgentTime && !assignmentTime && conv.assignee && !_isBot(conv.assignee)) { const fa = Object.values(agentMetrics)[0]; if (fa && fa.firstResponseTime > connectToAgentTime) avgWaitTime = fa.firstResponseTime - connectToAgentTime; }
                else if (!connectToAgentTime && assignmentTime && assignmentTime > convCreated) avgWaitTime = assignmentTime - convCreated;

                return Object.values(agentMetrics).map(ag => {
                    const isReopenFrt = ag.frt === -1;
                    const noFrt = isReopenFrt || ag.frt === null;
                    const effectiveFrt = noFrt ? 0 : ag.frt;
                    let art = null;
                    if (ag.artEvents.length > 0) art = Math.round(ag.artEvents.reduce((s, t) => s + t, 0) / ag.artEvents.length);
                    const aht = ag.lastResponseTime - ag.firstResponseTime;
                    let frtHit = noFrt ? null : (effectiveFrt > 30 ? 1 : 0);
                    let artHit = null;
                    if (ag.artEvents.length > 0) artHit = Math.round((ag.artEvents.filter(t => t > 60).length / ag.artEvents.length) * 100);
                    let name = ag.agentName;
                    if (name && (name.toLowerCase().includes('fundednext ai') || name.toLowerCase() === 'fin')) name = 'FIN';
                    return { agentId: ag.agentId, agentName: name, frt: effectiveFrt, art, aht: aht > 0 ? aht : null, waitTime, avgWaitTime, frtHitRate: frtHit, artHitRate: artHit, sentiment, csat, responseCount: ag.responseCount, firstResponseTime: ag.firstResponseTime };
                });
        }

        if (action === 'spo-enrich') {
            const DHAKA_OFFSET_MS = 6 * 3600 * 1000;
            const toDhakaISO = (epochSec) => {
                const d = new Date(epochSec * 1000 + DHAKA_OFFSET_MS);
                return d.toISOString().replace('Z', '+06:00');
            };
            const nowDhakaISO = () => {
                const d = new Date(Date.now() + DHAKA_OFFSET_MS);
                return d.toISOString().replace('Z', '+06:00');
            };
            const batchSize = (body && body.batchSize) || 50;
            const forceAll = !!(body && body.force);
            const transfersOnly = !!(body && body.transfersOnly);
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, {
                auth: { autoRefreshToken: false, persistSession: false }
            });

            try {
                // Fetch admin map for name lookups
                const admResp = await fetchIntercom('/admins');
                const adminMap = {};
                if (admResp.ok && admResp.data?.admins) {
                    admResp.data.admins.forEach(a => { adminMap[a.id] = a.name || a.email || 'Unknown'; });
                }

                // Get conversation IDs that need enrichment
                let convIds = [];
                if (transfersOnly) {
                    const { data: transferRows, error: tErr } = await supabase.rpc('get_transfer_conversation_ids', { p_limit: batchSize });
                    if (tErr) {
                        const { data: fallbackRows, error: fbErr } = await supabase
                            .from('Service Performance Overview')
                            .select('conversation_id')
                            .not('conversation_id', 'is', null);
                        if (fbErr) return res.status(200).json({ success: false, error: 'Failed to fetch transfer rows: ' + fbErr.message });
                        const counts = {};
                        (fallbackRows || []).forEach(r => { counts[r.conversation_id] = (counts[r.conversation_id] || 0) + 1; });
                        convIds = Object.entries(counts).filter(([, c]) => c > 1).map(([id]) => id).slice(0, batchSize);
                    } else {
                        convIds = (transferRows || []).map(r => r.conversation_id);
                    }
                    if (convIds.length === 0) {
                        return res.status(200).json({ success: true, processed: 0, enriched: 0, remaining: 0, message: 'No transfer conversations to re-enrich.' });
                    }
                } else {
                    let query = supabase.from('Service Performance Overview').select('conversation_id').not('conversation_id', 'is', null);
                    if (!forceAll) {
                        query = query.is('frt_seconds', null);
                    } else {
                        query = query.is('Transcript', null);
                    }
                    const { data: pendingRows, error: fetchErr } = await query.limit(batchSize);

                    if (fetchErr) {
                        return res.status(200).json({ success: false, error: 'Failed to fetch pending rows: ' + fetchErr.message });
                    }
                    convIds = [...new Set((pendingRows || []).map(r => r.conversation_id))];
                    if (convIds.length === 0) {
                        let countQuery = supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null);
                        if (!forceAll) countQuery = countQuery.is('frt_seconds', null);
                        else countQuery = countQuery.is('Transcript', null);
                        const { count: remaining } = await countQuery;
                        const safeRem = (remaining !== null && remaining !== undefined) ? remaining : 0;
                        return res.status(200).json({ success: true, processed: 0, enriched: 0, remaining: safeRem, message: 'No more conversations to enrich.' });
                    }
                }

                // Load agent name mapping once
                const { data: mappingRows } = await supabase.from('agent_name_mapping').select('intercom_name, agent_name, exclude_from_metrics');
                const agentNameMap = {};
                const excludedAgents = new Set();
                if (mappingRows) mappingRows.forEach(r => {
                    agentNameMap[r.intercom_name] = r.agent_name;
                    if (r.exclude_from_metrics) excludedAgents.add(r.intercom_name);
                });

                let enriched = 0;
                let errors = [];
                let firstError = null;
                const CONCURRENCY = 5;

                async function enrichOne(convId) {
                    const convResp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
                    if (!convResp.ok) {
                        if (convResp.status === 404 || convResp.status === 410) {
                            await supabase.from('Service Performance Overview')
                                .update({ frt_seconds: 0, art_seconds: 0, aht_seconds: 0, "Transcript": '[]', "CX score": null })
                                .eq('conversation_id', convId);
                            return { convId, ok: true, skipped: true };
                        }
                        return { convId, error: `Intercom ${convResp.status}` };
                    }
                    const conv = convResp.data;
                    const agentResults = _calcMetrics(conv, adminMap);
                    const transcript = extractStructuredTranscript(conv);
                    const cxScore = conv.conversation_rating?.rating || null;
                    const countReopens = conv.statistics?.count_reopens || 0;
                    const finAiInvolved = conv.ai_agent_participated === true ? 'true' : 'false';
                    const finAiDeflected = (conv.ai_agent_participated === true && agentResults.length === 0) ? 'true' : 'false';
                    const enrichFields = {
                        "Transcript": transcript || null,
                        "CX score": cxScore,
                        csat_rating: cxScore,
                        is_reopened: countReopens > 0,
                        reopened_count: countReopens,
                        "FIN AI Agent involved": finAiInvolved,
                        "FIN AI Agent deflected": finAiDeflected,
                        synced_at: nowDhakaISO()
                    };

                    if (agentResults.length === 0) {
                        // No human agents found – just update enrich fields in SPO and skip.
                        // (FIN sync is handled separately by the sync-fin-conversations Edge Function)
                        await supabase.from('Service Performance Overview')
                            .update(enrichFields).eq('conversation_id', convId);
                        return { convId, ok: true, skipped: true, reason: 'no_agents' };
                    }

                    const { data: existingRows, error: selErr } = await supabase.from('Service Performance Overview').select('*').eq('conversation_id', convId).limit(1);
                    if (selErr) return { convId, error: `Select failed – ${selErr.message}` };
                    const base = existingRows?.[0] || {};
                    const removeKeys = ['id', 'frt_seconds', 'art_seconds', 'aht_seconds', 'wait_time_seconds',
                        'action_performed_by', 'agent_name', 'assignee_id', 'assignee_name',
                        'frt_hit_rate', 'art_hit_rate', 'FRT Hit Rate', 'ART Hit Rate',
                        'Avg Wait Time', 'avg_wait_time',
                        'sentiment', 'csat_rating', 'CX score', 'cx_score',
                        'Transcript', 'response_count', 'is_reopened', 'reopened_count'];
                    for (const k of removeKeys) delete base[k];

                    const { error: delErr } = await supabase.from('Service Performance Overview').delete().eq('conversation_id', convId);
                    if (delErr) return { convId, error: `Delete failed – ${delErr.message}` };

                    const rows = agentResults
                        .filter(ag => !excludedAgents.has(ag.agentName || ag.agentId))
                        .map(ag => {
                            const intercomName = ag.agentName || ag.agentId;
                            return {
                                ...base, ...enrichFields,
                                conversation_id: convId,
                                action_performed_by: intercomName,
                                agent_name: agentNameMap[intercomName] || null,
                                assignee_id: ag.agentId, assignee_name: ag.agentName,
                                created_at: ag.firstResponseTime ? toDhakaISO(ag.firstResponseTime - (ag.frt || 0)) : base.created_at,
                                frt_seconds: ag.frt, art_seconds: ag.art, aht_seconds: ag.aht,
                                wait_time_seconds: ag.waitTime,
                                "Avg Wait Time": ag.avgWaitTime, "FRT Hit Rate": ag.frtHitRate, "ART Hit Rate": ag.artHitRate,
                                sentiment: ag.sentiment, response_count: ag.responseCount
                            };
                        });
                    if (rows.length === 0) return { convId, ok: true, skipped: true };
                    const { error: insErr } = await supabase.from('Service Performance Overview').insert(rows);
                    if (insErr) return { convId, error: `Insert failed – ${insErr.message}` };
                    return { convId, ok: true };
                }

                // Process in parallel chunks of CONCURRENCY
                for (let i = 0; i < convIds.length; i += CONCURRENCY) {
                    const chunk = convIds.slice(i, i + CONCURRENCY);
                    const results = await Promise.all(chunk.map(id => enrichOne(id).catch(e => ({ convId: id, error: e.message || String(e) }))));
                    for (const r of results) {
                        if (r.ok) enriched++;
                        else if (r.error) {
                            errors.push(`${r.convId}: ${r.error}`);
                            if (!firstError) firstError = r.error;
                        }
                    }
                }

                // Count remaining
                let safeRemaining = -1;
                let remErr = null;
                if (transfersOnly) {
                    const { data: remTransfers, error: rtErr } = await supabase.rpc('get_transfer_conversation_ids', { p_limit: 100000 });
                    remErr = rtErr;
                    safeRemaining = rtErr ? -1 : (remTransfers || []).length - convIds.length;
                    if (safeRemaining < 0) safeRemaining = 0;
                } else {
                    let remQuery = supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null);
                    if (!forceAll) remQuery = remQuery.is('frt_seconds', null);
                    else remQuery = remQuery.is('Transcript', null);
                    const { count: remaining, error: rErr } = await remQuery;
                    remErr = rErr;
                    safeRemaining = (remaining !== null && remaining !== undefined) ? remaining : -1;
                }

                return res.status(200).json({
                    success: errors.length === 0 || enriched > 0,
                    processed: convIds.length,
                    enriched,
                    remaining: safeRemaining,
                    errors: errors.length > 0 ? errors : undefined,
                    firstError: firstError || undefined,
                    adminCount: Object.keys(adminMap).length,
                    remainingCountError: remErr ? remErr.message : undefined
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'spo-enrich failed: ' + (e.message || String(e)) });
            }
        }

        // ============ FIN TABLE ENRICHMENT (CX score only) ============
        if (action === 'spo-enrich-fin') {
            const DHAKA_OFFSET_MS = 6 * 3600 * 1000;
            const nowDhakaISO = () => {
                const d = new Date(Date.now() + DHAKA_OFFSET_MS);
                return d.toISOString().replace('Z', '+06:00');
            };
            const batchSize = (body && body.batchSize) || 50;
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, {
                auth: { autoRefreshToken: false, persistSession: false }
            });

            try {
                // Get FIN rows that haven't been enriched yet (CX score is null)
                const { data: pendingRows, error: fetchErr } = await supabase
                    .from('FIN - Service Performance Overview')
                    .select('conversation_id')
                    .is('"CX score"', null)
                    .not('conversation_id', 'is', null)
                    .limit(batchSize);

                if (fetchErr) {
                    return res.status(200).json({ success: false, error: 'Failed to fetch pending FIN rows: ' + fetchErr.message });
                }

                const convIds = [...new Set((pendingRows || []).map(r => r.conversation_id))];
                if (convIds.length === 0) {
                    const { count: remaining } = await supabase
                        .from('FIN - Service Performance Overview')
                        .select('*', { count: 'exact', head: true })
                        .is('"CX score"', null)
                        .not('conversation_id', 'is', null);
                    return res.status(200).json({ success: true, processed: 0, enriched: 0, remaining: remaining || 0, message: 'No more FIN conversations to enrich.' });
                }

                let enriched = 0;
                let errors = [];
                const CONCURRENCY = 5;

                async function enrichFinOne(convId) {
                    const convResp = await fetchIntercom(`/conversations/${convId}`);
                    if (!convResp.ok) {
                        if (convResp.status === 404 || convResp.status === 410) {
                            await supabase.from('FIN - Service Performance Overview')
                                .update({ "CX score": 0, csat_rating: 0, synced_at: nowDhakaISO() })
                                .eq('conversation_id', convId);
                            return { convId, ok: true, skipped: true };
                        }
                        return { convId, error: `Intercom ${convResp.status}` };
                    }
                    const conv = convResp.data;
                    const cxScore = conv.conversation_rating?.rating || null;

                    const { error: updErr } = await supabase
                        .from('FIN - Service Performance Overview')
                        .update({ "CX score": cxScore, csat_rating: cxScore, synced_at: nowDhakaISO() })
                        .eq('conversation_id', convId);
                    if (updErr) return { convId, error: `Update failed: ${updErr.message}` };
                    return { convId, ok: true };
                }

                // Process in parallel chunks
                for (let i = 0; i < convIds.length; i += CONCURRENCY) {
                    const chunk = convIds.slice(i, i + CONCURRENCY);
                    const results = await Promise.all(chunk.map(id => enrichFinOne(id).catch(e => ({ convId: id, error: e.message || String(e) }))));
                    for (const r of results) {
                        if (r.ok) enriched++;
                        else if (r.error) errors.push(`${r.convId}: ${r.error}`);
                    }
                }

                // Count remaining
                const { count: remaining } = await supabase
                    .from('FIN - Service Performance Overview')
                    .select('*', { count: 'exact', head: true })
                    .is('"CX score"', null)
                    .not('conversation_id', 'is', null);

                return res.status(200).json({
                    success: errors.length === 0 || enriched > 0,
                    processed: convIds.length,
                    enriched,
                    remaining: remaining || 0,
                    errors: errors.length > 0 ? errors : undefined
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'spo-enrich-fin failed: ' + (e.message || String(e)) });
            }
        }

        if (action === 'spo-recalc-frt') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            const intercomToken = process.env.INTERCOM_ACCESS_TOKEN;
            if (!supabaseUrl || !supabaseKey || !intercomToken) return res.status(200).json({ success: false, error: 'Missing config' });
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
            async function fetchIntercom(path) {
                const r = await fetch(`https://api.intercom.io${path}`, { headers: { 'Authorization': `Bearer ${intercomToken}`, 'Intercom-Version': '2.11', 'Accept': 'application/json' } });
                return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : null };
            }
            try {
                const admResp = await fetchIntercom('/admins');
                const adminMap = {};
                if (admResp.ok && admResp.data?.admins) admResp.data.admins.forEach(a => { adminMap[String(a.id)] = a.name; });

                const batchSize = body.batchSize || 50;
                const tableName = body.table || 'Service Performance Overview';
                const updateTimeOnly = !!(body && body.updateTimeOnly);

                let query = supabase.from(tableName).select('id, conversation_id').not('conversation_id', 'is', null);
                if (updateTimeOnly) {
                    query = query.is('created_at', null);
                } else {
                    query = query.is('frt_seconds', null);
                }
                const { data: pendingRows, error: fetchErr } = await query.limit(batchSize);

                if (fetchErr) return res.status(200).json({ success: false, error: 'Failed to fetch: ' + fetchErr.message });
                const convIds = [...new Set((pendingRows || []).map(r => r.conversation_id))];
                if (convIds.length === 0) {
                    let countQ = supabase.from(tableName).select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null);
                    if (updateTimeOnly) countQ = countQ.is('created_at', null);
                    else countQ = countQ.is('frt_seconds', null);
                    const { count: rem } = await countQ;
                    return res.status(200).json({ success: true, processed: 0, updated: 0, remaining: rem ?? 0, message: updateTimeOnly ? 'All timestamps updated.' : 'No rows need FRT recalculation.' });
                }

                let updated = 0;
                let errors = [];
                const CONCURRENCY = 10;

                async function recalcOne(convId) {
                    const convResp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
                    if (!convResp.ok) {
                        if (convResp.status === 404 || convResp.status === 410) {
                            await supabase.from(tableName).update({ frt_seconds: 0 }).eq('conversation_id', convId).is('frt_seconds', null);
                            return { convId, ok: true, skipped: true };
                        }
                        return { convId, error: `Intercom ${convResp.status}` };
                    }
                    const agentResults = _calcMetrics(convResp.data, adminMap);
                    const frtMap = {};
                    for (const ag of agentResults) {
                        frtMap[ag.agentId] = { frt: ag.frt, frtHitRate: ag.frtHitRate, firstResponseTime: ag.firstResponseTime };
                    }

                    const { data: rows } = await supabase.from(tableName).select('id, assignee_id').eq('conversation_id', convId);
                    if (!rows || rows.length === 0) return { convId, ok: true, skipped: true };

                    let count = 0;
                    for (const row of rows) {
                        const match = frtMap[row.assignee_id];
                        const frtVal = match ? match.frt : 0;
                        const frtHit = match ? match.frtHitRate : null;
                        const agentTime = match?.firstResponseTime ? new Date(match.firstResponseTime * 1000).toISOString() : null;
                        const updateData = { frt_seconds: frtVal, "FRT Hit Rate": frtHit };
                        if (agentTime) updateData.created_at = agentTime;
                        const { error: upErr } = await supabase.from(tableName)
                            .update(updateData)
                            .eq('id', row.id);
                        if (!upErr) count++;
                    }
                    return { convId, ok: true, count };
                }

                for (let i = 0; i < convIds.length; i += CONCURRENCY) {
                    const chunk = convIds.slice(i, i + CONCURRENCY);
                    const results = await Promise.all(chunk.map(id => recalcOne(id).catch(e => ({ convId: id, error: e.message || String(e) }))));
                    for (const r of results) {
                        if (r.ok) updated += (r.count || 0);
                        else if (r.error) errors.push(`${r.convId}: ${r.error}`);
                    }
                }

                let remQuery = supabase.from(tableName).select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null);
                if (updateTimeOnly) remQuery = remQuery.is('created_at', null);
                else remQuery = remQuery.is('frt_seconds', null);
                const { count: remaining } = await remQuery;
                return res.status(200).json({
                    success: errors.length === 0 || updated > 0,
                    processed: convIds.length,
                    updated,
                    remaining: (remaining !== null && remaining !== undefined) ? remaining : 9999,
                    errors: errors.length > 0 ? errors : undefined
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'spo-recalc-frt failed: ' + (e.message || String(e)) });
            }
        }

        if (action === 'spo-enrich-count') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
            try {
                const [r1, r2, r3, r4] = await Promise.all([
                    supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null),
                    supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).is('frt_seconds', null),
                    supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).is('Transcript', null),
                    supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).is('is_reopened', null)
                ]);
                const total = r1.count ?? 0;
                const needsFrt = r2.count ?? 0;
                const needsTranscript = r3.count ?? 0;
                const needsReopened = r4.count ?? 0;
                const errors = [r1.error, r2.error, r3.error, r4.error].filter(Boolean).map(e => e.message);
                return res.status(200).json({
                    success: true,
                    total,
                    pending_frt: needsFrt,
                    pending_transcript: needsTranscript,
                    pending_reopened: needsReopened,
                    enriched: total - needsFrt,
                    countErrors: errors.length > 0 ? errors : undefined
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: e.message || String(e) });
            }
        }

        if (action === 'conv-check') {
            const convId = body && body.conversationId;
            if (!convId) return res.status(200).json({ error: 'conversationId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
            const { data, error: err } = await supabase.from('Service Performance Overview').select('*').eq('conversation_id', convId);
            if (err) return res.status(200).json({ error: err.message });
            return res.status(200).json({ rows: (data||[]).map(r => { const copy = {...r}; delete copy.Transcript; delete copy.tags; return copy; }) });
        }

        if (action === 'conv-debug') {
            const convId = body && body.conversationId;
            if (!convId) return res.status(200).json({ error: 'conversationId required' });
            const convResp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
            if (!convResp.ok) return res.status(200).json({ error: 'Not found', status: convResp.status });
            const conv = convResp.data;
            const parts = conv.conversation_parts?.conversation_parts || [];
            const timeline = parts.map((p, i) => ({
                i,
                time: new Date(p.created_at * 1000).toISOString(),
                ts: p.created_at,
                type: p.part_type,
                authorType: p.author?.type,
                authorName: p.author?.name,
                assignedTo: p.assigned_to ? p.assigned_to.name : undefined,
                body: (p.body || '').replace(/<[^>]*>/g, '').substring(0, 80)
            }));
            const created = conv.created_at;
            const stats = conv.statistics || {};
            let connectTime = null;
            let assignTime = null;
            for (const p of parts) {
                if (p.author?.type === 'user' && p.body) {
                    const bl = (typeof p.body === 'string' ? p.body : '').toLowerCase().replace(/<[^>]*>/g, '');
                    if (bl.includes('connect to an agent') || bl.includes('connect to agent')) { if (!connectTime) connectTime = p.created_at; }
                }
                if (p.part_type === 'assignment' || p.part_type === 'message_strategy_assignment' || p.part_type === 'default_assignment') {
                    if (p.assigned_to?.type === 'admin' && !assignTime) assignTime = p.created_at;
                    if (p.assignee && !assignTime) assignTime = p.created_at;
                }
            }
            let waitCalc = null;
            if (connectTime && assignTime && assignTime > connectTime) waitCalc = { method: 'connect_to_assign', value: assignTime - connectTime, connect: new Date(connectTime*1000).toISOString(), assign: new Date(assignTime*1000).toISOString() };
            else if (connectTime && !assignTime) waitCalc = { method: 'connect_to_first_agent', connect: new Date(connectTime*1000).toISOString(), note: 'no assignment found' };
            else if (!connectTime && assignTime) waitCalc = { method: 'created_to_assign', value: assignTime - created, created: new Date(created*1000).toISOString(), assign: new Date(assignTime*1000).toISOString() };
            else waitCalc = { method: 'none', note: 'no connect-to-agent and no assignment found' };
            return res.status(200).json({
                conversationId: convId,
                created: new Date(created * 1000).toISOString(),
                stats: { time_to_assignment: stats.time_to_assignment, time_to_first_close: stats.time_to_first_close },
                assignee: conv.assignee ? { name: conv.assignee.name, type: conv.assignee.type } : null,
                partsCount: parts.length,
                waitTimeCalc: waitCalc,
                timeline
            });
        }

        if (action === 'spo-debug') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            try {
                const { createClient } = require('@supabase/supabase-js');
                const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
                const { data: sample, error: selErr } = await supabase.from('Service Performance Overview').select('*').limit(1);
                if (selErr) return res.status(200).json({ error: selErr.message });
                const cols = sample?.[0] ? Object.keys(sample[0]) : [];
                const sampleTypes = sample?.[0] ? Object.fromEntries(cols.map(c => [c, sample[0][c] === null ? 'NULL' : typeof sample[0][c] === 'string' ? sample[0][c].substring(0, 50) : sample[0][c]])) : {};
                const { count: totalRows } = await supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true });
                const { data: channels } = await supabase.from('Service Performance Overview').select('channel').not('channel', 'is', null).limit(100);
                const uniqueChannels = [...new Set((channels || []).map(r => r.channel))];
                const { data: dateCheck } = await supabase.from('Service Performance Overview').select('created_at').not('created_at', 'is', null).order('created_at', { ascending: false }).limit(3);
                return res.status(200).json({ success: true, totalRows, columns: cols, sampleRow: sampleTypes, uniqueChannels, recentDates: dateCheck });
            } catch (e) {
                return res.status(200).json({ error: e.message });
            }
        }

        return res.status(400).json({ error: 'Invalid action. Use: fetch-page, fetch-single, analyze-single, ca-enqueue, ca-poll, ca-download-import, cd-enqueue, cd-download-import, tickets-enqueue, tickets-download-import, spo-enrich, spo-enrich-fin, spo-enrich-count, spo-debug, list-datasets, enqueue-export, export-status, download-export, or test-intercom' });
        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

// Extend Vercel function timeout (max 300s on Pro, 60s on Hobby)
module.exports.config = {
    maxDuration: 300
};
