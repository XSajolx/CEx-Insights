import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import * as echarts from 'echarts';

const BarSupport = ({ data }) => {
    const chartRef = useRef(null);

    useEffect(() => {
        if (!data || data.length === 0) return;

        const chart = echarts.init(chartRef.current);

        const textColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--text-primary').trim();
        const gridColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--chart-grid').trim();

        const reasons = data.map(d => d.reason);
        const currentCounts = data.map(d => d.current_count);
        const previousCounts = data.map(d => d.previous_count);

        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' }
            },
            legend: {
                data: ['Current', 'Previous'],
                textStyle: { color: textColor }
            },
            grid: {
                left: 60,
                right: 20,
                top: 40,
                bottom: 80
            },
            xAxis: {
                type: 'category',
                data: reasons,
                axisLabel: {
                    color: textColor,
                    rotate: 45,
                    fontSize: 10
                },
                axisLine: { lineStyle: { color: gridColor } }
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: textColor },
                axisLine: { lineStyle: { color: gridColor } },
                splitLine: { lineStyle: { color: gridColor } }
            },
            series: [
                {
                    name: 'Current',
                    type: 'bar',
                    data: currentCounts,
                    itemStyle: { color: '#58A6FF' }
                },
                {
                    name: 'Previous',
                    type: 'bar',
                    data: previousCounts,
                    itemStyle: { color: '#A371F7' }
                }
            ]
        };

        chart.setOption(option);

        return () => chart.dispose();
    }, [data]);

    if (!data || data.length === 0) {
        return null;
    }

    return (
        <div className="card" style={{ marginTop: '1rem' }}>
            <div className="card-header">
                <div className="card-title">Support Dissatisfaction Comparison</div>
            </div>
            <div ref={chartRef} className="chart-container" style={{ height: '300px' }} />
        </div>
    );
};

BarSupport.propTypes = {
    data: PropTypes.array.isRequired
};

export default BarSupport;
