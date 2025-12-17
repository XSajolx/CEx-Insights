import React, { useMemo, useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    AreaChart, Area, Legend, PieChart, Pie, Cell, LabelList
} from 'recharts';
import { format, parseISO, differenceInDays, addDays } from 'date-fns';
import SearchableSelect from './SearchableSelect';
import CustomLegend from './CustomLegend';
import { topNWithOther, calculatePercentages } from '../utils/chartUtils';

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
                <p style={{ margin: 0, fontWeight: '600', color: '#8B949E', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</p>
                <p style={{ margin: '6px 0 0 0', color: '#58A6FF', fontWeight: '700', fontSize: '1rem' }}>
                    {payload[0].value} Conversations
                </p>
            </div>
        );
    }
    return null;
};

const TrendTooltip = ({ active, payload, label }) => {
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
                <p style={{ margin: '0 0 8px 0', fontWeight: '600', fontSize: '0.75rem', color: '#8B949E', textTransform: 'uppercase' }}>{label}</p>
                {payload.map((entry, index) => (
                    <div key={index} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px'
                    }}>
                        <div style={{
                            width: '10px',
                            height: '10px',
                            backgroundColor: entry.color,
                            borderRadius: '3px'
                        }} />
                        <span style={{ fontSize: '0.8125rem', color: '#C9D1D9' }}>
                            {entry.name}: <strong style={{ color: '#F0F6FC' }}>{entry.value}</strong>
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const DashboardCharts = ({ data, previousData, availableTopics, availableMainTopics = [], filters }) => {
    const [selectedTopic, setSelectedTopic] = useState('');
    const [selectedMainTopic, setSelectedMainTopic] = useState('All');

    // DEBUG: Log what main topics are received
    console.log('DashboardCharts - availableMainTopics prop:', availableMainTopics);
    console.log('DashboardCharts - availableMainTopics length:', availableMainTopics.length);

    // Note: availableMainTopics is now passed as a prop from App.jsx
    // It contains unique main topics fetched from the database

    // Compute filtered topics based on selected main topic (for Chart 2)
    const filteredTopics = useMemo(() => {
        if (selectedMainTopic === 'All') return availableTopics;
        return [...new Set(
            data.filter(item => item.main_topic === selectedMainTopic)
                .map(item => item.topic)
        )].filter(Boolean).sort();
    }, [data, selectedMainTopic, availableTopics]);

    // Reset selectedTopic when main topic changes and current topic is not in filtered list
    useEffect(() => {
        if (filteredTopics.length > 0 && !filteredTopics.includes(selectedTopic)) {
            setSelectedTopic(filteredTopics[0]);
        }
    }, [selectedMainTopic, filteredTopics]);

    useEffect(() => {
        if (availableTopics.length > 0 && !selectedTopic) {
            setSelectedTopic(availableTopics[0]);
        }
    }, [availableTopics, selectedTopic]);

    // Calculate date range for display
    const getDateRangeText = () => {
        if (!filters || !filters.dateRange) {
            return '';
        }

        if (filters.dateRange.startsWith('custom_')) {
            const [, start, end] = filters.dateRange.split('_');
            return `${start} to ${end}`;
        }

        const today = new Date();
        let startDate;

        switch (filters.dateRange) {
            case 'today':
                return `Today - ${format(today, 'MMM d, yyyy')}`;
            case 'yesterday':
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                return `Yesterday - ${format(yesterday, 'MMM d, yyyy')}`;
            case 'last_week':
                startDate = new Date(today);
                startDate.setDate(startDate.getDate() - 7);
                return `${format(startDate, 'MMM d')} - ${format(today, 'MMM d, yyyy')}`;
            case 'last_month':
                startDate = new Date(today);
                startDate.setMonth(startDate.getMonth() - 1);
                return `${format(startDate, 'MMM d')} - ${format(today, 'MMM d, yyyy')}`;
            case 'last_3_months':
            default:
                startDate = new Date(today);
                startDate.setMonth(startDate.getMonth() - 3);
                return `${format(startDate, 'MMM d')} - ${format(today, 'MMM d, yyyy')}`;
        }
    };

    // Aggregate data for Bar Chart (Total conversations per topic)
    // NOTE: This chart is NOT affected by the Main Topic filter (per user request)
    const barData = useMemo(() => {
        const counts = {};

        // Always use all data for Topic Distribution
        const filteredData = data || []; // Guard against undefined data
        const validTopics = new Set(availableMainTopics);

        filteredData.forEach(item => {
            let mainTopic = item.main_topic || 'Other';
            if (mainTopic !== 'Other' && !validTopics.has(mainTopic)) {
                mainTopic = 'Other';
            }
            // User requested NO "Other" slicing/aggregation - only show valid main topics
            // If it's Other or invalid, we track it for potential "Other" bucket if we wanted it,
            // but the request is to Match the Bar Chart exactly, which filters out Other below.
            counts[mainTopic] = (counts[mainTopic] || 0) + 1;
        });

        // Define comprehensive color palette with distinct colors for each topic
        // Each color is unique and visually distinguishable
        const colorMap = {
            'Login_Issue': '#58A6FF',                        // Bright Blue
            'Payout related issue': '#3FB950',               // Green
            'Next Phase Button Missing': '#F0883E',          // Orange
            'KYC_Issue': '#A371F7',                          // Purple
            'Discount related issue': '#D2A8FF',             // Light Purple
            'Platform Issue': '#DB61A2',                     // Pink
            'Account Related Issue': '#79C0FF',              // Light Blue
            'Restriction Related Issue': '#F778BA',          // Rose
            'Delay in Receiving Customer Support': '#56D4DD', // Cyan
            'Other': '#FF7B72'                               // Red
        };

        // Extended palette of 25+ distinct colors for any additional topics
        const defaultColors = [
            '#FFD700', // Gold
            '#FF6B9D', // Hot Pink
            '#00CED1', // Dark Turquoise
            '#FF8C00', // Dark Orange
            '#9370DB', // Medium Purple
            '#20B2AA', // Light Sea Green
            '#FF69B4', // Hot Pink
            '#4169E1', // Royal Blue
            '#32CD32', // Lime Green
            '#FF4500', // Orange Red
            '#DA70D6', // Orchid
            '#00FA9A', // Medium Spring Green
            '#FF1493', // Deep Pink
            '#1E90FF', // Dodger Blue
            '#ADFF2F', // Green Yellow
            '#FF6347', // Tomato
            '#BA55D3', // Medium Orchid
            '#00FFFF', // Aqua
            '#FFA500', // Orange
            '#9932CC', // Dark Orchid
            '#00FF7F', // Spring Green
            '#DC143C', // Crimson
            '#4682B4', // Steel Blue
            '#7FFF00', // Chartreuse
            '#C71585'  // Medium Violet Red
        ];

        let finalData = Object.keys(counts)
            .map(topic => ({ name: topic, value: counts[topic] }))
            .filter(item => item.name !== 'Other') // Remove 'Other' as requested
            .sort((a, b) => b.value - a.value); // Sort descending

        // Assign colors: use colorMap if available, otherwise use defaultColors sequentially
        // Track which colors have been used to avoid duplicates
        const usedColors = new Set(Object.values(colorMap));
        let defaultColorIndex = 0;

        return finalData.map((item) => {
            let assignedColor = colorMap[item.name];

            // If no predefined color, find next unused color from defaultColors
            if (!assignedColor) {
                while (defaultColorIndex < defaultColors.length && usedColors.has(defaultColors[defaultColorIndex])) {
                    defaultColorIndex++;
                }
                assignedColor = defaultColors[defaultColorIndex] || defaultColors[defaultColorIndex % defaultColors.length];
                usedColors.add(assignedColor);
                defaultColorIndex++;
            }

            return {
                ...item,
                color: assignedColor
            };
        });
    }, [data, availableMainTopics]);

    // Derived available topics for the dropdown - MUST match what is shown in the charts
    const chartTopics = useMemo(() => {
        return ['All Main Topics', ...barData.map(d => d.name)];
    }, [barData]);

    // Aggregate data for Trend Chart (Comparison)
    const trendData = useMemo(() => {
        if (!selectedTopic || !data) return []; // Guard against undefined data

        const processData = (dataset) => {
            const dailyCounts = {};
            if (!dataset) return dailyCounts;

            dataset.forEach(item => {
                if (item.topic === selectedTopic) {
                    const date = item.created_date_bd;
                    dailyCounts[date] = (dailyCounts[date] || 0) + 1;
                }
            });
            return dailyCounts;
        };

        const currentCounts = processData(data);
        const previousCounts = processData(previousData || []);

        // Normalize dates to relative days (Day 1, Day 2, etc.)
        const getSortedDates = (counts) => Object.keys(counts).sort();
        const currentDates = getSortedDates(currentCounts);
        const previousDates = getSortedDates(previousCounts);

        const maxDays = Math.max(currentDates.length, previousDates.length);
        const chartData = [];

        if (maxDays === 0) return []; // Return empty if no data

        for (let i = 0; i < maxDays; i++) {
            let label = `${i + 1}`;
            if (currentDates[i]) {
                try {
                    label = format(parseISO(currentDates[i]), 'MMM d');
                } catch (e) {
                    label = currentDates[i];
                }
            }

            chartData.push({
                day: label,
                Current: currentDates[i] ? currentCounts[currentDates[i]] : 0,
                Previous: previousDates[i] ? previousCounts[previousDates[i]] : 0,
            });
        }

        return chartData;
    }, [data, previousData, selectedTopic]);

    // Aggregate data for Main Topic Donut Chart
    // PER USER REQUEST: "Donut data = exact main topics set used in the bar chart"
    // When "All Main Topics" is selected, we use the barData exactly.
    // When a specific main topic is selected, we show subtopics (legacy logic) BUT without grouping "Other".
    const mainTopicData = useMemo(() => {
        const safeData = data || []; // Guard against undefined data

        // If All Main Topics, use the exact data/colors from the bar chart
        if (selectedMainTopic === 'All' || selectedMainTopic === 'All Main Topics') {
            const total = barData.reduce((sum, item) => sum + item.value, 0);
            return barData.map(item => ({
                ...item,
                fullName: item.name,
                percentage: total > 0 ? Math.round((item.value / total) * 100) : 0,
                // Colors are already assigned in barData
            }));
        }

        // If a specific topic is selected, sort and show subtopics (NO aggregation)
        // We keep the existing logic for subtopics but strictly remove "Other" per guidelines
        // "When a specific main topic is selected... do not re-introduce Others"
        const counts = {};
        const filteredData = safeData.filter(item => item.main_topic === selectedMainTopic);
        let total = 0;

        filteredData.forEach(item => {
            const topic = item.topic || 'Unknown';
            counts[topic] = (counts[topic] || 0) + 1;
            total++;
        });

        // Filter out very low frequency items (noise)
        const NOISE_THRESHOLD = 5; // Use a lower threshold for subtopics to see more detail? Or stick to 20? 
        // Sticking to 5 for subtopics as they are smaller by definition

        const subtopicData = Object.keys(counts)
            .filter(topic => counts[topic] >= NOISE_THRESHOLD && topic !== 'Other' && topic !== 'Unknown')
            .map(topic => ({
                name: topic,
                value: counts[topic],
                fullName: topic,
                percentage: total > 0 ? Math.round((counts[topic] / total) * 100) : 0
            }))
            .sort((a, b) => b.value - a.value);

        const defaultColors = ['#58A6FF', '#A371F7', '#3FB950', '#F0E050', '#FF7B72', '#DB61A2', '#D2A8FF', '#79C0FF', '#F778BA', '#56D4DD'];

        return subtopicData.map((item, index) => ({
            ...item,
            color: defaultColors[index % defaultColors.length]
        }));

    }, [barData, data, selectedMainTopic]);

    // DEBUG: Trace before render
    console.log('DashboardCharts: Ready to render', {
        barDataLen: barData ? barData.length : 'null',
        trendDataLen: trendData ? trendData.length : 'null',
        mainTopicDataLen: mainTopicData ? mainTopicData.length : 'null'
    });

    return (
        <div className="charts-grid">
            {/* Bar Chart - Topic Distribution */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                            <line x1="18" y1="20" x2="18" y2="10"></line>
                            <line x1="12" y1="20" x2="12" y2="4"></line>
                            <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                        Main Topic Distribution
                    </h3>
                </div>
                {/* Scrollable Container for Bars */}
                <div style={{ height: '350px', overflowY: 'auto', width: '100%', borderBottom: '1px solid #30363D' }}>
                    {barData.length > 0 ? (
                        <div style={{ height: Math.max(barData.length * 55, 350), width: '100%', minHeight: '350px' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={barData}
                                    layout="vertical"
                                    margin={{ top: 5, right: 100, left: 100, bottom: 0 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 148, 158, 0.1)" horizontal={false} />
                                    <XAxis type="number" hide domain={[0, 'dataMax']} />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        width={150}
                                        tick={{ fontSize: 12, fill: '#C9D1D9' }}
                                        interval={0}
                                        stroke="#30363D"
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    {/* <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(88, 166, 255, 0.08)' }} /> */}
                                    <Bar
                                        dataKey="value"
                                        radius={[0, 4, 4, 0]}
                                        barSize={28}
                                    >
                                        {
                                            barData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))
                                        }
                                        <LabelList dataKey="value" position="right" fill="#58A6FF" fontSize={12} formatter={(value) => `${value}`} />
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div style={{ height: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                            No data available
                        </div>
                    )}
                </div>
                {/* Fixed X-Axis at the bottom */}
                <div style={{ height: '40px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={barData}
                            layout="vertical"
                            margin={{ top: 0, right: 100, left: 100, bottom: 0 }}
                        >
                            <XAxis type="number" orientation="bottom" domain={[0, 'dataMax']} stroke="#30363D" tick={{ fill: '#8B949E', fontSize: 11 }} />
                            <YAxis type="category" dataKey="name" width={150} hide />
                            <Bar dataKey="value" fill="none" barSize={0} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Main Topic Breakdown - Donut Chart */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
                            <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
                        </svg>
                        {selectedMainTopic === 'All' || selectedMainTopic === 'All Main Topics' ? 'Overall Breakdown' : `${selectedMainTopic} - Subtopics`}
                    </h3>
                    <div className="topic-selector">
                        <label>Main Topic:</label>
                        <SearchableSelect
                            options={chartTopics}
                            value={selectedMainTopic}
                            onChange={(val) => {
                                // Map "All Main Topics" back to "All" if needed by internal logic, or handle gracefully
                                setSelectedMainTopic(val === 'All Main Topics' ? 'All' : val);
                            }}
                            label="Main Topic"
                            showAllOption={false} // We provide "All Main Topics" manually in the options list now
                        />
                    </div>
                </div>
                <div className="chart-container" style={{ display: 'flex', flexDirection: 'column', height: '360px', padding: '16px' }}>
                    {/* Upper/Left section: Chart */}
                    <div style={{ flex: '1', minHeight: '200px', display: 'flex', justifyContent: 'center' }}>
                        <div style={{ width: '100%', maxWidth: '300px', height: '100%' }}>
                            {mainTopicData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={mainTopicData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={2}
                                            dataKey="value"
                                        >
                                            {mainTopicData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} stroke="#1C2128" strokeWidth={2} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1C2128', borderColor: '#30363D', borderRadius: '8px', color: '#F0F6FC' }}
                                            itemStyle={{ color: '#F0F6FC' }}
                                            formatter={(value, name, props) => [`${value} (${props.payload.percentage}%)`, props.payload.fullName || props.payload.name]}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                                    No topic data
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Lower/Right section: Custom Legend */}
                    {/* On wider screens (responsive CSS handled via media queries ideally, but here via flex styles) */}
                    <div style={{ flex: '1', minHeight: '0', overflow: 'hidden', marginTop: '16px' }}>
                        <CustomLegend
                            data={mainTopicData}
                            colors={mainTopicData.map(d => d.color)}
                            maxHeight={150} // Adjust based on available height
                        />
                    </div>
                </div>
                {/* Add inline style for wider screens to make it side-by-side */}
                <style>{`
                    @media (min-width: 768px) {
                        .chart-container {
                            flex-direction: row !important;
                        }
                        .chart-container > div:first-child { /* Chart */
                            flex: 0 0 45% !important;
                            margin-right: 16px; 
                        }
                        .chart-container > div:last-child { /* Legend */
                            flex: 1 !important;
                            margin-top: 0 !important;
                            height: 100%;
                        }
                        /* Adjust legend list height in side-by-side view */
                        .legend-list {
                            max-height: 280px !important;
                        }
                    }
                `}</style>
            </div>

            {/* Trend Chart - Topic Trends Over Time */}
            <div className="card" style={{ gridColumn: '1 / -1' }}>
                <div className="card-header">
                    <div>
                        <h3 className="card-title">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                                <polyline points="17 6 23 6 23 12"></polyline>
                            </svg>
                            Topic Trends Over Time
                        </h3>
                        <p style={{ fontSize: '0.75rem', color: '#8B949E', margin: '4px 0 0 0' }}>
                            {getDateRangeText()}
                            {previousData && previousData.length > 0
                                ? ' vs Previous Period'
                                : ''}
                        </p>
                    </div>
                    <div className="topic-selector">
                        <label>Topic:</label>
                        <SearchableSelect
                            options={filteredTopics}
                            value={selectedTopic}
                            onChange={setSelectedTopic}
                            label="Topic"
                            showAllOption={false}
                        />
                    </div>
                </div>

                <div className="chart-container">
                    {trendData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#58A6FF" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#58A6FF" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorPrevious" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#A371F7" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#A371F7" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis
                                    dataKey="day"
                                    stroke="#30363D"
                                    tick={{ fill: '#8B949E', fontSize: 11 }}
                                    tickLine={false}
                                    axisLine={{ stroke: '#30363D' }}
                                />
                                <YAxis
                                    stroke="#30363D"
                                    tick={{ fill: '#8B949E', fontSize: 11 }}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip content={<TrendTooltip />} />
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 148, 158, 0.1)" vertical={false} />
                                <Legend
                                    wrapperStyle={{ paddingTop: '10px' }}
                                    iconType="circle"
                                    formatter={(value) => <span style={{ color: '#C9D1D9', fontSize: '0.8125rem' }}>{value}</span>}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="Current"
                                    stroke="#58A6FF"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorCurrent)"
                                    label={{ position: 'top', fill: '#F0F6FC', fontSize: 11 }}
                                />
                                {previousData && previousData.length > 0 && (
                                    <Area
                                        type="monotone"
                                        dataKey="Previous"
                                        stroke="#A371F7"
                                        strokeWidth={2}
                                        strokeDasharray="5 5"
                                        fillOpacity={0.5}
                                        fill="url(#colorPrevious)"
                                    />
                                )}
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                            No trend data available
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};

export default DashboardCharts;
