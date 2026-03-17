import React, { useState, useEffect } from 'react';
import { fetchCSATKYC, fetchCSATCategories } from '../services/api';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import SearchableSelect from './SearchableSelect';

const KYCIssueDrilledInChart = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeIndex, setActiveIndex] = useState(null);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('KYC_Issue');

    const COLORS = [
        '#2563EB', // Primary Blue
        '#0D9488', // Teal
        '#22C55E', // Green
        '#EAB308', // Amber
        '#F97316', // Orange
        '#F43F5E', // Rose
        '#7C3AED'  // Violet
    ];

    // Load available categories
    useEffect(() => {
        const loadCategories = async () => {
            const cats = await fetchCSATCategories();
            setCategories(cats);

            // Default to KYC_Issue if available, otherwise first category
            if (cats.length > 0 && !cats.includes('KYC_Issue')) {
                setSelectedCategory(cats[0]);
            }
        };
        loadCategories();
    }, []);

    // Load chart data when filters or category changes
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                // Pass selected category
                const drillData = await fetchCSATKYC(filters, selectedCategory);
                // Sort by count descending and take top items
                const sortedData = (drillData || [])
                    .sort((a, b) => (b.count || 0) - (a.count || 0))
                    .slice(0, 10)
                    .map((item, index) => ({
                        name: item.reason || 'Unknown',
                        value: item.count || 0,
                        color: COLORS[index % COLORS.length]
                    }));
                setData(sortedData);
            } catch (error) {
                console.error('KYCIssueDrilledInChart: Error loading data:', error);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filters, selectedCategory]);

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
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    maxWidth: '250px'
                }}>
                    <p style={{ margin: 0, fontWeight: '600', color: item.color, fontSize: '0.875rem' }}>
                        {item.name}
                    </p>
                    <p style={{ margin: '6px 0 0 0', color: '#E5E7EB', fontWeight: '700', fontSize: '1rem' }}>
                        {item.value} cases ({percentage}%)
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="card kyc-drilled-card">
            <div className="card-header" style={{
                borderBottom: 'none',
                paddingBottom: '0.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem'
            }}>
                <h3 className="card-title" style={{ fontSize: '1rem', fontWeight: '600', color: '#E5E7EB' }}>
                    Drilled-in Report
                </h3>

                {/* Searchable Dropdown */}
                <div style={{ width: '220px' }}>
                    <SearchableSelect
                        options={categories}
                        value={selectedCategory}
                        onChange={setSelectedCategory}
                        label="Category"
                        showAllOption={false}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', height: '320px', alignItems: 'center' }}>
                {/* Left: Donut Chart */}
                <div style={{ flex: '0 0 50%', height: '100%', position: 'relative' }}>
                    {loading ? (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>
                            Loading...
                        </div>
                    ) : data.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={data}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    outerRadius={100}
                                    innerRadius={70} // Donut style
                                    dataKey="value"
                                    animationBegin={0}
                                    animationDuration={800}
                                    onMouseEnter={(_, index) => setActiveIndex(index)}
                                    onMouseLeave={() => setActiveIndex(null)}
                                    paddingAngle={2}
                                >
                                    {data.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.color}
                                            stroke="transparent"
                                            style={{
                                                filter: activeIndex === index ? 'brightness(1.1)' : 'brightness(1)',
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
                            No data available
                        </div>
                    )}
                </div>

                {/* Right: Issue Breakdown List (Timeline style) */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    paddingRight: '8px',
                    height: '280px'
                }} className="kyc-issue-list">
                    {data.map((item, index) => (
                        <div
                            key={index}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                marginBottom: '0.75rem',
                                padding: '4px 6px',
                                borderRadius: '6px',
                                backgroundColor: activeIndex === index ? 'rgba(255,255,255,0.05)' : 'transparent',
                                transition: 'all 0.2s ease',
                                cursor: 'default'
                            }}
                            onMouseEnter={() => setActiveIndex(index)}
                            onMouseLeave={() => setActiveIndex(null)}
                        >
                            {/* Color Dot */}
                            <div style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: item.color,
                                marginRight: '0.75rem',
                                flexShrink: 0
                            }} />

                            {/* Name */}
                            <div style={{
                                fontSize: '0.8125rem',
                                fontWeight: '500',
                                color: activeIndex === index ? '#FFFFFF' : '#E5E7EB',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: '140px'
                            }}>
                                {item.name}
                            </div>

                            {/* Dotted Leader */}
                            <div style={{
                                flex: 1,
                                borderBottom: '1px dotted #30363D',
                                margin: '0 0.75rem',
                                opacity: 0.5,
                                position: 'relative',
                                top: '-2px'
                            }} />

                            {/* Percentage (and value tooltip on hover) */}
                            <div style={{
                                fontSize: '0.8125rem',
                                fontWeight: '600',
                                color: activeIndex === index ? '#FFFFFF' : '#9CA3AF',
                                textAlign: 'right',
                                minWidth: '36px'
                            }}>
                                {total > 0 ? Math.round((item.value / total) * 100) : 0}%
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default KYCIssueDrilledInChart;
