/**
 * Download "Conversation Actions Dataset" via Intercom Reporting Data Export API
 * and import into Supabase "Conversation Actions" table
 * 
 * Uses the proper Intercom API:
 *   GET  /export/reporting_data/get_datasets     - List available datasets
 *   POST /export/reporting_data/enqueue          - Start export job
 *   GET  /export/reporting_data/{job_id}         - Check job status
 *   GET  /download/reporting_data/{job_id}       - Download exported data
 * 
 * Usage:
 *   node download-actions-dataset.js --date=2026-02-16
 *   node download-actions-dataset.js --days=7
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load .env
if (fs.existsSync(path.join(__dirname, '.env'))) {
    dotenv.config({ path: path.join(__dirname, '.env') });
} else if (fs.existsSync(path.join(__dirname, '../../.env'))) {
    dotenv.config({ path: path.join(__dirname, '../../.env') });
} else {
    dotenv.config();
}

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://iktqpjwoahqycvlmstvx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!INTERCOM_TOKEN) {
    console.error('❌ INTERCOM_ACCESS_TOKEN is required!');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const intercom = axios.create({
    baseURL: 'https://api.intercom.io',
    headers: {
        'Authorization': `Bearer ${INTERCOM_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Intercom-Version': 'Unstable'
    }
});

const TABLE_NAME = 'Conversation Actions';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
    const args = process.argv.slice(2);
    let targetDate = null;
    let days = null;
    let listDatasets = args.includes('--list-datasets');

    for (const arg of args) {
        if (arg.startsWith('--date=')) targetDate = arg.split('=')[1];
        else if (arg.startsWith('--days=')) days = parseInt(arg.split('=')[1]);
    }

    if (!targetDate && !days && !listDatasets) {
        targetDate = new Date().toISOString().split('T')[0];
    }

    let startTimestamp, endTimestamp;
    if (targetDate) {
        // Single date in Dhaka time (GMT+6)
        startTimestamp = Math.floor(new Date(targetDate + 'T00:00:00+06:00').getTime() / 1000);
        endTimestamp = Math.floor(new Date(targetDate + 'T23:59:59+06:00').getTime() / 1000);
    } else if (days) {
        endTimestamp = Math.floor(Date.now() / 1000);
        startTimestamp = endTimestamp - (days * 86400);
    }

    return { startTimestamp, endTimestamp, label: targetDate || `last ${days} days`, listDatasets };
}

// ============ INTERCOM REPORTING DATA EXPORT API ============

async function listDatasets() {
    console.log('Fetching available datasets...\n');
    const response = await intercom.get('/export/reporting_data/get_datasets');
    const datasets = response.data.datasets || response.data;
    
    if (Array.isArray(datasets)) {
        datasets.forEach(ds => {
            console.log(`  Dataset: ${ds.name || ds.dataset_id}`);
            console.log(`    ID: ${ds.dataset_id || ds.id}`);
            if (ds.attributes) {
                console.log(`    Attributes (${ds.attributes.length}):`);
                ds.attributes.forEach(attr => {
                    console.log(`      - ${attr.name || attr.attribute_id} (${attr.type || 'text'})`);
                });
            }
            console.log('');
        });
    } else {
        console.log(JSON.stringify(datasets, null, 2));
    }
    return datasets;
}

async function enqueueExport(datasetId, startTimestamp, endTimestamp, attributeIds) {
    const body = {
        dataset_id: datasetId,
        start_time: startTimestamp,
        end_time: endTimestamp
    };

    if (attributeIds && attributeIds.length > 0) {
        body.attribute_ids = attributeIds;
    }

    console.log(`   Enqueuing export job...`);
    console.log(`   Dataset: ${datasetId}`);
    console.log(`   Range: ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);

    const response = await intercom.post('/export/reporting_data/enqueue', body);
    const job = response.data;

    console.log(`   Job ID: ${job.job_identifier}`);
    console.log(`   Status: ${job.status}`);

    return job;
}

async function checkJobStatus(jobId) {
    const response = await intercom.get(`/export/reporting_data/${jobId}`);
    return response.data;
}

async function downloadExport(jobId) {
    try {
        const response = await axios.get(`https://api.intercom.io/download/reporting_data/${jobId}`, {
            headers: {
                'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                'Accept': 'application/octet-stream',
                'Intercom-Version': 'Unstable'
            },
            responseType: 'arraybuffer',
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        return response.data;
    } catch (err) {
        // If 400, try to read the error body
        if (err.response) {
            const body = err.response.data;
            let errorText = typeof body === 'string' ? body : Buffer.from(body).toString('utf-8');
            console.error(`   Download HTTP ${err.response.status}: ${errorText.substring(0, 500)}`);
        }
        throw err;
    }
}

async function waitForJob(jobId, maxWaitSeconds = 600) {
    const startTime = Date.now();
    let pollInterval = 3000; // Start with 3 seconds

    while (true) {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > maxWaitSeconds) {
            throw new Error(`Export job timed out after ${maxWaitSeconds}s`);
        }

        const job = await checkJobStatus(jobId);
        process.stdout.write(`\r   Status: ${job.status} (${Math.round(elapsed)}s elapsed)`);

        if (job.status === 'completed' || job.status === 'complete' || job.status === 'done') {
            console.log(`\n   Export completed!`);
            if (job.download_url) console.log(`   Download URL: ${job.download_url}`);
            console.log(`   Full response: ${JSON.stringify(job, null, 2)}`);
            return job;
        }

        if (job.status === 'failed' || job.status === 'error') {
            throw new Error(`Export job failed: ${JSON.stringify(job)}`);
        }

        await sleep(pollInterval);
        pollInterval = Math.min(pollInterval + 1000, 10000);
    }
}

// ============ DATA PARSING ============

function parseCSV(content) {
    const text = typeof content === 'string' ? content : Buffer.from(content).toString('utf-8');
    const lines = text.split('\n');
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    console.log(`   CSV Headers (${headers.length}): ${headers.join(', ')}`);

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        const row = {};
        headers.forEach((h, idx) => { row[h.trim()] = values[idx]?.trim() || ''; });
        rows.push(row);
    }
    return rows;
}

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
    if (!val || val.trim() === '' || val === '-' || val === '—') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : Math.round(num);
}

function getCol(row, key) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
    return null;
}

function mapRowToRecord(row) {
    return {
        conversation_id: getCol(row, 'conversation_id'),
        action_id: getCol(row, 'action_id'),
        conversation_started_at: getCol(row, 'conversation_started_at'),
        action_time: getCol(row, 'action_time'),
        channel: getCol(row, 'channel'),
        last_teammate_rating: getCol(row, 'last_teammate_rating'),
        conversation_tags: getCol(row, 'conversation_tag_ids'),
        started_by: getCol(row, 'conversation_started_by'),
        state: null,
        action_type: getCol(row, 'action_type'),
        action_performed_by: getCol(row, 'action_performed_by_teammate_id'),
        action_performed_by_id: null,
        teammate_assigned: getCol(row, 'action_teammate_assignee_id'),
        teammate_assigned_id: getCol(row, 'teammate_assignee_at_action_time'),
        teammate_subsequent_response_time_seconds: toSeconds(
            row['teammate_subsequent_response_time']
        ),
        synced_at: new Date().toISOString()
    };
}

// ============ SUPABASE ============

async function insertRecords(records) {
    const BATCH_SIZE = 200;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from(TABLE_NAME).insert(batch);

        if (error) {
            console.error(`\n   Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${error.message}`);
            errors += batch.length;
        } else {
            inserted += batch.length;
        }
        process.stdout.write(`\r   Inserted: ${inserted}/${records.length} (${errors} errors)`);
    }
    return { inserted, errors };
}

// ============ MAIN ============

async function main() {
    const { startTimestamp, endTimestamp, label, listDatasets: shouldList } = parseArgs();

    console.log('='.repeat(60));
    console.log('  INTERCOM REPORTING DATA EXPORT');
    console.log('  Conversation Actions Dataset -> Supabase');
    console.log('='.repeat(60));

    // Step 1: List datasets to find the right one
    console.log('\n1. Discovering available datasets...');
    let datasets;
    try {
        const response = await intercom.get('/export/reporting_data/get_datasets');
        datasets = response.data.data || response.data.datasets || response.data;
        
        if (Array.isArray(datasets)) {
            console.log(`   Found ${datasets.length} datasets:`);
            datasets.forEach(ds => {
                const id = ds.dataset_id || ds.id;
                const name = ds.name || id;
                const attrCount = ds.attributes?.length || 0;
                console.log(`     - ${name} (id: ${id}, ${attrCount} attributes)`);
            });
        } else {
            console.log('   Unexpected response format, trying to parse...');
            // If response.data has 'type' and 'data' fields (Intercom list format)
            if (response.data.type === 'list' && response.data.data) {
                datasets = response.data.data;
                console.log(`   Found ${datasets.length} datasets:`);
                datasets.forEach(ds => {
                    console.log(`     - ${ds.name} (id: ${ds.id}, ${ds.attributes?.length || 0} attrs)`);
                });
            }
        }
    } catch (error) {
        console.error(`   Error listing datasets: ${error.response?.status} ${error.response?.data?.message || error.message}`);
        if (error.response?.data) {
            console.error('   Details:', JSON.stringify(error.response.data, null, 2));
        }
        return;
    }

    if (shouldList) return;

    // Step 2: Find the conversation actions dataset
    let datasetId = null;
    let attributeIds = [];

    if (Array.isArray(datasets)) {
        // The "Conversation actions" dataset has id = "consolidated_conversation_part"
        const actionsDs = datasets.find(ds => {
            const id = (ds.dataset_id || ds.id || '').toLowerCase();
            const name = (ds.name || '').toLowerCase();
            return id === 'consolidated_conversation_part' || name.includes('conversation actions');
        });

        if (actionsDs) {
            datasetId = actionsDs.dataset_id || actionsDs.id;
            // Use qualified_ids for the key attributes we need
            attributeIds = [
                'standard.conversation_id',
                'standard.action_id',
                'standard.action_type',
                'standard.channel',
                'standard.conversation_started_by',
                'standard.conversation_tag_ids',
                'standard.last_teammate_rating',
                'timestamp.action_time',
                'timestamp.conversation_started_at',
                'teammate.action_performed_by_teammate_id',
                'teammate.action_teammate_assignee_id',
                'teammate.teammate_assignee_at_action_time',
                'duration.teammate_subsequent_response_time',
                'duration.teammate_first_response_time',
                'duration.response_time'
            ];
            console.log(`\n   Using dataset: "${actionsDs.name}" (id: ${datasetId})`);
            console.log(`   Selected ${attributeIds.length} key attributes`);
        } else {
            // Fallback: use first dataset that has "conversation" in it
            const convDs = datasets.find(ds => {
                const name = (ds.name || '').toLowerCase();
                return name.includes('conversation');
            });
            if (convDs) {
                datasetId = convDs.dataset_id || convDs.id;
                attributeIds = [];
                console.log(`\n   Actions dataset not found. Using: "${convDs.name}" (${datasetId})`);
            }
        }
    }

    if (!datasetId) {
        console.error('\n   Could not find a suitable dataset. Available datasets above.');
        return;
    }

    // Step 3: Enqueue the export
    console.log(`\n2. Starting export for ${label}...`);
    let job;
    try {
        job = await enqueueExport(datasetId, startTimestamp, endTimestamp, attributeIds);
    } catch (error) {
        console.error(`   Enqueue error: ${error.response?.status} ${error.response?.data?.message || error.message}`);
        if (error.response?.data) {
            console.error('   Details:', JSON.stringify(error.response.data, null, 2));
        }
        return;
    }

    // Step 4: Wait for completion
    console.log('\n3. Waiting for export to complete...');
    try {
        job = await waitForJob(job.job_identifier);
    } catch (error) {
        console.error(`   ${error.message}`);
        return;
    }

    // Step 5: Download
    console.log('\n4. Downloading exported data...');
    let rawData;
    try {
        if (job.download_url) {
            console.log(`   Using download URL from job response...`);
            const resp = await axios.get(job.download_url, {
                headers: {
                    'Authorization': `Bearer ${INTERCOM_TOKEN}`,
                    'Accept': 'application/octet-stream',
                    'Intercom-Version': 'Unstable'
                },
                responseType: 'arraybuffer',
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
            rawData = resp.data;
        } else {
            rawData = await downloadExport(job.job_identifier);
        }
        console.log(`   Downloaded ${(rawData.length / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
        console.error(`   Download error: ${error.response?.status} ${error.message}`);
        return;
    }

    // Save raw file as backup
    const backupFile = path.join(__dirname, `conversation-actions-${label}.csv`);
    fs.writeFileSync(backupFile, rawData);
    console.log(`   Saved to: ${backupFile}`);

    // Step 6: Parse
    console.log('\n5. Parsing data...');
    const rows = parseCSV(rawData);
    console.log(`   Parsed ${rows.length} rows`);

    if (rows.length === 0) {
        console.log('   No data found.');
        return;
    }

    // Show first row sample
    console.log('\n   First row sample:');
    const first = rows[0];
    Object.entries(first).slice(0, 10).forEach(([k, v]) => {
        console.log(`     ${k}: ${v}`);
    });
    if (Object.keys(first).length > 10) {
        console.log(`     ... and ${Object.keys(first).length - 10} more columns`);
    }

    // Map to records
    const records = rows.map(mapRowToRecord);

    // Show mapped sample
    console.log('\n   Mapped sample:');
    const sample = records[0];
    Object.entries(sample).forEach(([k, v]) => {
        if (v !== null) console.log(`     ${k}: ${v}`);
    });

    // Step 7: Import to Supabase
    console.log(`\n6. Importing ${records.length} records into "${TABLE_NAME}"...`);

    // Clear existing data for this date first
    if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
        const startOfDay = new Date(label + 'T00:00:00+06:00').toISOString();
        const endOfDay = new Date(label + 'T23:59:59+06:00').toISOString();
        const { error: clearError } = await supabase
            .from(TABLE_NAME)
            .delete()
            .gte('action_time', startOfDay)
            .lte('action_time', endOfDay);
        if (!clearError) {
            console.log(`   Cleared existing data for ${label}`);
        }
    }

    const { inserted, errors } = await insertRecords(records);

    // Verify
    const { count } = await supabase.from(TABLE_NAME).select('*', { count: 'exact', head: true });

    console.log('\n\n' + '='.repeat(60));
    console.log('  IMPORT COMPLETE');
    console.log('='.repeat(60));
    console.log(`  Date:            ${label}`);
    console.log(`  Rows in CSV:     ${rows.length}`);
    console.log(`  Inserted:        ${inserted}`);
    console.log(`  Errors:          ${errors}`);
    console.log(`  Total in table:  ${count}`);
    console.log(`  Backup file:     ${backupFile}`);
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    if (err.response?.data) {
        console.error('API response:', JSON.stringify(err.response.data, null, 2));
    }
});
