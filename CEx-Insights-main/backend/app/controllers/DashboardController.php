<?php

require_once __DIR__ . '/../models/Conversation.php';

class DashboardController
{

    public function getConversations()
    {
        $filters = [
            'date_range' => $_GET['date_range'] ?? 'last_3_months',
            'region' => $_GET['region'] ?? 'All',
            'country' => $_GET['country'] ?? 'All',
            'product' => $_GET['product'] ?? 'All'
        ];

        $conversations = Conversation::getFiltered($filters);

        echo json_encode([
            'success' => true,
            'data' => $conversations,
            'count' => count($conversations)
        ]);
    }

    public function getTopics()
    {
        $topics = Conversation::getAllTopics();

        echo json_encode([
            'success' => true,
            'data' => $topics
        ]);
    }

    public function getFilters()
    {
        $filters = Conversation::getAvailableFilters();

        echo json_encode([
            'success' => true,
            'data' => $filters
        ]);
    }
}
