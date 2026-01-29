import React, { useState, useMemo, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Filters from './components/Filters';
import DashboardCharts from './components/DashboardCharts';
import DashboardHeader from './components/DashboardHeader';
import KPIStats from './components/KPIStats';
import CSAT from './components/CSAT';
import LoadingSpinner from './components/LoadingSpinner';
import FeedbackSuggestions from './components/FeedbackSuggestions';
import SentimentAnalysis from './components/SentimentAnalysis';
import ServicePerformanceOverview from './components/ServicePerformanceOverview';
import LoginPage from './components/LoginPage';
import { useAuth } from './contexts/AuthContext';
import { fetchConversations, fetchTopics, fetchFilters, fetchMainTopics, fetchTopicDistribution } from './services/api';
import { subDays, subMonths, isAfter, parseISO } from 'date-fns';

function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  // State
  const [loading, setLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState('intercom');
  const [subTab, setSubTab] = useState('issue'); // 'issue', 'query'
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
    product: 'All',
    sentiment: 'All'
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

  // Show loading while checking auth
  if (authLoading) {
    return <LoadingSpinner />;
  }

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage />;
  }

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
        onSignOut={signOut}
        userEmail={user?.email}
      />

      <main className="main-content">
        <div style={{ display: activeTab === 'intercom' ? 'block' : 'none' }}>
          <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            {/* Page Title Header */}
            <div style={{
              background: 'rgba(30, 41, 59, 0.6)',
              borderRadius: '12px',
              padding: '1rem 2rem',
              marginBottom: '1.5rem',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem'
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              <h1 style={{ 
                color: '#F8FAFC', 
                fontSize: '1.35rem', 
                fontWeight: '600', 
                margin: 0,
                letterSpacing: '0.02em'
              }}>
                Conversation Topics
              </h1>
            </div>
            
            <Filters
              filters={filters}
              onFilterChange={handleFilterChange}
              options={{ ...filterOptions, countries: availableCountries, regions: availableRegions }}
            />

            {/* Horizontal Sub-Tabs */}
            <div className="sub-tabs-bar" style={{
              display: 'flex',
              gap: '2px',
              marginBottom: '1.5rem',
              background: 'rgba(255, 255, 255, 0.03)',
              padding: '4px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              width: 'fit-content'
            }}>
              {[
                { id: 'issue', label: 'Issue Analysis' },
                { id: 'query', label: 'Query Analysis' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSubTab(tab.id)}
                  style={{
                    padding: '8px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background: subTab === tab.id ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                    color: subTab === tab.id ? '#38BDF8' : '#94A3B8',
                    fontSize: '0.875rem',
                    fontWeight: subTab === tab.id ? '600' : '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontFamily: 'var(--font-sans)'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <KPIStats
              conversations={conversations}
              previousConversations={previousConversations}
              subTab={subTab}
            />

            <DashboardCharts
              data={conversations}
              previousData={previousConversations}
              availableTopics={availableTopics}
              availableMainTopics={availableMainTopics}
              topicDistribution={topicDistribution}
              filters={filters}
              subTab={subTab}
            />
          </div>
        </div>

        <div style={{ display: activeTab === 'csat' ? 'block' : 'none' }}>
          {/* Page Title Header */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '12px',
            padding: '1rem 2rem',
            marginBottom: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
              <line x1="9" y1="9" x2="9.01" y2="9"></line>
              <line x1="15" y1="9" x2="15.01" y2="9"></line>
            </svg>
            <h1 style={{ 
              color: '#F8FAFC', 
              fontSize: '1.35rem', 
              fontWeight: '600', 
              margin: 0,
              letterSpacing: '0.02em'
            }}>
              CSAT
            </h1>
          </div>
          <CSAT />
        </div>

        <div style={{ display: activeTab === 'feedback' ? 'block' : 'none' }}>
          {/* Page Title Header */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '12px',
            padding: '1rem 2rem',
            marginBottom: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="7" x2="12" y2="13"></line>
              <line x1="9" y1="10" x2="15" y2="10"></line>
            </svg>
            <h1 style={{ 
              color: '#F8FAFC', 
              fontSize: '1.35rem', 
              fontWeight: '600', 
              margin: 0,
              letterSpacing: '0.02em'
            }}>
              Feedback and Suggestion
            </h1>
          </div>
          <FeedbackSuggestions />
        </div>

        <div style={{ display: activeTab === 'sentiment' ? 'block' : 'none' }}>
          <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            {/* Page Title Header */}
            <div style={{
              background: 'rgba(30, 41, 59, 0.6)',
              borderRadius: '12px',
              padding: '1rem 2rem',
              marginBottom: '1.5rem',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem'
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
              <h1 style={{ 
                color: '#F8FAFC', 
                fontSize: '1.35rem', 
                fontWeight: '600', 
                margin: 0,
                letterSpacing: '0.02em'
              }}>
                Sentiment Analysis
              </h1>
            </div>
            <Filters
              filters={filters}
              onFilterChange={handleFilterChange}
              options={{ ...filterOptions, countries: availableCountries, regions: availableRegions }}
            />
            <SentimentAnalysis 
              data={conversations}
              filters={filters}
            />
          </div>
        </div>

        <div style={{ display: activeTab === 'service-performance' ? 'block' : 'none' }}>
          {/* Page Title Header */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '12px',
            padding: '1rem 2rem',
            marginBottom: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="10" r="3"></circle>
              <path d="M12 13v2"></path>
            </svg>
            <h1 style={{ 
              color: '#F8FAFC', 
              fontSize: '1.35rem', 
              fontWeight: '600', 
              margin: 0,
              letterSpacing: '0.02em'
            }}>
              Service Performance Overview
            </h1>
          </div>
          <ServicePerformanceOverview />
        </div>

        {/* Conversation Inflow Tab */}
        <div style={{ display: activeTab === 'inflow' ? 'block' : 'none' }}>
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '12px',
            padding: '1rem 2rem',
            marginBottom: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            <h1 style={{ 
              color: '#F8FAFC', 
              fontSize: '1.35rem', 
              fontWeight: '600', 
              margin: 0,
              letterSpacing: '0.02em'
            }}>
              Conversation Inflow
            </h1>
          </div>
          <div style={{ padding: '4rem', color: '#64748B', textAlign: 'center', fontSize: '1.1rem' }}>
            Coming soon...
          </div>
        </div>

        {/* Ticket Inflow Tab */}
        <div style={{ display: activeTab === 'tickets' ? 'block' : 'none' }}>
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '12px',
            padding: '1rem 2rem',
            marginBottom: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v2a3 3 0 0 1 3 3 3 3 0 0 1-3 3v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1-3-3 3 3 0 0 1 3-3V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"></path>
            </svg>
            <h1 style={{ 
              color: '#F8FAFC', 
              fontSize: '1.35rem', 
              fontWeight: '600', 
              margin: 0,
              letterSpacing: '0.02em'
            }}>
              Ticket Inflow
            </h1>
          </div>
          <div style={{ padding: '4rem', color: '#64748B', textAlign: 'center', fontSize: '1.1rem' }}>
            Coming soon...
          </div>
        </div>

        {/* Performance Metrics Tab */}
        <div style={{ display: activeTab === 'performance' ? 'block' : 'none' }}>
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '12px',
            padding: '1rem 2rem',
            marginBottom: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            <h1 style={{ 
              color: '#F8FAFC', 
              fontSize: '1.35rem', 
              fontWeight: '600', 
              margin: 0,
              letterSpacing: '0.02em'
            }}>
              Performance Metrics
            </h1>
          </div>
          <div style={{ padding: '4rem', color: '#64748B', textAlign: 'center', fontSize: '1.1rem' }}>
            Coming soon...
          </div>
        </div>

        {/* Country-wise Performance Tab */}
        <div style={{ display: activeTab === 'country' ? 'block' : 'none' }}>
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '12px',
            padding: '1rem 2rem',
            marginBottom: '1.5rem',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem'
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            <h1 style={{ 
              color: '#F8FAFC', 
              fontSize: '1.35rem', 
              fontWeight: '600', 
              margin: 0,
              letterSpacing: '0.02em'
            }}>
              Country-wise Performance
            </h1>
          </div>
          <div style={{ padding: '4rem', color: '#64748B', textAlign: 'center', fontSize: '1.1rem' }}>
            Coming soon...
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
