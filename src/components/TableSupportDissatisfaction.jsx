import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { fetchCSATSupportReasons } from '../services/api';
import BarSupport from './BarSupport';

const TableSupportDissatisfaction = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const result = await fetchCSATSupportReasons(filters);
                setData(result);
            } catch (error) {
                console.error('Error loading support reasons:', error);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filters]);

    if (loading) {
        return (
            <div className="csat-support-section">
                <div className="card">
                    <div className="card-header">
                        <div className="card-title">Dissatisfaction on Support</div>
                    </div>
                    <div className="loading-container">Loading...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="csat-support-section">
            <div className="card">
                <div className="card-header">
                    <div className="card-title">Dissatisfaction on Support</div>
                </div>
                <div className="csat-table-container">
                    <table className="csat-table">
                        <thead>
                            <tr>
                                <th>Dissatisfaction Area</th>
                                <th>Current</th>
                                <th>Previous</th>
                                <th>Difference</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.length === 0 ? (
                                <tr>
                                    <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                        No data for current filters
                                    </td>
                                </tr>
                            ) : (
                                data.map((row, idx) => (
                                    <tr key={idx}>
                                        <td>{row.reason}</td>
                                        <td>{row.current_count}</td>
                                        <td>{row.previous_count}</td>
                                        <td className={row.diff >= 0 ? 'positive' : 'negative'}>
                                            {row.diff >= 0 ? '+' : ''}{row.diff}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            <BarSupport data={data} />
        </div>
    );
};

TableSupportDissatisfaction.propTypes = {
    filters: PropTypes.object.isRequired
};

export default TableSupportDissatisfaction;
