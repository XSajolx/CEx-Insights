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
  
  // Progress tracking
  const [progress, setProgress] = useState({
    totalAvailable: 0,
    fetched: 0,
    saved: 0,
    currentPage: 0,
    analyzed: 0,
    toAnalyze: 0
  });
  
  // Stop flag using ref (persists across renders without causing re-render)
  const stopRequestedRef = useRef(false);
  
  // API URL
  const API_URL = '/api/analyze-topics';

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

  // Save a batch of records to Supabase
  const saveBatchToSupabase = async (records) => {
    let savedCount = 0;
    for (const record of records) {
      if (stopRequestedRef.current) break;
      
      try {
        // Check if exists
        const { data: existing } = await supabase
          .from('Intercom Topic')
          .select('Conversation ID')
          .eq('Conversation ID', record['Conversation ID'])
          .limit(1);

        if (existing && existing.length > 0) {
          // Update
          const { error } = await supabase
            .from('Intercom Topic')
            .update(record)
            .eq('Conversation ID', record['Conversation ID']);
          if (!error) savedCount++;
        } else {
          // Insert
          const { error } = await supabase
            .from('Intercom Topic')
            .insert(record);
          if (!error) savedCount++;
        }
      } catch (err) {
        console.error('Save error:', err);
      }
    }
    return savedCount;
  };

  // Main fetch and save function
  const handleFetchAndSave = async () => {
    if (!dateFrom || !dateTo) {
      setError('Please select a date range');
      return;
    }

    setIsFetching(true);
    setError('');
    stopRequestedRef.current = false;
    setProgress({ totalAvailable: 0, fetched: 0, saved: 0, currentPage: 0, analyzed: 0, toAnalyze: 0 });

    let startingAfter = null;
    let pageNum = 0;
    let totalFetched = 0;
    let totalSaved = 0;
    let totalAvailable = 0;

    try {
      while (!stopRequestedRef.current) {
        pageNum++;
        setProgress(prev => ({ ...prev, currentPage: pageNum }));

        // Fetch one page from Intercom
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'fetch-page',
            dateFrom,
            dateTo,
            timeFrom,
            timeTo,
            startingAfter
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Failed to fetch page');
        }

        const data = await response.json();
        totalAvailable = data.totalCount || totalAvailable;
        
        if (!data.data || data.data.length === 0) {
          break;
        }

        totalFetched += data.data.length;
        setProgress(prev => ({ 
          ...prev, 
          totalAvailable, 
          fetched: totalFetched 
        }));

        // Save this batch to Supabase immediately
        const savedCount = await saveBatchToSupabase(data.data);
        totalSaved += savedCount;
        setProgress(prev => ({ ...prev, saved: totalSaved }));

        // Check if there are more pages
        if (!data.hasMore || !data.nextStartingAfter) {
          break;
        }
        startingAfter = data.nextStartingAfter;
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err.message);
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
      // Records where AI Analyzed is false or Main-Topics is empty
      const { data: unanalyzed, error: fetchError } = await supabase
        .from('Intercom Topic')
        .select('*')
        .or('AI Analyzed.is.null,AI Analyzed.eq.false')
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
            const result = await response.json();
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
                  'Was it in client\'s favor?': result.data['Was it in client\'s favor?'],
                  'AI Analyzed': true
                })
                .eq('Conversation ID', convId);
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

      const data = await response.json();
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

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
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
            {isFetching && `Fetching page ${progress.currentPage}... (150 conversations per page)`}
            {isAnalyzing && `Analyzing conversation ${progress.analyzed} of ${progress.toAnalyze}...`}
            {!isProcessing && progress.saved > 0 && `✅ Complete! ${progress.saved} conversations saved to Supabase.`}
            {!isProcessing && progress.analyzed > 0 && progress.saved === 0 && `✅ Complete! ${progress.analyzed} conversations analyzed.`}
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
          <li><strong>Fetch & Save:</strong> Pulls 150 conversations per page from Intercom and saves directly to Supabase (no AI analysis)</li>
          <li><strong>Analyze Unanalyzed:</strong> Finds conversations in Supabase without AI analysis and processes them one by one</li>
          <li><strong>Stop:</strong> Safely stops the current operation after the current item completes</li>
        </ul>
      </div>
    </div>
  );
};

export default TopicAnalyzerAdmin;
