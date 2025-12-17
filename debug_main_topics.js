
// debug_main_topics.js
import { createClient } from '@supabase/supabase-js';

// Hardcoded creds from previous context
const SUPABASE_URL = 'https://iktqpjwoahqycvlmstvx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjM0NTIsImV4cCI6MjA3OTgzOTQ1Mn0.FAUyqVkB5AbLOZW7VwUsBreWdGV9NcCb4sOFSkM7WP0';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkMainTopics() {
    console.log('Checking Main-Topics column...');

    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('created_date_bd, "Topic 1", "Main-Topics", "Sub-Topics"')
        .not('"Main-Topics"', 'is', null) // Only check populated ones
        .limit(20);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Sample rows:');
    data.forEach(row => {
        console.log('---');
        console.log('Topic 1 (Old):', row['Topic 1']);
        console.log('Sub-Topics (New):', JSON.stringify(row['Sub-Topics']));
        console.log('Main-Topics (New):', JSON.stringify(row['Main-Topics']));
    });
}

checkMainTopics();
