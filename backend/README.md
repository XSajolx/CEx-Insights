# Laravel-Style PHP Backend

## Structure
```
backend/
├── public/
│   └── index.php          # Entry point
├── app/
│   ├── routes.php         # Route definitions
│   ├── controllers/
│   │   └── DashboardController.php
│   └── models/
│       └── Conversation.php
```

## API Endpoints

### GET /api/conversations
Returns filtered conversation data.

**Query Parameters:**
- `date_range`: last_week | last_month | last_3_months
- `region`: Region name or "All"
- `country`: Country name or "All"
- `product`: Product name or "All"

### GET /api/topics
Returns list of all available topics.

### GET /api/filters
Returns available filter options (regions, countries, products).

## Running the Server
```bash
php -S localhost:8000 -t backend/public
```

## Features
- RESTful API design
- CORS enabled for frontend integration
- Mock data generation
- Filtering by date, region, country, and product
