import { supabase } from './supabaseClient';

// Regions and country mappings for Conversation Topics
const COUNTRY_TO_REGION = {
    // Africa
    'Algeria': 'Africa', 'Botswana': 'Africa', 'Cameroon': 'Africa', 'Egypt': 'Africa',
    'Ethiopia': 'Africa', 'Gambia': 'Africa', 'Ghana': 'Africa', 'Kenya': 'Africa',
    'Madagascar': 'Africa', 'Mali': 'Africa', 'Mauritania': 'Africa', 'Morocco': 'Africa',
    'Nigeria': 'Africa', 'South Africa': 'Africa', 'Somalia': 'Africa', 'Togo': 'Africa',
    'Uganda': 'Africa', 'Zambia': 'Africa', 'Zimbabwe': 'Africa', 'Réunion': 'Africa',

    // Asia
    'Afghanistan': 'Asia', 'Azerbaijan': 'Asia', 'Bahrain': 'Asia', 'China': 'Asia',
    'Hong Kong': 'Asia', 'India': 'Asia', 'Indonesia': 'Asia', 'Iran, Islamic Republic of': 'Asia',
    'Iraq': 'Asia', 'Israel': 'Asia', 'Japan': 'Asia', 'Jordan': 'Asia',
    'Korea, Republic of': 'Asia', 'South Korea': 'Asia', 'Kyrgyzstan': 'Asia', 'Lebanon': 'Asia', 'Malaysia': 'Asia',
    'Mongolia': 'Asia', 'Nepal': 'Asia', 'Oman': 'Asia', 'Pakistan': 'Asia',
    'Philippines': 'Asia', 'Qatar': 'Asia', 'Russian Federation': 'Asia', 'Saudi Arabia': 'Asia',
    'Singapore': 'Asia', 'Taiwan': 'Asia', 'Thailand': 'Asia', 'Turkey': 'Asia',
    'United Arab Emirates': 'Asia', 'Uzbekistan': 'Asia', 'Viet Nam': 'Asia', 'Vietnam': 'Asia',

    // Europe
    'Austria': 'Europe', 'Belgium': 'Europe', 'Bulgaria': 'Europe', 'Cyprus': 'Europe',
    'Czech Republic': 'Europe', 'Estonia': 'Europe', 'Finland': 'Europe', 'France': 'Europe',
    'Germany': 'Europe', 'Hungary': 'Europe', 'Ireland': 'Europe', 'Italy': 'Europe',
    'Netherlands': 'Europe', 'Poland': 'Europe', 'Romania': 'Europe', 'Serbia': 'Europe',
    'Slovakia': 'Europe', 'Spain': 'Europe', 'Sweden': 'Europe', 'Switzerland': 'Europe',
    'Ukraine': 'Europe', 'United Kingdom': 'Europe',

    // North America
    'Canada': 'North America', 'Costa Rica': 'North America', 'Cuba': 'North America',
    'Dominican Republic': 'North America', 'El Salvador': 'North America', 'Haiti': 'North America',
    'Mexico': 'North America', 'Trinidad and Tobago': 'North America', 'United States': 'North America',
    'Bahamas': 'North America', 'Aruba': 'North America',

    // Oceania
    'Australia': 'Oceania', 'French Polynesia': 'Oceania',

    // South America
    'Argentina': 'South America', 'Bolivia, Plurinational State of': 'South America',
    'Chile': 'South America', 'Colombia': 'South America', 'Paraguay': 'South America',
    'Venezuela, Bolivarian Republic of': 'South America'
};

