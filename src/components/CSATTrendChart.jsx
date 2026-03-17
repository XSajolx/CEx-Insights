import React, { useState, useEffect } from 'react';
import { fetchCSATTrend } from '../services/api';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const CSATTrendChart = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                console.log('CSATTrendChart: Fetching data with filters:', filters);
                const trendData = await fetchCSATTrend(filters);
                console.log('CSATTrendChart: Received data:', trendData);
                console.log('CSATTrendChart: Data length:', trendData?.length);
                setData(trendData || []);
            } catch (error) {
                console.error('CSATTrendChart: Error loading CSAT trend:', error);
                console.error('CSATTrendChart: Error details:', error.message, error.code);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filters]);

    // Format date for display
    const formatXAxis = (value) => {
        const date = new Date(value);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // Custom tooltip
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const date = new Date(label);
            const formattedDate = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

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
                        {formattedDate}
                    </p>
                    <p style={{ margin: '6px 0 0 0', color: '#2563EB', fontWeight: '700', fontSize: '1.125rem' }}>
                        {payload[0].value}
                    </p>
                </div>
            );
        }
        return null;
    };

    // Custom dot to show values on all points
    const CustomDot = (props) => {
        const { cx, cy, payload } = props;

        return (
            <g>
                <circle cx={cx} cy={cy} r={4} fill="#2563EB" stroke="#0D1117" strokeWidth={2} />
                <text
                    x={cx}
                    y={cy - 12}
                    textAnchor="middle"
                    fill="#2563EB"
                    fontSize="12"
                    fontWeight="600"
                >
                    {payload.avg_rating}
                </text>
            </g>
        );
    };

    return (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header" style={{ borderBottom: 'none', paddingBottom: '0.5rem' }}>
                <div>
                    <h3 className="card-title" style={{ marginBottom: '0.25rem' }}>
                        CSAT Trends Over Time
                    </h3>
                    <p style={{ fontSize: '0.75rem', color: '#8B949E', margin: 0 }}>
                        {filters.dateRange === 'last_7_days' ? 'Sep 3 - Dec 9, 2025' :
                            filters.dateRange === 'last_30_days' ? 'Last 30 days' :
                                'Last 90 days'}
                    </p>
                </div>
            </div>
            <div className="chart-container" style={{ height: '300px', marginTop: '1rem' }}>
                {loading ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        Loading...
                    </div>
                ) : data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                            data={data}
                            margin={{ top: 30, right: 30, left: 0, bottom: 5 }}
                        >
                            <defs>
                                <linearGradient id="colorRating" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                                </linearGradient>
                            </defs>

                            <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="rgba(139, 148, 158, 0.08)"
                                vertical={false}
                            />

                            <XAxis
                                dataKey="date"
                                stroke="#30363D"
                                tick={{ fill: '#6E7681', fontSize: 11 }}
                                tickLine={false}
                                axisLine={{ stroke: '#30363D' }}
                                tickFormatter={formatXAxis}
                                interval="preserveStartEnd"
                                minTickGap={50}
                            />

                            <YAxis
                                stroke="#30363D"
                                tick={{ fill: '#6E7681', fontSize: 11 }}
                                tickLine={false}
                                axisLine={false}
                                domain={[0, 5]}
                                ticks={[0, 10, 20, 30, 40, 50]}
                                hide
                            />

                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2563EB', strokeWidth: 1, strokeDasharray: '5 5' }} />

                            <Area
                                type="monotone"
                                dataKey="avg_rating"
                                stroke="#2563EB"
                                strokeWidth={2.5}
                                fill="url(#colorRating)"
                                dot={<CustomDot />}
                                activeDot={{ r: 6, fill: '#2563EB', stroke: '#0D1117', strokeWidth: 2 }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        No trend data available
                    </div>
                )}
            </div>

            {/* Legend */}
            {data.length > 0 && (
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    marginTop: '1rem',
                    paddingTop: '1rem',
                    borderTop: '1px solid #30363D'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            backgroundColor: '#2563EB'
                        }}></div>
                        <span style={{ color: '#8B949E', fontSize: '0.75rem', fontWeight: '500' }}>
                            Current
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CSATTrendChart;
