/**
 * Create "Conversation Actions" table in Supabase via REST API
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const TABLE_NAME = 'Conversation Actions';

async function createTable() {
    // Try to check if table exists first
    const checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(TABLE_NAME)}?select=*&limit=0`, {
        headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
    });

    if (checkResponse.ok) {
        console.log(`Table "${TABLE_NAME}" already exists!`);

        // Check current count
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { count } = await supabase.from(TABLE_NAME).select('*', { count: 'exact', head: true });
        console.log(`Current rows: ${count}`);
        return;
    }

    console.log(`Table "${TABLE_NAME}" does not exist. Creating via SQL...`);

    // Try to create via Supabase SQL API
    const sql = `
        CREATE TABLE IF NOT EXISTS "Conversation Actions" (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            conversation_id text,
            action_id text,
            conversation_started_at timestamptz,
            action_time timestamptz,
            channel text,
            last_teammate_rating text,
            conversation_tags text,
            started_by text,
            state text,
            action_type text,
            action_performed_by text,
            action_performed_by_id text,
            teammate_assigned text,
            teammate_assigned_id text,
            teammate_subsequent_response_time_seconds integer,
            synced_at timestamptz DEFAULT now()
        );
        ALTER TABLE "Conversation Actions" DISABLE ROW LEVEL SECURITY;
        CREATE INDEX IF NOT EXISTS idx_conv_actions_conv_id ON "Conversation Actions" (conversation_id);
        CREATE INDEX IF NOT EXISTS idx_conv_actions_action_time ON "Conversation Actions" (action_time);
        CREATE INDEX IF NOT EXISTS idx_conv_actions_performed_by ON "Conversation Actions" (action_performed_by);
    `;

    console.log('\n--- PLEASE RUN THIS SQL IN SUPABASE SQL EDITOR ---\n');
    console.log(sql);
    console.log('\n--- END SQL ---\n');
    console.log('Go to: https://supabase.com/dashboard/project/iktqpjwoahqycvlmstvx/sql/new');
    console.log('Paste the SQL above and click "Run"');
}

createTable().catch(console.error);
