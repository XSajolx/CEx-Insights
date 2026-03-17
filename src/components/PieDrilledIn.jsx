import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import * as echarts from 'echarts';
import { fetchCSATProductReasons, fetchCSATSupportReasons } from '../services/api';

const PieDrilledIn = ({ filters }) => {
    const chartRef = useRef(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const [productData, supportData] = await Promise.all([
                    fetchCSATProductReasons(filters),
                    fetchCSATSupportReasons(filters)
                ]);

                // Combine product and support reasons
                const combined = [
                    ...productData.map(d => ({ name: d.reason, value: d.current_count })),
                    ...supportData.map(d => ({ name: d.reason, value: d.current_count }))
                ];

                // Group small slices into "Other" (<3%)
                const total = combined.reduce((sum, item) => sum + item.value, 0);
                const threshold = total * 0.03;

                const mainSlices = combined.filter(item => item.value >= threshold);
                const otherSlices = combined.filter(item => item.value < threshold);
                const otherTotal = otherSlices.reduce((sum, item) => sum + item.value, 0);

                if (otherTotal > 0) {
                    mainSlices.push({ name: 'Other', value: otherTotal });
                }

                // Initialize chart
                const chart = echarts.init(chartRef.current);

                const textColor = getComputedStyle(document.documentElement)
                    .getPropertyValue('--text-primary').trim();

                const option = {
                    backgroundColor: 'transparent',
                    tooltip: {
                        trigger: 'item',
                        formatter: '{b}: {c} ({d}%)'
                    },
                    legend: {
                        orient: 'vertical',
                        right: 10,
                        top: 'center',
                        textStyle: { color: textColor, fontSize: 11 }
                    },
                    series: [{
                        type: 'pie',
                        radius: ['30%', '70%'],
                        avoidLabelOverlap: true,
                        label: { show: false },
                        emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
                        data: mainSlices
                    }]
                };

                chart.setOption(option);

                // Cleanup
                return () => chart.dispose();
            } catch (error) {
                console.error('Error loading drilled-in data:', error);
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
                    <div className="card-title">Drilled-in Report</div>
                </div>
                <div className="loading-container">Loading...</div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="card-header">
                <div className="card-title">Drilled-in Report</div>
            </div>
            <div ref={chartRef} className="chart-container" style={{ height: '350px' }} />
        </div>
    );
};

PieDrilledIn.propTypes = {
    filters: PropTypes.object.isRequired
};

export default PieDrilledIn;