const REGIONS = ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];
// Helper to get date filter for DB query
const getDbDateFilter = (dateRange) => {
    if (!dateRange) return { start: null, end: null };

    const now = new Date();

    // Helper to format date as YYYY-MM-DD
    const fmt = (d) => d.toISOString().split('T')[0];

    if (dateRange.startsWith('custom_')) {
        const parts = dateRange.split('_');
        if (parts.length === 3) {
            return {
                start: parts[1], // Assuming YYYY-MM-DD
                end: parts[2]
            };
        }
        return { start: null, end: null };
    }

    let dateLimit;
    const d = new Date(now);

    switch (dateRange) {
        case 'today':
            // start of today 00:00
            dateLimit = new Date(d.setHours(0, 0, 0, 0));
            break;
        case 'yesterday':
            dateLimit = new Date(d.setDate(d.getDate() - 1));
            // yesterday 00:00
            dateLimit.setHours(0, 0, 0, 0);
            break;
        case 'last_week':
            dateLimit = new Date(d.setDate(d.getDate() - 7));
            break;
        case 'last_month':
            dateLimit = new Date(d.setMonth(d.getMonth() - 1));
            break;
        case 'last_3_months':
        default:
            dateLimit = new Date(d.setMonth(d.getMonth() - 3));
            break;
    }

    // Return YYYY-MM-DD which works well with most DB date/timestamp columns for 'gte'
    return { start: fmt(dateLimit), end: null };
};

// Fetch pre-aggregated topic distribution using server-side RPC (fast!)
export const fetchTopicDistribution = async () => {
    try {
        console.log('Fetching topic distribution via RPC...');
        const { data, error } = await supabase.rpc('get_topic_distribution', { p_limit: 50 });

        if (error) {
            console.error('Error fetching topic distribution:', error);
            return [];
        }

        console.log(`Got ${data?.length || 0} topic distribution entries`);
        return data || [];
    } catch (err) {
        console.error('Exception in topic distribution:', err);
        return [];
    }
};

// Cache for topic mapping
let topicMappingCache = null;

const fetchTopicMappingInternal = async () => {
    if (topicMappingCache) return topicMappingCache;
    try {
        console.log('Fetching topic mapping...');
        const { data, error } = await supabase
            .from('all_topics_with_main')
            .select('topic, main_topic')
            .limit(10000); // Increased limit to ensure all topics are mapped

        if (error) {
            console.error('Error fetching topic mapping:', error);
            // Return empty object on error so app doesn't crash
            return {};
        }

        topicMappingCache = {};
        data?.forEach(row => {
            if (row.topic && row.main_topic) {
                topicMappingCache[row.topic.trim()] = row.main_topic.trim();
            }
        });
        console.log(`Loaded ${Object.keys(topicMappingCache).length} topic mappings`);
        return topicMappingCache;
    } catch (err) {
        console.error('Exception in topic mapping:', err);
        return {};
    }
};

