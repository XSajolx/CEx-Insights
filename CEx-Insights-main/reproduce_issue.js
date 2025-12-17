import { supabase } from './src/services/supabaseClient.js';

async function reproduceIssue() {
    console.log('Reproducing 0 results for Africa + Last 3 Months...');

    // Exact params seen in logs
    const dateStart = '2025-09-15';
    // Full Africa list from api.js
    const countries = [
        'Algeria', 'Botswana', 'Cameroon', 'Egypt',
        'Ethiopia', 'Gambia', 'Ghana', 'Kenya',
        'Madagascar', 'Mali', 'Mauritania', 'Morocco',
        'Nigeria', 'South Africa', 'Somalia', 'Togo',
        'Uganda', 'Zambia', 'Zimbabwe', 'Réunion'
    ];

    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Country", created_at_bd, "Topic 1"')
        .in('"Country"', countries)
        .gte('created_at_bd', dateStart)
        .not('created_at_bd', 'is', null)
        .neq('"Topic 1"', '')
        .order('created_at_bd', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Query returned ${data?.length} rows.`);
    if (data?.length > 0) {
        console.log('Sample row:', data[0]);
    } else {
        console.log('Confirmed: No data matches these criteria.');
    }
}

reproduceIssue();
