import { supabase } from './src/services/supabaseClient.js';

async function checkAfricaDates() {
    console.log('Checking Dates for Africa...');

    // Get typical Africa countruies
    const africaCountries = ['Nigeria', 'South Africa', 'Kenya', 'Egypt', 'Morocco'];

    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Country", created_at_bd')
        .in('"Country"', africaCountries)
        .not('created_at_bd', 'is', null)
        .neq('"Topic 1"', '')
        .order('created_at_bd', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${data?.length} rows.`);
    if (data?.length > 0) {
        data.forEach((row, i) => {
            console.log(`Row ${i}: Country=${row.Country}, Date=${row.created_at_bd}`);
        });
    }
}

checkAfricaDates();
