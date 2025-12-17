import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { calculateDateRanges } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LabelList } from 'recharts';

const CSATByIssueCategoryChart = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [overallAvg, setOverallAvg] = useState(0);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                console.log('CSATByIssueCategoryChart: Fetching data with filters:', filters);
                const result = await fetchCSATByIssueCategory(filters);
                setData(result.data);
                setOverallAvg(result.overallAvg);
            } catch (error) {
                console.error('CSATByIssueCategoryChart: Error loading data:', error);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filters]);

    const fetchCSATByIssueCategory = async (filters) => {
        const { curFrom, curTo } = calculateDateRanges(filters.dateRange || 'last_90_days');

        // Convert YYYY-MM-DD to MM/DD/YYYY
        const formatToMMDDYYYY = (dateStr) => {
            const [year, month, day] = dateStr.split('-');
            return `${parseInt(month)}/${parseInt(day)}/${year}`;
        };

        const fromDate = formatToMMDDYYYY(curFrom);
        const toDate = formatToMMDDYYYY(curTo);

        // Fetch CSAT data with product concerns
        let query = supabase
            .from('CSAT')
            .select('Date, "Conversation rating", "Concern regarding product (Catagory)", "Concern regarding product (Sub-catagory)", Location, Product, Channel')
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

        // Calculate average CSAT by issue category
        const categoryStats = {};
        let totalRating = 0;
        let totalCount = 0;

        filteredData.forEach(row => {
            const subCategory = row['Concern regarding product (Sub-catagory)'];
            const category = row['Concern regarding product (Catagory)'];
            const rating = row['Conversation rating'];

            const issue = (subCategory && subCategory.trim()) || (category && category.trim());

            if (issue) {
                if (!categoryStats[issue]) {
                    categoryStats[issue] = { sum: 0, count: 0 };
                }
                categoryStats[issue].sum += rating;
                categoryStats[issue].count += 1;
            }

            totalRating += rating;
            totalCount += 1;
        });

        const overallAvg = totalCount > 0 ? totalRating / totalCount : 0;

        // Convert to array and calculate averages
        const result = Object.entries(categoryStats)
            .map(([category, stats]) => ({
                category,
                avg_csat: Math.round((stats.sum / stats.count) * 100) / 100,
                count: stats.count
            }))
            .sort((a, b) => a.avg_csat - b.avg_csat) // Sort from lowest to highest
            .slice(0, 10); // Top 10

        return { data: result, overallAvg: Math.round(overallAvg * 100) / 100 };
    };

    const COLORS = ['#FF7B72', '#F0883E', '#F0883E', '#F0883E', '#58A6FF', '#58A6FF', '#58A6FF', '#3FB950', '#3FB950', '#3FB950'];

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
                    <p style={{ margin: '6px 0 0 0', color: '#58A6FF', fontWeight: '700', fontSize: '1rem' }}>
                        Avg CSAT: {payload[0].value}
                    </p>
                    <p style={{ margin: '4px 0 0 0', color: '#8B949E', fontSize: '0.75rem' }}>
                        {payload[0].payload.count} responses
                    </p>
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
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg>
                    Average CSAT by Issue Category
                </h3>
            </div>
            <div className="chart-container" style={{ height: '400px' }}>
                {loading ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        Loading...
                    </div>
                ) : data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={data}
                            layout="vertical"
                            margin={{ top: 5, right: 100, left: 150, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 148, 158, 0.1)" horizontal={false} />
                            <XAxis
                                type="number"
                                domain={[0, 5]}
                                ticks={[0, 1, 2, 3, 4, 5]}
                                stroke="#30363D"
                                tick={{ fill: '#8B949E', fontSize: 11 }}
                                tickLine={false}
                                axisLine={{ stroke: '#30363D' }}
                            />
                            <YAxis
                                type="category"
                                dataKey="category"
                                width={140}
                                tick={{ fontSize: 11, fill: '#C9D1D9' }}
                                interval={0}
                                stroke="#30363D"
                                tickLine={false}
                                axisLine={false}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(88, 166, 255, 0.08)' }} />

                            {/* Reference line for overall average */}
                            <ReferenceLine
                                x={overallAvg}
                                stroke="#F0883E"
                                strokeDasharray="5 5"
                                strokeWidth={2}
                                label={{
                                    value: `Avg: ${overallAvg}`,
                                    position: 'top',
                                    fill: '#F0883E',
                                    fontSize: 11,
                                    fontWeight: 600
                                }}
                            />

                            <Bar
                                dataKey="avg_csat"
                                radius={[0, 4, 4, 0]}
                                barSize={28}
                            >
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                                <LabelList
                                    dataKey="avg_csat"
                                    position="right"
                                    fill="#8B949E"
                                    fontSize={12}
                                    formatter={(value) => value.toFixed(2)}
                                />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                        No data available
                    </div>
                )}
            </div>
        </div>
    );
};

export default CSATByIssueCategoryChart;
