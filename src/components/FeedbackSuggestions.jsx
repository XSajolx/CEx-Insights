import React from 'react';

const FeedbackSuggestions = () => {
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
                <h1 style={{ fontSize: '1.5rem', fontWeight: '600' }}>Feedback and Suggestions</h1>
                <p style={{ color: '#9CA3AF', marginTop: '0.5rem' }}>Gathering and analyzing customer insights for product improvement.</p>
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
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            <line x1="12" y1="7" x2="12" y2="13"></line>
                            <line x1="9" y1="10" x2="15" y2="10"></line>
                        </svg>
                    </div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: '500' }}>Feedback Management</h2>
                    <p style={{ color: '#9CA3AF', maxWidth: '400px', margin: '0.5rem auto' }}>
                        This section is taking shape. Soon, you will be able to review specific customer suggestions and categorized feedback here.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default FeedbackSuggestions;
