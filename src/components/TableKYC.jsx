import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { fetchCSATKYC } from '../services/api';

const TableKYC = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const result = await fetchCSATKYC(filters);
                setData(result);
            } catch (error) {
                console.error('Error loading KYC data:', error);
                setData([]);
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
                    <div className="card-title">KYC_Issue</div>
                </div>
                <div className="loading-container">Loading...</div>
            </div>
        );
    }

    return (
        <div className="card">
            <div className="card-header">
                <div className="card-title">KYC_Issue</div>
            </div>
            <div className="csat-table-container">
                <table className="csat-table">
                    <thead>
                        <tr>
                            <th>Issue</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td colSpan="2" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                    No KYC issues for current filters
                                </td>
                            </tr>
                        ) : (
                            data.map((row, idx) => (
                                <tr key={idx}>
                                    <td>{row.reason}</td>
                                    <td>{row.count}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

TableKYC.propTypes = {
    filters: PropTypes.object.isRequired
};

export default TableKYC;
