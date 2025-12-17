import React, { useState, useEffect } from 'react';
import { fetchCSATCountryLow } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';

const CountryNegativeRatingChart = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const countryData = await fetchCSATCountryLow(filters);
                const sortedData = (countryData || [])
                    .sort((a, b) => (b.count || 0) - (a.count || 0))
                    .map(item => ({
                        name: item.country || 'Unknown',
                        value: item.count || 0
                    }));
                setData(sortedData);
            } catch (error) {
                console.error('CountryNegativeRatingChart: Error loading country negative ratings:', error);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filters]);

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    backgroundColor: '#1C2128',
                    padding: '12px 16px',
                    border: '1px solid #30363D',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    color: '#F0F6FC',
                    zIndex: 100
                }}>
                    <p style={{ margin: 0, fontWeight: '600', color: '#8B949E', fontSize: '0.75rem' }}>{label}</p>
                    <p style={{ margin: '6px 0 0 0', color: '#0D9488', fontWeight: '700', fontSize: '1rem' }}>
                        {payload[0].value} negative ratings
                    </p>
                </div>
            );
        }
        return null;
    };

    const rowHeight = 45;
    const chartHeight = Math.max(400, data.length * rowHeight);

    return (
        <div className="card">
            <div className="card-header">
                <h3 className="card-title">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"></path>
                    </svg>
                    Countries by Negative Rating Count
                </h3>
            </div>
            <div className="chart-container" style={{ height: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                {loading ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        Loading...
                    </div>
                ) : data.length > 0 ? (
                    <div style={{ height: `${chartHeight}px`, width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={data}
                                layout="vertical"
                                margin={{ top: 5, right: 40, left: 80, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 148, 158, 0.1)" horizontal={false} />
                                <XAxis type="number" hide domain={[0, 'dataMax']} />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={70}
                                    tick={{ fontSize: 11, fill: '#E5E7EB' }}
                                    interval={0}
                                    stroke="#30363D"
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(13, 148, 136, 0.08)' }} />
                                <Bar
                                    dataKey="value"
                                    radius={[0, 4, 4, 0]}
                                    barSize={20}
                                >
                                    {data.map((entry, index) => {
                                        // Gradient from Teal #0D9488 to Darker Teal
                                        const colors = ['#0D9488', '#0F766E', '#115E59', '#134E4A'];
                                        const color = colors[Math.min(index, colors.length - 1)];
                                        return <Cell key={`cell-${index}`} fill={color} />;
                                    })}
                                    <LabelList dataKey="value" position="right" fill="#CBD5F5" fontSize={12} formatter={(value) => `${value}`} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        No country data available
                    </div>
                )}
            </div>
        </div>
    );
};

export default CountryNegativeRatingChart;