// Start: Optimized Supabase Data Fetching
async function getSupabaseData(filters = {}) {
    try {
        console.log('Fetching Supabase data with filters:', filters);

        // 1. Build Query for Conversations
        // Updated to fetch Main-Topics and Sub-Topics directly
        let query = supabase
            .from('Intercom Topic')
            .select('created_date_bd,"Conversation ID","Country","Region","Product",assigned_channel_name,"CX Score Rating","Main-Topics","Sub-Topics"');

        // Apply Server-Side Date Filtering using created_at_bd (ISO Timestamp) to prevent timeouts
        if (filters.dateRangeStart) {
            query = query.gte('created_at_bd', filters.dateRangeStart);
        }
        if (filters.dateRangeEnd) {
            query = query.lte('created_at_bd', filters.dateRangeEnd + 'T23:59:59');
        }

        // Apply Country Filter
        if (filters.country && filters.country !== 'All') {
            query = query.eq('"Country"', filters.country);
        }

        // Apply Product Filter
        if (filters.product && filters.product !== 'All') {
            query = query.eq('"Product"', filters.product);
        }

        // Apply Region Filter
        if (filters.region && filters.region !== 'All') {
            const countriesInRegion = Object.keys(COUNTRY_TO_REGION)
                .filter(country => COUNTRY_TO_REGION[country] === filters.region);

            if (countriesInRegion.length > 0) {
                query = query.in('"Country"', countriesInRegion);
            } else {
                console.log('No countries found for region:', filters.region);
            }
        }

        // OPTIMIZATION: Filter out rows without topics
        query = query
            .not('created_at_bd', 'is', null)
            //.neq('"Topic 1"', '')  // Legacy column check removed
            .order('created_at_bd', { ascending: false })
            .limit(100000);

        const { data: conversations, error: conversationsError } = await query;
        if (conversationsError) throw conversationsError;

        console.log(`Fetched ${conversations?.length || 0} conversations`);

        if (!conversations || conversations.length === 0) {
            return [];
        }

        // 6. Transform Data
        const transformedData = [];

        conversations.forEach(row => {
            const convId = row['Conversation ID'] ? String(row['Conversation ID']).trim() : '';
            const mappedRegion = COUNTRY_TO_REGION[row.Country] || 'Unknown';

            // Get arrays from JSONB columns
            // Handle cases where it might be null
            let mainTopics = row['Main-Topics'] || [];
            let subTopics = row['Sub-Topics'] || [];

            // Ensure they are arrays (if string/null came back)
            if (typeof mainTopics === 'string') {
                try { mainTopics = JSON.parse(mainTopics); } catch (e) { mainTopics = [mainTopics]; }
            }
            if (!Array.isArray(mainTopics)) mainTopics = [];

            if (typeof subTopics === 'string') {
                try { subTopics = JSON.parse(subTopics); } catch (e) { subTopics = [subTopics]; }
            }
            if (!Array.isArray(subTopics)) subTopics = [];

            // Filter out nulls/empty strings
            mainTopics = mainTopics.filter(t => t && t.trim());
            subTopics = subTopics.filter(t => t && t.trim());

            if (mainTopics.length === 0 && subTopics.length === 0) return; // Skip empty rows

            transformedData.push({
                created_date_bd: row.created_date_bd || '',
                conversation_id: convId,
                country: row.Country || 'Unknown',
                region: mappedRegion,
                product: row.Product || 'Unknown',
                assigned_channel_name: row.assigned_channel_name || 'Unknown',
                cx_score_rating: row['CX Score Rating'] ? parseInt(row['CX Score Rating']) : 0,
                topic: subTopics,      // Now an array
                main_topic: mainTopics // Now an array
            });
        });

        if (transformedData.length > 0) {
            console.log('API Transformed Data [0]:', JSON.stringify(transformedData[0]));
        }

        return transformedData;

    } catch (error) {
        console.error('Error fetching Supabase data:', error);
        return [];
    }
}


// Apply filters to the data (Client-side Refinement)
function applyFilters(data, filters) {
    let filteredData = [...data];

    // Apply date filter
    if (filters.dateRange) {
        if (filters.dateRange.startsWith('custom_')) {
            // Handle custom date range
            const parts = filters.dateRange.split('_');
            if (parts.length === 3) {
                const startLimit = new Date(parts[1]).getTime();
                const endLimit = new Date(parts[2] + ' 23:59:59').getTime();

                filteredData = filteredData.filter(item => {
                    const itemDate = new Date(item.created_date_bd).getTime();
                    return itemDate >= startLimit && itemDate <= endLimit;
                });
            }
        } else {
            // Handle preset date ranges
            let dateLimit;
            const now = new Date();

            switch (filters.dateRange) {
                case 'today':
                    dateLimit = new Date(now.setHours(0, 0, 0, 0));
                    break;
                case 'yesterday':
                    dateLimit = new Date(now.setDate(now.getDate() - 1));
                    dateLimit.setHours(0, 0, 0, 0);
                    break;
                case 'last_week':
                    dateLimit = new Date(now.setDate(now.getDate() - 7));
                    break;
                case 'last_month':
                    dateLimit = new Date(now.setMonth(now.getMonth() - 1));
                    break;
                default: // last_3_months
                    dateLimit = new Date(now.setMonth(now.getMonth() - 3));
            }

            filteredData = filteredData.filter(item => {
                return new Date(item.created_date_bd).getTime() >= dateLimit.getTime();
            });
        }
    }

    // Apply country filter
    if (filters.country && filters.country !== 'All') {
        filteredData = filteredData.filter(item => item.country === filters.country);
    }

    // Apply region filter
    if (filters.region && filters.region !== 'All') {
        filteredData = filteredData.filter(item => item.region === filters.region);
    }

    // Apply product filter
    if (filters.product && filters.product !== 'All') {
        filteredData = filteredData.filter(item => item.product === filters.product);
    }

    return filteredData;
}

