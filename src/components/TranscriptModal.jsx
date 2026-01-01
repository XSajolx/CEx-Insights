import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

const TranscriptModal = ({ isOpen, onClose, conversationId, conversationData }) => {
    const [transcript, setTranscript] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen && conversationId) {
            fetchTranscript();
        }
    }, [isOpen, conversationId]);

    const fetchTranscript = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase
                .from('Intercom Topic')
                .select('"Conversation ID","Transcript","Country","Product","Region",created_date_bd,"Main-Topics","Sub-Topics","Sentiment End"')
                .eq('"Conversation ID"', conversationId)
                .limit(1)
                .single();

            if (fetchError) throw fetchError;
            setTranscript(data);
        } catch (err) {
            console.error('Error fetching transcript:', err);
            setError('Failed to load transcript');
        } finally {
            setLoading(false);
        }
    };

    const parseTranscript = (transcriptText) => {
        if (!transcriptText) return [];
        
        // Split by USER: or AGENT: prefixes while keeping the delimiter
        const lines = transcriptText.split(/(?=USER:|AGENT:)/);
        
        return lines
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                if (line.startsWith('USER:')) {
                    return { type: 'user', message: line.replace('USER:', '').trim() };
                } else if (line.startsWith('AGENT:')) {
                    return { type: 'agent', message: line.replace('AGENT:', '').trim() };
                }
                return { type: 'system', message: line };
            });
    };

    if (!isOpen) return null;

    const messages = transcript ? parseTranscript(transcript.Transcript) : [];

    return (
        <div 
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '20px'
            }}
            onClick={onClose}
        >
            <div 
                style={{
                    backgroundColor: '#161B22',
                    borderRadius: '12px',
                    border: '1px solid #30363D',
                    width: '100%',
                    maxWidth: '800px',
                    maxHeight: '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #30363D',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div>
                        <h2 style={{ 
                            margin: 0, 
                            fontSize: '1.125rem', 
                            fontWeight: '600', 
                            color: '#F0F6FC',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                            Conversation Transcript
                        </h2>
                        {transcript && (
                            <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#8B949E' }}>
                                ID: {conversationId} • {transcript.created_date_bd} • {transcript.Country} • {transcript.Product}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#8B949E',
                            cursor: 'pointer',
                            padding: '8px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => e.target.style.backgroundColor = '#21262D'}
                        onMouseLeave={e => e.target.style.backgroundColor = 'transparent'}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                {/* Topic Tags */}
                {transcript && (
                    <div style={{
                        padding: '12px 20px',
                        borderBottom: '1px solid #30363D',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        alignItems: 'center'
                    }}>
                        {transcript['Main-Topics'] && Array.isArray(transcript['Main-Topics']) && transcript['Main-Topics'].map((topic, i) => (
                            <span key={`main-${i}`} style={{
                                padding: '4px 10px',
                                backgroundColor: 'rgba(163, 113, 247, 0.15)',
                                color: '#A371F7',
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                fontWeight: '500'
                            }}>
                                {topic}
                            </span>
                        ))}
                        {transcript['Sub-Topics'] && Array.isArray(transcript['Sub-Topics']) && transcript['Sub-Topics'].map((topic, i) => (
                            <span key={`sub-${i}`} style={{
                                padding: '4px 10px',
                                backgroundColor: 'rgba(88, 166, 255, 0.15)',
                                color: '#58A6FF',
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                fontWeight: '500'
                            }}>
                                {topic}
                            </span>
                        ))}
                        {transcript['Sentiment End'] && (
                            <span style={{
                                padding: '4px 10px',
                                backgroundColor: transcript['Sentiment End'].toLowerCase() === 'positive' 
                                    ? 'rgba(63, 185, 80, 0.15)' 
                                    : transcript['Sentiment End'].toLowerCase() === 'negative'
                                    ? 'rgba(248, 81, 73, 0.15)'
                                    : 'rgba(139, 148, 158, 0.15)',
                                color: transcript['Sentiment End'].toLowerCase() === 'positive' 
                                    ? '#3FB950' 
                                    : transcript['Sentiment End'].toLowerCase() === 'negative'
                                    ? '#F85149'
                                    : '#8B949E',
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                fontWeight: '500'
                            }}>
                                {transcript['Sentiment End']}
                            </span>
                        )}
                    </div>
                )}

                {/* Messages */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    {loading && (
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            padding: '40px',
                            color: '#8B949E'
                        }}>
                            <div style={{
                                width: '24px',
                                height: '24px',
                                border: '2px solid #30363D',
                                borderTopColor: '#58A6FF',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                            }} />
                            <span style={{ marginLeft: '12px' }}>Loading transcript...</span>
                        </div>
                    )}

                    {error && (
                        <div style={{ 
                            padding: '20px', 
                            textAlign: 'center', 
                            color: '#F85149',
                            backgroundColor: 'rgba(248, 81, 73, 0.1)',
                            borderRadius: '8px'
                        }}>
                            {error}
                        </div>
                    )}

                    {!loading && !error && messages.length === 0 && (
                        <div style={{ 
                            padding: '40px', 
                            textAlign: 'center', 
                            color: '#8B949E' 
                        }}>
                            No transcript available for this conversation
                        </div>
                    )}

                    {messages.map((msg, index) => (
                        <div
                            key={index}
                            style={{
                                display: 'flex',
                                justifyContent: msg.type === 'agent' ? 'flex-end' : 'flex-start'
                            }}
                        >
                            <div style={{
                                maxWidth: '75%',
                                padding: '10px 14px',
                                borderRadius: msg.type === 'agent' 
                                    ? '16px 16px 4px 16px' 
                                    : '16px 16px 16px 4px',
                                backgroundColor: msg.type === 'agent' 
                                    ? '#1F6FEB' 
                                    : msg.type === 'user'
                                    ? '#21262D'
                                    : '#30363D',
                                color: '#F0F6FC',
                                fontSize: '0.875rem',
                                lineHeight: '1.5'
                            }}>
                                <div style={{
                                    fontSize: '0.6875rem',
                                    fontWeight: '600',
                                    marginBottom: '4px',
                                    color: msg.type === 'agent' ? '#79C0FF' : '#8B949E',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.03em'
                                }}>
                                    {msg.type === 'user' ? 'Customer' : msg.type === 'agent' ? 'Agent' : 'System'}
                                </div>
                                {msg.message}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '12px 20px',
                    borderTop: '1px solid #30363D',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px'
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: '#21262D',
                            border: '1px solid #30363D',
                            borderRadius: '6px',
                            color: '#C9D1D9',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => e.target.style.backgroundColor = '#30363D'}
                        onMouseLeave={e => e.target.style.backgroundColor = '#21262D'}
                    >
                        Close
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default TranscriptModal;

