import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://iktqpjwoahqycvlmstvx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjM0NTIsImV4cCI6MjA3OTgzOTQ1Mn0.FAUyqVkB5AbLOZW7VwUsBreWdGV9NcCb4sOFSkM7WP0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTranscript() {
    console.log('=== Checking Transcript Column ===\n');
    
    // Get a few rows with Transcript
    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID","Transcript","Country","Product",created_date_bd')
        .not('Transcript', 'is', null)
        .limit(3);
    
    if (error) {
        console.error('Error:', error);
        return;
    }
    
    console.log(`Found ${data?.length || 0} rows with Transcript\n`);
    
    data?.forEach((row, i) => {
        console.log(`\n=== Row ${i + 1} ===`);
        console.log(`Conversation ID: ${row['Conversation ID']}`);
        console.log(`Country: ${row.Country}`);
        console.log(`Product: ${row.Product}`);
        console.log(`Date: ${row.created_date_bd}`);
        console.log(`Transcript (first 500 chars):`);
        const transcript = row.Transcript || '';
        console.log(transcript.substring(0, 500));
        console.log('...\n');
    });
}

checkTranscript().catch(console.error);

