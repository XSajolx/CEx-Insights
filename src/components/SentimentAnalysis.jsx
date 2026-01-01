import React, { useState, useMemo } from 'react';
import {
    PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    AreaChart, Area, Legend, LabelList
} from 'recharts';
import { format, parseISO } from 'date-fns';
import ConversationList from './ConversationList';

// Sentiment colors
const SENTIMENT_COLORS = {
    'Positive': '#10B981',
    'Neutral': '#6B7280',
    'Negative': '#EF4444'
};

const CHART_COLORS = ['#10B981', '#6B7280', '#EF4444'];

const SentimentAnalysis = ({ data = [], filters }) => {
    const [showDrillIn, setShowDrillIn] = useState(false);
    const [drillInData, setDrillInData] = useState({ conversations: [], title: '' });

    // Calculate sentiment statistics
    const sentimentStats = useMemo(() => {
        if (!data || data.length === 0) {
            return {
                total: 0,
                positive: 0,
                neutral: 0,
                negative: 0,
                positivePercent: 0,
                neutralPercent: 0,
                negativePercent: 0
            };
        }

        let positive = 0, neutral = 0, negative = 0;

        data.forEach(conv => {
            const sentiment = conv.sentiment?.toLowerCase() || '';
            if (sentiment === 'positive') positive++;
            else if (sentiment === 'negative') negative++;
            else neutral++;
        });

        const total = data.length;

        return {
            total,
            positive,
            neutral,
            negative,
            positivePercent: total > 0 ? ((positive / total) * 100).toFixed(1) : 0,
            neutralPercent: total > 0 ? ((neutral / total) * 100).toFixed(1) : 0,
            negativePercent: total > 0 ? ((negative / total) * 100).toFixed(1) : 0
        };
    }, [data]);

    // Pie chart data
    const pieData = useMemo(() => {
        return [
            { name: 'Positive', value: sentimentStats.positive, color: SENTIMENT_COLORS.Positive },
            { name: 'Neutral', value: sentimentStats.neutral, color: SENTIMENT_COLORS.Neutral },
            { name: 'Negative', value: sentimentStats.negative, color: SENTIMENT_COLORS.Negative }
        ].filter(d => d.value > 0);
    }, [sentimentStats]);

    // Sentiment trend over time
    const trendData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const dateMap = {};
        
        data.forEach(conv => {
            const dateStr = conv.created_date_bd;
            if (!dateStr) return;
            
            const date = dateStr.split('T')[0]; // Get just the date part
            
            if (!dateMap[date]) {
                dateMap[date] = { date, Positive: 0, Neutral: 0, Negative: 0 };
            }
            
            const sentiment = conv.sentiment?.toLowerCase() || '';
            if (sentiment === 'positive') dateMap[date].Positive++;
            else if (sentiment === 'negative') dateMap[date].Negative++;
            else dateMap[date].Neutral++;
        });

        return Object.values(dateMap)
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30); // Last 30 days
    }, [data]);

    // Sentiment by region
    const regionData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const regionMap = {};
        
        data.forEach(conv => {
            const region = conv.region || 'Unknown';
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            if (!regionMap[region]) {
                regionMap[region] = { region, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
            }
            
            regionMap[region].total++;
            if (sentiment === 'positive') regionMap[region].Positive++;
            else if (sentiment === 'negative') regionMap[region].Negative++;
            else regionMap[region].Neutral++;
        });

        return Object.values(regionMap)
            .sort((a, b) => b.total - a.total)
            .slice(0, 8);
    }, [data]);

    // Sentiment by product
    const productData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const productMap = {};
        
        data.forEach(conv => {
            const product = conv.product || 'Unknown';
            const sentiment = conv.sentiment?.toLowerCase() || 'neutral';
            
            if (!productMap[product]) {
                productMap[product] = { product, Positive: 0, Neutral: 0, Negative: 0, total: 0 };
            }
            
            productMap[product].total++;
            if (sentiment === 'positive') productMap[product].Positive++;
            else if (sentiment === 'negative') productMap[product].Negative++;
            else productMap[product].Neutral++;
        });

        return Object.values(productMap)
            .sort((a, b) => b.total - a.total);
    }, [data]);

    // Top topics by sentiment (negative focus for issues)
    const topicsBySentiment = useMemo(() => {
        if (!data || data.length === 0) return { negative: [], positive: [] };

        const negativeMap = {};
        const positiveMap = {};
        
        data.forEach(conv => {
            const sentiment = conv.sentiment?.toLowerCase() || '';
            const topics = Array.isArray(conv.topic) ? conv.topic : [conv.topic];
            
            topics.forEach(topic => {
                if (!topic) return;
                
                if (sentiment === 'negative') {
                    negativeMap[topic] = (negativeMap[topic] || 0) + 1;
                } else if (sentiment === 'positive') {
                    positiveMap[topic] = (positiveMap[topic] || 0) + 1;
                }
            });
        });

        const negative = Object.entries(negativeMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        const positive = Object.entries(positiveMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        return { negative, positive };
    }, [data]);

    // Handle drill-in
    const handleSentimentDrillIn = (sentiment) => {
        const filtered = data.filter(conv => {
            const s = conv.sentiment?.toLowerCase() || '';
            if (sentiment === 'Positive') return s === 'positive';
            if (sentiment === 'Negative') return s === 'negative';
            return s !== 'positive' && s !== 'negative';
        });
        setDrillInData({
            conversations: filtered,
            title: `${sentiment} Sentiment (${filtered.length} conversations)`
        });
        setShowDrillIn(true);
    };

    // Custom tooltip for charts
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

    return (
        <div style={{ padding: '0 2rem 2rem 2rem' }}>
            {/* Header */}
            <div style={{ marginBottom: '1.5rem' }}>
                <h1 style={{ 
                    fontSize: '1.5rem', 
                    fontWeight: '700', 
                    color: '#F0F6FC',
                    margin: '0 0 0.5rem 0'
                }}>
                    Sentiment Analysis
                </h1>
                <p style={{ color: '#8B949E', fontSize: '0.875rem', margin: 0 }}>
                    Analyze customer sentiment across conversations
                </p>
            </div>

            {/* KPI Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '1rem',
                marginBottom: '1.5rem'
            }}>
                {/* Total Conversations */}
                <div style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '12px',
                    padding: '1.25rem'
                }}>
                    <div style={{ color: '#8B949E', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                        Total Conversations
                    </div>
                    <div style={{ color: '#F0F6FC', fontSize: '1.75rem', fontWeight: '700' }}>
                        {sentimentStats.total.toLocaleString()}
                    </div>
                </div>

                {/* Positive */}
                <div 
                    onClick={() => handleSentimentDrillIn('Positive')}
                    style={{
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        borderRadius: '12px',
                        padding: '1.25rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <div style={{ color: '#10B981', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>😊</span> Positive
                    </div>
                    <div style={{ color: '#10B981', fontSize: '1.75rem', fontWeight: '700' }}>
                        {sentimentStats.positive.toLocaleString()}
                    </div>
                    <div style={{ color: '#10B981', fontSize: '0.875rem', opacity: 0.8 }}>
                        {sentimentStats.positivePercent}%
                    </div>
                </div>

                {/* Neutral */}
                <div 
                    onClick={() => handleSentimentDrillIn('Neutral')}
                    style={{
                        background: 'rgba(107, 114, 128, 0.1)',
                        border: '1px solid rgba(107, 114, 128, 0.2)',
                        borderRadius: '12px',
                        padding: '1.25rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <div style={{ color: '#9CA3AF', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>😐</span> Neutral
                    </div>
                    <div style={{ color: '#9CA3AF', fontSize: '1.75rem', fontWeight: '700' }}>
                        {sentimentStats.neutral.toLocaleString()}
                    </div>
                    <div style={{ color: '#9CA3AF', fontSize: '0.875rem', opacity: 0.8 }}>
                        {sentimentStats.neutralPercent}%
                    </div>
                </div>

                {/* Negative */}
                <div 
                    onClick={() => handleSentimentDrillIn('Negative')}
                    style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '12px',
                        padding: '1.25rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <div style={{ color: '#EF4444', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>😞</span> Negative
                    </div>
                    <div style={{ color: '#EF4444', fontSize: '1.75rem', fontWeight: '700' }}>
                        {sentimentStats.negative.toLocaleString()}
                    </div>
                    <div style={{ color: '#EF4444', fontSize: '0.875rem', opacity: 0.8 }}>
                        {sentimentStats.negativePercent}%
                    </div>
                </div>
            </div>

            {/* Charts Row 1: Distribution + Trend */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 2fr',
                gap: '1.5rem',
                marginBottom: '1.5rem'
            }}>
                {/* Sentiment Distribution Pie */}
                <div style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '12px',
                    padding: '1.25rem'
                }}>
                    <h3 style={{ 
                        margin: '0 0 1rem 0', 
                        fontSize: '0.875rem', 
                        fontWeight: '600', 
                        color: '#F0F6FC',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span style={{ opacity: 0.6 }}>📊</span>
                        Sentiment Distribution
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie
                                data={pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={90}
                                paddingAngle={3}
                                dataKey="value"
                                onClick={(entry) => handleSentimentDrillIn(entry.name)}
                                style={{ cursor: 'pointer' }}
                            >
                                {pieData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                            <Legend 
                                verticalAlign="bottom"
                                formatter={(value) => <span style={{ color: '#C9D1D9', fontSize: '0.75rem' }}>{value}</span>}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Sentiment Trend Over Time */}
                <div style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '12px',
                    padding: '1.25rem'
                }}>
                    <h3 style={{ 
                        margin: '0 0 1rem 0', 
                        fontSize: '0.875rem', 
                        fontWeight: '600', 
                        color: '#F0F6FC',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span style={{ opacity: 0.6 }}>📈</span>
                        Sentiment Trend Over Time
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={trendData}>
                            <defs>
                                <linearGradient id="positiveGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="neutralGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6B7280" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#6B7280" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="negativeGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis 
                                dataKey="date" 
                                tick={{ fill: '#8B949E', fontSize: 10 }}
                                axisLine={{ stroke: '#30363D' }}
                                tickLine={{ stroke: '#30363D' }}
                                tickFormatter={(val) => {
                                    try {
                                        return format(parseISO(val), 'MMM d');
                                    } catch {
                                        return val;
                                    }
                                }}
                            />
                            <YAxis 
                                tick={{ fill: '#8B949E', fontSize: 10 }}
                                axisLine={{ stroke: '#30363D' }}
                                tickLine={{ stroke: '#30363D' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend 
                                verticalAlign="top"
                                height={36}
                                formatter={(value) => <span style={{ color: '#C9D1D9', fontSize: '0.75rem' }}>{value}</span>}
                            />
                            <Area type="monotone" dataKey="Positive" stroke="#10B981" fill="url(#positiveGradient)" strokeWidth={2} />
                            <Area type="monotone" dataKey="Neutral" stroke="#6B7280" fill="url(#neutralGradient)" strokeWidth={2} />
                            <Area type="monotone" dataKey="Negative" stroke="#EF4444" fill="url(#negativeGradient)" strokeWidth={2} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Charts Row 2: By Region + By Product */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1.5rem',
                marginBottom: '1.5rem'
            }}>
                {/* Sentiment by Region */}
                <div style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '12px',
                    padding: '1.25rem'
                }}>
                    <h3 style={{ 
                        margin: '0 0 1rem 0', 
                        fontSize: '0.875rem', 
                        fontWeight: '600', 
                        color: '#F0F6FC',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span style={{ opacity: 0.6 }}>🌍</span>
                        Sentiment by Region
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={regionData} layout="vertical">
                            <XAxis type="number" tick={{ fill: '#8B949E', fontSize: 10 }} axisLine={{ stroke: '#30363D' }} />
                            <YAxis 
                                type="category" 
                                dataKey="region" 
                                tick={{ fill: '#C9D1D9', fontSize: 11 }} 
                                axisLine={{ stroke: '#30363D' }}
                                width={100}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend 
                                verticalAlign="top"
                                height={36}
                                formatter={(value) => <span style={{ color: '#C9D1D9', fontSize: '0.75rem' }}>{value}</span>}
                            />
                            <Bar dataKey="Positive" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} />
                            <Bar dataKey="Neutral" stackId="a" fill="#6B7280" radius={[0, 0, 0, 0]} />
                            <Bar dataKey="Negative" stackId="a" fill="#EF4444" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Sentiment by Product */}
                <div style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '12px',
                    padding: '1.25rem'
                }}>
                    <h3 style={{ 
                        margin: '0 0 1rem 0', 
                        fontSize: '0.875rem', 
                        fontWeight: '600', 
                        color: '#F0F6FC',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span style={{ opacity: 0.6 }}>📦</span>
                        Sentiment by Product
                    </h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={productData}>
                            <XAxis 
                                dataKey="product" 
                                tick={{ fill: '#C9D1D9', fontSize: 11 }} 
                                axisLine={{ stroke: '#30363D' }}
                            />
                            <YAxis 
                                tick={{ fill: '#8B949E', fontSize: 10 }} 
                                axisLine={{ stroke: '#30363D' }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend 
                                verticalAlign="top"
                                height={36}
                                formatter={(value) => <span style={{ color: '#C9D1D9', fontSize: '0.75rem' }}>{value}</span>}
                            />
                            <Bar dataKey="Positive" stackId="a" fill="#10B981" />
                            <Bar dataKey="Neutral" stackId="a" fill="#6B7280" />
                            <Bar dataKey="Negative" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Charts Row 3: Top Topics by Sentiment */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1.5rem'
            }}>
                {/* Top Negative Topics */}
                <div style={{
                    background: 'rgba(239, 68, 68, 0.05)',
                    border: '1px solid rgba(239, 68, 68, 0.15)',
                    borderRadius: '12px',
                    padding: '1.25rem'
                }}>
                    <h3 style={{ 
                        margin: '0 0 1rem 0', 
                        fontSize: '0.875rem', 
                        fontWeight: '600', 
                        color: '#EF4444',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span>😞</span>
                        Top Topics with Negative Sentiment
                    </h3>
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {topicsBySentiment.negative.length === 0 ? (
                            <p style={{ color: '#8B949E', fontSize: '0.875rem' }}>No negative sentiment data</p>
                        ) : (
                            topicsBySentiment.negative.map((topic, index) => (
                                <div key={topic.name} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 12px',
                                    background: index % 2 === 0 ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
                                    borderRadius: '6px',
                                    marginBottom: '4px'
                                }}>
                                    <span style={{ 
                                        color: '#C9D1D9', 
                                        fontSize: '0.875rem',
                                        flex: 1,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {topic.name}
                                    </span>
                                    <span style={{
                                        background: 'rgba(239, 68, 68, 0.2)',
                                        color: '#EF4444',
                                        padding: '2px 10px',
                                        borderRadius: '12px',
                                        fontSize: '0.75rem',
                                        fontWeight: '600',
                                        marginLeft: '12px'
                                    }}>
                                        {topic.value}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Top Positive Topics */}
                <div style={{
                    background: 'rgba(16, 185, 129, 0.05)',
                    border: '1px solid rgba(16, 185, 129, 0.15)',
                    borderRadius: '12px',
                    padding: '1.25rem'
                }}>
                    <h3 style={{ 
                        margin: '0 0 1rem 0', 
                        fontSize: '0.875rem', 
                        fontWeight: '600', 
                        color: '#10B981',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <span>😊</span>
                        Top Topics with Positive Sentiment
                    </h3>
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {topicsBySentiment.positive.length === 0 ? (
                            <p style={{ color: '#8B949E', fontSize: '0.875rem' }}>No positive sentiment data</p>
                        ) : (
                            topicsBySentiment.positive.map((topic, index) => (
                                <div key={topic.name} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 12px',
                                    background: index % 2 === 0 ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                                    borderRadius: '6px',
                                    marginBottom: '4px'
                                }}>
                                    <span style={{ 
                                        color: '#C9D1D9', 
                                        fontSize: '0.875rem',
                                        flex: 1,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {topic.name}
                                    </span>
                                    <span style={{
                                        background: 'rgba(16, 185, 129, 0.2)',
                                        color: '#10B981',
                                        padding: '2px 10px',
                                        borderRadius: '12px',
                                        fontSize: '0.75rem',
                                        fontWeight: '600',
                                        marginLeft: '12px'
                                    }}>
                                        {topic.value}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Drill-in Modal */}
            {showDrillIn && (
                <ConversationList
                    conversations={drillInData.conversations}
                    title={drillInData.title}
                    onClose={() => setShowDrillIn(false)}
                />
            )}
        </div>
    );
};

export default SentimentAnalysis;
