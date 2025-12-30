import React from 'react';

const SentimentAnalysis = () => {
    return (
        <div className="placeholder-view" style={{
            padding: '2rem',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            color: '#E5E7EB'
        }}>
            <div className="view-header" style={{ marginBottom: '1rem' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: '600' }}>Sentiment Analysis</h1>
                <p style={{ color: '#9CA3AF', marginTop: '0.5rem' }}>Understanding the emotional tone of customer conversations.</p>
            </div>

            <div className="placeholder-content" style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#1F2937',
                borderRadius: '0.75rem',
                border: '1px dashed #374151',
                minHeight: '400px'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ marginBottom: '1rem', color: '#9CA3AF' }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                            <line x1="9" y1="9" x2="9.01" y2="9"></line>
                            <line x1="15" y1="9" x2="15.01" y2="9"></line>
                        </svg>
                    </div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: '500' }}>Sentiment Analysis Dashboard</h2>
                    <p style={{ color: '#9CA3AF', maxWidth: '400px', margin: '0.5rem auto' }}>
                        This section is currently under development. Soon, you will be able to see emotional trends and customer satisfaction metrics here.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SentimentAnalysis;
