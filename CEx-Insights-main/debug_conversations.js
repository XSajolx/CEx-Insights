import { supabase } from './src/services/supabaseClient.js';

async function debugConversations() {
    console.log('=== Debugging Conversation Data Fetch ===\n');

    // Test 1: Simple query without any filters (just get ANY data)
    console.log('Test 1: Fetching 5 rows without any filters...');
    const { data: test1, error: err1 } = await supabase
        .from('Intercom Topic')
        .select('*')
        .limit(5);

    if (err1) {
        console.error('Test 1 FAILED:', err1.message);
    } else {
        console.log('Test 1 SUCCESS: Got', test1?.length, 'rows');
        if (test1?.length > 0) {
            console.log('Sample columns:', Object.keys(test1[0]));
        }
    }

    // Test 2: Check if created_at_bd column exists
    console.log('\nTest 2: Try ordering by created_at_bd...');
    const { data: test2, error: err2 } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID", created_at_bd')
        .order('created_at_bd', { ascending: false })
        .limit(5);

    if (err2) {
        console.error('Test 2 FAILED (created_at_bd may not exist):', err2.message);
    } else {
        console.log('Test 2 SUCCESS:', test2?.length, 'rows');
        if (test2?.length > 0) console.log('Sample row:', test2[0]);
    }

    // Test 3: Try the exact query from getSupabaseData
    console.log('\nTest 3: Exact query from getSupabaseData...');
    const { data: test3, error: err3 } = await supabase
        .from('Intercom Topic')
        .select('created_date_bd,"Conversation ID","Country","Region","Product",assigned_channel_name,"CX Score Rating","Topic 1"')
        .order('created_at_bd', { ascending: false })
        .limit(1000);

    if (err3) {
        console.error('Test 3 FAILED:', err3.message);
    } else {
        console.log('Test 3 SUCCESS:', test3?.length, 'rows');
        if (test3?.length > 0) {
            console.log('Sample row:', JSON.stringify(test3[0], null, 2));
        }
    }

    // Test 4: Check available columns
    console.log('\nTest 4: List all column names from first row...');
    const { data: test4, error: err4 } = await supabase
        .from('Intercom Topic')
        .select('*')
        .limit(1);

    if (err4) {
        console.error('Test 4 FAILED:', err4.message);
    } else if (test4?.length > 0) {
        console.log('All columns:', Object.keys(test4[0]).join(', '));
    }
}

debugConversations().catch(console.error);
