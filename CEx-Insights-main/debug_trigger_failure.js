
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://iktqpjwoahqycvlmstvx.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjM0NTIsImV4cCI6MjA3OTgzOTQ1Mn0.FAUyqVkB5AbLOZW7VwUsBreWdGV9NcCb4sOFSkM7WP0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function debugRow() {
    console.log('Fetching a failing row...');

    // Fetch rows that have no main topic, then filter in memory for "Veriff"
    // This avoids SQL casting issues with the client library
    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Sub-Topics"')
        .is('"Main-Topics"', null)
        .limit(100);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        // Find one with Veriff
        let row = null;
        let veriff = null;

        for (const r of data) {
            if (r['Sub-Topics']) {
                // Parse if string, otherwise assumes array
                let topics = r['Sub-Topics'];
                if (typeof topics === 'string') {
                    try { topics = JSON.parse(topics); } catch (e) { }
                }

                if (Array.isArray(topics)) {
                    const match = topics.find(t => t && t.includes('Veriff'));
                    if (match) {
                        row = r;
                        veriff = match;
                        break;
                    }
                }
            }
        }

        if (veriff) {
            console.log('--- Raw Analysis ---');
            console.log('Sub-Topic Value:', veriff);
            console.log('Char Codes:');
            for (let i = 0; i < veriff.length; i++) {
                console.log(`${veriff[i]}: ${veriff.charCodeAt(i)}`);
            }

            // Check our expected string
            const expected = "Veriff Doesn't Accept KYC Documents";
            console.log('\nMatches Expected?', veriff === expected);

            if (veriff !== expected) {
                console.log('Expected:', expected);
                console.log('Difference found at:');
                for (let i = 0; i < Math.max(veriff.length, expected.length); i++) {
                    if (veriff[i] !== expected[i]) {
                        console.log(`Index ${i}: Got code ${veriff.charCodeAt(i) || 'NaN'} vs Expected ${expected.charCodeAt(i) || 'NaN'}`);
                        break;
                    }
                }
            }
        } else {
            console.log('No rows found containing "Veriff" that are missing Main-Topics.');
        }
    } else {
        console.log('No failing rows found.');
    }
}

debugRow();
