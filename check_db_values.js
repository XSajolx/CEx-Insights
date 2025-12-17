import { createClient } from '@supabase/supabase-js';

// Credentials from src/services/supabaseClient.js
const supabaseUrl = 'https://iktqpjwoahqycvlmstvx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjM0NTIsImV4cCI6MjA3OTgzOTQ1Mn0.FAUyqVkB5AbLOZW7VwUsBreWdGV9NcCb4sOFSkM7WP0';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkValues() {
    console.log('Fetching distinct Products...');
    const { data: products, error: prodError } = await supabase
        .from('Intercom Topic')
        .select('Product')
        .limit(2000);

    if (prodError) {
        console.error('Error fetching products:', prodError);
    } else {
        const uniqueProducts = [...new Set(products.map(p => p.Product).filter(Boolean))];
        console.log('Unique Products in sample:', uniqueProducts);
    }

    console.log('\nFetching distinct Countries...');
    const { data: countries, error: countryError } = await supabase
        .from('Intercom Topic')
        .select('Country')
        .limit(2000);

    if (countryError) {
        console.error('Error fetching countries:', countryError);
    } else {
        const uniqueCountries = [...new Set(countries.map(c => c.Country).filter(Boolean))].sort();
        console.log('Unique Countries in sample (first 20):', uniqueCountries.slice(0, 20));
        console.log('Total unique count in sample:', uniqueCountries.length);

        // Check for specific problematic ones
        const checkList = ['Vietnam', 'Viet Nam', 'Korea', 'South Korea'];
        const found = uniqueCountries.filter(c => checkList.some(check => c.includes(check)));
        console.log('Checking specific names:', found);
    }
}

checkValues();
