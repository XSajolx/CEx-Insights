import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../contexts/AuthContext';

// Only these emails can access this component
const ALLOWED_EMAILS = ['sajol@nextventures.io'];

const TopicAnalyzerAdmin = () => {
  const { user } = useAuth();
  const [mode, setMode] = useState('range'); // 'single' or 'range'
  const [conversationId, setConversationId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('00:00');
  const [timeTo, setTimeTo] = useState('23:59');
  const [timezoneOffset, setTimezoneOffset] = useState(0); // 0 = GMT+0 (UTC), 6 = GMT+6 (Bangladesh)

  // Progress states
  const [isFetching, setIsFetching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [datasets, setDatasets] = useState(null); // For Reporting Data Export datasets
  const [showDatasets, setShowDatasets] = useState(false);

  // Conversation Actions automatic sync (API: export → download → filter → Supabase)
  const [conversationActionsUploading, setConversationActionsUploading] = useState(false);
  const [conversationActionsStatus, setConversationActionsStatus] = useState('');
  const [conversationActionsDateFrom, setConversationActionsDateFrom] = useState('2026-02-01');
  const [conversationActionsDateTo, setConversationActionsDateTo] = useState('2026-02-17');

  // Conversation Dataset sync (Service Performance Overview)
  const [convDatasetUploading, setConvDatasetUploading] = useState(false);
  const [convDatasetStatus, setConvDatasetStatus] = useState('');
  const [convDatasetDateFrom, setConvDatasetDateFrom] = useState('2026-02-01');
  const [convDatasetDateTo, setConvDatasetDateTo] = useState('2026-02-17');

  // Tickets Dataset sync
  const [ticketsUploading, setTicketsUploading] = useState(false);
  const [ticketsStatus, setTicketsStatus] = useState('');
  const [ticketsDateFrom, setTicketsDateFrom] = useState('2025-06-01');
  const [ticketsDateTo, setTicketsDateTo] = useState(new Date().toISOString().split('T')[0]);

  // SPO Enrich (FRT/ART/AHT per agent)
  const [spoEnriching, setSpoEnriching] = useState(false);
  const [spoEnrichStatus, setSpoEnrichStatus] = useState('');
  const [frtRecalcing, setFrtRecalcing] = useState(false);
  const [frtRecalcStatus, setFrtRecalcStatus] = useState('');
  // FIN Enrich (CX score, transcript)

  // FIN Sync (via Supabase Edge Function)
  const [finSyncRunning, setFinSyncRunning] = useState(false);
  const [finSyncStatus, setFinSyncStatus] = useState('');
  const [finSyncDateFrom, setFinSyncDateFrom] = useState('2026-03-08');
  const [finSyncDateTo, setFinSyncDateTo] = useState('2026-03-08');

  // CSAT Automation
  const [csatRunning, setCsatRunning] = useState(false);
  const [csatStatus, setCsatStatus] = useState('');
  const [csatProgress, setCsatProgress] = useState({ total: 0, done: 0, errors: 0 });
  const csatStopRef = useRef(false);
  
  // Progress tracking
  const [progress, setProgress] = useState({
    totalAvailable: 0,
    fetched: 0,
    saved: 0,
    currentPage: 0,
    analyzed: 0,
    toAnalyze: 0,
    status: '' // Current operation status
  });
  
  // Stop flag using ref (persists across renders without causing re-render)
  const stopRequestedRef = useRef(false);
  
  // API URL (relative; in dev Vite proxies /api to Vercel - see vite.config.js)
  const API_URL = '/api/analyze-topics';

  // Parse JSON or throw a clear error (e.g. when API is unreachable on localhost)
  const parseJson = async (response) => {
    const text = await response.text();
    if (!text || !text.trim()) {
      throw new Error(
        'API returned no data. From localhost: restart dev server so /api is proxied to Vercel (vite.config.js), or run "vercel dev".'
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`API returned invalid JSON. From localhost, ensure the API proxy is set up or run "vercel dev".`);
    }
  };

  // Your date + time in selected timezone (offset hours) -> Unix seconds. Same logic as API.
  const getFilterRange = (from, to, fromTime = '00:00', toTime = '23:59', offsetHours = timezoneOffset) => {
    if (!from || !to) return null;
    const [fromY, fromM, fromD] = from.split('-').map(Number);
    const [toY, toM, toD] = to.split('-').map(Number);
    const parseT = (str, defH, defM) => {
      if (!str) return [defH, defM];
      const p = str.trim().split(':').map(Number);
      return [Number.isNaN(p[0]) ? defH : p[0], Number.isNaN(p[1]) ? defM : p[1]];
    };
    const [fh, fm] = parseT(fromTime, 0, 0);
    const [th, tm] = parseT(toTime, 23, 59);
    const fromTs = Math.floor(Date.UTC(fromY, fromM - 1, fromD, fh - offsetHours, fm, 0) / 1000);
    const toTs = Math.floor(Date.UTC(toY, toM - 1, toD, th - offsetHours, tm, 59) / 1000);
    return { fromTs, toTs };
  };

  const TIMEZONE_OPTIONS = [
    { value: 0, label: 'GMT+0 (UTC)' },
    { value: 6, label: 'GMT+6 (Bangladesh)' }
  ];

  // Quick date filters
  const setQuickRange = (preset) => {
    const now = new Date();
    const toDate = new Date(now);
    let fromDate = new Date(now);
    if (preset === 'yesterday') {
      fromDate.setDate(fromDate.getDate() - 1);
      toDate.setDate(toDate.getDate() - 1);
    } else if (preset === '7days') {
      fromDate.setDate(fromDate.getDate() - 6);
    }
    setDateFrom(fromDate.toISOString().slice(0, 10));
    setDateTo(toDate.toISOString().slice(0, 10));
    setTimeFrom('00:00');
    setTimeTo('23:59');
  };

  // Check access permission
  const userEmail = user?.email?.toLowerCase() || '';
  const hasAccess = ALLOWED_EMAILS.some(email => email.toLowerCase() === userEmail);

  // If no access, show access denied
  if (!hasAccess) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '12px',
          padding: '2rem',
          maxWidth: '400px',
          margin: '0 auto'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
          <h3 style={{ color: '#F87171', margin: '0 0 0.5rem 0' }}>Access Denied</h3>
          <p style={{ color: '#94A3B8', margin: 0, fontSize: '0.875rem' }}>
            This feature is restricted to authorized administrators only.
          </p>
        </div>
      </div>
    );
  }

  // Insert minimal record (Phase 1: Conversation ID + created_at only)
  // Uses upsert to handle duplicates - only updates if record exists
  const insertIdsBatch = async (records) => {
    if (!records || records.length === 0) return { inserted: 0, errors: 0, skipped: 0 };
    
    try {
      // Use upsert with onConflict to handle duplicates
      const { data, error } = await supabase
        .from('Intercom Topic')
        .upsert(records, { 
          onConflict: 'Conversation ID',
          ignoreDuplicates: true 
        })
        .select();
      
      if (error) {
        console.error('Supabase upsert error:', error);
        // Try regular insert as fallback (may fail on duplicates)
        const { data: insertData, error: insertError } = await supabase
          .from('Intercom Topic')
          .insert(records)
          .select();
        
        if (insertError) {
          // Check if it's a duplicate error - count how many actually got inserted
          console.error('Supabase insert fallback error:', insertError);
          return { inserted: 0, errors: records.length, skipped: 0 };
        }
        return { inserted: insertData?.length ?? 0, errors: 0, skipped: records.length - (insertData?.length ?? 0) };
      }
      
      return { inserted: data?.length ?? records.length, errors: 0, skipped: 0 };
    } catch (e) {
      console.error('insertIdsBatch exception:', e);
      return { inserted: 0, errors: records.length, skipped: 0 };
    }
  };

  // Update row by Conversation ID with full data (Phase 2)
  // Writes CX Score Rating, Assigned Channel ID, Email, Product, Transcript and other fields
  const updateRowInSupabase = async (convId, fullRecord) => {
    const rating = fullRecord['CX Score Rating'] ?? fullRecord['Conversation Rating'];
    const createdAtUnix = fullRecord['created_at'];
    const createdAtBD = fullRecord['created_at_bd']
      ?? (createdAtUnix != null ? new Date(Number(createdAtUnix) * 1000).toISOString() : null);

    const payload = {
      'Email': fullRecord['Email'] || null,
      'Transcript': fullRecord['Transcript'] || null,
      'User ID': fullRecord['User ID'] || null,
      'Country': fullRecord['Country'] || null,
      'Region': fullRecord['Region'] || null,
      'Assigned Channel ID': fullRecord['Assigned Channel ID'] || null,
      'Product': fullRecord['Product'] || null,
      'CX Score Rating': (rating != null && String(rating).trim() !== '') ? String(rating) : null,
      'Conversation Rating': (rating != null && String(rating).trim() !== '') ? String(rating) : null
    };

    // Set created_at_bd if available (timestamptz column)
    if (createdAtBD) {
      payload['created_at_bd'] = createdAtBD;
    }

    const { data, error } = await supabase
      .from('Intercom Topic')
      .update(payload)
      .eq('"Conversation ID"', convId)
      .select();
    
    if (error) {
      console.error('Supabase update error for', convId, ':', error.message);
      return false;
    }
    
    if (!data || data.length === 0) {
      console.error('No rows matched for Conversation ID:', convId);
      return false;
    }
    
    return true;
  };

  // Pull full data from Intercom for every Conversation ID already in Supabase (no date range needed)
  const handleEnrichFromSupabase = async () => {
    setIsFetching(true);
    setError('');
    stopRequestedRef.current = false;
    setProgress({ totalAvailable: 0, fetched: 0, saved: 0, currentPage: 0, analyzed: 0, toAnalyze: 0, status: '' });

    try {
      setProgress(prev => ({ ...prev, status: '📋 Loading Conversation IDs from Supabase...' }));

      const { data: rows, error: fetchErr } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID"');

      if (fetchErr) {
        setError(`Supabase error: ${fetchErr.message}`);
        return;
      }
      if (!rows || rows.length === 0) {
        setProgress(prev => ({ ...prev, status: '⚠️ No rows in Intercom Topic. Use Fetch & Save first.' }));
        return;
      }

      const total = rows.length;
      setProgress(prev => ({ ...prev, totalAvailable: total, status: `📥 Pulling data from Intercom for ${total} chat IDs...` }));

      let enriched = 0;
      let errorCount = 0;
      let lastError = '';
      const ENRICH_DELAY_MS = 400; // Delay between requests to avoid Intercom rate limiting (429)

      for (let i = 0; i < rows.length; i++) {
        if (stopRequestedRef.current) {
          setProgress(prev => ({ ...prev, status: `⏹️ Stopped. Enriched ${enriched} of ${total}.` }));
          break;
        }

        const convId = rows[i]['Conversation ID'] ?? rows[i]['"Conversation ID"'];
        setProgress(prev => ({
          ...prev,
          fetched: i + 1,
          saved: enriched,
          status: `📥 Pulling data for chat ID ${i + 1}/${total}: ${convId}...`
        }));

        try {
          const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'fetch-details', conversationId: convId })
          });
          if (!res.ok) {
            lastError = res.status === 429 ? 'Rate limited (429) – try again later or use slower pace' : `${res.status} ${res.statusText}`;
            errorCount++;
            if (res.status === 429) await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          const result = await parseJson(res);
          if (!result.success || !result.data) {
            lastError = result.error || 'Empty or invalid API response';
            errorCount++;
            continue;
          }
          const ok = await updateRowInSupabase(convId, result.data);
          if (ok) enriched++;
          else {
            lastError = 'Supabase update failed';
            errorCount++;
          }
        } catch (err) {
          lastError = err.message || String(err);
          console.error(`Enrich ${convId}:`, err);
          errorCount++;
        }

        if (i < rows.length - 1) await new Promise(r => setTimeout(r, ENRICH_DELAY_MS));
      }

      const finalStatus = errorCount > 0
        ? `✅ Done. Enriched ${enriched} of ${total}. Errors: ${errorCount}.${lastError ? ` Last error: ${lastError}` : ''}`
        : `✅ Done. Enriched all ${enriched} rows with data from Intercom.`;
      setProgress(prev => ({ ...prev, status: finalStatus, saved: enriched }));
    } catch (err) {
      console.error('Enrich error:', err);
      setError(err.message);
      setProgress(prev => ({ ...prev, status: `❌ ${err.message}` }));
    } finally {
      setIsFetching(false);
      stopRequestedRef.current = false;
    }
  };

  // Check for rows with missing data and populate from Intercom – PARALLEL processing (5 at a time)
  const handlePopulateMissingData = async () => {
    setIsFetching(true);
    setError('');
    stopRequestedRef.current = false;
    setProgress({ totalAvailable: 0, fetched: 0, saved: 0, currentPage: 0, analyzed: 0, toAnalyze: 0, status: '' });

    const BATCH_SIZE = 5; // Process 5 conversations in parallel
    const BASE_DELAY_MS = 300; // Delay between batches
    let currentBackoff = BASE_DELAY_MS;
    const MAX_BACKOFF = 10000; // Max 10 second backoff

    try {
      // Get all rows where any of the 5 key fields are missing (check both NULL and empty string)
      const { data: allMissing, error: countErr } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID"')
        .or('"CX Score Rating".is.null,"CX Score Rating".eq.,"Assigned Channel ID".is.null,"Assigned Channel ID".eq.,Email.is.null,Email.eq.,Product.is.null,Product.eq.,Transcript.is.null,Transcript.eq.');

      if (countErr) {
        setError(`Supabase error: ${countErr.message}`);
        return;
      }

      const total = allMissing?.length || 0;
      if (total === 0) {
        setProgress(prev => ({ ...prev, status: '✅ No rows with missing data.' }));
        return;
      }

      const startTime = Date.now();
      setProgress(prev => ({ ...prev, status: `🔍 Found ${total} rows with missing data. Processing ${BATCH_SIZE} at a time...`, totalAvailable: total }));

      let enriched = 0;
      let errorCount = 0;
      let lastError = '';
      let processed = 0;

      // Process in batches of BATCH_SIZE
      for (let i = 0; i < total && !stopRequestedRef.current; i += BATCH_SIZE) {
        const batchIds = allMissing.slice(i, i + BATCH_SIZE).map(r => r['Conversation ID'] ?? r['"Conversation ID"']);
        
        // Calculate ETA
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed > 0 ? processed / elapsed : 0;
        const remaining = total - processed;
        const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;
        const etaStr = etaSeconds > 60 ? `${Math.round(etaSeconds / 60)}m` : `${etaSeconds}s`;
        
        setProgress(prev => ({
          ...prev,
          fetched: processed,
          status: `📥 Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(total / BATCH_SIZE)} | Enriched: ${enriched}/${total} | ETA: ${etaStr}`
        }));

        // Fetch all conversations in this batch in parallel
        const batchPromises = batchIds.map(async (convId) => {
          try {
            const res = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'fetch-details', conversationId: convId })
            });
            
            if (res.status === 429) {
              return { convId, error: 'rate_limited', status: 429 };
            }
            if (!res.ok) {
              return { convId, error: `${res.status} ${res.statusText}`, status: res.status };
            }
            
            const result = await parseJson(res);
            if (!result.success || !result.data) {
              return { convId, error: result.error || 'Empty API response' };
            }
            
            return { convId, data: result.data };
          } catch (err) {
            return { convId, error: err.message || String(err) };
          }
        });

        const results = await Promise.all(batchPromises);
        
        // Check if any were rate limited
        const rateLimited = results.filter(r => r.status === 429);
        if (rateLimited.length > 0) {
          // Exponential backoff
          currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF);
          console.log(`Rate limited, backing off ${currentBackoff}ms`);
          await new Promise(r => setTimeout(r, currentBackoff));
          // Retry this batch
          i -= BATCH_SIZE;
          continue;
        } else {
          // Reset backoff on success
          currentBackoff = BASE_DELAY_MS;
        }

        // Process successful results
        for (const r of results) {
          processed++;
          if (r.error) {
            lastError = r.error;
            errorCount++;
            continue;
          }
          
          const ok = await updateRowInSupabase(r.convId, r.data);
          if (ok) {
            enriched++;
          } else {
            lastError = 'Supabase update failed';
            errorCount++;
          }
        }

        setProgress(prev => ({ ...prev, saved: enriched, fetched: processed }));
        
        // Small delay between batches to avoid overwhelming the API
        await new Promise(r => setTimeout(r, currentBackoff));
      }

      const finalStatus = stopRequestedRef.current
        ? `⏹️ Stopped. Populated ${enriched} of ${total} rows.`
        : errorCount > 0
          ? `✅ Done. Populated ${enriched}/${total}. Errors: ${errorCount}.${lastError ? ` Last: ${lastError}` : ''}`
          : `✅ Done. Populated all ${enriched} rows.`;
      setProgress(prev => ({ ...prev, status: finalStatus }));
    } catch (err) {
      console.error('Populate missing error:', err);
      setError(err.message);
      setProgress(prev => ({ ...prev, status: `❌ ${err.message}` }));
    } finally {
      setIsFetching(false);
      stopRequestedRef.current = false;
    }
  };

  // Clear all rows in Intercom Topic
  const handleClearTable = async () => {
    if (!window.confirm('Delete ALL data in Intercom Topic? This cannot be undone.')) return;
    setError('');
    setProgress(prev => ({ ...prev, status: '🗑️ Deleting all rows...' }));
    // Delete in chunks (Supabase may require a filter; delete rows where Conversation ID is not null = all rows)
    const { data: ids } = await supabase.from('Intercom Topic').select('"Conversation ID"');
    if (ids && ids.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize).map(r => r['Conversation ID'] ?? r['"Conversation ID"']);
        const { error } = await supabase.from('Intercom Topic').delete().in('"Conversation ID"', chunk);
        if (error) {
          setError(`Delete failed: ${error.message}`);
          return;
        }
      }
    }
    setProgress(prev => ({ ...prev, status: '✅ Intercom Topic cleared.' }));
  };

  // Reset all data EXCEPT Conversation ID and unique_id – keeps rows but clears their data
  const handleResetDataKeepIds = async () => {
    if (!window.confirm('Clear ALL data except Conversation ID and unique_id? This will set Transcript, Product, Email, Region, etc. to NULL so you can re-fetch.')) return;
    setError('');
    setIsFetching(true);
    setProgress(prev => ({ ...prev, status: '🔄 Resetting data (keeping Conversation IDs)...' }));

    try {
      // Get all conversation IDs
      const { data: rows, error: fetchErr } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID"');

      if (fetchErr) {
        setError(`Supabase error: ${fetchErr.message}`);
        return;
      }

      const total = rows?.length || 0;
      if (total === 0) {
        setProgress(prev => ({ ...prev, status: '✅ No rows to reset.' }));
        return;
      }

      // Update in batches: set all data columns to null
      const nullData = {
        'Email': null,
        'Transcript': null,
        'User ID': null,
        'Country': null,
        'Region': null,
        'Assigned Channel ID': null,
        'CX Score Rating': null,
        'Conversation Rating': null,
        'Product': null,
        'Main-Topics': null,
        'Sub-Topics': null,
        'Sentiment Start': null,
        'Sentiment End': null,
        'Feedbacks': null,
        "Was it in client's favor?": null
      };

      const chunkSize = 100;
      let processed = 0;
      for (let i = 0; i < total; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize).map(r => r['Conversation ID'] ?? r['"Conversation ID"']);
        const { error } = await supabase
          .from('Intercom Topic')
          .update(nullData)
          .in('"Conversation ID"', chunk);

        if (error) {
          setError(`Reset failed: ${error.message}`);
          return;
        }
        processed += chunk.length;
        setProgress(prev => ({ ...prev, status: `🔄 Reset ${processed}/${total} rows...` }));
      }

      setProgress(prev => ({ ...prev, status: `✅ Reset complete. ${total} rows cleared (Conversation IDs kept). Now run "Check & populate missing data" to re-fetch.` }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsFetching(false);
    }
  };

  // Remove rows where Conversation started at is outside the selected date range (GMT+0)
  const handleRemoveOutsideDateRange = async () => {
    if (!dateFrom || !dateTo) {
      setError('Select From and To date first');
      return;
    }
    const range = getFilterRange(dateFrom, dateTo, timeFrom, timeTo);
    if (!range) return;
    const { fromTs, toTs } = range;
    const rangeLabel = timeFrom || timeTo ? `${dateFrom} ${timeFrom || '00:00'} – ${dateTo} ${timeTo || '23:59'}` : `${dateFrom} – ${dateTo}`;
    const tzLabel = TIMEZONE_OPTIONS.find(o => o.value === timezoneOffset)?.label || 'GMT+0';
    if (!window.confirm(`Remove conversations where "Conversation started at" is NOT between ${rangeLabel} (${tzLabel})? This will delete those rows from Supabase.`)) return;

    setIsFetching(true);
    setError('');
    setProgress(prev => ({ ...prev, status: '🔍 Loading rows to check...' }));

    try {
      const { data: rows, error: fetchErr } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID", created_at, created_at_bd');

      if (fetchErr) {
        setError(`Supabase error: ${fetchErr.message}`);
        return;
      }
      if (!rows?.length) {
        setProgress(prev => ({ ...prev, status: '✅ No rows to check.' }));
        return;
      }

      const toSeconds = (v) => {
        if (v == null) return null;
        const n = typeof v === 'string' ? parseInt(v, 10) : v;
        if (Number.isNaN(n)) return null;
        return n > 1e12 ? Math.floor(n / 1000) : n;
      };

      const outside = [];
      for (const r of rows) {
        const convId = r['Conversation ID'] ?? r['"Conversation ID"'];
        let ts = toSeconds(r.created_at);
        if (ts == null && r.created_at_bd) {
          const d = new Date(r.created_at_bd);
          if (!Number.isNaN(d.getTime())) ts = Math.floor(d.getTime() / 1000);
        }
        if (ts == null) continue;
        if (ts < fromTs || ts > toTs) outside.push(convId);
      }

      if (outside.length === 0) {
        setProgress(prev => ({ ...prev, status: `✅ All ${rows.length} rows are within ${dateFrom}–${dateTo} (Dhaka). Nothing removed.` }));
        return;
      }

      setProgress(prev => ({ ...prev, status: `🗑️ Removing ${outside.length} rows outside date range...` }));

      const chunkSize = 100;
      let removed = 0;
      for (let i = 0; i < outside.length; i += chunkSize) {
        const chunk = outside.slice(i, i + chunkSize);
        const { error } = await supabase
          .from('Intercom Topic')
          .delete()
          .in('"Conversation ID"', chunk);
        if (error) {
          setError(`Delete failed: ${error.message}`);
          return;
        }
        removed += chunk.length;
        setProgress(prev => ({ ...prev, status: `🗑️ Removed ${removed}/${outside.length}...` }));
      }

      setProgress(prev => ({ ...prev, status: `✅ Removed ${removed} conversations outside ${dateFrom}–${dateTo} (${TIMEZONE_OPTIONS.find(o => o.value === timezoneOffset)?.label || 'GMT+0'}).` }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsFetching(false);
    }
  };

  // FAST: Extract ONLY Conversation IDs (no enrichment) - for bulk ID extraction
  const handleFetchIdsOnly = async () => {
    if (!dateFrom || !dateTo) {
      setError('Please select a date range');
      return;
    }

    setIsFetching(true);
    setError('');
    stopRequestedRef.current = false;
    setProgress({ totalAvailable: 0, fetched: 0, saved: 0, currentPage: 0, analyzed: 0, toAnalyze: 0, status: '' });

    const BASE_DELAY_MS = 200; // Fast but safe
    let currentBackoff = BASE_DELAY_MS;
    const MAX_BACKOFF = 5000;

    try {
      setProgress(prev => ({ ...prev, status: '🚀 Fast extraction: Fetching Conversation IDs only (150 per page)...' }));
      
      let startingAfter = null;
      let pageNum = 0;
      let totalIdsSaved = 0;
      let totalAvailable = 0;
      let allIds = []; // Collect all IDs first, then batch insert
      const startTime = Date.now();

      // PHASE 1: Fetch ALL IDs from Intercom (paginate through everything)
      while (!stopRequestedRef.current) {
        pageNum++;
        
        // Calculate stats
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = allIds.length > 0 ? allIds.length / elapsed : 0;
        
        setProgress(prev => ({ 
          ...prev, 
          currentPage: pageNum,
          fetched: allIds.length,
          status: `📥 Page ${pageNum} | Fetched: ${allIds.length} IDs | Rate: ${rate.toFixed(1)}/sec`
        }));

        let response;
        let retries = 0;
        const maxRetries = 3;

        while (retries < maxRetries) {
          try {
            response = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'fetch-ids',
                dateFrom,
                dateTo,
                timeFrom,
                timeTo,
                timezoneOffset,
                startingAfter
              })
            });

            if (response.status === 429) {
              // Rate limited - exponential backoff
              currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF);
              console.log(`Rate limited on page ${pageNum}, backing off ${currentBackoff}ms`);
              await new Promise(r => setTimeout(r, currentBackoff));
              retries++;
              continue;
            }

            if (!response.ok) {
              const errData = await parseJson(response);
              console.error('API error:', response.status, errData);
              throw new Error(errData.error || errData.details?.message || `HTTP ${response.status}`);
            }

            // Success - reset backoff
            currentBackoff = BASE_DELAY_MS;
            break;
          } catch (e) {
            retries++;
            if (retries >= maxRetries) throw e;
            await new Promise(r => setTimeout(r, currentBackoff));
          }
        }

        const data = await parseJson(response);
        console.log(`Page ${pageNum} response:`, { 
          success: data.success, 
          recordCount: data.data?.length, 
          totalCount: data.totalCount,
          hasMore: data.hasMore,
          nextStartingAfter: data.nextStartingAfter ? 'yes' : 'no',
          debug: data.debug
        });
        
        // Show debug info on first page
        if (pageNum === 1 && data.debug) {
          console.log('Query date range:', data.debug.queryFromDate, 'to', data.debug.queryToDate);
        }
        
        if (!data.success) {
          throw new Error(data.error || 'API returned success: false');
        }
        
        totalAvailable = data.totalCount ?? totalAvailable;
        const pageRecords = data.data || [];
        
        if (pageRecords.length > 0) {
          allIds = allIds.concat(pageRecords);
        }
        setProgress(prev => ({ ...prev, totalAvailable, fetched: allIds.length }));

        if (!data.hasMore || !data.nextStartingAfter) {
          console.log(`No more pages after page ${pageNum} (hasMore: ${data.hasMore}, nextStartingAfter: ${data.nextStartingAfter})`);
          break;
        }
        startingAfter = data.nextStartingAfter;

        // Small delay between pages
        await new Promise(r => setTimeout(r, currentBackoff));
      }

      if (stopRequestedRef.current) {
        setProgress(prev => ({ ...prev, status: `⏹️ Stopped. Fetched ${allIds.length} IDs.` }));
        return;
      }

      // PHASE 2: Batch insert ALL IDs to Supabase (100 at a time)
      setProgress(prev => ({ ...prev, status: `💾 Saving ${allIds.length} IDs to Supabase...` }));
      
      const BATCH_SIZE = 100;
      for (let i = 0; i < allIds.length && !stopRequestedRef.current; i += BATCH_SIZE) {
        const batch = allIds.slice(i, i + BATCH_SIZE);
        const { inserted } = await insertIdsBatch(batch);
        totalIdsSaved += inserted;
        setProgress(prev => ({ 
          ...prev, 
          saved: totalIdsSaved,
          status: `💾 Saved ${totalIdsSaved}/${allIds.length} IDs to Supabase...`
        }));
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      setProgress(prev => ({ 
        ...prev, 
        saved: totalIdsSaved,
        status: `✅ Complete! Fetched ${allIds.length} IDs, saved ${totalIdsSaved} to Supabase in ${totalTime}s`
      }));

    } catch (err) {
      console.error('Fast ID fetch error:', err);
      setError(err.message);
      setProgress(prev => ({ ...prev, status: `❌ ${err.message}` }));
    } finally {
      setIsFetching(false);
      stopRequestedRef.current = false;
    }
  };

  // Two-phase fetch (like n8n): Phase 1 = IDs only 150/page → save; Phase 2 = pull full data per Conversation ID → update
  const handleFetchAndSave = async () => {
    if (!dateFrom || !dateTo) {
      setError('Please select a date range');
      return;
    }

    setIsFetching(true);
    setError('');
    stopRequestedRef.current = false;
    setProgress({ totalAvailable: 0, fetched: 0, saved: 0, currentPage: 0, analyzed: 0, toAnalyze: 0, status: '' });

    try {
      // ---------- PHASE 1: Pull only Conversation ID (150 per page), save to Supabase ----------
      setProgress(prev => ({ ...prev, status: '📥 Phase 1: Fetching Conversation IDs (150 per page) and saving...' }));
      
      let startingAfter = null;
      let pageNum = 0;
      let totalIdsSaved = 0;
      let totalAvailable = 0;

      while (!stopRequestedRef.current) {
        pageNum++;
        setProgress(prev => ({ 
          ...prev, 
          currentPage: pageNum,
          status: `📥 Phase 1 – Page ${pageNum}: Fetching 150 Conversation IDs...`
        }));

        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'fetch-ids',
            dateFrom,
            dateTo,
            timeFrom,
            timeTo,
            timezoneOffset,
            startingAfter
          })
        });

        if (!response.ok) {
          const errData = await parseJson(response);
          throw new Error(errData.error || 'Failed to fetch IDs');
        }

        const data = await parseJson(response);
        totalAvailable = data.totalCount ?? totalAvailable;
        const pageRecords = data.data || [];
        
        if (pageRecords.length > 0) {
          setProgress(prev => ({ 
            ...prev, 
            totalAvailable,
            fetched: totalIdsSaved + pageRecords.length,
            status: `💾 Phase 1 – Saving ${pageRecords.length} IDs to Supabase...`
          }));
          const { inserted } = await insertIdsBatch(pageRecords);
          totalIdsSaved += inserted;
          setProgress(prev => ({ ...prev, saved: totalIdsSaved }));
        }

        if (!data.hasMore || !data.nextStartingAfter) break;
        startingAfter = data.nextStartingAfter;
      }

      if (stopRequestedRef.current) {
        setProgress(prev => ({ ...prev, status: '⏹️ Stopped.' }));
        return;
      }

      setProgress(prev => ({ ...prev, status: `✅ Phase 1 done. ${totalIdsSaved} Conversation IDs saved. Starting Phase 2...` }));

      // ---------- PHASE 2: PARALLEL processing – fetch 5 at a time from Intercom ----------
      const BATCH_SIZE = 5;
      const BASE_DELAY_MS = 300;
      let currentBackoff = BASE_DELAY_MS;
      const MAX_BACKOFF = 10000;

      // Get all conversation IDs that need enrichment
      const { data: allRows, error: allRowsErr } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID"')
        .order('created_at', { ascending: true });

      if (allRowsErr) {
        setError(`Supabase read error: ${allRowsErr.message}`);
        return;
      }

      const totalRows = allRows?.length || 0;
      const startTime = Date.now();
      let enriched = 0;
      let errorCount = 0;
      let phase2LastError = '';
      let processed = 0;

      for (let i = 0; i < totalRows && !stopRequestedRef.current; i += BATCH_SIZE) {
        const batchIds = allRows.slice(i, i + BATCH_SIZE).map(r => r['Conversation ID'] ?? r['"Conversation ID"']);

        // Calculate ETA
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed > 0 ? processed / elapsed : 0;
        const remaining = totalRows - processed;
        const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;
        const etaStr = etaSeconds > 60 ? `${Math.round(etaSeconds / 60)}m` : `${etaSeconds}s`;

        setProgress(prev => ({
          ...prev,
          saved: totalIdsSaved,
          status: `📥 Phase 2 – Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalRows / BATCH_SIZE)} | Enriched: ${enriched}/${totalRows} | ETA: ${etaStr}`
        }));

        // Fetch all conversations in this batch in parallel
        const batchPromises = batchIds.map(async (convId) => {
          try {
            const res = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'fetch-details', conversationId: convId })
            });

            if (res.status === 429) {
              return { convId, error: 'rate_limited', status: 429 };
            }
            if (!res.ok) {
              return { convId, error: `${res.status} ${res.statusText}`, status: res.status };
            }

            const result = await parseJson(res);
            if (!result.success || !result.data) {
              return { convId, error: result.error || 'Empty API response' };
            }

            return { convId, data: result.data };
          } catch (err) {
            return { convId, error: err.message || String(err) };
          }
        });

        const results = await Promise.all(batchPromises);

        // Check if any were rate limited
        const rateLimited = results.filter(r => r.status === 429);
        if (rateLimited.length > 0) {
          currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF);
          console.log(`Rate limited, backing off ${currentBackoff}ms`);
          await new Promise(r => setTimeout(r, currentBackoff));
          i -= BATCH_SIZE; // Retry this batch
          continue;
        } else {
          currentBackoff = BASE_DELAY_MS;
        }

        // Process successful results
        for (const r of results) {
          processed++;
          if (r.error) {
            phase2LastError = r.error;
            errorCount++;
            continue;
          }

          const ok = await updateRowInSupabase(r.convId, r.data);
          if (ok) enriched++;
          else {
            phase2LastError = 'Supabase update failed';
            errorCount++;
          }
        }

        await new Promise(r => setTimeout(r, currentBackoff));
      }

      const finalStatus = errorCount > 0
        ? `✅ Done. Enriched ${enriched} rows. Errors: ${errorCount}.${phase2LastError ? ` Last error: ${phase2LastError}` : ''}`
        : `✅ Complete. All ${enriched} rows enriched with full data.`;
      setProgress(prev => ({ ...prev, status: finalStatus }));

    } catch (err) {
      console.error('Fetch error:', err);
      setError(err.message);
      setProgress(prev => ({ ...prev, status: `❌ ${err.message}` }));
    } finally {
      setIsFetching(false);
      stopRequestedRef.current = false;
    }
  };

  // Analyze unanalyzed conversations
  const handleAnalyzeUnanalyzed = async () => {
    setIsAnalyzing(true);
    setError('');
    stopRequestedRef.current = false;
    
    try {
      // Fetch unanalyzed records from Supabase
      // Records where Main-Topics is null or empty (not yet analyzed by AI)
      const { data: unanalyzed, error: fetchError } = await supabase
        .from('Intercom Topic')
        .select('*')
        .or('Main-Topics.is.null,Main-Topics.eq.[]')
        .order('created_at', { ascending: true })
        .limit(500);

      if (fetchError) throw fetchError;

      if (!unanalyzed || unanalyzed.length === 0) {
        setError('No unanalyzed conversations found');
        setIsAnalyzing(false);
        return;
      }

      setProgress(prev => ({ ...prev, toAnalyze: unanalyzed.length, analyzed: 0 }));

      for (let i = 0; i < unanalyzed.length; i++) {
        if (stopRequestedRef.current) break;

        const record = unanalyzed[i];
        const convId = record['Conversation ID'];

        try {
          // Call API to analyze with AI
          const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'analyze-single',
              conversationId: convId
            })
          });

          if (response.ok) {
            const result = await parseJson(response);
            if (result.success && result.data) {
              // Update Supabase with AI results
              await supabase
                .from('Intercom Topic')
                .update({
                  'Main-Topics': result.data['Main-Topics'],
                  'Sub-Topics': result.data['Sub-Topics'],
                  'Sentiment Start': result.data['Sentiment Start'],
                  'Sentiment End': result.data['Sentiment End'],
                  'Feedbacks': result.data['Feedbacks'],
                  'Was it in client\'s favor?': result.data['Was it in client\'s favor?']
                })
                .eq('"Conversation ID"', convId);
            }
          }
        } catch (err) {
          console.error(`Failed to analyze ${convId}:`, err);
        }

        setProgress(prev => ({ ...prev, analyzed: i + 1 }));
      }
    } catch (err) {
      console.error('Analyze error:', err);
      setError(err.message);
    } finally {
      setIsAnalyzing(false);
      stopRequestedRef.current = false;
    }
  };

  // Handle single conversation
  const handleAnalyzeSingle = async () => {
    if (!conversationId) {
      setError('Please enter a conversation ID');
      return;
    }

    setIsFetching(true);
    setError('');

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fetch-single',
          conversationId
        })
      });

      const data = await parseJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch conversation');
      }

      if (data.success && data.data) {
        // Save to Supabase
        await saveBatchToSupabase([data.data]);
        setProgress(prev => ({ ...prev, saved: 1, fetched: 1 }));
      }
    } catch (err) {
      console.error('Single fetch error:', err);
      setError(err.message);
    } finally {
      setIsFetching(false);
    }
  };

  // Stop any running process
  const handleStop = () => {
    stopRequestedRef.current = true;
  };

  // Test Intercom connection
  const handleTestIntercom = async () => {
    setError('');
    setProgress(prev => ({ ...prev, status: '🔍 Testing Intercom connection...' }));
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test-intercom' })
      });
      const result = await parseJson(res);
      console.log('Test Intercom result:', result);
      if (result.success) {
        setProgress(prev => ({ ...prev, status: `✅ ${result.message} Total: ${result.totalCount}` }));
        if (result.sampleIds) {
          console.log('Sample conversations:', result.sampleIds);
        }
      } else {
        setError(result.error || 'Test failed');
        setProgress(prev => ({ ...prev, status: `❌ ${result.error}` }));
      }
    } catch (err) {
      setError(err.message);
      setProgress(prev => ({ ...prev, status: `❌ ${err.message}` }));
    }
  };

  // List available datasets from Intercom Reporting Data Export API
  const handleListDatasets = async () => {
    setError('');
    setDatasets(null);
    setShowDatasets(true);
    setProgress(prev => ({ ...prev, status: '🔍 Fetching available datasets from Intercom...' }));

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-datasets' })
      });
      const result = await parseJson(res);
      if (!result.success) {
        setError(result.error || 'Failed to fetch datasets');
        setProgress(prev => ({ ...prev, status: `❌ ${result.error || 'Failed'}` }));
        return;
      }
      setDatasets(result.datasets);
      setProgress(prev => ({ ...prev, status: '✅ Datasets loaded. See below.' }));
    } catch (err) {
      setError(err.message);
      setProgress(prev => ({ ...prev, status: `❌ ${err.message}` }));
    }
  };

  // --- Conversation Actions: day-by-day sync for reliability ---
  const handleSyncConversationActions = async () => {
    setConversationActionsUploading(true);
    setError('');
    const startTime = Date.now();
    const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`;

    // Build list of individual days using pure string math (no timezone shift)
    const days = [];
    const [fy, fm, fd] = conversationActionsDateFrom.split('-').map(Number);
    const [ty, tm, td] = conversationActionsDateTo.split('-').map(Number);
    const toNum = ty * 10000 + tm * 100 + td;
    let cy = fy, cm = fm, cd = fd;
    while (cy * 10000 + cm * 100 + cd <= toNum) {
      days.push(`${cy}-${String(cm).padStart(2,'0')}-${String(cd).padStart(2,'0')}`);
      cd++;
      const daysInMonth = new Date(cy, cm, 0).getDate();
      if (cd > daysInMonth) { cd = 1; cm++; }
      if (cm > 12) { cm = 1; cy++; }
    }

    let totalImported = 0;
    let totalCsvRows = 0;
    let dayErrors = [];

    try {
      for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        const day = days[dayIdx];
        const dayLabel = `Day ${dayIdx + 1}/${days.length} (${day})`;

        try {
          // Step 1: Enqueue export for this single day
          setConversationActionsStatus(`${dayLabel}: Enqueuing export... (${elapsed()} elapsed)`);
          const enqRes = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ca-enqueue', dateFrom: day, dateTo: day })
          });
          const enqResult = await parseJson(enqRes);
          if (!enqResult.success) {
            dayErrors.push(`${day}: enqueue failed – ${enqResult.error || 'unknown'}`);
            continue;
          }
          const jobId = enqResult.jobId;

          // Step 2: Poll until complete
          let status = enqResult.status || 'pending';
          const isDone = (s) => s === 'complete' || s === 'completed';
          while (!isDone(status) && status !== 'failed') {
            await new Promise(r => setTimeout(r, 5000));
            setConversationActionsStatus(`${dayLabel}: Waiting for Intercom... status: ${status} (${elapsed()} elapsed)`);
            const pollRes = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'ca-poll', jobId })
            });
            const pollResult = await parseJson(pollRes);
            if (!pollResult.success) {
              dayErrors.push(`${day}: poll failed – ${pollResult.error || 'unknown'}`);
              status = 'failed';
              break;
            }
            status = pollResult.status || 'unknown';
          }
          if (status === 'failed') continue;

          // Step 3: Download, filter, import
          setConversationActionsStatus(`${dayLabel}: Downloading & importing... (${elapsed()} elapsed) | Running total: ${totalImported} rows`);
          const dlRes = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ca-download-import', jobId })
          });
          const dlResult = await parseJson(dlRes);
          if (!dlResult.success) {
            dayErrors.push(`${day}: import failed – ${dlResult.error || 'unknown'}`);
            continue;
          }

          totalImported += dlResult.imported ?? 0;
          totalCsvRows += dlResult.totalCsvRows ?? 0;
          setConversationActionsStatus(`${dayLabel}: Done — ${dlResult.imported ?? 0} rows | Running total: ${totalImported} (${elapsed()} elapsed)`);
        } catch (dayErr) {
          dayErrors.push(`${day}: ${dayErr?.message || String(dayErr)}`);
          setConversationActionsStatus(`${dayLabel}: Error, skipping... | Running total: ${totalImported} (${elapsed()} elapsed)`);
          continue;
        }
      }

      // Final summary
      const errorSummary = dayErrors.length > 0 ? ` | Errors on ${dayErrors.length} day(s): ${dayErrors.join('; ')}` : '';
      setConversationActionsStatus(
        `Done! Imported ${totalImported} agent rows across ${days.length} day(s) (filtered from ${totalCsvRows} total CSV rows). Time: ${elapsed()}.${errorSummary}`
      );
    } catch (err) {
      setConversationActionsStatus(`Imported ${totalImported} rows before error.`);
      setError(err?.message || String(err));
    } finally {
      setConversationActionsUploading(false);
    }
  };

  // --- Conversation Dataset: day-by-day sync for Service Performance Overview ---
  const handleSyncConversationDataset = async () => {
    setConvDatasetUploading(true);
    setError('');
    const startTime = Date.now();
    const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`;

    const days = [];
    const [fy, fm, fd] = convDatasetDateFrom.split('-').map(Number);
    const [ty, tm, td] = convDatasetDateTo.split('-').map(Number);
    const toNum = ty * 10000 + tm * 100 + td;
    let cy = fy, cm = fm, cd = fd;
    while (cy * 10000 + cm * 100 + cd <= toNum) {
      days.push(`${cy}-${String(cm).padStart(2,'0')}-${String(cd).padStart(2,'0')}`);
      cd++;
      const daysInMonth = new Date(cy, cm, 0).getDate();
      if (cd > daysInMonth) { cd = 1; cm++; }
      if (cm > 12) { cm = 1; cy++; }
    }

    let totalImported = 0;
    let totalCsvRows = 0;
    let totalMovedToSpo = 0;
    let totalMovedToEmail = 0;
    let dayErrors = [];

    try {
      for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        const day = days[dayIdx];
        const dayLabel = `Day ${dayIdx + 1}/${days.length} (${day})`;

        try {
          setConvDatasetStatus(`${dayLabel}: Enqueuing export... (${elapsed()} elapsed)`);
          const enqRes = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cd-enqueue', dateFrom: day, dateTo: day })
          });
          const enqResult = await parseJson(enqRes);
          if (!enqResult.success) {
            dayErrors.push(`${day}: enqueue failed – ${enqResult.error || 'unknown'}`);
            continue;
          }
          const jobId = enqResult.jobId;

          let status = enqResult.status || 'pending';
          const isDone = (s) => s === 'complete' || s === 'completed';
          while (!isDone(status) && status !== 'failed') {
            await new Promise(r => setTimeout(r, 5000));
            setConvDatasetStatus(`${dayLabel}: Waiting for Intercom... status: ${status} (${elapsed()} elapsed)`);
            const pollRes = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'ca-poll', jobId })
            });
            const pollResult = await parseJson(pollRes);
            if (!pollResult.success) {
              dayErrors.push(`${day}: poll failed – ${pollResult.error || 'unknown'}`);
              status = 'failed';
              break;
            }
            status = pollResult.status || 'unknown';
          }
          if (status === 'failed') continue;

          setConvDatasetStatus(`${dayLabel}: Downloading & importing... (${elapsed()} elapsed) | Running total: ${totalImported} rows`);
          const dlRes = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cd-download-import', jobId })
          });
          const dlResult = await parseJson(dlRes);
          if (!dlResult.success) {
            dayErrors.push(`${day}: import failed – ${dlResult.error || 'unknown'}`);
            continue;
          }

          totalImported += dlResult.imported ?? 0;
          totalCsvRows += dlResult.totalCsvRows ?? 0;
          totalMovedToSpo += dlResult.movedToSpo ?? 0;
          totalMovedToEmail += dlResult.movedToEmail ?? 0;
          const moveInfo = (dlResult.movedToSpo || dlResult.movedToEmail) ? ` | Moved: ${dlResult.movedToSpo ?? 0} → SPO, ${dlResult.movedToEmail ?? 0} → Email` : '';
          const moveErrInfo = dlResult.moveErrors?.length ? ` | Move errors: ${dlResult.moveErrors.join('; ')}` : '';
          const unmappedInfo = dlResult.unmappedHeaders?.length ? ` | Unmapped: [${dlResult.unmappedHeaders.join(', ')}]` : '';
          const mappedInfo = dlResult.mappedDetail?.length ? ` | Mapped: [${dlResult.mappedDetail.join(', ')}]` : '';
          setConvDatasetStatus(`${dayLabel}: Done — ${dlResult.imported ?? 0} rows | Running total: ${totalImported} (${elapsed()} elapsed)${moveInfo}${moveErrInfo}${unmappedInfo}${mappedInfo}`);
        } catch (dayErr) {
          dayErrors.push(`${day}: ${dayErr?.message || String(dayErr)}`);
          setConvDatasetStatus(`${dayLabel}: Error, skipping... | Running total: ${totalImported} (${elapsed()} elapsed)`);
          continue;
        }
      }

      const errorSummary = dayErrors.length > 0 ? ` | Errors on ${dayErrors.length} day(s): ${dayErrors.join('; ')}` : '';
      const moveSummary = (totalMovedToSpo > 0 || totalMovedToEmail > 0) ? ` | Auto-moved: ${totalMovedToSpo} → SPO, ${totalMovedToEmail} → Email` : '';
      setConvDatasetStatus(
        `Done! Imported ${totalImported} rows across ${days.length} day(s) (from ${totalCsvRows} total CSV rows). Time: ${elapsed()}.${moveSummary}${errorSummary}`
      );
    } catch (err) {
      setConvDatasetStatus(`Imported ${totalImported} rows before error.`);
      setError(err?.message || String(err));
    } finally {
      setConvDatasetUploading(false);
    }
  };

  // --- Tickets Dataset: day-by-day sync ---
  const handleSyncTicketsDataset = async () => {
    setTicketsUploading(true);
    setError('');
    const startTime = Date.now();
    const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`;

    const days = [];
    const [fy, fm, fd] = ticketsDateFrom.split('-').map(Number);
    const [ty, tm, td] = ticketsDateTo.split('-').map(Number);
    const toNum = ty * 10000 + tm * 100 + td;
    let cy = fy, cm = fm, cd2 = fd;
    while (cy * 10000 + cm * 100 + cd2 <= toNum) {
      days.push(`${cy}-${String(cm).padStart(2,'0')}-${String(cd2).padStart(2,'0')}`);
      cd2++;
      const daysInMonth = new Date(cy, cm, 0).getDate();
      if (cd2 > daysInMonth) { cd2 = 1; cm++; }
      if (cm > 12) { cm = 1; cy++; }
    }

    let totalImported = 0;
    let totalCsvRows = 0;
    let dayErrors = [];

    try {
      for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        const day = days[dayIdx];
        const dayLabel = `Day ${dayIdx + 1}/${days.length} (${day})`;
        const etaStr = dayIdx > 0
          ? (() => {
              const secsPerDay = (Date.now() - startTime) / 1000 / dayIdx;
              const etaSecs = Math.round(secsPerDay * (days.length - dayIdx));
              if (etaSecs < 60) return ` | ETA: ~${etaSecs}s`;
              if (etaSecs < 3600) return ` | ETA: ~${Math.floor(etaSecs / 60)}m ${etaSecs % 60}s`;
              return ` | ETA: ~${Math.floor(etaSecs / 3600)}h ${Math.floor((etaSecs % 3600) / 60)}m`;
            })()
          : '';

        try {
          setTicketsStatus(`${dayLabel}: Enqueuing export... (${elapsed()} elapsed${etaStr})`);
          const enqRes = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'tickets-enqueue', dateFrom: day, dateTo: day })
          });
          const enqResult = await parseJson(enqRes);
          if (!enqResult.success) {
            const errMsg = enqResult.error || 'unknown';
            dayErrors.push(`${day}: enqueue failed – ${errMsg}`);
            if (dayIdx === 0) {
              setTicketsStatus(`FAILED on first day (${day}): ${errMsg}`);
              return;
            }
            continue;
          }
          const jobId = enqResult.jobId;

          let status = enqResult.status || 'pending';
          const isDone = (s) => s === 'complete' || s === 'completed';
          while (!isDone(status) && status !== 'failed') {
            await new Promise(r => setTimeout(r, 5000));
            setTicketsStatus(`${dayLabel}: Waiting for Intercom... status: ${status} (${elapsed()} elapsed${etaStr})`);
            const pollRes = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'ca-poll', jobId })
            });
            const pollResult = await parseJson(pollRes);
            if (!pollResult.success) {
              dayErrors.push(`${day}: poll failed – ${pollResult.error || 'unknown'}`);
              status = 'failed';
              break;
            }
            status = pollResult.status || 'unknown';
          }
          if (status === 'failed') continue;

          setTicketsStatus(`${dayLabel}: Downloading & importing... (${elapsed()} elapsed${etaStr}) | Running total: ${totalImported} rows`);
          const dlRes = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'tickets-download-import', jobId })
          });
          const dlResult = await parseJson(dlRes);
          if (!dlResult.success) {
            const errMsg = dlResult.error || 'unknown';
            dayErrors.push(`${day}: import failed – ${errMsg}`);
            if (dayIdx === 0) {
              const skipped = dlResult.skippedColumns ? ` | Skipped columns: ${dlResult.skippedColumns.join(', ')}` : '';
              setTicketsStatus(`FAILED on first day import (${day}): ${errMsg}${skipped}`);
              return;
            }
            continue;
          }

          totalImported += dlResult.imported ?? 0;
          totalCsvRows += dlResult.totalCsvRows ?? 0;
          const mappedInfo = dlResult.skippedColumns?.length ? ` | Skipped cols: ${dlResult.skippedColumns.join(', ')}` : '';
          setTicketsStatus(`${dayLabel}: Done — ${dlResult.imported ?? 0} rows | Running total: ${totalImported} (${elapsed()} elapsed${etaStr})${mappedInfo}`);
        } catch (dayErr) {
          dayErrors.push(`${day}: ${dayErr?.message || String(dayErr)}`);
          setTicketsStatus(`${dayLabel}: Error, skipping... | Running total: ${totalImported} (${elapsed()} elapsed)`);
          continue;
        }
      }

      const errorSummary = dayErrors.length > 0 ? ` | Errors on ${dayErrors.length} day(s): ${dayErrors.slice(0, 5).join('; ')}${dayErrors.length > 5 ? '...' : ''}` : '';
      setTicketsStatus(
        `Done! Imported ${totalImported} rows across ${days.length} day(s) (from ${totalCsvRows} total CSV rows). Time: ${elapsed()}.${errorSummary}`
      );
    } catch (err) {
      setTicketsStatus(`Imported ${totalImported} rows before error.`);
      setError(err?.message || String(err));
    } finally {
      setTicketsUploading(false);
    }
  };

  // --- SPO Enrich: fetch FRT/ART/AHT per agent from Intercom ---
  const handleSpoEnrich = async (forceAll = false, transfersOnly = false) => {
    setSpoEnriching(true);
    setSpoEnrichStatus(transfersOnly ? 'Starting transfer chat re-enrichment...' : 'Starting enrichment...');
    setError('');
    const startTime = Date.now();
    const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`;
    let totalEnriched = 0;
    let totalProcessed = 0;
    let allErrors = [];
    const MAX_CONSECUTIVE_FAILURES = 5;

    try {
      const parseJson = async (r) => {
        const text = await r.text();
        try { return JSON.parse(text); } catch { return { success: false, error: 'Invalid JSON: ' + text.substring(0, 200) }; }
      };

      let remaining = Infinity;
      let batch = 0;
      let consecutiveFailures = 0;

      while (remaining > 0) {
        batch++;
        const etaStr = totalProcessed > 0 && remaining < Infinity
          ? (() => {
              const secsPerConv = (Date.now() - startTime) / 1000 / totalProcessed;
              const etaSecs = Math.round(secsPerConv * remaining);
              if (etaSecs < 60) return `~${etaSecs}s`;
              if (etaSecs < 3600) return `~${Math.floor(etaSecs / 60)}m ${etaSecs % 60}s`;
              return `~${Math.floor(etaSecs / 3600)}h ${Math.floor((etaSecs % 3600) / 60)}m`;
            })()
          : '';
        setSpoEnrichStatus(`Batch ${batch}: Processing up to 50 conversations (5 parallel)... (${totalEnriched} enriched, ${elapsed()} elapsed${etaStr ? ` | ETA: ${etaStr}` : ''})`);

        let result;
        try {
          const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'spo-enrich', batchSize: 50, force: forceAll, transfersOnly })
          });
          result = await parseJson(resp);
        } catch (fetchErr) {
          consecutiveFailures++;
          const errMsg = fetchErr?.message || String(fetchErr);
          allErrors.push(`Batch ${batch}: ${errMsg}`);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            setSpoEnrichStatus(`Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Enriched ${totalEnriched} so far. Last error: ${errMsg}. Time: ${elapsed()}.`);
            break;
          }
          setSpoEnrichStatus(`Batch ${batch} failed (${errMsg}), retrying... (${totalEnriched} enriched, ${elapsed()} elapsed)`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        if (!result.success && result.enriched === undefined) {
          consecutiveFailures++;
          allErrors.push(`Batch ${batch}: ${result.error || 'unknown'}`);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            setSpoEnrichStatus(`Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive API errors. Enriched ${totalEnriched} so far. Last error: ${result.error || 'unknown'}. Time: ${elapsed()}.`);
            break;
          }
          setSpoEnrichStatus(`Batch ${batch} error: ${result.error || 'unknown'}, retrying... (${totalEnriched} enriched, ${elapsed()} elapsed)`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        consecutiveFailures = 0;
        totalEnriched += result.enriched || 0;
        totalProcessed += result.processed || 0;
        remaining = (result.remaining !== null && result.remaining !== undefined && result.remaining >= 0) ? result.remaining : Infinity;

        if (result.errors && result.errors.length > 0) {
          allErrors = allErrors.concat(result.errors);
        }

        if (result.firstError) {
          allErrors.push(`DB: ${result.firstError}`);
          setSpoEnrichStatus(`Batch ${batch}: ERROR → ${result.firstError} | ${totalEnriched} enriched so far (${elapsed()}) — retrying...`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        if ((result.processed || 0) === 0 && remaining <= 0) {
          break;
        }

        const etaDone = totalProcessed > 0 && remaining > 0
          ? (() => {
              const secsPerConv = (Date.now() - startTime) / 1000 / totalProcessed;
              const etaSecs = Math.round(secsPerConv * remaining);
              if (etaSecs < 60) return `~${etaSecs}s`;
              if (etaSecs < 3600) return `~${Math.floor(etaSecs / 60)}m ${etaSecs % 60}s`;
              return `~${Math.floor(etaSecs / 3600)}h ${Math.floor((etaSecs % 3600) / 60)}m`;
            })()
          : '';
        setSpoEnrichStatus(`Batch ${batch} done: ${result.enriched}/${result.processed} enriched | Total: ${totalEnriched} | ${remaining} remaining | ${elapsed()} elapsed${etaDone ? ` | ETA: ${etaDone}` : ''}`);
      }

      const errSummary = allErrors.length > 0 ? ` | ${allErrors.length} error(s): ${allErrors.slice(0, 5).join('; ')}${allErrors.length > 5 ? '...' : ''}` : '';
      setSpoEnrichStatus(`Done! Enriched ${totalEnriched} conversations across ${batch} batch(es). ${remaining > 0 ? `${remaining} still remaining. ` : ''}Time: ${elapsed()}.${errSummary}`);
    } catch (err) {
      setSpoEnrichStatus(`Enriched ${totalEnriched} before error: ${err?.message || String(err)}. Click the button again to resume.`);
      setError(err?.message || String(err));
    } finally {
      setSpoEnriching(false);
    }
  };


  const handleFrtRecalc = async () => {
    setFrtRecalcing(true);
    setFrtRecalcStatus('Starting FRT recalculation...');
    const startTime = Date.now();
    const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`;
    let totalUpdated = 0;
    let totalProcessed = 0;
    let batch = 0;
    let remaining = Infinity;

    try {
      while (remaining > 0) {
        batch++;
        const etaStr = totalProcessed > 0 && remaining < Infinity
          ? (() => {
              const s = Math.round(((Date.now() - startTime) / 1000 / totalProcessed) * remaining);
              return s < 60 ? `~${s}s` : s < 3600 ? `~${Math.floor(s / 60)}m ${s % 60}s` : `~${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
            })()
          : '';
        setFrtRecalcStatus(`Batch ${batch}: Recalculating FRT... (${totalUpdated} updated, ${elapsed()} elapsed${etaStr ? ` | ETA: ${etaStr}` : ''})`);

        let result;
        try {
          const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'spo-recalc-frt', batchSize: 100 })
          });
          const text = await resp.text();
          try { result = JSON.parse(text); } catch { result = { success: false, error: 'Invalid JSON' }; }
        } catch (fetchErr) {
          setFrtRecalcStatus(`Batch ${batch} failed: ${fetchErr?.message}, retrying... (${totalUpdated} updated, ${elapsed()})`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        if (!result.success && result.updated === undefined) {
          setFrtRecalcStatus(`Batch ${batch} error: ${result.error}, retrying... (${totalUpdated} updated, ${elapsed()})`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        totalUpdated += result.updated || 0;
        totalProcessed += result.processed || 0;
        remaining = (result.remaining !== null && result.remaining !== undefined) ? result.remaining : Infinity;

        if ((result.processed || 0) === 0 && remaining <= 0) break;
      }
      setFrtRecalcStatus(`Done! Updated FRT for ${totalUpdated} rows across ${batch} batch(es). Time: ${elapsed()}.`);
    } catch (err) {
      setFrtRecalcStatus(`Error after ${totalUpdated} updates: ${err?.message || String(err)}`);
    } finally {
      setFrtRecalcing(false);
    }
  };

  const handleUpdateTimestamps = async () => {
    setFrtRecalcing(true);
    setFrtRecalcStatus('Updating conversation timestamps...');
    const startTime = Date.now();
    const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`;
    let totalUpdated = 0;
    let totalProcessed = 0;
    let batch = 0;
    let remaining = Infinity;

    try {
      while (remaining > 0) {
        batch++;
        const etaStr = totalProcessed > 0 && remaining < Infinity
          ? (() => {
              const s = Math.round(((Date.now() - startTime) / 1000 / totalProcessed) * remaining);
              return s < 60 ? `~${s}s` : s < 3600 ? `~${Math.floor(s / 60)}m ${s % 60}s` : `~${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
            })()
          : '';
        setFrtRecalcStatus(`Batch ${batch}: Updating timestamps... (${totalUpdated} updated, ${elapsed()} elapsed${etaStr ? ` | ETA: ${etaStr}` : ''})`);

        let result;
        try {
          const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'spo-recalc-frt', batchSize: 30, updateTimeOnly: true })
          });
          const text = await resp.text();
          try { result = JSON.parse(text); } catch { result = { success: false, error: 'Invalid JSON' }; }
        } catch (fetchErr) {
          setFrtRecalcStatus(`Batch ${batch} failed: ${fetchErr?.message}, retrying... (${totalUpdated} updated, ${elapsed()})`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        if (!result.success && result.updated === undefined) {
          setFrtRecalcStatus(`Batch ${batch} error: ${result.error}, retrying... (${totalUpdated} updated, ${elapsed()})`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        totalUpdated += result.updated || 0;
        totalProcessed += result.processed || 0;
        remaining = (result.remaining !== null && result.remaining !== undefined) ? result.remaining : Infinity;

        if ((result.processed || 0) === 0 && remaining <= 0) break;
      }
      setFrtRecalcStatus(`Done! Updated timestamps for ${totalUpdated} rows across ${batch} batch(es). Time: ${elapsed()}.`);
    } catch (err) {
      setFrtRecalcStatus(`Error after ${totalUpdated} updates: ${err?.message || String(err)}`);
    } finally {
      setFrtRecalcing(false);
    }
  };

  const isProcessing = isFetching || isAnalyzing;

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.6)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        <h2 style={{ color: '#F8FAFC', margin: '0 0 1rem 0', fontSize: '1.25rem' }}>
          ⚙️ Topic Analyzer Admin
        </h2>
        <p style={{ color: '#94A3B8', margin: 0, fontSize: '0.875rem' }}>
          Fetch conversations from Intercom and save to Supabase. Analyze with AI separately.
        </p>
      </div>

      {/* Mode Selector */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '1.5rem'
      }}>
        {['single', 'range'].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={isProcessing}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: mode === m ? 'rgba(37, 99, 235, 0.3)' : 'rgba(255, 255, 255, 0.05)',
              color: mode === m ? '#38BDF8' : '#94A3B8',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              opacity: isProcessing ? 0.6 : 1
            }}
          >
            {m === 'single' ? '🎯 Single Conversation' : '📅 Date Range'}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.4)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        {mode === 'single' ? (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                Conversation ID
              </label>
              <input
                type="text"
                value={conversationId}
                onChange={(e) => setConversationId(e.target.value)}
                placeholder="e.g., 215471991646547"
                disabled={isProcessing}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#F8FAFC',
                  fontSize: '0.875rem',
                  outline: 'none'
                }}
              />
            </div>
            <button
              onClick={handleAnalyzeSingle}
              disabled={isProcessing || !conversationId}
              style={{
                padding: '0.75rem 2rem',
                borderRadius: '8px',
                border: 'none',
                background: isProcessing ? 'rgba(37, 99, 235, 0.3)' : 'linear-gradient(135deg, #2563EB, #7C3AED)',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: isProcessing ? 'wait' : 'pointer'
              }}
            >
              {isFetching ? '⏳ Fetching...' : '🔍 Fetch & Save'}
            </button>
          </div>
        ) : (
          <div>
            {/* Quick date filters */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <span style={{ color: '#94A3B8', fontSize: '0.75rem', alignSelf: 'center', marginRight: '0.25rem' }}>Quick:</span>
              {[
                { key: 'today', label: 'Today' },
                { key: 'yesterday', label: 'Yesterday' },
                { key: '7days', label: 'Last 7 days' }
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setQuickRange(key)}
                  disabled={isProcessing}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#94A3B8',
                    fontSize: '0.8rem',
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Date/Time inputs */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                  From Date
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  disabled={isProcessing}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#F8FAFC',
                    fontSize: '0.875rem',
                    outline: 'none'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                  From Time
                </label>
                <input
                  type="time"
                  value={timeFrom}
                  onChange={(e) => setTimeFrom(e.target.value)}
                  disabled={isProcessing}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#F8FAFC',
                    fontSize: '0.875rem',
                    outline: 'none'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                  To Date
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  disabled={isProcessing}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#F8FAFC',
                    fontSize: '0.875rem',
                    outline: 'none'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                  To Time
                </label>
                <input
                  type="time"
                  value={timeTo}
                  onChange={(e) => setTimeTo(e.target.value)}
                  disabled={isProcessing}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#F8FAFC',
                    fontSize: '0.875rem',
                    outline: 'none'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                  Timezone
                </label>
                <select
                  value={timezoneOffset}
                  onChange={(e) => setTimezoneOffset(Number(e.target.value))}
                  disabled={isProcessing}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#F8FAFC',
                    fontSize: '0.875rem',
                    outline: 'none',
                    minWidth: '200px',
                    cursor: isProcessing ? 'not-allowed' : 'pointer'
                  }}
                >
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <p style={{ color: '#64748B', fontSize: '0.75rem', margin: '0 0 1rem 0' }}>
              From/To date and time are read in the selected timezone ({TIMEZONE_OPTIONS.find(o => o.value === timezoneOffset)?.label ?? 'GMT+0 (UTC)'}). Filter = &quot;Conversation started at&quot; between your From and To. Pull by Chat ID uses existing rows only.
            </p>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                onClick={handleClearTable}
                disabled={isProcessing}
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  background: 'transparent',
                  color: '#F87171',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                🗑️ Clear Intercom Topic
              </button>
              <button
                onClick={handleResetDataKeepIds}
                disabled={isProcessing}
                title="Keep Conversation IDs but clear all other data (Transcript, Product, Email, etc.) so you can re-fetch"
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(251, 191, 36, 0.5)',
                  background: 'transparent',
                  color: '#FBBF24',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                🔄 Reset Data (Keep IDs)
              </button>
              <button
                onClick={handleRemoveOutsideDateRange}
                disabled={isProcessing || !dateFrom || !dateTo}
                title="Delete rows where Conversation started at is outside the selected date range (uses selected timezone)"
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  background: 'transparent',
                  color: '#F87171',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: (isProcessing || !dateFrom || !dateTo) ? 'not-allowed' : 'pointer'
                }}
              >
                🗑️ Remove outside date
              </button>
              <button
                onClick={handleFetchAndSave}
                disabled={isProcessing || !dateFrom || !dateTo}
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: isProcessing ? 'rgba(37, 99, 235, 0.3)' : 'linear-gradient(135deg, #2563EB, #7C3AED)',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                {isFetching ? '⏳ Fetching & Saving...' : '📥 Fetch & Save to Supabase'}
              </button>

              <button
                onClick={handleFetchIdsOnly}
                disabled={isProcessing || !dateFrom || !dateTo}
                title="FAST: Extract only Conversation IDs (no transcript/product data) - use for bulk ID extraction"
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: isProcessing ? 'rgba(16, 185, 129, 0.3)' : 'linear-gradient(135deg, #10B981, #059669)',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: (isProcessing || !dateFrom || !dateTo) ? 'not-allowed' : 'pointer'
                }}
              >
                {isFetching ? '⏳ Extracting IDs...' : '🚀 Fast: IDs Only'}
              </button>

              <button
                onClick={handleEnrichFromSupabase}
                disabled={isProcessing}
                title="Pull full data from Intercom for every Conversation ID already in Supabase"
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(34, 197, 94, 0.5)',
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: '#22C55E',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                📲 Pull data by Chat ID from Supabase
              </button>

              <button
                onClick={handlePopulateMissingData}
                disabled={isProcessing}
                title="Find rows missing CX Score Rating, Assigned Channel ID, Email, Product or Transcript and populate from Intercom"
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(251, 191, 36, 0.5)',
                  background: 'rgba(251, 191, 36, 0.15)',
                  color: '#FBBF24',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                🔧 Check & populate missing data
              </button>

              <button
                onClick={handleAnalyzeUnanalyzed}
                disabled={isProcessing}
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: isProcessing ? 'rgba(124, 58, 237, 0.3)' : 'linear-gradient(135deg, #7C3AED, #6366F1)',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                {isAnalyzing ? '⏳ Analyzing...' : '🤖 Analyze Unanalyzed'}
              </button>

              <button
                onClick={handleTestIntercom}
                disabled={isProcessing}
                title="Test if Intercom API token is working"
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(251, 191, 36, 0.5)',
                  background: 'transparent',
                  color: '#FBBF24',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                🔧 Test Intercom
              </button>

              <button
                onClick={handleListDatasets}
                disabled={isProcessing}
                title="List available datasets from Intercom Reporting Data Export API"
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(16, 185, 129, 0.5)',
                  background: 'transparent',
                  color: '#10B981',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer'
                }}
              >
                📊 List Export Datasets
              </button>

              {isProcessing && (
                <button
                  onClick={handleStop}
                  style={{
                    padding: '0.75rem 2rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #EF4444, #DC2626)',
                    color: '#fff',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  ⏹️ Stop
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Conversation Actions – automatic sync (API: export → download → filter agent-only → Supabase) */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.4)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <h3 style={{ color: '#E2E8F0', margin: '0 0 0.75rem 0', fontSize: '1rem' }}>
          📤 Sync Conversation Actions (automatic)
        </h3>
        <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0 0 1rem 0' }}>
          Fetches <strong>Conversation actions dataset</strong> from Intercom for the date range, excludes actions performed by AI (FundedNext AI), and imports into Supabase <code style={{ color: '#94A3B8' }}>Conversation Actions</code>. No manual export or file upload.
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
          <div>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.25rem' }}>From</label>
            <input
              type="date"
              value={conversationActionsDateFrom}
              onChange={(e) => setConversationActionsDateFrom(e.target.value)}
              disabled={conversationActionsUploading}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#F8FAFC',
                fontSize: '0.875rem'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.25rem' }}>To</label>
            <input
              type="date"
              value={conversationActionsDateTo}
              onChange={(e) => setConversationActionsDateTo(e.target.value)}
              disabled={conversationActionsUploading}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#F8FAFC',
                fontSize: '0.875rem'
              }}
            />
          </div>
          <button
            onClick={handleSyncConversationActions}
            disabled={conversationActionsUploading}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: conversationActionsUploading
                ? 'rgba(55, 65, 81, 0.8)' : 'linear-gradient(135deg, #0EA5E9, #06B6D4)',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: conversationActionsUploading ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-end'
            }}
          >
            {conversationActionsUploading ? '⏳ Syncing...' : '🔄 Sync to Supabase'}
          </button>
        </div>
        {conversationActionsStatus && (
          <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0.75rem 0 0 0' }}>
            {conversationActionsStatus}
          </p>
        )}
      </div>

      {/* Sync Conversation Dataset (Service Performance Overview) */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.4)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <h3 style={{ color: '#E2E8F0', margin: '0 0 0.75rem 0', fontSize: '1rem' }}>
          📊 Sync Conversation Dataset (Service Performance)
        </h3>
        <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0 0 1rem 0' }}>
          Fetches <strong>Conversation dataset</strong> from Intercom for the date range and imports into Supabase <code style={{ color: '#94A3B8' }}>conversation_dataset</code>. No manual export or file upload.
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
          <div>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.25rem' }}>From</label>
            <input
              type="date"
              value={convDatasetDateFrom}
              onChange={(e) => setConvDatasetDateFrom(e.target.value)}
              disabled={convDatasetUploading}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#F8FAFC',
                fontSize: '0.875rem'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.25rem' }}>To</label>
            <input
              type="date"
              value={convDatasetDateTo}
              onChange={(e) => setConvDatasetDateTo(e.target.value)}
              disabled={convDatasetUploading}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#F8FAFC',
                fontSize: '0.875rem'
              }}
            />
          </div>
          <button
            onClick={handleSyncConversationDataset}
            disabled={convDatasetUploading}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: convDatasetUploading
                ? 'rgba(55, 65, 81, 0.8)' : 'linear-gradient(135deg, #8B5CF6, #A78BFA)',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: convDatasetUploading ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-end'
            }}
          >
            {convDatasetUploading ? '⏳ Syncing...' : '📊 Sync to Supabase'}
          </button>
        </div>
        {convDatasetStatus && (
          <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0.75rem 0 0 0' }}>
            {convDatasetStatus}
          </p>
        )}
      </div>

      {/* Sync Tickets Dataset */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.4)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <h3 style={{ color: '#E2E8F0', margin: '0 0 0.75rem 0', fontSize: '1rem' }}>
          🎫 Sync Tickets Dataset
        </h3>
        <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0 0 1rem 0' }}>
          Fetches <strong>Tickets dataset</strong> from Intercom for the date range and imports into Supabase <code style={{ color: '#94A3B8' }}>tickets_dataset</code>. Day-by-day processing with Dhaka timezone (GMT+6).
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
          <label style={{ color: '#94A3B8', fontSize: '0.8125rem' }}>From
            <input
              type="date"
              value={ticketsDateFrom}
              onChange={(e) => setTicketsDateFrom(e.target.value)}
              disabled={ticketsUploading}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#E2E8F0',
                marginLeft: '0.5rem',
                fontSize: '0.875rem'
              }}
            />
          </label>
          <label style={{ color: '#94A3B8', fontSize: '0.8125rem' }}>To
            <input
              type="date"
              value={ticketsDateTo}
              onChange={(e) => setTicketsDateTo(e.target.value)}
              disabled={ticketsUploading}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#E2E8F0',
                marginLeft: '0.5rem',
                fontSize: '0.875rem'
              }}
            />
          </label>
          <button
            onClick={handleSyncTicketsDataset}
            disabled={ticketsUploading}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: ticketsUploading
                ? 'rgba(55, 65, 81, 0.8)' : 'linear-gradient(135deg, #F59E0B, #D97706)',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: ticketsUploading ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-end'
            }}
          >
            {ticketsUploading ? '⏳ Syncing...' : '🎫 Sync Tickets'}
          </button>
        </div>
        {ticketsStatus && (
          <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0.75rem 0 0 0' }}>
            {ticketsStatus}
          </p>
        )}
      </div>

      {/* Enrich Service Performance (FRT/ART/AHT per agent) */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.4)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <h3 style={{ color: '#E2E8F0', margin: '0 0 0.75rem 0', fontSize: '1rem' }}>
          ⚡ Enrich Service Performance (FRT / ART / AHT)
        </h3>
        <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0 0 1rem 0' }}>
          Reads conversation IDs from <code style={{ color: '#94A3B8' }}>Service Performance Overview</code> where FRT is NULL, fetches full conversation details from Intercom, calculates <strong>FRT, ART, AHT, Wait Time per agent</strong>, and creates separate rows per agent with <code style={{ color: '#94A3B8' }}>action_performed_by</code>.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              setSpoEnrichStatus('Checking...');
              try {
                const resp = await fetch(API_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'spo-enrich-count' })
                });
                const r = await resp.json();
                if (r.success) {
                  const estSecs = Math.round(r.pending_frt * 0.4);
                  const fmtTime = (s) => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
                  setSpoEnrichStatus(`Total: ${r.total.toLocaleString()} rows | Enriched: ${r.enriched.toLocaleString()} | Pending FRT: ${r.pending_frt.toLocaleString()} (est. ${fmtTime(estSecs)}) | Pending Transcript: ${r.pending_transcript.toLocaleString()} | Pending Reopened: ${r.pending_reopened.toLocaleString()}`);
                } else {
                  setSpoEnrichStatus(`Error: ${r.error}`);
                }
              } catch (e) {
                setSpoEnrichStatus(`Error: ${e.message}`);
              }
            }}
            disabled={spoEnriching}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #0EA5E9, #0284C7)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem'
            }}
          >
            📊 Check Remaining
          </button>
          <button
            onClick={() => handleSpoEnrich(false)}
            disabled={spoEnriching}
            style={{
              padding: '0.75rem 1.5rem',
              background: spoEnriching ? '#475569' : 'linear-gradient(135deg, #F59E0B, #D97706)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: spoEnriching ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem'
            }}
          >
            {spoEnriching ? '⏳ Enriching...' : '⚡ Enrich New'}
          </button>
        </div>
        {spoEnrichStatus && (
          <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0.75rem 0 0 0' }}>
            {spoEnrichStatus}
          </p>
        )}
      </div>


      {/* Sync FIN Conversations (via Supabase Edge Function) */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.4)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <h3 style={{ color: '#E2E8F0', margin: '0 0 0.75rem 0', fontSize: '1rem' }}>
          🤖 Sync FIN Conversations
        </h3>
        <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0 0 1rem 0' }}>
          Uses the Intercom <strong>Reporting Data Export API</strong> to find conversations where <code style={{ color: '#94A3B8' }}>fin_ai_agent_participated = true</code>, then copies matching rows from SPO to the <code style={{ color: '#94A3B8' }}>FIN - Service Performance Overview</code> table. Day-by-day processing in Dhaka timezone (GMT+6).
        </p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
          <label style={{ color: '#94A3B8', fontSize: '0.8125rem' }}>From
            <input
              type="date"
              value={finSyncDateFrom}
              onChange={(e) => setFinSyncDateFrom(e.target.value)}
              disabled={finSyncRunning}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#E2E8F0',
                marginLeft: '0.5rem',
                fontSize: '0.875rem'
              }}
            />
          </label>
          <label style={{ color: '#94A3B8', fontSize: '0.8125rem' }}>To
            <input
              type="date"
              value={finSyncDateTo}
              onChange={(e) => setFinSyncDateTo(e.target.value)}
              disabled={finSyncRunning}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#E2E8F0',
                marginLeft: '0.5rem',
                fontSize: '0.875rem'
              }}
            />
          </label>
          <button
            onClick={async () => {
              if (finSyncRunning) return;
              setFinSyncRunning(true);
              setFinSyncStatus('');

              const FN_URL = 'https://iktqpjwoahqycvlmstvx.supabase.co/functions/v1/sync-fin-conversations';
              const INTERCOM_TOKEN = 'dG9rOmY5Y2U4NzdiXzk5NTFfNDQwN19hYjgzXzkxYjI4MWQyMmQ3MDoxOjA=';

              // Process day-by-day in Dhaka timezone (GMT+6)
              // Edge Function expects: action, start_date (YYYY-MM-DD), end_date, tz_offset, job_id
              const fromParts = finSyncDateFrom.split('-').map(Number);
              const toParts = finSyncDateTo.split('-').map(Number);
              const startDate = new Date(Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]));
              const endDate = new Date(Date.UTC(toParts[0], toParts[1] - 1, toParts[2]));
              let totalSynced = 0;
              let totalFinConvs = 0;
              let dayErrors = [];
              const authToken = (await supabase.auth.getSession()).data.session?.access_token;

              try {
                for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
                  const dayLabel = d.toISOString().split('T')[0]; // YYYY-MM-DD
                  setFinSyncStatus(`[${dayLabel}] Step 1/3: Enqueuing export...`);

                  // Step 1: Enqueue (Edge Function handles timezone conversion)
                  const enqResp = await fetch(FN_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ action: 'enqueue', start_date: dayLabel, end_date: dayLabel, tz_offset: 6, intercom_token: INTERCOM_TOKEN })
                  });
                  const enqData = await enqResp.json();
                  const jobId = enqData.result?.job_identifier;
                  if (!enqResp.ok || !jobId) {
                    dayErrors.push(`${dayLabel}: enqueue failed – ${enqData.error || JSON.stringify(enqData)}`);
                    continue;
                  }

                  // Step 2: Poll status
                  setFinSyncStatus(`[${dayLabel}] Step 2/3: Waiting for export (job: ${jobId})...`);
                  let ready = false;
                  for (let attempt = 0; attempt < 60; attempt++) {
                    await new Promise(r => setTimeout(r, 5000));
                    const stResp = await fetch(FN_URL, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                      body: JSON.stringify({ action: 'status', job_id: jobId, intercom_token: INTERCOM_TOKEN })
                    });
                    const stData = await stResp.json();
                    const st = stData.result?.status || stData.result?.job_status || '';
                    if (st === 'complete' || stData.result?.download_url) { ready = true; break; }
                    if (st === 'failed') { dayErrors.push(`${dayLabel}: export failed`); break; }
                    setFinSyncStatus(`[${dayLabel}] Step 2/3: Export ${st || 'pending'}... (${attempt + 1})`);
                  }
                  if (!ready) { if (!dayErrors.find(e => e.startsWith(dayLabel))) dayErrors.push(`${dayLabel}: export timed out`); continue; }

                  // Step 2.5: Delete existing FIN rows for this day (Dhaka: day midnight = UTC day-1 18:00)
                  const dhakaStartUTC = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 6 * 3600000).toISOString();
                  const dhakaEndUTC = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - 6 * 3600000).toISOString();
                  setFinSyncStatus(`[${dayLabel}] Clearing existing FIN rows for this day...`);
                  const { error: delErr, count: delCount } = await supabase
                    .from('FIN - Service Performance Overview')
                    .delete({ count: 'exact' })
                    .gte('created_at', dhakaStartUTC)
                    .lt('created_at', dhakaEndUTC);
                  if (delErr) {
                    dayErrors.push(`${dayLabel}: FIN delete failed – ${delErr.message}`);
                    continue;
                  }
                  setFinSyncStatus(`[${dayLabel}] Cleared ${delCount ?? 0} existing FIN rows. Step 3/3: Downloading & syncing...`);

                  // Step 3: Download & sync
                  setFinSyncStatus(`[${dayLabel}] Step 3/3: Downloading & syncing to FIN table...`);
                  const dlResp = await fetch(FN_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ action: 'download_and_sync', job_id: jobId, intercom_token: INTERCOM_TOKEN, mode: 'copy_from_spo' })
                  });
                  const dlData = await dlResp.json();
                  if (!dlResp.ok) {
                    dayErrors.push(`${dayLabel}: sync failed – ${dlData.error || JSON.stringify(dlData)}`);
                    continue;
                  }
                  const res = dlData.result || dlData;
                  totalSynced += res.synced || 0;
                  totalFinConvs += res.fin_participated || 0;
                  setFinSyncStatus(`[${dayLabel}] Done — ${res.synced || 0} rows synced (${res.fin_participated || 0} FIN convs found). Running total: ${totalSynced}`);
                }

                const summary = `Finished! ${totalSynced} total rows synced to FIN table (${totalFinConvs} FIN conversations found).`;
                setFinSyncStatus(dayErrors.length > 0 ? `${summary} Errors: ${dayErrors.join('; ')}` : summary);
              } catch (e) {
                setFinSyncStatus(`Error: ${e.message}`);
              } finally {
                setFinSyncRunning(false);
              }
            }}
            disabled={finSyncRunning}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: finSyncRunning
                ? 'rgba(55, 65, 81, 0.8)' : 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: finSyncRunning ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-end'
            }}
          >
            {finSyncRunning ? '⏳ Syncing FIN...' : '🤖 Sync FIN'}
          </button>
        </div>
        {finSyncStatus && (
          <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0.75rem 0 0 0', whiteSpace: 'pre-wrap' }}>
            {finSyncStatus}
          </p>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1.5rem',
          color: '#F87171'
        }}>
          ❌ {error}
        </div>
      )}

      {/* Progress Display */}
      {(isFetching || isAnalyzing || progress.saved > 0 || progress.analyzed > 0) && (
        <div style={{
          background: 'rgba(30, 41, 59, 0.5)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <h3 style={{ color: '#F8FAFC', margin: '0 0 1rem 0', fontSize: '1rem' }}>
            📊 Progress
          </h3>
          
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            {/* Fetch Progress */}
            {(isFetching || progress.fetched > 0) && (
              <>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Intercom returned (raw)</div>
                  <div style={{ color: '#64748B', fontSize: '1.25rem', fontWeight: '600' }}>
                    {progress.totalAvailable.toLocaleString()}
                  </div>
                  <div style={{ color: '#64748B', fontSize: '0.65rem', marginTop: '0.125rem' }}>May include extra; we filter below</div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>In your date range ({TIMEZONE_OPTIONS.find(o => o.value === timezoneOffset)?.label || 'GMT+0'})</div>
                  <div style={{ color: '#A78BFA', fontSize: '1.5rem', fontWeight: '700' }}>
                    {progress.fetched.toLocaleString()}
                  </div>
                  <div style={{ color: '#64748B', fontSize: '0.65rem', marginTop: '0.125rem' }}>Conversation started at = matches export</div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Saved to Supabase</div>
                  <div style={{ color: '#22C55E', fontSize: '1.5rem', fontWeight: '700' }}>
                    {progress.saved.toLocaleString()}
                  </div>
                </div>
                {(isFetching || progress.currentPage > 0) && (
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Page</div>
                    <div style={{ color: '#FBBF24', fontSize: '1.5rem', fontWeight: '700' }}>
                      {progress.currentPage}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Analyze Progress */}
            {(isAnalyzing || progress.analyzed > 0) && (
              <>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>To Analyze</div>
                  <div style={{ color: '#38BDF8', fontSize: '1.5rem', fontWeight: '700' }}>
                    {progress.toAnalyze.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Analyzed</div>
                  <div style={{ color: '#22C55E', fontSize: '1.5rem', fontWeight: '700' }}>
                    {progress.analyzed.toLocaleString()}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Progress bar */}
          {(isFetching || isAnalyzing) && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{
                width: '100%',
                height: '8px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: isFetching 
                    ? (progress.totalAvailable > 0 ? `${Math.min(100, (progress.fetched / progress.totalAvailable) * 100)}%` : '0%')
                    : (progress.toAnalyze > 0 ? `${(progress.analyzed / progress.toAnalyze) * 100}%` : '0%'),
                  height: '100%',
                  background: 'linear-gradient(135deg, #22C55E, #16A34A)',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

          {/* Status message */}
          <div style={{ marginTop: '1rem', color: '#94A3B8', fontSize: '0.875rem' }}>
            {progress.status || (
              isAnalyzing 
                ? `Analyzing conversation ${progress.analyzed} of ${progress.toAnalyze}...`
                : null
            )}
          </div>
        </div>
      )}

      {/* CSAT Automation */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.4)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <h3 style={{ color: '#E2E8F0', margin: '0 0 0.75rem 0', fontSize: '1rem' }}>
          🎯 CSAT Sub-Category Classification
        </h3>
        <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0 0 1rem 0' }}>
          Reads rows from <code style={{ color: '#94A3B8' }}>CSAT New</code> where <strong>Conversation rating &lt; 4</strong> and both <strong>Category</strong> and <strong>Sub-category</strong> are empty,
          fetches each conversation from Intercom, classifies the sub-category using AI, and writes back to the table.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={async () => {
              // Count pending
              setCsatStatus('Counting pending rows...');
              try {
                const { data, error } = await supabase
                  .from('CSAT New')
                  .select('"Conversation ID","Conversation rating","Concern regarding product (Catagory)","Concern regarding product (Sub-catagory)"')
                  .lt('Conversation rating', 4)
                  .not('Conversation ID', 'is', null)
                  .limit(50000);
                if (error) { setCsatStatus(`Error: ${error.message}`); return; }
                const pending = (data || []).filter(r =>
                  !r['Concern regarding product (Catagory)'] && !r['Concern regarding product (Sub-catagory)']
                );
                setCsatStatus(`${pending.length.toLocaleString()} rows pending classification (out of ${(data || []).length.toLocaleString()} with rating < 4)`);
              } catch (e) {
                setCsatStatus(`Error: ${e.message}`);
              }
            }}
            disabled={csatRunning}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #0EA5E9, #0284C7)',
              color: '#fff', border: 'none', borderRadius: '8px',
              cursor: csatRunning ? 'not-allowed' : 'pointer',
              opacity: csatRunning ? 0.5 : 1, fontSize: '0.875rem', fontWeight: '600'
            }}
          >
            📊 Check Pending
          </button>
          <button
            onClick={async () => {
              if (csatRunning) return;
              setCsatRunning(true);
              csatStopRef.current = false;
              setCsatStatus('Fetching pending rows...');
              setCsatProgress({ total: 0, done: 0, errors: 0 });

              try {
                // Fetch rows: rating < 4, then filter client-side for null category & sub-category
                const { data: allRows, error } = await supabase
                  .from('CSAT New')
                  .select('"Conversation ID","Conversation rating","Concern regarding product (Catagory)","Concern regarding product (Sub-catagory)"')
                  .lt('Conversation rating', 4)
                  .not('Conversation ID', 'is', null)
                  .limit(50000);
                const rows = (allRows || []).filter(r =>
                  !r['Concern regarding product (Catagory)'] && !r['Concern regarding product (Sub-catagory)']
                );

                if (error) { setCsatStatus(`Error: ${error.message}`); setCsatRunning(false); return; }
                if (!rows || rows.length === 0) { setCsatStatus('No pending rows found.'); setCsatRunning(false); return; }

                const total = rows.length;
                setCsatProgress({ total, done: 0, errors: 0 });
                setCsatStatus(`Processing ${total.toLocaleString()} conversations...`);

                let done = 0, errors = 0;

                for (const row of rows) {
                  if (csatStopRef.current) { setCsatStatus(`Stopped. ${done} done, ${errors} errors.`); break; }

                  const convId = row['Conversation ID'];
                  try {
                    // Call API to classify
                    const resp = await fetch(API_URL, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'csat-classify', conversationId: String(convId) })
                    });
                    const result = await parseJson(resp);

                    if (result.success && result.subCategory) {
                      // Write back to CSAT New
                      const { error: updateError } = await supabase
                        .from('CSAT New')
                        .update({ 'Concern regarding product (Sub-catagory)': result.subCategory })
                        .eq('Conversation ID', convId);

                      if (updateError) {
                        console.error(`Update error for ${convId}:`, updateError);
                        errors++;
                      } else {
                        done++;
                      }
                    } else {
                      // Mark as "None" so we don't re-process
                      await supabase
                        .from('CSAT New')
                        .update({ 'Concern regarding product (Sub-catagory)': 'None' })
                        .eq('Conversation ID', convId);
                      done++;
                    }
                  } catch (e) {
                    console.error(`Error processing ${convId}:`, e);
                    errors++;
                  }

                  setCsatProgress({ total, done: done + errors, errors });
                  if ((done + errors) % 5 === 0 || done + errors === total) {
                    setCsatStatus(`Processing... ${done + errors}/${total} (${errors} errors)`);
                  }

                  // Small delay to avoid rate limits
                  await new Promise(r => setTimeout(r, 500));
                }

                setCsatStatus(`Done! ${done} classified, ${errors} errors out of ${total}.`);
              } catch (e) {
                setCsatStatus(`Error: ${e.message}`);
              } finally {
                setCsatRunning(false);
              }
            }}
            disabled={csatRunning}
            style={{
              padding: '0.75rem 1.5rem',
              background: csatRunning ? '#475569' : 'linear-gradient(135deg, #F59E0B, #D97706)',
              color: '#fff', border: 'none', borderRadius: '8px',
              cursor: csatRunning ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem', fontWeight: '600'
            }}
          >
            {csatRunning ? '⏳ Classifying...' : '🚀 Run Classification'}
          </button>
          {csatRunning && (
            <button
              onClick={() => { csatStopRef.current = true; }}
              style={{
                padding: '0.75rem 1.5rem',
                background: 'linear-gradient(135deg, #EF4444, #DC2626)',
                color: '#fff', border: 'none', borderRadius: '8px',
                cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600'
              }}
            >
              ⏹ Stop
            </button>
          )}
        </div>
        {/* Progress */}
        {(csatProgress.total > 0) && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{
              width: '100%', height: '8px',
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '4px', overflow: 'hidden'
            }}>
              <div style={{
                width: `${csatProgress.total > 0 ? (csatProgress.done / csatProgress.total * 100) : 0}%`,
                height: '100%',
                background: 'linear-gradient(135deg, #22C55E, #16A34A)',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <div style={{ color: '#94A3B8', fontSize: '0.8125rem', marginTop: '0.5rem' }}>
              {csatProgress.done} / {csatProgress.total} ({csatProgress.errors} errors)
            </div>
          </div>
        )}
        {csatStatus && (
          <p style={{ color: '#94A3B8', fontSize: '0.8125rem', margin: '0.75rem 0 0 0' }}>
            {csatStatus}
          </p>
        )}
      </div>

      {/* Info box */}
      <div style={{
        marginTop: '1.5rem',
        padding: '1rem',
        background: 'rgba(37, 99, 235, 0.1)',
        border: '1px solid rgba(37, 99, 235, 0.2)',
        borderRadius: '8px'
      }}>
        <div style={{ color: '#38BDF8', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
          ℹ️ How it works
        </div>
        <ul style={{ color: '#94A3B8', fontSize: '0.8rem', margin: 0, paddingLeft: '1.25rem' }}>
          <li><strong>Clear Intercom Topic:</strong> Deletes all existing rows (optional – do this first for a fresh run)</li>
          <li><strong>Reset Data (Keep IDs):</strong> Clears Transcript, Product, Email, Region, etc. but keeps Conversation IDs. Use this to re-fetch data with updated logic</li>
          <li><strong>Remove outside date:</strong> Deletes rows where &quot;Conversation started at&quot; is not within the selected From–To date (GMT+0). Use after a run to drop any conversations that slipped in</li>
          <li><strong>Fetch & Save:</strong> Uses the date/time range above. Phase 1 – pulls 150 Conversation IDs per page from Intercom and saves only ID + created_at. Phase 2 – for each row, pulls full data from Intercom and updates the row</li>
          <li><strong>Fast: IDs Only:</strong> Extracts ONLY Conversation IDs (no transcript/product). Fast bulk extraction with rate limit handling. Use "Check & populate" after to enrich.</li>
          <li><strong>Pull data by Chat ID from Supabase:</strong> No date range. Reads all Conversation IDs from Supabase and for each pulls full data from Intercom, then updates the row</li>
          <li><strong>Check & populate missing data:</strong> Finds rows where CX Score Rating, Assigned Channel ID, Email, Product or Transcript is empty, then fetches full data from Intercom for only those rows and updates them</li>
          <li><strong>Analyze Unanalyzed:</strong> Finds rows with empty Main-Topics and runs AI analysis</li>
          <li><strong>List Export Datasets:</strong> Shows available datasets from Intercom Reporting Data Export API</li>
          <li><strong>Stop:</strong> Safely stops the current operation after the current item completes</li>
        </ul>
      </div>

      {/* Datasets Display */}
      {showDatasets && (
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ color: '#10B981', margin: 0 }}>📊 Available Reporting Datasets</h3>
            <button
              onClick={() => setShowDatasets(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                fontSize: '1.2rem',
                cursor: 'pointer'
              }}
            >
              ✕
            </button>
          </div>
          
          {!datasets ? (
            <p style={{ color: '#94A3B8' }}>Loading...</p>
          ) : (
            <div style={{ maxHeight: '400px', overflow: 'auto' }}>
              <pre style={{
                background: 'rgba(0,0,0,0.3)',
                padding: '1rem',
                borderRadius: '6px',
                color: '#E2E8F0',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {JSON.stringify(datasets, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TopicAnalyzerAdmin;
