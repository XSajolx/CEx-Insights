import { supabase } from './src/services/supabaseClient.js';

async function checkAfricaIDs() {
    console.log('Checking Conversation IDs for Africa...');

    // Get typical Africa countruies
    const africaCountries = ['Nigeria', 'South Africa', 'Kenya', 'Egypt'];

    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID", "Country", "Topic 1"')
        .in('"Country"', africaCountries)
        .not('created_at_bd', 'is', null)
        .neq('"Topic 1"', '')
        .limit(20);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${data?.length} rows.`);
    if (data?.length > 0) {
        data.forEach((row, i) => {
            console.log(`Row ${i}: Country=${row.Country}, Topic=${row['Topic 1']}, ID=${row['Conversation ID']}`);
        });
    }
}

checkAfricaIDs();
