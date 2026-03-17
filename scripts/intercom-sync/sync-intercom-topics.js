/**
 * Intercom Topics Sync Script
 * 
 * Replicates the n8n workflow:
 * 1. Fetches conversations from Intercom
 * 2. Extracts transcripts
 * 3. Uses OpenAI GPT-4.1 Mini to analyze topics, sentiment, and feedback
 * 4. Stores results in "Intercom Topic" Supabase table
 * 
 * Usage:
 *   node sync-intercom-topics.js                           - Sync conversations from today
 *   node sync-intercom-topics.js --date=2025-11-27         - Sync specific date
 *   node sync-intercom-topics.js --from=2025-11-01 --to=2025-11-30  - Date range
 *   node sync-intercom-topics.js --analyze-only            - Only analyze existing records with empty topics
 *   node sync-intercom-topics.js --limit=50                - Limit number of conversations
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load .env file
if (fs.existsSync(path.join(__dirname, '.env'))) {
    dotenv.config({ path: path.join(__dirname, '.env') });
} else if (fs.existsSync(path.join(__dirname, '../../.env'))) {
    dotenv.config({ path: path.join(__dirname, '../../.env') });
} else {
    dotenv.config();
}

// ============ CONFIGURATION ============
const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const TABLE_NAME = 'Intercom Topic';

// Validate required environment variables
if (!INTERCOM_TOKEN) {
    console.error('❌ ERROR: INTERCOM_ACCESS_TOKEN is required!');
    console.error('   Add to .env: INTERCOM_ACCESS_TOKEN=your_token_here');
    process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required!');
    process.exit(1);
}

if (!OPENAI_API_KEY) {
    console.error('❌ ERROR: OPENAI_API_KEY is required!');
    console.error('   Add to .env: OPENAI_API_KEY=your_openai_key_here');
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

const openai = axios.create({
    baseURL: 'https://api.openai.com/v1',
    headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
    }
});

// ============ HELPER FUNCTIONS ============
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        date: null,
        from: null,
        to: null,
        analyzeOnly: false,
        limit: null,
        batchSize: 5,  // Process 5 at a time with AI
        waitTime: 12000 // 12 seconds between AI batches (rate limiting)
    };
    
    for (const arg of args) {
        if (arg === '--analyze-only') config.analyzeOnly = true;
        else if (arg.startsWith('--date=')) config.date = arg.split('=')[1];
        else if (arg.startsWith('--from=')) config.from = arg.split('=')[1];
        else if (arg.startsWith('--to=')) config.to = arg.split('=')[1];
        else if (arg.startsWith('--limit=')) config.limit = parseInt(arg.split('=')[1]);
        else if (arg.startsWith('--batch=')) config.batchSize = parseInt(arg.split('=')[1]);
        else if (arg.startsWith('--wait=')) config.waitTime = parseInt(arg.split('=')[1]) * 1000;
    }
    
    return config;
}

function htmlToText(html) {
    if (!html) return '';
    const hasImg = /<img\b/i.test(html);
    let text = String(html);
    
    // Remove script/style
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
               .replace(/<style[\s\S]*?<\/style>/gi, '');
    
    // Preserve line breaks
    text = text.replace(/<br\s*\/?>/gi, '\n')
               .replace(/<\/p>/gi, '\n');
    
    // Strip remaining tags
    text = text.replace(/<[^>]*>/g, '');
    
    // Decode common entities
    text = text.replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&#39;/g, "'")
               .replace(/&quot;/g, '"');
    
    text = text.replace(/[ \t]+\n/g, '\n').trim();
    
    if (!text && hasImg) return '[IMAGE]';
    return text;
}

// ============ INTERCOM API FUNCTIONS ============

async function searchConversations(fromTs, toTs, limit = null) {
    console.log('   Searching Intercom conversations...');
    
    const conversations = [];
    let startingAfter = null;
    let page = 0;
    const maxPages = 50;
    
    while (page < maxPages) {
        try {
            const body = {
                query: {
                    operator: 'AND',
                    value: [
                        { field: 'created_at', operator: '>=', value: fromTs },
                        { field: 'created_at', operator: '<=', value: toTs }
                    ]
                },
                pagination: {
                    per_page: 150,
                    starting_after: startingAfter
                }
            };
            
            const response = await intercom.post('/conversations/search', body);
            const data = response.data;
            const batch = data.conversations || data.data || [];
            
            console.log(`   Page ${page + 1}: Found ${batch.length} conversations`);
            
            if (batch.length === 0) break;
            
            conversations.push(...batch);
            
            // Check limit
            if (limit && conversations.length >= limit) {
                console.log(`   Reached limit of ${limit} conversations`);
                return conversations.slice(0, limit);
            }
            
            // Check pagination
            const nextCursor = data.pages?.next?.starting_after;
            if (!nextCursor) break;
            
            startingAfter = nextCursor;
            page++;
            
            await sleep(200);
            
        } catch (error) {
            console.error(`   Error searching conversations: ${error.response?.status || error.message}`);
            if (error.response?.data) {
                console.error(`   ${JSON.stringify(error.response.data)}`);
            }
            break;
        }
    }
    
    return conversations;
}

async function fetchConversationDetails(conversationId) {
    try {
        const response = await intercom.get(`/conversations/${conversationId}`, {
            params: { display_as: 'plaintext' }
        });
        return response.data;
    } catch (error) {
        console.error(`   Error fetching conversation ${conversationId}: ${error.message}`);
        return null;
    }
}

async function fetchContactDetails(contactId) {
    if (!contactId) return null;
    try {
        const response = await intercom.get(`/contacts/${contactId}`);
        return response.data;
    } catch (error) {
        return null;
    }
}

// ============ TRANSCRIPT EXTRACTION ============

function extractTranscript(conv) {
    const messages = [];
    
    // Add initial message from source body
    if (conv.source?.body) {
        const body = htmlToText(conv.source.body);
        if (body) {
            messages.push({
                role: 'USER',
                body: body,
                created_at: conv.created_at || 0
            });
        }
    }
    
    // Extract messages from conversation parts
    const parts = conv.conversation_parts?.conversation_parts || [];
    
    for (const part of parts) {
        if (part.part_type !== 'comment' || !part.body) continue;
        
        const author = part.author || {};
        let role = 'UNKNOWN';
        
        if (author.type === 'user') role = 'USER';
        else if (author.type === 'admin') role = 'AGENT';
        else continue; // Skip bots and system
        
        const text = htmlToText(part.body);
        if (!text) continue;
        
        messages.push({
            role: role,
            body: text,
            created_at: part.created_at || 0
        });
    }
    
    // Sort by timestamp
    messages.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    
    // Format transcript
    const transcript = messages.map(m => `${m.role}: ${m.body}`).join('\n');
    
    return {
        transcript: transcript || '[EMPTY]',
        messageCount: messages.length
    };
}

// ============ AI TOPIC CATEGORIZATION ============

const CATEGORIZATION_PROMPT = `# FundedNext AI Categorization — Compressed v4.5 (GPT-4.1 Mini Optimized)

**Input:** Intercom support chat transcript provided below.

---

## 🎯 Task
Read entire conversation (user + agent). Identify client's main frustration topics from actual discussion, not button clicks.

---

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
- Multi-topic: 2-5 categories if equally dominant (separated by \` | \` in plain text mode)
- Exact spelling/casing from taxonomy
- If no match: \`"Undefined Topic"\`

**Sentiment values ONLY:**
- "Very Negative" | "Negative" | "Neutral" | "Positive" | "Very Positive"

**Resolution outcome (Was it in client's favor?):**
- **"Yes"** - Issue resolved in client's favor
- **"No"** - Issue NOT resolved in client's favor
- **"Pending"** - No resolution yet

---

## 🧱 Transcript Structure
Format:
\`\`\`
role:USER
body:<message>
role:AGENT
body:<message>
\`\`\`

**Ignore preset buttons** (first 1-4 user messages if <5 words or matching):
Free Trial, Challenge Account, FundedNext Account, Stellar Instant, Account Models, KYC, IP Rule, Restricted Strategies, News Rule, Trading Info, Restricted Countries, Trading Related Issues, Payment Related Issues, Platform/Account Model Switch Request, Account Pause/Unpause, Payout Related Issues, Dashboard Related Issue, Account Related Services, General Queries, CFD / Forex, Futures, HalloWin Offer, Start over, Connect to an agent.

---

## 🧠 Topic Taxonomy

### 🔐 KYC & Verification
Veriff Doesn't Accept KYC Documents | Waiting For KYC Verification | KYC Verification Delay Issue | KYC Done Yet to Receive FundedNext Account | Eligible for KYC But Pop-Up Missing | Already submitted but Dashboard shows "Verification Required" | TRM Email Issue | AI Interview / HireFlix Issue | Live Interview – No One Joined | Missed Interview Email | Underage | Swift KYC Not Eligible | KYC Eligibility Inquiry

### 📊 Dashboard & Account Access
Account Breach Issue | Dashboard update delay | Balance Mismatch | OTP Not Received | "Undefined" Login Error | Wrong Email Used | Incorrect Trading Cycle | 2FA Issue | Dashboard Access Blocked (Client Internet) | Dashboard Access Blocked (TT Issue) | Email already taken during registration | Unable to Create an Account | Cannot update information | Missing account in breached/inactive section | Account flagged without email | Fundednext Account Query | Did not receive Phase 2 Account | Facing error while trying to sign agreement

### 📐 Rules & Scaling
Challenge Rule Clarification | Scaling Rule Clarification | Scale-Up Eligibility Inquiry | Reset Eligibility Inquiry (Phase 2) | Profit Target Reached but Minimum Trading Days Incomplete | Minimum Trading Days Confusion | Challenge Account Query

### 💻 Platform & Trading Performance
Trading Disabled | Platform Freeze | Price/Chart Discrepancy | Market Data Delayed Issue | Missing Old Chart Data | Unable to Use Indicator | Unable to Use EA | TradingView not available for CFD | Slippage Issue | TP Didn't Hit Desired Price | Regular Slippage | Due to High Lot Size | During News / High Impact | Due to Server Issue | Volume Surge | Dissatisfied with PO Adjustment | Adjustment Denied | Midnight Slippage | Trade Disappeared | Unauthorized Trade | Off-Market Hour Issue | Not Enough Money | Pending Order Didn't Execute | Trade Closed at Cycle End | Crypto Pair Unavailable | Trade Closed Outside Candle (News) | Reported Late (3+ weeks) | Swap Charge Confusion | ASK/BID Confusion | Weekend Gap | Crypto Weekend Trading | High Spread | Unable to Close During News | Login Technical Glitch | MT5 Platform Login Issues | Tradovate login Issue | Ninjatrader login issue | TradingView login Issue | MT4 Login Issue

### 💳 Payment, Purchase & Refunds
Facing Payment Error | Payment Method Not Available | UPI Payment Missing | Payment Rejected from Client's End | Partial Payment Not Possible | No Payment Found (UPI/Local) | Unable to Submit Payment Form (TC Pay) | Account Not Provided Instantly (TC Pay) | Account Not Provided Instantly (Local) | Account Not Provided Instantly (Crypto) | Paid Less Than Needed | Crypto Payment Not Reflected | Wrong Network Payment | Network Not Available | Crypto Payment Failed (Client Side) | Double Charged | No Crypto Payment Found | Refund Delay | Confirmo Refund Issue | Wrong Account Model Purchase

### 💰 Payout & Profit-Share
Payout On Hold | Payout Delay Issue | Not Eligible for Payout | Payout Discrepancy | Invalid Wallet | RiseWorks Issue | Unable to See Payout Proof | High Processing Fee Complaint | Invoice Request | TRM Deduction Email | Payout from Breached Account | Profit Share Below Minimum ($20) | ECM Issue | Claiming Brand Promise | Payout Related Query

### 🎁 Offers, Coupons & Giveaway
Affiliate Issue | Coupon Code Not Working | Coupon Not Available | Unhappy with Coupon Perks | Forgot to Apply Coupon | Missing Free BOGO Account | Asking for BOGO Early | Giveaway Claim | Giveaway Query | Unhappy Not Winning Giveaway | Affiliate Code Failed | Unsatisfied with Discount | No Personal Coupon | Offer Related Query | Halloween Offer Query | Offer related confusion | Looking for coupon code

### 🏆 Certificates & Competition
Elite Trader Certificate | Payout Certificate | Checking Elite Cert in Wrong Phase | Certificate Name Issue | Asking for Certificate After Phase 2 | Competition Login Issue | Missing Password Mail | Leaderboard Error | Unhappy with Winner Result | Breached Competition Rule | Reward Delay | 50 Trades Limit Exceeded | Asking Winners Info | Registered for Next Month | Wants Competition Reset | Competition Rule Clarification | Unable to register in the Monthly Competition

### ⚙️ Technical / Country / Compliance / Verdict
Restricted Country Issue | Location Related Issue | Concern about EA Rules | EA Restriction (cTrader) | Abuser Client (Banned) | Leverage Reduction | Email Change | Name Change | Country Change | Subscription Email Issue | Account Delete Request | IP/Device Confirmation | Verdict from CPM | Verdict from Trading & Ethics | Verdict from PO | Dispute Related Issue | Account Deactivation Due to Abusive Activities

### 🧑💼 Support & Response
Delay in Receiving Customer Support

---

Now analyze this transcript:
`;

async function categorizeWithAI(transcript) {
    try {
        const response = await openai.post('/chat/completions', {
            model: 'gpt-4.1-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a support ticket categorization AI. Always respond with valid JSON only.'
                },
                {
                    role: 'user',
                    content: CATEGORIZATION_PROMPT + '\n\n' + transcript
                }
            ],
            temperature: 0,
            max_tokens: 1000
        });
        
        const content = response.data.choices[0]?.message?.content || '';
        
        // Parse JSON from response (handle markdown code blocks)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/```$/, '');
        } else if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```\s*/, '').replace(/```$/, '');
        }
        
        const parsed = JSON.parse(jsonStr);
        
        return {
            main_category: parsed['Main Category'] || [],
            sub_category: parsed['Sub category'] || [],
            sentiment_start: parsed['Customer sentiment']?.beginning || 'Unknown',
            sentiment_end: parsed['Customer sentiment']?.end || 'Unknown',
            resolution_outcome: parsed['Resolution outcome'] || 'Pending',
            feedbacks: parsed['Suggestions & feedback'] || []
        };
        
    } catch (error) {
        console.error(`   AI categorization error: ${error.message}`);
        return null;
    }
}

// ============ SUPABASE FUNCTIONS ============

async function upsertConversationTopic(conv, contactDetails, transcriptData, aiResult) {
    const conversationId = String(conv.id);
    
    // Check if record exists
    const { data: existing } = await supabase
        .from(TABLE_NAME)
        .select('Conversation ID')
        .eq('Conversation ID', conversationId)
        .limit(1);
    
    const record = {
        'Conversation ID': conversationId,
        'created_at': conv.created_at,
        'Assigned Channel ID': conv.team_assignee_id ? String(conv.team_assignee_id) : null,
        'Email': conv.source?.author?.email || null,
        'Product': htmlToText(conv.source?.body || '').substring(0, 500), // First 500 chars
        'Transcript': transcriptData.transcript,
        'User ID': conv.source?.author?.id || conv.contacts?.contacts?.[0]?.id || null,
        'Country': contactDetails?.location?.country || null,
        'Region': contactDetails?.location?.region || null
    };
    
    // Add AI results if available
    if (aiResult) {
        record['Main-Topics'] = Array.isArray(aiResult.main_category) 
            ? aiResult.main_category 
            : [aiResult.main_category];
        record['Sub-Topics'] = Array.isArray(aiResult.sub_category) 
            ? aiResult.sub_category 
            : [aiResult.sub_category];
        record['Sentiment Start'] = aiResult.sentiment_start;
        record['Sentiment End'] = aiResult.sentiment_end;
        record['Feedbacks'] = Array.isArray(aiResult.feedbacks) 
            ? aiResult.feedbacks 
            : [aiResult.feedbacks];
        record['Was it in client\'s favor?'] = aiResult.resolution_outcome;
    }
    
    let error;
    
    if (existing && existing.length > 0) {
        // Update existing record
        const result = await supabase
            .from(TABLE_NAME)
            .update(record)
            .eq('Conversation ID', conversationId);
        error = result.error;
    } else {
        // Insert new record
        const result = await supabase
            .from(TABLE_NAME)
            .insert(record);
        error = result.error;
    }
    
    if (error) {
        console.error(`   Save error for ${conv.id}: ${error.message}`);
        return false;
    }
    
    return true;
}

async function getUnanalyzedRecords(limit = 500) {
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .or('Sub-Topics.is.null,Sub-Topics.eq.{}')
        .limit(limit);
    
    if (error) {
        console.error(`Error fetching unanalyzed records: ${error.message}`);
        return [];
    }
    
    return data || [];
}

async function updateRecordWithAI(conversationId, aiResult) {
    const updateData = {
        'Main-Topics': Array.isArray(aiResult.main_category) 
            ? aiResult.main_category 
            : [aiResult.main_category],
        'Sub-Topics': Array.isArray(aiResult.sub_category) 
            ? aiResult.sub_category 
            : [aiResult.sub_category],
        'Sentiment Start': aiResult.sentiment_start,
        'Sentiment End': aiResult.sentiment_end,
        'Feedbacks': Array.isArray(aiResult.feedbacks) 
            ? aiResult.feedbacks 
            : [aiResult.feedbacks],
        'Was it in client\'s favor?': aiResult.resolution_outcome
    };
    
    const { error } = await supabase
        .from(TABLE_NAME)
        .update(updateData)
        .eq('Conversation ID', conversationId);
    
    if (error) {
        console.error(`   Update error for ${conversationId}: ${error.message}`);
        return false;
    }
    
    return true;
}

// ============ MAIN SYNC FUNCTIONS ============

async function syncConversations(config) {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('   INTERCOM → SUPABASE TOPIC SYNC');
    console.log('   (Replicating n8n workflow)');
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Calculate date range
    let fromDate, toDate;
    
    if (config.date) {
        // Single date
        fromDate = new Date(config.date + 'T00:00:00Z');
        toDate = new Date(config.date + 'T23:59:59Z');
    } else if (config.from && config.to) {
        // Date range
        fromDate = new Date(config.from + 'T00:00:00Z');
        toDate = new Date(config.to + 'T23:59:59Z');
    } else {
        // Default to today
        const today = new Date();
        fromDate = new Date(today.toISOString().split('T')[0] + 'T00:00:00Z');
        toDate = new Date(today.toISOString().split('T')[0] + 'T23:59:59Z');
    }
    
    const fromTs = Math.floor(fromDate.getTime() / 1000);
    const toTs = Math.floor(toDate.getTime() / 1000);
    
    console.log(`📅 Date Range: ${fromDate.toISOString()} to ${toDate.toISOString()}`);
    console.log(`📊 Limit: ${config.limit || 'No limit'}\n`);
    
    // 1. Search conversations
    console.log('📬 Fetching conversations from Intercom...');
    const conversations = await searchConversations(fromTs, toTs, config.limit);
    console.log(`   Found ${conversations.length} conversations\n`);
    
    if (conversations.length === 0) {
        console.log('⚠️ No conversations found in date range');
        return;
    }
    
    // 2. Filter for closed conversations with source type "conversation"
    const filtered = conversations.filter(c => 
        c.state === 'closed' && c.source?.type === 'conversation'
    );
    console.log(`   Filtered to ${filtered.length} closed conversations\n`);
    
    // 3. Process each conversation
    console.log('🔄 Processing conversations...\n');
    let processed = 0;
    let errors = 0;
    
    for (let i = 0; i < filtered.length; i++) {
        const conv = filtered[i];
        
        try {
            // Fetch full conversation details
            console.log(`   [${i + 1}/${filtered.length}] Processing conversation ${conv.id}...`);
            const details = await fetchConversationDetails(conv.id);
            
            if (!details) {
                errors++;
                continue;
            }
            
            // Extract transcript
            const transcriptData = extractTranscript(details);
            console.log(`      Transcript: ${transcriptData.messageCount} messages`);
            
            // Fetch contact details for country/region
            const contactId = details.source?.author?.id || details.contacts?.contacts?.[0]?.id;
            const contactDetails = await fetchContactDetails(contactId);
            
            if (contactDetails?.location?.country) {
                console.log(`      Country: ${contactDetails.location.country}`);
            }
            
            // AI categorization (if transcript is not empty)
            let aiResult = null;
            if (transcriptData.transcript && transcriptData.transcript !== '[EMPTY]') {
                console.log(`      Analyzing with AI...`);
                aiResult = await categorizeWithAI(transcriptData.transcript);
                
                if (aiResult) {
                    console.log(`      Topics: ${aiResult.main_category.join(', ')}`);
                    console.log(`      Sentiment: ${aiResult.sentiment_start} → ${aiResult.sentiment_end}`);
                }
                
                // Rate limiting for AI calls
                await sleep(config.waitTime);
            }
            
            // Upsert to Supabase
            const success = await upsertConversationTopic(details, contactDetails, transcriptData, aiResult);
            
            if (success) {
                processed++;
                console.log(`      ✅ Saved to Supabase`);
            } else {
                errors++;
            }
            
        } catch (error) {
            console.error(`      ❌ Error: ${error.message}`);
            errors++;
        }
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('   SYNC COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   ✅ Processed: ${processed} conversations`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════\n');
}

