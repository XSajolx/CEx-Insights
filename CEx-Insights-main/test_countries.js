import { supabase } from './src/services/supabaseClient.js';

// Test getting countries from Intercom Topic with minimal query
async function testIntercomCountries() {
    console.log('Testing Intercom Topic country query...');

    // Try small limit without ordering
    const start = Date.now();
    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Country"')
        .neq('"Country"', '')
        .neq('"Country"', 'EMPTY')
        .limit(2000);

    console.log(`Query took ${Date.now() - start}ms`);

    if (error) {
        console.error('Error:', error);
        return;
    }

    const countries = [...new Set(
        data?.map(row => row.Country).filter(c => c && c.trim() && c !== 'EMPTY')
    )].sort();

    console.log(`Found ${countries.length} unique countries:`);
    console.log(countries);
}

testIntercomCountries();
