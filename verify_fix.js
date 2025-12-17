import { supabase } from './src/services/supabaseClient.js';

async function verifyFix() {
    console.log('=== Verifying Fix ===\n');

    // Test the exact query with the fix applied
    const { data, error } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID", "Country", "Topic 1", created_at_bd')
        .not('created_at_bd', 'is', null)
        .order('created_at_bd', { ascending: false })
        .limit(5);

    if (error) {
        console.error('FAILED:', error.message);
    } else {
        console.log('SUCCESS: Got', data?.length, 'rows');
        console.log('Sample data:', JSON.stringify(data, null, 2));
    }
}

verifyFix();
