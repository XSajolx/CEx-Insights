# Intercom to Supabase Sync

Syncs conversation data from Intercom API to Supabase for the **Service Performance Overview** dashboard.

## Prerequisites

- Node.js 18+
- Intercom API Access Token (with `Read conversations` permission)
- Supabase Project with service role key

## Setup

### 1. Create Supabase Tables

Run the SQL schema in your Supabase SQL Editor:

```bash
# Copy the contents of supabase-schema.sql and run in Supabase SQL Editor
```

Or via Supabase CLI:
```bash
supabase db push < supabase-schema.sql
```

### 2. Configure Environment

Create a `.env` file in this directory:

```env
# Intercom API
INTERCOM_ACCESS_TOKEN=your_intercom_access_token_here

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key_here
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Test Connections

```bash
npm test
```

This will verify connectivity to both Intercom and Supabase.

### 5. Run Sync

**Incremental sync (last 7 days):**
```bash
npm run sync
```

**Full sync (last 90 days):**
```bash
npm run sync:full
```

## How It Works

1. **Fetches conversations** from Intercom API (paginated)
2. **Calculates metrics** for each conversation:
   - FRT (First Response Time)
   - ART (Average Response Time)
   - AHT (Average Handle Time)
   - Wait Time to Connect
   - Sentiment
   - CSAT Rating
3. **Stores in Supabase** `service_conversations` table
4. **Aggregates daily metrics** in `service_daily_metrics` table
5. **Calculates teammate performance** in `service_teammate_metrics` table

## Tables Created

| Table | Description |
|-------|-------------|
| `service_conversations` | Individual conversation metrics |
| `service_daily_metrics` | Daily aggregated KPIs |
| `service_teammate_metrics` | Per-agent performance |
| `service_hourly_volume` | Hourly distribution (for heatmap) |
| `service_country_metrics` | Per-country aggregates |

## RPC Functions

The schema also creates these PostgreSQL functions for efficient querying:

- `get_service_performance_summary` - Scorecard data
- `get_service_daily_trend` - Timeseries data
- `get_service_teammate_leaderboard` - Agent rankings
- `get_service_sentiment_distribution` - Sentiment breakdown
- `get_service_channel_distribution` - Channel breakdown
- `get_service_volume_heatmap` - Day/hour heatmap
- `get_service_country_distribution` - Country breakdown

## Scheduling

For automatic syncs, set up a cron job or use a service like:

- **GitHub Actions** (see example below)
- **Render.com** Cron Jobs
- **Railway** Scheduled Tasks
- **AWS Lambda** with CloudWatch Events

### GitHub Actions Example

Create `.github/workflows/sync-intercom.yml`:

```yaml
name: Sync Intercom Data

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd scripts/intercom-sync && npm install
      - run: cd scripts/intercom-sync && npm run sync
        env:
          INTERCOM_ACCESS_TOKEN: ${{ secrets.INTERCOM_ACCESS_TOKEN }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

## Troubleshooting

### Rate Limits
Intercom has rate limits. The script includes delays between requests. For large syncs, run during off-peak hours.

### Missing Data
If metrics are null, the conversation may not have enough data (e.g., no response from agent).

### Schema Changes
If you modify the schema, you may need to drop and recreate tables:
```sql
DROP TABLE IF EXISTS service_conversations CASCADE;
DROP TABLE IF EXISTS service_daily_metrics CASCADE;
DROP TABLE IF EXISTS service_teammate_metrics CASCADE;
DROP TABLE IF EXISTS service_hourly_volume CASCADE;
DROP TABLE IF EXISTS service_country_metrics CASCADE;
```

Then re-run `supabase-schema.sql`.