export const fetchConversations = async (filters) => {
    // Optimization: Apply server-side filters if possible
    const range = getDbDateFilter(filters.dateRange);
    const dbFilters = {
        ...filters,
        dateRangeStart: range.start,
        dateRangeEnd: range.end
    };

    // Fetch with push-down predicates
    const data = await getSupabaseData(dbFilters);

    return applyFilters(data, filters);
};

export const fetchTopics = async () => {
    try {
        const { data: topics, error } = await supabase
            .from('all_topics')
            .select('topic')
            .limit(10000); // Increased limit

        if (error) throw error;

        const uniqueTopics = [...new Set(
            topics
                ?.map(row => row.topic)
                .filter(topic => topic && topic.trim())
        )];

        uniqueTopics.sort();
        return uniqueTopics;
    } catch (error) {
        console.error('Error fetching topics:', error);
        return [];
    }
};

// Fetch known main topics
export const fetchMainTopics = async () => {
    // Return hardcoded list since mapping table is missing and user wants to rely on triggered column
    return [
        'KYC_Issue', 'Account Related Issue', 'Dashboard Related Issue', 'Breach Issue',
        'Login_Issue', 'Password issue', 'Next Phase Button Missing', 'Platform Issue',
        'Trade Issue', 'Slippage', 'SWAP', 'Commission', 'Payout related issue',
        'Certificate Issue', 'Competition Issue', 'Restriction Related Issue',
        'Verdict from different team', 'Tech Issue', 'Other Payment Issues',
        'Crypto Payment Isssue', 'Card Payment issue', 'Refund Related Issue',
        'Coupon Code related issue', 'Discount related issue', 'Offer Related Query',
        'Random Issues'
    ];
};


export const fetchFilters = async () => {
    try {
        console.log('Fetching filter options from Intercom Topic...');

        // Get countries from Intercom Topic using RPC
        const { data: countryData, error: countryError } = await supabase
            .rpc('get_intercom_countries');

        if (countryError) {
            console.error('Error fetching countries (RPC):', countryError);
        }

        // Get products from Intercom Topic using RPC
        const { data: productData, error: productError } = await supabase
            .rpc('get_intercom_products');

        if (productError) {
            console.error('Error fetching products (RPC):', productError);
        }

        let countries = (countryData || []).filter(c => c && c.trim()).sort();
        const products = (productData || []).filter(p => p && p.trim()).sort();

        // Fallback for Countries if empty
        if (countries.length === 0) {
            console.log('Using static country list fallback');
            countries = Object.keys(COUNTRY_TO_REGION).sort();
        }

        // Fallback for Products if empty (e.g. RPC not created yet)
        if (products.length === 0) {
            products.push('CFD', 'Futures');
        }

        console.log(`Got ${REGIONS.length} regions, ${countries.length} countries, ${products.length} products`);

        return {
            regions: REGIONS,
            countries,
            products,
            countryToRegion: COUNTRY_TO_REGION
        };
    } catch (error) {
        console.error('Error fetching filters:', error);
        return {
            regions: REGIONS,
            countries: [],
            products: ['CFD', 'Futures'],
            countryToRegion: COUNTRY_TO_REGION
        };
    }
};


// =====================================================
// CSAT Dashboard API Functions
// =====================================================

