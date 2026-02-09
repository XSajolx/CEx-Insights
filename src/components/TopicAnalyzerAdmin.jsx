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
  
  // Progress states
  const [isFetching, setIsFetching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [datasets, setDatasets] = useState(null); // For Reporting Data Export datasets
  const [showDatasets, setShowDatasets] = useState(false);
  
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
  const insertIdsBatch = async (records) => {
    if (!records || records.length === 0) return { inserted: 0, errors: 0 };
    const { data, error } = await supabase
      .from('Intercom Topic')
      .insert(records)
      .select();
    if (error) {
      console.error('Supabase insert error:', error);
      return { inserted: 0, errors: records.length };
    }
    return { inserted: data?.length ?? records.length, errors: 0 };
  };

  // Update row by Conversation ID with full data (Phase 2)
  // Writes to both "CX Score Rating" and "Conversation Rating" so either column name in Supabase gets the value
  const updateRowInSupabase = async (convId, fullRecord) => {
    const rating = fullRecord['CX Score Rating'] ?? fullRecord['Conversation Rating'];
    const payload = {
      created_at: fullRecord['created_at'],
      Email: fullRecord['Email'],
      Transcript: fullRecord['Transcript'],
      'User ID': fullRecord['User ID'],
      Country: fullRecord['Country'],
      Region: fullRecord['Region'],
      'Assigned Channel ID': fullRecord['Assigned Channel ID'],
      Product: fullRecord['Product'] ?? null
    };
    if (rating != null && String(rating).trim() !== '') {
      payload['Conversation Rating'] = String(rating);
    }
    
    // Debug: log what we're trying to update
    console.log('Updating convId:', convId, 'with payload:', JSON.stringify(payload, null, 2));
    
    // Use .select() to verify the update actually affected rows
    // Column names with spaces need to be quoted in Supabase
    const { data, error } = await supabase
      .from('Intercom Topic')
      .update(payload)
      .eq('"Conversation ID"', convId)
      .select();
    
    if (error) {
      console.error('Supabase update error:', error);
      return false;
    }
    
    // Check if any rows were actually updated
    if (!data || data.length === 0) {
      console.error('No rows matched for Conversation ID:', convId);
      return false;
    }
    
    console.log('Updated', data.length, 'row(s) for', convId);
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
      // Get all rows with missing data upfront
      const { data: allMissing, error: countErr } = await supabase
        .from('Intercom Topic')
        .select('"Conversation ID"')
        .or('Email.is.null,Transcript.is.null,Product.is.null,Region.is.null,"Conversation Rating".is.null');

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
        
        if (pageRecords.length === 0) break;

        setProgress(prev => ({ 
          ...prev, 
          totalAvailable,
          fetched: totalIdsSaved + pageRecords.length,
          status: `💾 Phase 1 – Saving ${pageRecords.length} IDs to Supabase...`
        }));

        const { inserted } = await insertIdsBatch(pageRecords);
        totalIdsSaved += inserted;
        setProgress(prev => ({ ...prev, saved: totalIdsSaved }));

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
            </div>

            <p style={{ color: '#64748B', fontSize: '0.75rem', margin: '0 0 1rem 0' }}>
              Time period above is used when fetching from Intercom (Fetch & Save). Pull by Chat ID uses existing rows only.
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
                title="Find rows missing Email, Transcript, Product, Region or CX Score Rating and populate from Intercom"
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
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Total Available</div>
                  <div style={{ color: '#38BDF8', fontSize: '1.5rem', fontWeight: '700' }}>
                    {progress.totalAvailable.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Fetched</div>
                  <div style={{ color: '#A78BFA', fontSize: '1.5rem', fontWeight: '700' }}>
                    {progress.fetched.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Saved to Supabase</div>
                  <div style={{ color: '#22C55E', fontSize: '1.5rem', fontWeight: '700' }}>
                    {progress.saved.toLocaleString()}
                  </div>
                </div>
                {isFetching && (
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Current Page</div>
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
                    ? (progress.totalAvailable > 0 ? `${(progress.fetched / progress.totalAvailable) * 100}%` : '0%')
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
          <li><strong>Fetch & Save:</strong> Uses the date/time range above. Phase 1 – pulls 150 Conversation IDs per page from Intercom and saves only ID + created_at. Phase 2 – for each row, pulls full data from Intercom and updates the row</li>
          <li><strong>Pull data by Chat ID from Supabase:</strong> No date range. Reads all Conversation IDs from Supabase and for each pulls full data from Intercom, then updates the row</li>
          <li><strong>Check & populate missing data:</strong> Finds rows where Email, Transcript, Product, Region or CX Score Rating is empty, then fetches full data from Intercom for only those rows and updates them</li>
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
