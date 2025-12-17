import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { calculateDateRanges } from '../services/api';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const CSATRatingDistributionChart = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeIndex, setActiveIndex] = useState(null);

    // Colors for each rating (5 to 1 stars)
    const RATING_CONFIG = [
        { rating: 5, label: '5 Stars', color: '#1D4ED8' },  // Deep Blue
        { rating: 4, label: '4 Stars', color: '#0EA5E9' },  // Blue-Teal
        { rating: 3, label: '3 Stars', color: '#22C55E' },  // Green
        { rating: 2, label: '2 Stars', color: '#EAB308' },  // Amber
        { rating: 1, label: '1 Star', color: '#F97316' }    // Orange
    ];

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const result = await fetchRatingDistribution(filters);
                setData(result);
            } catch (error) {
                console.error('CSATRatingDistributionChart: Error loading data:', error);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filters]);

    const fetchRatingDistribution = async (filters) => {
        const { curFrom, curTo } = calculateDateRanges(filters.dateRange || 'last_90_days');

        // Convert YYYY-MM-DD to MM/DD/YYYY
        const formatToMMDDYYYY = (dateStr) => {
            const [year, month, day] = dateStr.split('-');
            return `${parseInt(month)}/${parseInt(day)}/${year}`;
        };

        const fromDate = formatToMMDDYYYY(curFrom);
        const toDate = formatToMMDDYYYY(curTo);

        // Fetch CSAT data
        let query = supabase
            .from('CSAT')
            .select('Date, "Conversation rating", Location, Product, Channel')
            .not('Conversation rating', 'is', null)
            .gte('Conversation rating', 1)
            .lte('Conversation rating', 5);

        const { data, error } = await query;

        if (error) throw error;

        // Filter by date
        const parseDate = (dateStr) => {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                return new Date(parts[2], parts[0] - 1, parts[1]);
            }
            return null;
        };

        const fromDateObj = parseDate(fromDate);
        const toDateObj = parseDate(toDate);

        const filteredData = (data || []).filter(row => {
            const rowDate = parseDate(row.Date);
            if (!rowDate || rowDate < fromDateObj || rowDate > toDateObj) return false;

            if (filters.countries?.length > 0 && !filters.countries.includes(row.Location)) return false;
            if (filters.products?.length > 0 && !filters.products.includes(row.Product)) return false;
            if (filters.channels?.length > 0 && !filters.channels.includes(row.Channel)) return false;

            return true;
        });

        // Count by rating
        const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        filteredData.forEach(row => {
            const rating = row['Conversation rating'];
            if (rating >= 1 && rating <= 5) {
                ratingCounts[rating]++;
            }
        });

        // Convert to chart format
        return RATING_CONFIG.map(config => ({
            name: config.label,
            value: ratingCounts[config.rating],
            rating: config.rating,
            color: config.color
        }));
    };

    const total = data.reduce((sum, item) => sum + item.value, 0);

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const item = payload[0].payload;
            const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;
            return (
                <div style={{
                    backgroundColor: '#1C2128',
                    padding: '12px 16px',
                    border: '1px solid #30363D',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                }}>
                    <p style={{ margin: 0, fontWeight: '600', color: item.color, fontSize: '0.875rem' }}>
                        {item.name}
                    </p>
                    <p style={{ margin: '6px 0 0 0', color: '#E5E7EB', fontWeight: '700', fontSize: '1rem' }}>
                        {item.value.toLocaleString()} responses ({percentage}%)
                    </p>
                </div>
            );
        }
        return null;
    };

    const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value, index }) => {
        const RADIAN = Math.PI / 180;
        const radius = outerRadius * 0.7;
        const x = cx + radius * Math.cos(-midAngle * RADIAN);
        const y = cy + radius * Math.sin(-midAngle * RADIAN);

        if (value < total * 0.03) return null; // Don't show label for small slices

        return (
            <text
                x={x}
                y={y}
                fill="#F9FAFB"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="13"
                fontWeight="600"
            >
                {value.toLocaleString()}
            </text>
        );
    };

    const CustomLegend = () => (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid rgba(148, 163, 184, 0.1)'
        }}>
            {data.map((item, index) => (
                <div
                    key={index}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: 'default',
                        opacity: activeIndex !== null && activeIndex !== index ? 0.5 : 1,
                        transition: 'opacity 0.2s ease'
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                >
                    <div style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: item.color
                    }} />
                    <span style={{
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        color: '#E5E7EB'
                    }}>
                        {item.name}
                    </span>
                </div>
            ))}
        </div>
    );

    return (
        <div className="card csat-distribution-card">
            <div className="card-header" style={{ borderBottom: 'none', paddingBottom: '0.5rem' }}>
                <h3 className="card-title" style={{ fontSize: '1rem', fontWeight: '600', color: '#E5E7EB' }}>
                    CSAT Rating Distribution
                </h3>
            </div>

            <div style={{ height: '280px' }}>
                {loading ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>
                        Loading...
                    </div>
                ) : data.length > 0 && total > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="45%"
                                labelLine={false}
                                label={renderCustomizedLabel}
                                outerRadius={90}
                                innerRadius={0}
                                dataKey="value"
                                animationBegin={0}
                                animationDuration={800}
                                onMouseEnter={(_, index) => setActiveIndex(index)}
                                onMouseLeave={() => setActiveIndex(null)}
                            >
                                {data.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.color}
                                        stroke="rgba(0,0,0,0.2)"
                                        strokeWidth={1}
                                        style={{
                                            filter: activeIndex === index ? 'brightness(1.15) saturate(1.1)' : 'brightness(1)',
                                            transform: activeIndex === index ? 'scale(1.05)' : 'scale(1)',
                                            transformOrigin: 'center',
                                            transition: 'all 0.2s ease',
                                            outline: 'none'
                                        }}
                                    />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>
                        No rating data available
                    </div>
                )}
            </div>

            {/* Custom Legend */}
            {!loading && data.length > 0 && <CustomLegend />}
        </div>
    );
};

export default CSATRatingDistributionChart;
