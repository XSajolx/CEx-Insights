/**
 * Re-import the downloaded CSV into Supabase with correct column mapping
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: require('path').join(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLE = 'Conversation Actions';
const CSV_FILE = path.join(__dirname, 'conversation-actions-2026-02-16.csv');

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

function toSeconds(val) {
    if (!val || val.trim() === '') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : Math.round(num);
}

function get(row, key) {
    const v = row[key];
    return (v !== undefined && v !== '') ? v : null;
}

(async () => {
    console.log('1. Clearing existing data...');
    const { error: delErr } = await supabase.from(TABLE).delete().neq('id', 0);
    if (delErr) console.log('   Delete error:', delErr.message);
    else console.log('   Cleared!');

    console.log('\n2. Parsing CSV...');
    const csv = fs.readFileSync(CSV_FILE, 'utf-8');
    const lines = csv.split('\n');
    const headers = parseCSVLine(lines[0]);
    console.log('   Headers:', headers.join(', '));

    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        const row = {};
        headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });

        records.push({
            conversation_id: get(row, 'conversation_id'),
            action_id: get(row, 'action_id'),
            conversation_started_at: get(row, 'conversation_started_at'),
            action_time: get(row, 'action_time'),
            channel: get(row, 'channel'),
            last_teammate_rating: get(row, 'last_teammate_rating'),
            conversation_tags: get(row, 'conversation_tag_ids'),
            started_by: get(row, 'conversation_started_by'),
            action_type: get(row, 'action_type'),
            action_performed_by: get(row, 'action_performed_by_teammate_id'),
            teammate_assigned: get(row, 'action_teammate_assignee_id'),
            teammate_assigned_id: get(row, 'teammate_assignee_at_action_time'),
            teammate_subsequent_response_time_seconds: toSeconds(row['teammate_subsequent_response_time']),
            synced_at: new Date().toISOString()
        });
    }
    console.log('   Parsed', records.length, 'records');

    // Show samples
    const withART = records.find(r => r.teammate_subsequent_response_time_seconds !== null);
    if (withART) {
        console.log('\n   Sample row with ART data:');
        Object.entries(withART).forEach(([k, v]) => {
            if (v !== null) console.log(`     ${k}: ${v}`);
        });
    }

    const withAssigned = records.find(r => r.teammate_assigned !== null);
    if (withAssigned) {
        console.log('\n   Sample row with teammate_assigned:');
        Object.entries(withAssigned).forEach(([k, v]) => {
            if (v !== null) console.log(`     ${k}: ${v}`);
        });
    }

    // Count non-null values
    let artCount = 0, assignedCount = 0, performedByCount = 0;
    records.forEach(r => {
        if (r.teammate_subsequent_response_time_seconds !== null) artCount++;
        if (r.teammate_assigned !== null) assignedCount++;
        if (r.action_performed_by !== null) performedByCount++;
    });
    console.log(`\n   Non-null counts:`);
    console.log(`     action_performed_by: ${performedByCount}`);
    console.log(`     teammate_assigned: ${assignedCount}`);
    console.log(`     teammate_subsequent_response_time_seconds: ${artCount}`);

    console.log(`\n3. Inserting ${records.length} records...`);
    let inserted = 0, errors = 0;
    const BATCH = 500;

    for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const { error } = await supabase.from(TABLE).insert(batch);
        if (error) {
            console.error(`\n   Batch ${Math.floor(i/BATCH)+1} error: ${error.message}`);
            errors += batch.length;
        } else {
            inserted += batch.length;
        }
        process.stdout.write(`\r   Progress: ${inserted}/${records.length} (${errors} errors)`);
    }

    const { count } = await supabase.from(TABLE).select('*', { count: 'exact', head: true });

    console.log('\n\n' + '='.repeat(50));
    console.log('  IMPORT COMPLETE');
    console.log('='.repeat(50));
    console.log(`  Records parsed:  ${records.length}`);
    console.log(`  Inserted:        ${inserted}`);
    console.log(`  Errors:          ${errors}`);
    console.log(`  Total in table:  ${count}`);
    console.log('='.repeat(50));
})();
