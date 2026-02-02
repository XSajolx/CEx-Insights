import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';

const TopicAnalyzerAdmin = () => {
  const [mode, setMode] = useState('single'); // 'single' or 'range'
  const [conversationId, setConversationId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('00:00');
  const [timeTo, setTimeTo] = useState('23:59');
  const [limit, setLimit] = useState(50);
  const [skipAI, setSkipAI] = useState(false);

  // Quick date filters: Today, Yesterday, Last 7 days (full days 00:00–23:59)
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
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedIds, setSavedIds] = useState(new Set());

  // Always use relative URL - works in both dev and prod
  const API_URL = '/api/analyze-topics';

  const handleAnalyze = async () => {
    setLoading(true);
    setError('');
    setResults([]);
    setSavedIds(new Set());

    try {
      const body = mode === 'single' 
        ? { action: 'fetch-single', conversationId }
        : { action: 'fetch-range', dateFrom, dateTo, timeFrom, timeTo, limit, skipAI };

      console.log('Sending request to:', API_URL, body);

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      console.log('Response status:', response.status);

      // Get response text first to debug
      const responseText = await response.text();
      console.log('Response text:', responseText);

      if (!responseText) {
        throw new Error('Empty response from server. Check if environment variables are set in Vercel.');
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      if (mode === 'single') {
        setResults([data.data]);
      } else {
        setResults(data.data || []);
      }
    } catch (err) {
      console.error('Analyze error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToSupabase = async (record) => {
    setSaving(true);
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
        
        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('Intercom Topic')
          .insert(record);
        
        if (error) throw error;
      }

      setSavedIds(prev => new Set([...prev, record['Conversation ID']]));
    } catch (err) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    for (const record of results) {
      if (!savedIds.has(record['Conversation ID'])) {
        await handleSaveToSupabase(record);
      }
    }
    setSaving(false);
  };

  const getSentimentColor = (sentiment) => {
    const colors = {
      'Very Positive': '#22C55E',
      'Positive': '#4ADE80',
      'Neutral': '#94A3B8',
      'Negative': '#F87171',
      'Very Negative': '#EF4444'
    };
    return colors[sentiment] || '#94A3B8';
  };

  const getResolutionBadge = (outcome) => {
    const styles = {
      'Yes': { bg: 'rgba(34, 197, 94, 0.2)', color: '#22C55E', text: '✓ Resolved' },
      'No': { bg: 'rgba(239, 68, 68, 0.2)', color: '#EF4444', text: '✗ Not Resolved' },
      'Pending': { bg: 'rgba(251, 191, 36, 0.2)', color: '#FBBF24', text: '⏳ Pending' }
    };
    return styles[outcome] || styles['Pending'];
  };

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
          🔍 Topic Analyzer Admin
        </h2>
        <p style={{ color: '#94A3B8', margin: 0, fontSize: '0.875rem' }}>
          Fetch conversations from Intercom, analyze with AI, and save to Supabase
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
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: mode === m ? 'rgba(37, 99, 235, 0.3)' : 'rgba(255, 255, 255, 0.05)',
              color: mode === m ? '#38BDF8' : '#94A3B8',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
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
              onClick={handleAnalyze}
              disabled={loading || !conversationId}
              style={{
                padding: '0.75rem 2rem',
                borderRadius: '8px',
                border: 'none',
                background: loading ? 'rgba(37, 99, 235, 0.3)' : 'linear-gradient(135deg, #2563EB, #7C3AED)',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: loading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              {loading ? '⏳ Analyzing...' : '🔍 Analyze'}
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
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#94A3B8',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                From Date
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
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
                Limit
              </label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 50)}
                min="1"
                max="5000"
                style={{
                  width: '100px',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                id="skipAI"
                checked={skipAI}
                onChange={(e) => setSkipAI(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="skipAI" style={{ color: '#94A3B8', fontSize: '0.8rem', cursor: 'pointer' }}>
                Skip AI (faster for bulk)
              </label>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={loading || !dateFrom || !dateTo}
              style={{
                padding: '0.75rem 2rem',
                borderRadius: '8px',
                border: 'none',
                background: loading ? 'rgba(37, 99, 235, 0.3)' : 'linear-gradient(135deg, #2563EB, #7C3AED)',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: loading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              {loading ? '⏳ Analyzing...' : '🔍 Analyze Range'}
            </button>
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

      {/* Results */}
      {results.length > 0 && (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem'
          }}>
            <h3 style={{ color: '#F8FAFC', margin: 0 }}>
              📊 Results ({results.length} conversation{results.length > 1 ? 's' : ''})
            </h3>
            {results.length > 1 && (
              <button
                onClick={handleSaveAll}
                disabled={saving}
                style={{
                  padding: '0.5rem 1.5rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #22C55E, #16A34A)',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: saving ? 'wait' : 'pointer'
                }}
              >
                {saving ? '⏳ Saving...' : '💾 Save All to Supabase'}
              </button>
            )}
          </div>

          {results.map((result, index) => {
            const resolution = getResolutionBadge(result['Was it in client\'s favor?']);
            const isSaved = savedIds.has(result['Conversation ID']);
            
            return (
              <div
                key={result['Conversation ID'] || index}
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  marginBottom: '1rem',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                {/* Header Row */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '1rem',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}>
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      Conversation ID
                    </div>
                    <div style={{ color: '#F8FAFC', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                      {result['Conversation ID']}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      Country
                    </div>
                    <div style={{ color: '#F8FAFC' }}>
                      {result['Country'] || '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      Email
                    </div>
                    <div style={{ color: '#F8FAFC', fontSize: '0.875rem' }}>
                      {result['Email'] || '—'}
                    </div>
                  </div>
                  <div style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '20px',
                    background: resolution.bg,
                    color: resolution.color,
                    fontSize: '0.8rem',
                    fontWeight: '600'
                  }}>
                    {resolution.text}
                  </div>
                </div>

                {/* Topics */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1rem'
                }}>
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                      Main Topics
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {(result['Main-Topics'] || []).map((topic, i) => (
                        <span key={i} style={{
                          padding: '0.25rem 0.75rem',
                          borderRadius: '20px',
                          background: 'rgba(37, 99, 235, 0.2)',
                          color: '#38BDF8',
                          fontSize: '0.8rem'
                        }}>
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                      Sub Topics
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {(result['Sub-Topics'] || []).map((topic, i) => (
                        <span key={i} style={{
                          padding: '0.25rem 0.75rem',
                          borderRadius: '20px',
                          background: 'rgba(124, 58, 237, 0.2)',
                          color: '#A78BFA',
                          fontSize: '0.8rem'
                        }}>
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Sentiment */}
                <div style={{
                  display: 'flex',
                  gap: '2rem',
                  marginBottom: '1rem'
                }}>
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      Sentiment Start
                    </div>
                    <div style={{ 
                      color: getSentimentColor(result['Sentiment Start']),
                      fontWeight: '600'
                    }}>
                      {result['Sentiment Start'] || '—'}
                    </div>
                  </div>
                  <div style={{ color: '#475569', fontSize: '1.5rem' }}>→</div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      Sentiment End
                    </div>
                    <div style={{ 
                      color: getSentimentColor(result['Sentiment End']),
                      fontWeight: '600'
                    }}>
                      {result['Sentiment End'] || '—'}
                    </div>
                  </div>
                </div>

                {/* Feedbacks */}
                {result['Feedbacks'] && result['Feedbacks'].length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                      💡 Feedbacks & Suggestions
                    </div>
                    <ul style={{ 
                      margin: 0, 
                      paddingLeft: '1.25rem',
                      color: '#CBD5E1'
                    }}>
                      {result['Feedbacks'].map((fb, i) => (
                        <li key={i} style={{ marginBottom: '0.25rem', fontSize: '0.875rem' }}>{fb}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Transcript Preview */}
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                    📝 Transcript Preview
                  </div>
                  <div style={{
                    background: 'rgba(15, 23, 42, 0.5)',
                    borderRadius: '8px',
                    padding: '1rem',
                    maxHeight: '150px',
                    overflow: 'auto',
                    fontSize: '0.8rem',
                    color: '#94A3B8',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace'
                  }}>
                    {result['Transcript'] || '(No transcript)'}
                  </div>
                </div>

                {/* Save Button */}
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => handleSaveToSupabase(result)}
                    disabled={saving || isSaved}
                    style={{
                      padding: '0.5rem 1.5rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: isSaved 
                        ? 'rgba(34, 197, 94, 0.2)' 
                        : 'linear-gradient(135deg, #22C55E, #16A34A)',
                      color: isSaved ? '#22C55E' : '#fff',
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      cursor: (saving || isSaved) ? 'default' : 'pointer'
                    }}
                  >
                    {isSaved ? '✓ Saved' : saving ? '⏳ Saving...' : '💾 Save to Supabase'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && results.length === 0 && !error && (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          color: '#64748B'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
          <p>Enter a conversation ID or date range to analyze</p>
        </div>
      )}
    </div>
  );
};

export default TopicAnalyzerAdmin;
