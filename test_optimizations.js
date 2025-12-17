import { supabase } from './src/services/supabaseClient.js';

async function testOptimizations() {
    console.log('=== Testing Optimizations ===\n');

    // Test 1: RPC function
    console.log('Test 1: get_topic_distribution RPC...');
    const start1 = Date.now();
    const { data: t1, error: e1 } = await supabase.rpc('get_topic_distribution', { p_limit: 20 });
    console.log(`  Time: ${Date.now() - start1}ms`);
    if (e1) console.error('  Error:', e1.message);
    else console.log('  Topics:', t1?.slice(0, 5));

    // Test 2: Indexed query with higher limit
    console.log('\nTest 2: Indexed query with 5000 limit...');
    const start2 = Date.now();
    const { data: t2, error: e2 } = await supabase
        .from('Intercom Topic')
        .select('"Topic 1", main_topic')
        .not('created_at_bd', 'is', null)
        .neq('"Topic 1"', '')
        .order('created_at_bd', { ascending: false })
        .limit(5000);
    console.log(`  Time: ${Date.now() - start2}ms, Rows: ${t2?.length || 0}`);
    if (e2) console.error('  Error:', e2.message);
}

testOptimizations();