// Helper to calculate date ranges
export const calculateDateRanges = (dateRange) => {
    const now = new Date();
    let curFrom, curTo, prevFrom, prevTo;

    switch (dateRange) {
        case 'last_7_days':
            curTo = new Date(now);
            curFrom = new Date(now.setDate(now.getDate() - 7));
            prevTo = new Date(curFrom);
            prevFrom = new Date(prevTo.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case 'last_30_days':
            curTo = new Date(now);
            curFrom = new Date(now.setDate(now.getDate() - 30));
            prevTo = new Date(curFrom);
            prevFrom = new Date(prevTo.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case 'last_90_days':
        default:
            curTo = new Date(now);
            curFrom = new Date(now.setDate(now.getDate() - 90));
            prevTo = new Date(curFrom);
            prevFrom = new Date(prevTo.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
    }

    return {
        curFrom: curFrom.toISOString().split('T')[0],
        curTo: curTo.toISOString().split('T')[0],
        prevFrom: prevFrom.toISOString().split('T')[0],
        prevTo: prevTo.toISOString().split('T')[0]
    };
};

// Fetch CSAT metrics (Overall, CEx, Product)
export const fetchCSATMetrics = async (filters) => {
    try {
        const { curFrom, curTo, prevFrom, prevTo } = calculateDateRanges(filters.dateRange || 'last_90_days');

        const { data, error } = await supabase.rpc('csat_metrics', {
            p_date_from: curFrom,
            p_date_to: curTo,
            p_prev_from: prevFrom,
            p_prev_to: prevTo,
            p_countries: filters.countries?.length > 0 ? filters.countries : null,
            p_products: filters.products?.length > 0 ? filters.products : null,
            p_channels: filters.channels?.length > 0 ? filters.channels : null,
            p_agents: filters.agents?.length > 0 ? filters.agents : null
        });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error fetching CSAT metrics:', error);
        throw error;
    }
};

// Fetch product dissatisfaction reasons (calculated on frontend)
export const fetchCSATProductReasons = async (filters) => {
    try {
        const { curFrom, curTo } = calculateDateRanges(filters.dateRange || 'last_90_days');

        console.log('fetchCSATProductReasons: Date ranges:', { curFrom, curTo });
        console.log('fetchCSATProductReasons: Filters:', filters);

        // Convert YYYY-MM-DD to MM/DD/YYYY for comparison
        const formatToMMDDYYYY = (dateStr) => {
            const [year, month, day] = dateStr.split('-');
            return `${parseInt(month)}/${parseInt(day)}/${year}`;
        };

        const fromDate = formatToMMDDYYYY(curFrom);
        const toDate = formatToMMDDYYYY(curTo);

        // Fetch data from CSAT table
        let query = supabase
            .from('CSAT')
            .select('Date, "Conversation rating", "Concern regarding product (Catagory)", "Concern regarding product (Sub-catagory)", Location, Product, Channel')
            .range(0, 9999)
            .not('Conversation rating', 'is', null)
            .in('Conversation rating', [1, 2]); // Only low ratings

        const { data, error } = await query;

        console.log('fetchCSATProductReasons: Raw data received:', data?.length, 'records');
        console.log('fetchCSATProductReasons: Response error:', error);

        if (error) throw error;

        // Filter and calculate on frontend
        const parseDate = (dateStr) => {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                return new Date(parts[2], parts[0] - 1, parts[1]);
            }
            return null;
        };

        const fromDateObj = parseDate(fromDate);
        const toDateObj = parseDate(toDate);

        // Filter data by date and other filters
        const filteredData = (data || []).filter(row => {
            const rowDate = parseDate(row.Date);
            if (!rowDate || rowDate < fromDateObj || rowDate > toDateObj) return false;

            // Apply other filters
            if (filters.countries?.length > 0 && !filters.countries.includes(row.Location)) return false;
            if (filters.products?.length > 0 && !filters.products.includes(row.Product)) return false;
            if (filters.channels?.length > 0 && !filters.channels.includes(row.Channel)) return false;

            return true;
        });

        console.log('fetchCSATProductReasons: Filtered data:', filteredData.length, 'records');

        // Count by reason (use Sub-category first, fall back to Category)
        const reasonCounts = {};
        filteredData.forEach(row => {
            const subCategory = row['Concern regarding product (Sub-catagory)'];
            const category = row['Concern regarding product (Catagory)'];

            // Use sub-category if available, otherwise use category
            const reason = (subCategory && subCategory.trim()) || (category && category.trim()) || null;

            if (reason) {
                reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
            }
        });

        // Convert to array and sort by count
        const result = Object.entries(reasonCounts).map(([reason, count]) => ({
            reason,
            current_count: count,
            previous_count: 0, // We're not calculating previous period for simplicity
            diff: count
        })).sort((a, b) => b.current_count - a.current_count);

        console.log('fetchCSATProductReasons: Calculated reasons:', result);

        return result;
    } catch (error) {
        console.error('Error fetching CSAT product reasons:', error);
        throw error;
    }
};

// Fetch support dissatisfaction reasons
export const fetchCSATSupportReasons = async (filters) => {
    try {
        const { curFrom, curTo, prevFrom, prevTo } = calculateDateRanges(filters.dateRange || 'last_90_days');

        const { data, error } = await supabase.rpc('csat_support_reasons', {
            p_date_from: curFrom,
            p_date_to: curTo,
            p_prev_from: prevFrom,
            p_prev_to: prevTo,
            p_countries: filters.countries?.length > 0 ? filters.countries : null,
            p_products: filters.products?.length > 0 ? filters.products : null,
            p_channels: filters.channels?.length > 0 ? filters.channels : null,
            p_agents: filters.agents?.length > 0 ? filters.agents : null
        });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching CSAT support reasons:', error);
        throw error;
    }
};



// Fetch CSAT average rating trend (calculated on frontend)
export const fetchCSATTrend = async (filters) => {
    try {
        const { curFrom, curTo } = calculateDateRanges(filters.dateRange || 'last_90_days');

        console.log('fetchCSATTrend: Date ranges:', { curFrom, curTo });
        console.log('fetchCSATTrend: Filters:', filters);

        // Convert YYYY-MM-DD to MM/DD/YYYY for comparison
        const formatToMMDDYYYY = (dateStr) => {
            const [year, month, day] = dateStr.split('-');
            return `${parseInt(month)}/${parseInt(day)}/${year}`;
        };

        const fromDate = formatToMMDDYYYY(curFrom);
        const toDate = formatToMMDDYYYY(curTo);

        console.log('fetchCSATTrend: Formatted dates:', { fromDate, toDate });

        // Build query - fetch all data and filter on frontend since Date is text
        let query = supabase
            .from('CSAT')
            .select('Date, "Conversation rating", Location, Product, Channel')
            .not('Conversation rating', 'is', null)
            .gte('Conversation rating', 1)
            .lte('Conversation rating', 5);

        const { data, error } = await query;

        console.log('fetchCSATTrend: Raw data received:', data?.length, 'records');
        console.log('fetchCSATTrend: Response error:', error);

        if (error) throw error;

        // Filter and calculate on frontend
        const parseDate = (dateStr) => {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                return new Date(parts[2], parts[0] - 1, parts[1]);
            }
            return null;
        };

        const fromDateObj = parseDate(fromDate);
        const toDateObj = parseDate(toDate);

        // Filter data
        const filteredData = (data || []).filter(row => {
            const rowDate = parseDate(row.Date);
            if (!rowDate || rowDate < fromDateObj || rowDate > toDateObj) return false;

            // Apply other filters
            if (filters.countries?.length > 0 && !filters.countries.includes(row.Location)) return false;
            if (filters.products?.length > 0 && !filters.products.includes(row.Product)) return false;
            if (filters.channels?.length > 0 && !filters.channels.includes(row.Channel)) return false;
            // Skip agent filter due to column name issues

            return true;
        });

        console.log('fetchCSATTrend: Filtered data:', filteredData.length, 'records');

        // Calculate average rating per date
        const dateMap = {};
        filteredData.forEach(row => {
            const dateStr = row.Date;
            const rating = row['Conversation rating'];

            if (!dateMap[dateStr]) {
                dateMap[dateStr] = { sum: 0, count: 0 };
            }
            dateMap[dateStr].sum += rating;
            dateMap[dateStr].count += 1;
        });

        // Convert to array and calculate averages
        const result = Object.entries(dateMap).map(([dateStr, stats]) => {
            // Parse MM/DD/YYYY to YYYY-MM-DD
            const parts = dateStr.split('/');
            const formattedDate = parts.length === 3
                ? `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
                : dateStr;

            return {
                date: formattedDate,
                avg_rating: Math.round((stats.sum / stats.count) * 100) / 100  // Round to 2 decimals
            };
        }).sort((a, b) => a.date.localeCompare(b.date));

        console.log('fetchCSATTrend: Calculated trend data:', result);

        return result;
    } catch (error) {
        console.error('Error fetching CSAT trend:', error);
        throw error;
    }
};

// Fetch low CSAT by country (calculated on frontend to avoid RPC limit)
export const fetchCSATCountryLow = async (filters) => {
    try {
        const { curFrom, curTo } = calculateDateRanges(filters.dateRange || 'last_90_days');

        const formatToMMDDYYYY = (dateStr) => {
            const [year, month, day] = dateStr.split('-');
            return `${parseInt(month)}/${parseInt(day)}/${year}`;
        };

        const fromDate = formatToMMDDYYYY(curFrom);
        const toDate = formatToMMDDYYYY(curTo);

        // Direct query to bypass RPC limit
        let query = supabase
            .from('CSAT')
            .select('Date, "Conversation rating", Location, Product, Channel')
            .range(0, 9999)
            .not('Conversation rating', 'is', null)
            .in('Conversation rating', [1, 2]);

        const { data, error } = await query;
        if (error) throw error;

        const parseDate = (dateStr) => {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                return new Date(parts[2], parts[0] - 1, parts[1]);
            }
            return null;
        };

        const fromDateObj = parseDate(fromDate);
        const toDateObj = parseDate(toDate);

        // Filter data
        const filteredData = (data || []).filter(row => {
            const rowDate = parseDate(row.Date);
            if (!rowDate || rowDate < fromDateObj || rowDate > toDateObj) return false;

            if (filters.countries?.length > 0 && !filters.countries.includes(row.Location)) return false;
            if (filters.products?.length > 0 && !filters.products.includes(row.Product)) return false;
            if (filters.channels?.length > 0 && !filters.channels.includes(row.Channel)) return false;

            return true;
        });

        // Group by Country
        const countryCounts = {};
        filteredData.forEach(row => {
            const country = row.Location || 'Unknown';
            countryCounts[country] = (countryCounts[country] || 0) + 1;
        });

        return Object.entries(countryCounts).map(([country, count]) => ({
            country,
            count
        })).sort((a, b) => b.count - a.count);

    } catch (error) {
        console.error('Error fetching CSAT country low:', error);
        throw error;
    }
};

// Fetch CSAT filter options
export const fetchCSATFilters = async () => {
    try {
        // Get unique countries
        const { data: countries, error: countriesError } = await supabase
            .from('csat_norm')
            .select('location');

        if (countriesError) throw countriesError;

        const uniqueCountries = [...new Set(
            countries?.map(row => row.location).filter(c => c)
        )].sort();

        // Get unique products
        const { data: products, error: productsError } = await supabase
            .from('csat_norm')
            .select('product');

        if (productsError) throw productsError;

        const uniqueProducts = [...new Set(
            products?.map(row => row.product).filter(p => p)
        )].sort();

        // Get unique channels
        const { data: channels, error: channelsError } = await supabase
            .from('csat_norm')
            .select('channel');

        if (channelsError) throw channelsError;

        const uniqueChannels = [...new Set(
            channels?.map(row => row.channel).filter(c => c)
        )].sort();

        // Get unique agents
        const { data: agents, error: agentsError } = await supabase
            .from('csat_norm')
            .select('agent_name');

        if (agentsError) throw agentsError;

        const uniqueAgents = [...new Set(
            agents?.map(row => row.agent_name).filter(a => a)
        )].sort();

        return {
            countries: uniqueCountries,
            products: uniqueProducts,
            channels: uniqueChannels,
            agents: uniqueAgents
        };
    } catch (error) {
        console.error('Error fetching CSAT filters:', error);
        throw error;
    }
};

// Fetch unique categories for the Drilled-in Report
export const fetchCSATCategories = async () => {
    try {
        const { data, error } = await supabase
            .from('CSAT')
            .select('"Concern regarding product (Catagory)"')
            .not('"Concern regarding product (Catagory)"', 'is', null);

        if (error) throw error;

        // Get unique values and sort
        const categories = [...new Set(
            data?.map(row => row['Concern regarding product (Catagory)'])
                .filter(c => c && c.trim() !== '' && c !== 'NULL')
        )].sort();

        return categories;
    } catch (error) {
        console.error('Error fetching CSAT categories:', error);
        return [];
    }
};

// Fetch drill-down data (originally for KYC, now generic)
export const fetchCSATKYC = async (filters, category = 'KYC_Issue') => {
    try {
        const { curFrom, curTo } = calculateDateRanges(filters.dateRange || 'last_90_days');

        // Convert YYYY-MM-DD to MM/DD/YYYY
        const formatToMMDDYYYY = (dateStr) => {
            const [year, month, day] = dateStr.split('-');
            return `${parseInt(month)}/${parseInt(day)}/${year}`;
        };

        const fromDate = formatToMMDDYYYY(curFrom);
        const toDate = formatToMMDDYYYY(curTo);

        // Fetch data
        let query = supabase
            .from('CSAT')
            .select('Date, "Concern regarding product (Catagory)", "Concern regarding product (Sub-catagory)", Location, Product, Channel')
            // Filter by the selected Category
            .eq('"Concern regarding product (Catagory)"', category);

        const { data, error } = await query;

        if (error) throw error;

        // Filter on frontend for dates
        const parseDate = (dateStr) => {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                return new Date(parts[2], parts[0] - 1, parts[1]);
            }
            return null;
        };

        const fromDateObj = parseDate(fromDate);
        const toDateObj = parseDate(toDate);

        const filteredData = (data || []).filter(row => {
            const rowDate = parseDate(row.Date);
            if (!rowDate || rowDate < fromDateObj || rowDate > toDateObj) return false;

            if (filters.countries?.length > 0 && !filters.countries.includes(row.Location)) return false;
            if (filters.products?.length > 0 && !filters.products.includes(row.Product)) return false;
            if (filters.channels?.length > 0 && !filters.channels.includes(row.Channel)) return false;

            return true;
        });

        // Count by Sub-category
        const reasonCounts = {};
        filteredData.forEach(row => {
            const subCategory = row['Concern regarding product (Sub-catagory)'];
            if (subCategory && subCategory.trim() !== '' && subCategory !== 'NULL') {
                reasonCounts[subCategory] = (reasonCounts[subCategory] || 0) + 1;
            } else {
                reasonCounts['Other'] = (reasonCounts['Other'] || 0) + 1;
            }
        });

        // Convert to array
        const result = Object.entries(reasonCounts).map(([reason, count]) => ({
            reason,
            count
        })).sort((a, b) => b.count - a.count);

        return result;
    } catch (error) {
        console.error('Error fetching CSAT drill-down:', error);
        return [];
    }
};
