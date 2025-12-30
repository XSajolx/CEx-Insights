import React, { useMemo, useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    AreaChart, Area, Legend, PieChart, Pie, Cell, LabelList
} from 'recharts';
import { format, parseISO, differenceInDays, addDays } from 'date-fns';
import SearchableSelect from './SearchableSelect';
import CustomLegend from './CustomLegend';
import { TOPIC_MAPPING, QUERY_TOPIC_MAPPING, QUERY_MAIN_TOPICS } from '../utils/topicMapping';

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

const DashboardCharts = ({ data, previousData, availableTopics, availableMainTopics = [], topicDistribution = [], filters, subTab = 'issue' }) => {
    const [selectedTopic, setSelectedTopic] = useState('');
    const [selectedMainTopic, setSelectedMainTopic] = useState('All');
    const [selectedQueryMainTopic, setSelectedQueryMainTopic] = useState('All');

    // Get the active topic mapping based on the current subTab
    const activeTopicMapping = subTab === 'query' ? QUERY_TOPIC_MAPPING : TOPIC_MAPPING;
    const activeMainTopics = subTab === 'query' ? QUERY_MAIN_TOPICS : availableMainTopics;
    const activeSelectedMainTopic = subTab === 'query' ? selectedQueryMainTopic : selectedMainTopic;
    const setActiveSelectedMainTopic = subTab === 'query' ? setSelectedQueryMainTopic : setSelectedMainTopic;

    // Note: availableMainTopics is now passed as a prop from App.jsx

    // Compute filtered topics based on selected main topic (for Chart 2 and Dropdown)
    // For Query Analysis: only show query sub-topics
    // For Issue Analysis: only show actual sub-topics (not main topics)
    const filteredTopics = useMemo(() => {
        if (!data) return [];

        let candidates = new Set();

        // 1. Gather all unique sub-topics from the data first (to filter against available data)
        data.forEach(item => {
            const subTopics = Array.isArray(item.topic) ? item.topic : [item.topic];
            subTopics.forEach(t => {
                // Exclude "Challenge Rule Clarification"
                if (t && t !== 'Challenge Rule Clarification') {
                    if (subTab === 'query') {
                        // For Query Analysis: only include query sub-topics
                        if (QUERY_TOPIC_MAPPING[t]) {
                            candidates.add(t);
                        }
                    } else {
                        // For Issue Analysis: only include actual sub-topics (those in TOPIC_MAPPING)
                        if (TOPIC_MAPPING[t]) {
                            candidates.add(t);
                        }
                    }
                }
            });
        });

        const allAvailableSubTopics = [...candidates];

        if (activeSelectedMainTopic === 'All') {
            return allAvailableSubTopics.sort();
        }

        // 2. Strict Filtering using the active topic mapping (TOPIC_MAPPING or QUERY_TOPIC_MAPPING)
        // Only include sub-topics that officially map to the selected Main Topic
        const strictSubTopics = allAvailableSubTopics.filter(sub => {
            const mappedMain = activeTopicMapping[sub];
            // Match strict mapping
            if (mappedMain) {
                return mappedMain === activeSelectedMainTopic;
            }
            // Fallback disabled to enforce strictness per user request
            return false;
        });

        // 3. Fallback: If strict list empty, check data associations (legacy behavior, likely not hit if mapping is good)
        if (strictSubTopics.length === 0) {
            const associatedSubs = new Set();
            data.forEach(item => {
                const mainTopics = Array.isArray(item.main_topic) ? item.main_topic : [item.main_topic];
                if (mainTopics.includes(activeSelectedMainTopic)) {
                    const subTopics = Array.isArray(item.topic) ? item.topic : [item.topic];
                    subTopics.forEach(t => {
                        if (subTab === 'query') {
                            if (QUERY_TOPIC_MAPPING[t]) associatedSubs.add(t);
                        } else {
                            // Only add actual sub-topics, not main topics
                            if (TOPIC_MAPPING[t]) associatedSubs.add(t);
                        }
                    });
                }
            });
            return [...associatedSubs].filter(Boolean).sort();
        }

        return strictSubTopics.sort();
    }, [data, activeSelectedMainTopic, activeTopicMapping, subTab]);

    // Reset selectedTopic when main topic changes and current topic is not in filtered list
    useEffect(() => {
        if (filteredTopics.length > 0 && !filteredTopics.includes(selectedTopic)) {
            setSelectedTopic(filteredTopics[0]);
        }
    }, [activeSelectedMainTopic, filteredTopics]);

    useEffect(() => {
        if (filteredTopics.length > 0 && !selectedTopic) {
            setSelectedTopic(filteredTopics[0]);
        }
    }, [filteredTopics, selectedTopic]);

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
    const barData = useMemo(() => {
        // Color map for Issue Analysis
        const issueColorMap = {
            'Login_Issue': '#58A6FF',                        // Bright Blue
            'Payout related issue': '#3FB950',               // Green
            'Next Phase Button Missing': '#F0883E',          // Orange
            'KYC_Issue': '#A371F7',                          // Purple
            'Discount related issue': '#D2A8FF',             // Light Purple
            'Platform Issue': '#DB61A2',                     // Pink
            'Account Related Issue': '#79C0FF',              // Light Blue
            'Restriction Related Issue': '#F778BA',          // Rose
            'Delay in Receiving Customer Support': '#56D4DD', // Cyan
            'Dashboard Related Issue': '#FFD700',            // Gold
            'Trade Issue': '#00CED1',                        // Dark Turquoise
            'Other': '#FF7B72'                               // Red
        };

        // Color map for Query Analysis
        const queryColorMap = {
            'OFFER RELATED QUERY': '#FF6B9D',                // Pink
            'CHALLENGE SELECTION QUERY': '#58A6FF',          // Blue
            'PRICING & PAYMENT QUERY': '#3FB950',            // Green
            'ACCOUNT SETUP QUERY': '#F0883E',                // Orange
            'CHALLENGE RULES QUERY': '#A371F7',              // Purple
            'WITHDRAWAL & PAYOUT QUERY': '#FFD700',          // Gold
            'PERFORMANCE REWARD QUERY': '#00CED1',           // Cyan
            'PAYOUT CYCLE QUERY': '#DB61A2',                 // Pink
            'SCALE-UP PLAN QUERY': '#79C0FF',                // Light Blue
            'STELLAR INSTANT SCALE-UP QUERY': '#F778BA',     // Rose
            'KYC & VERIFICATION QUERY': '#D2A8FF',           // Light Purple
            'ACCOUNT RESET QUERY': '#56D4DD'                 // Teal
        };

        const colorMap = subTab === 'query' ? queryColorMap : issueColorMap;

        const defaultColors = [
            '#FF6B9D', '#FF8C00', '#9370DB', '#20B2AA', '#4169E1',
            '#32CD32', '#FF4500', '#DA70D6', '#00FA9A', '#FF1493',
            '#1E90FF', '#ADFF2F', '#FF6347', '#BA55D3', '#00FFFF'
        ];

        const counts = {};
        const filteredData = data || [];

        if (subTab === 'query') {
            // For Query Analysis: Count by Query Main Topics using QUERY_TOPIC_MAPPING
            console.log('Calculating barData for Query Analysis');
            filteredData.forEach(item => {
                const subTopics = Array.isArray(item.topic) ? item.topic : [item.topic];
                
                subTopics.forEach(subTopic => {
                    const mainTopic = QUERY_TOPIC_MAPPING[subTopic];
                    if (mainTopic) {
                        counts[mainTopic] = (counts[mainTopic] || 0) + 1;
                    }
                });
            });
        } else {
            // For Issue Analysis: Use main_topic directly
            console.log('Calculating barData for Issue Analysis');
            filteredData.forEach(item => {
                const topics = Array.isArray(item.main_topic) ? item.main_topic : [item.main_topic];

                if (topics.length === 0) return;

                topics.forEach(topic => {
                    const t = topic || 'Other';
                    counts[t] = (counts[t] || 0) + 1;
                });
            });
        }

        let finalData = Object.keys(counts)
            .map(topic => ({ name: topic, value: counts[topic] }))
            .filter(item => item.name !== 'Other')
            .sort((a, b) => b.value - a.value);

        const usedColors = new Set(Object.values(colorMap));
        let defaultColorIndex = 0;

        return finalData.map((item) => {
            let assignedColor = colorMap[item.name];
            if (!assignedColor) {
                while (defaultColorIndex < defaultColors.length && usedColors.has(defaultColors[defaultColorIndex])) {
                    defaultColorIndex++;
                }
                assignedColor = defaultColors[defaultColorIndex % defaultColors.length];
                usedColors.add(assignedColor);
                defaultColorIndex++;
            }
            return { ...item, color: assignedColor };
        });
    }, [data, filters, subTab]);

    // Derived available topics for the dropdown - MUST match what is shown in the charts
    const chartTopics = useMemo(() => {
        if (subTab === 'query') {
            // For query analysis, show main topics that have data
            const topicsWithData = barData.map(d => d.name);
            return ['All Main Topics', ...topicsWithData];
        }
        return ['All Main Topics', ...barData.map(d => d.name)];
    }, [barData, subTab]);

    // Aggregate data for Trend Chart (Comparison)
    // For Query Analysis: only count if the topic is a query sub-topic
    const trendData = useMemo(() => {
        if (!selectedTopic || !data) return [];

        // For Query Analysis: verify the selected topic is a query sub-topic
        if (subTab === 'query' && !QUERY_TOPIC_MAPPING[selectedTopic]) {
            return [];
        }

        const processData = (dataset) => {
            const dailyCounts = {};
            if (!dataset) return dailyCounts;

            dataset.forEach(item => {
                // Check if selectedTopic is in item.topic array
                const subTopics = Array.isArray(item.topic) ? item.topic : [item.topic];

                if (subTopics.includes(selectedTopic)) {
                    const date = item.created_date_bd;
                    dailyCounts[date] = (dailyCounts[date] || 0) + 1;
                }
            });
            return dailyCounts;
        };

        const currentCounts = processData(data);
        const previousCounts = processData(previousData || []);

        const getSortedDates = (counts) => Object.keys(counts).sort();
        const currentDates = getSortedDates(currentCounts);
        const previousDates = getSortedDates(previousCounts);

        const maxDays = Math.max(currentDates.length, previousDates.length);
        const chartData = [];

        if (maxDays === 0) return [];

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
    }, [data, previousData, selectedTopic, subTab]);

    // Aggregate data for Main Topic Donut Chart
    const mainTopicData = useMemo(() => {
        const safeData = data || [];

        // If All Main Topics, use the exact data/colors from the bar chart
        if (activeSelectedMainTopic === 'All' || activeSelectedMainTopic === 'All Main Topics') {
            const total = barData.reduce((sum, item) => sum + item.value, 0);
            return barData.map(item => ({
                ...item,
                fullName: item.name,
                percentage: total > 0 ? Math.round((item.value / total) * 100) : 0,
            }));
        }

        // If a specific topic is selected, sort and show subtopics
        const counts = {};
        let total = 0;

        if (subTab === 'query') {
            // For Query Analysis: Find subtopics that map to the selected query main topic
            safeData.forEach(item => {
                const subTopics = Array.isArray(item.topic) ? item.topic : [item.topic];

                subTopics.forEach(sub => {
                    const mappedMain = QUERY_TOPIC_MAPPING[sub];
                    if (mappedMain === activeSelectedMainTopic) {
                        const topic = sub || 'Unknown';
                        counts[topic] = (counts[topic] || 0) + 1;
                        total++;
                    }
                });
            });
        } else {
            // For Issue Analysis: Use main_topic matching
            safeData.forEach(item => {
                const mainTopics = Array.isArray(item.main_topic) ? item.main_topic : [item.main_topic];

                // Only consider items that match the selected main topic
                if (mainTopics.includes(activeSelectedMainTopic)) {

                    const subTopics = Array.isArray(item.topic) ? item.topic : [item.topic];

                    subTopics.forEach(sub => {
                        // STRICT FILTERING: Only count sub-topics that officially map to this Main Topic.
                        const mappedMain = TOPIC_MAPPING[sub];

                        if (mappedMain === activeSelectedMainTopic) {
                            const topic = sub || 'Unknown';
                            counts[topic] = (counts[topic] || 0) + 1;
                            total++;
                        }
                    });
                }
            });
        }

        // Filter out very low frequency items (noise)
        const NOISE_THRESHOLD = 1; // Explicitly set to 1 to show all valid mapped items

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

    }, [barData, data, activeSelectedMainTopic, subTab]);

    // Aggregate ALL sub-topics data for the standalone scrollable bar chart
    // For Query Analysis: only show sub-topics that map to query main topics
    // For Issue Analysis: only show sub-topics that map to issue main topics (exclude main topics themselves)
    const allSubTopicsData = useMemo(() => {
        const safeData = data || [];
        const counts = {};
        let total = 0;

        // Color palette for sub-topics (matching main topic distribution style)
        const subTopicColors = [
            '#58A6FF', '#3FB950', '#A371F7', '#F0883E', '#FF6B9D',
            '#DB61A2', '#79C0FF', '#56D4DD', '#FFD700', '#00CED1',
            '#D2A8FF', '#F778BA', '#FF7B72', '#9370DB', '#20B2AA',
            '#4169E1', '#32CD32', '#FF4500', '#DA70D6', '#00FA9A'
        ];

        safeData.forEach(item => {
            const subTopics = Array.isArray(item.topic) ? item.topic : [item.topic];

            subTopics.forEach(sub => {
                // Exclude "Other", "Unknown", and "Challenge Rule Clarification"
                if (sub && !sub.toLowerCase().includes('other') && sub !== 'Unknown' && sub !== 'Challenge Rule Clarification') {
                    if (subTab === 'query') {
                        // For Query Analysis: only count sub-topics that are in QUERY_TOPIC_MAPPING
                        if (QUERY_TOPIC_MAPPING[sub]) {
                            counts[sub] = (counts[sub] || 0) + 1;
                            total++;
                        }
                    } else {
                        // For Issue Analysis: only count sub-topics that are in TOPIC_MAPPING
                        // This excludes main topics like "Login_Issue", "KYC_Issue" etc.
                        if (TOPIC_MAPPING[sub]) {
                            counts[sub] = (counts[sub] || 0) + 1;
                            total++;
                        }
                    }
                }
            });
        });

        const subtopicData = Object.keys(counts)
            .map(topic => ({
                name: topic,
                value: counts[topic],
                fullName: topic,
                percentage: total > 0 ? Math.round((counts[topic] / total) * 100) : 0
            }))
            .sort((a, b) => b.value - a.value)
            .map((item, index) => ({
                ...item,
                color: subTopicColors[index % subTopicColors.length]
            }));

        return subtopicData;
    }, [data, subTab]);

    // DEBUG: Trace before render
    console.log('DashboardCharts: Ready to render', {
        barDataLen: barData ? barData.length : 'null',
        trendDataLen: trendData ? trendData.length : 'null',
        mainTopicDataLen: mainTopicData ? mainTopicData.length : 'null'
    });

    // Aggregated constants/labels for cleaner code
    const labels = useMemo(() => {
        if (subTab === 'query') {
            return {
                areaTitle: 'Query Area',
                distributionTitle: 'Query Distribution',
                topTitle: 'Top Queries',
                trendTitle: 'Query Trends Over Time'
            };
        }
        return {
            areaTitle: 'Main Topic Distribution',
            distributionTitle: 'Overall Breakdown',
            topTitle: 'Top Issues',
            trendTitle: 'Issue Trends Over Time'
        };
    }, [subTab]);

    return (
        <div className="charts-grid">
            {/* Chart 1: Issue/Query Area (Vertical Bar) */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                            <line x1="18" y1="20" x2="18" y2="10"></line>
                            <line x1="12" y1="20" x2="12" y2="4"></line>
                            <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                        {labels.areaTitle}
                    </h3>
                </div>
                <div style={{ height: '350px', overflowY: 'auto', width: '100%' }}>
                    {barData.length > 0 ? (
                        <div style={{ height: Math.max(barData.length * 45, 350), width: '100%', minHeight: '350px' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={barData}
                                    layout="vertical"
                                    margin={{ top: 5, right: 60, left: 140, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 148, 158, 0.1)" horizontal={false} />
                                    <XAxis type="number" stroke="#30363D" tick={{ fill: '#8B949E', fontSize: 10 }} />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        width={130}
                                        tick={{ fontSize: 11, fill: '#C9D1D9' }}
                                        interval={0}
                                        stroke="#30363D"
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Bar
                                        dataKey="value"
                                        radius={[0, 4, 4, 0]}
                                        barSize={24}
                                    >
                                        {
                                            barData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={subTab === 'issue' ? entry.color : '#2563EB'} />
                                            ))
                                        }
                                        <LabelList dataKey="value" position="right" fill="#E5E7EB" fontSize={11} />
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
            </div>

            {/* Chart 2: Issues/Query Distribution (Pie Chart) */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
                            <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
                        </svg>
                        {labels.distributionTitle}
                    </h3>
                    <div className="topic-selector">
                        <label>{subTab === 'query' ? 'Query Category:' : 'Main Topic:'}</label>
                        <SearchableSelect
                            options={chartTopics}
                            value={activeSelectedMainTopic}
                            onChange={(val) => setActiveSelectedMainTopic(val === 'All Main Topics' ? 'All' : val)}
                            label={subTab === 'query' ? 'Query Category' : 'Main Topic'}
                            showAllOption={false}
                        />
                    </div>
                </div>
                <div className="chart-container" style={{ display: 'flex', flexDirection: 'column', height: '360px', padding: '16px' }}>
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

                    <div style={{ flex: '1', minHeight: '0', overflow: 'hidden', marginTop: '16px' }}>
                        <CustomLegend
                            data={mainTopicData}
                            colors={mainTopicData.map(d => d.color)}
                            maxHeight={150}
                        />
                    </div>
                </div>
                <style>{`
                    @media (min-width: 768px) {
                        .chart-container {
                            flex-direction: row !important;
                        }
                        .chart-container > div:first-child { 
                            flex: 0 0 45% !important;
                            margin-right: 16px; 
                        }
                        .chart-container > div:last-child { 
                            flex: 1 !important;
                            margin-top: 0 !important;
                            height: 100%;
                        }
                        .legend-list {
                            max-height: 280px !important;
                        }
                    }
                `}</style>
            </div>

            {/* Charts Row: Sub-Topics and Trend Chart Side by Side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', gridColumn: '1 / -1' }}>
                {/* Chart 3: All Sub-Topics (Scrollable Bar Chart) */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="3" y1="9" x2="21" y2="9"></line>
                                <line x1="9" y1="21" x2="9" y2="9"></line>
                            </svg>
                            {subTab === 'query' ? 'All Query Sub-Topics' : 'All Issue Sub-Topics'}
                        </h3>
                        <span style={{ fontSize: '0.75rem', color: '#8B949E' }}>
                            {allSubTopicsData.length} sub-topics
                        </span>
                    </div>
                    <div style={{ height: '400px', overflowY: 'auto', width: '100%' }}>
                        {allSubTopicsData.length > 0 ? (
                            <div style={{ height: Math.max(allSubTopicsData.length * 36, 400), width: '100%', minHeight: '400px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={allSubTopicsData}
                                        layout="vertical"
                                        margin={{ top: 5, right: 50, left: 140, bottom: 5 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 148, 158, 0.1)" horizontal={false} />
                                        <XAxis type="number" stroke="#30363D" tick={{ fill: '#8B949E', fontSize: 10 }} />
                                        <YAxis
                                            type="category"
                                            dataKey="name"
                                            width={130}
                                            tick={{ fontSize: 11, fill: '#C9D1D9' }}
                                            interval={0}
                                            stroke="#30363D"
                                            tickLine={false}
                                            axisLine={false}
                                        />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#1C2128', borderColor: '#30363D', borderRadius: '8px', color: '#F0F6FC' }}
                                            formatter={(value, name, props) => [`${value} conversations`, props.payload.fullName]}
                                        />
                                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={24}>
                                            {allSubTopicsData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                            <LabelList dataKey="value" position="right" fill="#E5E7EB" fontSize={11} />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div style={{ height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                                No sub-topic data available
                            </div>
                        )}
                    </div>
                </div>

                {/* Chart 4: Trend Chart */}
                <div className="card">
                    <div className="card-header">
                        <div>
                            <h3 className="card-title">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="card-title-icon">
                                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                                    <polyline points="17 6 23 6 23 12"></polyline>
                                </svg>
                                {labels.trendTitle}
                            </h3>
                            <p style={{ fontSize: '0.75rem', color: '#8B949E', margin: '4px 0 0 0' }}>
                                {getDateRangeText()}
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

                    <div style={{ height: '400px', padding: '16px 0' }}>
                        {trendData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#38BDF8" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis
                                        dataKey="day"
                                        stroke="#30363D"
                                        tick={{ fill: '#8B949E', fontSize: 10 }}
                                        tickLine={false}
                                        axisLine={{ stroke: '#30363D' }}
                                    />
                                    <YAxis
                                        stroke="#30363D"
                                        tick={{ fill: '#8B949E', fontSize: 10 }}
                                        tickLine={false}
                                        axisLine={false}
                                    />
                                    <Tooltip content={<TrendTooltip />} />
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 148, 158, 0.1)" vertical={false} />
                                    <Area
                                        type="monotone"
                                        dataKey="Current"
                                        stroke="#38BDF8"
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill="url(#colorCurrent)"
                                    >
                                        <LabelList 
                                            dataKey="Current" 
                                            position="top" 
                                            fill="#38BDF8" 
                                            fontSize={11} 
                                            fontWeight={600}
                                            offset={8}
                                        />
                                    </Area>
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>
                                No trend data available
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DashboardCharts;
