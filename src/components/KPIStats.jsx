import React, { useMemo } from 'react';
import { QUERY_TOPIC_MAPPING, normalizeApostrophe } from '../utils/topicMapping';

// Helper to find mapping with normalized apostrophe
const findMapping = (topic, mapping) => {
    if (!topic) return null;
    if (mapping[topic]) return mapping[topic];
    const normalized = normalizeApostrophe(topic);
    if (mapping[normalized]) return mapping[normalized];
    for (const key of Object.keys(mapping)) {
        if (normalizeApostrophe(key) === normalized) {
            return mapping[key];
        }
    }
    return null;
};

const KPIStats = ({ conversations, previousConversations, subTab = 'issue' }) => {
    const stats = useMemo(() => {
        // Total Conversations: Count all rows (no merging, so all rows are included)
        const totalConversations = conversations.length;
        
        // Filter conversations: Must have a topic (check for non-empty array)
        // This is used for issues/queries calculations, but total count includes all
        const validConversations = conversations.filter(c => {
            const hasMain = Array.isArray(c.main_topic) && c.main_topic.length > 0;
            const hasSub = Array.isArray(c.topic) && c.topic.length > 0;
            return hasMain || hasSub;
        });

        // 2. Total Issues (count all issues/topics across all conversations, excluding query sub-topics)
        let totalIssues = 0;
        validConversations.forEach(c => {
            if (Array.isArray(c.topic)) {
                totalIssues += c.topic.filter(t => {
                    if (!t || t.toLowerCase().includes('other')) return false;
                    // Exclude query sub-topics from issue count
                    if (findMapping(t, QUERY_TOPIC_MAPPING)) return false;
                    return true;
                }).length;
            }
        });

        // 3. Total Queries (count sub-topics that map to query main topics)
        // Exclude "Challenge Rule Clarification" to match the charts
        let totalQueries = 0;
        validConversations.forEach(c => {
            if (Array.isArray(c.topic)) {
                c.topic.forEach(t => {
                    if (t && t !== 'Challenge Rule Clarification' && findMapping(t, QUERY_TOPIC_MAPPING)) {
                        totalQueries++;
                    }
                });
            }
        });

        // 4. Conversation to Issue Ratio
        const convToIssueRatio = totalIssues > 0 
            ? (totalConversations / totalIssues).toFixed(2) 
            : totalConversations > 0 ? '1.00' : '0.00';

        // 5. Conversation to Query Ratio (as percentage - what % of conversations have queries)
        const convToQueryPercentage = totalConversations > 0 
            ? ((totalQueries / totalConversations) * 100).toFixed(1)
            : '0.0';

        // 6. Query to Issue Ratio (as fraction like 1/27)
        // Find simplified fraction
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        let queryToIssueFraction = '0/0';
        if (totalQueries > 0 && totalIssues > 0) {
            const divisor = gcd(totalQueries, totalIssues);
            const simplifiedQueries = totalQueries / divisor;
            const simplifiedIssues = totalIssues / divisor;
            queryToIssueFraction = `${simplifiedQueries}/${simplifiedIssues}`;
        } else if (totalQueries > 0) {
            queryToIssueFraction = `${totalQueries}/0`;
        } else {
            queryToIssueFraction = `0/${totalIssues || 0}`;
        }

        // Calculate trends for comparison
        const validPreviousConversations = previousConversations
            ? previousConversations.filter(c => {
                const hasMain = Array.isArray(c.main_topic) && c.main_topic.length > 0;
                const hasSub = Array.isArray(c.topic) && c.topic.length > 0;
                return (hasMain || hasSub) && c.conversation_id;
            })
            : [];

        const prevTotalConversations = validPreviousConversations.length;
        
        let prevTotalIssues = 0;
        let prevTotalQueries = 0;
        validPreviousConversations.forEach(c => {
            if (Array.isArray(c.topic)) {
                prevTotalIssues += c.topic.filter(t => {
                    if (!t || t.toLowerCase().includes('other')) return false;
                    // Exclude query sub-topics from issue count
                    if (findMapping(t, QUERY_TOPIC_MAPPING)) return false;
                    return true;
                }).length;
                c.topic.forEach(t => {
                    if (t && t !== 'Challenge Rule Clarification' && findMapping(t, QUERY_TOPIC_MAPPING)) {
                        prevTotalQueries++;
                    }
                });
            }
        });

        // Trends
        const convTrend = prevTotalConversations > 0 
            ? Math.round(((totalConversations - prevTotalConversations) / prevTotalConversations) * 100) 
            : 0;
        
        const issueTrend = prevTotalIssues > 0 
            ? Math.round(((totalIssues - prevTotalIssues) / prevTotalIssues) * 100) 
            : 0;

        const queryTrend = prevTotalQueries > 0 
            ? Math.round(((totalQueries - prevTotalQueries) / prevTotalQueries) * 100) 
            : 0;

        return { 
            totalConversations, 
            totalIssues, 
            totalQueries,
            convToIssueRatio,
            convToQueryPercentage,
            queryToIssueFraction,
            convTrend,
            issueTrend,
            queryTrend,
            prevTotalConversations,
            prevTotalIssues,
            prevTotalQueries
        };
    }, [conversations, previousConversations]);

    // Query Analysis Scorecards
    if (subTab === 'query') {
        return (
            <div className="kpi-row">
                {/* Total Number of Conversations */}
                <div className="kpi-card">
                    <div className="kpi-label">Total Conversations</div>
                    <div className="kpi-value">{stats.totalConversations.toLocaleString()}</div>
                    <div className={`kpi-trend ${stats.convTrend >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                        {stats.prevTotalConversations > 0 ? (
                            <>
                                {stats.convTrend > 0 ? '↑' : stats.convTrend < 0 ? '↓' : '→'} {Math.abs(stats.convTrend)}% <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>vs previous</span>
                            </>
                        ) : (
                            <span className="neutral" style={{ color: 'var(--text-muted)' }}>No previous data</span>
                        )}
                    </div>
                </div>

                {/* Total Number of Queries */}
                <div className="kpi-card">
                    <div className="kpi-label">Total Queries</div>
                    <div className="kpi-value">{stats.totalQueries.toLocaleString()}</div>
                    <div className={`kpi-trend ${stats.queryTrend >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                        {stats.prevTotalQueries > 0 ? (
                            <>
                                {stats.queryTrend > 0 ? '↑' : stats.queryTrend < 0 ? '↓' : '→'} {Math.abs(stats.queryTrend)}% <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>vs previous</span>
                            </>
                        ) : (
                            <span className="neutral" style={{ color: 'var(--text-muted)' }}>No previous data</span>
                        )}
                    </div>
                </div>

                {/* Conversation to Query Ratio (Percentage) */}
                <div className="kpi-card">
                    <div className="kpi-label">Conversation to Query Ratio</div>
                    <div className="kpi-value">{stats.convToQueryPercentage}%</div>
                    <div className="kpi-trend neutral" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                            {stats.totalQueries} queries in {stats.totalConversations} conversations
                        </span>
                    </div>
                </div>

                {/* Query to Issue Ratio (Fraction) */}
                <div className="kpi-card">
                    <div className="kpi-label">Query to Issue Ratio</div>
                    <div className="kpi-value">{stats.queryToIssueFraction}</div>
                    <div className="kpi-trend neutral" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                            {stats.totalQueries} queries / {stats.totalIssues} issues
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    // Issue Analysis Scorecards (default)
    return (
        <div className="kpi-row">
            {/* Total Number of Conversations */}
            <div className="kpi-card">
                <div className="kpi-label">Total Conversations</div>
                <div className="kpi-value">{stats.totalConversations.toLocaleString()}</div>
                <div className={`kpi-trend ${stats.convTrend >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                    {stats.prevTotalConversations > 0 ? (
                        <>
                            {stats.convTrend > 0 ? '↑' : stats.convTrend < 0 ? '↓' : '→'} {Math.abs(stats.convTrend)}% <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>vs previous</span>
                        </>
                    ) : (
                        <span className="neutral" style={{ color: 'var(--text-muted)' }}>No previous data</span>
                    )}
                </div>
            </div>

            {/* Total Number of Issues */}
            <div className="kpi-card">
                <div className="kpi-label">Total Issues</div>
                <div className="kpi-value">{stats.totalIssues.toLocaleString()}</div>
                <div className={`kpi-trend ${stats.issueTrend >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                    {stats.prevTotalIssues > 0 ? (
                        <>
                            {stats.issueTrend > 0 ? '↑' : stats.issueTrend < 0 ? '↓' : '→'} {Math.abs(stats.issueTrend)}% <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>vs previous</span>
                        </>
                    ) : (
                        <span className="neutral" style={{ color: 'var(--text-muted)' }}>No previous data</span>
                    )}
                </div>
            </div>

            {/* Conversation to Issue Ratio */}
            <div className="kpi-card">
                <div className="kpi-label">Conversation to Issue Ratio</div>
                <div className="kpi-value">
                    {stats.totalConversations > 0 
                        ? ((stats.totalIssues / stats.totalConversations) * 100).toFixed(1)
                        : '0.0'
                    }%
                </div>
                <div className="kpi-trend neutral" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                        {stats.totalIssues} issues in {stats.totalConversations} conversations
                    </span>
                </div>
            </div>

            {/* Issue to Query Ratio (Fraction) */}
            <div className="kpi-card">
                <div className="kpi-label">Issue to Query Ratio</div>
                <div className="kpi-value">{stats.totalIssues}/{stats.totalQueries}</div>
                <div className="kpi-trend neutral" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                        Issues per query
                    </span>
                </div>
            </div>
        </div>
    );
};

export default KPIStats;
