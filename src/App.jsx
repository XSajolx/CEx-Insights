import React, { useState, useMemo, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Filters from './components/Filters';
import DashboardCharts from './components/DashboardCharts';
import DashboardHeader from './components/DashboardHeader';
import KPIStats from './components/KPIStats';
import CSAT from './components/CSAT';
import LoadingSpinner from './components/LoadingSpinner';
import { fetchConversations, fetchTopics, fetchFilters, fetchMainTopics, fetchTopicDistribution } from './services/api';
import { subDays, subMonths, isAfter, parseISO } from 'date-fns';

function App() {
  // State
  const [loading, setLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState('intercom');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [previousConversations, setPreviousConversations] = useState([]);
  const [availableTopics, setAvailableTopics] = useState([]);
  const [availableMainTopics, setAvailableMainTopics] = useState([]);
  const [topicDistribution, setTopicDistribution] = useState([]); // Pre-aggregated from RPC
  const [filterOptions, setFilterOptions] = useState({
    regions: [],
    countries: [],
    products: [],
    countryToRegion: {}
  });

  const [selectedTopics, setSelectedTopics] = useState([]);
  const [filters, setFilters] = useState({
    dateRange: 'last_3_months',
    region: 'All',
    country: 'All',
    product: 'All'
  });

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [topics, filterOpts, mainTopics, topicDist] = await Promise.all([
          fetchTopics(),
          fetchFilters(),
          fetchMainTopics(),
          fetchTopicDistribution()  // Fast RPC for chart data
        ]);

        setAvailableTopics(topics);
        setFilterOptions(filterOpts);
        setAvailableMainTopics(mainTopics);
        setTopicDistribution(topicDist);  // Pre-aggregated chart data
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setLoading(false);
        setIsInitialized(true);
      }
    };

    loadData();
  }, []);

  // Fetch conversations when filters change
  useEffect(() => {
    const loadConversations = async () => {
      try {
        setLoading(true);
        const data = await fetchConversations(filters);
        setConversations(data);

        // Calculate previous date range for comparison
        let prevDateRange = '';
        if (filters.dateRange.startsWith('custom_')) {
          // For custom range, we'd need more complex logic to calculate previous period of same duration
          // For now, let's skip custom or implement simple duration subtraction if needed
          // Simplified: just don't fetch previous for custom for this demo unless requested
        } else {
          switch (filters.dateRange) {
            case 'today': prevDateRange = 'yesterday'; break;
            case 'yesterday': prevDateRange = 'day_before_yesterday'; break; // Backend needs to handle this or we calculate dates
            case 'last_week': prevDateRange = 'week_before_last'; break;
            case 'last_month': prevDateRange = 'month_before_last'; break;
            case 'last_3_months': prevDateRange = '3_months_before_last'; break;
            default: prevDateRange = '';
          }
        }

        // Actually, let's use the backend's date_range parameter support if it exists, 
        // or we might need to send explicit dates if the backend only supports specific strings.
        // Assuming backend supports these new keys or we need to implement them.
        // Wait, the backend README says: date_range: last_week | last_month | last_3_months
        // It doesn't seem to support arbitrary ranges easily without modification.
        // Let's assume we can pass 'custom_START_END' to the backend as the current implementation of DateRangePicker suggests.

        // Let's calculate the dates for "previous period" manually and send as custom range
        const getPreviousRange = (range) => {
          const today = new Date();
          let start, end, prevStart, prevEnd;

          if (range === 'today') {
            start = today;
            end = today;
          } else if (range === 'yesterday') {
            start = subDays(today, 1);
            end = subDays(today, 1);
          } else if (range === 'last_week') {
            start = subDays(today, 7);
            end = today;
          } else if (range === 'last_month') {
            start = subMonths(today, 1);
            end = today;
          } else if (range === 'last_3_months') {
            start = subMonths(today, 3);
            end = today;
          } else if (range.startsWith('custom_')) {
            const parts = range.split('_');
            start = parseISO(parts[1]);
            end = parseISO(parts[2]);
          }

          if (start && end) {
            const duration = end.getTime() - start.getTime();
            prevEnd = new Date(start.getTime() - 86400000); // 1 day before start
            prevStart = new Date(prevEnd.getTime() - duration);

            // Format as YYYY-MM-DD
            const fmt = d => d.toISOString().split('T')[0];
            return `custom_${fmt(prevStart)}_${fmt(prevEnd)}`;
          }
          return null;
        };

        const prevRange = getPreviousRange(filters.dateRange);
        if (prevRange) {
          const prevFilters = { ...filters, dateRange: prevRange };
          const prevData = await fetchConversations(prevFilters);
          setPreviousConversations(prevData);
        } else {
          setPreviousConversations([]);
        }

      } catch (error) {
        console.error('Error loading conversations:', error);
      } finally {
        setLoading(false);
      }
    };

    loadConversations();
  }, [filters]);

  // Handlers
  const handleFilterChange = (key, value) => {
    setFilters(prev => {
      const newFilters = { ...prev, [key]: value };

      // Country → Region auto-selection REMOVED per user request
      // if (key === 'country' && value !== 'All') { ... }

      // Region → Country reset (existing behavior)
      if (key === 'region' && value === 'All') {
        newFilters.country = 'All';
      } else if (key === 'region' && value !== 'All') {
        // Reset country when region changes
        newFilters.country = 'All';
      }

      return newFilters;
    });
  };

  // Filter countries based on selected region
  const availableCountries = useMemo(() => {
    if (filters.region === 'All') return filterOptions.countries;

    return filterOptions.countries.filter(country => {
      const region = filterOptions.countryToRegion[country];
      return region === filters.region;
    });
  }, [filters.region, filterOptions.countries, filterOptions.countryToRegion]);

  // Filter regions based on selected country
  const availableRegions = useMemo(() => {
    // User requested to not restrict regions based on country
    return filterOptions.regions;
  }, [filterOptions.regions]);

  if (loading && !isInitialized) {
    return <LoadingSpinner />;
  }

  return (
    <div className="dashboard-container">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      <main className="main-content">
        <div style={{ display: activeTab === 'intercom' ? 'block' : 'none' }}>
          <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <Filters
              filters={filters}
              onFilterChange={handleFilterChange}
              options={{ ...filterOptions, countries: availableCountries, regions: availableRegions }}
            />

            <KPIStats
              conversations={conversations}
              previousConversations={previousConversations}
            />

            <DashboardCharts
              data={conversations}
              previousData={previousConversations}
              availableTopics={availableTopics}
              availableMainTopics={availableMainTopics}
              topicDistribution={topicDistribution}
              filters={filters}
            />
          </div>
        </div>

        <div style={{ display: activeTab === 'csat' ? 'block' : 'none' }}>
          <CSAT />
        </div>

        {activeTab !== 'intercom' && activeTab !== 'csat' && (
          <div style={{ padding: '2rem', color: '#6B7280' }}>
            {/* Blank page for other tabs as requested */}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
