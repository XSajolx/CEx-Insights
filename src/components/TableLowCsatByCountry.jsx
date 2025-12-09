import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { fetchCSATCountryLow } from '../services/api';

const TableLowCsatByCountry = ({ filters }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const result = await fetchCSATCountryLow(filters);
                setData(result);
            } catch (error) {
                console.error('Error loading country data:', error);
                setData([]);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [filters]);

    if (loading) {
        return (
            <div className="card" style={{ marginTop: '1rem' }}>
                <div className="card-header">
                    <div className="card-title">Low CSAT by Country</div>
                </div>
                <div className="loading-container">Loading...</div>
            </div>
        );
    }

    return (
        <div className="card" style={{ marginTop: '1rem' }}>
            <div className="card-header">
                <div className="card-title">Low CSAT by Country</div>
            </div>
            <div className="csat-table-container">
                <table className="csat-table">
                    <thead>
                        <tr>
                            <th>Country</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td colSpan="2" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                    No data for current filters
                                </td>
                            </tr>
                        ) : (
                            data.map((row, idx) => (
                                <tr key={idx}>
                                    <td>{row.country}</td>
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

TableLowCsatByCountry.propTypes = {
    filters: PropTypes.object.isRequired
};

export default TableLowCsatByCountry;
