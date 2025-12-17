import { supabase } from './src/services/supabaseClient.js';

async function verifyFinalFix() {
    console.log('=== Verifying Final Fix ===\n');

    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Topic 1", main_topic, "Country", created_at_bd')
        .not('created_at_bd', 'is', null)
        .neq('"Topic 1"', '')
        .order('created_at_bd', { ascending: false })
        .limit(10);

    if (error) {
        console.error('ERROR:', error.message);
        return;
    }

    console.log('SUCCESS: Got', data?.length, 'rows with topics');
    if (data?.length > 0) {
        console.log('\nSample data:');
        data.forEach((row, i) => {
            console.log(`  ${i + 1}. Topic: "${row['Topic 1']}" | Main: "${row.main_topic}" | Country: "${row.Country}"`);
        });
    }
}

verifyFinalFix();
