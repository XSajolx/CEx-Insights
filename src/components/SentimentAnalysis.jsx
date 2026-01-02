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

    // Issue Area (Sub-Topics from TOPIC_MAPPING) x Sentiment - 100% stacked bar
    const issueAreaData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const areaMap = {};
        const issueSubTopics = new Set(Object.keys(TOPIC_MAPPING)); // Sub-topics that are issues
        
        data.forEach(conv => {
            const subTopics = Array.isArray(conv.topic) ? conv.topic : [conv.topic];
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            subTopics.forEach(topic => {
                if (!topic || !issueSubTopics.has(topic)) return;
                
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
            .slice(0, 12)
            .map(d => ({
                ...d,
                PositivePct: ((d.Positive / d.total) * 100).toFixed(0),
                NeutralPct: ((d.Neutral / d.total) * 100).toFixed(0),
                NegativePct: ((d.Negative / d.total) * 100).toFixed(0)
            }));
    }, [data]);

    // Issues (Sub-Topics) x Sentiment - stacked bar sorted by negative
    const issuesData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const issueMap = {};
        const issueSubTopics = new Set(Object.keys(TOPIC_MAPPING)); // Sub-topics that are issues
        
        data.forEach(conv => {
            const topics = Array.isArray(conv.topic) ? conv.topic : [conv.topic];
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            // Only count issue-related sub-topics (not query-related)
            topics.forEach(topic => {
                if (!topic || !issueSubTopics.has(topic)) return;
                
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

    // Query Area (Sub-Topics from QUERY_TOPIC_MAPPING) x Sentiment - 100% stacked bar
    const queryAreaData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const areaMap = {};
        const querySubTopics = new Set(Object.keys(QUERY_TOPIC_MAPPING)); // Sub-topics that are queries
        
        data.forEach(conv => {
            const subTopics = Array.isArray(conv.topic) ? conv.topic : [conv.topic];
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            subTopics.forEach(topic => {
                if (!topic || !querySubTopics.has(topic)) return;
                
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
            .slice(0, 12)
            .map(d => ({
                ...d,
                PositivePct: ((d.Positive / d.total) * 100).toFixed(0),
                NeutralPct: ((d.Neutral / d.total) * 100).toFixed(0),
                NegativePct: ((d.Negative / d.total) * 100).toFixed(0)
            }));
    }, [data]);

    // Query (Sub-Topics) x Sentiment - stacked bar sorted by total
    const queryData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const queryMap = {};
        const querySubTopics = new Set(Object.keys(QUERY_TOPIC_MAPPING)); // Sub-topics that are queries
        
        data.forEach(conv => {
            const topics = Array.isArray(conv.topic) ? conv.topic : [conv.topic];
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            topics.forEach(topic => {
                if (!topic || !querySubTopics.has(topic)) return;
                
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

    // Sentiment Shift (Sankey data) - transitions from Start to End
    const sentimentShiftData = useMemo(() => {
        if (!data || data.length === 0) return { flows: [], totals: { start: {}, end: {} } };

        const flows = {
            'Negative→Negative': 0, 'Negative→Neutral': 0, 'Negative→Positive': 0,
            'Neutral→Negative': 0, 'Neutral→Neutral': 0, 'Neutral→Positive': 0,
            'Positive→Negative': 0, 'Positive→Neutral': 0, 'Positive→Positive': 0
        };
        
        const startTotals = { Positive: 0, Neutral: 0, Negative: 0 };
        const endTotals = { Positive: 0, Neutral: 0, Negative: 0 };

        data.forEach(conv => {
            let start = conv.sentimentStart?.toLowerCase() || '';
            let end = conv.sentiment?.toLowerCase() || '';
            
            // Normalize
            if (start === 'positive') start = 'Positive';
            else if (start === 'negative') start = 'Negative';
            else if (start) start = 'Neutral';
            else return; // Skip if no start sentiment
            
            if (end === 'positive') end = 'Positive';
            else if (end === 'negative') end = 'Negative';
            else end = 'Neutral';
            
            const key = `${start}→${end}`;
            if (flows[key] !== undefined) {
                flows[key]++;
                startTotals[start]++;
                endTotals[end]++;
            }
        });

        return {
            flows: Object.entries(flows).map(([key, value]) => {
                const [from, to] = key.split('→');
                return { from, to, value };
            }).filter(f => f.value > 0),
            totals: { start: startTotals, end: endTotals }
        };
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

            {/* Row 2: Sentiment Trend (Full Width) */}
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
                        <Line type="monotone" dataKey="positiveRate" stroke="#38BDF8" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Positive %" />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Row 3: Sentiment Shift + Country (High-level context) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                {/* Sentiment Shift (Sankey Chart) */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>🔄</span> Sentiment Shift (Start → End)</h3>
                    {sentimentShiftData.flows.length === 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '280px', color: '#6B7280' }}>
                            No sentiment transition data available
                        </div>
                    ) : (
                        <div style={{ position: 'relative', height: '280px', padding: '10px' }}>
                            <svg width="100%" height="100%" viewBox="0 0 400 260">
                                <text x="30" y="15" fill="#8B949E" fontSize="10" fontWeight="600">START</text>
                                <text x="340" y="15" fill="#8B949E" fontSize="10" fontWeight="600">END</text>
                                {['Negative', 'Neutral', 'Positive'].map((sentiment, i) => {
                                    const total = sentimentShiftData.totals.start[sentiment] || 0;
                                    const maxTotal = Math.max(...Object.values(sentimentShiftData.totals.start), 1);
                                    const height = Math.max(18, (total / maxTotal) * 70);
                                    const y = 30 + i * 80;
                                    const color = SENTIMENT_COLORS[sentiment];
                                    return (
                                        <g key={`start-${sentiment}`}>
                                            <rect x="10" y={y} width="55" height={height} fill={color} rx="4" opacity="0.9" />
                                            <text x="37" y={y + height / 2 + 4} fill="#fff" fontSize="9" textAnchor="middle" fontWeight="600">{total}</text>
                                            <text x="70" y={y + height / 2 + 4} fill={color} fontSize="8" fontWeight="500">{sentiment}</text>
                                        </g>
                                    );
                                })}
                                {['Negative', 'Neutral', 'Positive'].map((sentiment, i) => {
                                    const total = sentimentShiftData.totals.end[sentiment] || 0;
                                    const maxTotal = Math.max(...Object.values(sentimentShiftData.totals.end), 1);
                                    const height = Math.max(18, (total / maxTotal) * 70);
                                    const y = 30 + i * 80;
                                    const color = SENTIMENT_COLORS[sentiment];
                                    return (
                                        <g key={`end-${sentiment}`}>
                                            <rect x="335" y={y} width="55" height={height} fill={color} rx="4" opacity="0.9" />
                                            <text x="362" y={y + height / 2 + 4} fill="#fff" fontSize="9" textAnchor="middle" fontWeight="600">{total}</text>
                                            <text x="328" y={y + height / 2 + 4} fill={color} fontSize="8" textAnchor="end" fontWeight="500">{sentiment}</text>
                                        </g>
                                    );
                                })}
                                {sentimentShiftData.flows.map((flow, idx) => {
                                    const fromIdx = ['Negative', 'Neutral', 'Positive'].indexOf(flow.from);
                                    const toIdx = ['Negative', 'Neutral', 'Positive'].indexOf(flow.to);
                                    if (fromIdx === -1 || toIdx === -1) return null;
                                    const fromY = 30 + fromIdx * 80 + 20;
                                    const toY = 30 + toIdx * 80 + 20;
                                    const maxFlow = Math.max(...sentimentShiftData.flows.map(f => f.value), 1);
                                    const strokeWidth = Math.max(2, (flow.value / maxFlow) * 18);
                                    const color = SENTIMENT_COLORS[flow.to];
                                    const path = `M 65 ${fromY} C 170 ${fromY}, 230 ${toY}, 335 ${toY}`;
                                    return (
                                        <g key={`flow-${idx}`}>
                                            <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} opacity="0.4" strokeLinecap="round" />
                                            {flow.value > 0 && strokeWidth > 4 && (
                                                <text x="200" y={(fromY + toY) / 2 + (fromIdx - toIdx) * 6} fill="#C9D1D9" fontSize="8" textAnchor="middle">{flow.value}</text>
                                            )}
                                        </g>
                                    );
                                })}
                            </svg>
                        </div>
                    )}
                </div>

                {/* Country x Sentiment */}
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

            {/* Row 4: Channel + Word Cloud (Communication & Discovery) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                {/* Channel x Sentiment */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>📱</span> Channel x Sentiment</h3>
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        <ResponsiveContainer width="100%" height={Math.max(280, channelData.length * 35)}>
                            <BarChart data={channelData} layout="vertical">
                                <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} />
                                <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 9 }} width={100} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend verticalAlign="top" height={30} />
                                <Bar dataKey="Positive" stackId="a" fill="#10B981" />
                                <Bar dataKey="Neutral" stackId="a" fill="#6B7280" />
                                <Bar dataKey="Negative" stackId="a" fill="#EF4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Word Cloud */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>☁️</span> Word Cloud (Top Keywords)</h3>
                    <div style={{ 
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2px 6px',
                        padding: '1.5rem',
                        minHeight: '300px',
                        background: 'linear-gradient(145deg, #f5f5f5 0%, #e8e8e8 100%)',
                        borderRadius: '8px'
                    }}>
                        {(() => {
                            const shuffled = [...wordCloudData.slice(0, 80)];
                            for (let i = shuffled.length - 1; i > 0; i--) {
                                const j = Math.floor((i * 7 + 3) % (i + 1));
                                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                            }
                            const maxCount = wordCloudData[0]?.count || 1;
                            const colors = [
                                '#C0392B', '#27AE60', '#8E44AD', '#D4AC0D', '#16A085', 
                                '#E67E22', '#2ECC71', '#9B59B6', '#F39C12', '#1ABC9C',
                                '#CD6155', '#58D68D', '#AF7AC5', '#F4D03F', '#48C9B0',
                                '#DC7633', '#82E0AA', '#BB8FCE', '#FAD7A0', '#76D7C4',
                                '#B03A2E', '#229954', '#6C3483', '#B7950B', '#117864',
                                '#CA6F1E', '#1E8449', '#7D3C98', '#D68910', '#138D75',
                                '#A93226', '#1D8348', '#5B2C6F', '#9A7D0A', '#0E6655',
                                '#BA4A00', '#196F3D', '#512E5F', '#7E5109', '#0B5345'
                            ];
                            return shuffled.map((item, index) => {
                                const ratio = item.count / maxCount;
                                const size = 10 + (Math.pow(ratio, 0.45) * 62);
                                const color = colors[index % colors.length];
                                const fontWeight = size > 45 ? '700' : size > 30 ? '600' : size > 20 ? '500' : '400';
                                return (
                                    <span
                                        key={item.word}
                                        style={{
                                            fontSize: `${size}px`,
                                            fontWeight: fontWeight,
                                            color: color,
                                            whiteSpace: 'nowrap',
                                            cursor: 'pointer',
                                            transition: 'transform 0.15s ease',
                                            lineHeight: '1.05',
                                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                                            padding: size > 40 ? '2px 4px' : '1px 2px'
                                        }}
                                        onMouseEnter={e => { e.target.style.transform = 'scale(1.08)'; }}
                                        onMouseLeave={e => { e.target.style.transform = 'scale(1)'; }}
                                        title={`${item.word}: ${item.count} occurrences`}
                                    >
                                        {item.word}
                                    </span>
                                );
                            });
                        })()}
                        {wordCloudData.length === 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: '0.875rem' }}>
                                No transcript data available for word cloud
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Row 5: Issue Area x Sentiment (100% stacked + counts) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                {/* Issue Area x Sentiment - 100% Stacked */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>📋</span> Issue Area x Sentiment</h3>
                    <p style={{ color: '#6B7280', fontSize: '0.7rem', margin: '-8px 0 8px 0' }}>Sub-Topics (Issues) • Click bar to drill-in</p>
                    <ResponsiveContainer width="100%" height={350}>
                        <BarChart data={issueAreaData} layout="vertical">
                            <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                            <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 9 }} width={160} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="PositivePct" stackId="a" fill="#10B981" name="Positive %" onClick={(d) => handleDrillIn(c => Array.isArray(c.topic) ? c.topic.includes(d.name) : c.topic === d.name && c.sentiment?.toLowerCase() === 'positive', `${d.name} - Positive`)} style={{ cursor: 'pointer' }} />
                            <Bar dataKey="NeutralPct" stackId="a" fill="#6B7280" name="Neutral %" onClick={(d) => handleDrillIn(c => (Array.isArray(c.topic) ? c.topic.includes(d.name) : c.topic === d.name) && !['positive', 'negative'].includes(c.sentiment?.toLowerCase()), `${d.name} - Neutral`)} style={{ cursor: 'pointer' }} />
                            <Bar dataKey="NegativePct" stackId="a" fill="#EF4444" name="Negative %" onClick={(d) => handleDrillIn(c => (Array.isArray(c.topic) ? c.topic.includes(d.name) : c.topic === d.name) && c.sentiment?.toLowerCase() === 'negative', `${d.name} - Negative`)} style={{ cursor: 'pointer' }} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Issues x Sentiment */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>⚠️</span> Issues x Sentiment (by Volume)</h3>
                    <p style={{ color: '#6B7280', fontSize: '0.7rem', margin: '-8px 0 8px 0' }}>Sorted by negative count</p>
                    <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                        <ResponsiveContainer width="100%" height={Math.max(350, issuesData.length * 28)}>
                            <BarChart data={issuesData} layout="vertical">
                                <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} />
                                <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 9 }} width={150} />
                                <Tooltip content={<CustomTooltip />} />
                                <Bar dataKey="Positive" stackId="a" fill="#10B981" />
                                <Bar dataKey="Neutral" stackId="a" fill="#6B7280" />
                                <Bar dataKey="Negative" stackId="a" fill="#EF4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Row 6: Query Area x Sentiment */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                {/* Query Area x Sentiment - 100% Stacked */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>❓</span> Query Area x Sentiment</h3>
                    <p style={{ color: '#6B7280', fontSize: '0.7rem', margin: '-8px 0 8px 0' }}>Sub-Topics (Queries) • Click bar to drill-in</p>
                    <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={queryAreaData} layout="vertical">
                            <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                            <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 9 }} width={160} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="PositivePct" stackId="a" fill="#10B981" name="Positive %" onClick={(d) => handleDrillIn(c => (Array.isArray(c.topic) ? c.topic.includes(d.name) : c.topic === d.name) && c.sentiment?.toLowerCase() === 'positive', `${d.name} - Positive`)} style={{ cursor: 'pointer' }} />
                            <Bar dataKey="NeutralPct" stackId="a" fill="#6B7280" name="Neutral %" onClick={(d) => handleDrillIn(c => (Array.isArray(c.topic) ? c.topic.includes(d.name) : c.topic === d.name) && !['positive', 'negative'].includes(c.sentiment?.toLowerCase()), `${d.name} - Neutral`)} style={{ cursor: 'pointer' }} />
                            <Bar dataKey="NegativePct" stackId="a" fill="#EF4444" name="Negative %" onClick={(d) => handleDrillIn(c => (Array.isArray(c.topic) ? c.topic.includes(d.name) : c.topic === d.name) && c.sentiment?.toLowerCase() === 'negative', `${d.name} - Negative`)} style={{ cursor: 'pointer' }} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Query x Sentiment */}
                <div style={cardStyle}>
                    <h3 style={headerStyle}><span>💬</span> Query x Sentiment (by Volume)</h3>
                    <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                        <ResponsiveContainer width="100%" height={Math.max(320, queryData.length * 25)}>
                            <BarChart data={queryData} layout="vertical">
                                <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} />
                                <YAxis type="category" dataKey="name" tick={{ fill: '#C9D1D9', fontSize: 9 }} width={150} />
                                <Tooltip content={<CustomTooltip />} />
                                <Bar dataKey="Positive" stackId="a" fill="#10B981" />
                                <Bar dataKey="Neutral" stackId="a" fill="#6B7280" />
                                <Bar dataKey="Negative" stackId="a" fill="#EF4444" />
                            </BarChart>
                        </ResponsiveContainer>
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
