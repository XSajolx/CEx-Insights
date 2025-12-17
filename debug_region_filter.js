import { supabase } from './src/services/supabaseClient.js';

// Test what happens when we filter by Africa countries
async function debugRegionFilter() {
    console.log('=== Debugging Region Filter ===\n');

    // Countries we expect to be in Africa based on our mapping
    const africaCountries = [
        'Algeria', 'Botswana', 'Cameroon', 'Egypt', 'Ethiopia', 'Gambia',
        'Ghana', 'Kenya', 'Madagascar', 'Mali', 'Mauritania', 'Morocco',
        'Nigeria', 'South Africa', 'Somalia', 'Togo', 'Uganda', 'Zambia',
        'Zimbabwe', 'Réunion'
    ];

    console.log('1. Testing filter with Africa countries:', africaCountries.slice(0, 5), '...');

    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Country"')
        .in('"Country"', africaCountries)
        .not('created_at_bd', 'is', null)
        .neq('"Topic 1"', '')
        .limit(10);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log(`Found ${data?.length || 0} rows matching Africa countries`);
    if (data?.length > 0) {
        console.log('Sample countries found:', data.map(r => r.Country));
    }

    // Now check what countries actually exist in the database
    console.log('\n2. Checking actual country values in database...');
    const { data: allCountries, error: err2 } = await supabase
        .from('Intercom Topic')
        .select('"Country"')
        .not('"Country"', 'is', null)
        .neq('"Country"', '')
        .limit(1000);

    if (err2) {
        console.error('Error:', err2.message);
        return;
    }

    const uniqueCountries = [...new Set(allCountries?.map(r => r.Country))].sort();
    console.log(`Total unique countries in database: ${uniqueCountries.length}`);
    console.log('First 20 countries:', uniqueCountries.slice(0, 20));
}

debugRegionFilter();
