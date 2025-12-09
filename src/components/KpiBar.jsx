import React from 'react';
import PropTypes from 'prop-types';

const CircularProgress = ({ value, size = 64, strokeWidth = 5, color = '#22C55E' }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (Math.min(value, 100) / 100) * circumference;

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', minWidth: size }}>
            {/* Background Circle */}
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="rgba(148, 163, 184, 0.15)"
                strokeWidth={strokeWidth}
            />
            {/* Progress Circle */}
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
        </svg>
    );
};

const KpiBar = ({ title, value, delta, total }) => {
    const percentage = value || 0;
    const deltaValue = delta || 0;
    const isPositive = deltaValue >= 0;
    const deltaClass = isPositive ? 'up' : 'down';

    return (
        <div className="kpi-bar" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '1.5rem' }}>
            <CircularProgress value={percentage} color="#22C55E" />

            <div style={{ flex: 1 }}>
                <div className="kpi-bar-title">{title}</div>
                <div className="kpi-bar-value">{percentage.toFixed(2)}%</div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <div className={`kpi-bar-delta ${deltaClass}`} style={{ marginTop: 0 }}>
                        {isPositive ? '▲' : '▼'} {Math.abs(deltaValue).toFixed(2)}%
                    </div>
                    {total !== undefined && (
                        <div className="kpi-bar-total" style={{ marginTop: 0 }}>
                            {total} total responses
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

KpiBar.propTypes = {
    title: PropTypes.string.isRequired,
    value: PropTypes.number.isRequired,
    delta: PropTypes.number,
    total: PropTypes.number
};

export default KpiBar;
