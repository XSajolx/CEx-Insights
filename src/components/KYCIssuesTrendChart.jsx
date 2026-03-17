import React, { useState, useEffect } from 'react';
import { fetchCSATKYC } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const KYCIssuesTrendChart = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                console.log('KYCIssuesTrendChart: Fetching data with filters:', filters);
                const kycData = await fetchCSATKYC(filters);
                console.log('KYCIssuesTrendChart: Received data:', kycData);

                // Process data for stacked area chart
                const processedData = processKYCTrendData(kycData);
                setData(processedData);
            } catch (error) {
                console.error('KYCIssuesTrendChart: Error loading KYC trends:', error);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filters]);

    const processKYCTrendData = (rawData) => {
        // Group by week and issue category
        // This is a simplified version - you'd need actual date data
        const top5Issues = rawData.slice(0, 5);
        const colors = ['#58A6FF', '#FF7B72', '#F0883E', '#3FB950', '#A371F7'];

        return top5Issues.map((item, index) => ({
            name: item.reason,
            count: item.count,
            color: colors[index % colors.length]
        }));
    };

    const COLORS = ['#58A6FF', '#FF7B72', '#F0883E', '#3FB950', '#A371F7', '#DB61A2'];

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    backgroundColor: '#1C2128',
                    padding: '12px 16px',
                    border: '1px solid #30363D',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    color: '#F0F6FC'
                }}>
                    <p style={{ margin: 0, fontWeight: '600', color: '#8B949E', fontSize: '0.75rem' }}>
                        {label}
                    </p>
                    {payload.map((entry, index) => (
                        <p key={index} style={{ margin: '4px 0', color: entry.color, fontWeight: '600', fontSize: '0.875rem' }}>
                            {entry.name}: {entry.value}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="card">
            <div className="card-header">
                <h3 className="card-title">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Top KYC Issues Over Time
                </h3>
            </div>
            <div className="chart-container" style={{ height: '350px' }}>
                {loading ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        Loading...
                    </div>
                ) : data.length > 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        Chart coming soon - needs time-series KYC data
                    </div>
                ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        No KYC trend data available
                    </div>
                )}
            </div>
        </div>
    );
};

export default KYCIssuesTrendChart;
