<?php

require_once __DIR__ . '/../app/services/SupabaseClient.php';

$client = new SupabaseClient();

echo "--- TEST 1: Fetching 1 row from Intercom Topic (Raw) ---\n";
// Fetch without selecting specific columns to see everything
$data = $client->query('Intercom%20Topic', '*', ['limit' => 1]);

if (empty($data)) {
    echo "No data found in Test 1.\n";
} else {
    echo "Data found (Keys):\n";
    print_r(array_keys($data[0]));
    echo "Sample Row:\n";
    print_r($data[0]);
}

echo "\n--- TEST 2: Fetching data for 2025-12-02 (Yesterday) ---\n";
// Try to filter by created_date_bd
$filters = [
    'created_date_bd' => '2025-12-02',
    'limit' => 5
];
$dataYesterday = $client->query('Intercom%20Topic', '*', $filters);

if (empty($dataYesterday)) {
    echo "No data found for 2025-12-02.\n";
} else {
    echo "Found " . count($dataYesterday) . " rows for 2025-12-02.\n";
    print_r($dataYesterday[0]);
}

echo "\n--- TEST 3: Fetching all_topics ---\n";
$topics = $client->query('all_topics', '*', ['limit' => 1]);
if (empty($topics)) {
    echo "No topics found.\n";
} else {
    echo "Topic found:\n";
    print_r($topics[0]);
}
