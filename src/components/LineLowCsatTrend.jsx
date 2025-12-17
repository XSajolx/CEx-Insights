import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import * as echarts from 'echarts';
import { fetchCSATTrend } from '../services/api';
import { format, parseISO } from 'date-fns';

const LineLowCsatTrend = ({ filters }) => {
    const chartRef = useRef(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const result = await fetchCSATTrend(filters);

                const chart = echarts.init(chartRef.current);

                const textColor = getComputedStyle(document.documentElement)
                    .getPropertyValue('--text-primary').trim();
                const gridColor = getComputedStyle(document.documentElement)
                    .getPropertyValue('--chart-grid').trim();

                const days = result.map(d => format(parseISO(d.day), 'MMM d'));
                const currentCounts = result.map(d => d.current_count);
                const previousCounts = result.map(d => d.previous_count);

                const option = {
                    backgroundColor: 'transparent',
                    tooltip: {
                        trigger: 'axis'
                    },
                    legend: {
                        data: ['Current Low CSAT', 'Previous Low CSAT'],
                        textStyle: { color: textColor }
                    },
                    grid: {
                        left: 50,
                        right: 20,
                        top: 40,
                        bottom: 40
                    },
                    xAxis: {
                        type: 'category',
                        data: days,
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
                            name: 'Current Low CSAT',
                            type: 'line',
                            data: currentCounts,
                            smooth: true,
                            itemStyle: { color: '#FF7B72' },
                            lineStyle: { width: 2 }
                        },
                        {
                            name: 'Previous Low CSAT',
                            type: 'line',
                            data: previousCounts,
                            smooth: true,
                            itemStyle: { color: '#A371F7' },
                            lineStyle: { width: 2, type: 'dashed' }
                        }
                    ]
                };

                chart.setOption(option);

                return () => chart.dispose();
            } catch (error) {
                console.error('Error loading CSAT trend:', error);
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [filters]);

    if (loading) {
        return (
            <div className="card">
                <div className="card-header">
                    <div className="card-title">Low CSAT Trend</div>
                </div>
                <div className="loading-container">Loading...</div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="card-header">
                <div className="card-title">Low CSAT Trend</div>
            </div>
            <div ref={chartRef} className="chart-container" style={{ height: '300px' }} />
        </div>
    );
};

LineLowCsatTrend.propTypes = {
    filters: PropTypes.object.isRequired
};

export default LineLowCsatTrend;
