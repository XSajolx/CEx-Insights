# Conversation Actions Import – Plan & Steps

## Goal

Sync **Conversation actions dataset** from Intercom (date range, **agent-only**) into the Supabase **Conversation Actions** table. The flow is **fully automatic** from the Topic Analyzer Admin tab.

---

## 1. Automatic sync (no manual steps)

- **API:** `POST /api/analyze-topics` with `action: 'sync-conversation-actions'` and optional `dateFrom`, `dateTo` (default Feb 1–17).
- The API uses:
  - **GET** `https://api.intercom.io/export/reporting_data/get_datasets` – find Conversation actions dataset
  - **POST** `https://api.intercom.io/export/reporting_data/enqueue` – enqueue export for the date range
  - **GET** `https://api.intercom.io/export/reporting_data/{job_identifier}` – poll until job completed
  - **GET** `https://api.intercom.io/download/reporting_data/{job_identifier}` – download CSV (binary; gzip decompressed if needed)
- The API then parses the CSV, **filters out** rows where **Action performed by** is "FundedNext AI" (agent-only), and inserts into Supabase `conversation_actions`.
- **UI:** Topic Analyzer Admin → **Sync Conversation Actions (automatic)** → set From/To dates → **Sync to Supabase**. One click; no file export or upload.

---

## 2. Supabase: Conversation Actions table

- **Table name:** `conversation_actions`
- **Purpose:** Store one row per conversation action from the Intercom export (agent-only).
- **Schema:** See [docs/sql/conversation-actions-schema.sql](sql/conversation-actions-schema.sql).  
  Columns align with the Intercom CSV (e.g. Conversation ID, Conversation started at, Channel, Last teammate rating, Action performed by, Action time, Team assigned, Teammate assigned, etc.).
- **RLS:** If you enable RLS, allow `INSERT` (and `SELECT` if needed) for the role your app uses. For the API sync, use `SUPABASE_SERVICE_ROLE_KEY` in the API environment so inserts are allowed.

---

## 3. Topic Analyzer Admin – Sync flow

In the **Topic Analyzer Admin** tab:

1. **Sync Conversation Actions (automatic)** section:
   - **From** / **To** date inputs (default Feb 1–17).
   - **Sync to Supabase** button: calls the API; the API enqueues the export, polls, downloads, filters to agent-only, and inserts into `conversation_actions`. No file picker or manual steps.

2. **Idempotency / duplicates:**  
   Optional: add a unique constraint on `(conversation_id, action_time)` and use `upsert` so re-syncing the same range doesn’t create duplicates. First version is insert-only.

---

## 4. Summary

| Step | Who/Where | Action |
|------|-----------|--------|
| 1 | Supabase | Create `conversation_actions` table (run schema SQL once). |
| 2 | App, Topic Analyzer Admin | Set date range → click **Sync to Supabase** → API fetches from Intercom, filters agent-only, inserts into `conversation_actions`. |

The flow is **automatic**: one click in the Admin tab runs export → download → filter → insert.
