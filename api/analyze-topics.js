/**
 * Vercel Serverless API - Analyze Conversation Topics
 * Using https module instead of fetch for compatibility
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { guard } = require('../authlib.cjs');

// Sub-category → Main-category mapping built from historical CSAT data.
// Loaded once and used by csat-classify / csat-batch-process to fill the
// "Concern regarding product (Catagory)" column the n8n workflow used to write.
let __csatCategoryMap = null;
function getCsatCategoryMap() {
    if (__csatCategoryMap) return __csatCategoryMap;
    try {
        const p = path.join(__dirname, 'csat-category-map.json');
        __csatCategoryMap = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
        __csatCategoryMap = {};
    }
    return __csatCategoryMap;
}
function lookupMainCategory(sub) {
    if (!sub) return null;
    const map = getCsatCategoryMap();
    return map[sub.trim()] || null;
}

// Power users who get a raised Athena transcript cap (1000 instead of 10).
// Expensive path (~$3/message, 30-60s latency) — reserved for senior analysts
// who need broad qualitative scans across a big drill-in.
const ATHENA_POWER_USERS = new Set([
    'sajol@nextventures.io',
    'salmanwahid@nextventures.io',
    'dhrubo@nextventures.io',
    'sajolmk999@gmail.com',
    'cex.team@nextventures.io',
]);

// Teams whose conversations should land in "Service Performance Overview".
// Anything assigned to a team outside this list (e.g. Trading Ethics, Platform
// Operations, Unassigned) is dropped during import so enrichment stays scoped
// to the CX teams the dashboards actually track. Values match the exact
// `team_currently_assigned` strings Intercom emits (spacing matters).
const SPO_ALLOWED_TEAMS = new Set([
    // FUT
    'PC- GS (FUT)',
    'PC- GS- UN (FUT)',
    'PC- PS (FUT)',
    'PC- PS- UN (FUT)',
    'SC- GS (FUT)',
    'SC- GS- UN (FUT)',
    'SC- PS (FUT)',
    'SC- PS- UN (FUT)',
    'SM - FB & Insta (FUT)',
    'SM - UN (FUT)',
    'Transfer Chats (FUT)',
    // CFD
    'PC- GS (CFD)',
    'PC- GS- UN (CFD)',
    'PC- PS (CFD)',
    'PC- PS- UN (CFD)',
    'SC- GS (CFD)',
    'SC- GS- UN (CFD)',
    'SC- PS (CFD)',
    'SC- PS- UN (CFD)',
    'SM- FB & Insta (CFD)',
    'SM- UN (CFD)',
    'Transfer Chats (CFD)',
    // Telegram
    'SM- Telegram',
]);

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
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsRequestBinary(res.headers.location, options).then(resolve).catch(reject);
            }
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
  "Suggestions & feedback": ["suggestion"],
  "is_feedback": true/false,
  "feedback_type": "feedback"/"suggestion"/"none",
  "feedback_priority": "High"/"Medium"/"Low",
  "feedback_confidence": 0-100,
  "feedback_reason": "one-sentence explanation",
  "feedback_summary": "one short agent-voice sentence OR null",
  "client_quotes": "verbatim client text OR NOT_FOUND OR NO_TRANSCRIPT"
}

SENTIMENT CLASSIFICATION:

STEP 1 — IDENTIFY THE OPENING PHASE
The Opening Phase spans from the client's first message until the point where the client has fully expressed their issue and the agent has acknowledged it. Analyze ALL client messages within this phase to determine beginning sentiment.
Signs of Negative: frustration words ("still", "again", "unacceptable", "why isn't"), urgency, complaints, capital letters, exclamation marks, repeated follow-ups.
Signs of Positive: enthusiasm, excitement, complimenting before raising any concern.
Signs of Neutral: matter-of-fact questions, requests with no emotional charge.

STEP 2 — IDENTIFY THE CLOSING PHASE
The Closing Phase spans from the agent's primary resolution until the end of the conversation. Analyze ALL client messages within this phase to determine end sentiment.
⚠️ CRITICAL: "Thank you", "ok", "okay", "thanks", "got it", "sure", "alright" are POLITE CLOSINGS, not emotional signals.
Only classify end as Positive if client shows SUBSTANTIVE satisfaction: "That worked, thank you!" (Positive), "ok thanks" (Neutral), "fine whatever" (Negative).
If client's last messages are ONLY polite closings with no substance → end is Neutral.

Sentiment values: Very Negative, Negative, Neutral, Positive, Very Positive

FEEDBACK CLASSIFICATION:
CRITICAL — Only set is_feedback=true if the customer EXPLICITLY gives opinion, recommendation, or improvement request directed at us.
Valid feedback: "I suggest adding dark mode", "Your payout is too slow, please improve", "I appreciate how fast support responded"
NOT feedback: "My coupon code isn't working", "I can't log in", "My balance is wrong" — these are support issues.
feedback_type: "feedback" (about experience), "suggestion" (improvement request), "none" (not feedback)
feedback_priority: High (money/security/access issues), Medium (feature requests/process improvements), Low (positive feedback/minor requests)

FEEDBACK SUMMARY (field: feedback_summary)
- 1 sentence, 6–25 words, third-person present tense, agent-voice.
- Opens with "The client ..." / "Client ..." / or an imperative verb for suggestions ("Add MT5...", "Enforce stronger passwords...").
- Use product names as the client wrote them (verbatim: "projectX", "MT5", "Refer & Earn").
- Capture the specific ask or grievance, not a generic category.
- Do NOT copy the client's exact words here; paraphrase.
- If is_feedback is false, set feedback_summary to null.

CLIENT QUOTES (field: client_quotes)
- A STRING (not array). Quote ONLY text the CLIENT wrote — skip AGENT/admin/bot lines (in this transcript the client is tagged "USER:").
- Copy EXACTLY as typed — original language, typos, capitalization, punctuation.
- Keep only sentences that carry the complaint/suggestion; drop greetings and small talk.
- If multiple short client quotes each support the feedback, join them with "  |  " (space-pipe-space). Prefer 1–3 quotes.
- If is_feedback is false OR no client line supports it, set client_quotes to "NOT_FOUND".
- If the transcript is empty, set client_quotes to "NO_TRANSCRIPT".

Issue Categories: KYC & Verification, Account Access, Website & Dashboard, Rules & Scaling, Platform & Trading, Payment & Refunds, Payout, Offers & Coupons, Certificates & Competition, Compliance, Support, FLEX Issues, Other

Query Categories (use ONLY when the customer is asking a question/seeking information, NOT reporting a problem):
CHALLENGE SELECTION QUERY, PRICING & PAYMENT QUERY, ACCOUNT SETUP QUERY, CHALLENGE RULES QUERY, WITHDRAWAL & PAYOUT QUERY, PERFORMANCE REWARD QUERY, PAYOUT CYCLE QUERY, SCALE-UP PLAN QUERY, STELLAR INSTANT SCALE-UP QUERY, KYC & VERIFICATION QUERY, ACCOUNT RESET QUERY, REFUND RELATED QUERY, COUPON & DISCOUNT QUERY, Offer Related Query, FLEX Query

FLEX PROGRAM (FundedNext Futures FLEX — the Futures plan launched alongside Rapid/Legacy/Bolt and promoted as "Time to FLEX?" with lower prices and lower daily targets):
- "FLEX Query" — Use when the customer is asking informational questions about FLEX: what FLEX is, pricing of FLEX packages (e.g. "Prix du package flex 100k"), FLEX rules, eligibility, account sizes, launch date, how FLEX differs from Rapid/Legacy/Bolt, whether FLEX is CFD or Futures, etc. No broken/blocked experience — purely info-seeking. Main Category AND Sub category MUST both be exactly "FLEX Query".
- "FLEX Issues" — Use when the customer is reporting a problem specifically tied to a FLEX product: payment declined while buying a FLEX challenge, coupon/discount not applying to FLEX, FLEX account not provisioned after payment, FLEX dashboard or login glitches, FLEX rule violation disputes, or any incident where something is broken/blocked while interacting with FLEX. Main Category AND Sub category MUST both be exactly "FLEX Issues".

IMPORTANT: If the customer is asking a question or seeking information (e.g., "How do I withdraw?", "What are the challenge rules?", "Can I use a coupon?"), classify under a Query category. If the customer is reporting a problem or complaint (e.g., "My payout is delayed", "I can't log in"), classify under an Issue category. A conversation can have BOTH issue and query categories if it contains both types.

CRITICAL: Output category and sub-category names as plain text only — NO emoji, NO icon prefixes, NO leading/trailing decorative characters. Use the exact strings from the lists above.

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

// Strip emoji + variation selectors / ZWJ from a topic string; the LLM occasionally
// prefixes these despite the prompt, and they break dedup against the canonical taxonomy.
function cleanTopic(s) {
    if (s == null) return s;
    return String(s)
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanTopicList(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map(cleanTopic).filter(t => t && t.length > 0);
}

// Normalize product type — three canonical buckets: CFD, Futures, (raw otherwise).
// Stellar Instant maps to CFD. Used by CSV-import product enrichment and ticket-sync.
function normalizeProduct(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (/cfds?/i.test(s) || /stellar/i.test(s)) return 'CFD';
    if (/futures?/i.test(s)) return 'Futures';
    return s;
}

// Extract product from ticket_attributes, trying multiple key variants.
// Prefers exact "Product type"/"Product Type" keys; falls back to any key with "product".
// If attribute is null/missing, infers from issue_category (e.g. "(FUT)" → Futures).
function extractProductType(attrs, issueCategory) {
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (/^\s*product\s*type\s*$/i.test(k) && v) return normalizeProduct(v);
        }
        for (const [k, v] of Object.entries(attrs)) {
            if (/product/i.test(k) && v) return normalizeProduct(v);
        }
    }
    if (issueCategory) {
        const s = String(issueCategory);
        if (/\(fut\)/i.test(s) || /futures?/i.test(s)) return 'Futures';
        if (/cfds?/i.test(s) || /stellar/i.test(s)) return 'CFD';
    }
    return null;
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
            model: 'gpt-5.4-mini',
            messages: [
                { role: 'system', content: 'You are a support ticket categorization AI. Respond with valid JSON only.' },
                { role: 'user', content: CATEGORIZATION_PROMPT + transcript }
            ],
            temperature: 0,
            max_completion_tokens: 900
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
            feedbacks: parsed['Suggestions & feedback'] || [],
            is_feedback: parsed.is_feedback ?? false,
            feedback_type: parsed.feedback_type || 'none',
            feedback_priority: parsed.feedback_priority || null,
            feedback_confidence: parsed.feedback_confidence || null,
            feedback_reason: parsed.feedback_reason || null,
            feedback_summary: parsed.feedback_summary || null,
            client_quotes: parsed.client_quotes || 'NOT_FOUND'
        };
    } catch (e) {
        return null;
    }
}

// ============================================================
// SLA helpers (table-driven; sla_rules is the source of truth)
// ============================================================
const TEAM_OFFICE_HOURS = {
    CEx: { wdS: 0,   wdE: 24,   weS: 0,   weE: 24   },
    CPM: { wdS: 10,  wdE: 20.5, weS: 10,  weE: 19   },
    PT:  { wdS: 9,   wdE: 18,   weS: 9,   weE: 18   },
    TT:  { wdS: 9,   wdE: 18,   weS: 9,   weE: 18   },
    PO:  { wdS: 8.5, wdE: 17.5, weS: 8.5, weE: 17.5 },
    CR:  { wdS: 8.5, wdE: 17.5, weS: 8.5, weE: 17.5 },
    BO:  { wdS: 8.5, wdE: 17.5, weS: 8.5, weE: 17.5 }
};

// Normalize a category key so curly vs straight quotes / whitespace variants
// don't break the lookup. Intercom emits U+2019 (right single quote) but the
// SLA sheet sometimes has straight apostrophes — normalize both sides.
function normalizeCategoryKey(s) {
    if (s == null) return s;
    return String(s)
        .replace(/[‘’‚‛]/g, "'")
        .replace(/[“”„‟]/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

async function loadSlaRules(supabase) {
    const byCategory = new Map();
    const byTeam = new Map();
    try {
        const { data, error } = await supabase.from('sla_rules').select('*');
        if (error || !data) return { byCategory, byTeam };
        for (const r of data) {
            if (r.issue_category) byCategory.set(normalizeCategoryKey(r.issue_category), r);
            else byTeam.set(r.team_code, r);
        }
    } catch (e) { /* fall through with empty maps */ }
    return { byCategory, byTeam };
}

function lookupSlaRule(rules, teamCode, issueCategory) {
    if (issueCategory) {
        const key = normalizeCategoryKey(issueCategory);
        if (rules.byCategory.has(key)) return rules.byCategory.get(key);
    }
    if (teamCode && rules.byTeam.has(teamCode)) return rules.byTeam.get(teamCode);
    return null;
}

function teamCodeFromName(teamName) {
    const t = (teamName || '').toLowerCase();
    if (t.includes('pro solutions') || t.includes('cex reversal') || t.includes('ticket dependencies')) return 'CEx';
    if (t.includes('cpm') || t.includes('customer portfolio')) return 'CPM';
    if (t.includes('business operations')) return 'BO';
    if (t.includes('payments') || t.includes('treasury') || t.includes('gb email')) return 'PT';
    if (t.includes('platform operations')) return 'PO';
    if (t.includes('tech team')) return 'TT';
    if (t.includes('case resolution')) return 'CR';
    return '';
}

function resolveTeamCode(rules, issueCategory, currentTeam) {
    if (issueCategory) {
        const key = normalizeCategoryKey(issueCategory);
        if (rules.byCategory.has(key)) return rules.byCategory.get(key).team_code;
    }
    return teamCodeFromName(currentTeam);
}

// Office hours are keyed on createdAtUnix (when ticket arrived) — SLA tier
// is set at arrival, not at resolution.
function officeStateAt(teamCode, createdAtUnix) {
    if (!teamCode || !createdAtUnix || createdAtUnix <= 0) return { isOfficeHour: null, isWeekend: null };
    const hours = TEAM_OFFICE_HOURS[teamCode];
    if (!hours) return { isOfficeHour: null, isWeekend: null };
    const dhakaMs = (createdAtUnix + 21600) * 1000;
    const d = new Date(dhakaMs);
    const dow = d.getUTCDay();
    const isWeekend = (dow === 0 || dow === 6);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const s = isWeekend ? hours.weS : hours.wdS;
    const e = isWeekend ? hours.weE : hours.wdE;
    return { isOfficeHour: hour >= s && hour < e, isWeekend };
}

function computeSlaForTicket(rules, teamCode, issueCategory, createdAtUnix, durationSeconds) {
    const out = { sla_limit_hours: null, sla_status: 'N/A', resolved_during_office: null };
    const rule = lookupSlaRule(rules, teamCode, issueCategory);
    const { isOfficeHour, isWeekend } = officeStateAt(teamCode, createdAtUnix);
    if (isOfficeHour != null) out.resolved_during_office = isOfficeHour;
    if (!rule || isOfficeHour == null) return out;
    let limit;
    if (isWeekend) limit = isOfficeHour ? rule.we_office_h : rule.we_after_h;
    else           limit = isOfficeHour ? rule.wd_office_h : rule.wd_after_h;
    if (limit == null) return out;
    out.sla_limit_hours = Number(limit);
    if (durationSeconds != null && durationSeconds > 0) {
        out.sla_status = durationSeconds <= out.sla_limit_hours * 3600 ? 'Met' : 'Missed';
    }
    return out;
}

