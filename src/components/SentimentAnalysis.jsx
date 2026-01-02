import React, { useState, useMemo } from 'react';
import {
    PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    AreaChart, Area, Legend, LabelList, LineChart, Line, ReferenceLine, ComposedChart
} from 'recharts';
import { format, parseISO, subMonths } from 'date-fns';
import ConversationList from './ConversationList';
import { TOPIC_MAPPING, QUERY_TOPIC_MAPPING } from '../utils/topicMapping';

// Sentiment colors
const SENTIMENT_COLORS = {
    'Positive': '#10B981',
    'Neutral': '#6B7280',
    'Negative': '#EF4444'
};

const SentimentAnalysis = ({ data = [], filters }) => {
    const [showDrillIn, setShowDrillIn] = useState(false);
    const [drillInData, setDrillInData] = useState({ conversations: [], title: '' });
    const [compareMode, setCompareMode] = useState(false);

    // Calculate sentiment statistics
    const sentimentStats = useMemo(() => {
        if (!data || data.length === 0) {
            return { total: 0, positive: 0, neutral: 0, negative: 0, score: 0 };
        }

        let positive = 0, neutral = 0, negative = 0;
        data.forEach(conv => {
            const sentiment = conv.sentiment?.toLowerCase() || '';
            if (sentiment === 'positive') positive++;
            else if (sentiment === 'negative') negative++;
            else neutral++;
        });

        const total = data.length;
        const score = total > 0 ? ((positive / total) * 100).toFixed(1) : 0;

        return { total, positive, neutral, negative, score };
    }, [data]);

    // Sentiment correlation with client outcomes
    const outcomeCorrelation = useMemo(() => {
        if (!data || data.length === 0) return [];

        const stats = { Positive: { yes: 0, no: 0 }, Neutral: { yes: 0, no: 0 }, Negative: { yes: 0, no: 0 } };
        
        data.forEach(conv => {
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            const favor = conv.clientFavor?.toLowerCase() || '';
            const key = sentiment === 'positive' ? 'Positive' : sentiment === 'negative' ? 'Negative' : 'Neutral';
            
            if (favor === 'yes') stats[key].yes++;
            else if (favor === 'no') stats[key].no++;
        });

        return ['Positive', 'Neutral', 'Negative'].map(s => ({
            sentiment: s,
            'In Favor': stats[s].yes,
            'Not in Favor': stats[s].no,
            total: stats[s].yes + stats[s].no,
            favorRate: stats[s].yes + stats[s].no > 0 
                ? ((stats[s].yes / (stats[s].yes + stats[s].no)) * 100).toFixed(0) 
                : 0
        }));
    }, [data]);

    // Sentiment trend over time with previous period comparison
    const trendData = useMemo(() => {
        if (!data || data.length === 0) return { current: [], previous: [] };

        const currentMap = {};
        const previousMap = {};
        const now = new Date();
        const oneMonthAgo = subMonths(now, 1);
        
        data.forEach(conv => {
            const dateStr = conv.created_date_bd;
            if (!dateStr) return;
            
            const date = dateStr.split('T')[0];
            const convDate = parseISO(date);
            
            // Current period
            if (!currentMap[date]) {
                currentMap[date] = { date, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
            }
            
            const sentiment = conv.sentiment?.toLowerCase() || '';
            currentMap[date].total++;
            if (sentiment === 'positive') currentMap[date].Positive++;
            else if (sentiment === 'negative') currentMap[date].Negative++;
            else currentMap[date].Neutral++;
        });

        const current = Object.values(currentMap)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(d => ({
                ...d,
                positiveRate: d.total > 0 ? ((d.Positive / d.total) * 100).toFixed(1) : 0
            }));

        return { current, previous: [] };
    }, [data]);

    // Issue Area (Main Topics from TOPIC_MAPPING) x Sentiment
    const issueAreaData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const areaMap = {};
        const mainTopicSet = new Set(Object.values(TOPIC_MAPPING));
        
        data.forEach(conv => {
            const mainTopics = Array.isArray(conv.main_topic) ? conv.main_topic : [conv.main_topic];
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            mainTopics.forEach(topic => {
                if (!topic || !mainTopicSet.has(topic)) return;
                
                if (!areaMap[topic]) {
                    areaMap[topic] = { name: topic, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
                }
                areaMap[topic].total++;
                if (sentiment === 'positive') areaMap[topic].Positive++;
                else if (sentiment === 'negative') areaMap[topic].Negative++;
                else areaMap[topic].Neutral++;
            });
        });

        return Object.values(areaMap)
            .filter(d => d.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 10)
            .map(d => ({
                ...d,
                PositivePct: ((d.Positive / d.total) * 100).toFixed(0),
                NeutralPct: ((d.Neutral / d.total) * 100).toFixed(0),
                NegativePct: ((d.Negative / d.total) * 100).toFixed(0)
            }));
    }, [data]);

    // Issues (Sub-Topics) x Sentiment
    const issuesData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const issueMap = {};
        
        data.forEach(conv => {
            const topics = Array.isArray(conv.topic) ? conv.topic : [conv.topic];
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            // Only count issue-related sub-topics (not query-related)
            topics.forEach(topic => {
                if (!topic) return;
                // Check if it's in TOPIC_MAPPING (issue) not QUERY_TOPIC_MAPPING
                const isIssue = Object.keys(TOPIC_MAPPING).includes(topic);
                if (!isIssue) return;
                
                if (!issueMap[topic]) {
                    issueMap[topic] = { name: topic, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
                }
                issueMap[topic].total++;
                if (sentiment === 'positive') issueMap[topic].Positive++;
                else if (sentiment === 'negative') issueMap[topic].Negative++;
                else issueMap[topic].Neutral++;
            });
        });

        return Object.values(issueMap)
            .filter(d => d.total > 0)
            .sort((a, b) => b.Negative - a.Negative)
            .slice(0, 15);
    }, [data]);

    // Query Area (Main Topics from QUERY_TOPIC_MAPPING) x Sentiment
    const queryAreaData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const areaMap = {};
        const queryMainTopics = new Set(Object.values(QUERY_TOPIC_MAPPING));
        
        data.forEach(conv => {
            const mainTopics = Array.isArray(conv.main_topic) ? conv.main_topic : [conv.main_topic];
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            mainTopics.forEach(topic => {
                if (!topic || !queryMainTopics.has(topic)) return;
                
                if (!areaMap[topic]) {
                    areaMap[topic] = { name: topic, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
                }
                areaMap[topic].total++;
                if (sentiment === 'positive') areaMap[topic].Positive++;
                else if (sentiment === 'negative') areaMap[topic].Negative++;
                else areaMap[topic].Neutral++;
            });
        });

        return Object.values(areaMap)
            .filter(d => d.total > 0)
            .sort((a, b) => b.total - a.total)
            .map(d => ({
                ...d,
                PositivePct: ((d.Positive / d.total) * 100).toFixed(0),
                NeutralPct: ((d.Neutral / d.total) * 100).toFixed(0),
                NegativePct: ((d.Negative / d.total) * 100).toFixed(0)
            }));
    }, [data]);

    // Query (Sub-Topics) x Sentiment
    const queryData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const queryMap = {};
        
        data.forEach(conv => {
            const topics = Array.isArray(conv.topic) ? conv.topic : [conv.topic];
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            topics.forEach(topic => {
                if (!topic) return;
                // Check if it's in QUERY_TOPIC_MAPPING
                const isQuery = Object.keys(QUERY_TOPIC_MAPPING).includes(topic);
                if (!isQuery) return;
                
                if (!queryMap[topic]) {
                    queryMap[topic] = { name: topic, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
                }
                queryMap[topic].total++;
                if (sentiment === 'positive') queryMap[topic].Positive++;
                else if (sentiment === 'negative') queryMap[topic].Negative++;
                else queryMap[topic].Neutral++;
            });
        });

        return Object.values(queryMap)
            .filter(d => d.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 15);
    }, [data]);

    // Channel x Sentiment
    const channelData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const channelMap = {};
        
        data.forEach(conv => {
            const channel = conv.channel || 'Unknown';
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            if (!channelMap[channel]) {
                channelMap[channel] = { name: channel, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
            }
            channelMap[channel].total++;
            if (sentiment === 'positive') channelMap[channel].Positive++;
            else if (sentiment === 'negative') channelMap[channel].Negative++;
            else channelMap[channel].Neutral++;
        });

        return Object.values(channelMap)
            .filter(d => d.total > 0 && d.name !== 'Unknown')
            .sort((a, b) => b.total - a.total);
    }, [data]);

    // Country x Sentiment
    const countryData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const countryMap = {};
        
        data.forEach(conv => {
            const country = conv.country || 'Unknown';
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            if (!countryMap[country]) {
                countryMap[country] = { name: country, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
            }
            countryMap[country].total++;
            if (sentiment === 'positive') countryMap[country].Positive++;
            else if (sentiment === 'negative') countryMap[country].Negative++;
            else countryMap[country].Neutral++;
        });

        return Object.values(countryMap)
            .filter(d => d.total > 0 && d.name !== 'Unknown')
            .sort((a, b) => b.total - a.total)
            .slice(0, 12);
    }, [data]);

    // Word frequency for word cloud
    const wordCloudData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const wordMap = {};
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'after', 'before', 'when', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'user', 'agent', 'hi', 'hello', 'thank', 'thanks', 'please', 'yes', 'no', 'ok', 'okay']);
        
        data.forEach(conv => {
            if (!conv.transcript) return;
            const words = conv.transcript.toLowerCase()
                .replace(/[^a-z\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 3 && !stopWords.has(w));
            
            words.forEach(word => {
                wordMap[word] = (wordMap[word] || 0) + 1;
            });
        });

        return Object.entries(wordMap)
            .map(([word, count]) => ({ word, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);
    }, [data]);

    // Handle drill-in
    const handleDrillIn = (filterFn, title) => {
        const filtered = data.filter(filterFn);
        setDrillInData({ conversations: filtered, title: `${title} (${filtered.length} conversations)` });
        setShowDrillIn(true);
    };

    // Custom tooltip
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    background: 'rgba(13, 17, 23, 0.95)',
                    border: '1px solid #30363D',
                    borderRadius: '8px',
                    padding: '12px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
                }}>
                    <p style={{ margin: '0 0 8px 0', color: '#F0F6FC', fontWeight: '600' }}>{label}</p>
                    {payload.map((entry, index) => (
                        <p key={index} style={{ margin: '4px 0', color: entry.color, fontSize: '0.875rem' }}>
                            {entry.name}: {entry.value}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    const cardStyle = {
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '12px',
        padding: '1.25rem'
    };

    const headerStyle = {
        margin: '0 0 1rem 0',
        fontSize: '0.875rem',
        fontWeight: '600',
        color: '#F0F6FC',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    };

    return (
        <div style={{ padding: '0 2rem 2rem 2rem' }}>
            {/* Header */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#F0F6FC', margin: '0 0 0.5rem 0' }}>
                        Sentiment Analysis
                    </h1>
                    <p style={{ color: '#8B949E', fontSize: '0.875rem', margin: 0 }}>
                        Comprehensive sentiment insights across conversations
                    </p>
                </div>
                <button
                    onClick={() => setCompareMode(!compareMode)}
                    style={{
                        padding: '8px 16px',
                        background: compareMode ? 'rgba(88, 166, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${compareMode ? '#58A6FF' : 'rgba(255, 255, 255, 0.1)'}`,
                        borderRadius: '8px',
                        color: compareMode ? '#58A6FF' : '#8B949E',
                        fontSize: '0.875rem',
                        cursor: 'pointer'
                    }}
                >
                    📊 Compare Mode {compareMode ? 'ON' : 'OFF'}
                </button>
            </div>

            {/* Row 1: Scorecards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                {/* Sentiment Score Holistic */}
                <div style={{
                    ...cardStyle,
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.02) 100%)',
                    border: '1px solid rgba(16, 185, 129, 0.2)'
                }}>
                    <h3 style={headerStyle}>
                        <span>📊</span> Sentiment Score
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontSize: '3rem', fontWeight: '700', color: '#10B981' }}>
                            {sentimentStats.score}%
                        </span>
                        <span style={{ color: '#8B949E', fontSize: '1rem' }}>positive</span>
                    </div>
                    <div style={{ marginTop: '1rem', display: 'flex', gap: '1.5rem' }}>
                        <div>
                            <span style={{ color: '#10B981', fontSize: '1.25rem', fontWeight: '600' }}>{sentimentStats.positive}</span>
                            <span style={{ color: '#8B949E', fontSize: '0.75rem', marginLeft: '4px' }}>Positive</span>
                        </div>
                        <div>
                            <span style={{ color: '#6B7280', fontSize: '1.25rem', fontWeight: '600' }}>{sentimentStats.neutral}</span>
                            <span style={{ color: '#8B949E', fontSize: '0.75rem', marginLeft: '4px' }}>Neutral</span>
                        </div>
                        <div>
                            <span style={{ color: '#EF4444', fontSize: '1.25rem', fontWeight: '600' }}>{sentimentStats.negative}</span>
                            <span style={{ color: '#8B949E', fontSize: '0.75rem', marginLeft: '4px' }}>Negative</span>
                        </div>
                    </div>
                </div>

                {/* Sentiment Correlation with Outcomes */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}>
                        <span>🎯</span> Sentiment vs Client Outcome
                    </h3>
                    <ResponsiveContainer width="100%" height={120}>
                        <BarChart data={outcomeCorrelation} layout="vertical">
                            <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="sentiment" tick={{ fill: '#C9D1D9', fontSize: 11 }} axisLine={false} width={70} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="In Favor" stackId="a" fill="#10B981" />
                            <Bar dataKey="Not in Favor" stackId="a" fill="#EF4444" radius={[0, 4, 4, 0]}>
                                <LabelList 
                                    dataKey="favorRate" 
                                    position="right" 
                                    formatter={(v) => `${v}%`}
                                    style={{ fill: '#C9D1D9', fontSize: 10 }}
                                />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <p style={{ color: '#6B7280', fontSize: '0.7rem', margin: '8px 0 0 0', textAlign: 'center' }}>
                        % shows rate of outcomes in client's favor
                    </p>
                </div>
            </div>

            {/* Row 2: Sentiment Trend */}
            <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ ...headerStyle, margin: 0 }}>
                        <span>📈</span> Sentiment Trend Over Time
                    </h3>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={trendData.current}>
                        <defs>
                            <linearGradient id="positiveGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <XAxis 
                            dataKey="date" 
                            tick={{ fill: '#8B949E', fontSize: 10 }}
                            tickFormatter={(val) => { try { return format(parseISO(val), 'MMM d'); } catch { return val; } }}
                            axisLine={{ stroke: '#30363D' }}
                        />
                        <YAxis tick={{ fill: '#8B949E', fontSize: 10 }} axisLine={{ stroke: '#30363D' }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend verticalAlign="top" height={36} />
                        <Area type="monotone" dataKey="Positive" stroke="#10B981" fill="url(#positiveGrad)" strokeWidth={2} />
                        <Area type="monotone" dataKey="Neutral" stroke="#6B7280" fill="rgba(107, 114, 128, 0.1)" strokeWidth={2} />
                        <Area type="monotone" dataKey="Negative" stroke="#EF4444" fill="rgba(239, 68, 68, 0.1)" strokeWidth={2} />
                        {/* Trendline for positive rate */}
                        <Line type="monotone" dataKey="positiveRate" stroke="#38BDF8" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Positive %" />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Row 3: Issue Area x Sentiment + Issues x Sentiment */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                {/* Issue Area (Main Topics) x Sentiment - 100% Stacked */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>📋</span> Issue Area x Sentiment</h3>
                    <p style={{ color: '#6B7280', fontSize: '0.7rem', margin: '-8px 0 8px 0' }}>Click bar to drill-in</p>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={issueAreaData} layout="vertical">
                            <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                            <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 10 }} width={120} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="PositivePct" stackId="a" fill="#10B981" name="Positive %" onClick={(d) => handleDrillIn(c => c.main_topic?.includes(d.name) && c.sentiment?.toLowerCase() === 'positive', `${d.name} - Positive`)} style={{ cursor: 'pointer' }} />
                            <Bar dataKey="NeutralPct" stackId="a" fill="#6B7280" name="Neutral %" onClick={(d) => handleDrillIn(c => c.main_topic?.includes(d.name) && !['positive', 'negative'].includes(c.sentiment?.toLowerCase()), `${d.name} - Neutral`)} style={{ cursor: 'pointer' }} />
                            <Bar dataKey="NegativePct" stackId="a" fill="#EF4444" name="Negative %" onClick={(d) => handleDrillIn(c => c.main_topic?.includes(d.name) && c.sentiment?.toLowerCase() === 'negative', `${d.name} - Negative`)} style={{ cursor: 'pointer' }} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Issues (Sub-Topics) x Sentiment */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>⚠️</span> Issues x Sentiment</h3>
                    <p style={{ color: '#6B7280', fontSize: '0.7rem', margin: '-8px 0 8px 0' }}>Sorted by negative count</p>
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        <ResponsiveContainer width="100%" height={Math.max(300, issuesData.length * 28)}>
                            <BarChart data={issuesData} layout="vertical">
                                <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} />
                                <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 9 }} width={140} />
                                <Tooltip content={<CustomTooltip />} />
                                <Bar dataKey="Positive" stackId="a" fill="#10B981" />
                                <Bar dataKey="Neutral" stackId="a" fill="#6B7280" />
                                <Bar dataKey="Negative" stackId="a" fill="#EF4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Row 4: Query Area x Sentiment + Query x Sentiment */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                {/* Query Area (Main Topics) x Sentiment - 100% Stacked */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>❓</span> Query Area x Sentiment</h3>
                    <p style={{ color: '#6B7280', fontSize: '0.7rem', margin: '-8px 0 8px 0' }}>Click bar to drill-in</p>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={queryAreaData} layout="vertical">
                            <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                            <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 10 }} width={120} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="PositivePct" stackId="a" fill="#10B981" name="Positive %" style={{ cursor: 'pointer' }} />
                            <Bar dataKey="NeutralPct" stackId="a" fill="#6B7280" name="Neutral %" style={{ cursor: 'pointer' }} />
                            <Bar dataKey="NegativePct" stackId="a" fill="#EF4444" name="Negative %" style={{ cursor: 'pointer' }} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Query (Sub-Topics) x Sentiment */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>💬</span> Query x Sentiment</h3>
                    <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                        <ResponsiveContainer width="100%" height={Math.max(250, queryData.length * 25)}>
                            <BarChart data={queryData} layout="vertical">
                                <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} />
                                <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 9 }} width={140} />
                                <Tooltip content={<CustomTooltip />} />
                                <Bar dataKey="Positive" stackId="a" fill="#10B981" />
                                <Bar dataKey="Neutral" stackId="a" fill="#6B7280" />
                                <Bar dataKey="Negative" stackId="a" fill="#EF4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Row 5: Channel x Sentiment + Country x Sentiment */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                {/* Channel x Sentiment (Pie Chart) */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>📱</span> Channel x Sentiment</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie
                                data={channelData}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={80}
                                dataKey="total"
                                nameKey="name"
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                labelLine={false}
                            >
                                {channelData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={['#58A6FF', '#A371F7', '#F97316', '#10B981', '#EF4444'][index % 5]} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Country x Sentiment (Bar Chart) */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>🌍</span> Country x Sentiment</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={countryData}>
                            <XAxis dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 9 }} angle={-45} textAnchor="end" height={60} />
                            <YAxis tick={{ fill: '#8B949E', fontSize: 10 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend verticalAlign="top" height={36} />
                            <Bar dataKey="Positive" stackId="a" fill="#10B981" />
                            <Bar dataKey="Neutral" stackId="a" fill="#6B7280" />
                            <Bar dataKey="Negative" stackId="a" fill="#EF4444" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Row 6: Word Cloud + Sentiment Shift */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                {/* Word Cloud (Reference) */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>☁️</span> Word Cloud (Top Keywords)</h3>
                    <div style={{ 
                        position: 'relative',
                        height: '320px',
                        width: '100%',
                        overflow: 'hidden',
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 100%)',
                        borderRadius: '8px'
                    }}>
                        {wordCloudData.slice(0, 50).map((item, index) => {
                            // Calculate size based on frequency (logarithmic scale for better distribution)
                            const maxCount = wordCloudData[0]?.count || 1;
                            const minSize = 10;
                            const maxSize = 48;
                            const size = minSize + ((Math.log(item.count + 1) / Math.log(maxCount + 1)) * (maxSize - minSize));
                            
                            // Color palette matching reference image
                            const colors = [
                                '#E8B86D', '#98D8AA', '#7B68EE', '#FF6B6B', '#4ECDC4', 
                                '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#87CEEB',
                                '#F0E68C', '#98FB98', '#DEB887', '#B0C4DE', '#FFB6C1',
                                '#20B2AA', '#778899', '#BC8F8F', '#DAA520', '#CD853F'
                            ];
                            const color = colors[index % colors.length];
                            
                            // Pseudo-random positioning using seeded random based on word
                            const seed = item.word.charCodeAt(0) + item.word.charCodeAt(item.word.length - 1) * 7;
                            const row = Math.floor(index / 7);
                            const col = index % 7;
                            
                            // Grid-based positioning with randomization
                            const baseX = (col * 14) + 3;
                            const baseY = (row * 14) + 8;
                            const offsetX = ((seed * 17) % 10) - 5;
                            const offsetY = ((seed * 13) % 10) - 5;
                            const left = Math.max(2, Math.min(85, baseX + offsetX));
                            const top = Math.max(5, Math.min(85, baseY + offsetY));
                            
                            // Some words rotated
                            const rotation = ((seed % 5) === 0) ? -90 : ((seed % 7) === 0) ? 90 : 0;
                            
                            return (
                                <span
                                    key={item.word}
                                    style={{
                                        position: 'absolute',
                                        left: `${left}%`,
                                        top: `${top}%`,
                                        fontSize: `${size}px`,
                                        fontWeight: size > 24 ? '700' : size > 16 ? '600' : '500',
                                        color: color,
                                        transform: `rotate(${rotation}deg)`,
                                        whiteSpace: 'nowrap',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                                        fontFamily: 'system-ui, -apple-system, sans-serif'
                                    }}
                                    onMouseEnter={e => {
                                        e.target.style.transform = `rotate(${rotation}deg) scale(1.15)`;
                                        e.target.style.zIndex = '10';
                                    }}
                                    onMouseLeave={e => {
                                        e.target.style.transform = `rotate(${rotation}deg) scale(1)`;
                                        e.target.style.zIndex = '1';
                                    }}
                                    title={`${item.word}: ${item.count} occurrences`}
                                >
                                    {item.word}
                                </span>
                            );
                        })}
                        {wordCloudData.length === 0 && (
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                height: '100%',
                                color: '#6B7280', 
                                fontSize: '0.875rem' 
                            }}>
                                No transcript data available for word cloud
                            </div>
                        )}
                    </div>
                </div>

                {/* Sentiment Shift (Placeholder for Sankey) */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>🔄</span> Sentiment Shift</h3>
                    <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        minHeight: '200px',
                        color: '#6B7280',
                        textAlign: 'center'
                    }}>
                        <p style={{ fontSize: '0.875rem', margin: '0 0 1rem 0' }}>
                            Sankey chart showing sentiment transitions requires before/after sentiment data.
                        </p>
                        <p style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                            Coming soon: Track how sentiments change throughout conversation lifecycle.
                        </p>
                    </div>
                </div>
            </div>

            {/* Drill-in Modal */}
            {showDrillIn && (
                <ConversationList
                    conversations={drillInData.conversations}
                    title={drillInData.title}
                    onClose={() => setShowDrillIn(false)}
                    mode="sentiment"
                />
            )}
        </div>
    );
};

export default SentimentAnalysis;
