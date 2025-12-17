import { supabase } from './src/services/supabaseClient.js';

// Get filter values from CSAT table (which works)
async function getCSATFilters() {
    console.log('Getting filters from csat_norm table...');

    const { data, error } = await supabase
        .from('csat_norm')
        .select('location, product, channel')
        .limit(500);

    if (error) {
        console.error('Error:', error);
        return;
    }

    const locations = new Set();
    const products = new Set();

    data?.forEach(row => {
        if (row.location) locations.add(row.location);
        if (row.product) products.add(row.product);
    });

    console.log('Locations (countries):', [...locations].sort());
    console.log('Products:', [...products].sort());
}

getCSATFilters();
