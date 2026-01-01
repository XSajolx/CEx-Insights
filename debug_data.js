import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://iktqpjwoahqycvlmstvx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjM0NTIsImV4cCI6MjA3OTgzOTQ1Mn0.FAUyqVkB5AbLOZW7VwUsBreWdGV9NcCb4sOFSkM7WP0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugData() {
    console.log('=== Fetching data from Supabase ===\n');
    
    // Get last 90 days data
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const startDate = threeMonthsAgo.toISOString().split('T')[0];
    
    console.log('Start date:', startDate);
    
    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID","Main-Topics","Sub-Topics",created_date_bd')
        .gte('created_at_bd', startDate)
        .limit(500);
    
    if (error) {
        console.error('Error:', error);
        return;
    }
    
    console.log(`\nTotal rows fetched: ${data.length}\n`);
    
    // Count unique conversation IDs
    const uniqueConvIds = new Set();
    data.forEach(row => {
        if (row['Conversation ID']) {
            uniqueConvIds.add(row['Conversation ID']);
        }
    });
    console.log(`Unique Conversation IDs: ${uniqueConvIds.size}\n`);
    
    // Count main topics
    const mainTopicCounts = {};
    const subTopicCounts = {};
    let totalSubTopics = 0;
    
    data.forEach(row => {
        // Main Topics
        let mainTopics = row['Main-Topics'] || [];
        if (typeof mainTopics === 'string') {
            try { mainTopics = JSON.parse(mainTopics); } catch(e) { mainTopics = [mainTopics]; }
        }
        if (!Array.isArray(mainTopics)) mainTopics = [];
        
        mainTopics.forEach(topic => {
            if (topic && topic.trim()) {
                mainTopicCounts[topic.trim()] = (mainTopicCounts[topic.trim()] || 0) + 1;
            }
        });
        
        // Sub Topics
        let subTopics = row['Sub-Topics'] || [];
        if (typeof subTopics === 'string') {
            try { subTopics = JSON.parse(subTopics); } catch(e) { subTopics = [subTopics]; }
        }
        if (!Array.isArray(subTopics)) subTopics = [];
        
        subTopics.forEach(topic => {
            if (topic && topic.trim()) {
                subTopicCounts[topic.trim()] = (subTopicCounts[topic.trim()] || 0) + 1;
                totalSubTopics++;
            }
        });
    });
    
    console.log('=== Main Topic Counts ===');
    Object.entries(mainTopicCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([topic, count]) => {
            console.log(`  ${topic}: ${count}`);
        });
    
    console.log(`\nTotal Main Topics: ${Object.values(mainTopicCounts).reduce((a, b) => a + b, 0)}`);
    
    console.log('\n=== Sub Topic Counts ===');
    Object.entries(subTopicCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([topic, count]) => {
            console.log(`  ${topic}: ${count}`);
        });
    
    console.log(`\nTotal Sub Topics: ${totalSubTopics}`);
    
    // Check for sub-topics under KYC_Issue main topic
    console.log('\n=== KYC_Issue Details ===');
    let kycCount = 0;
    data.forEach(row => {
        let mainTopics = row['Main-Topics'] || [];
        if (typeof mainTopics === 'string') {
            try { mainTopics = JSON.parse(mainTopics); } catch(e) { mainTopics = [mainTopics]; }
        }
        if (!Array.isArray(mainTopics)) mainTopics = [];
        
        if (mainTopics.includes('KYC_Issue')) {
            kycCount++;
            let subTopics = row['Sub-Topics'] || [];
            if (typeof subTopics === 'string') {
                try { subTopics = JSON.parse(subTopics); } catch(e) { subTopics = [subTopics]; }
            }
            console.log(`  Conv ${row['Conversation ID']}: Main=${JSON.stringify(mainTopics)}, Sub=${JSON.stringify(subTopics)}`);
        }
    });
    console.log(`\nTotal rows with KYC_Issue main topic: ${kycCount}`);
    
    // Show sample rows
    console.log('\n=== Sample Data (first 5 rows) ===');
    data.slice(0, 5).forEach((row, i) => {
        console.log(`\nRow ${i + 1}:`);
        console.log(`  Conversation ID: ${row['Conversation ID']}`);
        console.log(`  Main-Topics: ${JSON.stringify(row['Main-Topics'])}`);
        console.log(`  Sub-Topics: ${JSON.stringify(row['Sub-Topics'])}`);
        console.log(`  Date: ${row.created_date_bd}`);
    });
}

debugData().catch(console.error);

