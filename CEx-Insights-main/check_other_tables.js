import { supabase } from './src/services/supabaseClient.js';

async function checkTableSizes() {
    console.log('Checking table counts...');

    const tables = ['all_topics', 'all_topics_with_main'];

    for (const t of tables) {
        // Just try to fetch a small chunk
        const { data, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
        if (error) {
            console.error(`Error checking ${t}:`, error.message);
        } else {
            console.log(`${t} count:`, data || 'N/A (head response)'); // head:true returns count in count property not data
            // Supabase JS client typically puts count in the 'count' property of result
        }
    }

    // Actually simpler to just fetch a few rows to see if successful
    for (const t of tables) {
        const { data, error } = await supabase.from(t).select('*').limit(5);
        if (error) {
            console.error(`Error checking val ${t}:`, error.message);
        } else {
            console.log(`Successfully fetched 5 rows from ${t}`);
        }
    }
}

checkTableSizes();
