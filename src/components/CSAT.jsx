import React, { useState, useEffect } from 'react';
import { fetchCSATMetrics, fetchCSATFilters } from '../services/api';
import KpiBar from './KpiBar';
import LoadingSpinner from './LoadingSpinner';
import KpiMini from './KpiMini';
import SearchableSelect from './SearchableSelect';
import DateRangePicker from './DateRangePicker';
import CSATTrendChart from './CSATTrendChart';
import ProductConcernsChart from './ProductConcernsChart';
import CountryNegativeRatingChart from './CountryNegativeRatingChart';
import KYCIssueDrilledInChart from './KYCIssueDrilledInChart';
import CSATRatingDistributionChart from './CSATRatingDistributionChart';
import CSATDataManager from './CSATDataManager';

const CSAT = () => {
    const [filters, setFilters] = useState({
        dateRange: 'last_90_days',
        countries: [],
        products: [],
        channels: [],
        agents: []
    });

    const [filterOptions, setFilterOptions] = useState({
        countries: [],
        products: [],
        channels: [],
        agents: []
    });

    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);

    // Load filter options
    useEffect(() => {
        const loadFilterOptions = async () => {
            try {
                const options = await fetchCSATFilters();
                setFilterOptions(options);
            } catch (error) {
                console.error('Error loading filter options:', error);
            }
        };
        loadFilterOptions();
    }, []);

    // Load metrics
    useEffect(() => {
        const loadMetrics = async () => {
            setLoading(true);
            try {
                const data = await fetchCSATMetrics(filters);
                setMetrics(data);
            } catch (error) {
                console.error('Error loading metrics:', error);
            } finally {
                setLoading(false);
            }
        };
        loadMetrics();
    }, [filters]);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    // Calculate CSAT percentages and deltas
    const calculateCSAT = (high, valid) => {
        return valid > 0 ? (high / valid) * 100 : 0;
    };

    const overallCSAT = metrics ? calculateCSAT(metrics.current.highCSAT, metrics.current.validCSAT) : 0;
    const prevOverallCSAT = metrics ? calculateCSAT(metrics.previous.highCSAT, metrics.previous.validCSAT) : 0;
    const overallDelta = overallCSAT - prevOverallCSAT;

    // CEx low = 20.7% of total low CSAT, Prod low = 79.3% of total low CSAT
    const CEX_LOW_RATIO = 0.207;

    // CEx Performance = highCSAT / (Total CSAT - Prod low CSAT)
    const curProdLow = metrics ? metrics.current.lowOrg * (1 - CEX_LOW_RATIO) : 0;
    const cexValid = metrics ? metrics.current.validCSAT - curProdLow : 0;
    const cexCSAT = calculateCSAT(metrics?.current.highCSAT || 0, cexValid);
    const prevProdLow = metrics ? metrics.previous.lowOrg * (1 - CEX_LOW_RATIO) : 0;
    const prevCexValid = metrics ? metrics.previous.validCSAT - prevProdLow : 0;
    const prevCexCSAT = calculateCSAT(metrics?.previous.highCSAT || 0, prevCexValid);
    const cexDelta = cexCSAT - prevCexCSAT;

    // Prod Performance = highCSAT / (Total CSAT - CEx low CSAT)
    const curCexLow = metrics ? metrics.current.lowOrg * CEX_LOW_RATIO : 0;
    const prodValid = metrics ? metrics.current.validCSAT - curCexLow : 0;
    const prodCSAT = calculateCSAT(metrics?.current.highCSAT || 0, prodValid);
    const prevCexLow = metrics ? metrics.previous.lowOrg * CEX_LOW_RATIO : 0;
    const prevProdValid = metrics ? metrics.previous.validCSAT - prevCexLow : 0;
    const prevProdCSAT = calculateCSAT(metrics?.previous.highCSAT || 0, prevProdValid);
    const prodDelta = prodCSAT - prevProdCSAT;

    if (loading && !metrics) {
        return <LoadingSpinner />;
    }

    return (
        <div className="cex-csat" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>

            {/* Filter Bar */}
            <div className="filters-container">
                <div className="filter-card">
                    <div className="filter-content">
                        <DateRangePicker
                            value={filters.dateRange}
                            onChange={(value) => handleFilterChange('dateRange', value)}
                            mode="csat"
                        />
                    </div>
                </div>

                <div className="filter-card">
                    <div className="filter-content">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8B949E', marginRight: '0.25rem' }}>
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="2" y1="12" x2="22" y2="12"></line>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        <SearchableSelect
                            options={filterOptions.countries}
                            value={filters.countries[0] || 'All'}
                            onChange={(value) => handleFilterChange('countries', value === 'All' ? [] : [value])}
                            label="Country"
                        />
                    </div>
                </div>

                <div className="filter-card">
                    <div className="filter-content">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8B949E', marginRight: '0.25rem' }}>
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                            <line x1="12" y1="22.08" x2="12" y2="12"></line>
                        </svg>
                        <SearchableSelect
                            options={filterOptions.products}
                            value={filters.products[0] || 'All'}
                            onChange={(value) => handleFilterChange('products', value === 'All' ? [] : [value])}
                            label="Product"
                        />
                    </div>
                </div>

            </div>

            {/* KPI Bars */}
            <div className="csat-kpi-bars">
                <KpiBar
                    title="CSAT – Overall"
                    value={overallCSAT}
                    delta={overallDelta}
                    total={metrics?.current.validCSAT}
                />
                <KpiBar
                    title="CSAT – CEx Performance"
                    value={cexCSAT}
                    delta={cexDelta}
                    total={cexValid}
                />
                <KpiBar
                    title="CSAT – Product Performance"
                    value={prodCSAT}
                    delta={prodDelta}
                    total={prodValid}
                />
            </div>

            {/* KPI Mini Counters */}
            <div className="csat-kpi-counters">
                <KpiMini
                    title="Total CSAT Count"
                    value={metrics?.current.validCSAT || 0}
                    delta={(metrics?.current.validCSAT || 0) - (metrics?.previous.validCSAT || 0)}
                />
                <KpiMini
                    title="High CSAT Count"
                    value={metrics?.current.highCSAT || 0}
                    delta={(metrics?.current.highCSAT || 0) - (metrics?.previous.highCSAT || 0)}
                />
                <KpiMini
                    title="Low CSAT Count (Org)"
                    value={metrics?.current.lowOrg || 0}
                    delta={(metrics?.current.lowOrg || 0) - (metrics?.previous.lowOrg || 0)}
                />
                <KpiMini
                    title="Low CSAT Count (CEx)"
                    value={metrics?.current.lowCEx || 0}
                    delta={(metrics?.current.lowCEx || 0) - (metrics?.previous.lowCEx || 0)}
                />
                <KpiMini
                    title="Low CSAT Count (Prod)"
                    value={metrics?.current.lowProd || 0}
                    delta={(metrics?.current.lowProd || 0) - (metrics?.previous.lowProd || 0)}
                />
            </div>

            {/* New Charts Grid */}
            <div className="csat-charts-grid">
                {/* Row 1: Full-width CSAT Trend */}
                <CSATTrendChart filters={filters} />

                {/* Row 2: Two equal-width charts */}
                <ProductConcernsChart filters={filters} />
                <CountryNegativeRatingChart filters={filters} />

                {/* Row 3: Drilled-in and Distribution */}
                <KYCIssueDrilledInChart filters={filters} />
                <CSATRatingDistributionChart filters={filters} />
            </div>

            {/* CSAT Data Table */}
            <CSATDataManager filters={filters} />
        </div>

    );
};

export default CSAT;