module.exports = async function handler(req, res) {
    if (!(await guard(req, res))) return;

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
        // Action: Athena chat — an LLM-backed analyst over a filtered record set.
        // If items include conversation_ids and those rows have embeddings in
        // Service Performance Overview, we run a small RAG pass (vector search
        // scoped to the popup's set) and feed the top transcripts to GPT.
        // Otherwise we fall back to a metadata-only summary.
        // Body: { contextLabel, contextType, items: [...], messages: [{role,content}...] }
        if (action === 'athena-chat') {
            // Athena is the only feature that uses OPENAI_API_KEY_ATHENA — the
            // dedicated key keeps Athena spend isolated from CSAT classification
            // / topic analysis jobs that run on OPENAI_API_KEY. Falls back to the
            // main key if the dedicated one isn't configured.
            const ATHENA_KEY = process.env.OPENAI_API_KEY_ATHENA || process.env.OPENAI_API_KEY;
            if (!ATHENA_KEY) {
                return res.status(200).json({ success: false, error: 'OPENAI_API_KEY_ATHENA not configured' });
            }
            const { contextLabel = 'records', contextType = 'generic', items = [], messages = [], userEmail = null, transcriptLimit = null, model: requestedModel = null } = body || {};
            if (!Array.isArray(messages) || messages.length === 0) {
                return res.status(400).json({ success: false, error: 'messages required' });
            }

            // Athena messages can be plain strings OR multimodal arrays of OpenAI parts
            // (e.g. [{type:'text',text}, {type:'image_url',image_url:{url:'data:...'}}]).
            // extractText pulls just the text portion (for RAG embedding lookups), and
            // normalizeContent shapes the value back into what OpenAI's chat API expects.
            const extractText = (content) => {
                if (content == null) return '';
                if (typeof content === 'string') return content;
                if (Array.isArray(content)) {
                    return content
                        .filter(p => p && p.type === 'text' && typeof p.text === 'string')
                        .map(p => p.text)
                        .join(' ');
                }
                return '';
            };
            const normalizeContent = (content) => {
                if (typeof content === 'string') return content;
                if (!Array.isArray(content)) return String(content || '');
                // Only allow text + data-URL image_url parts. Reject remote URLs so this
                // endpoint can't be used to exfiltrate the OpenAI key against arbitrary hosts.
                const parts = [];
                for (const p of content) {
                    if (!p || typeof p !== 'object') continue;
                    if (p.type === 'text' && typeof p.text === 'string') {
                        parts.push({ type: 'text', text: p.text });
                    } else if (p.type === 'image_url') {
                        const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
                        if (typeof url === 'string' && url.startsWith('data:image/')) {
                            parts.push({ type: 'image_url', image_url: { url } });
                        }
                    }
                }
                if (parts.length === 0) return '';
                // Single text-only part can collapse back to a plain string.
                if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
                return parts;
            };

            // Per-user cap. Power users get up to 500 transcripts ranked over a 5000-row pool;
            // everyone else keeps the default 10. Power users can also override TOP_N via
            // the Athena settings panel (transcriptLimit field). Identity is trusted from the
            // client — this is a soft cost/latency gate, not a security boundary.
            //
            // Power-user set = hardcoded ATHENA_POWER_USERS ∪ rows in `athena_permissions`
            // (the "Grant Access" list managed via Settings → Permission Management). This
            // lets admins extend power-user privileges without a redeploy.
            const normalizedEmail = typeof userEmail === 'string' ? userEmail.toLowerCase() : null;
            let isPowerUser = !!normalizedEmail && ATHENA_POWER_USERS.has(normalizedEmail);
            if (!isPowerUser && normalizedEmail) {
                const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
                const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
                if (supabaseUrl && supabaseKey) {
                    try {
                        const lookupUrl = `${supabaseUrl}/rest/v1/athena_permissions?select=email&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`;
                        const r = await fetch(lookupUrl, {
                            headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
                        });
                        if (r.ok) {
                            const rows = await r.json();
                            if (Array.isArray(rows) && rows.length > 0) isPowerUser = true;
                        }
                    } catch { /* lookup failed — keep non-power-user defaults */ }
                }
            }
            // Hard ceiling: GPT-5.4-mini has a large token context. Each transcript uses
            // up to 2,400 chars ≈ 600 tokens, so ~1,730 transcripts fit before hitting
            // the limit. We cap at 1,500 to leave headroom for the system prompt + history.
            const requestedLimit = isPowerUser && transcriptLimit != null
                ? Math.min(Math.max(parseInt(transcriptLimit, 10) || 50, 10), 1500)
                : null;
            const TOP_N = requestedLimit ?? (isPowerUser ? 500 : 10);
            const FETCH_POOL_CAP = isPowerUser ? 5000 : 400;
            const REPLY_TOKENS = isPowerUser ? 4000 : 1200;
            // Power users can pick a model from the Athena settings panel. Locked allowlist
            // — only models with verified pricing/context windows are accepted server-side.
            const ATHENA_MODEL_ALLOWLIST = new Set(['gpt-5.4-mini', 'gpt-5.4']);
            const RAG_MODEL = (isPowerUser && typeof requestedModel === 'string' && ATHENA_MODEL_ALLOWLIST.has(requestedModel))
                ? requestedModel
                : 'gpt-5.4-mini';

            // ── RAG branch: if items carry conversation_ids, try to ground the answer
            //    in transcripts already embedded in Service Performance Overview.
            const convIds = [...new Set(items
                .map(it => it && (it.conversation_id || it['Conversation ID']))
                .filter(Boolean)
                .map(String))];

            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            const userQuestion = lastUser ? extractText(lastUser.content) : '';

            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

            const tryRag = convIds.length >= 3 && userQuestion && supabaseUrl && supabaseKey;
            if (tryRag) {
                try {
                    // Fetch transcripts for the popup's conversation_ids. Try SPO first
                    // (richer transcript shape — JSON array of message parts). If SPO
                    // returns nothing usable, fall back to Intercom Topic (plain-text
                    // transcripts; pgvector embedding column lives there too).
                    const rows = [];
                    const CHUNK = 80;
                    for (let i = 0; i < convIds.length; i += CHUNK) {
                        const slice = convIds.slice(i, i + CHUNK);
                        const inList = slice.map(encodeURIComponent).join(',');
                        const url = `${supabaseUrl}/rest/v1/Service%20Performance%20Overview?select=conversation_id,Transcript,embedding,created_at,country,channel,assignee_name&Transcript=not.is.null&conversation_id=in.(${inList})`;
                        const r = await fetch(url, {
                            headers: {
                                apikey: supabaseKey,
                                Authorization: `Bearer ${supabaseKey}`,
                            },
                        });
                        if (r.ok) {
                            const batch = await r.json();
                            if (Array.isArray(batch)) rows.push(...batch);
                        }
                        if (rows.length > FETCH_POOL_CAP) break; // safety
                    }

                    // If SPO had no hits for this drill-in, try Intercom Topic. Most
                    // Conversation Topics / CSAT / Sentiment drill-ins come from here,
                    // so this is where the cosine ranking actually pays off.
                    let sourceTable = 'spo';
                    if (rows.length === 0) {
                        sourceTable = 'intercom_topic';
                        for (let i = 0; i < convIds.length; i += CHUNK) {
                            const slice = convIds.slice(i, i + CHUNK);
                            const inList = slice.map(encodeURIComponent).join(',');
                            // Column names are Intercom-Topic-cased; normalize into the SPO
                            // shape downstream code expects (conversation_id, Transcript,
                            // embedding, created_at, country, channel, assignee_name).
                            const url = `${supabaseUrl}/rest/v1/Intercom%20Topic?select=${encodeURIComponent('Conversation ID')},Transcript,embedding,created_at,Country,assigned_channel_name&Transcript=not.is.null&${encodeURIComponent('Conversation ID')}=in.(${inList})`;
                            const r = await fetch(url, {
                                headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
                            });
                            if (r.ok) {
                                const batch = await r.json();
                                if (Array.isArray(batch)) {
                                    for (const row of batch) {
                                        rows.push({
                                            conversation_id: row['Conversation ID'],
                                            Transcript: row.Transcript,
                                            embedding: row.embedding,
                                            created_at: row.created_at,
                                            country: row.Country,
                                            channel: row.assigned_channel_name,
                                            assignee_name: null,
                                        });
                                    }
                                }
                            }
                            if (rows.length > FETCH_POOL_CAP) break;
                        }
                    }

                    if (rows.length >= 3) {
                        // Split into embedded vs not. If we have ≥3 with embeddings,
                        // cosine-rank those. Otherwise fall back to most-recent-first.
                        const withEmb = rows.filter(r => r.embedding != null);
                        let top = [];
                        let mode = 'direct';
                        if (withEmb.length >= 3) {
                            const embResp = await httpsRequest('https://api.openai.com/v1/embeddings', {
                                method: 'POST',
                                headers: {
                                    Authorization: `Bearer ${ATHENA_KEY}`,
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ model: 'text-embedding-3-small', input: userQuestion.slice(0, 6000) }),
                            });
                            if (embResp.ok && embResp.data?.data?.[0]?.embedding) {
                                const q = embResp.data.data[0].embedding;
                                const qNorm = Math.sqrt(q.reduce((s, v) => s + v * v, 0)) || 1;
                                const scored = [];
                                for (const row of withEmb) {
                                    let emb = row.embedding;
                                    if (typeof emb === 'string') { try { emb = JSON.parse(emb); } catch (_) { emb = null; } }
                                    if (!Array.isArray(emb) || emb.length !== q.length) continue;
                                    let dot = 0, n = 0;
                                    for (let i = 0; i < emb.length; i++) { dot += q[i] * emb[i]; n += emb[i] * emb[i]; }
                                    const sim = dot / (qNorm * (Math.sqrt(n) || 1));
                                    scored.push({ row, sim });
                                }
                                scored.sort((a, b) => b.sim - a.sim);
                                top = scored.slice(0, TOP_N);
                                mode = 'rag';
                            }
                        }
                        if (top.length === 0) {
                            // No embeddings — take up to TOP_N most recent transcripts as plain grounding.
                            const recent = [...rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, TOP_N);
                            top = recent.map(r => ({ row: r, sim: null }));
                            mode = 'direct';
                        }
                        if (true) {

                            // SPO stores transcripts as JSON arrays; Intercom Topic stores
                            // them as plain "USER: ...\nAGENT: ..." text. Try JSON first, fall
                            // through to raw string so the Intercom Topic fallback also works.
                            const transcriptToText = (val) => {
                                if (val == null) return '';
                                if (typeof val !== 'string') {
                                    if (!Array.isArray(val)) return '';
                                    return val
                                        .filter(m => m && m.body && String(m.body).trim())
                                        .map(m => {
                                            const role = m.role === 'USER' ? 'Customer' : 'Agent';
                                            const tm = m.time ? new Date(m.time * 1000).toISOString().slice(11, 16) : '';
                                            return `[${tm}] ${role} (${m.author || 'Unknown'}): ${m.body}`;
                                        })
                                        .join('\n');
                                }
                                const s = val.trim();
                                if (s.startsWith('[') || s.startsWith('{')) {
                                    try {
                                        const msgs = JSON.parse(s);
                                        if (Array.isArray(msgs)) {
                                            return msgs
                                                .filter(m => m && m.body && String(m.body).trim())
                                                .map(m => {
                                                    const role = m.role === 'USER' ? 'Customer' : 'Agent';
                                                    const tm = m.time ? new Date(m.time * 1000).toISOString().slice(11, 16) : '';
                                                    return `[${tm}] ${role} (${m.author || 'Unknown'}): ${m.body}`;
                                                })
                                                .join('\n');
                                        }
                                    } catch { /* fall through */ }
                                }
                                return s;
                            };

                            const MAX_T_CHARS = 2400;
                            const transcriptBlock = top.map((s) => {
                                const r = s.row;
                                const text = transcriptToText(r.Transcript).slice(0, MAX_T_CHARS);
                                const date = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
                                const simLine = s.sim != null ? `\nSimilarity: ${(s.sim * 100).toFixed(1)}%` : '';
                                return `--- Conversation ID: ${r.conversation_id} ---
Date: ${date} | Country: ${r.country || '—'} | Channel: ${r.channel || '—'} | Agent: ${r.assignee_name || '—'}${simLine}

${text || '(empty transcript)'}`;
                            }).join('\n\n');

                            const coverage = mode === 'rag'
                                ? `Transcript retrieval (vector-ranked): ${top.length} of ${rows.length} transcripts used (out of ${convIds.length} conversations in this view).`
                                : `Transcript retrieval (most recent, not ranked — embeddings missing for this set): ${top.length} of ${rows.length} transcripts used (out of ${convIds.length} conversations in this view).`;

                            const systemPrompt = [
                                'You are Athena, a senior CX insights analyst for FundedNext (a prop trading firm).',
                                'Answer grounded in the provided real conversation transcripts. Do not invent facts.',
                                '',
                                'CITATIONS (strict):',
                                '- Always reference conversations by their full Conversation ID, formatted as `[CONV:<id>]`.',
                                '- Never use ordinal labels like "#1", "#2", "Conversation 1", "the first conversation", or similar placeholders.',
                                '- When listing multiple examples, write the full [CONV:<id>] for each one, separated by commas.',
                                '- Do not abbreviate, shorten, or omit any digits from the Conversation ID.',
                                '',
                                'FORMATTING (strict):',
                                '- Output Markdown with real newlines. Put a blank line between sections.',
                                '- Use short `## Heading` sections when the answer has multiple parts.',
                                '- Use `- ` bullets (one per line) or `1. ` numbered lists — NEVER inline multiple bullets on a single line.',
                                '- Emphasize key terms with **bold**. Keep paragraphs short (1-3 sentences).',
                                '- End with a short "## Actions" section listing 1-3 concrete next steps when relevant.',
                                '',
                                'Context label for this chat: ' + contextLabel,
                            ].join('\n');

                            const openaiBody = {
                                // Both default and power-user RAG paths use gpt-5.4-mini (the
                                // cheaper mini tier); full gpt-5.4 is selectable via the Athena picker.
                                model: RAG_MODEL,
                                temperature: 0.2,
                                max_completion_tokens: REPLY_TOKENS,
                                messages: [
                                    { role: 'system', content: systemPrompt },
                                    { role: 'system', content: coverage + '\n\n=== TRANSCRIPTS ===\n' + transcriptBlock + '\n=== END TRANSCRIPTS ===' },
                                    ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: normalizeContent(m.content) })),
                                ],
                            };
                            const aiResp = await httpsRequest('https://api.openai.com/v1/chat/completions', {
                                method: 'POST',
                                headers: {
                                    Authorization: `Bearer ${ATHENA_KEY}`,
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify(openaiBody),
                            });
                            if (aiResp.ok) {
                                const reply = (aiResp.data?.choices?.[0]?.message?.content || '').trim();
                                return res.status(200).json({
                                    success: true,
                                    reply,
                                    tokens: aiResp.data?.usage?.total_tokens || 0,
                                    mode,
                                    transcriptsUsed: top.length,
                                    transcriptsAvailable: rows.length,
                                    convCount: convIds.length,
                                });
                            }
                            // if chat call fails, fall through to metadata path below
                        }
                    }
                } catch (ragErr) {
                    // fall through to metadata-only path on any RAG failure
                    console.error('Athena RAG fallback:', ragErr && (ragErr.message || ragErr));
                }
            }

            // Normalize each item to concise plain fields to stay under token budget.
            const SAMPLE_LIMIT = 100;
            const norm = (it) => {
                if (!it || typeof it !== 'object') return null;
                const pick = (keys) => {
                    for (const k of keys) if (it[k] != null && it[k] !== '') return it[k];
                    return null;
                };
                const arr = v => Array.isArray(v) ? v.filter(Boolean).join(' | ') : (v || '');
                return {
                    id: pick(['conversation_id', 'Conversation ID', 'id']),
                    date: pick(['created_date_bd', 'Date', 'date']),
                    country: pick(['country', 'Country']),
                    product: pick(['product', 'Product Type', 'Product']),
                    main: arr(pick(['main_topic', 'Main-Topics', 'Main Category'])),
                    sub: arr(pick(['topic', 'Sub-Topics', 'Sub category'])),
                    sentiment: pick(['sentiment', 'Sentiment End', 'Sentiment Start']),
                    rating: pick(['Conversation rating', 'cx_score_rating']),
                    category: pick(['category', 'Concern regarding product (Catagory)']),
                    subCategory: pick(['Concern regarding product (Sub-catagory)']),
                    headline: pick(['headline']),
                    priority: pick(['priority']),
                    feedback_type: pick(['type', 'feedback_type']),
                    excerpt: (() => {
                        const t = pick(['fullText', 'client_quotes']);
                        return t ? String(t).slice(0, 220) : null;
                    })(),
                };
            };
            const sampleArr = items.slice(0, SAMPLE_LIMIT).map(norm).filter(Boolean);
            const dataSample = JSON.stringify(sampleArr);
            const sampleNote = items.length > SAMPLE_LIMIT
                ? `Showing first ${SAMPLE_LIMIT} of ${items.length} records.`
                : `Full set: ${items.length} records.`;

            const systemPrompt = [
                'You are Athena, a senior CX insights analyst for FundedNext (a prop trading firm).',
                'Answer concisely and accurately using ONLY the JSON data sample provided.',
                'Do not invent records, customers, or numbers. If the data is insufficient, say so.',
                '',
                'CITATIONS (strict):',
                '- When you reference a specific record, cite it with the full Intercom conversation id using the exact format `[CONV:<id>]` (e.g., `[CONV:215473883858879]`).',
                '- Use the `id` value from each JSON record — never invent, shorten, or prefix ids with "FB-", "#", or similar.',
                '- If an id is missing or blank, skip the citation rather than making one up.',
                '- For grouped examples write each as its own `[CONV:<id>]` pill, separated by commas.',
                '',
                'FORMATTING (strict):',
                '- Output Markdown with real newlines. Put a blank line between sections.',
                '- Use short `## Heading` sections when the answer has multiple parts.',
                '- Use `- ` bullets (one per line) or `1. ` numbered lists — NEVER inline multiple bullets on a single line.',
                '- Emphasize key terms with **bold**. Keep paragraphs short (1-3 sentences).',
                '- End with a short "## Actions" section listing 1-3 concrete next steps when relevant.',
                '',
                'Context label for this chat: ' + contextLabel,
            ].join('\n');

            const dataContent = [
                sampleNote,
                'Data (JSON array of normalized records):',
                dataSample,
            ].join('\n');

            const openaiBody = {
                model: 'gpt-5.4-mini',
                temperature: 0.2,
                max_completion_tokens: 700,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'system', content: dataContent },
                    ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: normalizeContent(m.content) })),
                ],
            };

            const aiResp = await httpsRequest('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${ATHENA_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(openaiBody),
            });
            if (!aiResp.ok) {
                return res.status(200).json({ success: false, error: `OpenAI ${aiResp.status}`, detail: typeof aiResp.data === 'string' ? aiResp.data.slice(0, 300) : (aiResp.data?.error?.message || null) });
            }
            const reply = (aiResp.data?.choices?.[0]?.message?.content || '').trim();
            return res.status(200).json({ success: true, reply, tokens: aiResp.data?.usage?.total_tokens || 0, sampled: sampleArr.length, total: items.length });
        }

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
                    'Main-Topics': cleanTopicList(aiResult?.main_category || []),
                    'Sub-Topics': cleanTopicList(aiResult?.sub_category || []),
                    'Sentiment Start': aiResult?.sentiment_start || null,
                    'Sentiment End': aiResult?.sentiment_end || null,
                    'Feedbacks': aiResult?.feedbacks || [],
                    'Was it in client\'s favor?': aiResult?.resolution_outcome || null,
                    'is_feedback': aiResult?.is_feedback ?? false,
                    'feedback_type': aiResult?.feedback_type || 'none',
                    'feedback_priority': aiResult?.feedback_priority || null,
                    'feedback_confidence': aiResult?.feedback_confidence || null,
                    'feedback_reason': aiResult?.feedback_reason || null,
                    'feedback_summary': aiResult?.feedback_summary || null,
                    'client_quotes': aiResult?.client_quotes || 'NOT_FOUND'
                }
            });
        }

        // ============ INTERCOM TOPIC CLASSIFICATION (full n8n v4.4 prompt) ============
        if (action === 'classify-topic') {
            if (!conversationId) {
                return res.status(400).json({ error: 'conversationId required' });
            }
            if (!process.env.OPENAI_API_KEY) {
                return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
            }

            try {
                // Load the full topic prompt
                const topicPromptPath = path.join(__dirname, 'topic-prompt.txt');
                const topicPromptTemplate = fs.readFileSync(topicPromptPath, 'utf8');

                // Get transcript from Supabase (already stored in Intercom Topic table)
                const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
                const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
                let transcript = null;

                if (supabaseUrl && supabaseKey) {
                    const { createClient } = require('@supabase/supabase-js');
                    const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
                    const { data: row } = await sb.from('Intercom Topic').select('"Transcript"').eq('"Conversation ID"', conversationId).limit(1);
                    if (row && row[0]) transcript = row[0].Transcript;
                }

                // If no transcript in DB, fetch from Intercom
                if (!transcript) {
                    const convResp = await fetchIntercom(`/conversations/${conversationId}?display_as=plaintext`);
                    if (!convResp.ok) {
                        return res.status(200).json({ success: false, error: `Intercom ${convResp.status}` });
                    }
                    transcript = extractTranscript(convResp.data);
                }

                if (!transcript || transcript.trim().length < 10) {
                    return res.status(200).json({ success: false, error: 'No transcript available' });
                }

                // Build prompt with transcript
                const fullPrompt = topicPromptTemplate.replace('{TRANSCRIPT}', transcript);

                // Call OpenAI
                const aiResp = await httpsRequest('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'gpt-5.4-mini',
                        messages: [
                            { role: 'system', content: 'You are a support ticket categorization AI for a prop trading firm. Respond with valid JSON only.' },
                            { role: 'user', content: fullPrompt }
                        ],
                        temperature: 0,
                        max_completion_tokens: 800
                    })
                });

                if (!aiResp.ok) {
                    const quota = aiResp.status === 429 && (aiResp.data?.error?.code === 'insufficient_quota' || /quota/i.test(aiResp.data?.error?.message || ''));
                    return res.status(200).json({ success: false, quotaExceeded: quota, error: quota ? 'OpenAI quota exceeded — add credits at platform.openai.com/billing' : `OpenAI ${aiResp.status}` });
                }

                const content = aiResp.data.choices?.[0]?.message?.content || '';
                let parsed;
                try {
                    let jsonStr = content.trim().replace(/^```json\s*/, '').replace(/```$/, '');
                    parsed = JSON.parse(jsonStr);
                } catch (e) {
                    return res.status(200).json({ success: false, error: 'Failed to parse AI response', raw: content.substring(0, 500) });
                }

                const resultData = {
                    'Main-Topics': cleanTopicList(parsed['Main Category'] || []),
                    'Sub-Topics': cleanTopicList(parsed['Sub category'] || []),
                    'Sentiment Start': parsed['Customer sentiment']?.beginning || null,
                    'Sentiment End': parsed['Customer sentiment']?.end || null,
                    'Feedbacks': (parsed['Suggestions & feedback'] || []).join('\n'),
                    'is_feedback': parsed.is_feedback ?? false,
                    'feedback_type': parsed.feedback_type || 'none',
                    'feedback_priority': parsed.feedback_priority || null,
                    'feedback_confidence': parsed.feedback_confidence ?? null,
                    'feedback_reason': parsed.feedback_reason || null,
                    'feedback_summary': parsed.feedback_summary || null,
                    'feedback_sentiment': parsed.feedback_sentiment || null,
                    'client_quotes': parsed.client_quotes || null,
                    "Was it in client's favor?": parsed['Resolution outcome'] || null
                };

                // Save results back to Supabase.
                // Gracefully handle the case where `feedback_sentiment` column
                // doesn't exist yet — retry without the new field.
                if (supabaseUrl && supabaseKey) {
                    const { createClient } = require('@supabase/supabase-js');
                    const sbWrite = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
                    const attempt = await sbWrite.from('Intercom Topic')
                        .update(resultData)
                        .eq('"Conversation ID"', conversationId);
                    if (attempt?.error && /feedback_sentiment/i.test(attempt.error.message || '')) {
                        const { feedback_sentiment, ...safe } = resultData;
                        await sbWrite.from('Intercom Topic').update(safe).eq('"Conversation ID"', conversationId);
                    }
                }

                return res.status(200).json({
                    success: true,
                    data: resultData,
                    tokens: aiResp.data.usage?.total_tokens || 0
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'classify-topic failed: ' + (e.message || String(e)) });
            }
        }

        // Action: server-side BATCH topic classification (automatable — mirrors the browser analyzer but
        // runs on the server with a concurrency pool, so the daily-sync GitHub Action can loop it until
        // remaining=0, no browser needed). Same filter/prompt/mapping as classify-topic.
        if (action === 'topic-analyze-batch') {
            if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
            const tFrom = dateFrom || '2026-01-01';
            const tTo = dateTo || tFrom;
            const batchSize = Math.min((body && body.batchSize) || 50, 200);
            const CONC = 20; // concurrent OpenAI calls in flight
            try {
                const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
                const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
                if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' });
                const { createClient } = require('@supabase/supabase-js');
                const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
                const topicPromptTemplate = fs.readFileSync(path.join(__dirname, 'topic-prompt.txt'), 'utf8');

                // unanalyzed = Sub-Topics null/[] AND has transcript, CFD/Futures, within date range
                const unanalyzed = (q) => q
                    .in('Product', ['CFD', 'Futures'])
                    .gte('created_date_bd', tFrom).lte('created_date_bd', tTo)
                    .or('"Sub-Topics".is.null,"Sub-Topics".eq.[]')
                    .not('Transcript', 'is', null).neq('Transcript', '');

                const { count: totalRemaining } = await unanalyzed(
                    sb.from('Intercom Topic').select('"Conversation ID"', { count: 'exact', head: true })
                );
                const { data: rows, error: fErr } = await unanalyzed(
                    sb.from('Intercom Topic').select('"Conversation ID", "Transcript"')
                ).order('created_at', { ascending: true }).limit(batchSize);
                if (fErr) return res.status(200).json({ success: false, error: fErr.message });
                if (!rows || rows.length === 0) return res.status(200).json({ success: true, analyzed: 0, errors: 0, remaining: 0 });

                let analyzed = 0, errors = 0, idx = 0, quotaExceeded = false;
                const classifyRow = async (row) => {
                    const convId = row['Conversation ID'];
                    const transcript = row['Transcript'];
                    if (!transcript || String(transcript).trim().length < 10) { errors++; return; }
                    const fullPrompt = topicPromptTemplate.replace('{TRANSCRIPT}', transcript);
                    let aiResp = null;
                    for (let attempt = 0; attempt < 2; attempt++) {
                        try {
                            aiResp = await httpsRequest('https://api.openai.com/v1/chat/completions', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    model: 'gpt-5.4-mini',
                                    messages: [
                                        { role: 'system', content: 'You are a support ticket categorization AI for a prop trading firm. Respond with valid JSON only.' },
                                        { role: 'user', content: fullPrompt }
                                    ],
                                    temperature: 0,
                                    max_completion_tokens: 800
                                })
                            });
                        } catch { aiResp = null; }
                        if (aiResp && aiResp.ok) break;
                    }
                    if (!aiResp || !aiResp.ok) {
                        if (aiResp && aiResp.status === 429 && (aiResp.data?.error?.code === 'insufficient_quota' || /quota/i.test(aiResp.data?.error?.message || ''))) quotaExceeded = true;
                        errors++; return;
                    }
                    let parsed;
                    try {
                        const content = aiResp.data.choices?.[0]?.message?.content || '';
                        parsed = JSON.parse(content.trim().replace(/^```json\s*/, '').replace(/```$/, ''));
                    } catch { errors++; return; }
                    const resultData = {
                        'Main-Topics': cleanTopicList(parsed['Main Category'] || []),
                        'Sub-Topics': cleanTopicList(parsed['Sub category'] || []),
                        'Sentiment Start': parsed['Customer sentiment']?.beginning || null,
                        'Sentiment End': parsed['Customer sentiment']?.end || null,
                        'Feedbacks': (parsed['Suggestions & feedback'] || []).join('\n'),
                        'is_feedback': parsed.is_feedback ?? false,
                        'feedback_type': parsed.feedback_type || 'none',
                        'feedback_priority': parsed.feedback_priority || null,
                        'feedback_confidence': parsed.feedback_confidence ?? null,
                        'feedback_reason': parsed.feedback_reason || null,
                        'feedback_summary': parsed.feedback_summary || null,
                        'feedback_sentiment': parsed.feedback_sentiment || null,
                        'client_quotes': parsed.client_quotes || null,
                        "Was it in client's favor?": parsed['Resolution outcome'] || null
                    };
                    const attempt = await sb.from('Intercom Topic').update(resultData).eq('"Conversation ID"', convId);
                    if (attempt?.error && /feedback_sentiment/i.test(attempt.error.message || '')) {
                        const { feedback_sentiment, ...safe } = resultData;
                        await sb.from('Intercom Topic').update(safe).eq('"Conversation ID"', convId);
                    }
                    analyzed++;
                };
                const worker = async () => { while (idx < rows.length && !quotaExceeded) { await classifyRow(rows[idx++]); } };
                await Promise.all(Array.from({ length: Math.min(CONC, rows.length) }, () => worker()));

                return res.status(200).json({
                    success: true, analyzed, errors, quotaExceeded,
                    error: quotaExceeded ? 'OpenAI quota exceeded — add credits at platform.openai.com/billing' : undefined,
                    remaining: Math.max(0, (totalRemaining || 0) - analyzed)
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'topic-analyze-batch failed: ' + (e.message || String(e)) });
            }
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

            // 7. Two-pass classification: GPT-5.4-mini first, retry "None" with GPT-5.4-mini
            const callAI = async (model) => {
                return httpsRequest('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'system', content: systemPrompt }],
                        temperature: 0,
                        max_completion_tokens: 200
                    })
                });
            };

            // Pass 1: GPT-5.4-mini
            const aiResponse1 = await callAI('gpt-5.4-mini');
            if (!aiResponse1.ok) {
                const quota = aiResponse1.status === 429 && (aiResponse1.data?.error?.code === 'insufficient_quota' || /quota/i.test(aiResponse1.data?.error?.message || ''));
                return res.status(200).json({ success: false, quotaExceeded: quota, error: quota ? 'OpenAI quota exceeded — add credits at platform.openai.com/billing' : 'AI call failed (pass 1)', conversationId });
            }
            let subCategory = (aiResponse1.data.choices?.[0]?.message?.content || '').trim();
            let model = 'gpt-5.4-mini';
            let passes = 1;

            // Pass 2: If pass 1 returned "None", retry with GPT-5.4-mini
            if (!subCategory || subCategory === 'None' || subCategory.toLowerCase() === 'none') {
                const aiResponse2 = await callAI('gpt-5.4-mini');
                if (aiResponse2.ok) {
                    subCategory = (aiResponse2.data.choices?.[0]?.message?.content || '').trim();
                    model = 'gpt-5.4-mini';
                    passes = 2;
                }
            }

            const finalSub = (subCategory === 'None' || !subCategory) ? null : subCategory;
            return res.status(200).json({
                success: true,
                conversationId,
                subCategory: finalSub,
                mainCategory: lookupMainCategory(finalSub),
                model,
                passes
            });
        }

        // ============ CSAT BATCH: Submit OpenAI Batch for bulk classification (50% cheaper) ============
        if (action === 'csat-batch-submit') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            if (!process.env.OPENAI_API_KEY) return res.status(200).json({ success: false, error: 'OPENAI_API_KEY not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
            const batchSize = (body && body.batchSize) || 100;
            const batchModel = (body && body.model) || 'gpt-5.4-mini'; // both passes use gpt-5.4-mini

            try {
                // Get conversations needing classification (have rating but no sub-category)
                const { data: pending, error: fetchErr } = await sb
                    .from('CSAT New')
                    .select('"Conversation ID", "Conversation rating"')
                    .not('Conversation rating', 'is', null)
                    .is('Concern regarding product (Sub-catagory)', null)
                    .limit(batchSize);
                if (fetchErr) return res.status(200).json({ success: false, error: fetchErr.message });
                if (!pending || pending.length === 0) return res.status(200).json({ success: true, submitted: 0, message: 'No pending conversations' });

                // Load CSAT prompt
                let csatPromptTemplate;
                try { csatPromptTemplate = fs.readFileSync(path.join(__dirname, 'csat-prompt.txt'), 'utf8'); } catch (e) { return res.status(200).json({ success: false, error: 'csat-prompt.txt not found' }); }

                // Fetch transcripts from Intercom and build batch JSONL
                const lines = [];
                let fetched = 0;
                for (const row of pending) {
                    const convId = String(row['Conversation ID']);
                    const convResp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
                    if (!convResp.ok) continue;
                    const transcript = extractTranscript(convResp.data);
                    if (!transcript || transcript === '[EMPTY]') continue;

                    const ratingObj = convResp.data.conversation_rating || null;
                    let fullTranscript = transcript;
                    if (ratingObj?.remark || ratingObj?.rating != null) {
                        fullTranscript += '\n---';
                        if (ratingObj.rating != null) fullTranscript += `\nConversation Rating: ${ratingObj.rating}`;
                        if (ratingObj.remark) fullTranscript += `\nRemark: ${ratingObj.remark}`;
                    }

                    const systemPrompt = csatPromptTemplate
                        .replace('{{ $json.ExtractedTranscript }}', fullTranscript)
                        .replace('{{ $json.ConversationRatingRemark }}', ratingObj?.remark || '');

                    lines.push(JSON.stringify({
                        custom_id: convId,
                        method: 'POST',
                        url: '/v1/chat/completions',
                        body: {
                            model: batchModel,
                            messages: [{ role: 'system', content: systemPrompt }],
                            temperature: 0,
                            max_completion_tokens: 200
                        }
                    }));
                    fetched++;
                }

                if (lines.length === 0) return res.status(200).json({ success: true, submitted: 0, message: 'No valid transcripts found' });

                // Upload JSONL file to OpenAI
                const boundary = '----BatchBoundary' + Date.now();
                const jsonlContent = lines.join('\n');
                const fileBody = `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="csat-batch.jsonl"\r\nContent-Type: application/jsonl\r\n\r\n${jsonlContent}\r\n--${boundary}--\r\n`;

                const uploadResp = await httpsRequest('https://api.openai.com/v1/files', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': `multipart/form-data; boundary=${boundary}`
                    },
                    body: fileBody
                });
                if (!uploadResp.ok) return res.status(200).json({ success: false, error: 'File upload failed', details: uploadResp.data });
                const fileId = uploadResp.data.id;

                // Create batch
                const batchResp = await httpsRequest('https://api.openai.com/v1/batches', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        input_file_id: fileId,
                        endpoint: '/v1/chat/completions',
                        completion_window: '24h'
                    })
                });
                if (!batchResp.ok) return res.status(200).json({ success: false, error: 'Batch creation failed', details: batchResp.data });

                return res.status(200).json({
                    success: true,
                    batchId: batchResp.data.id,
                    fileId,
                    submitted: lines.length,
                    status: batchResp.data.status
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'csat-batch-submit: ' + (e.message || String(e)) });
            }
        }

        // ============ CSAT BATCH: Poll batch status ============
        if (action === 'csat-batch-poll') {
            const { batchId } = body || {};
            if (!batchId) return res.status(400).json({ error: 'batchId required' });
            try {
                const resp = await httpsRequest(`https://api.openai.com/v1/batches/${batchId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                });
                if (!resp.ok) return res.status(200).json({ success: false, error: `Poll failed: ${resp.status}` });
                return res.status(200).json({ success: true, status: resp.data.status, batch: resp.data });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'csat-batch-poll: ' + (e.message || String(e)) });
            }
        }

        // ============ CSAT BATCH: Process completed batch results ============
        if (action === 'csat-batch-process') {
            const { batchId } = body || {};
            if (!batchId) return res.status(400).json({ error: 'batchId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            try {
                // Get batch details
                const batchResp = await httpsRequest(`https://api.openai.com/v1/batches/${batchId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                });
                if (!batchResp.ok || batchResp.data.status !== 'completed') {
                    return res.status(200).json({ success: false, error: `Batch not completed: ${batchResp.data?.status}` });
                }
                const outputFileId = batchResp.data.output_file_id;
                if (!outputFileId) return res.status(200).json({ success: false, error: 'No output file' });

                // Download results
                const fileResp = await httpsRequest(`https://api.openai.com/v1/files/${outputFileId}/content`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                });
                if (!fileResp.ok) return res.status(200).json({ success: false, error: 'Failed to download results' });

                // Parse JSONL results and update Supabase
                const resultText = typeof fileResp.data === 'string' ? fileResp.data : JSON.stringify(fileResp.data);
                const resultLines = resultText.split('\n').filter(l => l.trim());
                let updated = 0, errors = 0;
                const noneConvIds = []; // Track "None" results for pass 2

                for (const line of resultLines) {
                    try {
                        const result = JSON.parse(line);
                        const convId = result.custom_id;
                        const content = result.response?.body?.choices?.[0]?.message?.content?.trim();
                        if (!convId || !content) { errors++; continue; }

                        if (content === 'None' || content.toLowerCase() === 'none') {
                            // Don't write None — save for pass 2 retry
                            noneConvIds.push(convId);
                            continue;
                        }

                        const mainCategory = lookupMainCategory(content);
                        const updatePayload = { 'Concern regarding product (Sub-catagory)': content };
                        if (mainCategory) updatePayload['Concern regarding product (Catagory)'] = mainCategory;
                        const { error: updErr } = await sb
                            .from('CSAT New')
                            .update(updatePayload)
                            .eq('Conversation ID', parseInt(convId));
                        if (updErr) { errors++; continue; }
                        updated++;
                    } catch (e) { errors++; }
                }

                return res.status(200).json({
                    success: true,
                    totalResults: resultLines.length,
                    updated,
                    errors,
                    noneCount: noneConvIds.length,
                    noneConvIds: noneConvIds.slice(0, 50),
                    batchId,
                    message: noneConvIds.length > 0
                        ? `${updated} classified by mini. ${noneConvIds.length} returned "None" — run csat-batch-submit again to re-process these with GPT-5.4-mini.`
                        : `${updated} classified successfully.`
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'csat-batch-process: ' + (e.message || String(e)) });
            }
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
            const structuredTranscript = extractStructuredTranscript(conv);

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
                    'StructuredTranscript': structuredTranscript,
                    'Country': country,
                    'Region': region,
                    'Main-Topics': [],
                    'Sub-Topics': [],
                    'Sentiment Start': null,
                    'Sentiment End': null,
                    'Feedbacks': [],
                    'Was it in client\'s favor?': null,
                    'is_feedback': false,
                    'feedback_type': 'none',
                    'feedback_priority': null,
                    'feedback_confidence': null,
                    'feedback_reason': null,
                    'feedback_summary': null,
                    'client_quotes': 'NOT_FOUND'
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


        // ============ CA: Enqueue Conversation Actions dataset export ============
        if (action === 'ca-enqueue') {
            const caFrom = dateFrom || '2026-01-01';
            const caTo = dateTo || '2026-03-25';
            try {
                const dsResp = await fetchIntercom('/export/reporting_data/get_datasets');
                if (!dsResp.ok) return res.status(200).json({ success: false, error: `get_datasets: ${dsResp.status}` });
                const rawDs = dsResp.data?.data ?? dsResp.data ?? [];
                const datasets = Array.isArray(rawDs) ? rawDs : [rawDs];
                const caDs = datasets.find(d => d.id === 'consolidated_conversation_part') || datasets.find(d => (d.name && d.name.toLowerCase().includes('conversation action')));
                const datasetId = caDs?.id || 'consolidated_conversation_part';
                let attrIds = [];
                if (caDs?.attributes && Array.isArray(caDs.attributes)) attrIds = caDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a));
                if (attrIds.length === 0) attrIds = ['conversation_id','action_id','conversation_started_at','action_time','channel','last_teammate_rating','conversation_tags','started_by','state','action_type','action_performed_by','action_performed_by_id','teammate_assigned','teammate_assigned_id','teammate_subsequent_response_time_seconds'];
                const DHAKA_OFFSET = 6 * 3600;
                const fp = caFrom.split('-').map(Number);
                const tp = caTo.split('-').map(Number);
                const fromTs = Math.floor(Date.UTC(fp[0], fp[1]-1, fp[2]) / 1000) - DHAKA_OFFSET;
                const toTs = Math.floor(Date.UTC(tp[0], tp[1]-1, tp[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;
                const enqResp = await fetchIntercom('/export/reporting_data/enqueue', { method: 'POST', body: JSON.stringify({ start_time: fromTs, end_time: toTs, dataset_id: datasetId, attribute_ids: attrIds }) });
                if (!enqResp.ok) return res.status(200).json({ success: false, error: `enqueue: ${enqResp.status} ${JSON.stringify(enqResp.data)}` });
                const jobId = enqResp.data?.job_identifier ?? enqResp.data?.job_id ?? enqResp.data?.id;
                if (!jobId) return res.status(200).json({ success: false, error: 'Missing job_identifier', raw: enqResp.data });
                return res.status(200).json({ success: true, jobId, status: enqResp.data?.status || 'pending' });
            } catch (e) { return res.status(200).json({ success: false, error: 'ca-enqueue: ' + (e.message || String(e)) }); }
        }

        // ============ CA: Poll job status ============
        if (action === 'ca-poll') {
            const { jobId } = req.body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            try {
                const resp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!resp.ok) return res.status(200).json({ success: false, error: `Poll: ${resp.status}` });
                return res.status(200).json({ success: true, status: resp.data?.status || 'unknown' });
            } catch (e) { return res.status(200).json({ success: false, error: 'ca-poll: ' + (e.message || String(e)) }); }
        }

        // ============ CA: Download CSV, filter agent-only, import to Conversation Actions ============
        if (action === 'ca-download-import') {
            const { jobId } = req.body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sbCA = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            function mapCAHeader(h) {
                const raw = h.trim();
                const stripped = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
                const lower = stripped.toLowerCase();
                const MAP = { 'conversation id':'conversation_id','conversation started at':'conversation_started_at','channel':'channel','last teammate rating':'last_teammate_rating','conversation tag':'conversation_tags','conversation tags':'conversation_tags','started by':'started_by','action time':'action_time','action performed by':'action_performed_by','teammate assigned':'teammate_assigned','teammate assigned when action performed':'teammate_assigned_id','action id':'action_id','action type':'action_type','action performed by automation':'action_performed_by_id','teammate subsequent response time (seconds)':'teammate_subsequent_response_time_seconds','state':'state' };
                if (MAP[lower]) return MAP[lower];
                const SNAKE = { 'conversation_id':'conversation_id','action_id':'action_id','conversation_started_at':'conversation_started_at','action_time':'action_time','channel':'channel','last_teammate_rating':'last_teammate_rating','state':'state','action_type':'action_type','action_performed_by_teammate_id':'action_performed_by','action_teammate_assignee_id':'teammate_assigned','teammate_assignee_at_action_time':'teammate_assigned_id','teammate_subsequent_response_time':'teammate_subsequent_response_time_seconds','action_by_automation':'action_performed_by_id','conversation_started_by':'started_by','conversation_tag_ids':'conversation_tags','action_performed_by':'action_performed_by','teammate_assigned':'teammate_assigned','teammate_assigned_id':'teammate_assigned_id','started_by':'started_by','conversation_tags':'conversation_tags','teammate_subsequent_response_time_seconds':'teammate_subsequent_response_time_seconds' };
                if (SNAKE[raw]) return SNAKE[raw];
                if (SNAKE[lower]) return SNAKE[lower];
                return null;
            }
            const DHAKA_CA = 6*3600*1000;
            const AI_EXCLUDE = ['fundednext ai','fin ai','fin'];
            const TS_COLS = new Set(['conversation_started_at','action_time']);
            const INT_COLS = new Set(['teammate_subsequent_response_time_seconds']);

            function parseCSV(text) {
                const rows=[]; let row=[],field='',inQ=false;
                for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(inQ&&i+1<text.length&&text[i+1]==='"'){field+='"';i++}else inQ=!inQ}else if(c===','&&!inQ){row.push(field.trim());field=''}else if(c==='\n'&&!inQ){row.push(field.trim());if(row.some(f=>f!==''))rows.push(row);row=[];field=''}else if(c==='\r'&&!inQ){}else field+=c}
                row.push(field.trim());if(row.some(f=>f!==''))rows.push(row);return rows;
            }
            function httpsBin(url,opts={}){return new Promise((resolve,reject)=>{const u=new URL(url);const o={hostname:u.hostname,path:u.pathname+u.search,method:opts.method||'GET',headers:opts.headers||{}};const r=https.request(o,res2=>{if(res2.statusCode>=300&&res2.statusCode<400&&res2.headers.location)return httpsBin(res2.headers.location,opts).then(resolve).catch(reject);const ch=[];res2.on('data',c=>ch.push(c));res2.on('end',()=>resolve({ok:res2.statusCode>=200&&res2.statusCode<300,status:res2.statusCode,buffer:Buffer.concat(ch)}))});r.on('error',reject);r.end()})}

            try {
                const dlResp = await httpsBin(`https://api.intercom.io/download/reporting_data/${jobId}`, { headers: { 'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, 'Accept': 'application/octet-stream', 'Intercom-Version': '2.14' } });
                if (!dlResp.ok) return res.status(200).json({ success: false, error: `Download: ${dlResp.status}` });
                let buf = dlResp.buffer;
                if (buf[0]===0x1f&&buf[1]===0x8b) buf = zlib.gunzipSync(buf);
                const allRows = parseCSV(buf.toString('utf8'));
                if (allRows.length<2) return res.status(200).json({ success: true, imported: 0, totalCsvRows: 0 });
                const headers = allRows[0];
                const colMap = headers.map(h => mapCAHeader(h));
                const perfIdx = colMap.indexOf('action_performed_by');
                const autoIdx = colMap.indexOf('action_performed_by_id');
                const rows = [];
                for (let i=1;i<allRows.length;i++) {
                    const csvRow = allRows[i];
                    if (autoIdx>=0 && (csvRow[autoIdx]||'').trim().toLowerCase()==='true') continue;
                    if (perfIdx>=0) { const p=(csvRow[perfIdx]||'').trim().toLowerCase(); if(AI_EXCLUDE.some(n=>p.includes(n))) continue; if(!p&&autoIdx<0) continue; }
                    const rec = {};
                    for(let c=0;c<headers.length;c++){const db=colMap[c];if(!db)continue;let v=csvRow[c]??'';if(v==='')v=null;if(v&&TS_COLS.has(db)){const d=new Date(v);if(!isNaN(d.getTime()))v=new Date(d.getTime()+DHAKA_CA).toISOString().replace('Z','+06:00')}if(v&&INT_COLS.has(db)){const n=parseInt(v,10);v=isNaN(n)?null:n}rec[db]=v}
                    if(Object.keys(rec).length>0){rec.synced_at=new Date(Date.now()+DHAKA_CA).toISOString().replace('Z','+06:00');rows.push(rec)}
                }
                let imported=0;
                for(let s=0;s<rows.length;s+=1000){const chunk=rows.slice(s,s+1000);const{error:insErr}=await sbCA.from('Conversation Actions').insert(chunk);if(insErr)return res.status(200).json({success:false,error:'Insert: '+insErr.message,imported});imported+=chunk.length}
                return res.status(200).json({ success: true, imported, totalCsvRows: allRows.length-1 });
            } catch (e) { return res.status(200).json({ success: false, error: 'ca-download-import: ' + (e.message || String(e)) }); }
        }

        // --- Conversation Dataset: 3-step flow for "Service Performance Overview" table ---

        // Step 1: Enqueue Conversation Actions dataset export.
        // (Switched from "conversations" → "consolidated_conversation_part" so we get
        // teammate_assigned per action — the field we filter on for live-chat agents.)
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
                const convDs = datasets.find(d => d.id === 'consolidated_conversation_part')
                    || datasets.find(d => (d.name && d.name.toLowerCase().includes('conversation action')));
                const datasetId = convDs?.id || 'consolidated_conversation_part';
                let attributeIds = [];
                if (convDs?.attributes && Array.isArray(convDs.attributes)) {
                    attributeIds = convDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a));
                }
                if (attributeIds.length === 0) {
                    attributeIds = ['conversation_id','action_id','conversation_started_at','action_time','channel','last_teammate_rating','conversation_tags','started_by','state','action_type','action_performed_by','action_performed_by_id','teammate_assigned','teammate_assigned_id','teammate_subsequent_response_time_seconds'];
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

            // Conversation Actions dataset (consolidated_conversation_part) → SPO columns.
            // The dataset gives admin IDs only — no name column for the agent. We resolve
            // names via Intercom /admins downstream. Two ID fields matter here:
            //   action_teammate_assignee_id — assignee at this action's time (used for filter)
            //   currently_assigned_teammate_id — final assignee (used for storage fallback)
            function mapCDHeader(h) {
                const raw = h.trim();
                const stripped = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
                const lower = stripped.toLowerCase();
                const MAP = {
                    'conversation id': 'conversation_id',
                    'conversation started at': 'created_at',
                    'action time': 'action_time',
                    'channel': 'channel',
                    'state': 'state',
                    'current conversation state': 'state',
                    'last teammate rating': 'csat_rating',
                    'conversation tag': 'tags',
                    'conversation tags': 'tags',
                    'currently assigned teammate id': 'current_assignee_id',
                    'currently assigned team id': 'team_id',
                    'action teammate assignee id': 'action_assignee_id',
                    'teammate assignee at action time': 'action_assignee_id',
                    'teammate assigned id': 'action_assignee_id',
                    'action performed by teammate id': 'action_performed_by_id',
                    'action performed by id': 'action_performed_by_id',
                    'action type': 'action_type',
                    'user_location_country_code': 'country',
                };
                if (MAP[lower]) return MAP[lower];
                const SNAKE = {
                    'conversation_id': 'conversation_id',
                    'conversation_started_at': 'created_at',
                    'action_time': 'action_time',
                    'channel': 'channel',
                    'state': 'state',
                    'current_conversation_state': 'state',
                    'last_teammate_rating': 'csat_rating',
                    'conversation_tag_ids': 'tags',
                    'conversation_tags': 'tags',
                    'currently_assigned_teammate_id': 'current_assignee_id',
                    'currently_assigned_team_id': 'team_id',
                    'action_teammate_assignee_id': 'action_assignee_id',
                    'teammate_assignee_at_action_time': 'action_assignee_id',
                    'teammate_assigned_id': 'action_assignee_id',
                    'action_performed_by_teammate_id': 'action_performed_by_id',
                    'action_performed_by_id': 'action_performed_by_id',
                    'action_type': 'action_type',
                    'user_location_country_code': 'country',
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

            // Local binary download with redirect support
            function cdHttpsBinary(url, opts = {}) {
                return new Promise((resolve, reject) => {
                    const urlObj = new URL(url);
                    const reqOpts = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: opts.method || 'GET', headers: opts.headers || {} };
                    const req2 = https.request(reqOpts, (res2) => {
                        if (res2.statusCode >= 300 && res2.statusCode < 400 && res2.headers.location) {
                            return cdHttpsBinary(res2.headers.location, opts).then(resolve).catch(reject);
                        }
                        const chunks = [];
                        res2.on('data', chunk => chunks.push(chunk));
                        res2.on('end', () => resolve({ ok: res2.statusCode >= 200 && res2.statusCode < 300, status: res2.statusCode, buffer: Buffer.concat(chunks) }));
                    });
                    req2.on('error', reject);
                    req2.end();
                });
            }

            try {
                const downloadUrl = `https://api.intercom.io/download/reporting_data/${jobId}`;
                const dlResp = await cdHttpsBinary(downloadUrl, {
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
                const ALLOWED_CHANNELS = new Set(['Chat', 'Facebook', 'Instagram']);

                // Walk every action row. Keep rows where:
                //   1. channel is Chat/Facebook/Instagram
                //   2. action_type contains "reply" (covers compound types like "Reply, Assignment")
                //   3. action_performed_by is a teammate (non-empty)
                // For each (conversation_id, performer) pair keep the latest action_time row,
                // so each agent who participated in a shared conversation gets their own SPO row.
                // Matches Intercom's "Conversations participated" metric at agent level.
                const byConvAgent = new Map(); // `${conversation_id}|${performerId}` -> { record, actionTimeMs }
                const channelCounts = {};
                let actionRowsFiltered = 0;
                let rowsMissingConvId = 0;
                let rowsRejectedChannel = 0;
                let rowsRejectedActionType = 0;
                let rowsMissingAssigneeId = 0;
                for (let i = 1; i < allRows.length; i++) {
                    const csvRow = allRows[i];
                    const record = {};
                    for (let c = 0; c < headers.length; c++) {
                        const dbCol = colMap[c];
                        if (!dbCol) continue;
                        let val = csvRow[c] ?? '';
                        if (typeof val === 'string') val = val.trim();
                        if (val === '') val = null;
                        if (val === null) continue;
                        if (TIMESTAMP_COLS.has(dbCol)) val = toGMT6(val);
                        if (INTEGER_COLS.has(dbCol)) { const n = parseInt(val, 10); val = isNaN(n) ? null : n; }
                        if (BOOLEAN_COLS.has(dbCol)) val = val === 'true' || val === '1' || val === true;
                        record[dbCol] = val;
                    }
                    if (!record.conversation_id) { rowsMissingConvId++; continue; }
                    const ch = record.channel ? String(record.channel) : '';
                    channelCounts[ch || 'NULL'] = (channelCounts[ch || 'NULL'] || 0) + 1;
                    const chLower = ch.toLowerCase();
                    if (!(chLower === 'chat' || chLower === 'facebook' || chLower === 'instagram')) {
                        rowsRejectedChannel++;
                        continue;
                    }
                    // As of ~2026-07 the consolidated_conversation_part export returns ONE
                    // consolidated row per conversation (action_type "Close"/"Note"/"Assignment"),
                    // with no per-"Reply" rows and every human-teammate field blank — so we can no
                    // longer identify serving agents from this export. Import ONE stub per
                    // conversation (dedup by conversation_id, keep the latest action row); spo-enrich
                    // then re-fetches the full conversation from the REST API and builds the correct
                    // per-agent rows. Conversations with no human reply are removed during enrichment,
                    // so SPO stays human-served only.
                    actionRowsFiltered++;
                    const performerId = null;
                    const actionTimeMs = record.action_time ? new Date(record.action_time).getTime() : 0;
                    const dedupKey = String(record.conversation_id);
                    const existing = byConvAgent.get(dedupKey);
                    if (!existing || actionTimeMs > existing.actionTimeMs) {
                        byConvAgent.set(dedupKey, { record, actionTimeMs, performerId });
                    }
                }

                // Keep these 5 fields from CSV: conversation_id, created_at, channel, country, team_id.
                // created_at is required — the Performance Overview dashboard filters by it,
                // so dropping it here made every imported row invisible to the date filter.
                const SPO_COLUMNS = new Set([
                    'conversation_id', 'created_at', 'channel', 'country', 'team_id'
                ]);
                const spoRows = [];
                for (const { record, performerId } of byConvAgent.values()) {
                    const out = { synced_at: nowGMT6() };
                    for (const [k, v] of Object.entries(record)) {
                        if (SPO_COLUMNS.has(k)) out[k] = v;
                    }
                    // Intercom's CSV returns admin display names (not numeric IDs) in
                    // *_teammate_id columns, so `performerId` is actually the agent name.
                    // Store it in assignee_name so the dashboard can attribute per agent.
                    if (performerId) out.assignee_name = performerId;
                    spoRows.push(out);
                }

                // Dedup against existing SPO so re-runs don't double-insert.
                let movedToSpo = 0;
                const moveErrors = [];
                // No dedup against existing SPO — every conversation that participated on the
                // sync date gets its own row, including carry-overs that already exist in SPO
                // under different created_at dates. Re-running the same sync without clearing
                // first will produce duplicate rows; clear the target date range before re-syncs.
                if (spoRows.length > 0) {
                    const BATCH = 1000;
                    for (let s = 0; s < spoRows.length; s += BATCH) {
                        const chunk = spoRows.slice(s, s + BATCH);
                        const { error: spoInsErr } = await supabase.from('Service Performance Overview').insert(chunk);
                        if (spoInsErr) { moveErrors.push('SPO insert: ' + spoInsErr.message); break; }
                        movedToSpo += chunk.length;
                    }
                }

                const unmappedHeaders = headers.filter((h, i) => !colMap[i]);
                const mappedDetail = headers.map((h, i) => colMap[i] ? `${h} → ${colMap[i]}` : null).filter(Boolean);
                const sampleRow = allRows.length > 1 ? Object.fromEntries(headers.map((h, i) => [h, allRows[1][i] ?? ''])) : {};

                return res.status(200).json({
                    success: true,
                    totalCsvRows: allRows.length - 1,
                    actionRowsFiltered,
                    distinctConvAgentPairs: spoRows.length,
                    imported: movedToSpo,
                    movedToSpo,
                    moveErrors: moveErrors.length > 0 ? moveErrors : undefined,
                    diagnostics: {
                        rowsMissingConvId,
                        rowsRejectedChannel,
                        rowsRejectedActionType,
                        rowsMissingAssigneeId,
                        channelCounts,
                    },
                    jobId, csvHeaders: headers, mappedColumns: mappedCount, unmappedHeaders, mappedDetail, sampleRow
                });
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

        // ============ TICKETS DATASET → ticket_logs: Enqueue export ============
        if (action === 'tickets-dataset-enqueue') {
            const tdDateFrom = (body && body.dateFrom) || '2025-06-01';
            const tdDateTo = (body && body.dateTo) || new Date().toISOString().split('T')[0];
            try {
                const dsResp = await fetchIntercom('/export/reporting_data/get_datasets');
                if (!dsResp.ok) {
                    return res.status(200).json({ success: false, error: `get_datasets failed: ${dsResp.status} ${JSON.stringify(dsResp.data)}` });
                }
                const rawDatasets = dsResp.data?.data ?? dsResp.data ?? [];
                const datasets = Array.isArray(rawDatasets) ? rawDatasets : [rawDatasets];
                // Prefer exact 'tickets' dataset (not 'ticket_time_in_state')
                const ticketDs = datasets.find(d => d.id === 'tickets') ||
                    datasets.find(d => d.name && String(d.name).toLowerCase() === 'tickets dataset');
                if (!ticketDs) {
                    return res.status(200).json({ success: false, error: 'Tickets dataset not found. Available: ' + datasets.map(d => `${d.id}(${d.name || ''})`).join(', ') });
                }
                const datasetId = ticketDs.id;
                const WANTED_ATTRS = [
                    'conversation_id', 'ticket_id', 'ticket_created_at', 'ticket_last_resolved_at',
                    'current_ticket_custom_state_id', 'current_ticket_state_category',
                    'currently_assigned_team_id', 'currently_assigned_teammate_id',
                    'ticket_type_id', 'ticket_title', 'ticket_description', 'ticket_url',
                    'ticket_time_to_resolve', 'ticket_resolved_by_teammate_id',
                    'ticket_created_by_teammate_id',
                    'user_location_country_code', 'user_location_continent_code', 'channel',
                    'last_teammate_rating'
                ];
                let attributeIds = WANTED_ATTRS;
                // If dataset exposes attributes, filter to only those that exist
                if (ticketDs.attributes && Array.isArray(ticketDs.attributes)) {
                    const available = new Set(ticketDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a)));
                    attributeIds = WANTED_ATTRS.filter(a => available.has(a));
                    if (attributeIds.length === 0) {
                        attributeIds = ticketDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a));
                    }
                }
                const DHAKA_OFFSET = 6 * 3600;
                const partsFrom = tdDateFrom.split('T')[0].split('-').map(Number);
                const partsTo = tdDateTo.split('T')[0].split('-').map(Number);
                const fromTs = partsFrom.length >= 3 ? Math.floor(Date.UTC(partsFrom[0], partsFrom[1] - 1, partsFrom[2]) / 1000) - DHAKA_OFFSET : 0;
                const toTs = partsTo.length >= 3 ? Math.floor(Date.UTC(partsTo[0], partsTo[1] - 1, partsTo[2], 23, 59, 59) / 1000) - DHAKA_OFFSET : 0;
                const enqBody = { start_time: fromTs, end_time: toTs, dataset_id: datasetId, attribute_ids: attributeIds };
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
                return res.status(200).json({ success: false, error: 'tickets-dataset-enqueue failed: ' + (e.message || String(e)) });
            }
        }

        // ============ TICKETS DATASET → ticket_logs: Poll job status ============
        if (action === 'tickets-dataset-poll') {
            const { jobId } = body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            try {
                const resp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!resp.ok) {
                    return res.status(200).json({ success: false, error: `Poll failed: ${resp.status}` });
                }
                return res.status(200).json({ success: true, status: resp.data?.status || 'unknown', job: resp.data });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'tickets-dataset-poll failed: ' + (e.message || String(e)) });
            }
        }

        // ============ TICKETS DATASET → ticket_logs: Download CSV, map & upsert ============
        if (action === 'tickets-dataset-import') {
            const { jobId } = body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const sbTD = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            const DHAKA_OFFSET_MS = 6 * 3600 * 1000;

            function parseFullCSV(csvText) {
                const rows = [];
                let row = [], field = '', inQuotes = false;
                for (let i = 0; i < csvText.length; i++) {
                    const c = csvText[i];
                    if (c === '"') {
                        if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') { field += '"'; i++; }
                        else inQuotes = !inQuotes;
                    } else if (c === ',' && !inQuotes) { row.push(field.trim()); field = ''; }
                    else if (c === '\n' && !inQuotes) { row.push(field.trim()); if (row.some(f => f !== '')) rows.push(row); row = []; field = ''; }
                    else if (c === '\r' && !inQuotes) { /* skip */ }
                    else field += c;
                }
                row.push(field.trim());
                if (row.some(f => f !== '')) rows.push(row);
                return rows;
            }

            function tdHttpsBinary(url, opts = {}) {
                return new Promise((resolve, reject) => {
                    const urlObj = new URL(url);
                    const reqOpts = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: opts.method || 'GET', headers: opts.headers || {} };
                    const req2 = https.request(reqOpts, (res2) => {
                        if (res2.statusCode >= 300 && res2.statusCode < 400 && res2.headers.location) {
                            return tdHttpsBinary(res2.headers.location, opts).then(resolve).catch(reject);
                        }
                        const chunks = [];
                        res2.on('data', chunk => chunks.push(chunk));
                        res2.on('end', () => resolve({ ok: res2.statusCode >= 200 && res2.statusCode < 300, status: res2.statusCode, buffer: Buffer.concat(chunks) }));
                    });
                    req2.on('error', reject);
                    req2.end();
                });
            }

            // Format seconds into human-readable duration
            function formatDuration(seconds) {
                if (seconds == null || isNaN(seconds) || seconds < 0) return 'N/A';
                const s = Math.round(Number(seconds));
                const d = Math.floor(s / 86400);
                const h = Math.floor((s % 86400) / 3600);
                const m = Math.floor((s % 3600) / 60);
                const parts = [];
                if (d > 0) parts.push(`${d}d`);
                if (h > 0) parts.push(`${h}h`);
                parts.push(`${m}m`);
                return parts.join(' ');
            }

            // Map CSV header to ticket_logs column
            function mapTDHeader(h) {
                const raw = h.trim();
                const stripped = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
                const lower = stripped.toLowerCase();
                // Human-readable header mapping
                const MAP = {
                    'conversation id': 'conversation_id',
                    'ticket id': 'ticket_id',
                    'ticket created': 'ticket_created_at',
                    'ticket created at': 'ticket_created_at',
                    'ticket last resolved': 'ticket_last_resolved_at',
                    'ticket last resolved at': 'ticket_last_resolved_at',
                    'current ticket custom state': 'current_ticket_custom_state_id',
                    'current ticket state category': 'current_ticket_state_category',
                    'team currently assigned': 'currently_assigned_team_id',
                    'teammate currently assigned': 'currently_assigned_teammate_id',
                    'ticket type': 'ticket_type_id',
                    'ticket title': 'ticket_title',
                    'ticket description': 'ticket_description',
                    'ticket url': 'ticket_url',
                    'ticket time to resolve': 'ticket_time_to_resolve',
                    'resolved by': 'ticket_resolved_by_teammate_id',
                    'created by': 'ticket_created_by_teammate_id',
                    'country': 'country',
                    'channel': 'channel',
                    'last teammate rating': 'last_teammate_rating',
                    'continent': 'continent',
                };
                if (MAP[lower]) return MAP[lower];
                // Snake_case attribute ID mapping
                const SNAKE = {
                    'conversation_id': 'conversation_id',
                    'ticket_id': 'ticket_id',
                    'ticket_created_at': 'ticket_created_at',
                    'ticket_last_resolved_at': 'ticket_last_resolved_at',
                    'current_ticket_custom_state_id': 'current_ticket_custom_state_id',
                    'current_ticket_state_category': 'current_ticket_state_category',
                    'currently_assigned_team_id': 'currently_assigned_team_id',
                    'currently_assigned_teammate_id': 'currently_assigned_teammate_id',
                    'ticket_type_id': 'ticket_type_id',
                    'ticket_title': 'ticket_title',
                    'ticket_description': 'ticket_description',
                    'ticket_url': 'ticket_url',
                    'ticket_time_to_resolve': 'ticket_time_to_resolve',
                    'ticket_resolved_by_teammate_id': 'ticket_resolved_by_teammate_id',
                    'ticket_created_by_teammate_id': 'ticket_created_by_teammate_id',
                    'user_location_country_code': 'country',
                    'user_location_continent_code': 'continent',
                    'channel': 'channel',
                    'last_teammate_rating': 'last_teammate_rating',
                };
                if (SNAKE[raw]) return SNAKE[raw];
                if (SNAKE[lower]) return SNAKE[lower];
                return null;
            }

            try {
                // Step 1: Fetch team map from Intercom /teams API
                const TEAM_NAME_MAP = {};
                try {
                    const teamsResp = await fetchIntercom('/teams');
                    if (teamsResp.ok) {
                        const teams = teamsResp.data?.teams || teamsResp.data?.data || [];
                        for (const t of teams) {
                            if (t.id && t.name) TEAM_NAME_MAP[String(t.id)] = t.name;
                        }
                    }
                } catch (_) { /* team lookup is best-effort */ }

                // Step 2: Download CSV
                const downloadUrl = `https://api.intercom.io/download/reporting_data/${jobId}`;
                const dlResp = await tdHttpsBinary(downloadUrl, {
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
                const colMap = headers.map(h => mapTDHeader(h));
                const mappedCount = colMap.filter(Boolean).length;
                const unmapped = headers.filter((h, i) => !colMap[i]);

                // Debug: if no columns mapped, return headers for diagnosis
                if (mappedCount === 0) {
                    return res.status(200).json({ success: false, error: 'No CSV columns matched mapping', headers: headers.slice(0, 30), totalCsvRows: allRows.length - 1 });
                }

                // Load SLA rules from sla_rules table once for the whole batch
                const slaRules = await loadSlaRules(sbTD);

                // Step 3: Build records mapped to ticket_logs columns
                const rows = [];
                for (let i = 1; i < allRows.length; i++) {
                    const csvRow = allRows[i];
                    const raw = {};
                    for (let c = 0; c < headers.length; c++) {
                        const dbCol = colMap[c];
                        if (!dbCol) continue;
                        let val = csvRow[c] ?? '';
                        if (val === '') val = null;
                        raw[dbCol] = val;
                    }

                    // Compute date (ticket_created_at → YYYY-MM-DD)
                    // Intercom CSV timestamps are already in GMT+6 — do NOT add offset
                    let ticketDate = null;
                    if (raw.ticket_created_at) {
                        const d = new Date(raw.ticket_created_at);
                        if (!isNaN(d.getTime())) {
                            ticketDate = d.toISOString().slice(0, 10);
                        }
                    }
                    if (!ticketDate) continue; // skip rows without a valid date

                    let resolvedAtISO = null;
                    if (raw.ticket_last_resolved_at) {
                        const rd = new Date(raw.ticket_last_resolved_at);
                        if (!isNaN(rd.getTime())) resolvedAtISO = rd.toISOString();
                    }

                    const conversationId = raw.conversation_id || null;
                    const ticketId = raw.ticket_id || null;
                    if (!conversationId && !ticketId) continue; // need at least one ID

                    // unique_id = {date}|{ticket_id} (prefer ticket_id for accurate dedup)
                    const uniqueId = `${ticketDate}|${ticketId || conversationId}`;

                    // Resolve team name from team ID
                    let currentTeam = null;
                    if (raw.currently_assigned_team_id) {
                        currentTeam = TEAM_NAME_MAP[String(raw.currently_assigned_team_id)] || raw.currently_assigned_team_id;
                    }

                    // Ticket status from state category
                    let ticketStatus = null;
                    if (raw.current_ticket_state_category) {
                        const cat = raw.current_ticket_state_category.trim();
                        ticketStatus = cat.charAt(0).toUpperCase() + cat.slice(1);
                    }

                    // Resolve teammate IDs to names
                    let handlerName = null;
                    if (raw.ticket_resolved_by_teammate_id) {
                        handlerName = TEAM_NAME_MAP[String(raw.ticket_resolved_by_teammate_id)] || raw.ticket_resolved_by_teammate_id;
                    } else if (raw.currently_assigned_teammate_id) {
                        handlerName = TEAM_NAME_MAP[String(raw.currently_assigned_teammate_id)] || raw.currently_assigned_teammate_id;
                    }
                    let creatorName = null;
                    if (raw.ticket_created_by_teammate_id) {
                        creatorName = TEAM_NAME_MAP[String(raw.ticket_created_by_teammate_id)] || raw.ticket_created_by_teammate_id;
                    }

                    // ticket_time_to_resolve → seconds + human-readable
                    let slaDurationSeconds = null;
                    let resolutionTime = null;
                    if (raw.ticket_time_to_resolve != null) {
                        const secs = parseFloat(raw.ticket_time_to_resolve);
                        if (!isNaN(secs)) {
                            slaDurationSeconds = Math.round(secs);
                            resolutionTime = formatDuration(secs);
                        }
                    }

                    // Parse actual ticket creation timestamp for created_at
                    let createdAtISO = null;
                    let createdAtUnix = 0;
                    if (raw.ticket_created_at) {
                        const d = new Date(raw.ticket_created_at);
                        if (!isNaN(d.getTime())) {
                            createdAtISO = d.toISOString();
                            createdAtUnix = Math.floor(d.getTime() / 1000);
                        }
                    }

                    // ── SLA Calculation (table-driven from sla_rules) ──
                    const issueCategoryForSla = raw.ticket_type_id || raw.ticket_title || null;
                    const teamCode = resolveTeamCode(slaRules, issueCategoryForSla, currentTeam);
                    const slaResult = computeSlaForTicket(slaRules, teamCode, issueCategoryForSla, createdAtUnix, slaDurationSeconds);
                    const slaStatus = slaResult.sla_status;
                    const slaLimitHours = slaResult.sla_limit_hours;
                    const resolvedDuringOffice = slaResult.resolved_during_office;
                    const ticketSlaStatus = slaResult.sla_status;

                    // Product type inferred from ticket_type_id / title.
                    // CSV export does not include custom ticket attributes — the ticket-sync
                    // pathway backfills the definitive value from ticket_attributes.Product type.
                    // Leave null when we can't infer cleanly so ticket-sync can fill it accurately.
                    let productType = null;
                    const cat = `${raw.ticket_type_id || ''} ${raw.ticket_title || ''}`;
                    if (/\(fut\)/i.test(cat) || /futures?/i.test(cat)) productType = 'Futures';
                    else if (/cfds?/i.test(cat) || /stellar/i.test(cat)) productType = 'CFD';

                    const record = {
                        unique_id: uniqueId,
                        date: ticketDate,
                        ticket_id: ticketId,
                        intercom_id: conversationId,
                        ticket_status: ticketStatus,
                        current_team: currentTeam,
                        issue_category: raw.ticket_type_id || raw.ticket_title || null,
                        description_last_ticket_note: raw.ticket_description || null,
                        ticket_handler_agent_name: handlerName,
                        ticket_creator_agent_name: creatorName,
                        country: raw.country || null,
                        continent: raw.continent || null,
                        channel: raw.channel || null,
                        product_type: productType,
                        resolution_time: resolutionTime,
                        ticket_sla_duration_seconds: slaDurationSeconds,
                        sla: slaStatus,
                        sla_limit_hours: slaLimitHours,
                        ticket_sla_status: ticketSlaStatus,
                        ticket_sla_limit_hours: slaLimitHours,
                        resolved_during_office_hours: resolvedDuringOffice,
                        created_at: createdAtISO || new Date().toISOString(),
                        resolved_at: resolvedAtISO,
                        updated_at: new Date().toISOString()
                    };

                    rows.push(record);
                }

                if (rows.length === 0) {
                    return res.status(200).json({ success: true, imported: 0, totalCsvRows: allRows.length - 1, message: 'No valid rows after mapping.', mappedColumns: mappedCount, unmappedHeaders: unmapped, headers: headers.slice(0, 30) });
                }

                // Step 4: Upsert to ticket_logs in batches of 500
                const BATCH = 500;
                let imported = 0;
                const upsertErrors = [];
                for (let s = 0; s < rows.length; s += BATCH) {
                    const chunk = rows.slice(s, s + BATCH);
                    const { data: upsertData, error: upsertErr } = await sbTD
                        .from('ticket_logs')
                        .upsert(chunk, { onConflict: 'unique_id' })
                        .select('unique_id');
                    if (upsertErr) {
                        upsertErrors.push(`Batch ${s}: ${upsertErr.message}`);
                    } else {
                        imported += upsertData?.length || chunk.length;
                    }
                }

                // Step 5: Enrich product_type from Intercom ticket_attributes.
                // CSV exports don't include custom ticket attributes, so the records we just
                // inserted have product_type inferred from category text only — which misses
                // most BO/CR/PT tickets. Fetch each ticket from Intercom and read Product Type.
                let productEnriched = 0;
                let productEnrichErrors = 0;
                let multiDeptDetected = 0;
                // Enrich ALL rows with intercom_id — we now also detect multi-department
                // tickets (teams visited > 1, including PSTF→CEx Reversal) and set sla='N/A'
                // for those, matching the logic in ticket-sync. The CSV doesn't include
                // ticket_parts, so we get teams_visited from /tickets/{id}.
                const productEnrichTargets = rows
                    .filter(r => r.intercom_id)
                    .map(r => ({
                        intercom_id: r.intercom_id,
                        issue_category: r.issue_category,
                        currentTeam: r.current_team,
                        needsProduct: !r.product_type || r.product_type === 'Unknown',
                    }));
                if (productEnrichTargets.length > 0) {
                    const PT_CONCURRENCY = 10;
                    let cursor = 0;
                    async function fetchIntercomTicketRetry(intercomId, retries = 3) {
                        for (let attempt = 0; attempt < retries; attempt++) {
                            try {
                                const r = await httpsRequest(`https://api.intercom.io/tickets/${intercomId}`, {
                                    method: 'GET',
                                    headers: {
                                        Authorization: `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`,
                                        Accept: 'application/json',
                                        'Intercom-Version': '2.11',
                                    }
                                });
                                if (r.status === 429 || r.status >= 500) {
                                    await new Promise(res => setTimeout(res, (2 ** attempt + Math.random()) * 1000));
                                    continue;
                                }
                                if (!r.ok) return null;
                                return typeof r.data === 'string' ? null : r.data;
                            } catch (_) {
                                await new Promise(res => setTimeout(res, (2 ** attempt + Math.random()) * 1000));
                            }
                        }
                        return null;
                    }
                    async function ptWorker() {
                        while (cursor < productEnrichTargets.length) {
                            const i = cursor++;
                            const t = productEnrichTargets[i];
                            const ticket = await fetchIntercomTicketRetry(t.intercom_id);
                            if (!ticket) { productEnrichErrors++; continue; }

                            // Compute fields to update based on ticket_parts
                            const updates = { updated_at: new Date().toISOString() };

                            // 1) product_type (only if missing)
                            if (t.needsProduct) {
                                const product = extractProductType(ticket.ticket_attributes, t.issue_category || (ticket.ticket_type && ticket.ticket_type.name) || ticket.title);
                                if (product) updates.product_type = product;
                            }

                            // 2) Multi-dept detection — walk ticket_parts to collect teams visited.
                            //    ANY ticket that visited >1 team is multi-dept → force sla='N/A'.
                            //    (The former PSTF→CEx Reversal exception was removed 2026-07-11 per
                            //    user: a PSTF→CEx Reversal handoff is a genuine multi-department ticket.)
                            const ticketParts = ticket.ticket_parts?.ticket_parts || [];
                            const teamsVisited = {};
                            for (const p of ticketParts) {
                                if (p.assigned_to && p.assigned_to.type === 'team') {
                                    const tName = TEAM_NAME_MAP[String(p.assigned_to.id)] || null;
                                    if (tName) teamsVisited[tName] = true;
                                }
                                if (p.assignee && p.assignee.type === 'team') {
                                    const tName = TEAM_NAME_MAP[String(p.assignee.id)] || null;
                                    if (tName) teamsVisited[tName] = true;
                                }
                            }
                            if (t.currentTeam) teamsVisited[t.currentTeam] = true;
                            const uniqueTeamsCount = Object.keys(teamsVisited).length;
                            if (uniqueTeamsCount > 1) {
                                updates.sla = 'N/A';
                                updates.ticket_sla_status = 'N/A';
                                updates.forwarded = true;
                                updates.forwarded_to = Object.keys(teamsVisited).join(', ');
                                multiDeptDetected++;
                            } else {
                                // Reset stale forwarded flag if upstream data was wrong
                                updates.forwarded = false;
                                updates.forwarded_to = null;
                            }

                            // Skip update if there's nothing to write besides updated_at
                            if (Object.keys(updates).length === 1) continue;

                            const { error } = await sbTD
                                .from('ticket_logs')
                                .update(updates)
                                .eq('intercom_id', String(t.intercom_id));
                            if (error) productEnrichErrors++;
                            else if (updates.product_type) productEnriched++;
                        }
                    }
                    await Promise.all(Array.from({ length: PT_CONCURRENCY }, () => ptWorker()));
                }

                const unmappedHeaders = headers.filter((h, i) => !colMap[i]);
                const mappedDetail = headers.map((h, i) => colMap[i] ? `${h} → ${colMap[i]}` : null).filter(Boolean);
                return res.status(200).json({
                    success: true,
                    imported,
                    productEnriched,
                    productEnrichErrors,
                    multiDeptDetected,
                    totalCsvRows: allRows.length - 1,
                    filteredRows: rows.length,
                    jobId,
                    csvHeaders: headers,
                    unmappedHeaders,
                    mappedDetail,
                    teamsLoaded: Object.keys(TEAM_NAME_MAP).length,
                    errors: upsertErrors.length > 0 ? upsertErrors : undefined
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'tickets-dataset-import failed: ' + (e.message || String(e)) });
            }
        }

        // ============ TICKETS REST SYNC → ticket_logs (Tickets Search API) ============
        // Replacement for the Reporting Data Export pathway (enqueue/poll/import),
        // which hangs at /export/reporting_data/enqueue. This uses the working REST
        // POST /tickets/search (Intercom-Version 2.11), pages by created_at within a
        // single GMT+6 day window, and upserts rows in the SAME shape/columns as the
        // CSV importer (onConflict: unique_id). Reuses the module-scope SLA/team/product
        // helpers verbatim (loadSlaRules / resolveTeamCode / computeSlaForTicket /
        // extractProductType). Body: { action:'tickets-rest-sync', dateFrom, dateTo }.
        if (action === 'tickets-rest-sync') {
            const trDateFrom = (body && body.dateFrom) || null;
            const trDateTo = (body && body.dateTo) || trDateFrom;
            if (!trDateFrom) {
                return res.status(200).json({ success: false, error: 'dateFrom required (YYYY-MM-DD)' });
            }
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const sbTR = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            // Human-readable duration (matches CSV importer's formatDuration)
            function trFormatDuration(seconds) {
                if (seconds == null || isNaN(seconds) || seconds < 0) return 'N/A';
                const s = Math.round(Number(seconds));
                const d = Math.floor(s / 86400);
                const h = Math.floor((s % 86400) / 3600);
                const m = Math.floor((s % 3600) / 60);
                const parts = [];
                if (d > 0) parts.push(`${d}d`);
                if (h > 0) parts.push(`${h}h`);
                parts.push(`${m}m`);
                return parts.join(' ');
            }

            // POST /tickets/search with a hard 30s timeout so it can never hang.
            function trTicketsSearch(searchBody) {
                return new Promise((resolve) => {
                    const payload = JSON.stringify(searchBody);
                    const reqOpts = {
                        hostname: 'api.intercom.io',
                        path: '/tickets/search',
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`,
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'Intercom-Version': '2.11',
                            'Content-Length': Buffer.byteLength(payload)
                        }
                    };
                    const req2 = https.request(reqOpts, (res2) => {
                        let data = '';
                        res2.on('data', c => data += c);
                        res2.on('end', () => {
                            let parsed = null;
                            try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
                            resolve({ ok: res2.statusCode >= 200 && res2.statusCode < 300, status: res2.statusCode, data: parsed });
                        });
                    });
                    req2.on('error', (e) => resolve({ ok: false, status: 0, data: { error: e.message } }));
                    req2.setTimeout(30000, () => { req2.destroy(new Error('tickets/search timed out after 30s')); });
                    req2.write(payload);
                    req2.end();
                });
            }

            try {
                // Team + admin name maps (best-effort; raw IDs used as fallback)
                const TEAM_NAME_MAP = {};
                try {
                    const teamsResp = await fetchIntercom('/teams');
                    if (teamsResp.ok) {
                        const teams = teamsResp.data?.teams || teamsResp.data?.data || [];
                        for (const t of teams) { if (t.id && t.name) TEAM_NAME_MAP[String(t.id)] = t.name; }
                    }
                } catch (_) { /* best-effort */ }
                const ADMIN_NAME_MAP = {};
                try {
                    const admResp = await fetchIntercom('/admins');
                    if (admResp.ok) {
                        for (const a of (admResp.data?.admins || [])) {
                            if (a.id) ADMIN_NAME_MAP[String(a.id)] = a.name || a.email || String(a.id);
                        }
                    }
                } catch (_) { /* best-effort */ }

                const slaRules = await loadSlaRules(sbTR);

                // GMT+6 [start,end] unix window — identical math to tickets-dataset-enqueue
                const DHAKA_OFFSET = 6 * 3600;
                const pF = trDateFrom.split('T')[0].split('-').map(Number);
                const pT = trDateTo.split('T')[0].split('-').map(Number);
                const fromTs = Math.floor(Date.UTC(pF[0], pF[1] - 1, pF[2]) / 1000) - DHAKA_OFFSET;
                const toTs = Math.floor(Date.UTC(pT[0], pT[1] - 1, pT[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;

                // Page /tickets/search by created_at within the window
                let scanned = 0;
                const rows = [];
                let startingAfter = null;
                const MAX_PAGES = 50;
                for (let page = 0; page < MAX_PAGES; page++) {
                    const searchBody = {
                        query: {
                            operator: 'AND',
                            value: [
                                { field: 'created_at', operator: '>', value: fromTs },
                                { field: 'created_at', operator: '<', value: toTs }
                            ]
                        },
                        pagination: startingAfter ? { per_page: 150, starting_after: startingAfter } : { per_page: 150 }
                    };
                    const sr = await trTicketsSearch(searchBody);
                    if (!sr.ok) {
                        return res.status(200).json({ success: false, error: `tickets/search failed: ${sr.status} ${JSON.stringify(sr.data)}` });
                    }
                    const tickets = sr.data?.tickets || [];
                    for (const ticket of tickets) {
                        scanned++;
                        const attrs = ticket.ticket_attributes || {};

                        const createdUnix = typeof ticket.created_at === 'number' ? ticket.created_at : Number(ticket.created_at);
                        if (!createdUnix || isNaN(createdUnix)) continue;
                        // Dhaka calendar date (add offset, take UTC date) → matches CSV importer's GMT+6 date
                        const ticketDate = new Date((createdUnix + DHAKA_OFFSET) * 1000).toISOString().slice(0, 10);
                        const createdAtISO = new Date(createdUnix * 1000).toISOString();

                        const ticketId = ticket.ticket_id || ticket.id || null;
                        // Linked conversation, if any
                        let conversationId = null;
                        const linked = ticket.linked_objects?.data || [];
                        for (const lo of linked) {
                            if (lo && lo.type === 'conversation' && lo.id) { conversationId = String(lo.id); break; }
                        }
                        if (!ticketId && !conversationId) continue;
                        const uniqueId = `${ticketDate}|${ticketId || conversationId}`;

                        // Resolved time: latest ticket_part that sets state to 'resolved'
                        const tParts = ticket.ticket_parts?.ticket_parts || [];
                        let resolvedUnix = null;
                        for (const p of tParts) {
                            if (p && p.ticket_state === 'resolved' && typeof p.created_at === 'number') {
                                if (resolvedUnix == null || p.created_at > resolvedUnix) resolvedUnix = p.created_at;
                            }
                        }
                        const isResolved = ticket.ticket_state === 'resolved';
                        if (resolvedUnix == null && isResolved && typeof ticket.updated_at === 'number') {
                            resolvedUnix = ticket.updated_at;
                        }
                        const resolvedAtISO = resolvedUnix != null ? new Date(resolvedUnix * 1000).toISOString() : null;

                        // Duration → seconds + human readable
                        let slaDurationSeconds = null;
                        let resolutionTime = null;
                        if (resolvedUnix != null && resolvedUnix >= createdUnix) {
                            slaDurationSeconds = Math.round(resolvedUnix - createdUnix);
                            resolutionTime = trFormatDuration(slaDurationSeconds);
                        }

                        // Status label
                        let ticketStatus = null;
                        const stateRaw = ticket.ticket_state || ticket.ticket_state_external_label || null;
                        if (stateRaw) {
                            const c = String(stateRaw).replace(/_/g, ' ').trim();
                            ticketStatus = c.charAt(0).toUpperCase() + c.slice(1);
                        }

                        // Team / agent names
                        const currentTeam = ticket.team_assignee_id != null
                            ? (TEAM_NAME_MAP[String(ticket.team_assignee_id)] || String(ticket.team_assignee_id))
                            : null;
                        const handlerName = ticket.admin_assignee_id != null && ticket.admin_assignee_id !== 0
                            ? (ADMIN_NAME_MAP[String(ticket.admin_assignee_id)] || String(ticket.admin_assignee_id))
                            : null;

                        // Category / title / description
                        const typeName = ticket.ticket_type?.name || null;
                        const issueCategory = typeName || attrs._default_title_ || null;
                        const description = attrs._default_description_ || null;

                        // Country — best-effort from ticket_attributes; null if unavailable
                        let country = null;
                        for (const [k, v] of Object.entries(attrs)) {
                            if (v && /country/i.test(k)) { country = typeof v === 'object' ? (v.name || null) : v; break; }
                        }

                        // Product type from custom attributes (REST returns them inline)
                        const productType = extractProductType(attrs, issueCategory);

                        // SLA — reuse the exact module-scope machinery
                        const teamCode = resolveTeamCode(slaRules, issueCategory, currentTeam);
                        const slaResult = computeSlaForTicket(slaRules, teamCode, issueCategory, createdUnix, slaDurationSeconds);

                        // Best-effort multi-department detection from ticket_parts (no extra fetch).
                        // Force sla='N/A' when >1 team visited, matching the CSV importer.
                        const teamsVisited = {};
                        for (const p of tParts) {
                            const asn = p && (p.assigned_to || p.assignee);
                            if (asn && asn.type === 'team' && asn.id != null) {
                                const nm = TEAM_NAME_MAP[String(asn.id)];
                                if (nm) teamsVisited[nm] = true;
                            }
                        }
                        if (currentTeam) teamsVisited[currentTeam] = true;
                        const multiDept = Object.keys(teamsVisited).length > 1;

                        const record = {
                            unique_id: uniqueId,
                            date: ticketDate,
                            ticket_id: ticketId,
                            intercom_id: conversationId,
                            ticket_status: ticketStatus,
                            current_team: currentTeam,
                            issue_category: issueCategory,
                            description_last_ticket_note: description,
                            ticket_handler_agent_name: handlerName,
                            ticket_creator_agent_name: null,
                            country: country,
                            continent: null,
                            channel: null,
                            product_type: productType,
                            resolution_time: resolutionTime,
                            ticket_sla_duration_seconds: slaDurationSeconds,
                            sla: multiDept ? 'N/A' : slaResult.sla_status,
                            sla_limit_hours: slaResult.sla_limit_hours,
                            ticket_sla_status: multiDept ? 'N/A' : slaResult.sla_status,
                            ticket_sla_limit_hours: slaResult.sla_limit_hours,
                            resolved_during_office_hours: slaResult.resolved_during_office,
                            forwarded: multiDept ? true : false,
                            forwarded_to: multiDept ? Object.keys(teamsVisited).join(', ') : null,
                            created_at: createdAtISO,
                            resolved_at: resolvedAtISO,
                            updated_at: new Date().toISOString()
                        };
                        rows.push(record);
                    }
                    startingAfter = sr.data?.pages?.next?.starting_after || null;
                    if (!startingAfter) break;
                }

                // Deduplicate by unique_id — keeps last occurrence per ID.
                // Prevents "duplicate key" constraint errors when Intercom API
                // returns two tickets that produce the same unique_id (e.g. when
                // ticket.ticket_id is null and ticket.id collides with another
                // ticket's numeric ticket_id).
                const deduped = [...new Map(rows.map(r => [r.unique_id, r])).values()];

                // Upsert in batches of 500 (re-run safe on unique_id).
                // Fallback: when the bulk upsert hits a constraint conflict (typically
                // on dates where old CSV rows exist with a ticket_id constraint), fall
                // back to UPDATE-by-ticket_id for rows that have a ticket_id, then
                // INSERT the remainder.
                const BATCH = 500;
                let imported = 0;
                const upsertErrors = [];
                for (let s = 0; s < deduped.length; s += BATCH) {
                    const chunk = deduped.slice(s, s + BATCH);
                    const { data: upData, error: upErr } = await sbTR
                        .from('ticket_logs')
                        .upsert(chunk, { onConflict: 'unique_id' })
                        .select('unique_id');
                    if (!upErr) {
                        imported += upData?.length || chunk.length;
                    } else {
                        // Bulk upsert failed — fall back to per-row UPDATE then INSERT
                        let batchImported = 0;
                        for (const r of chunk) {
                            if (r.ticket_id != null) {
                                // Try UPDATE existing row by ticket_id (fixes wrong-dated rows)
                                const { data: ud, error: ue } = await sbTR
                                    .from('ticket_logs')
                                    .update(r)
                                    .eq('ticket_id', r.ticket_id)
                                    .select('unique_id');
                                if (!ue && ud && ud.length > 0) { batchImported++; continue; }
                            }
                            // No ticket_id or UPDATE matched 0 rows → INSERT
                            const { error: ie } = await sbTR.from('ticket_logs').insert(r);
                            if (!ie) batchImported++;
                            else if (!ie.message.includes('duplicate')) {
                                upsertErrors.push(`Row ${r.unique_id}: ${ie.message}`);
                            }
                        }
                        imported += batchImported;
                    }
                }

                return res.status(200).json({
                    success: true,
                    imported,
                    totalCsvRows: scanned,
                    filteredRows: deduped.length,
                    teamsLoaded: Object.keys(TEAM_NAME_MAP).length,
                    adminsLoaded: Object.keys(ADMIN_NAME_MAP).length,
                    errors: upsertErrors.length > 0 ? upsertErrors : undefined
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'tickets-rest-sync failed: ' + (e.message || String(e)) });
            }
        }

        // ============ SLA RULES: replace contents of sla_rules table ============
        // Body: { rules: [{ team_code, issue_category|null, wd_office_h, wd_after_h, we_office_h, we_after_h }, ...] }
        // Truncates the table and re-inserts the provided rows. Use to re-import the
        // Ticket SLA spreadsheet without redeploying.
        if (action === 'sla-rules-import') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
            }
            const rules = (body && Array.isArray(body.rules)) ? body.rules : null;
            if (!rules || rules.length === 0) {
                return res.status(400).json({ success: false, error: 'Body must include rules: [...] (non-empty)' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
            try {
                const cleaned = rules.map(r => ({
                    team_code: String(r.team_code || '').trim(),
                    issue_category: r.issue_category ? String(r.issue_category).trim() : null,
                    wd_office_h: r.wd_office_h != null ? Number(r.wd_office_h) : null,
                    wd_after_h:  r.wd_after_h  != null ? Number(r.wd_after_h)  : null,
                    we_office_h: r.we_office_h != null ? Number(r.we_office_h) : null,
                    we_after_h:  r.we_after_h  != null ? Number(r.we_after_h)  : null,
                })).filter(r => r.team_code);
                const { error: delErr } = await sb.from('sla_rules').delete().not('id', 'is', null);
                if (delErr) return res.status(200).json({ success: false, error: 'delete failed: ' + delErr.message });
                const BATCH = 500;
                let inserted = 0;
                for (let i = 0; i < cleaned.length; i += BATCH) {
                    const slice = cleaned.slice(i, i + BATCH);
                    const { error: insErr } = await sb.from('sla_rules').insert(slice);
                    if (insErr) return res.status(200).json({ success: false, error: 'insert failed at batch ' + i + ': ' + insErr.message, inserted });
                    inserted += slice.length;
                }
                return res.status(200).json({ success: true, inserted });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'sla-rules-import failed: ' + (e.message || String(e)) });
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

        if (action === 'fetch-details-batch') {
            const { conversationIds } = req.body || {};
            if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
                return res.status(400).json({ error: 'conversationIds (array) required' });
            }

            // Load Intercom teams once → map team_id → name for assigned_channel_name
            const TEAM_MAP = {};
            try {
                const teamsResp = await fetchIntercom('/teams');
                if (teamsResp.ok) {
                    const teams = teamsResp.data?.teams || teamsResp.data?.data || [];
                    for (const t of teams) {
                        if (t && t.id != null && t.name) TEAM_MAP[String(t.id)] = t.name;
                    }
                }
            } catch (e) { /* fall through — channel_name stays null */ }

            async function fetchOneConversation(convId) {
                try {
                    const convResp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
                    if (!convResp.ok) return { convId, error: `Intercom ${convResp.status}` };
                    const conv = convResp.data;
                    if (!conv || conv.id == null) return { convId, error: 'Invalid response' };

                    let transcript;
                    try { transcript = extractTranscript(conv); } catch (e) { transcript = ''; }

                    let contactData = { Country: null, Region: null, 'User ID': null };
                    try {
                        const cid = conv.contacts?.contacts?.[0]?.id;
                        if (cid) {
                            const cr = await fetchIntercom(`/contacts/${cid}`);
                            if (cr.ok && cr.data) {
                                contactData = {
                                    Country: cr.data.location?.country || null,
                                    Region: cr.data.location?.region || null,
                                    'User ID': cr.data.external_id || cr.data.id || null
                                };
                            }
                        }
                    } catch (e) {}

                    const teamId = conv.team_assignee_id != null ? String(conv.team_assignee_id) : null;
                    let teamName = teamId ? (TEAM_MAP[teamId] || null) : null;
                    if (teamId && !teamName) {
                        try {
                            const tr = await fetchIntercom(`/teams/${teamId}`);
                            if (tr.ok && tr.data?.name) {
                                teamName = tr.data.name;
                                TEAM_MAP[teamId] = teamName;
                            }
                        } catch (e) {}
                    }

                    // Derive product from team name first (most reliable source)
                    let product = null;
                    if (teamName) {
                        if (/\(FUT\)|FUT-|Futures/i.test(teamName)) product = 'Futures';
                        else if (/\(CFD\)|CFD:/i.test(teamName)) product = 'CFD';
                        else if (/Email Support|Unassigned Email/i.test(teamName)) product = 'CFD';
                    }

                    const rating = conv.conversation_rating?.rating;
                    return {
                        convId,
                        data: {
                            'Conversation ID': String(conv.id),
                            'created_at': conv.created_at,
                            'created_at_bd': conv.created_at != null ? new Date(conv.created_at * 1000).toISOString() : null,
                            'Email': conv.source?.author?.email || null,
                            'Transcript': transcript || null,
                            'User ID': contactData['User ID'] || conv.source?.author?.id || null,
                            'Country': contactData['Country'] || null,
                            'Region': contactData['Region'] || null,
                            'Assigned Channel ID': teamId,
                            'assigned_channel_name': teamName,
                            'CX Score Rating': rating != null ? String(rating) : null,
                            'Conversation Rating': rating != null ? String(rating) : null,
                            'Product': product
                        }
                    };
                } catch (e) {
                    return { convId, error: e.message || String(e) };
                }
            }

            // Process all in parallel (Intercom handles concurrency)
            const results = await Promise.allSettled(conversationIds.map(id => fetchOneConversation(id)));
            const output = results.map(r => r.status === 'fulfilled' ? r.value : { convId: null, error: 'Promise rejected' });
            return res.status(200).json({ success: true, results: output });
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

            let assignedChannelName = null;
            if (teamAssigneeId != null) {
                try {
                    const tr = await fetchIntercom(`/teams/${teamAssigneeId}`);
                    if (tr.ok && tr.data?.name) assignedChannelName = tr.data.name;
                } catch (e) {}
            }

            let product = null;
            if (assignedChannelName) {
                if (/\(FUT\)|FUT-|Futures/i.test(assignedChannelName)) product = 'Futures';
                else if (/\(CFD\)|CFD:/i.test(assignedChannelName)) product = 'CFD';
                else if (/Email Support|Unassigned Email/i.test(assignedChannelName)) product = 'CFD';
            }
            if (!product) {
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
            } // end if (!product)

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
                'assigned_channel_name': assignedChannelName,
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

        // ============ INTERCOM TOPIC: Enqueue Conversations dataset export ============
        if (action === 'it-enqueue') {
            const itDateFrom = dateFrom || '2026-01-01';
            const itDateTo = dateTo || '2026-03-24';
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
                const partsFrom = itDateFrom.split('T')[0].split('-').map(Number);
                const partsTo = itDateTo.split('T')[0].split('-').map(Number);
                const fromTs = partsFrom.length >= 3 ? Math.floor(Date.UTC(partsFrom[0], partsFrom[1] - 1, partsFrom[2]) / 1000) - DHAKA_OFFSET : 0;
                const toTs = partsTo.length >= 3 ? Math.floor(Date.UTC(partsTo[0], partsTo[1] - 1, partsTo[2], 23, 59, 59) / 1000) - DHAKA_OFFSET : 0;
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
                return res.status(200).json({ success: false, error: 'it-enqueue failed: ' + (e.message || String(e)) });
            }
        }

        // ============ INTERCOM TOPIC: Poll export job status ============
        if (action === 'it-poll') {
            const { jobId } = req.body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            try {
                const resp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!resp.ok) {
                    return res.status(200).json({ success: false, error: `Poll failed: ${resp.status}` });
                }
                return res.status(200).json({ success: true, status: resp.data?.status || 'unknown', job: resp.data });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'it-poll failed: ' + (e.message || String(e)) });
            }
        }

        // ============ INTERCOM TOPIC: Download CSV, map & import to Intercom Topic table ============
        if (action === 'it-download-import') {
            const { jobId } = req.body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) {
                return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
            }
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            // Map Intercom CSV headers to Intercom Topic columns
            function mapITHeader(h) {
                const raw = h.trim();
                const stripped = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
                const lower = stripped.toLowerCase();
                const MAP = {
                    'conversation id': 'Conversation ID',
                    'conversation started at': '_started_at',
                    'channel': 'Assigned Channel ID',
                    'country': 'Country',
                    'user id': 'User ID',
                    'last teammate rating': 'CX Score Rating',
                    'conversation rating': 'Conversation Rating',
                    'user location country code': 'Country',
                };
                if (MAP[lower]) return MAP[lower];
                const SNAKE = {
                    'conversation_id': 'Conversation ID',
                    'conversation_started_at': '_started_at',
                    'channel': 'Assigned Channel ID',
                    'user_location_country_code': 'Country',
                    'user_id': 'User ID',
                    'last_teammate_rating': 'CX Score Rating',
                    'conversation_rating': 'Conversation Rating',
                };
                if (SNAKE[raw]) return SNAKE[raw];
                if (SNAKE[lower]) return SNAKE[lower];
                return null;
            }

            const DHAKA_OFFSET_MS = 6 * 3600 * 1000;

            function parseFullCSV(csvText) {
                const rows = [];
                let row = [], field = '', inQuotes = false;
                for (let i = 0; i < csvText.length; i++) {
                    const c = csvText[i];
                    if (c === '"') {
                        if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') { field += '"'; i++; }
                        else inQuotes = !inQuotes;
                    } else if (c === ',' && !inQuotes) { row.push(field.trim()); field = ''; }
                    else if (c === '\n' && !inQuotes) { row.push(field.trim()); if (row.some(f => f !== '')) rows.push(row); row = []; field = ''; }
                    else if (c === '\r' && !inQuotes) { /* skip */ }
                    else field += c;
                }
                row.push(field.trim());
                if (row.some(f => f !== '')) rows.push(row);
                return rows;
            }

            // Binary HTTPS download for CSV/gzip
            function httpsRequestBinary(url, opts = {}) {
                return new Promise((resolve, reject) => {
                    const urlObj = new URL(url);
                    const reqOpts = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: opts.method || 'GET', headers: opts.headers || {} };
                    const req = https.request(reqOpts, (res) => {
                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            return httpsRequestBinary(res.headers.location, opts).then(resolve).catch(reject);
                        }
                        const chunks = [];
                        res.on('data', chunk => chunks.push(chunk));
                        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, buffer: Buffer.concat(chunks) }));
                    });
                    req.on('error', reject);
                    req.end();
                });
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
                    return res.status(200).json({ success: true, imported: 0, totalCsvRows: 0, message: 'No data rows.' });
                }
                const headers = allRows[0];
                const colMap = headers.map(h => mapITHeader(h));

                const rows = [];
                for (let i = 1; i < allRows.length; i++) {
                    const csvRow = allRows[i];
                    const record = {};
                    let startedAt = null;
                    for (let c = 0; c < headers.length; c++) {
                        const dbCol = colMap[c];
                        if (!dbCol) continue;
                        let val = csvRow[c] ?? '';
                        if (val === '') val = null;
                        if (dbCol === '_started_at') { startedAt = val; continue; }
                        if (dbCol === 'CX Score Rating' || dbCol === 'Conversation Rating') {
                            if (val) { const n = parseInt(val, 10); val = isNaN(n) ? null : n; }
                        }
                        if (val === null && record[dbCol] != null) continue;
                        record[dbCol] = val;
                    }
                    if (!record['Conversation ID']) continue;
                    // Set created_at as Unix timestamp (trigger computes Dhaka fields)
                    if (startedAt) {
                        const d = new Date(startedAt);
                        if (!isNaN(d.getTime())) {
                            record['created_at'] = String(Math.floor(d.getTime() / 1000));
                        }
                    }
                    rows.push(record);
                }

                // Upsert to Intercom Topic (conflict on Conversation ID)
                const BATCH = 500;
                let imported = 0;
                for (let s = 0; s < rows.length; s += BATCH) {
                    const chunk = rows.slice(s, s + BATCH);
                    const { error: insErr } = await sb.from('Intercom Topic').upsert(chunk, { onConflict: 'Conversation ID' });
                    if (insErr) {
                        return res.status(200).json({ success: false, error: 'Supabase upsert failed: ' + insErr.message, imported });
                    }
                    imported += chunk.length;
                }

                const unmappedHeaders = headers.filter((h, i) => !colMap[i]);
                const mappedDetail = headers.map((h, i) => colMap[i] ? `${h} → ${colMap[i]}` : null).filter(Boolean);
                return res.status(200).json({ success: true, imported, totalCsvRows: allRows.length - 1, csvHeaders: headers, unmappedHeaders, mappedDetail });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'it-download-import failed: ' + (e.message || String(e)) });
            }
        }

        // ============ CSAT: Enqueue conversation rating dataset export ============
        if (action === 'csat-enqueue') {
            const csatFrom = dateFrom || '2026-01-01';
            const csatTo = dateTo || '2026-03-25';
            try {
                const DHAKA_OFFSET = 6 * 3600;
                const fp = csatFrom.split('-').map(Number);
                const tp = csatTo.split('-').map(Number);
                const fromTs = Math.floor(Date.UTC(fp[0], fp[1] - 1, fp[2]) / 1000) - DHAKA_OFFSET;
                const toTs = Math.floor(Date.UTC(tp[0], tp[1] - 1, tp[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;
                const enqBody = {
                    start_time: fromTs,
                    end_time: toTs,
                    dataset_id: 'conversation_rating_sent',
                    attribute_ids: [
                        'conversation_id', 'conversation_started_at', 'conversation_rating',
                        'conversation_rating_remark', 'channel', 'user_location_country_code',
                        'currently_assigned_teammate_id', 'current_conversation_state',
                        'conversation_tag_ids', 'rated_teammate_id', 'rated_agent_type'
                    ]
                };
                const enqResp = await fetchIntercom('/export/reporting_data/enqueue', { method: 'POST', body: JSON.stringify(enqBody) });
                if (!enqResp.ok) return res.status(200).json({ success: false, error: `enqueue failed: ${enqResp.status} ${JSON.stringify(enqResp.data)}` });
                const jobId = enqResp.data?.job_identifier ?? enqResp.data?.job_id ?? enqResp.data?.id;
                if (!jobId) return res.status(200).json({ success: false, error: 'Missing job_identifier', raw: enqResp.data });
                return res.status(200).json({ success: true, jobId, status: enqResp.data?.status || 'pending' });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'csat-enqueue failed: ' + (e.message || String(e)) });
            }
        }

        // ============ CSAT: Poll export job ============
        if (action === 'csat-poll') {
            const { jobId } = req.body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            try {
                const resp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!resp.ok) return res.status(200).json({ success: false, error: `Poll: ${resp.status}` });
                return res.status(200).json({ success: true, status: resp.data?.status || 'unknown' });
            } catch (e) {
                return res.status(200).json({ success: false, error: e.message });
            }
        }

        // ============ CSAT: Download CSV, map & import to CSAT New table ============
        if (action === 'csat-download-import') {
            const { jobId, ratingDate } = req.body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            const DHAKA_OFFSET_MS = 6 * 3600 * 1000;

            function parseFullCSV(csvText) {
                const rows = [];
                let row = [], field = '', inQuotes = false;
                for (let i = 0; i < csvText.length; i++) {
                    const c = csvText[i];
                    if (c === '"') { if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') { field += '"'; i++; } else inQuotes = !inQuotes; }
                    else if (c === ',' && !inQuotes) { row.push(field.trim()); field = ''; }
                    else if (c === '\n' && !inQuotes) { row.push(field.trim()); if (row.some(f => f !== '')) rows.push(row); row = []; field = ''; }
                    else if (c === '\r' && !inQuotes) {}
                    else field += c;
                }
                row.push(field.trim());
                if (row.some(f => f !== '')) rows.push(row);
                return rows;
            }

            function httpsRequestBinary(url, opts = {}) {
                return new Promise((resolve, reject) => {
                    const urlObj = new URL(url);
                    const reqOpts = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: opts.method || 'GET', headers: opts.headers || {} };
                    const req2 = https.request(reqOpts, (res2) => {
                        if (res2.statusCode >= 300 && res2.statusCode < 400 && res2.headers.location) return httpsRequestBinary(res2.headers.location, opts).then(resolve).catch(reject);
                        const chunks = [];
                        res2.on('data', chunk => chunks.push(chunk));
                        res2.on('end', () => resolve({ ok: res2.statusCode >= 200 && res2.statusCode < 300, status: res2.statusCode, buffer: Buffer.concat(chunks) }));
                    });
                    req2.on('error', reject);
                    req2.end();
                });
            }

            try {
                const dlResp = await httpsRequestBinary(`https://api.intercom.io/download/reporting_data/${jobId}`, {
                    headers: { 'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, 'Accept': 'application/octet-stream', 'Intercom-Version': '2.14' }
                });
                if (!dlResp.ok) return res.status(200).json({ success: false, error: `Download: ${dlResp.status}` });
                let csvBuffer = dlResp.buffer;
                if (csvBuffer[0] === 0x1f && csvBuffer[1] === 0x8b) csvBuffer = zlib.gunzipSync(csvBuffer);
                const csvText = csvBuffer.toString('utf8');
                const allRows = parseFullCSV(csvText);
                if (allRows.length < 2) return res.status(200).json({ success: true, imported: 0, totalCsvRows: 0 });

                const headers = allRows[0];
                // Map CSV headers to CSAT New columns
                function mapHeader(h) {
                    const l = h.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
                    const MAP = {
                        'conversation id': '_conv_id',
                        'conversation_id': '_conv_id',
                        'conversation started at': '_started_at',
                        'conversation_started_at': '_started_at',
                        'conversation rating': 'Conversation rating',
                        'conversation_rating': 'Conversation rating',
                        'country': 'Country',
                        'user_location_country_code': 'Country',
                        'user location country code': 'Country',
                        'channel': '_channel',
                    };
                    return MAP[l] || null;
                }
                const colMap = headers.map(h => mapHeader(h));

                const rows = [];
                for (let i = 1; i < allRows.length; i++) {
                    const csvRow = allRows[i];
                    const record = {};
                    let convId = null;
                    let startedAt = null;
                    for (let c = 0; c < headers.length; c++) {
                        const dbCol = colMap[c];
                        if (!dbCol) continue;
                        let val = csvRow[c] ?? '';
                        if (val === '') val = null;
                        if (dbCol === '_conv_id') { convId = val; continue; }
                        if (dbCol === '_started_at') { startedAt = val; continue; }
                        if (dbCol === '_channel') continue; // not in CSAT New
                        if (dbCol === 'Conversation rating' && val) {
                            const n = parseInt(val, 10);
                            record[dbCol] = isNaN(n) ? null : n;
                        } else {
                            record[dbCol] = val;
                        }
                    }
                    if (!convId) continue;
                    // Only include rows that have a rating
                    if (!record['Conversation rating']) continue;
                    record['Conversation ID'] = parseInt(convId, 10) || convId;
                    // Compute Dhaka date/time.
                    // ratingDate = the export window date (when the rating was submitted).
                    // Intercom's conversation_rating_sent dataset doesn't include the exact
                    // rating timestamp as a column, so we use the dateFrom/dateTo of the
                    // enqueue call as the authoritative date. The HH:MM still comes from
                    // conversation_started_at (best proxy for sorting within a day).
                    // Without ratingDate (legacy path), fall back to conversation_started_at date.
                    if (ratingDate) {
                        let timePart = '00:00';
                        if (startedAt) {
                            const d = new Date(startedAt);
                            if (!isNaN(d.getTime())) {
                                timePart = new Date(d.getTime() + DHAKA_OFFSET_MS).toISOString().split('T')[1].substring(0, 5);
                            }
                        }
                        record['Date'] = ratingDate;
                        record['Created at'] = `${ratingDate} ${timePart}`;
                    } else if (startedAt) {
                        const d = new Date(startedAt);
                        if (!isNaN(d.getTime())) {
                            const shifted = new Date(d.getTime() + DHAKA_OFFSET_MS);
                            const iso = shifted.toISOString();
                            const datePart = iso.split('T')[0];
                            const timePart = iso.split('T')[1].substring(0, 5);
                            record['Date'] = datePart;
                            record['Created at'] = `${datePart} ${timePart}`;
                        }
                    }
                    rows.push(record);
                }

                // Deduplicate by Conversation ID (keep last occurrence = latest rating)
                const deduped = {};
                for (const row of rows) {
                    deduped[row['Conversation ID']] = row;
                }
                const uniqueRows = Object.values(deduped);

                // Upsert to CSAT New
                let imported = 0;
                for (let s = 0; s < uniqueRows.length; s += 500) {
                    const chunk = uniqueRows.slice(s, s + 500);
                    const { error: insErr } = await sb.from('CSAT New').upsert(chunk, { onConflict: 'Conversation ID' });
                    if (insErr) return res.status(200).json({ success: false, error: 'Supabase upsert: ' + insErr.message, imported });
                    imported += chunk.length;
                }

                // Enrich Product Type from "Intercom Topic". The CSAT CSV doesn't
                // include it, and chart queries hard-filter on Product Type — so
                // missing it makes those charts go empty. If a row's Intercom Topic
                // entry hasn't synced yet (daily lag), it stays NULL and the nightly
                // backfill script picks it up.
                let productEnriched = 0;
                const idList = uniqueRows.map(r => r['Conversation ID']).filter(Boolean);
                for (let s = 0; s < idList.length; s += 500) {
                    const idsChunk = idList.slice(s, s + 500);
                    const { data: topics, error: tErr } = await sb.from('Intercom Topic')
                        .select('"Conversation ID", "Product"')
                        .in('"Conversation ID"', idsChunk)
                        .not('"Product"', 'is', null);
                    if (tErr) break;
                    for (const t of (topics || [])) {
                        const { error: upErr } = await sb.from('CSAT New')
                            .update({ 'Product Type': t['Product'] })
                            .eq('Conversation ID', t['Conversation ID']);
                        if (!upErr) productEnriched++;
                    }
                }

                return res.status(200).json({ success: true, imported, productEnriched, totalCsvRows: allRows.length - 1, csvHeaders: headers });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'csat-download-import: ' + (e.message || String(e)) });
            }
        }

        // ============ CSAT: Topic-independent Product Type patch ============
        // For CSAT New rows in date range with NULL "Product Type", fetch each
        // conversation from Intercom, derive Product from team name (CFD/Futures),
        // and PATCH "Product Type". Runs after csat-download-import in daily-sync
        // so Topic-sync lag doesn't leave CSAT charts empty for "yesterday".
        if (action === 'csat-patch-product-type') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            const from = dateFrom || dateTo;
            const to   = dateTo   || dateFrom;
            if (!from || !to) return res.status(200).json({ success: false, error: 'dateFrom/dateTo required' });
            const concurrency = Math.min(20, Math.max(1, Number(req.body?.concurrency) || 10));

            function deriveProduct(teamName) {
                if (!teamName) return null;
                if (/\(FUT\)|FUT-|Futures/i.test(teamName)) return 'Futures';
                if (/\(CFD\)|CFD:/i.test(teamName)) return 'CFD';
                if (/Email Support|Unassigned Email/i.test(teamName)) return 'CFD';
                return null;
            }

            try {
                const teamsResp = await fetchIntercom('/teams');
                if (!teamsResp.ok) return res.status(200).json({ success: false, error: `teams: ${teamsResp.status}` });
                const teamMap = {};
                for (const t of (teamsResp.data?.teams || teamsResp.data?.data || [])) {
                    if (t?.id != null && t?.name) teamMap[String(t.id)] = t.name;
                }

                const { data: nulls, error: nErr } = await sb.from('CSAT New')
                    .select('"Conversation ID"')
                    .gte('Date', from).lte('Date', to)
                    .or('Product Type.is.null,Product Type.eq.');
                if (nErr) return res.status(200).json({ success: false, error: 'select: ' + nErr.message });
                const ids = (nulls || []).map(r => r['Conversation ID']).filter(Boolean);
                if (!ids.length) return res.status(200).json({ success: true, total: 0, fromTopic: 0, derived: 0, skipped: 0, errors: 0, byProduct: { CFD: 0, Futures: 0, null: 0 } });

                // Phase 1: cheap join against "Intercom Topic" — same source the
                // inline csat-download-import enrichment uses. Most rows resolve here.
                let fromTopic = 0;
                const byProduct = { CFD: 0, Futures: 0, null: 0 };
                const TOPIC_CHUNK = 500;
                const matchedSet = new Set();
                for (let s = 0; s < ids.length; s += TOPIC_CHUNK) {
                    const idsChunk = ids.slice(s, s + TOPIC_CHUNK);
                    const { data: topics, error: tErr } = await sb.from('Intercom Topic')
                        .select('"Conversation ID", "Product"')
                        .in('"Conversation ID"', idsChunk)
                        .not('"Product"', 'is', null);
                    if (tErr) continue;
                    for (const t of (topics || [])) {
                        const cid = t['Conversation ID'];
                        const product = t['Product'];
                        if (!product) continue;
                        const { error: upErr } = await sb.from('CSAT New')
                            .update({ 'Product Type': product })
                            .eq('Conversation ID', cid);
                        if (!upErr) {
                            fromTopic++;
                            matchedSet.add(String(cid));
                            byProduct[product === 'CFD' || product === 'Futures' ? product : 'null']++;
                        }
                    }
                }

                // Phase 2: for whatever Topic didn't cover, fall back to live
                // /conversations + /teams derivation (the original behavior).
                const remaining = ids.filter(id => !matchedSet.has(String(id)));
                let derived = 0, skipped = 0, errors = 0;
                const queue = [...remaining];
                async function worker() {
                    while (queue.length) {
                        const id = queue.shift();
                        try {
                            const cr = await fetchIntercom(`/conversations/${encodeURIComponent(id)}`);
                            if (!cr.ok) { errors++; continue; }
                            const teamId = cr.data?.team_assignee_id != null ? String(cr.data.team_assignee_id) : null;
                            const teamName = teamId ? (teamMap[teamId] || null) : null;
                            const product = deriveProduct(teamName);
                            byProduct[product || 'null']++;
                            if (product) {
                                const { error: upErr } = await sb.from('CSAT New')
                                    .update({ 'Product Type': product })
                                    .eq('Conversation ID', id);
                                if (upErr) errors++; else derived++;
                            } else {
                                skipped++;
                            }
                        } catch (e) { errors++; }
                    }
                }
                await Promise.all(Array.from({ length: concurrency }, worker));

                return res.status(200).json({ success: true, total: ids.length, fromTopic, derived, skipped, errors, byProduct });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'csat-patch-product-type: ' + (e.message || String(e)) });
            }
        }

        // ============ CSAT: Sync rated conversations from the REST API ============
        // The reporting-data export (conversation_rating_sent / conversation datasets)
        // does NOT carry rating values in this workspace — it returns a trickle of old
        // rows with empty ratings. The ONLY reliable source is the conversations REST
        // search API, where conversation_rating.rating is populated. This action scans
        // conversations CREATED in [dateFrom,dateTo] (Dhaka), and upserts any with a
        // rating into "CSAT New", bucketed by RATING submission date (rating.created_at
        // → Dhaka). Country is left for a separate enrichment pass. One day fits well
        // inside the 300s function budget (~28 pages).
        if (action === 'csat-sync-rest') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            const from = dateFrom;
            const to   = dateTo || dateFrom;
            if (!from) return res.status(200).json({ success: false, error: 'dateFrom required (conversation-created window, Dhaka)' });
            const DHAKA_OFFSET = 6 * 3600;
            const DHAKA_OFFSET_MS = DHAKA_OFFSET * 1000;
            const startMs = Date.now();

            const fp = from.split('-').map(Number);
            const tp = to.split('-').map(Number);
            const d0 = Math.floor(Date.UTC(fp[0], fp[1]-1, fp[2]) / 1000) - DHAKA_OFFSET;
            const d1 = Math.floor(Date.UTC(tp[0], tp[1]-1, tp[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;

            try {
                let startingAfter = req.body?.cursor || null;
                let scanned = 0, rated = 0, pages = 0;
                const records = [];
                const maxPages = Math.min(200, Math.max(1, Number(req.body?.maxPages) || 60));

                while (pages < maxPages) {
                    if (Date.now() - startMs > 250000) break; // stay under Vercel 300s
                    const query = {
                        query: { operator: 'AND', value: [
                            { field: 'created_at', operator: '>', value: d0 },
                            { field: 'created_at', operator: '<', value: d1 }
                        ]},
                        // Stable sort is REQUIRED for correct cursor pagination — the
                        // default sort is on a mutating field (last activity), so paging
                        // through it silently skips/duplicates rows and undercounts.
                        sort: { field: 'created_at', order: 'ascending' },
                        pagination: { per_page: 150 }
                    };
                    if (startingAfter) query.pagination.starting_after = startingAfter;

                    const resp = await fetchIntercom('/conversations/search', { method: 'POST', body: JSON.stringify(query) });
                    if (!resp.ok) return res.status(200).json({ success: false, error: `search ${resp.status}: ${JSON.stringify(resp.data).slice(0,200)}`, scanned, rated });
                    const convs = resp.data?.conversations || [];
                    pages++;
                    for (const c of convs) {
                        scanned++;
                        const cr = c.conversation_rating || null;
                        const rv = cr && cr.rating;
                        if (!rv) continue;
                        rated++;
                        const ratingTs = cr.created_at || cr.updated_at || c.created_at;
                        const shifted = new Date(ratingTs * 1000 + DHAKA_OFFSET_MS).toISOString();
                        const datePart = shifted.split('T')[0];
                        const timePart = shifted.split('T')[1].substring(0, 5);
                        records.push({
                            'Conversation ID': parseInt(c.id, 10) || c.id,
                            'Conversation rating': rv,
                            'Date': datePart,
                            'Created at': `${datePart} ${timePart}`
                        });
                    }
                    const next = resp.data?.pages?.next;
                    startingAfter = next && next.starting_after ? next.starting_after : (typeof next === 'string' ? next : null);
                    if (!startingAfter) break;
                }

                // Deduplicate by Conversation ID (keep last = latest rating)
                const deduped = {};
                for (const r of records) deduped[r['Conversation ID']] = r;
                const uniqueRows = Object.values(deduped);

                let upserted = 0;
                for (let s = 0; s < uniqueRows.length; s += 500) {
                    const chunk = uniqueRows.slice(s, s + 500);
                    const { error } = await sb.from('CSAT New').upsert(chunk, { onConflict: 'Conversation ID' });
                    if (error) return res.status(200).json({ success: false, error: 'upsert: ' + error.message, upserted });
                    upserted += chunk.length;
                }

                return res.status(200).json({
                    success: true, scanned, rated, upserted, pages,
                    nextCursor: startingAfter || null,
                    done: !startingAfter
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'csat-sync-rest: ' + (e.message || String(e)) });
            }
        }

        // ============ CSAT: Backfill Date/Created-at by re-exporting from Intercom ============
        // Intercom's conversation_rating_sent CSV only includes conversation_started_at,
        // not the actual rating submission timestamp. This action re-exports each day in
        // the given range and UPDATE-only fixes Date + Created at to the rating day,
        // without touching categories/product type (safe to re-run). Processes up to
        // maxDays per call; returns nextDate so the caller can chain.
        if (action === 'csat-redate-range') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            const from = dateFrom;
            const to   = dateTo || dateFrom;
            if (!from || !to) return res.status(200).json({ success: false, error: 'dateFrom/dateTo required' });
            const maxDays = Math.min(60, Math.max(1, Number(req.body?.maxDays) || 20));
            const DHAKA_OFFSET = 6 * 3600;
            const DHAKA_OFFSET_MS = DHAKA_OFFSET * 1000;
            const startedAt_MS = Date.now();

            function parseCsatCsv(csvText) {
                const allRows = [];
                let row = [], field = '', inQ = false;
                for (let i = 0; i < csvText.length; i++) {
                    const c = csvText[i];
                    if (c === '"') { if (inQ && i+1 < csvText.length && csvText[i+1] === '"') { field += '"'; i++; } else inQ = !inQ; }
                    else if (c === ',' && !inQ) { row.push(field.trim()); field = ''; }
                    else if (c === '\n' && !inQ) { row.push(field.trim()); if (row.some(f => f !== '')) allRows.push(row); row = []; field = ''; }
                    else if (c === '\r' && !inQ) {}
                    else field += c;
                }
                row.push(field.trim());
                if (row.some(f => f !== '')) allRows.push(row);
                return allRows;
            }

            // Build list of dates to process
            const dates = [];
            let cur = new Date(from + 'T00:00:00Z');
            const end = new Date(to + 'T00:00:00Z');
            while (cur <= end && dates.length < maxDays) {
                dates.push(cur.toISOString().split('T')[0]);
                cur = new Date(cur.getTime() + 86400000);
            }
            const nextDate = dates.length >= maxDays && end > new Date(dates[dates.length - 1] + 'T00:00:00Z')
                ? new Date(new Date(dates[dates.length - 1] + 'T00:00:00Z').getTime() + 86400000).toISOString().split('T')[0]
                : null;

            const results = [];
            let totalUpdated = 0;

            for (const ratingDate of dates) {
                // Bail out with 90s to spare so Vercel doesn't hard-kill the response
                if (Date.now() - startedAt_MS > 480000) {
                    results.push({ date: ratingDate, skipped: true, reason: 'timeout' });
                    break;
                }

                const fp = ratingDate.split('-').map(Number);
                const fromTs = Math.floor(Date.UTC(fp[0], fp[1]-1, fp[2]) / 1000) - DHAKA_OFFSET;
                const toTs   = Math.floor(Date.UTC(fp[0], fp[1]-1, fp[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;

                try {
                    // 1. Enqueue
                    const enqResp = await fetchIntercom('/export/reporting_data/enqueue', {
                        method: 'POST',
                        body: JSON.stringify({
                            start_time: fromTs, end_time: toTs,
                            dataset_id: 'conversation_rating_sent',
                            attribute_ids: ['conversation_id', 'conversation_started_at', 'conversation_rating']
                        })
                    });
                    if (!enqResp.ok) { results.push({ date: ratingDate, error: `enqueue ${enqResp.status}` }); continue; }
                    const jobId = enqResp.data?.job_identifier ?? enqResp.data?.job_id ?? enqResp.data?.id;
                    if (!jobId) { results.push({ date: ratingDate, error: 'no jobId' }); continue; }

                    // 2. Poll until complete (max 24 * 5s = 2 min)
                    let status = 'pending';
                    for (let p = 0; p < 24; p++) {
                        await new Promise(r => setTimeout(r, 5000));
                        const pr = await fetchIntercom(`/export/reporting_data/${jobId}`);
                        status = pr.ok ? (pr.data?.status || 'unknown') : 'error';
                        if (status === 'complete' || status === 'completed' || status === 'failed') break;
                    }
                    if (status !== 'complete' && status !== 'completed') {
                        results.push({ date: ratingDate, error: `job ${status}` }); continue;
                    }

                    // 3. Download CSV (inline fetch to avoid hoisting shadowing from other if-blocks)
                    const dlResult = await new Promise((resolve, reject) => {
                        const u = new URL(`https://api.intercom.io/download/reporting_data/${jobId}`);
                        const req2 = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { Authorization: `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, Accept: 'application/octet-stream', 'Intercom-Version': '2.14' } }, (res2) => {
                            if (res2.statusCode >= 300 && res2.statusCode < 400 && res2.headers.location) {
                                const loc = res2.headers.location;
                                const u2 = new URL(loc);
                                const rr = https.request({ hostname: u2.hostname, path: u2.pathname + u2.search, method: 'GET', headers: {} }, (res3) => {
                                    const ch = []; res3.on('data', c => ch.push(c)); res3.on('end', () => resolve({ ok: res3.statusCode < 300, buffer: Buffer.concat(ch) }));
                                }); rr.on('error', reject); rr.end(); return;
                            }
                            const ch = []; res2.on('data', c => ch.push(c)); res2.on('end', () => resolve({ ok: res2.statusCode < 300, buffer: Buffer.concat(ch) }));
                        }); req2.on('error', reject); req2.end();
                    });
                    let csvBuf = dlResult.buffer;
                    if (csvBuf[0] === 0x1f && csvBuf[1] === 0x8b) csvBuf = zlib.gunzipSync(csvBuf);
                    const allRows = parseCsatCsv(csvBuf.toString('utf8'));
                    if (allRows.length < 2) { results.push({ date: ratingDate, updated: 0 }); continue; }

                    // 4. Parse headers, extract (convId, startedAt, rating) pairs
                    const hdrs = allRows[0];
                    const iConvId   = hdrs.findIndex(h => /conversation.?id/i.test(h));
                    const iStarted  = hdrs.findIndex(h => /conversation.?started.?at/i.test(h));
                    const iRating   = hdrs.findIndex(h => /conversation.?rating(?!.remark)/i.test(h));

                    let updated = 0;
                    for (let i = 1; i < allRows.length; i++) {
                        const r = allRows[i];
                        const convId   = iConvId  >= 0 ? (parseInt(r[iConvId],  10) || r[iConvId])  : null;
                        const startAt  = iStarted >= 0 ? r[iStarted] : null;
                        const ratingV  = iRating  >= 0 ? parseInt(r[iRating],  10) : NaN;
                        if (!convId || isNaN(ratingV) || !ratingV) continue;

                        // Derive time-of-day from conversation_started_at (only HH:MM matters for sorting)
                        let timePart = '00:00';
                        if (startAt) {
                            const d = new Date(startAt);
                            if (!isNaN(d.getTime())) {
                                timePart = new Date(d.getTime() + DHAKA_OFFSET_MS).toISOString().split('T')[1].substring(0, 5);
                            }
                        }

                        // UPDATE-only: leave Conversation rating, Country, Product Type, categories intact
                        const { error: upErr } = await sb.from('CSAT New')
                            .update({ 'Date': ratingDate, 'Created at': `${ratingDate} ${timePart}` })
                            .eq('Conversation ID', convId)
                            .neq('Date', ratingDate);
                        if (!upErr) updated++;
                    }

                    results.push({ date: ratingDate, updated });
                    totalUpdated += updated;
                } catch (e) {
                    results.push({ date: ratingDate, error: e.message || String(e) });
                }
            }

            return res.status(200).json({ success: true, totalUpdated, results, nextDate });
        }

        // ============ TICKETS: Recompute SLA for ticket_logs in a date range ============
        // Re-applies resolveTeamCode + computeSlaForTicket against the current sla_rules
        // table. Useful after a sla_rules edit so historical rows reflect the new policy.
        if (action === 'ticket-sla-recompute') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            const from = dateFrom;
            const to   = dateTo || dateFrom;
            if (!from || !to) return res.status(200).json({ success: false, error: 'dateFrom (and optional dateTo) required' });

            try {
                const slaRules = await loadSlaRules(sb);
                if (!slaRules.byTeam.size && !slaRules.byCategory.size) {
                    return res.status(200).json({ success: false, error: 'sla_rules empty' });
                }

                const PAGE = 1000;
                let offset = 0;
                let total = 0, changed = 0, unchanged = 0, errors = 0;
                const statusFlips = { 'Met→Missed': 0, 'Missed→Met': 0, 'NA→Met': 0, 'NA→Missed': 0, 'Met→NA': 0, 'Missed→NA': 0 };
                const updates = [];

                while (true) {
                    const r = await fetch(
                        `${supabaseUrl}/rest/v1/ticket_logs?select=unique_id,date,created_at,current_team,issue_category,ticket_sla_duration_seconds,sla,sla_limit_hours,ticket_sla_status,ticket_sla_limit_hours,resolved_during_office_hours&date=gte.${from}&date=lte.${to}&order=date.asc&offset=${offset}&limit=${PAGE}`,
                        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
                    );
                    if (!r.ok) return res.status(200).json({ success: false, error: 'fetch ticket_logs: ' + (await r.text()) });
                    const rows = await r.json();
                    if (!rows.length) break;
                    total += rows.length;

                    for (const row of rows) {
                        const createdAtUnix = row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : 0;
                        const durationSeconds = row.ticket_sla_duration_seconds != null ? Number(row.ticket_sla_duration_seconds) : null;
                        const teamCode = resolveTeamCode(slaRules, row.issue_category, row.current_team);
                        const result = computeSlaForTicket(slaRules, teamCode, row.issue_category, createdAtUnix, durationSeconds);

                        const sameStatus = (row.sla || 'N/A') === result.sla_status;
                        const sameLimit  = Number(row.sla_limit_hours || 0) === Number(result.sla_limit_hours || 0);
                        const sameOffice = (row.resolved_during_office_hours ?? null) === (result.resolved_during_office ?? null);
                        if (sameStatus && sameLimit && sameOffice) { unchanged++; continue; }

                        const before = row.sla || 'N/A';
                        const after = result.sla_status;
                        if (before !== after) {
                            const k = `${before === 'N/A' ? 'NA' : before}→${after === 'N/A' ? 'NA' : after}`;
                            if (statusFlips[k] != null) statusFlips[k]++;
                        }
                        updates.push({
                            unique_id: row.unique_id,
                            sla: result.sla_status,
                            sla_limit_hours: result.sla_limit_hours,
                            ticket_sla_status: result.sla_status,
                            ticket_sla_limit_hours: result.sla_limit_hours,
                            resolved_during_office_hours: result.resolved_during_office,
                        });
                    }

                    if (rows.length < PAGE) break;
                    offset += PAGE;
                }

                // Apply updates in chunks via PATCH (per-row, parallel pool=10)
                if (updates.length) {
                    const queue = [...updates];
                    const CONC = 10;
                    async function worker() {
                        while (queue.length) {
                            const u = queue.shift();
                            const { unique_id, ...patch } = u;
                            const r = await fetch(`${supabaseUrl}/rest/v1/ticket_logs?unique_id=eq.${encodeURIComponent(unique_id)}`, {
                                method: 'PATCH',
                                headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                                body: JSON.stringify(patch),
                            });
                            if (!r.ok) errors++; else changed++;
                        }
                    }
                    await Promise.all(Array.from({ length: CONC }, worker));
                }

                return res.status(200).json({ success: true, dateFrom: from, dateTo: to, total, changed, unchanged, errors, statusFlips });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'ticket-sla-recompute: ' + (e.message || String(e)) });
            }
        }

        // ============ FIN SPO: Enqueue Conversation dataset for FIN table ============
        if (action === 'fin-enqueue') {
            const finFrom = dateFrom || '2026-01-01';
            const finTo = dateTo || '2026-03-25';
            try {
                const DHAKA_OFFSET = 6 * 3600;
                const fp = finFrom.split('-').map(Number);
                const tp = finTo.split('-').map(Number);
                const fromTs = Math.floor(Date.UTC(fp[0], fp[1]-1, fp[2]) / 1000) - DHAKA_OFFSET;
                const toTs = Math.floor(Date.UTC(tp[0], tp[1]-1, tp[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;
                const enqBody = {
                    start_time: fromTs, end_time: toTs,
                    dataset_id: 'conversation',
                    attribute_ids: ['conversation_id','conversation_started_at','channel','user_location_country_code','current_conversation_state','fin_ai_agent_participated','fin_ai_agent_deflected','fin_ai_agent_last_sent_answer_type','fin_ai_agent_resolution_state']
                };
                const enqResp = await fetchIntercom('/export/reporting_data/enqueue', { method: 'POST', body: JSON.stringify(enqBody) });
                if (!enqResp.ok) return res.status(200).json({ success: false, error: `enqueue: ${enqResp.status} ${JSON.stringify(enqResp.data)}` });
                const jobId = enqResp.data?.job_identifier ?? enqResp.data?.job_id ?? enqResp.data?.id;
                if (!jobId) return res.status(200).json({ success: false, error: 'Missing job_identifier' });
                return res.status(200).json({ success: true, jobId, status: enqResp.data?.status || 'pending' });
            } catch (e) { return res.status(200).json({ success: false, error: 'fin-enqueue: ' + (e.message || String(e)) }); }
        }

        if (action === 'fin-poll') {
            const { jobId } = req.body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            try {
                const resp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!resp.ok) return res.status(200).json({ success: false, error: `Poll: ${resp.status}` });
                return res.status(200).json({ success: true, status: resp.data?.status || 'unknown' });
            } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
        }

        if (action === 'fin-download-import') {
            const { jobId } = req.body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sbFin = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
            const DHAKA_MS = 6*3600*1000;
            function mapFinH(h) {
                const l = h.trim().replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
                const M = { 'conversation id':'conversation_id','conversation_id':'conversation_id','conversation started at':'_started_at','conversation_started_at':'_started_at','channel':'channel','country':'country','user_location_country_code':'country','user location country code':'country','current conversation state':'state','current_conversation_state':'state','state':'state','fin ai agent involved':'FIN AI Agent involved','fin_ai_agent_participated':'FIN AI Agent involved','fin ai agent participated':'FIN AI Agent involved','fin ai agent deflected':'FIN AI Agent deflected','fin_ai_agent_deflected':'FIN AI Agent deflected','fin ai agent last sent answer':'FIN AI Agent last sent answer','fin_ai_agent_last_sent_answer_type':'FIN AI Agent last sent answer','fin_ai_agent_last_sent_answer':'FIN AI Agent last sent answer','fin ai agent resolution state':'FIN AI Agent resolution state','fin_ai_agent_resolution_state':'FIN AI Agent resolution state' };
                return M[l] || null;
            }
            function pCsv(t){const r=[];let w=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(c==='"'){if(q&&i+1<t.length&&t[i+1]==='"'){f+='"';i++}else q=!q}else if(c===','&&!q){w.push(f.trim());f=''}else if(c==='\n'&&!q){w.push(f.trim());if(w.some(x=>x!==''))r.push(w);w=[];f=''}else if(c==='\r'&&!q){}else f+=c}w.push(f.trim());if(w.some(x=>x!==''))r.push(w);return r}
            function hBin(url,o={}){return new Promise((res,rej)=>{const u=new URL(url);const op={hostname:u.hostname,path:u.pathname+u.search,method:o.method||'GET',headers:o.headers||{}};const rq=https.request(op,r=>{if(r.statusCode>=300&&r.statusCode<400&&r.headers.location)return hBin(r.headers.location,o).then(res).catch(rej);const ch=[];r.on('data',c=>ch.push(c));r.on('end',()=>res({ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,buffer:Buffer.concat(ch)}))});rq.on('error',rej);rq.end()})}
            try {
                const dl = await hBin(`https://api.intercom.io/download/reporting_data/${jobId}`, { headers: { 'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, 'Accept': 'application/octet-stream', 'Intercom-Version': '2.14' } });
                if (!dl.ok) return res.status(200).json({ success: false, error: `Download: ${dl.status}` });
                let buf = dl.buffer;
                if (buf[0]===0x1f&&buf[1]===0x8b) buf = zlib.gunzipSync(buf);
                const allRows = pCsv(buf.toString('utf8'));
                if (allRows.length<2) return res.status(200).json({ success: true, imported: 0, totalCsvRows: 0 });
                const hds = allRows[0];
                const cm = hds.map(h => mapFinH(h));
                const rows = [];
                for (let i=1;i<allRows.length;i++) {
                    const cr = allRows[i]; const rec = {}; let sa = null;
                    for (let c=0;c<hds.length;c++){const db=cm[c];if(!db)continue;let v=cr[c]??'';if(v==='')v=null;if(db==='_started_at'){sa=v;continue}rec[db]=v}
                    if (!rec.conversation_id) continue;
                    if (sa){
                        // Store as GMT+6 display: convert UTC to Dhaka time string with +06:00 suffix
                        const d=new Date(sa);
                        if(!isNaN(d.getTime())){
                            const dhaka=new Date(d.getTime()+DHAKA_MS);
                            const iso=dhaka.toISOString(); // e.g. 2026-03-24T00:00:02.000Z (shifted)
                            rec.created_at=iso.replace('Z','+06:00'); // → 2026-03-24T00:00:02.000+06:00
                        }
                    }
                    // Only keep Chat conversations where FIN was involved
                    if (rec.channel && rec.channel !== 'Chat') continue;
                    if (rec['FIN AI Agent involved'] !== 'true') continue;
                    rows.push(rec);
                }
                const dd={};for(const r of rows)dd[r.conversation_id]=r;const uq=Object.values(dd);
                let imp=0;
                for(let s=0;s<uq.length;s+=500){const ch=uq.slice(s,s+500);const{error:e}=await sbFin.from('FIN - Service Performance Overview').upsert(ch,{onConflict:'conversation_id,assignee_id'});if(e)return res.status(200).json({success:false,error:'Upsert: '+e.message,imported:imp});imp+=ch.length}
                return res.status(200).json({ success: true, imported: imp, totalCsvRows: allRows.length-1 });
            } catch (e) { return res.status(200).json({ success: false, error: 'fin-download-import: ' + (e.message || String(e)) }); }
        }

        // ============ LIST INTERCOM ADMINS ============
        if (action === 'list-admins') {
            try {
                const resp = await fetchIntercom('/admins');
                if (!resp.ok) return res.status(200).json({ success: false, error: `Intercom admins: ${resp.status}` });
                const admins = (resp.data.admins || resp.data.data || [])
                    .filter(a => a.type === 'admin' && a.name)
                    .map(a => a.name)
                    .sort();
                return res.status(200).json({ success: true, admins });
            } catch (e) {
                return res.status(200).json({ success: false, error: e.message });
            }
        }

        if (action === 'list-ticket-types') {
            try {
                const resp = await fetchIntercom('/ticket_types');
                if (!resp.ok) return res.status(200).json({ success: false, error: `Intercom: ${resp.status}` });
                return res.status(200).json({ success: true, data: resp.data });
            } catch (e) {
                return res.status(200).json({ success: false, error: e.message });
            }
        }

        if (action === 'list-teams') {
            try {
                const resp = await fetchIntercom('/teams');
                if (!resp.ok) return res.status(200).json({ success: false, error: `Intercom teams: ${resp.status}` });
                const admResp = await fetchIntercom('/admins');
                const adminMap = {};
                if (admResp.ok) (admResp.data.admins || []).forEach(a => { adminMap[String(a.id)] = a.name || a.email; });
                const teams = (resp.data.teams || []).map(t => ({
                    id: t.id, name: t.name,
                    members: (t.admin_ids || []).map(id => adminMap[String(id)] || id)
                }));
                return res.status(200).json({ success: true, teams });
            } catch (e) {
                return res.status(200).json({ success: false, error: e.message });
            }
        }

        // ============ SPO TEST: Pull conversations from Intercom — exact same logic as spo-enrich ============
        // ============ SPO TEST DEBUG: Trace ART events for a conversation ============
        if (action === 'spo-test-debug') {
            const cid = conversationId;
            if (!cid) return res.status(400).json({ error: 'conversationId required' });
            try {
                const resp = await fetchIntercom(`/conversations/${cid}?display_as=plaintext`);
                if (!resp.ok) return res.status(200).json({ success: false, error: `Intercom: ${resp.status}` });
                const conv = resp.data;
                const parts = conv.conversation_parts?.conversation_parts || [];
                const events = []; // { type, agent, time, iso, detail }
                const agentUserMsg = {};
                const agentFrtDone = {};
                let lastUserMsgTime = null;

                function isBot(a) {
                    if (!a) return true;
                    const n = (a.name||'').toLowerCase();
                    return a.type==='bot'||n.includes('fundednext ai')||n==='fin'||n.includes('operator')||n.includes('workflow');
                }

                for (const part of parts) {
                    if (!part.created_at) continue;
                    const pt = part.part_type || '';
                    const iso = new Date(part.created_at * 1000).toISOString();

                    if (part.author?.type === 'user' && part.body) {
                        lastUserMsgTime = part.created_at;
                        for (const aid in agentFrtDone) agentUserMsg[aid] = part.created_at;
                        events.push({ type: 'USER_MSG', time: part.created_at, iso, body: (part.body||'').substring(0,80) });
                        continue;
                    }

                    if (part.author?.type === 'admin' && pt === 'comment' && !isBot(part.author)) {
                        const aid = String(part.author.id);
                        const name = part.author.name || aid;

                        if (!agentFrtDone[aid]) {
                            agentFrtDone[aid] = true;
                            agentUserMsg[aid] = null; // reset after FRT
                            events.push({ type: 'FRT', agent: name, agentId: aid, time: part.created_at, iso });
                        } else if (agentUserMsg[aid]) {
                            const rt = part.created_at - agentUserMsg[aid];
                            events.push({
                                type: 'ART_EVENT',
                                agent: name,
                                agentId: aid,
                                time: part.created_at,
                                iso,
                                userMsgTime: agentUserMsg[aid],
                                userMsgIso: new Date(agentUserMsg[aid] * 1000).toISOString(),
                                responseTime: rt,
                                responseTimeFormatted: rt < 60 ? `${rt}s` : `${Math.floor(rt/60)}m ${rt%60}s`
                            });
                            agentUserMsg[aid] = null;
                        }
                    }
                }

                // Summarize per agent
                const agentSummary = {};
                for (const e of events) {
                    if (e.type === 'ART_EVENT') {
                        if (!agentSummary[e.agent]) agentSummary[e.agent] = { events: [], total: 0 };
                        agentSummary[e.agent].events.push(e.responseTime);
                        agentSummary[e.agent].total += e.responseTime;
                    }
                }
                for (const [name, s] of Object.entries(agentSummary)) {
                    s.avg = Math.round(s.total / s.events.length);
                    s.count = s.events.length;
                }

                return res.status(200).json({ success: true, conversationId: cid, totalParts: parts.length, events, agentSummary });
            } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
        }

        if (action === 'spo-test') {
            const { dateFrom: df, dateTo: dt, agentName: agent, limit: lim, conversationId: cidParam } = req.body || {};
            const singleCid = typeof cidParam === 'string' ? cidParam.trim() : '';
            if (!singleCid && (!df || !dt)) return res.status(400).json({ error: 'dateFrom and dateTo required' });
            const convLimit = Math.min(parseInt(lim) || 50, 500);

            const DHAKA_OFFSET = 6 * 3600;
            let fromTs = 0, toTs = 0;
            if (df && dt) {
                const fromParts = df.split('-').map(Number);
                const toParts = dt.split('-').map(Number);
                fromTs = Math.floor(Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]) / 1000) - DHAKA_OFFSET;
                toTs = Math.floor(Date.UTC(toParts[0], toParts[1] - 1, toParts[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;
            }

            // ---- Exact helpers from spo-enrich ----
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
            function _getAgentName(author) {
                if (!author || _isBot(author)) return null;
                return author.name || null;
            }
            // AHT = sum over each open->close cycle of (FRT -> the agent's first park). FRT = first human
            // reply; park = agent's own snooze/close/transfer. Bot auto-close is not a park (idle tail excluded);
            // reopen gaps fall between cycles, so a reopened chat contributes multiple FRT->park segments.
            // Credited to the cycle's FRT agent; falls back to last human reply if bot-closed without a park.
            // Reopen cycles ('open' event) with no client message are excluded -- no interaction, no AHT.
            function _computeOwnershipAHT(conv) {
                const parts = ((conv.conversation_parts && conv.conversation_parts.conversation_parts) || []).slice().sort((a, b) => a.created_at - b.created_at);
                const per = {};
                let frt = null, agent = null, park = null, lastReply = null;
                let isReopenedCycle = false;
                let clientMessageSinceOpen = false;
                const endCycle = () => {
                    const shouldCount = !isReopenedCycle || clientMessageSinceOpen;
                    if (shouldCount && agent !== null && frt !== null) { const end = park !== null ? park : lastReply; if (end !== null && end > frt) per[agent] = (per[agent] || 0) + (end - frt); }
                    frt = null; agent = null; park = null; lastReply = null;
                };
                for (const p of parts) {
                    const t = p.created_at;
                    const human = p.author?.type === 'admin' && !_isBot(p.author);
                    if (p.part_type === 'open') { endCycle(); isReopenedCycle = true; clientMessageSinceOpen = false; continue; }
                    if (p.part_type === 'close') { if (human && frt !== null && park === null) park = t; endCycle(); clientMessageSinceOpen = false; continue; }
                    if (p.author?.type === 'user') { clientMessageSinceOpen = true; continue; }
                    if (p.part_type === 'comment' && human) {
                        const name = _getAgentName(p.author);
                        if (!name) continue;
                        if (frt === null) { frt = t; agent = name; }
                        lastReply = t;
                    } else if ((p.part_type === 'snoozed' || p.part_type === 'assignment' || p.part_type === 'away_mode_assignment') && human) {
                        if (frt !== null && park === null) park = t;
                    }
                }
                endCycle();
                return per;
            }

            // ---- Exact _calcMetrics from spo-enrich ----
            function _calcMetrics(conv) {
                const convCreated = conv.created_at;
                const agentMetrics = {};
                const agentAssignTimes = {};       // by agent ID
                const agentAssignByName = {};      // by agent name (lowercase) → { time, name }
                let connectToAgentTime = null;
                let assignmentTime = null;
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

                        if (pt === 'close' || pt === 'conversation_close') { conversationClosed = true; continue; }
                        if (conversationClosed && part.author?.type === 'user') isAfterReopen = true;

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
                            // Extract agent name from assignment body and store by name
                            if (part.body && typeof part.body === 'string') {
                                const m = part.body.match(/Assignment:\s*([^(]+)/i);
                                if (m) {
                                    const an = m[1].trim();
                                    // Store by name so we can match when agent replies later
                                    agentAssignByName[an.toLowerCase()] = { time: part.created_at, name: an };
                                    // Also try to match against already-known agents
                                    for (const [id, ag] of Object.entries(agentMetrics)) {
                                        if (ag.agentName && ag.agentName.toLowerCase() === an.toLowerCase()) {
                                            agentAssignTimes[id] = part.created_at;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        if (part.body && typeof part.body === 'string') {
                            const bl = part.body.toLowerCase();
                            if (bl.includes('balanced assignment') || (bl.includes('assigned') && !bl.includes('team assignment'))) {
                                // Always update assignmentTime for transfers (removed !assignmentTime check)
                                assignmentTime = part.created_at;
                            }
                        }

                        if (part.author?.type === 'admin' && pt === 'comment') {
                            if (_isBot(part.author)) continue;
                            const agentId = _getAgentId(part.author);
                            if (!agentId) continue;
                            if (!agentMetrics[agentId]) {
                                const agName = _getAgentName(part.author);
                                agentMetrics[agentId] = { agentId, agentName: agName, frt: null, artEvents: [], firstResponseTime: part.created_at, lastResponseTime: part.created_at, responseCount: 0 };
                                agentUserMsg[agentId] = null;

                                // Check if we have a stored assignment time by name for this agent
                                if (agName && agentAssignByName[agName.toLowerCase()]) {
                                    agentAssignTimes[agentId] = agentAssignByName[agName.toLowerCase()].time;
                                }
                                // If still no assignment time, check if lastAssignTime was set recently (likely their assignment)
                                if (!agentAssignTimes[agentId] && lastAssignTime) {
                                    agentAssignTimes[agentId] = lastAssignTime;
                                }
                            }
                            const ag = agentMetrics[agentId];
                            ag.responseCount++;
                            ag.lastResponseTime = part.created_at;
                            if (ag.frt === null) {
                                const aat = agentAssignTimes[agentId];
                                // If agent has a valid assignment time, always calculate FRT (even after reopen)
                                if (aat && part.created_at >= aat) {
                                    ag.frt = part.created_at - aat;
                                } else if (isAfterReopen && !aat) {
                                    // Only skip FRT for reopened chats if agent has NO assignment time
                                    ag.frt = -1;
                                } else if (lastAssignTime && part.created_at >= lastAssignTime) {
                                    ag.frt = part.created_at - lastAssignTime;
                                } else if (assignmentTime && part.created_at >= assignmentTime) {
                                    ag.frt = part.created_at - assignmentTime;
                                } else if (lastUserMsgTime && part.created_at >= lastUserMsgTime) {
                                    ag.frt = part.created_at - lastUserMsgTime;
                                } else {
                                    ag.frt = -1;
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

                const ownershipAht = _computeOwnershipAHT(conv);
                return Object.values(agentMetrics).map(ag => {
                    const isReopenFrt = ag.frt === -1;
                    const noFrt = isReopenFrt || ag.frt === null;
                    const effectiveFrt = noFrt ? null : ag.frt;
                    let art = null;
                    if (ag.artEvents.length > 0) art = Math.round(ag.artEvents.reduce((s, t) => s + t, 0) / ag.artEvents.length);
                    // AHT = active-ownership time (no idle/away). 0 if single-reply / unmeasurable.
                    const aht = ownershipAht[ag.agentName] != null ? ownershipAht[ag.agentName] : 0;
                    // Targets: FRT ≤ 30s, ART ≤ 70s. 1 = miss (above threshold), 0 = hit.
                    let frtHit = (effectiveFrt != null) ? (effectiveFrt > 30 ? 1 : 0) : null;
                    let artHit = null;
                    if (ag.artEvents.length > 0) artHit = Math.round((ag.artEvents.filter(t => t > 70).length / ag.artEvents.length) * 100);
                    let name = ag.agentName;
                    if (name && (name.toLowerCase().includes('fundednext ai') || name.toLowerCase() === 'fin')) name = 'FIN';
                    return { agentId: ag.agentId, agentName: name, frt: effectiveFrt, art, aht: aht > 0 ? aht : null, frtHitRate: frtHit, artHitRate: artHit, responseCount: ag.responseCount };
                });
            }

            try {
                // Step 0: If agent specified, resolve name → Intercom admin ID
                let adminIdFilter = null;
                if (agent && agent !== 'All') {
                    const adminsResp = await fetchIntercom('/admins');
                    if (adminsResp.ok) {
                        const allAdmins = adminsResp.data.admins || adminsResp.data.data || [];
                        const match = allAdmins.find(a => a.name === agent);
                        if (match) adminIdFilter = String(match.id);
                    }
                }

                // Process conversation: fetch full parts, run _calcMetrics
                async function processConv(convId) {
                    try {
                        const resp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
                        if (!resp.ok) return [];
                        const conv = resp.data;
                        const agentRows = _calcMetrics(conv);
                        return agentRows
                            .filter(ag => ag.agentName !== 'FIN')
                            .map(ag => ({
                                conversation_id: String(conv.id),
                                created_at: conv.created_at ? new Date(conv.created_at * 1000).toISOString() : null,
                                assignee_name: ag.agentName,
                                assignee_id: ag.agentId,
                                frt_seconds: ag.frt,
                                art_seconds: ag.art,
                                aht_seconds: ag.aht,
                                frt_hit_rate: ag.frtHitRate,
                                art_hit_rate: ag.artHitRate,
                                response_count: ag.responseCount
                            }));
                    } catch (e) { return []; }
                }

                // Short-circuit: when a specific conversation ID is provided, skip search and process it directly.
                if (singleCid) {
                    const rows = await processConv(singleCid);
                    const filtered = (agent && agent !== 'All')
                        ? rows.filter(row => row.assignee_name === agent)
                        : rows;
                    return res.status(200).json({
                        success: true,
                        data: filtered,
                        total: filtered.length,
                        uniqueConversations: filtered.length > 0 ? 1 : 0,
                        pagesSearched: 0,
                    });
                }

                // Search + process until we have exactly convLimit unique conversations with results
                const allRows = [];
                const seenConvIds = new Set();
                let startingAfter = null;
                let pages = 0;
                let searchDone = false;

                while (!searchDone && seenConvIds.size < convLimit && pages < 50) {
                    // Fetch a page of conversation IDs from search
                    pages++;
                    const queryFilters = [
                        { field: 'created_at', operator: '>', value: fromTs },
                        { field: 'created_at', operator: '<', value: toTs }
                    ];
                    if (adminIdFilter) {
                        queryFilters.push({ field: 'admin_assignee_id', operator: '=', value: parseInt(adminIdFilter) });
                    }
                    const searchBody = {
                        query: { operator: 'AND', value: queryFilters },
                        pagination: { per_page: 20 }
                    };
                    if (startingAfter) searchBody.pagination.starting_after = startingAfter;
                    const searchResp = await fetchIntercom('/conversations/search', { method: 'POST', body: JSON.stringify(searchBody) });
                    if (!searchResp.ok) return res.status(200).json({ success: false, error: `Intercom search: ${searchResp.status}` });

                    const pageConvs = (searchResp.data.conversations || []).map(c => String(c.id));
                    if (pageConvs.length === 0) break;

                    // Process this batch in parallel
                    const results = await Promise.allSettled(pageConvs.map(id => processConv(id)));
                    for (const r of results) {
                        if (r.status !== 'fulfilled' || !r.value || r.value.length === 0) continue;
                        const rows = r.value;
                        const cid = rows[0].conversation_id;
                        if (seenConvIds.has(cid)) continue;
                        // Apply agent name filter on results
                        const filtered = (agent && agent !== 'All')
                            ? rows.filter(row => row.assignee_name === agent)
                            : rows;
                        if (filtered.length === 0) continue;
                        seenConvIds.add(cid);
                        allRows.push(...filtered);
                        if (seenConvIds.size >= convLimit) break;
                    }

                    const next = searchResp.data.pages?.next?.starting_after;
                    if (!next) searchDone = true;
                    else startingAfter = next;
                }

                return res.status(200).json({ success: true, data: allRows, total: allRows.length, uniqueConversations: seenConvIds.size, pagesSearched: pages });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'spo-test failed: ' + (e.message || String(e)) });
            }
        }

        // ============ EMAIL SPO TEST ============
        if (action === 'spo-test-email') {
            const { dateFrom: df, dateTo: dt, agentName: agent, limit: lim, conversationId: cidParam } = req.body || {};
            const singleCid = typeof cidParam === 'string' ? cidParam.trim() : '';
            if (!singleCid && (!df || !dt)) return res.status(400).json({ error: 'dateFrom and dateTo required' });
            const convLimit = Math.min(parseInt(lim) || 50, 500);

            const DHAKA_OFFSET = 6 * 3600;
            let fromTs = 0, toTs = 0;
            if (df && dt) {
                const fromParts = df.split('-').map(Number);
                const toParts = dt.split('-').map(Number);
                fromTs = Math.floor(Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]) / 1000) - DHAKA_OFFSET;
                toTs = Math.floor(Date.UTC(toParts[0], toParts[1] - 1, toParts[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;
            }

            let adminMap = {};
            try {
                const admResp = await fetchIntercom('/admins');
                if (admResp.ok && admResp.data?.admins) {
                    admResp.data.admins.forEach(a => { adminMap[a.id] = a.name || a.email || 'Unknown'; });
                }
            } catch (_) {}

            async function processConvEmail(convId) {
                try {
                    const resp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
                    if (!resp.ok) return [];
                    const conv = resp.data;
                    const replies = _calcMetricsEmail(conv, adminMap);
                    return replies.map(r => ({
                        conversation_id: String(conv.id),
                        created_at: r.replyTime ? new Date(r.replyTime * 1000).toISOString() : null,
                        assignee_name: r.agentName,
                        assignee_id: r.agentId,
                        art_seconds: r.art,
                        sla_hit: r.slaHit,
                        sla_hit_rate: r.slaHit != null ? (r.slaHit * 100) : null,
                        response_count: 1
                    }));
                } catch (e) { return []; }
            }

            try {
                let adminIdFilter = null;
                if (agent && agent !== 'All') {
                    const adminsResp = await fetchIntercom('/admins');
                    if (adminsResp.ok) {
                        const allAdmins = adminsResp.data.admins || adminsResp.data.data || [];
                        const match = allAdmins.find(a => a.name === agent);
                        if (match) adminIdFilter = String(match.id);
                    }
                }

                // Short-circuit: when a specific conversation ID is provided, skip search and process it directly.
                if (singleCid) {
                    const rows = await processConvEmail(singleCid);
                    const filtered = (agent && agent !== 'All')
                        ? rows.filter(row => row.assignee_name === agent)
                        : rows;
                    return res.status(200).json({
                        success: true,
                        data: filtered,
                        total: filtered.length,
                        uniqueConversations: filtered.length > 0 ? 1 : 0,
                        pagesSearched: 0,
                    });
                }

                const allRows = [];
                const seenConvIds = new Set();
                let startingAfter = null;
                let pages = 0;
                let searchDone = false;

                while (!searchDone && seenConvIds.size < convLimit && pages < 50) {
                    pages++;
                    const queryFilters = [
                        { field: 'created_at', operator: '>', value: fromTs },
                        { field: 'created_at', operator: '<', value: toTs },
                        { field: 'source.type', operator: '=', value: 'email' }
                    ];
                    if (adminIdFilter) {
                        queryFilters.push({ field: 'admin_assignee_id', operator: '=', value: parseInt(adminIdFilter) });
                    }
                    const searchBody = {
                        query: { operator: 'AND', value: queryFilters },
                        pagination: { per_page: 20 }
                    };
                    if (startingAfter) searchBody.pagination.starting_after = startingAfter;
                    const searchResp = await fetchIntercom('/conversations/search', { method: 'POST', body: JSON.stringify(searchBody) });
                    if (!searchResp.ok) return res.status(200).json({ success: false, error: `Intercom search: ${searchResp.status}` });

                    const pageConvs = (searchResp.data.conversations || []).map(c => String(c.id));
                    if (pageConvs.length === 0) break;

                    const results = await Promise.allSettled(pageConvs.map(id => processConvEmail(id)));
                    for (const r of results) {
                        if (r.status !== 'fulfilled' || !r.value || r.value.length === 0) continue;
                        const rows = r.value;
                        const cid = rows[0].conversation_id;
                        if (seenConvIds.has(cid)) continue;
                        const filtered = (agent && agent !== 'All')
                            ? rows.filter(row => row.assignee_name === agent)
                            : rows;
                        if (filtered.length === 0) continue;
                        seenConvIds.add(cid);
                        allRows.push(...filtered);
                        if (seenConvIds.size >= convLimit) break;
                    }

                    const next = searchResp.data.pages?.next?.starting_after;
                    if (!next) searchDone = true;
                    else startingAfter = next;
                }

                return res.status(200).json({ success: true, data: allRows, total: allRows.length, uniqueConversations: seenConvIds.size, pagesSearched: pages });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'spo-test-email failed: ' + (e.message || String(e)) });
            }
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
                // New FRT/ART/AHT logic (2026-07-22):
                // FRT  = balance assignment → first agent reply. Same-agent reopen → FRT blank (null).
                // ART  = average of ALL client-burst-first-msg → agent-reply gaps after FRT.
                //        Same-agent reopen/transfer: gap[0] = reopen/transfer time → first reply.
                //        After snooze + client replies first: gap[0] = client's first msg → first reply.
                // AHT  = ahtAnchor → close/snooze/transfer. Bot periods excluded.
                //        ahtAnchor: assignment time (first cycle), reopen time (reopen/transfer cycle),
                //        or client's first message (snooze cycle where client replies first).
                // Each snooze boundary ends one stint and starts a new one — no same-day merging.
                const stats = conv.statistics || {};
                const convCreated = conv.created_at;
                const waitTime = stats.time_to_assignment || stats.time_to_first_close || null;
                let connectToAgentTime = null;
                let firstAssignmentTime = null;
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

                const parts = (conv.conversation_parts?.conversation_parts || [])
                    .slice().sort((a, b) => a.created_at - b.created_at);

                const stints = [];

                // Conversation-level state (persists across cycles)
                let prevAgentId      = null;
                let prevAgentName    = null;
                let triggerTime      = convCreated;
                let triggerType      = 'initial';
                let lastAssignedId   = null;
                let lastAssignedName = null;
                let lastCustMsg      = convCreated;
                let firstCustInCycle = null;  // first customer msg since last trigger (snooze ART/AHT anchor)

                // Active-cycle state (reset in closeCycle)
                let cycleAgentId   = null;
                let cycleAgentName = null;
                let frtBlank       = false;
                let firstReplyTime = null;
                let parkTime       = null;
                let artGaps        = [];
                let artPendingCust = null;
                let artWindowOpen  = false;
                let ahtAnchor      = null;
                let botPeriodStart = null;
                let botExcludeSecs = 0;
                let responseCount  = 0;

                function flushBotPeriod(at) {
                    if (botPeriodStart !== null && at > botPeriodStart) botExcludeSecs += at - botPeriodStart;
                    botPeriodStart = null;
                }

                function closeCycle() {
                    if (cycleAgentId && firstReplyTime !== null) {
                        const frtVal = (!frtBlank && triggerTime && firstReplyTime > triggerTime)
                            ? firstReplyTime - triggerTime : null;

                        const artAvg = artGaps.length > 0
                            ? Math.round(artGaps.reduce((s, v) => s + v, 0) / artGaps.length) : null;

                        const ahtEnd = parkTime || firstReplyTime;
                        if (botPeriodStart !== null) flushBotPeriod(ahtEnd);
                        const ahtGross = (ahtAnchor && ahtEnd > ahtAnchor) ? ahtEnd - ahtAnchor : null;
                        // Reopen with no client message → AHT null (agent reopened/closed with no interaction)
                        const reopenNoClient = triggerType === 'reopen' && firstCustInCycle === null;
                        const ahtVal = (ahtGross != null && !reopenNoClient) ? Math.max(0, ahtGross - botExcludeSecs) : null;

                        const artTotal     = artGaps.length;
                        const artMissCount = artGaps.filter(g => g > 70).length;
                        const noFrt        = frtBlank || frtVal === null;
                        const frtHit       = noFrt ? null : (frtVal > 30 ? 1 : 0);
                        const artHit       = artTotal > 0 ? Math.round((artMissCount / artTotal) * 100) : null;

                        // SPO created_at / first_response_at anchor:
                        //   FRT row               → firstReplyTime
                        //   Reopen/transfer row   → triggerTime (reopen/transfer time)
                        //   Snooze+client row     → firstCustInCycle (client's first reply after snooze)
                        const artAnchor = (frtBlank && triggerType === 'snooze' && firstCustInCycle !== null)
                            ? firstCustInCycle : triggerTime;
                        const firstResponseTime = frtBlank ? artAnchor : firstReplyTime;

                        let name = cycleAgentName;
                        if (name && (name.toLowerCase().includes('fundednext ai') || name.toLowerCase() === 'fin')) name = 'FIN';

                        stints.push({
                            agentId: cycleAgentId, agentName: name,
                            frt: noFrt ? null : frtVal,
                            art: artAvg,
                            aht: ahtVal != null && ahtVal > 0 ? ahtVal : null,
                            frtHitRate: frtHit, artHitRate: artHit,
                            artMissCount: artTotal > 0 ? artMissCount : null,
                            artTotal:     artTotal > 0 ? artTotal     : null,
                            sentiment, csat, responseCount,
                            firstResponseTime,
                        });
                        prevAgentId   = cycleAgentId;
                        prevAgentName = cycleAgentName;
                    }
                    cycleAgentId = null; cycleAgentName = null; frtBlank = false;
                    firstReplyTime = null; parkTime = null;
                    artGaps = []; artPendingCust = null; artWindowOpen = false;
                    ahtAnchor = null; botPeriodStart = null; botExcludeSecs = 0;
                    responseCount = 0; firstCustInCycle = null;
                }

                for (const part of parts) {
                    if (!part.created_at) continue;
                    const t  = part.created_at;
                    const pt = part.part_type || '';

                    if (pt === 'open') {
                        closeCycle();
                        triggerTime = t; triggerType = 'reopen';
                        lastAssignedId = null; lastAssignedName = null;
                        continue;
                    }

                    if (pt === 'close' || pt === 'conversation_close') {
                        if (cycleAgentId && firstReplyTime !== null) parkTime = t;
                        closeCycle();
                        triggerTime = null; triggerType = null;
                        lastAssignedId = null; lastAssignedName = null;
                        continue;
                    }

                    // Snooze ends the current cycle; client reply (or explicit open) starts the next.
                    if (pt === 'snoozed' || pt === 'away_mode_assignment') {
                        if (cycleAgentId && firstReplyTime !== null) parkTime = t;
                        closeCycle();
                        triggerTime = t; triggerType = 'snooze';
                        lastAssignedId = null; lastAssignedName = null;
                        continue;
                    }

                    if (part.author?.type === 'user') {
                        if (part.body) {
                            const bl = (typeof part.body === 'string' ? part.body : '').toLowerCase();
                            if ((bl.includes('connect to an agent') || bl.includes('connect to agent')) && !connectToAgentTime)
                                connectToAgentTime = t;
                        }
                        lastCustMsg = t;
                        if (firstCustInCycle === null) firstCustInCycle = t;
                        if (cycleAgentId && firstReplyTime !== null) {
                            artWindowOpen = true;
                            if (artPendingCust === null) artPendingCust = t; // only first msg in each burst
                        }
                        continue;
                    }

                    // Bot comment — start a bot-active period for AHT exclusion
                    if (pt === 'comment' && part.author?.type === 'admin' && _isBot(part.author)) {
                        if (cycleAgentId && firstReplyTime !== null && botPeriodStart === null) botPeriodStart = t;
                        continue;
                    }

                    const isAssign = pt === 'assignment' || pt === 'message_strategy_assignment' || pt === 'default_assignment' || part.type === 'assignment' || (part.body && typeof part.body === 'string' && part.body.toLowerCase().includes('assignment:'));
                    if (isAssign) {
                        if (cycleAgentId && firstReplyTime !== null) parkTime = t; // AHT ends at transfer/unassign time
                        closeCycle();
                        triggerTime = t; triggerType = 'assignment';
                        let aId = null, aName = null;
                        const at = part.assigned_to;
                        if (at && at.type === 'admin') {
                            aId = String(at.id); aName = adminMap[aId] || at.name || null;
                        } else if (part.assignee && !_isBot(part.assignee)) {
                            aId = _getAgentId(part.assignee); aName = part.assignee.name || (aId && adminMap[aId]) || null;
                        } else if (part.body && typeof part.body === 'string') {
                            const m = part.body.match(/Assignment:\s*([^(]+)/i);
                            if (m) {
                                aName = m[1].trim();
                                for (const [id, nm] of Object.entries(adminMap)) {
                                    if (nm && nm.toLowerCase() === aName.toLowerCase()) { aId = id; break; }
                                }
                            }
                        }
                        lastAssignedId = aId; lastAssignedName = aName;
                        if (aId && !firstAssignmentTime) firstAssignmentTime = t;
                        continue;
                    }

                    if (pt === 'comment' && part.author?.type === 'admin' && !_isBot(part.author)) {
                        const agentId   = _getAgentId(part.author);
                        if (!agentId) continue;
                        const agentName = _getAgentName(part.author, adminMap);

                        // End any open bot period on human reply
                        if (cycleAgentId && botPeriodStart !== null) flushBotPeriod(t);

                        // Different agent replied without an assignment — close current, treat as implicit reopen
                        if (cycleAgentId && cycleAgentId !== agentId) {
                            closeCycle();
                            triggerTime = lastCustMsg || t; triggerType = 'reopen';
                            lastAssignedId = null; lastAssignedName = null;
                        }

                        if (!cycleAgentId) {
                            // Detect same-agent reopen (FRT blank)
                            const sameViaAssign = triggerType === 'assignment' && lastAssignedId && lastAssignedId === prevAgentId;
                            const sameViaReopen = (triggerType === 'reopen' || triggerType === 'snooze')
                                && agentId === prevAgentId && !lastAssignedId;

                            cycleAgentId   = agentId; cycleAgentName = agentName;
                            firstReplyTime = t; responseCount = 1;
                            frtBlank       = sameViaAssign || sameViaReopen;

                            // AHT anchor
                            ahtAnchor = (triggerType === 'snooze' && firstCustInCycle !== null)
                                ? firstCustInCycle : (triggerTime || t);

                            // FRT anchor correction: for initial cycle with no explicit assignment, use lastCustMsg
                            if (triggerType === 'initial' && !frtBlank) {
                                if (lastCustMsg && lastCustMsg > triggerTime) triggerTime = lastCustMsg;
                            }

                            // Same-agent reopen: ART = agent reply - client's first message.
                            // Requires a client message (firstCustInCycle); never use triggerTime as fallback.
                            if (frtBlank && firstCustInCycle !== null && t > firstCustInCycle) {
                                artGaps.push(t - firstCustInCycle);
                            }

                        } else {
                            // Subsequent reply from same agent
                            if (artWindowOpen && artPendingCust !== null) {
                                const gap = t - artPendingCust;
                                if (gap > 0) artGaps.push(gap);
                                artPendingCust = null;
                            }
                            responseCount++;
                        }
                    }
                }
                closeCycle();

                let avgWaitTime = null;
                if (connectToAgentTime && firstAssignmentTime && firstAssignmentTime > connectToAgentTime)
                    avgWaitTime = firstAssignmentTime - connectToAgentTime;
                else if (!connectToAgentTime && firstAssignmentTime && firstAssignmentTime > convCreated)
                    avgWaitTime = firstAssignmentTime - convCreated;

                // Merge consecutive same-agent same-day stints (no other agent in between).
                // Sorted chronologically; consecutive = the immediately preceding stint is same agent.
                // If another agent had a stint in between, they are kept as separate rows.
                const _dhakaDay = ts => ts ? new Date((ts + 6 * 3600) * 1000).toISOString().slice(0, 10) : null;
                const sortedStints = stints.slice().sort((a, b) => (a.firstResponseTime || 0) - (b.firstResponseTime || 0));
                const mergedStints = [];
                for (const s of sortedStints) {
                    const prev = mergedStints[mergedStints.length - 1];
                    if (prev && prev.agentId === s.agentId && _dhakaDay(prev.firstResponseTime) === _dhakaDay(s.firstResponseTime)) {
                        // Consecutive same-agent same-day: merge AHT (sum) and ART (weighted avg)
                        const ahtSum = (prev.aht != null || s.aht != null) ? (prev.aht || 0) + (s.aht || 0) : null;
                        const newArtTotal = (prev.artTotal || 0) + (s.artTotal || 0);
                        const newArtMiss  = (prev.artMissCount || 0) + (s.artMissCount || 0);
                        prev.aht          = ahtSum;
                        prev.art          = newArtTotal > 0
                            ? Math.round(((prev.art || 0) * (prev.artTotal || 0) + (s.art || 0) * (s.artTotal || 0)) / newArtTotal)
                            : prev.art;
                        prev.artTotal     = newArtTotal || null;
                        prev.artMissCount = newArtMiss  || null;
                        prev.artHitRate   = newArtTotal > 0 ? Math.round((newArtMiss / newArtTotal) * 100) : prev.artHitRate;
                        prev.responseCount = (prev.responseCount || 0) + (s.responseCount || 0);
                    } else {
                        mergedStints.push({ ...s });
                    }
                }

                return mergedStints.map(s => ({ ...s, waitTime, avgWaitTime }));
        }

        // ============ EMAIL SPO: _calcMetricsEmail ============
        // Email variant: No FRT. Every agent response is a separate row.
        // Returns one result per individual reply with its own ART and timestamp.
        // SLA Hit = individual response ART ≤ 3600s (1 hour)
        function _calcMetricsEmail(conv, adminMap) {
                const convCreated = conv.created_at;
                const agentAssignTimes = {};
                const agentAssignByName = {};
                const agentFirstSeen = {};
                let assignmentTime = null;
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
                const replies = []; // each reply = one row

                if (conv.conversation_parts && conv.conversation_parts.conversation_parts) {
                    const parts = conv.conversation_parts.conversation_parts;
                    const agentUserMsg = {};
                    let lastUserMsgTime = null;
                    let lastAssignTime = null;

                    for (const part of parts) {
                        if (!part.created_at) continue;
                        const pt = part.part_type || '';

                        // Track user messages
                        if (part.author?.type === 'user') {
                            lastUserMsgTime = part.created_at;
                            for (const aid in agentFirstSeen) agentUserMsg[aid] = part.created_at;
                            continue;
                        }

                        // Track assignments
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
                                if (m) {
                                    const an = m[1].trim();
                                    agentAssignByName[an.toLowerCase()] = part.created_at;
                                    for (const [id, nm] of Object.entries(adminMap)) { if (nm && nm.toLowerCase() === an.toLowerCase()) { agentAssignTimes[id] = part.created_at; break; } }
                                }
                            }
                        }
                        if (part.body && typeof part.body === 'string') {
                            const bl = part.body.toLowerCase();
                            if (bl.includes('balanced assignment') || (bl.includes('assigned') && !bl.includes('team assignment'))) assignmentTime = part.created_at;
                        }

                        // Agent comment — each reply = one result row
                        if (part.author?.type === 'admin' && pt === 'comment') {
                            if (_isBot(part.author)) continue;
                            const agentId = _getAgentId(part.author);
                            if (!agentId) continue;
                            const agName = _getAgentName(part.author, adminMap);
                            let name = agName;
                            if (name && (name.toLowerCase().includes('fundednext ai') || name.toLowerCase() === 'fin')) continue;

                            // Populate assignment times on first encounter
                            if (!agentFirstSeen[agentId]) {
                                agentFirstSeen[agentId] = true;
                                agentUserMsg[agentId] = null;
                                if (!agentAssignTimes[agentId] && agName && agentAssignByName[agName.toLowerCase()]) {
                                    agentAssignTimes[agentId] = agentAssignByName[agName.toLowerCase()];
                                }
                                if (!agentAssignTimes[agentId] && part.author?.name && agentAssignByName[part.author.name.toLowerCase()]) {
                                    agentAssignTimes[agentId] = agentAssignByName[part.author.name.toLowerCase()];
                                }
                                if (!agentAssignTimes[agentId] && lastAssignTime) {
                                    agentAssignTimes[agentId] = lastAssignTime;
                                }
                            }

                            // Calculate ART for this specific reply
                            let art = null;
                            const isFirstReply = !replies.some(r => r.agentId === agentId);
                            if (isFirstReply) {
                                // First response: ART = reply_time - assignment_time
                                const aat = agentAssignTimes[agentId] || (agName && agentAssignByName[agName.toLowerCase()]) || (part.author?.name && agentAssignByName[part.author.name.toLowerCase()]);
                                const base = aat || lastAssignTime || assignmentTime || lastUserMsgTime || convCreated;
                                const rt = part.created_at - base;
                                if (rt > 0 && rt < 86400 * 7) art = rt;
                            } else {
                                // Subsequent: ART = reply_time - last_user_msg
                                if (agentUserMsg[agentId]) {
                                    const rt = part.created_at - agentUserMsg[agentId];
                                    if (rt > 0 && rt < 86400 * 7) art = rt;
                                }
                            }

                            replies.push({
                                agentId,
                                agentName: name,
                                replyTime: part.created_at,
                                art,
                                slaHit: art != null ? (art <= 3600 ? 1 : 0) : null,
                                sentiment,
                                csat
                            });

                            agentUserMsg[agentId] = null;
                        }
                    }
                }

                return replies;
        }

        // ============ SPO: source chat conversations from the REST API (export replacement) ============
        // The consolidated_conversation_part reporting export stopped returning human-served
        // conversations (~2026-07 — it now yields only Fin/AI-handled rows). This enumerates
        // conversations CREATED in [dateFrom,dateTo] via the REST search API (chat/facebook/instagram
        // only), inserts one minimal SPO stub per conversation, and lets spo-enrich rebuild the correct
        // per-agent rows from the full conversation (bot-only convs are dropped during enrichment).
        // Paginated via cursor; returns nextCursor + done. Run spo-enrich afterwards to enrich the stubs.
        if (action === 'spo-sync-rest') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const sb = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
            const from = dateFrom; const to = dateTo || dateFrom;
            if (!from) return res.status(200).json({ success: false, error: 'dateFrom required (conversation-created window, Dhaka)' });
            const DHAKA_OFFSET = 6 * 3600; const DHAKA_OFFSET_MS = DHAKA_OFFSET * 1000;
            const toDhakaISO = (sec) => new Date(sec * 1000 + DHAKA_OFFSET_MS).toISOString().replace('Z', '+06:00');
            const nowISO = () => new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().replace('Z', '+06:00');
            const fp = from.split('-').map(Number); const tp = to.split('-').map(Number);
            const d0 = Math.floor(Date.UTC(fp[0], fp[1]-1, fp[2]) / 1000) - DHAKA_OFFSET;
            const d1 = Math.floor(Date.UTC(tp[0], tp[1]-1, tp[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;
            const CHAN = { conversation: 'Chat', facebook: 'Facebook', instagram: 'Instagram' };
            const startMs = Date.now();
            try {
                let startingAfter = req.body?.cursor || null;
                let scanned = 0, chat = 0, pages = 0;
                const stubs = {};
                const maxPages = Math.min(200, Math.max(1, Number(req.body?.maxPages) || 60));
                while (pages < maxPages) {
                    if (Date.now() - startMs > 240000) break; // stay under Vercel 300s
                    const query = {
                        query: { operator: 'AND', value: [
                            { field: 'created_at', operator: '>', value: d0 },
                            { field: 'created_at', operator: '<', value: d1 } ] },
                        sort: { field: 'created_at', order: 'ascending' },
                        pagination: { per_page: 150 }
                    };
                    if (startingAfter) query.pagination.starting_after = startingAfter;
                    const resp = await fetchIntercom('/conversations/search', { method: 'POST', body: JSON.stringify(query) });
                    if (!resp.ok) return res.status(200).json({ success: false, error: `search ${resp.status}: ${JSON.stringify(resp.data).slice(0,150)}`, scanned, chat });
                    const convs = resp.data?.conversations || [];
                    pages++;
                    for (const c of convs) {
                        scanned++;
                        const chan = CHAN[(c.source && c.source.type) || ''];
                        if (!chan) continue; // chat/facebook/instagram only (drops email/phone/etc.)
                        chat++;
                        const cid = parseInt(c.id, 10) || c.id;
                        stubs[cid] = { conversation_id: cid, created_at: toDhakaISO(c.created_at), channel: chan, synced_at: nowISO() };
                    }
                    const next = resp.data?.pages?.next;
                    startingAfter = next && next.starting_after ? next.starting_after : (typeof next === 'string' ? next : null);
                    if (!startingAfter) break;
                }
                // IDEMPOTENT: skip conversations that are already enriched (have any row with
                // first_response_at set). Without this, every run re-stubs already-processed
                // conversations, so the nightly's rolling window keeps re-creating work and the
                // pending count never converges to 0.
                let rows = Object.values(stubs);
                const allIds = rows.map(r => r.conversation_id);
                const enriched = new Set();
                for (let s = 0; s < allIds.length; s += 500) {
                    const idsChunk = allIds.slice(s, s + 500);
                    const { data: ex } = await sb.from('Service Performance Overview')
                        .select('conversation_id').in('conversation_id', idsChunk).not('first_response_at', 'is', null);
                    for (const e of (ex || [])) enriched.add(String(e.conversation_id));
                }
                rows = rows.filter(r => !enriched.has(String(r.conversation_id)));
                let inserted = 0, skipped = enriched.size;
                for (let s = 0; s < rows.length; s += 500) {
                    const chunk = rows.slice(s, s + 500);
                    const { error } = await sb.from('Service Performance Overview').insert(chunk);
                    if (error) return res.status(200).json({ success: false, error: 'insert: ' + error.message, inserted });
                    inserted += chunk.length;
                }
                return res.status(200).json({ success: true, scanned, chat, inserted, skipped, pages, nextCursor: startingAfter || null, done: !startingAfter });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'spo-sync-rest: ' + (e.message || String(e)) });
            }
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
            const enrichDateFrom = (body && body.dateFrom) || null;  // YYYY-MM-DD (BD time) — filters by created_at
            const enrichDateTo = (body && body.dateTo) || null;
            const syncedAtFrom = (body && body.syncedAtFrom) || null; // YYYY-MM-DD (BD time) — filters by synced_at, useful for new stubs that have created_at=NULL
            const syncedAtTo = (body && body.syncedAtTo) || null;
            const targetConvId = (body && body.convId) || null;       // single conversation_id — bypasses pending filter
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
                } else if (targetConvId) {
                    convIds = [targetConvId];
                } else {
                    let query = supabase.from('Service Performance Overview').select('conversation_id').not('conversation_id', 'is', null);
                    if (!forceAll) {
                        // Pending = an un-enriched stub. A stub has BOTH frt_seconds and first_response_at null.
                        // An enriched stint always sets first_response_at (its first reply) even when FRT itself
                        // is unmeasurable (null) — so those are NOT re-selected, preventing an infinite
                        // re-enrich loop on unmeasurable-FRT rows.
                        query = query.is('frt_seconds', null).is('first_response_at', null);
                    } else {
                        query = query.is('Transcript', null);
                    }
                    // Date filter: include rows where created_at is in range OR synced_at is in range
                    // OR created_at IS NULL (newly synced stubs that haven't been enriched yet).
                    // This means a date pick covers both old enriched rows from that date AND fresh
                    // pending stubs the user just synced — which is what the workflow needs.
                    if (enrichDateFrom || enrichDateTo || syncedAtFrom || syncedAtTo) {
                        const conds = [];
                        const fromCa = enrichDateFrom ? `${enrichDateFrom}T00:00:00+06:00` : null;
                        const toCa   = enrichDateTo   ? `${enrichDateTo}T23:59:59+06:00`   : null;
                        const fromSa = syncedAtFrom ? `${syncedAtFrom}T00:00:00+06:00` : null;
                        const toSa   = syncedAtTo   ? `${syncedAtTo}T23:59:59+06:00`   : null;
                        if (fromCa && toCa) conds.push(`and(created_at.gte.${fromCa},created_at.lte.${toCa})`);
                        else if (fromCa)    conds.push(`created_at.gte.${fromCa}`);
                        else if (toCa)      conds.push(`created_at.lte.${toCa}`);
                        if (fromSa && toSa) conds.push(`and(synced_at.gte.${fromSa},synced_at.lte.${toSa})`);
                        else if (fromSa)    conds.push(`synced_at.gte.${fromSa}`);
                        else if (toSa)      conds.push(`synced_at.lte.${toSa}`);
                        // Always include pending stubs (NULL created_at) so a fresh sync's stubs
                        // can be enriched without the date picker silently filtering them out.
                        conds.push('created_at.is.null');
                        query = query.or(conds.join(','));
                    }
                    const { data: pendingRows, error: fetchErr } = await query.limit(batchSize);

                    if (fetchErr) {
                        return res.status(200).json({ success: false, error: 'Failed to fetch pending rows: ' + fetchErr.message });
                    }
                    convIds = [...new Set((pendingRows || []).map(r => r.conversation_id))];
                    if (convIds.length === 0) {
                        let countQuery = supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null);
                        if (!forceAll) countQuery = countQuery.is('frt_seconds', null).is('first_response_at', null);
                        else countQuery = countQuery.is('Transcript', null);
                        if (enrichDateFrom || enrichDateTo || syncedAtFrom || syncedAtTo) {
                            const conds = [];
                            const fromCa = enrichDateFrom ? `${enrichDateFrom}T00:00:00+06:00` : null;
                            const toCa   = enrichDateTo   ? `${enrichDateTo}T23:59:59+06:00`   : null;
                            const fromSa = syncedAtFrom ? `${syncedAtFrom}T00:00:00+06:00` : null;
                            const toSa   = syncedAtTo   ? `${syncedAtTo}T23:59:59+06:00`   : null;
                            if (fromCa && toCa) conds.push(`and(created_at.gte.${fromCa},created_at.lte.${toCa})`);
                            else if (fromCa)    conds.push(`created_at.gte.${fromCa}`);
                            else if (toCa)      conds.push(`created_at.lte.${toCa}`);
                            if (fromSa && toSa) conds.push(`and(synced_at.gte.${fromSa},synced_at.lte.${toSa})`);
                            else if (fromSa)    conds.push(`synced_at.gte.${fromSa}`);
                            else if (toSa)      conds.push(`synced_at.lte.${toSa}`);
                            conds.push('created_at.is.null');
                            countQuery = countQuery.or(conds.join(','));
                        }
                        const { count: remaining } = await countQuery;
                        const safeRem = (remaining !== null && remaining !== undefined) ? remaining : 0;
                        return res.status(200).json({ success: true, processed: 0, enriched: 0, remaining: safeRem, message: 'No more conversations to enrich in the selected date range.' });
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
                // Bumped from 5 → 10 for safer 2× throughput under Intercom's
                // default rate limit (1,000 req/min) and Supabase LARGE
                // (2-core ARM). Previous attempt at 15 combined with
                // batchSize=150 pushed batches close to 100s wall time which
                // made the UI feel frozen between status updates.
                const CONCURRENCY = 10;

                // Simple 429/5xx retry wrapper for Intercom's /conversations/{id}.
                // Uses exponential backoff + jitter; honours Retry-After if the
                // response includes it. Caps at 3 retries so one stuck ID can't
                // block a whole batch.
                async function fetchIntercomWithBackoff(path, maxRetries = 3) {
                    for (let attempt = 0; attempt <= maxRetries; attempt++) {
                        let r;
                        try { r = await fetchIntercom(path); }
                        catch (e) {
                            // Network-level throw (TypeError: fetch failed, ECONNRESET, etc.)
                            if (attempt === maxRetries) throw e;
                            await new Promise(res => setTimeout(res, 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250)));
                            continue;
                        }
                        if (r.ok) return r;
                        const status = r.status;
                        // Only retry transient failures
                        if (status !== 429 && !(status >= 500 && status < 600)) return r;
                        if (attempt === maxRetries) return r;
                        // Respect Retry-After if Intercom sends it, otherwise backoff.
                        let waitMs = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
                        try {
                            const ra = r.headers?.['retry-after'];
                            if (ra) {
                                const n = Number(ra);
                                if (Number.isFinite(n) && n > 0) waitMs = Math.max(waitMs, n * 1000);
                            }
                        } catch {}
                        await new Promise(res => setTimeout(res, waitMs));
                    }
                }

                // Retry wrapper for Supabase ops that can fail with "TypeError: fetch failed"
                async function sbWithRetry(fn, maxRetries = 3) {
                    for (let attempt = 0; attempt <= maxRetries; attempt++) {
                        let result;
                        try { result = await fn(); }
                        catch (e) {
                            if (attempt === maxRetries) return { error: e };
                            await new Promise(res => setTimeout(res, 500 * Math.pow(2, attempt)));
                            continue;
                        }
                        if (!result.error) return result;
                        const msg = result.error?.message || '';
                        // Only retry transient network errors, not constraint violations etc.
                        if (!msg.includes('fetch failed') && !msg.includes('network') && !msg.includes('ECONNRESET')) return result;
                        if (attempt === maxRetries) return result;
                        await new Promise(res => setTimeout(res, 500 * Math.pow(2, attempt)));
                    }
                }

                async function enrichOne(convId) {
                    const convResp = await fetchIntercomWithBackoff(`/conversations/${convId}?display_as=plaintext`);
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
                        // No human agent replied (bot/Fin/Workflow-only). Remove any stub so SPO stays
                        // human-served only (the invariant the dashboard was built on). The conversation
                        // import now seeds a stub for EVERY conversation, so bot-only ones must be dropped
                        // here rather than kept as frt_seconds=0 rows.
                        await supabase.from('Service Performance Overview')
                            .delete().eq('conversation_id', convId);
                        return { convId, ok: true, skipped: true, reason: 'no_agents' };
                    }

                    const { data: existingRows, error: selErr } = await supabase.from('Service Performance Overview').select('*').eq('conversation_id', convId).limit(1);
                    if (selErr) return { convId, error: `Select failed – ${selErr.message}` };
                    const base = existingRows?.[0] || {};
                    const removeKeys = ['id', 'frt_seconds', 'art_seconds', 'aht_seconds', 'wait_time_seconds',
                        'action_performed_by', 'agent_name', 'assignee_id', 'assignee_name',
                        'frt_hit_rate', 'art_hit_rate', 'FRT Hit Rate', 'ART Hit Rate',
                        'art_miss_count', 'art_total',
                        'Avg Wait Time', 'avg_wait_time',
                        'sentiment', 'csat_rating', 'CX score', 'cx_score',
                        'Transcript', 'response_count', 'is_reopened', 'reopened_count'];
                    for (const k of removeKeys) delete base[k];

                    const { error: delErr } = await sbWithRetry(() => supabase.from('Service Performance Overview').delete().eq('conversation_id', convId));
                    if (delErr) return { convId, error: `Delete failed – ${delErr.message}` };

                    const rows = agentResults
                        .filter(ag => !excludedAgents.has(ag.agentName || ag.agentId))
                        .map(ag => {
                            const intercomName = ag.agentName || ag.agentId;
                            // Per-agent activity timestamp: the moment this agent's FRT happened
                            // (i.e., when they actually sent their first reply). Falls back to the
                            // conversation's original created_at when we can't derive it.
                            const agentReplyIso = ag.firstResponseTime
                                ? toDhakaISO(ag.firstResponseTime)
                                : base.created_at;
                            return {
                                ...base, ...enrichFields,
                                conversation_id: convId,
                                action_performed_by: intercomName,
                                agent_name: agentNameMap[intercomName] || null,
                                assignee_id: ag.agentId, assignee_name: ag.agentName,
                                created_at: agentReplyIso,
                                first_response_at: ag.firstResponseTime ? toDhakaISO(ag.firstResponseTime) : null,
                                frt_seconds: ag.frt, art_seconds: ag.art, aht_seconds: ag.aht,
                                wait_time_seconds: ag.waitTime,
                                "Avg Wait Time": ag.avgWaitTime, "FRT Hit Rate": ag.frtHitRate, "ART Hit Rate": ag.artHitRate,
                                art_miss_count: ag.artMissCount, art_total: ag.artTotal,
                                sentiment: ag.sentiment, response_count: ag.responseCount
                            };
                        });
                    if (rows.length === 0) return { convId, ok: true, skipped: true };
                    const { error: insErr } = await sbWithRetry(() => supabase.from('Service Performance Overview').insert(rows));
                    if (insErr) return { convId, error: `Insert failed – ${insErr.message}` };
                    return { convId, ok: true };
                }

                // Worker-pool pattern: keep CONCURRENCY requests in-flight at
                // all times instead of waiting for the slowest of a chunk to
                // finish before starting the next chunk. Cuts the "slow tail"
                // cost when one conversation takes much longer than its peers.
                {
                    let cursor = 0;
                    const workers = new Array(Math.min(CONCURRENCY, convIds.length)).fill(0).map(async () => {
                        while (true) {
                            const i = cursor++;
                            if (i >= convIds.length) return;
                            const id = convIds[i];
                            let r;
                            try { r = await enrichOne(id); }
                            catch (e) { r = { convId: id, error: e.message || String(e) }; }
                            if (r && r.ok) enriched++;
                            else if (r && r.error) {
                                errors.push(`${r.convId}: ${r.error}`);
                                if (!firstError) firstError = r.error;
                            }
                        }
                    });
                    await Promise.all(workers);
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
                    if (!forceAll) remQuery = remQuery.is('frt_seconds', null).is('first_response_at', null);
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

        // ============ EMAIL SPO ENRICH: Fetch per-agent ART/AHT from Intercom (email channel) ============
        if (action === 'spo-enrich-email') {
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
                const admResp = await fetchIntercom('/admins');
                const adminMap = {};
                if (admResp.ok && admResp.data?.admins) {
                    admResp.data.admins.forEach(a => { adminMap[a.id] = a.name || a.email || 'Unknown'; });
                }

                const EMAIL_TEAMS = ['PC- Email Support', 'PC- Unassigned Email', 'SC- Email Support', 'SC- Unassigned Email'];
                let query = supabase.from('Email - Service Performance Overview').select('conversation_id').not('conversation_id', 'is', null).in('team_id', EMAIL_TEAMS);
                if (!forceAll) {
                    query = query.is('art_seconds', null);
                } else {
                    query = query.is('country', null);
                }
                const { data: pendingRows, error: fetchErr } = await query.limit(batchSize);

                if (fetchErr) {
                    return res.status(200).json({ success: false, error: 'Failed to fetch pending rows: ' + fetchErr.message });
                }
                const convIds = [...new Set((pendingRows || []).map(r => r.conversation_id))];
                if (convIds.length === 0) {
                    let countQuery = supabase.from('Email - Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).in('team_id', EMAIL_TEAMS);
                    if (!forceAll) countQuery = countQuery.is('art_seconds', null);
                    else countQuery = countQuery.is('country', null);
                    const { count: remaining } = await countQuery;
                    const safeRem = (remaining !== null && remaining !== undefined) ? remaining : 0;
                    return res.status(200).json({ success: true, processed: 0, enriched: 0, remaining: safeRem, message: 'No more email conversations to enrich.' });
                }

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

                async function enrichOneEmail(convId) {
                    const convResp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
                    if (!convResp.ok) {
                        if (convResp.status === 404 || convResp.status === 410) {
                            await supabase.from('Email - Service Performance Overview')
                                .update({ art_seconds: 0, "CX score": null, synced_at: nowDhakaISO() })
                                .eq('conversation_id', convId);
                            return { convId, ok: true, skipped: true };
                        }
                        return { convId, error: `Intercom ${convResp.status}` };
                    }
                    const conv = convResp.data;
                    const replyResults = _calcMetricsEmail(conv, adminMap);
                    const cxScore = conv.conversation_rating?.rating || null;
                    const sentiment = replyResults.length > 0 ? replyResults[0].sentiment : null;

                    // Extract country from contact (fetch contact details for location)
                    let country = null;
                    const contactId = conv.contacts?.contacts?.[0]?.id;
                    if (contactId) {
                        try {
                            const contactResp = await fetchIntercom(`/contacts/${contactId}`);
                            if (contactResp.ok && contactResp.data) {
                                country = contactResp.data.location?.country || contactResp.data.custom_attributes?.country || null;
                            }
                        } catch (e) { /* skip */ }
                    }
                    if (!country && conv.custom_attributes?.country) country = conv.custom_attributes.country;

                    // Get existing rows for this conversation (one per reply from sync)
                    const { data: existingRows, error: selErr } = await supabase
                        .from('Email - Service Performance Overview')
                        .select('id, created_at, action_performed_by')
                        .eq('conversation_id', convId)
                        .order('created_at', { ascending: true });
                    if (selErr) return { convId, error: `Select failed – ${selErr.message}` };

                    if (!existingRows || existingRows.length === 0) {
                        return { convId, ok: true, skipped: true, reason: 'no_rows' };
                    }

                    // Match calculated replies to DB rows by AGENT + per-agent reply order — NOT by
                    // global array position. The DB rows are filtered to email-support agents, while
                    // the calculated replies include every non-bot teammate (e.g. a one-off reply by a
                    // non-email agent). Matching by global index let one extra calculated reply shift the
                    // whole alignment, writing one reply's ART onto a different reply's row. Grouping by
                    // agent and consuming that agent's replies in time order is immune to extra/missing
                    // replies from other agents, and to the +06:00 timestamp skew (order is preserved).
                    const norm = (s) => (s || '').trim().toLowerCase();
                    const repliesByAgent = {};
                    for (const r of [...replyResults].sort((a, b) => (a.replyTime || 0) - (b.replyTime || 0))) {
                        const k = norm(r.agentName);
                        (repliesByAgent[k] = repliesByAgent[k] || []).push(r);
                    }

                    // existingRows are already sorted by created_at asc; consume each agent's next reply.
                    const consumed = {};
                    let updated = 0;
                    for (const row of existingRows) {
                        const k = norm(row.action_performed_by);
                        const idx = consumed[k] || 0;
                        const reply = (repliesByAgent[k] || [])[idx];
                        consumed[k] = idx + 1;

                        const updateFields = {
                            "CX score": cxScore,
                            sentiment,
                            country,
                            synced_at: nowDhakaISO()
                        };

                        if (reply) {
                            updateFields.art_seconds = reply.art != null ? reply.art : 0;
                            updateFields["ART Hit Rate"] = reply.slaHit != null ? (reply.slaHit === 1 ? 0 : 100) : null;
                        } else {
                            // No matching calculated reply for this agent/row — mark enriched with 0
                            updateFields.art_seconds = 0;
                            updateFields["ART Hit Rate"] = null;
                        }

                        const { error: updErr } = await supabase
                            .from('Email - Service Performance Overview')
                            .update(updateFields)
                            .eq('id', row.id);
                        if (updErr) return { convId, error: `Update row ${row.id} failed – ${updErr.message}` };
                        updated++;
                    }

                    return { convId, ok: true, updated };
                }

                for (let i = 0; i < convIds.length; i += CONCURRENCY) {
                    const chunk = convIds.slice(i, i + CONCURRENCY);
                    const results = await Promise.all(chunk.map(id => enrichOneEmail(id).catch(e => ({ convId: id, error: e.message || String(e) }))));
                    for (const r of results) {
                        if (r.ok) enriched++;
                        else if (r.error) {
                            errors.push(`${r.convId}: ${r.error}`);
                            if (!firstError) firstError = r.error;
                        }
                    }
                }

                let remQuery = supabase.from('Email - Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).in('team_id', EMAIL_TEAMS);
                if (!forceAll) remQuery = remQuery.is('art_seconds', null);
                else remQuery = remQuery.is('country', null);
                const { count: remaining, error: remErr } = await remQuery;
                const safeRemaining = (remaining !== null && remaining !== undefined) ? remaining : -1;

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
                return res.status(200).json({ success: false, error: 'spo-enrich-email failed: ' + (e.message || String(e)) });
            }
        }

        // ============ EMAIL DATASET: Enqueue Conversation Actions export ============
        if (action === 'email-dataset-enqueue') {
            const edDateFrom = (body && body.dateFrom) || '2026-03-01';
            const edDateTo = (body && body.dateTo) || new Date().toISOString().split('T')[0];
            try {
                const dsResp = await fetchIntercom('/export/reporting_data/get_datasets');
                if (!dsResp.ok) {
                    return res.status(200).json({ success: false, error: `get_datasets failed: ${dsResp.status} ${JSON.stringify(dsResp.data)}` });
                }
                const rawDatasets = dsResp.data?.data ?? dsResp.data ?? [];
                const datasets = Array.isArray(rawDatasets) ? rawDatasets : [rawDatasets];
                // Find "conversation_actions" dataset
                const caDs = datasets.find(d => d.id === 'conversation_actions') ||
                    datasets.find(d => d.name && String(d.name).toLowerCase().includes('conversation action'));
                if (!caDs) {
                    return res.status(200).json({ success: false, error: 'Conversation Actions dataset not found. Available: ' + datasets.map(d => `${d.id}(${d.name || ''})`).join(', ') });
                }
                const datasetId = caDs.id;
                const WANTED_ATTRS = [
                    'conversation_id', 'action_id', 'action_time', 'action_type',
                    'action_performed_by_teammate_id', 'channel',
                    'action_team_assignee_id', 'action_teammate_assignee_id',
                    'teammate_subsequent_response_time_in_office_hours',
                    'currently_assigned_team_id'
                ];
                let attributeIds = WANTED_ATTRS;
                if (caDs.attributes && Array.isArray(caDs.attributes)) {
                    const available = new Set(caDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a)));
                    attributeIds = WANTED_ATTRS.filter(a => available.has(a));
                    if (attributeIds.length === 0) {
                        attributeIds = caDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a));
                    }
                }
                const DHAKA_OFFSET = 6 * 3600;
                const partsFrom = edDateFrom.split('T')[0].split('-').map(Number);
                const partsTo = edDateTo.split('T')[0].split('-').map(Number);
                const fromTs = partsFrom.length >= 3 ? Math.floor(Date.UTC(partsFrom[0], partsFrom[1] - 1, partsFrom[2]) / 1000) - DHAKA_OFFSET : 0;
                const toTs = partsTo.length >= 3 ? Math.floor(Date.UTC(partsTo[0], partsTo[1] - 1, partsTo[2], 23, 59, 59) / 1000) - DHAKA_OFFSET : 0;
                const enqBody = { start_time: fromTs, end_time: toTs, dataset_id: datasetId, attribute_ids: attributeIds };
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
                return res.status(200).json({ success: true, jobId, status: enqResp.data?.status || 'pending', datasetId, attributeCount: attributeIds.length, attributeIds, availableAttrs: caDs.attributes ? caDs.attributes.map(a => typeof a === 'string' ? a : (a.id || a)) : 'none', dateRange: `${edDateFrom} to ${edDateTo}` });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'email-dataset-enqueue failed: ' + (e.message || String(e)) });
            }
        }

        // ============ EMAIL DATASET: Poll job status ============
        if (action === 'email-dataset-poll') {
            const { jobId } = body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            try {
                const resp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!resp.ok) {
                    return res.status(200).json({ success: false, error: `Poll failed: ${resp.status}` });
                }
                return res.status(200).json({ success: true, status: resp.data?.status || 'unknown', job: resp.data });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'email-dataset-poll failed: ' + (e.message || String(e)) });
            }
        }

        // ============ EMAIL DATASET: Download CSV → filter Reply+Email → insert per-reply rows ============
        if (action === 'email-dataset-import') {
            const { jobId } = body || {};
            if (!jobId) return res.status(400).json({ error: 'jobId required' });
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            try {
                // Poll job to get download URL
                const pollResp = await fetchIntercom(`/export/reporting_data/${jobId}`);
                if (!pollResp.ok) return res.status(200).json({ success: false, error: `Poll failed: ${pollResp.status}` });
                const jobData = pollResp.data;
                if (jobData.status !== 'complete' && jobData.status !== 'completed') {
                    return res.status(200).json({ success: false, error: `Job not ready: status=${jobData.status}`, job: jobData });
                }
                const downloadUrl = jobData.download_url || (jobData.data_url);
                if (!downloadUrl) {
                    return res.status(200).json({ success: false, error: 'No download_url in job data', job: jobData });
                }

                // Download CSV with auth
                const https = require('https');
                const zlib = require('zlib');
                function cdHttpsBinary(url, opts = {}) {
                    return new Promise((resolve, reject) => {
                        const urlObj = new URL(url);
                        const reqOpts = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: opts.method || 'GET', headers: opts.headers || {} };
                        const req2 = https.request(reqOpts, (res2) => {
                            if (res2.statusCode >= 300 && res2.statusCode < 400 && res2.headers.location) {
                                return cdHttpsBinary(res2.headers.location, opts).then(resolve).catch(reject);
                            }
                            const chunks = [];
                            res2.on('data', chunk => chunks.push(chunk));
                            res2.on('end', () => resolve({ ok: res2.statusCode >= 200 && res2.statusCode < 300, status: res2.statusCode, buffer: Buffer.concat(chunks) }));
                        });
                        req2.on('error', reject);
                        req2.end();
                    });
                }

                const dlResp = await cdHttpsBinary(downloadUrl, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`, 'Accept': 'application/octet-stream', 'Intercom-Version': '2.14' }
                });
                if (!dlResp.ok) {
                    return res.status(200).json({ success: false, error: `Download failed: HTTP ${dlResp.status}`, jobId });
                }
                let csvBuffer = dlResp.buffer;
                if (csvBuffer[0] === 0x1f && csvBuffer[1] === 0x8b) csvBuffer = zlib.gunzipSync(csvBuffer);
                const csvText = csvBuffer.toString('utf-8');

                // Parse CSV
                const lines = csvText.split('\n').filter(l => l.trim());
                if (lines.length < 2) return res.status(200).json({ success: false, error: 'CSV empty or header-only', lineCount: lines.length, headers: lines[0] || '', csvPreview: csvText.substring(0, 500) });

                const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
                const colIdx = {};
                headers.forEach((h, i) => { colIdx[h.toLowerCase()] = i; });

                function getVal(row, key) {
                    const i = colIdx[key.toLowerCase()];
                    if (i === undefined) return null;
                    return row[i] ? row[i].replace(/^"|"$/g, '').trim() : null;
                }

                // Simple CSV row parser (handles quoted fields)
                function parseCSVRow(line) {
                    const result = [];
                    let current = '';
                    let inQuotes = false;
                    for (let i = 0; i < line.length; i++) {
                        const ch = line[i];
                        if (inQuotes) {
                            if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
                            else if (ch === '"') inQuotes = false;
                            else current += ch;
                        } else {
                            if (ch === '"') inQuotes = true;
                            else if (ch === ',') { result.push(current); current = ''; }
                            else current += ch;
                        }
                    }
                    result.push(current);
                    return result;
                }

                // Fetch Intercom admins to map teammate IDs → names
                const admResp = await fetchIntercom('/admins');
                const adminMap = {};
                if (admResp.ok && admResp.data?.admins) {
                    admResp.data.admins.forEach(a => { adminMap[String(a.id)] = a.name || a.email || 'Unknown'; });
                }

                // Fetch Intercom teams to map team IDs → names
                const teamResp = await fetchIntercom('/teams');
                const teamMap = {};
                if (teamResp.ok && teamResp.data?.teams) {
                    teamResp.data.teams.forEach(t => { teamMap[String(t.id)] = t.name || 'Unknown'; });
                }

                // Load agent name mapping from Supabase
                const { data: mappingRows } = await supabase.from('agent_name_mapping').select('intercom_name, agent_name, exclude_from_metrics');
                const agentNameMap = {};
                const excludedAgents = new Set();
                if (mappingRows) mappingRows.forEach(r => {
                    agentNameMap[r.intercom_name] = r.agent_name;
                    if (r.exclude_from_metrics) excludedAgents.add(r.intercom_name);
                });

                // Parse all rows, filter for Reply + Email
                let totalRows = 0;
                let emailReplies = 0;
                const rows = [];

                for (let i = 1; i < lines.length; i++) {
                    const cols = parseCSVRow(lines[i]);
                    if (cols.length < 3) continue;
                    totalRows++;

                    const actionType = getVal(cols, 'action_type');
                    const channel = getVal(cols, 'channel');
                    // Filter: only Reply actions on Email channel
                    if (!actionType || !actionType.toLowerCase().includes('reply')) continue;
                    if (!channel || channel.toLowerCase() !== 'email') continue;

                    const convId = getVal(cols, 'conversation_id');
                    const actionTime = getVal(cols, 'action_time');
                    const performedById = getVal(cols, 'action_performed_by_teammate_id');
                    const teamAssignedId = getVal(cols, 'currently_assigned_team_id') || getVal(cols, 'action_team_assignee_id');

                    // Resolve teammate ID to name
                    const performedByName = performedById ? (adminMap[performedById] || performedById) : null;
                    // Resolve team ID to name
                    const teamName = teamAssignedId ? (teamMap[teamAssignedId] || teamAssignedId) : 'SC- Email Support';

                    if (!convId || !performedByName) continue;
                    // Skip excluded agents (bots etc)
                    if (excludedAgents.has(performedByName)) continue;
                    // Only include Email Support team members
                    const EMAIL_SUPPORT_AGENTS = new Set(['Camilla Hansley','Ella Romanoff','Emilia Lavan','Fiona Clarke','Garry Carlsen','Harry Ackerman','Jasper Ford','Leah Parker','Max Smith','Nathan West','Owen Matthews','Razor Frost','Sasha Zoe','Theo Barrett','Victor Hill','Zeke Elric']);
                    if (!EMAIL_SUPPORT_AGENTS.has(performedByName)) continue;

                    // Parse action_time — could be epoch seconds
                    let createdAt = null;
                    if (actionTime) {
                        const epoch = Number(actionTime);
                        if (!isNaN(epoch) && epoch > 1000000000) {
                            // Epoch seconds — store as UTC ISO (Supabase handles timezone)
                            createdAt = new Date(epoch * 1000).toISOString();
                        } else {
                            const parsed = new Date(actionTime);
                            if (!isNaN(parsed.getTime())) {
                                createdAt = parsed.toISOString();
                            } else {
                                createdAt = actionTime;
                            }
                        }
                    }

                    emailReplies++;
                    rows.push({
                        conversation_id: convId,
                        created_at: createdAt,
                        channel: 'Email',
                        action_performed_by: performedByName,
                        agent_name: agentNameMap[performedByName] || null,
                        assignee_name: performedByName,
                        team_id: teamName,
                        art_seconds: null,
                        response_count: 1,
                        "ART Hit Rate": null
                    });
                }

                if (rows.length === 0) {
                    return res.status(200).json({ success: true, totalCSVRows: totalRows, emailReplies: 0, inserted: 0, skippedDuplicates: 0, message: 'No email Reply rows found in CSV' });
                }

                // Dedup: fetch existing conversation_id + created_at pairs to skip duplicates
                const existingKeys = new Set();
                const uniqueConvIds = [...new Set(rows.map(r => r.conversation_id))];
                for (let i = 0; i < uniqueConvIds.length; i += 200) {
                    const chunk = uniqueConvIds.slice(i, i + 200);
                    const { data: existing } = await supabase
                        .from('Email - Service Performance Overview')
                        .select('conversation_id, created_at')
                        .in('conversation_id', chunk);
                    if (existing) existing.forEach(r => existingKeys.add(r.conversation_id + '|' + r.created_at));
                }
                const newRows = rows.filter(r => !existingKeys.has(r.conversation_id + '|' + r.created_at));
                const skippedDuplicates = rows.length - newRows.length;

                // Insert in batches
                let inserted = 0;
                const BATCH = 500;
                for (let i = 0; i < newRows.length; i += BATCH) {
                    const chunk = newRows.slice(i, i + BATCH);
                    const { error: insErr } = await supabase.from('Email - Service Performance Overview').upsert(chunk, { onConflict: 'conversation_id,created_at,action_performed_by', ignoreDuplicates: true });
                    if (insErr) return res.status(200).json({ success: false, error: 'Insert failed: ' + insErr.message, inserted, totalEmailReplies: emailReplies });
                    inserted += chunk.length;
                }

                // Count unique conversations
                const uniqueConvs = new Set(rows.map(r => r.conversation_id)).size;

                return res.status(200).json({
                    success: true,
                    totalCSVRows: totalRows,
                    emailReplies,
                    inserted,
                    skippedDuplicates,
                    uniqueConversations: uniqueConvs,
                    sampleAgents: [...new Set(rows.slice(0, 50).map(r => r.action_performed_by))]
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'email-dataset-import failed: ' + (e.message || String(e)) });
            }
        }

        // ============ EMAIL SYNC REPLIES: Extract email conversation_ids from Conversation Actions ============
        if (action === 'email-sync-replies') {
            const syncFrom = (body && body.dateFrom) || '2026-03-01';
            const syncTo = (body && body.dateTo) || '2026-03-31';
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            try {
                const EMAIL_TEAMS = ['PC- Email Support', 'PC- Unassigned Email', 'SC- Email Support', 'SC- Unassigned Email'];
                const DHAKA_OFFSET = '+06:00';
                const fromISO = syncFrom + 'T00:00:00' + DHAKA_OFFSET;
                const toISO = syncTo + 'T23:59:59' + DHAKA_OFFSET;

                // Load email agent mapping
                const { data: agentMapRows } = await supabase.from('agent_name_mapping').select('intercom_name, agent_name').eq('channel', 'email').eq('exclude_from_metrics', false);
                const emailAgentNames = new Set((agentMapRows || []).map(r => r.intercom_name?.toLowerCase()));
                const agentNameMap = {};
                (agentMapRows || []).forEach(r => { agentNameMap[r.intercom_name] = r.agent_name; });

                // Fetch all Reply actions in date range for Email channel
                let allActions = [];
                let offset = 0;
                const PAGE = 1000;
                while (true) {
                    const { data: actions, error: actErr } = await supabase
                        .from('Conversation Actions')
                        .select('conversation_id, action_id, action_time, action_performed_by, channel, action_type, teammate_assigned, teammate_subsequent_response_time_seconds')
                        .eq('action_type', 'Reply')
                        .eq('channel', 'Email')
                        .gte('action_time', fromISO)
                        .lte('action_time', toISO)
                        .range(offset, offset + PAGE - 1);
                    if (actErr) return res.status(200).json({ success: false, error: 'Query failed: ' + actErr.message });
                    allActions = allActions.concat(actions || []);
                    if (!actions || actions.length < PAGE) break;
                    offset += PAGE;
                }

                // Filter by email agents only
                const emailReplies = allActions.filter(a => emailAgentNames.has((a.action_performed_by || '').toLowerCase()));
                const totalReplies = emailReplies.length;

                // Get team_id for each conversation
                const uniqueConvIds = [...new Set(emailReplies.map(a => a.conversation_id))];
                const convTeamMap = {};
                for (let i = 0; i < uniqueConvIds.length; i += 200) {
                    const chunk = uniqueConvIds.slice(i, i + 200);
                    const { data: assigns } = await supabase
                        .from('Conversation Actions')
                        .select('conversation_id, teammate_assigned')
                        .in('conversation_id', chunk)
                        .not('teammate_assigned', 'is', null)
                        .in('teammate_assigned', EMAIL_TEAMS)
                        .limit(5000);
                    if (assigns) assigns.forEach(a => { if (!convTeamMap[a.conversation_id]) convTeamMap[a.conversation_id] = a.teammate_assigned; });
                }

                // Build one row per reply, using action_time as created_at
                const rows = emailReplies.map(a => {
                    const intercomName = a.action_performed_by;
                    const teamId = convTeamMap[a.conversation_id] || 'SC- Email Support';
                    return {
                        conversation_id: a.conversation_id,
                        created_at: a.action_time,
                        channel: 'Email',
                        action_performed_by: intercomName,
                        agent_name: agentNameMap[intercomName] || null,
                        assignee_name: intercomName,
                        team_id: teamId,
                        art_seconds: null,
                        response_count: 1,
                        "ART Hit Rate": null
                    };
                }).filter(r => EMAIL_TEAMS.includes(r.team_id));

                // Insert in batches
                let inserted = 0;
                const BATCH = 500;
                for (let i = 0; i < rows.length; i += BATCH) {
                    const chunk = rows.slice(i, i + BATCH);
                    const { error: insErr } = await supabase.from('Email - Service Performance Overview').upsert(chunk, { onConflict: 'conversation_id,created_at,action_performed_by', ignoreDuplicates: true });
                    if (insErr) return res.status(200).json({ success: false, error: 'Insert failed: ' + insErr.message, inserted, totalReplies });
                    inserted += chunk.length;
                }

                return res.status(200).json({
                    success: true,
                    totalRepliesFound: totalReplies,
                    totalFiltered: rows.length,
                    uniqueConversations: uniqueConvIds.length,
                    inserted,
                    dateRange: `${syncFrom} to ${syncTo}`
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'email-sync-replies failed: ' + (e.message || String(e)) });
            }
        }

        // ============ EMAIL SYNC FAST: Search Intercom API directly for email conversations ============
        if (action === 'email-sync-fast') {
            const syncFrom = (body && body.dateFrom) || '2026-03-01';
            const syncTo = (body && body.dateTo) || '2026-03-31';
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

            try {
                const EMAIL_TEAMS = ['PC- Email Support', 'PC- Unassigned Email', 'SC- Email Support', 'SC- Unassigned Email'];
                const DHAKA_OFFSET = 6 * 3600;
                const fp = syncFrom.split('-').map(Number);
                const tp = syncTo.split('-').map(Number);
                const fromTs = Math.floor(Date.UTC(fp[0], fp[1] - 1, fp[2]) / 1000) - DHAKA_OFFSET;
                const toTs = Math.floor(Date.UTC(tp[0], tp[1] - 1, tp[2], 23, 59, 59) / 1000) - DHAKA_OFFSET;

                // Load email agent names
                const { data: agentMap } = await supabase.from('agent_name_mapping').select('intercom_name').eq('channel', 'email').eq('exclude_from_metrics', false);
                const emailAgentNames = new Set((agentMap || []).map(r => r.intercom_name));

                // Get existing conversation_ids
                const { data: existingRows } = await supabase.from('Email - Service Performance Overview').select('conversation_id').not('conversation_id', 'is', null);
                const existingIds = new Set((existingRows || []).map(r => r.conversation_id));

                // Search Intercom for email conversations
                const allConvIds = [];
                let startingAfter = null;
                let pages = 0;

                while (pages < 200) {
                    pages++;
                    const searchBody = {
                        query: {
                            operator: 'AND',
                            value: [
                                { field: 'created_at', operator: '>', value: fromTs },
                                { field: 'created_at', operator: '<', value: toTs },
                                { field: 'source.type', operator: '=', value: 'email' }
                            ]
                        },
                        pagination: { per_page: 150 }
                    };
                    if (startingAfter) searchBody.pagination.starting_after = startingAfter;

                    const searchResp = await fetchIntercom('/conversations/search', { method: 'POST', body: JSON.stringify(searchBody) });
                    if (!searchResp.ok) return res.status(200).json({ success: false, error: `Intercom search: ${searchResp.status}`, pages });

                    const convs = searchResp.data.conversations || [];
                    if (convs.length === 0) break;

                    for (const c of convs) {
                        const cid = String(c.id);
                        if (existingIds.has(cid)) continue;

                        // Get team from assignee or tags
                        const teamId = c.team_assignee_id ? null : 'SC- Email Support';
                        const assigneeName = c.assignee?.name || null;

                        allConvIds.push({
                            conversation_id: cid,
                            created_at: c.created_at ? new Date(c.created_at * 1000 + DHAKA_OFFSET * 1000).toISOString().replace('Z', '+06:00') : null,
                            channel: 'Email',
                            assignee_name: assigneeName,
                            team_id: teamId || 'SC- Email Support',
                            country: c.custom_attributes?.country || null
                        });
                        existingIds.add(cid);
                    }

                    const next = searchResp.data.pages?.next?.starting_after;
                    if (!next) break;
                    startingAfter = next;
                }

                // Filter by email teams
                const validConvs = allConvIds.filter(c => EMAIL_TEAMS.includes(c.team_id));

                // Insert in batches
                let inserted = 0;
                const BATCH = 500;
                for (let i = 0; i < validConvs.length; i += BATCH) {
                    const chunk = validConvs.slice(i, i + BATCH);
                    const { error: insErr } = await supabase.from('Email - Service Performance Overview').upsert(chunk, { onConflict: 'conversation_id,created_at,action_performed_by', ignoreDuplicates: true });
                    if (insErr) return res.status(200).json({ success: false, error: 'Insert: ' + insErr.message, inserted, pagesSearched: pages });
                    inserted += chunk.length;
                }

                return res.status(200).json({
                    success: true,
                    pagesSearched: pages,
                    totalFound: allConvIds.length,
                    inserted,
                    skippedExisting: allConvIds.length - validConvs.length,
                    dateRange: `${syncFrom} to ${syncTo}`
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'email-sync-fast failed: ' + (e.message || String(e)) });
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
            const countDateFrom = (body && body.dateFrom) || null;
            const countDateTo = (body && body.dateTo) || null;
            const applyDate = (q) => {
                if (countDateFrom) q = q.gte('created_at', `${countDateFrom}T00:00:00+06:00`);
                if (countDateTo)   q = q.lte('created_at', `${countDateTo}T23:59:59+06:00`);
                return q;
            };
            try {
                const [r1, r2, r3, r4] = await Promise.all([
                    applyDate(supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null)),
                    applyDate(supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).is('frt_seconds', null)),
                    applyDate(supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).is('Transcript', null)),
                    applyDate(supabase.from('Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).is('is_reopened', null))
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

        if (action === 'spo-enrich-email-count') {
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'Supabase not configured' });
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
            try {
                const EMAIL_TEAMS = ['PC- Email Support', 'PC- Unassigned Email', 'SC- Email Support', 'SC- Unassigned Email'];
                const [r1, r2, r3] = await Promise.all([
                    supabase.from('Email - Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).in('team_id', EMAIL_TEAMS),
                    supabase.from('Email - Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).in('team_id', EMAIL_TEAMS).is('art_seconds', null),
                    supabase.from('Email - Service Performance Overview').select('*', { count: 'exact', head: true }).not('conversation_id', 'is', null).in('team_id', EMAIL_TEAMS).is('Transcript', null),
                ]);
                const total = r1.count ?? 0;
                const needsArt = r2.count ?? 0;
                const needsTranscript = r3.count ?? 0;
                const errors = [r1.error, r2.error, r3.error].filter(Boolean).map(e => e.message);
                return res.status(200).json({
                    success: true,
                    total,
                    pending_art: needsArt,
                    pending_transcript: needsTranscript,
                    enriched: total - needsArt,
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

        // Read-only: run the live dashboard _calcMetrics on one conversation and return the per-stint rows.
        if (action === 'metrics-debug') {
            const convId = body && body.conversationId;
            if (!convId) return res.status(200).json({ error: 'conversationId required' });
            const admResp = await fetchIntercom('/admins');
            const adminMap = {};
            if (admResp.ok && admResp.data?.admins) admResp.data.admins.forEach(a => { adminMap[String(a.id)] = a.name; });
            const convResp = await fetchIntercom(`/conversations/${convId}?display_as=plaintext`);
            if (!convResp.ok) return res.status(200).json({ error: 'Not found', status: convResp.status });
            const results = _calcMetrics(convResp.data, adminMap);
            return res.status(200).json({ conversationId: convId, count: results.length, results });
        }

        // ============ TICKET SYNC: Search Intercom Tickets API, fetch details, compute SLA, upsert to ticket_logs ============
        if (action === 'ticket-sync') {
            const syncFrom = (body && body.dateFrom) || '2025-06-01';
            const syncTo = (body && body.dateTo) || new Date().toISOString().split('T')[0];
            // Optional: list of intercom_ids to refresh directly. When provided, the
            // /tickets/search step is skipped and these IDs are fetched one by one.
            // Used by the "Sync Unresolved" button to refresh stale state.
            const targetIntercomIds = Array.isArray(body && body.intercomIds) ? body.intercomIds : null;
            const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !supabaseKey) return res.status(200).json({ success: false, error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });

            // Helper: fetch Intercom with version 2.11 (required for Tickets API)
            async function fetchIntercomTickets(endpoint, options = {}) {
                const url = `https://api.intercom.io${endpoint}`;
                return httpsRequest(url, {
                    method: options.method || 'GET',
                    headers: {
                        'Authorization': `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Intercom-Version': '2.11'
                    },
                    body: options.body
                });
            }

            // DHAKA offset
            const DHAKA_OFFSET_S = 6 * 3600;
            const DHAKA_OFFSET_MS = 6 * 3600000;

            // Date string -> unix seconds (start of day in GMT+6)
            function dateToUnix(dateStr, endOfDay) {
                const [y, m, d] = dateStr.split('-').map(Number);
                if (endOfDay) return Math.floor(Date.UTC(y, m - 1, d, 23, 59, 59) / 1000) - DHAKA_OFFSET_S;
                return Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000) - DHAKA_OFFSET_S;
            }

            // Unix -> Date in GMT+6
            function unixToDhaka(ts) {
                return new Date(ts * 1000 + DHAKA_OFFSET_MS);
            }

            // Format seconds into human-readable duration
            function formatDuration(seconds) {
                if (seconds == null || isNaN(seconds) || seconds < 0) return 'N/A';
                const d = Math.floor(seconds / 86400);
                const h = Math.floor((seconds % 86400) / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const parts = [];
                if (d > 0) parts.push(`${d}d`);
                if (h > 0) parts.push(`${h}h`);
                parts.push(`${m}m`);
                return parts.join(' ');
            }

            // Team ID → team code & name
            const TEAM_MAP_BY_ID = {};
            const TEAM_CODES = {
                'Pro Solutions Task Force': 'CEx',
                'CEx Reversal': 'CEx',
                'Ticket Dependencies': 'CEx',
                'Payments and Treasury': 'PT',
                'GB Email Communication': 'PT',
                'Tech Team': 'TT',
                'Platform Operations': 'PO',
                'Case Resolution': 'CR',
                'Business Operations': 'BO',
                'Business Operations 1': 'BO',
                'Business Operations 2': 'BO'
            };

            // Filter team IDs
            const FILTER_TEAM_IDS = [
                '8314220', '9644821', '6681977', '6533520', '6681962',
                '6921111', '6547584', '6682031', '6661069', '8009000',
                '10426781'  // TT - Ticket Dependencies
            ];

            // SLA rules are loaded from the sla_rules Supabase table inside the try block below.

            // Determine team code from team name (fuzzy match)
            function getTeamCode(teamName) {
                if (!teamName) return null;
                const lower = teamName.toLowerCase();
                if (lower.includes('pro solutions') || lower.includes('pstf')) return 'CEx';
                if (lower.includes('cex reversal') || lower.includes('cx reversal')) return 'CEx';
                if (lower.includes('ticket dependenc')) return 'CEx';
                if (lower.includes('cpm') || lower.includes('customer portfolio')) return 'CPM';
                if (lower.includes('payments') || lower.includes('treasury')) return 'PT';
                if (lower.includes('gb email')) return 'PT';
                if (lower.includes('tech team')) return 'TT';
                if (lower.includes('platform op')) return 'PO';
                if (lower.includes('case resolution')) return 'CR';
                if (lower.includes('business op')) return 'BO';
                // Direct lookup
                return TEAM_CODES[teamName] || null;
            }

            // (normalizeProduct + extractProductType hoisted to module level — see top of file)

            // Contact location lookup with caching.
            // The /tickets/{id} endpoint only returns {id, external_id} for contacts —
            // no location. We must fetch /contacts/{id} separately to get country.
            // Many tickets share customers, so caching dramatically reduces API calls.
            const contactLocationCache = new Map();
            async function getContactLocation(contactId) {
                if (!contactId) return { country: null, continent: null };
                if (contactLocationCache.has(contactId)) return contactLocationCache.get(contactId);
                try {
                    const r = await fetchIntercomTickets(`/contacts/${contactId}`);
                    const loc = r?.data?.location || {};
                    const result = {
                        country: loc.country || r?.data?.country || null,
                        continent: loc.continent_code || null,
                    };
                    contactLocationCache.set(contactId, result);
                    return result;
                } catch {
                    const empty = { country: null, continent: null };
                    contactLocationCache.set(contactId, empty);
                    return empty;
                }
            }

            try {
                // Load SLA rules from sla_rules table once for the whole sync run
                const { createClient: createClientSla } = require('@supabase/supabase-js');
                const sbSla = createClientSla(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
                const slaRules = await loadSlaRules(sbSla);

                // Step 1: Fetch teams to build id→name map
                const teamsResp = await fetchIntercomTickets('/teams');
                if (teamsResp.ok && teamsResp.data && teamsResp.data.teams) {
                    for (const t of teamsResp.data.teams) {
                        TEAM_MAP_BY_ID[String(t.id)] = t.name;
                    }
                }

                // Step 2: Search for resolved/closed tickets in date range
                const fromUnix = dateToUnix(syncFrom, false);
                const toUnix = dateToUnix(syncTo, true);

                const teamConditions = FILTER_TEAM_IDS.map(id => ({
                    field: 'team_assignee_id', operator: '=', value: id
                }));

                let allTickets = [];

                // Targeted ID mode: skip the search step, just stub minimal entries that
                // the detail-fetch step below will use to pull current state. We pass {id}
                // (intercom_id) — the detail step calls /tickets/{id} with that ID.
                if (targetIntercomIds && targetIntercomIds.length > 0) {
                    allTickets = targetIntercomIds.map(id => ({ id: String(id) }));
                }

                let hasMore = !targetIntercomIds || targetIntercomIds.length === 0;
                let startingAfterCursor = null;

                while (hasMore) {
                    const searchBody = {
                        query: {
                            operator: 'AND',
                            value: [
                                { field: 'created_at', operator: '>', value: fromUnix },
                                { field: 'created_at', operator: '<', value: toUnix },
                                {
                                    operator: 'OR',
                                    value: [
                                        { field: 'state', operator: '=', value: 'resolved' },
                                        { field: 'state', operator: '=', value: 'closed' }
                                    ]
                                },
                                {
                                    operator: 'OR',
                                    value: teamConditions
                                }
                            ]
                        },
                        pagination: { per_page: 100 },
                        sort: { field: 'created_at', order: 'ascending' }
                    };
                    if (startingAfterCursor) {
                        searchBody.pagination.starting_after = startingAfterCursor;
                    }

                    const searchResp = await fetchIntercomTickets('/tickets/search', {
                        method: 'POST',
                        body: JSON.stringify(searchBody)
                    });

                    if (!searchResp.ok) {
                        return res.status(200).json({
                            success: false,
                            error: `Tickets search failed: ${searchResp.status} ${JSON.stringify(searchResp.data)}`,
                            fromUnix, toUnix
                        });
                    }

                    const tickets = searchResp.data?.tickets || searchResp.data?.data || [];
                    allTickets = allTickets.concat(tickets);

                    const pagination = searchResp.data?.pages || searchResp.data?.pagination || {};
                    if (pagination.next && pagination.next.starting_after) {
                        startingAfterCursor = pagination.next.starting_after;
                    } else {
                        hasMore = false;
                    }
                }

                const totalFound = allTickets.length;

                // Step 3: Fetch full details for each ticket in batches of 10
                const BATCH_SIZE = 10;
                const BATCH_DELAY = 500;
                const records = [];
                const errors = [];

                for (let i = 0; i < allTickets.length; i += BATCH_SIZE) {
                    const batch = allTickets.slice(i, i + BATCH_SIZE);
                    const batchResults = await Promise.all(batch.map(async (ticket) => {
                        try {
                            const detailResp = await fetchIntercomTickets(`/tickets/${ticket.id}`);
                            if (!detailResp.ok) {
                                return { error: `Detail fetch failed for ${ticket.id}: ${detailResp.status}` };
                            }
                            return { ticket: detailResp.data };
                        } catch (e) {
                            return { error: `Detail fetch error for ${ticket.id}: ${e.message}` };
                        }
                    }));

                    for (let j = 0; j < batchResults.length; j++) {
                        const result = batchResults[j];
                        if (result.error) {
                            errors.push(result.error);
                            continue;
                        }

                        try {
                            const t = result.ticket;
                            const ticketParts = t.ticket_parts?.ticket_parts || [];

                            // resolved_at: use state_updated_at or last part timestamp or updated_at
                            // Intercom Tickets API v2.11 exposes the state as `ticket_state` (the legacy
                            // search query uses `state` but the response field is `ticket_state`).
                            let resolvedAt = null;
                            const tState = t.ticket_state || t.state;
                            const tIsClosed = tState === 'resolved' || tState === 'closed' || t.open === false;
                            if (tIsClosed) {
                                for (let pi = ticketParts.length - 1; pi >= 0; pi--) {
                                    const p = ticketParts[pi];
                                    if (p.part_type === 'ticket_state_updated_by_admin'
                                        || p.part_type === 'state_change'
                                        || p.part_type === 'ticket_state_change'
                                        || p.part_type === 'close') {
                                        resolvedAt = p.created_at;
                                        break;
                                    }
                                }
                                if (!resolvedAt) resolvedAt = t.updated_at || t.created_at;
                            }
                            if (!resolvedAt) resolvedAt = t.updated_at || t.created_at;

                            const createdAt = t.created_at;
                            const resolvedDhaka = unixToDhaka(resolvedAt);
                            const resolvedDate = `${resolvedDhaka.getUTCFullYear()}-${String(resolvedDhaka.getUTCMonth() + 1).padStart(2, '0')}-${String(resolvedDhaka.getUTCDate()).padStart(2, '0')}`;

                            // ticket_id
                            const ticketId = t.ticket_id || String(t.id);

                            // unique_id
                            const uniqueId = `${resolvedDate}|${ticketId}`;

                            // Current team
                            const teamAssigneeId = t.team_assignee_id ? String(t.team_assignee_id) : null;
                            const currentTeamName = teamAssigneeId ? (TEAM_MAP_BY_ID[teamAssigneeId] || `Team ${teamAssigneeId}`) : null;

                            // Issue category — needed up front so SLA lookup can hit the per-category rule
                            const issueCategory = (t.ticket_type && t.ticket_type.name) || t.title || null;

                            // SLA computation — table-driven, anchored on createdAt (when ticket arrived)
                            const teamCode = resolveTeamCode(slaRules, issueCategory, currentTeamName);
                            const resolutionSeconds = resolvedAt - createdAt;
                            const slaResult = computeSlaForTicket(slaRules, teamCode, issueCategory, createdAt, resolutionSeconds);
                            const sla_limit_hours = slaResult.sla_limit_hours;
                            const resolved_during_office = slaResult.resolved_during_office;
                            const slaStatus = slaResult.sla_status;

                            // Ticket creator: first admin who acted
                            let creatorName = null;
                            for (const p of ticketParts) {
                                if (p.author && (p.author.type === 'admin' || p.author.type === 'team')) {
                                    creatorName = p.author.name || p.author.email || null;
                                    break;
                                }
                            }
                            // Fallback to ticket source author
                            if (!creatorName && t.source && t.source.author) {
                                creatorName = t.source.author.name || t.source.author.email || null;
                            }

                            // Ticket handler: who resolved it, checked in priority order
                            let handlerName = null;
                            let lastAssignmentTime = null;

                            // Pass 1: last admin assignment or assignment part
                            for (let pi = ticketParts.length - 1; pi >= 0; pi--) {
                                const p = ticketParts[pi];
                                if (p.assigned_to && p.assigned_to.type === 'admin') {
                                    handlerName = p.assigned_to.name || p.assigned_to.email || null;
                                    lastAssignmentTime = p.created_at;
                                    break;
                                }
                                if (p.part_type === 'assignment' && p.author && p.author.type === 'admin') {
                                    handlerName = p.author.name || p.author.email || null;
                                    lastAssignmentTime = p.created_at;
                                    break;
                                }
                            }

                            // Pass 2: who moved it to resolved (state_change / close part)
                            if (!handlerName) {
                                for (let pi = ticketParts.length - 1; pi >= 0; pi--) {
                                    const p = ticketParts[pi];
                                    const isStateChange = p.part_type === 'state_change'
                                        || p.part_type === 'close'
                                        || p.part_type === 'ticket_state_change';
                                    if (isStateChange && p.author && p.author.type === 'admin') {
                                        handlerName = p.author.name || p.author.email || null;
                                        if (!lastAssignmentTime) lastAssignmentTime = p.created_at;
                                        break;
                                    }
                                }
                            }

                            // Pass 3: last admin who touched the ticket at all (note, reply, etc.)
                            if (!handlerName) {
                                for (let pi = ticketParts.length - 1; pi >= 0; pi--) {
                                    const p = ticketParts[pi];
                                    if (p.author && p.author.type === 'admin' && (p.author.name || p.author.email)) {
                                        handlerName = p.author.name || p.author.email || null;
                                        if (!lastAssignmentTime) lastAssignmentTime = p.created_at;
                                        break;
                                    }
                                }
                            }

                            // Pass 4: assignee from the ticket object itself
                            if (!handlerName && t.admin_assignee_id) {
                                handlerName = t.assignee?.name || null;
                            }

                            // Agent handle time
                            const agentHandleSeconds = lastAssignmentTime ? (resolvedAt - lastAssignmentTime) : null;

                            // Product type: ticket_attributes first, fallback to issue_category pattern
                            // (issueCategory was already computed at the SLA-lookup step above)
                            const productType = extractProductType(t.ticket_attributes, issueCategory);

                            // Ticket status label — read from ticket_state (response field), fallback to internal label
                            const ticketStatusRaw = t.ticket_state_internal_label || t.ticket_state || t.state || null;
                            const ticketStatus = ticketStatusRaw ? ticketStatusRaw.charAt(0).toUpperCase() + ticketStatusRaw.slice(1) : null;

                            // Contact country — /tickets/{id} only returns contact stubs without location,
                            // so fetch /contacts/{id} for the real country/continent.
                            let country = null;
                            let continent = null;
                            const contacts = t.contacts?.contacts || [];
                            if (contacts.length > 0) {
                                const contact = contacts[0];
                                // Try the stub first (rare — only if Intercom expands it inline)
                                country = contact.location?.country || contact.country || null;
                                continent = contact.location?.continent_code || null;
                                // Fallback: fetch the full contact for location data
                                if (!country && contact.id) {
                                    const loc = await getContactLocation(contact.id);
                                    country = loc.country;
                                    continent = loc.continent;
                                }
                            }

                            // Conversation ID (linked conversation if any)
                            let conversationId = null;
                            if (t.linked_objects?.data) {
                                for (const lo of t.linked_objects.data) {
                                    if (lo.type === 'conversation') {
                                        conversationId = String(lo.id);
                                        break;
                                    }
                                }
                            }

                            // Ticket creator email
                            let creatorEmail = null;
                            if (t.source && t.source.author && t.source.author.email) {
                                creatorEmail = t.source.author.email;
                            }

                            // Teams visited: scan parts for team assignments
                            const teamsVisited = {};
                            for (const p of ticketParts) {
                                if (p.assigned_to && p.assigned_to.type === 'team') {
                                    const tName = p.assigned_to.name || TEAM_MAP_BY_ID[String(p.assigned_to.id)] || null;
                                    if (tName) teamsVisited[tName] = 'Yes';
                                }
                                // Also check for team_assignee_id changes
                                if (p.team_assignee_id) {
                                    const tName = TEAM_MAP_BY_ID[String(p.team_assignee_id)] || null;
                                    if (tName) teamsVisited[tName] = 'Yes';
                                }
                            }
                            // Also include current team
                            if (currentTeamName) teamsVisited[currentTeamName] = 'Yes';

                            // Description / last ticket note
                            let description = null;
                            for (let pi = ticketParts.length - 1; pi >= 0; pi--) {
                                const p = ticketParts[pi];
                                if (p.part_type === 'note' && p.body) {
                                    description = htmlToText(p.body);
                                    if (description && description.length > 500) description = description.substring(0, 500) + '...';
                                    break;
                                }
                            }
                            if (!description && t.source && t.source.body) {
                                description = htmlToText(t.source.body);
                                if (description && description.length > 500) description = description.substring(0, 500) + '...';
                            }

                            // SLA applicability: only if ≤1 team visited. Any multi-team ticket
                            // (incl. PSTF→CEx Reversal — exception removed 2026-07-11 per user) is
                            // multi-dept → sla='N/A' and excluded from the SLA metric.
                            const uniqueTeams = Object.keys(teamsVisited);
                            const uniqueTeamsCount = uniqueTeams.length;
                            const slaApplicable = (uniqueTeamsCount <= 1);

                            // Override SLA if not applicable (forwarded ticket)
                            const finalSla = slaApplicable ? slaStatus : 'N/A';
                            const finalTicketSlaStatus = slaApplicable ? slaStatus : 'N/A';
                            const finalAgentSla = (agentHandleSeconds != null && sla_limit_hours != null)
                                ? (agentHandleSeconds <= sla_limit_hours * 3600 ? 'Met' : 'Missed')
                                : 'N/A';

                            const record = {
                                ticket_id: ticketId,
                                intercom_id: String(t.id),
                                resolved_at: resolvedAt ? new Date(resolvedAt * 1000).toISOString() : null,
                                ticket_creator_agent_name: creatorName || 'Unknown',
                                ticket_handler_agent_name: handlerName || 'Unknown',
                                resolution_time: formatDuration(resolutionSeconds) || '0m',
                                agent_handle_time: agentHandleSeconds != null ? formatDuration(agentHandleSeconds) : '0m',
                                ticket_status: ticketStatus || 'Unknown',
                                sla: finalSla,
                                sla_limit_hours: sla_limit_hours || 0,
                                product_type: productType || 'Unknown',
                                resolved_during_office_hours: resolved_during_office != null ? resolved_during_office : false,
                                current_team: currentTeamName || 'Unknown',
                                issue_category: issueCategory || 'Unknown',
                                description_last_ticket_note: description || '',
                                ticket_creator_email: creatorEmail || '',
                                conversation_id: conversationId || '',
                                country: country || 'Unknown',
                                continent: continent || 'Unknown',
                                channel: 'Ticket',
                                ticket_sla_duration_seconds: resolutionSeconds >= 0 ? resolutionSeconds : 0,
                                ticket_sla_status: finalTicketSlaStatus,
                                ticket_sla_limit_hours: sla_limit_hours || 0,
                                agent_handle_time_seconds: agentHandleSeconds != null && agentHandleSeconds >= 0 ? agentHandleSeconds : 0,
                                agent_sla_status: finalAgentSla,
                                // Teams visited columns
                                pro_solutions_task_force: teamsVisited['Pro Solutions Task Force'] || '',
                                cex_reversal: teamsVisited['CEx Reversal'] || '',
                                ticket_dependencies: teamsVisited['Ticket Dependencies'] || '',
                                payments_and_treasury: teamsVisited['Payments and Treasury'] || '',
                                gb_email_communication: teamsVisited['GB Email Communication'] || '',
                                tech_team: teamsVisited['Tech Team'] || '',
                                business_operations: teamsVisited['Business Operations'] || teamsVisited['Business Operations 1'] || teamsVisited['Business Operations 2'] || '',
                                platform_operations: teamsVisited['Platform Operations'] || '',
                                case_resolution: teamsVisited['Case Resolution'] || '',
                                forwarded: Object.keys(teamsVisited).length > 1,
                                forwarded_to: Object.keys(teamsVisited).length > 1 ? Object.keys(teamsVisited).join(', ') : ''
                            };

                            records.push(record);
                        } catch (transformErr) {
                            errors.push(`Transform error for ticket ${batch[j]?.id}: ${transformErr.message}`);
                        }
                    }

                    // Delay between batches
                    if (i + BATCH_SIZE < allTickets.length) {
                        await new Promise(r => setTimeout(r, BATCH_DELAY));
                    }
                }

                // Step 4: Upsert to Supabase ticket_logs
                const { createClient } = require('@supabase/supabase-js');
                const supabase = createClient(supabaseUrl, supabaseKey, {
                    auth: { autoRefreshToken: false, persistSession: false }
                });

                let imported = 0;
                // UPDATE existing rows by ticket_id — only fill columns that are NULL/empty/Unknown
                for (let i = 0; i < records.length; i++) {
                    const rec = records[i];
                    const tId = rec.ticket_id;
                    if (!tId) continue;

                    // Fetch existing row — prefer intercom_id match (reliably unique) since ticket_id
                    // may not match rows imported via the CSV pathway that used different keys.
                    const intercomId = rec.intercom_id;
                    let existingRows = null;
                    if (intercomId) {
                        const r = await supabase
                            .from('ticket_logs')
                            .select('*')
                            .eq('intercom_id', String(intercomId))
                            .limit(1);
                        existingRows = r.data;
                    }
                    if (!existingRows || existingRows.length === 0) {
                        const r = await supabase
                            .from('ticket_logs')
                            .select('*')
                            .eq('ticket_id', tId)
                            .limit(1);
                        existingRows = r.data;
                    }

                    const existing = existingRows?.[0];
                    if (!existing) continue; // no matching row to update

                    // Update strategy:
                    //   - "Live state" fields (current_team, ticket_status, resolved_at, sla, etc.)
                    //     ALWAYS overwrite — they reflect the ticket's current state in Intercom
                    //     and tickets get re-routed/closed after creation.
                    //   - Everything else: fill-only (only update if existing is null/empty/Unknown)
                    const updateFields = {};
                    const isEmpty = (v) => v === null || v === undefined || v === '' || v === 'Unknown' || v === 'N/A' || v === 0;
                    const ALWAYS_UPDATE = new Set([
                        'current_team', 'ticket_status', 'resolved_at',
                        'sla', 'sla_limit_hours', 'ticket_sla_duration_seconds',
                        'resolved_during_office_hours'
                    ]);

                    for (const [key, val] of Object.entries(rec)) {
                        // Skip identity/meta fields
                        if (['unique_id', 'date', 'ticket_id', 'intercom_id', 'created_at'].includes(key)) continue;
                        if (ALWAYS_UPDATE.has(key) && !isEmpty(val)) {
                            updateFields[key] = val;
                        } else if (isEmpty(existing[key]) && !isEmpty(val)) {
                            updateFields[key] = val;
                        }
                    }

                    // Always update these enrichment-only fields (not from CSV)
                    const enrichOnly = ['agent_handle_time', 'agent_handle_time_seconds', 'agent_sla_status',
                        'pro_solutions_task_force', 'cex_reversal', 'ticket_dependencies',
                        'payments_and_treasury', 'gb_email_communication', 'tech_team',
                        'business_operations', 'platform_operations', 'case_resolution',
                        'forwarded', 'forwarded_to', 'ticket_creator_email', 'conversation_id'];
                    for (const key of enrichOnly) {
                        if (rec[key] !== undefined && rec[key] !== null) {
                            updateFields[key] = rec[key];
                        }
                    }

                    // Also update SLA if team visits changed applicability
                    if (rec.sla !== undefined) updateFields.sla = rec.sla;
                    if (rec.ticket_sla_status !== undefined) updateFields.ticket_sla_status = rec.ticket_sla_status;

                    updateFields.updated_at = new Date().toISOString();

                    if (Object.keys(updateFields).length <= 1) continue; // only updated_at, skip
                    // Match on the existing row's primary id to avoid ambiguity
                    const { error: updErr } = await supabase
                        .from('ticket_logs')
                        .update(updateFields)
                        .eq('id', existing.id);

                    if (updErr) {
                        errors.push(`Update error for ticket ${tId}: ${updErr.message}`);
                    } else {
                        imported++;
                    }
                }

                return res.status(200).json({
                    success: true,
                    totalFound,
                    imported,
                    errors: errors.length,
                    errorDetails: errors.length > 0 ? errors.slice(0, 20) : undefined,
                    dateRange: `${syncFrom} to ${syncTo}`,
                    teamsLoaded: Object.keys(TEAM_MAP_BY_ID).length
                });
            } catch (e) {
                return res.status(200).json({ success: false, error: 'ticket-sync failed: ' + (e.message || String(e)) });
            }
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

        return res.status(400).json({ error: 'Invalid action. Use: fetch-page, fetch-single, fetch-details, fetch-details-batch, fetch-ids, analyze-single, csat-classify, debug, test-intercom, list-datasets, enqueue-export, export-status, download-export, ca-enqueue, ca-poll, ca-download-import, cd-enqueue, cd-download-import, tickets-enqueue, tickets-download-import, tickets-dataset-enqueue, tickets-dataset-poll, tickets-dataset-import, it-enqueue, it-poll, it-download-import, csat-enqueue, csat-poll, csat-download-import, list-admins, spo-test, spo-enrich, spo-enrich-fin, spo-recalc-frt, spo-enrich-count, spo-debug, conv-check, conv-debug, ticket-sync' });

        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};

// Extend Vercel function timeout (max 300s on Pro, 60s on Hobby)
module.exports.config = {
    maxDuration: 300
};
