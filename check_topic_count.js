import { supabase } from './src/services/supabaseClient.js';

async function checkTopicCount() {
    const { count, error } = await supabase
        .from('all_topics_with_main')
        .select('*', { count: 'exact', head: true });

    if (error) console.error(error);
    console.log('Total topics in mapping table:', count);
}

checkTopicCount();
