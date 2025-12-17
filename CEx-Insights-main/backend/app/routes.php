<?php

require_once __DIR__ . '/controllers/DashboardController.php';

function handleRequest($uri, $method)
{
    // Remove trailing slashes
    $uri = rtrim($uri, '/');

    // API Routes
    if ($uri === '/api/conversations' && $method === 'GET') {
        $controller = new DashboardController();
        $controller->getConversations();
    } elseif ($uri === '/api/topics' && $method === 'GET') {
        $controller = new DashboardController();
        $controller->getTopics();
    } elseif ($uri === '/api/filters' && $method === 'GET') {
        $controller = new DashboardController();
        $controller->getFilters();
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'Route not found']);
    }
}
