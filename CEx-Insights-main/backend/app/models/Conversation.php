<?php

require_once __DIR__ . '/../services/SupabaseClient.php';

class Conversation
{
    private static function getSupabaseData()
    {
        $supabase = new SupabaseClient();

        // First, get all topics from all_topics table
        $allTopics = $supabase->query('all_topics', 'Conversation%20ID,topic');
        $topicMap = [];
        foreach ($allTopics as $row) {
            if (isset($row['Conversation ID'])) {
                $topicMap[$row['Conversation ID']] = $row['topic'];
            }
        }

        // Get Main Topics from all_topics_with_main table
        $allMainTopics = $supabase->query('all_topics_with_main', 'Conversation%20ID,main_topic');
        $mainTopicMap = [];
        foreach ($allMainTopics as $row) {
            if (isset($row['Conversation ID']) && isset($row['main_topic'])) {
                $mainTopicMap[$row['Conversation ID']] = $row['main_topic'];
            }
        }

        // Then get all conversations from Intercom Topic
        $columns = [
            'created_date_bd',
            'Conversation ID',
            'Country',
            'Region',
            'Product',
            'assigned_channel_name',
            'CX Score Rating',
            'Topic 1'
        ];

        $conversations = $supabase->query(
            'Intercom%20Topic',
            implode(',', $columns)
        );

        // Map the data
        $transformedData = [];
        foreach ($conversations as $row) {
            $convId = $row['Conversation ID'] ?? '';

            // Use topic from all_topics if available, otherwise fallback to Topic 1
            $topicName = isset($topicMap[$convId]) ? $topicMap[$convId] : ($row['Topic 1'] ?? '');

            // Get Main Topic
            $mainTopic = isset($mainTopicMap[$convId]) ? $mainTopicMap[$convId] : 'Other';

            // Trim whitespace and skip if topic is empty
            $topicName = trim($topicName);
            if (empty($topicName)) {
                continue; // Skip this conversation if topic is blank
            }

            $transformedData[] = [
                'created_date_bd' => $row['created_date_bd'] ?? '',
                'conversation_id' => $convId,
                'country' => $row['Country'] ?? 'Unknown',
                'region' => $row['Region'] ?? 'Unknown',
                'product' => $row['Product'] ?? 'Unknown',
                'assigned_channel_name' => $row['assigned_channel_name'] ?? 'Unknown',
                'cx_score_rating' => isset($row['CX Score Rating']) ? (int) $row['CX Score Rating'] : 0,
                'topic' => $topicName,
                'main_topic' => $mainTopic
            ];
        }

        return $transformedData;
    }

    public static function getFiltered($filters)
    {
        $data = self::getSupabaseData();

        // Apply date filter
        if (isset($filters['date_range'])) {
            if (str_starts_with($filters['date_range'], 'custom_')) {
                // Handle custom date range
                $parts = explode('_', $filters['date_range']);
                if (count($parts) === 3) {
                    $startLimit = strtotime($parts[1]);
                    $endLimit = strtotime($parts[2] . ' 23:59:59');

                    $data = array_filter($data, function ($item) use ($startLimit, $endLimit) {
                        $itemDate = strtotime($item['created_date_bd']);
                        return $itemDate >= $startLimit && $itemDate <= $endLimit;
                    });
                }
            } else {
                // Handle preset date ranges
                $dateLimit = match ($filters['date_range']) {
                    'today' => strtotime('today'),
                    'yesterday' => strtotime('yesterday'),
                    'last_week' => strtotime('-7 days'),
                    'last_month' => strtotime('-1 month'),
                    default => strtotime('-3 months')
                };

                $data = array_filter($data, function ($item) use ($dateLimit) {
                    return strtotime($item['created_date_bd']) >= $dateLimit;
                });
            }
        }

        // Apply region filter
        if (isset($filters['region']) && $filters['region'] !== 'All') {
            $data = array_filter($data, function ($item) use ($filters) {
                return $item['region'] === $filters['region'];
            });
        }

        // Apply country filter
        if (isset($filters['country']) && $filters['country'] !== 'All') {
            $data = array_filter($data, function ($item) use ($filters) {
                return $item['country'] === $filters['country'];
            });
        }

        // Apply product filter
        if (isset($filters['product']) && $filters['product'] !== 'All') {
            $data = array_filter($data, function ($item) use ($filters) {
                return $item['product'] === $filters['product'];
            });
        }

        return array_values($data);
    }

    public static function getAllTopics()
    {
        $supabase = new SupabaseClient();
        $topics = $supabase->query('all_topics', 'topic');

        $uniqueTopics = [];
        foreach ($topics as $row) {
            if (!empty($row['topic'])) {
                $uniqueTopics[] = $row['topic'];
            }
        }

        $uniqueTopics = array_unique($uniqueTopics);
        sort($uniqueTopics);

        return array_values($uniqueTopics);
    }

    public static function getAvailableFilters()
    {
        $supabase = new SupabaseClient();

        // Always return the 6 major continents as region options
        $uniqueRegions = ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America'];

        // Get unique countries
        $countries = $supabase->query('Intercom%20Topic', 'Country');
        $uniqueCountries = array_unique(array_filter(array_column($countries, 'Country')));
        sort($uniqueCountries);

        // Get unique products
        $products = $supabase->query('Intercom%20Topic', 'Product');
        $uniqueProducts = array_unique(array_filter(array_column($products, 'Product')));
        sort($uniqueProducts);

        return [
            'regions' => array_values($uniqueRegions),
            'countries' => array_values($uniqueCountries),
            'products' => array_values($uniqueProducts)
        ];
    }
}
