
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const SUPABASE_URL = 'https://iktqpjwoahqycvlmstvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjM0NTIsImV4cCI6MjA3OTgzOTQ1Mn0.FAUyqVkB5AbLOZW7VwUsBreWdGV9NcCb4sOFSkM7WP0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkCounts() {
    console.log('--- Checking Conversation Counts (2025-08-01 to 2025-12-17) ---');

    const startDate = '2025-08-01T00:00:00Z';
    const endDate = '2025-12-17T23:59:59Z';

    // 1. Total Raw Count
    const { count: totalRaw, error: err1 } = await supabase
        .from('Intercom Topic')
        .select('*', { count: 'exact', head: true })
        .gte('Conversation Date', startDate)
        .lte('Conversation Date', endDate);

    if (err1) console.error('Error fetching total raw:', err1);
    else console.log(`Total DB Rows: ${totalRaw}`);

    // 2. Count with Non-Empty Main Topic (JSONB)
    const { count: totalMain, error: err2 } = await supabase
        .from('Intercom Topic')
        .select('*', { count: 'exact', head: true })
        .gte('Conversation Date', startDate)
        .lte('Conversation Date', endDate)
        .not('Main-Topics', 'is', null)
        .neq('Main-Topics', '[]'); // Check for empty array string if stored as text, or empty jsonb

    // Note: Checking empty JSONB array might need specific syntax depending on column type, trying standard first

    if (err2) console.error('Error fetching total with Main Topic:', err2);
    else console.log(`Rows with Main-Topics: ${totalMain}`);

    // 3. Count with Non-Empty Topic (JSONB) - Topic 1 is usually the source, but frontend uses `topic` which maps to `Topic` column array
    // Let's check `Topic 1` as well since that was the old source
    const { count: totalTopic1, error: err3 } = await supabase
        .from('Intercom Topic')
        .select('*', { count: 'exact', head: true })
        .gte('Conversation Date', startDate)
        .lte('Conversation Date', endDate)
        .not('Topic 1', 'is', null)
        .neq('Topic 1', '');

    if (err3) console.error('Error fetching total with Topic 1:', err3);
    else console.log(`Rows with Topic 1: ${totalTopic1}`);
}

checkCounts();
