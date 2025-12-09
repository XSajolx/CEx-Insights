import SearchableSelect from './SearchableSelect';
import DateRangePicker from './DateRangePicker';

const Filters = ({ filters, onFilterChange, options }) => {
    return (
        <div className="filters-container">
            <div className="filter-card">
                <div className="filter-content">
                    <DateRangePicker
                        value={filters.dateRange}
                        onChange={(value) => onFilterChange('dateRange', value)}
                    />
                </div>
            </div>

            <div className="filter-card">
                <div className="filter-content">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8B949E', marginRight: '0.25rem' }}>
                        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
                        <line x1="8" y1="2" x2="8" y2="18"></line>
                        <line x1="16" y1="6" x2="16" y2="22"></line>
                    </svg>
                    <SearchableSelect
                        options={options.regions}
                        value={filters.region}
                        onChange={(value) => onFilterChange('region', value)}
                        label="Region"
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
                        options={options.countries}
                        value={filters.country}
                        onChange={(value) => onFilterChange('country', value)}
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
                        options={options.products}
                        value={filters.product}
                        onChange={(value) => onFilterChange('product', value)}
                        label="Product"
                    />
                </div>
            </div>
        </div>
    );
};

export default Filters;
