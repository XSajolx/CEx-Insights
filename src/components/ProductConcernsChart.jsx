import React, { useState, useEffect } from 'react';
import { fetchCSATProductReasons } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';

const ProductConcernsChart = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const productData = await fetchCSATProductReasons(filters);

                // Sort by count descending
                const sortedData = (productData || [])
                    .sort((a, b) => (b.current_count || 0) - (a.current_count || 0))
                    .map(item => ({
                        name: item.reason || 'Unknown',
                        value: item.current_count || 0
                    }));
                setData(sortedData);
            } catch (error) {
                console.error('ProductConcernsChart: Error loading product concerns:', error);
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
                    <p style={{ margin: '6px 0 0 0', color: '#58A6FF', fontWeight: '700', fontSize: '1rem' }}>
                        {payload[0].value} issues
                    </p>
                </div>
            );
        }
        return null;
    };

    // Calculate height based on data length (min 400px, or 50px per bar)
    const rowHeight = 45;
    const chartHeight = Math.max(400, data.length * rowHeight);

    return (
        <div className="card">
            <div className="card-header">
                <h3 className="card-title">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                    </svg>
                    Concern Regarding Product
                </h3>
            </div>
            <div className="chart-container" style={{ height: '400px', overflowY: 'auto', paddingRight: '8px' }}>
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
                                margin={{ top: 5, right: 40, left: 150, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 148, 158, 0.1)" horizontal={false} />
                                <XAxis type="number" hide domain={[0, 'dataMax']} />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={140}
                                    tick={{ fontSize: 11, fill: '#C9D1D9' }}
                                    interval={0}
                                    stroke="#30363D"
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(88, 166, 255, 0.08)' }} />
                                <Bar
                                    dataKey="value"
                                    radius={[0, 4, 4, 0]}
                                    barSize={20}
                                >
                                    {data.map((entry, index) => {
                                        // Gradient from Primary Blue #2563EB to Deep Blue/Dark Blue
                                        const colors = ['#2563EB', '#1D4ED8', '#1E40AF', '#1E3A8A'];
                                        const color = colors[Math.min(index, colors.length - 1)];
                                        return <Cell key={`cell-${index}`} fill={color} />;
                                    })}
                                    <LabelList dataKey="value" position="right" fill="#F9FAFB" fontSize={12} formatter={(value) => `${value}`} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        No product concern data available
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductConcernsChart;