async function analyzeExistingRecords(config) {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('   ANALYZE EXISTING RECORDS');
    console.log('   (AI Topic Categorization)');
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Get records with empty Sub-Topics
    console.log('📬 Fetching unanalyzed records from Supabase...');
    const records = await getUnanalyzedRecords(config.limit || 500);
    console.log(`   Found ${records.length} records to analyze\n`);
    
    if (records.length === 0) {
        console.log('⚠️ No unanalyzed records found');
        return;
    }
    
    // Process in batches
    console.log('🔄 Analyzing with AI...\n');
    let processed = 0;
    let errors = 0;
    
    for (let i = 0; i < records.length; i += config.batchSize) {
        const batch = records.slice(i, i + config.batchSize);
        
        for (const record of batch) {
            const convId = record['Conversation ID'];
            const transcript = record['Transcript'];
            
            if (!transcript || transcript === '[EMPTY]') {
                console.log(`   [${i + 1}/${records.length}] ${convId}: No transcript, skipping`);
                continue;
            }
            
            console.log(`   [${i + 1}/${records.length}] Analyzing ${convId}...`);
            
            const aiResult = await categorizeWithAI(transcript);
            
            if (aiResult) {
                const success = await updateRecordWithAI(convId, aiResult);
                
                if (success) {
                    processed++;
                    console.log(`      ✅ Topics: ${aiResult.main_category.join(', ')}`);
                } else {
                    errors++;
                }
            } else {
                errors++;
                console.log(`      ❌ AI analysis failed`);
            }
        }
        
        // Rate limiting between batches
        if (i + config.batchSize < records.length) {
            console.log(`\n   ⏳ Waiting ${config.waitTime / 1000}s before next batch...\n`);
            await sleep(config.waitTime);
        }
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('   ANALYSIS COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   ✅ Analyzed: ${processed} records`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════\n');
}

// ============ MAIN ============

async function main() {
    const config = parseArgs();
    
    if (config.analyzeOnly) {
        await analyzeExistingRecords(config);
    } else {
        await syncConversations(config);
    }
}

main().catch(console.error);
