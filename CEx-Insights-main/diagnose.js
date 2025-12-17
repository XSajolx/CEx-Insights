import { supabase } from './src/services/supabaseClient.js';

async function diagnoseAllQueries() {
    console.log('=== Comprehensive Query Diagnosis ===\n');

    // Test 1: Basic query without ordering
    console.log('Test 1: Simple query without ordering...');
    const start1 = Date.now();
    const { data: t1, error: e1 } = await supabase
        .from('Intercom Topic')
        .select('"Topic 1", main_topic')
        .limit(500);
    console.log(`  Time: ${Date.now() - start1}ms, Rows: ${t1?.length || 0}, Error: ${e1?.message || 'none'}`);
    if (t1?.length > 0) {
        const withTopic = t1.filter(r => r['Topic 1'] && r['Topic 1'].trim());
        console.log(`  Rows with Topic 1: ${withTopic.length}`);
    }

    // Test 2: Query with NOT NULL filter (our fix)
    console.log('\nTest 2: With NOT NULL created_at_bd filter...');
    const start2 = Date.now();
    const { data: t2, error: e2 } = await supabase
        .from('Intercom Topic')
        .select('"Topic 1", main_topic, created_at_bd')
        .not('created_at_bd', 'is', null)
        .limit(500);
    console.log(`  Time: ${Date.now() - start2}ms, Rows: ${t2?.length || 0}, Error: ${e2?.message || 'none'}`);
    if (t2?.length > 0) {
        const withTopic = t2.filter(r => r['Topic 1'] && r['Topic 1'].trim());
        console.log(`  Rows with Topic 1: ${withTopic.length}`);
    }

    // Test 3: Query with NOT NULL filter AND ordering (current implementation)
    console.log('\nTest 3: With NOT NULL filter + ORDER BY...');
    const start3 = Date.now();
    const { data: t3, error: e3 } = await supabase
        .from('Intercom Topic')
        .select('"Topic 1", main_topic, created_at_bd')
        .not('created_at_bd', 'is', null)
        .order('created_at_bd', { ascending: false })
        .limit(500);
    console.log(`  Time: ${Date.now() - start3}ms, Rows: ${t3?.length || 0}, Error: ${e3?.message || 'none'}`);

    // Test 4: Query with NOT EMPTY Topic 1
    console.log('\nTest 4: With Topic 1 NOT EMPTY...');
    const start4 = Date.now();
    const { data: t4, error: e4 } = await supabase
        .from('Intercom Topic')
        .select('"Topic 1", main_topic')
        .neq('"Topic 1"', '')
        .limit(500);
    console.log(`  Time: ${Date.now() - start4}ms, Rows: ${t4?.length || 0}, Error: ${e4?.message || 'none'}`);

    // Test 5: Simplest possible query
    console.log('\nTest 5: Simplest query (just main_topic)...');
    const start5 = Date.now();
    const { data: t5, error: e5 } = await supabase
        .from('Intercom Topic')
        .select('main_topic')
        .not('main_topic', 'is', null)
        .limit(1000);
    console.log(`  Time: ${Date.now() - start5}ms, Rows: ${t5?.length || 0}, Error: ${e5?.message || 'none'}`);
    if (t5?.length > 0) {
        const topics = [...new Set(t5.map(r => r.main_topic).filter(Boolean))];
        console.log(`  Unique main_topics: ${topics.slice(0, 10).join(', ')}...`);
    }
}

diagnoseAllQueries().catch(console.error);
