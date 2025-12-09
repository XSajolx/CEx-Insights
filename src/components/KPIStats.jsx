import React, { useMemo } from 'react';

const KPIStats = ({ conversations, previousConversations }) => {
    const stats = useMemo(() => {
        // Filter conversations based on user criteria: must have conversation_id and topic
        const validConversations = conversations.filter(c => c.conversation_id && c.topic);

        // 1. Total Conversations
        const total = validConversations.length;

        // 2. Top Topic (using main_topic, excluding "Other")
        const topicCounts = {};
        validConversations.forEach(c => {
            const mainTopic = c.main_topic || c.topic; // Fallback to topic if main_topic doesn't exist
            if (mainTopic) {
                topicCounts[mainTopic] = (topicCounts[mainTopic] || 0) + 1;
            }
        });

        // Sort topics by count and exclude "Other" variations
        const sortedTopics = Object.entries(topicCounts)
            .sort((a, b) => b[1] - a[1]) // Sort by count descending
            .filter(([topic]) => !topic.toLowerCase().includes('other')); // Exclude "Other"

        let topTopic = 'N/A';
        let topTopicCount = 0;

        if (sortedTopics.length > 0) {
            [topTopic, topTopicCount] = sortedTopics[0];
        }

        const topTopicPercentage = total > 0 ? Math.round((topTopicCount / total) * 100) : 0;

        // 3. Trend
        // Apply same filter to previous conversations for consistency
        const validPreviousConversations = previousConversations
            ? previousConversations.filter(c => c.conversation_id && c.topic)
            : [];

        const prevTotal = validPreviousConversations.length;
        let trend = 0;
        if (prevTotal > 0) {
            trend = Math.round(((total - prevTotal) / prevTotal) * 100);
        }

        return { total, topTopic, topTopicPercentage, trend, prevTotal };
    }, [conversations, previousConversations]);

    return (
        <div className="kpi-row">
            <div className="kpi-card">
                <div className="kpi-label">Total Conversations</div>
                <div className="kpi-value">{stats.total.toLocaleString()}</div>
                <div className={`kpi-trend ${stats.trend >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                    {stats.prevTotal > 0 ? (
                        <>
                            {stats.trend > 0 ? '↑' : '↓'} {Math.abs(stats.trend)}% <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>vs previous</span>
                        </>
                    ) : (
                        <span className="neutral" style={{ color: 'var(--text-muted)' }}>No previous data</span>
                    )}
                </div>
            </div>

            <div className="kpi-card">
                <div className="kpi-label">Top Topic</div>
                <div className="kpi-value" style={{ fontSize: '1.5rem' }}>
                    {stats.topTopic}
                </div>
                <div className="kpi-trend neutral">
                    {stats.topTopicPercentage}% of total volume
                </div>
            </div>

            <div className="kpi-card">
                <div className="kpi-label">Avg. Daily Volume</div>
                <div className="kpi-value">
                    {conversations.length > 0
                        ? Math.round(conversations.length / 7) // Assuming 7 days for now, or calculate based on date range
                        : 0}
                </div>
                <div className="kpi-trend neutral">
                    Conversations per day
                </div>
            </div>
        </div>
    );
};

export default KPIStats;
