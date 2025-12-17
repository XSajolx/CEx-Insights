import React from 'react';
import PropTypes from 'prop-types';

const KpiMini = ({ title, value, delta }) => {
    const deltaValue = delta || 0;
    const isPositive = deltaValue >= 0;
    const deltaClass = isPositive ? 'positive' : 'negative';

    return (
        <div className="kpi-mini">
            <div className="kpi-mini-title">{title}</div>
            <div className="kpi-mini-value">{value?.toLocaleString() || 0}</div>
            {delta !== undefined && (
                <div className={`kpi-mini-delta ${deltaClass}`}>
                    {isPositive ? '▲' : '▼'} {Math.abs(deltaValue).toLocaleString()}
                </div>
            )}
        </div>
    );
};

KpiMini.propTypes = {
    title: PropTypes.string.isRequired,
    value: PropTypes.number.isRequired,
    delta: PropTypes.number
};

export default KpiMini;
