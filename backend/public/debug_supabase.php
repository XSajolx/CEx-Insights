<?php

require_once __DIR__ . '/../app/services/SupabaseClient.php';

$client = new SupabaseClient();

echo "Fetching 1 row from Intercom Topic...\n";
$data = $client->query('Intercom%20Topic', '*', ['limit' => 1]);

if (empty($data)) {
    echo "No data found or error occurred.\n";
} else {
    echo "Data found:\n";
    print_r($data[0]);
    echo "\nColumn names:\n";
    print_r(array_keys($data[0]));
}

echo "\nFetching 1 row from all_topics...\n";
$topics = $client->query('all_topics', '*', ['limit' => 1]);

if (empty($topics)) {
    echo "No topics found or error occurred.\n";
} else {
    echo "Topic Data found:\n";
    print_r($topics[0]);
}
