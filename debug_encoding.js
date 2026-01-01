import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://iktqpjwoahqycvlmstvx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjM0NTIsImV4cCI6MjA3OTgzOTQ1Mn0.FAUyqVkB5AbLOZW7VwUsBreWdGV9NcCb4sOFSkM7WP0';

const supabase = createClient(supabaseUrl, supabaseKey);

// TOPIC_MAPPING from the code
const TOPIC_MAPPING = {
    "Veriff Doesn't Accept KYC Documents": "KYC_Issue",
    "Waiting For KYC Verification": "KYC_Issue",
    "KYC Verification Delay Issue": "KYC_Issue",
    "KYC Done Yet to Receive FundedNext Account": "KYC_Issue",
    "TRM Email Issue": "KYC_Issue",
    // ... other mappings
};

async function debugEncoding() {
    console.log('=== Checking Character Encoding Issues ===\n');
    
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const startDate = threeMonthsAgo.toISOString().split('T')[0];
    
    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID","Main-Topics","Sub-Topics"')
        .gte('created_at_bd', startDate)
        .limit(500);
    
    if (error) {
        console.error('Error:', error);
        return;
    }
    
    // Find all unique sub-topics from database
    const dbSubTopics = new Set();
    data.forEach(row => {
        let subTopics = row['Sub-Topics'] || [];
        if (typeof subTopics === 'string') {
            try { subTopics = JSON.parse(subTopics); } catch(e) { subTopics = [subTopics]; }
        }
        if (!Array.isArray(subTopics)) subTopics = [];
        subTopics.forEach(t => {
            if (t && t.trim()) dbSubTopics.add(t.trim());
        });
    });
    
    console.log('=== Sub-Topics in Database ===');
    const sortedDbTopics = [...dbSubTopics].sort();
    sortedDbTopics.forEach(topic => {
        console.log(`"${topic}"`);
        // Show character codes for topics with apostrophes
        if (topic.includes("'") || topic.includes("'") || topic.includes("'")) {
            console.log(`  Character codes: ${[...topic].map(c => c.charCodeAt(0)).join(', ')}`);
        }
    });
    
    console.log('\n=== Checking TOPIC_MAPPING matches ===');
    let matchCount = 0;
    let noMatchCount = 0;
    const noMatchTopics = [];
    
    sortedDbTopics.forEach(dbTopic => {
        if (TOPIC_MAPPING[dbTopic]) {
            matchCount++;
            console.log(`✓ "${dbTopic}" -> ${TOPIC_MAPPING[dbTopic]}`);
        } else {
            noMatchCount++;
            noMatchTopics.push(dbTopic);
        }
    });
    
    console.log(`\n=== Summary ===`);
    console.log(`Matched: ${matchCount}`);
    console.log(`Not Matched: ${noMatchCount}`);
    
    if (noMatchTopics.length > 0) {
        console.log(`\n=== Topics NOT in TOPIC_MAPPING ===`);
        noMatchTopics.forEach(topic => {
            console.log(`  - "${topic}"`);
            // Check for similar entries
            const lowerTopic = topic.toLowerCase();
            Object.keys(TOPIC_MAPPING).forEach(mapKey => {
                if (mapKey.toLowerCase() === lowerTopic) {
                    console.log(`    ^ Possible case mismatch with: "${mapKey}"`);
                }
                // Check without apostrophe variations
                const normalizedDb = topic.replace(/['']/g, "'");
                const normalizedMap = mapKey.replace(/['']/g, "'");
                if (normalizedDb === normalizedMap && topic !== mapKey) {
                    console.log(`    ^ Apostrophe mismatch with: "${mapKey}"`);
                }
            });
        });
    }
    
    // Check for the specific Veriff issue
    console.log('\n=== Veriff KYC Check ===');
    const veriffTopics = sortedDbTopics.filter(t => t.toLowerCase().includes('veriff'));
    veriffTopics.forEach(topic => {
        console.log(`DB: "${topic}"`);
        console.log(`  Char codes: ${[...topic].map(c => c.charCodeAt(0)).join(', ')}`);
        console.log(`  In TOPIC_MAPPING: ${TOPIC_MAPPING[topic] || 'NOT FOUND'}`);
    });
    
    const mappingVeriff = "Veriff Doesn't Accept KYC Documents";
    console.log(`\nTOPIC_MAPPING key: "${mappingVeriff}"`);
    console.log(`  Char codes: ${[...mappingVeriff].map(c => c.charCodeAt(0)).join(', ')}`);
}

debugEncoding().catch(console.error);

