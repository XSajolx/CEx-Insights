
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://iktqpjwoahqycvlmstvx.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjM0NTIsImV4cCI6MjA3OTgzOTQ1Mn0.FAUyqVkB5AbLOZW7VwUsBreWdGV9NcCb4sOFSkM7WP0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function debugCanada() {
    console.log('Fetching Topic Mappings...');

    // 1. Fetch ALL Mappings
    const { data: mappingData, error: mapError } = await supabase
        .from('all_topics_with_main')
        .select('topic, main_topic')
        .limit(10000); // We know this limit is high enough, hopefully

    if (mapError) { console.error('Map Error:', mapError); return; }

    const mapping = {};
    const mainTopicsSet = new Set();

    mappingData.forEach(r => {
        if (r.topic && r.main_topic) {
            const t = r.topic.trim();
            const m = r.main_topic.trim();
            mapping[t] = m;
            mainTopicsSet.add(m);
        }
    });

    console.log(`Loaded ${Object.keys(mapping).length} mappings.`);
    console.log(`Unique Main Topics:`, [...mainTopicsSet].slice(0, 5));

    // 2. Fetch Canada Data
    console.log('Fetching Canada Conversations...');
    let query = supabase
        .from('Intercom Topic')
        .select('"Topic 1"') // Only need the topic column
        .eq('"Country"', 'Canada')
        //.gte('created_date_bd', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .limit(50);

    const { data: canadaData, error: canadaError } = await query;

    if (canadaError) {
        console.error('Canada Fetch Error:', canadaError);
        console.log('Check if "Intercom Topic" table name is correct and accessible.');
        return;
    }

    console.log(`Fetched ${canadaData.length} Canada rows.`);

    if (canadaData.length === 0) {
        console.log('No data found for Canada. Check filters.');
        return;
    }

    // 3. Analyze
    const analysis = {};
    let unmappedCount = 0;

    canadaData.forEach(row => {
        const rawTopic = row['Topic 1'] || '(empty)';
        const cleanTopic = rawTopic.trim();
        const mapped = mapping[cleanTopic];

        if (!analysis[cleanTopic]) {
            analysis[cleanTopic] = {
                count: 0,
                mappedTo: mapped || 'MISSING',
                isKnownMain: mainTopicsSet.has(mapped)
            };
        }
        analysis[cleanTopic].count++;
        if (!mapped) unmappedCount++;
    });

    console.table(analysis);
    console.log(`\nUnmapped Topics: ${unmappedCount} / ${canadaData.length}`);
}

debugCanada();
