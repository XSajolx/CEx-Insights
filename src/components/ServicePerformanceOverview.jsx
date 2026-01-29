import React, { useState, useEffect } from 'react';
import { 
  PieChart, Pie, Cell, LineChart, Line, BarChart, Bar, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, Area, AreaChart
} from 'recharts';
import {
  fetchPerformanceSummary,
  fetchDailyTrend,
  fetchSentimentDistribution,
  fetchChannelDistribution,
  fetchVolumeHeatmap,
  fetchTeammateLeaderboard,
  fetchCountryDistribution,
  fetchPerformanceTimeseries,
  fetchActiveHours,
  checkDataExists,
  formatTime
} from '../services/servicePerformanceApi';

// ============ SCORECARD COMPONENT ============
const Scorecard = ({ title, value, subtitle, trend, trendValue, isOnHold, isLoading }) => (
  <div style={{
    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
    borderRadius: '16px',
    padding: '1.25rem',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    minWidth: '180px',
    position: 'relative',
    overflow: 'hidden'
  }}>
    {isOnHold && (
      <div style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        background: 'rgba(251, 191, 36, 0.2)',
        color: '#FBBF24',
        fontSize: '0.6rem',
        padding: '2px 6px',
        borderRadius: '4px',
        fontWeight: '600'
      }}>ON HOLD</div>
    )}
    <div style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: '500', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {title}
    </div>
    <div style={{ color: '#F8FAFC', fontSize: '1.75rem', fontWeight: '700', marginBottom: '0.25rem' }}>
      {isLoading ? '...' : value}
    </div>
    {subtitle && (
      <div style={{ color: '#64748B', fontSize: '0.7rem' }}>{subtitle}</div>
    )}
    {trend && !isLoading && (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '4px', 
        marginTop: '0.5rem',
        color: trend === 'up' ? '#10B981' : trend === 'down' ? '#EF4444' : '#94A3B8',
        fontSize: '0.75rem'
      }}>
        {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
      </div>
    )}
  </div>
);

// ============ CHART CARD COMPONENT ============
const ChartCard = ({ title, children, dropdown, onDropdownChange, dropdownValue, style, isLoading }) => (
  <div style={{
    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
    borderRadius: '16px',
    padding: '1.5rem',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    ...style
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
      <h3 style={{ color: '#F8FAFC', fontSize: '1rem', fontWeight: '600', margin: 0 }}>{title}</h3>
      {dropdown && (
        <select 
          value={dropdownValue}
          onChange={(e) => onDropdownChange(e.target.value)}
          style={{
            background: 'rgba(15, 23, 42, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            color: '#94A3B8',
            padding: '6px 12px',
            fontSize: '0.75rem',
            cursor: 'pointer'
          }}
        >
          {dropdown.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </div>
    {isLoading ? (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px', color: '#64748B' }}>
        Loading...
      </div>
    ) : children}
  </div>
);

// ============ HEATMAP COMPONENT ============
const Heatmap = ({ data }) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxValue = Math.max(...data.map(d => d.value), 1);
  
  const getColor = (value) => {
    const intensity = value / maxValue;
    if (intensity < 0.2) return 'rgba(56, 189, 248, 0.1)';
    if (intensity < 0.4) return 'rgba(56, 189, 248, 0.3)';
    if (intensity < 0.6) return 'rgba(56, 189, 248, 0.5)';
    if (intensity < 0.8) return 'rgba(56, 189, 248, 0.7)';
    return 'rgba(56, 189, 248, 0.9)';
  };

  // Generate empty grid if no data
  const gridData = data.length > 0 ? data : 
    days.flatMap((day, dayIdx) => 
      Array.from({ length: 24 }, (_, hour) => ({ dayIdx, day, hour, value: 0 }))
    );

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: '3px', marginBottom: '6px', width: '100%' }}>
        <div style={{ width: '50px', flexShrink: 0 }}></div>
        <div style={{ display: 'flex', flex: 1, gap: '3px' }}>
          {Array.from({ length: 24 }, (_, i) => (
            <div key={i} style={{ 
              flex: 1, 
              textAlign: 'center', 
              fontSize: '0.65rem', 
              color: '#64748B',
              minWidth: 0
            }}>
              {i % 4 === 0 ? `${i}h` : ''}
            </div>
          ))}
        </div>
      </div>
      {days.map((day, dayIdx) => (
        <div key={day} style={{ display: 'flex', gap: '3px', marginBottom: '3px', width: '100%' }}>
          <div style={{ width: '50px', flexShrink: 0, fontSize: '0.75rem', color: '#94A3B8', display: 'flex', alignItems: 'center' }}>
            {day}
          </div>
          <div style={{ display: 'flex', flex: 1, gap: '3px' }}>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = gridData.find(d => d.dayIdx === dayIdx && d.hour === hour);
              const value = cell?.value || 0;
              return (
                <div
                  key={hour}
                  style={{
                    flex: 1,
                    aspectRatio: '1',
                    minHeight: '28px',
                    borderRadius: '4px',
                    background: getColor(value),
                    cursor: 'pointer',
                    transition: 'transform 0.1s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.65rem',
                    fontWeight: '600',
                    color: value > 0 ? '#fff' : 'transparent'
                  }}
                  title={`${day} ${hour}:00 - ${value} conversations`}
                >
                  {value > 0 ? value : ''}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px', justifyContent: 'center' }}>
        <span style={{ fontSize: '0.7rem', color: '#64748B' }}>Low</span>
        <div style={{ display: 'flex', gap: '3px' }}>
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((intensity, i) => (
            <div key={i} style={{
              width: '24px',
              height: '14px',
              borderRadius: '3px',
              background: `rgba(56, 189, 248, ${intensity})`
            }} />
          ))}
        </div>
        <span style={{ fontSize: '0.7rem', color: '#64748B' }}>High</span>
      </div>
    </div>
  );
};

// ============ NO DATA BANNER ============
const NoDataBanner = () => (
  <div style={{
    background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%)',
    border: '1px solid rgba(251, 191, 36, 0.3)',
    borderRadius: '12px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem'
  }}>
    <div style={{ fontSize: '1.5rem' }}>⚠️</div>
    <div>
      <h4 style={{ color: '#FBBF24', margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
        No Data Available - Using Demo Data
      </h4>
      <p style={{ color: '#94A3B8', margin: '0 0 0.75rem 0', fontSize: '0.875rem' }}>
        The service performance tables are empty or don't exist yet. To populate real data:
      </p>
      <ol style={{ color: '#94A3B8', margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem' }}>
        <li>Run the SQL schema in Supabase SQL Editor: <code style={{ color: '#38BDF8' }}>scripts/intercom-sync/supabase-schema.sql</code></li>
        <li>Configure your Intercom API token in the sync script</li>
        <li>Run: <code style={{ color: '#38BDF8' }}>cd scripts/intercom-sync && npm install && npm run sync</code></li>
      </ol>
    </div>
  </div>
);

// ============ GENERATE MOCK DATA ============
const generateMockData = () => {
  const knockCountData = [];
  for (let i = 30; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    knockCountData.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      total: Math.floor(Math.random() * 500) + 200,
      new: Math.floor(Math.random() * 400) + 150,
      reopened: Math.floor(Math.random() * 100) + 20
    });
  }

  const sentimentData = [
    { name: 'Positive', value: 45, color: '#10B981' },
    { name: 'Neutral', value: 35, color: '#6366F1' },
    { name: 'Negative', value: 20, color: '#EF4444' }
  ];

  const channelData = [
    { name: 'Live Chat', value: 45, color: '#38BDF8' },
    { name: 'Email', value: 25, color: '#A78BFA' },
    { name: 'Instagram', value: 15, color: '#F472B6' },
    { name: 'Facebook', value: 10, color: '#60A5FA' },
    { name: 'Telegram', value: 5, color: '#34D399' }
  ];

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const heatmapData = [];
  days.forEach((day, dayIdx) => {
    for (let hour = 0; hour < 24; hour++) {
      heatmapData.push({ day, dayIdx, hour, value: Math.floor(Math.random() * 100) });
    }
  });

  const performanceData = [];
  for (let i = 30; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    performanceData.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      FRT: Math.floor(Math.random() * 60) + 30,
      ART: Math.floor(Math.random() * 120) + 60,
      AHT: Math.floor(Math.random() * 300) + 200,
      'FRT Hit Rate': Math.floor(Math.random() * 30) + 70,
      'ART Hit Rate': Math.floor(Math.random() * 30) + 65,
      CSAT: (Math.random() * 1.5 + 3.5).toFixed(1)
    });
  }

  const teammates = ['Ahmed Khan', 'Sarah Miller', 'John Smith', 'Emily Chen', 'David Wilson',
    'Lisa Park', 'Mike Johnson', 'Anna Lee', 'Chris Brown', 'Jessica Taylor'];
  const teammateData = teammates.map(name => ({
    name,
    conversations: Math.floor(Math.random() * 200) + 50,
    FRT: Math.floor(Math.random() * 60) + 20,
    ART: Math.floor(Math.random() * 120) + 40,
    AHT: Math.floor(Math.random() * 300) + 150,
    'FRT Hit Rate': Math.floor(Math.random() * 30) + 70,
    'ART Hit Rate': Math.floor(Math.random() * 30) + 65,
    CSAT: (Math.random() * 1.5 + 3.5).toFixed(1)
  })).sort((a, b) => b.conversations - a.conversations);

  const countries = ['United States', 'United Kingdom', 'Germany', 'France', 'Canada',
    'Australia', 'Japan', 'India', 'Brazil', 'Netherlands'];
  const countryData = countries.map(name => ({
    name,
    knockCount: Math.floor(Math.random() * 1000) + 100
  })).sort((a, b) => b.knockCount - a.knockCount);

  const activeHoursData = Array.from({ length: 24 }, (_, i) => ({
    hour: `${i}:00`,
    avgActive: Math.floor(Math.random() * 50) + 10
  }));

  return { knockCountData, sentimentData, channelData, heatmapData, performanceData, teammateData, countryData, activeHoursData };
};

// ============ SEGMENT TAB COMPONENT ============
const SegmentTabs = ({ activeSegment, onSegmentChange }) => (
  <div style={{ 
    display: 'flex', 
    gap: '0.5rem', 
    marginBottom: '1.5rem',
    background: 'rgba(15, 23, 42, 0.6)',
    padding: '4px',
    borderRadius: '12px',
    width: 'fit-content'
  }}>
    {['Live Chat', 'Email', 'Ticket', 'FIN'].map(segment => (
      <button
        key={segment}
        onClick={() => onSegmentChange(segment)}
        style={{
          padding: '0.75rem 1.5rem',
          borderRadius: '10px',
          border: 'none',
          background: activeSegment === segment 
            ? 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)' 
            : 'transparent',
          color: activeSegment === segment ? '#fff' : '#94A3B8',
          fontSize: '0.875rem',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}
      >
        {segment === 'FIN' && <span>🤖</span>}
        {segment === 'Live Chat' && <span>💬</span>}
        {segment === 'Email' && <span>📧</span>}
        {segment === 'Ticket' && <span>🎫</span>}
        {segment}
      </button>
    ))}
  </div>
);

// ============ GENERATE FIN MOCK DATA ============
const generateFinMockData = () => {
  // Resolved conversation timeseries
  const resolvedTrend = [];
  for (let i = 30; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    resolvedTrend.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      resolved: Math.floor(Math.random() * 800) + 400,
      total: Math.floor(Math.random() * 1200) + 600
    });
  }

  // Resentment topics
  const resentmentTopics = [
    { name: 'Account Access Issues', count: 245 },
    { name: 'Withdrawal Delays', count: 198 },
    { name: 'Verification Problems', count: 156 },
    { name: 'Platform Errors', count: 134 },
    { name: 'Payment Processing', count: 112 },
    { name: 'Challenge Rules', count: 98 },
    { name: 'Profit Split Confusion', count: 87 },
    { name: 'Trading Restrictions', count: 76 },
    { name: 'Support Response Time', count: 65 },
    { name: 'Account Suspension', count: 54 }
  ];

  // Country insights
  const countryInsights = [
    { name: 'United States', resolved: 1250, coverage: 78, involvement: 85, resolution: 72 },
    { name: 'United Kingdom', resolved: 890, coverage: 82, involvement: 88, resolution: 76 },
    { name: 'Germany', resolved: 720, coverage: 75, involvement: 82, resolution: 68 },
    { name: 'France', resolved: 580, coverage: 80, involvement: 86, resolution: 74 },
    { name: 'Canada', resolved: 520, coverage: 77, involvement: 84, resolution: 70 },
    { name: 'Australia', resolved: 480, coverage: 79, involvement: 83, resolution: 71 },
    { name: 'India', resolved: 450, coverage: 72, involvement: 79, resolution: 65 },
    { name: 'Brazil', resolved: 380, coverage: 74, involvement: 81, resolution: 67 },
    { name: 'Netherlands', resolved: 320, coverage: 81, involvement: 87, resolution: 75 },
    { name: 'Spain', resolved: 290, coverage: 76, involvement: 82, resolution: 69 }
  ];

  return { resolvedTrend, resentmentTopics, countryInsights };
};

// ============ MAIN COMPONENT ============
const ServicePerformanceOverview = () => {
  const [activeSegment, setActiveSegment] = useState('Live Chat');
  const [performanceMetric, setPerformanceMetric] = useState('FRT');
  const [teammateMetric, setTeammateMetric] = useState('FRT');
  const [countryView, setCountryView] = useState('country');
  const [finCountryMetric, setFinCountryMetric] = useState('resolved');
  const [dateRange, setDateRange] = useState('last_30_days');
  
  // Filter states
  const [regionFilter, setRegionFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  
  const [isLoading, setIsLoading] = useState(true);
  const [hasRealData, setHasRealData] = useState(false);
  const [summary, setSummary] = useState({});
  const [knockCountData, setKnockCountData] = useState([]);
  const [sentimentData, setSentimentData] = useState([]);
  const [channelData, setChannelData] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
  const [performanceData, setPerformanceData] = useState([]);
  const [teammateData, setTeammateData] = useState([]);
  const [countryData, setCountryData] = useState([]);
  const [activeHoursData, setActiveHoursData] = useState([]);
  
  // FIN segment state
  const [finSummary, setFinSummary] = useState({
    coverageRate: 68.5,
    resolutionRate: 82.3,
    resolvedCount: 8547,
    abandonRate: 4.2,
    handoverRate: 31.5,
    accuracyRate: 94.7,
    payableAmount: 24500,
    cxScore: 4.1,
    resentmentRate: 8.3
  });
  const [finResolvedTrend, setFinResolvedTrend] = useState([]);
  const [finResentmentTopics, setFinResentmentTopics] = useState([]);
  const [finCountryInsights, setFinCountryInsights] = useState([]);
  const [finInvolvementData, setFinInvolvementData] = useState([
    { name: 'FIN (Bot)', value: 68.5, color: '#8B5CF6' },
    { name: 'Human Agents', value: 31.5, color: '#38BDF8' }
  ]);

  const performanceDropdown = [
    { value: 'FRT', label: 'First Response Time' },
    { value: 'ART', label: 'Avg Response Time' },
    { value: 'AHT', label: 'Avg Handle Time' },
    { value: 'FRT Hit Rate', label: 'FRT Hit Rate' },
    { value: 'ART Hit Rate', label: 'ART Hit Rate' },
    { value: 'CSAT', label: 'CSAT' },
    { value: 'Wait Time', label: 'Wait Time' }
  ];

  const teammateDropdown = [
    { value: 'FRT', label: 'First Response Time' },
    { value: 'ART', label: 'Avg Response Time' },
    { value: 'AHT', label: 'Avg Handle Time' },
    { value: 'FRT Hit Rate', label: 'FRT Hit Rate' },
    { value: 'ART Hit Rate', label: 'ART Hit Rate' },
    { value: 'CSAT', label: 'CSAT' }
  ];

  const goalLines = { FRT: 45, ART: 90, AHT: 250, 'FRT Hit Rate': 85, 'ART Hit Rate': 80, CSAT: 4.0, 'Wait Time': 60 };

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      console.log('🚀 Loading Service Performance data...');
      
      try {
        // Always try to fetch real data with all filters
        // For Live Chat tab, force channel to 'live_chat' to only show live chat data
        const effectiveChannel = activeSegment === 'Live Chat' ? 'live_chat' : channelFilter;
        
        const filters = { 
          dateRange, 
          region: regionFilter,
          country: countryFilter,
          channel: effectiveChannel,
          sentiment: sentimentFilter
        };
        console.log('📊 Fetching with filters:', filters, '(Segment:', activeSegment, ')');
        
        const [summaryData, trendData, sentiment, channels, heatmap, teammates, countries, hours] = await Promise.all([
          fetchPerformanceSummary(filters),
          fetchDailyTrend(filters),
          fetchSentimentDistribution(filters),
          fetchChannelDistribution(filters),
          fetchVolumeHeatmap(filters),
          fetchTeammateLeaderboard(filters),
          fetchCountryDistribution(filters),
          fetchActiveHours(filters)
        ]);
        
        console.log('📈 Summary data:', summaryData);
        console.log('📈 Trend data:', trendData?.length, 'records');
        console.log('📈 Teammates:', teammates?.length);
        console.log('📈 Countries:', countries?.length);
        
        // Check if we got real data
        const hasData = summaryData?.total_knock_count > 0;
        setHasRealData(hasData);
        console.log('📊 Has real data:', hasData, 'Total knock count:', summaryData?.total_knock_count);
        
        setSummary(summaryData);
        setKnockCountData(trendData);
        setSentimentData(sentiment);
        setChannelData(channels);
        setHeatmapData(heatmap);
        setTeammateData(teammates);
        setCountryData(countries);
        setActiveHoursData(hours);
        
        // Fetch performance timeseries
        const perfData = await fetchPerformanceTimeseries(filters, performanceMetric);
        setPerformanceData(perfData);
        console.log('✅ All data loaded successfully!');
        
        // Load FIN mock data (always use mock for now - will connect to real data later)
        const finMock = generateFinMockData();
        setFinResolvedTrend(finMock.resolvedTrend);
        setFinResentmentTopics(finMock.resentmentTopics);
        setFinCountryInsights(finMock.countryInsights);
        
      } catch (error) {
        console.error('❌ Error loading data:', error);
        setHasRealData(false);
        
        // Load FIN mock data
        const finMock = generateFinMockData();
        setFinResolvedTrend(finMock.resolvedTrend);
        setFinResentmentTopics(finMock.resentmentTopics);
        setFinCountryInsights(finMock.countryInsights);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadData();
  }, [dateRange, regionFilter, countryFilter, channelFilter, sentimentFilter, activeSegment]);

  // FIN country metric dropdown options
  const finCountryDropdown = [
    { value: 'resolved', label: 'Resolved Conversations' },
    { value: 'coverage', label: 'Coverage Rate' },
    { value: 'involvement', label: 'Involvement Rate' },
    { value: 'resolution', label: 'Resolution Rate' }
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Filters Row */}
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap',
        gap: '0.75rem', 
        marginBottom: '1.5rem',
        padding: '1rem',
        background: 'rgba(15, 23, 42, 0.4)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        {/* Date Range Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#64748B', fontSize: '0.75rem' }}>📅</span>
          <select 
            value={dateRange} 
            onChange={(e) => setDateRange(e.target.value)}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#F8FAFC',
              padding: '10px 16px',
              fontSize: '0.875rem',
              cursor: 'pointer',
              minWidth: '140px'
            }}
          >
            <option value="last_7_days">Last 7 Days</option>
            <option value="last_30_days">Last 30 Days</option>
            <option value="last_90_days">Last 90 Days</option>
          </select>
        </div>

        {/* Region Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#64748B', fontSize: '0.75rem' }}>🗺️</span>
          <select 
            value={regionFilter} 
            onChange={(e) => setRegionFilter(e.target.value)}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#F8FAFC',
              padding: '10px 16px',
              fontSize: '0.875rem',
              cursor: 'pointer',
              minWidth: '140px'
            }}
          >
            <option value="all">All Regions</option>
            <option value="asia">Asia</option>
            <option value="europe">Europe</option>
            <option value="north_america">North America</option>
            <option value="south_america">South America</option>
            <option value="africa">Africa</option>
            <option value="oceania">Oceania</option>
          </select>
        </div>

        {/* Country Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#64748B', fontSize: '0.75rem' }}>🌍</span>
          <select 
            value={countryFilter} 
            onChange={(e) => setCountryFilter(e.target.value)}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#F8FAFC',
              padding: '10px 16px',
              fontSize: '0.875rem',
              cursor: 'pointer',
              minWidth: '140px'
            }}
          >
            <option value="all">All Countries</option>
            <option value="india">India</option>
            <option value="uk">United Kingdom</option>
            <option value="usa">United States</option>
            <option value="uae">UAE</option>
            <option value="bangladesh">Bangladesh</option>
            <option value="nigeria">Nigeria</option>
            <option value="pakistan">Pakistan</option>
          </select>
        </div>

        {/* Channel Filter - Hidden on Live Chat tab (forced to live_chat) */}
        {activeSegment !== 'Live Chat' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#64748B', fontSize: '0.75rem' }}>💬</span>
            <select 
              value={channelFilter} 
              onChange={(e) => setChannelFilter(e.target.value)}
              style={{
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: '#F8FAFC',
                padding: '10px 16px',
                fontSize: '0.875rem',
                cursor: 'pointer',
                minWidth: '140px'
              }}
            >
              <option value="all">All Channels</option>
              <option value="live_chat">Live Chat</option>
              <option value="email">Email</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="telegram">Telegram</option>
            </select>
          </div>
        )}

        {/* Sentiment Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#64748B', fontSize: '0.75rem' }}>😊</span>
          <select 
            value={sentimentFilter} 
            onChange={(e) => setSentimentFilter(e.target.value)}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#F8FAFC',
              padding: '10px 16px',
              fontSize: '0.875rem',
              cursor: 'pointer',
              minWidth: '140px'
            }}
          >
            <option value="all">All Sentiments</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </select>
        </div>
      </div>

      {/* Segment Tabs */}
      <SegmentTabs activeSegment={activeSegment} onSegmentChange={setActiveSegment} />

      {/* No Data Banner - only show for Live Chat */}
      {activeSegment === 'Live Chat' && !hasRealData && !isLoading && <NoDataBanner />}

      {/* ============ FIN SEGMENT ============ */}
      {activeSegment === 'FIN' && (
        <>
          {/* FIN Scorecards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <Scorecard 
              title="Coverage Rate" 
              value={`${finSummary.coverageRate}%`} 
              subtitle="FIN handled / All conversations" 
              isLoading={isLoading} 
            />
            <Scorecard 
              title="Resolution Rate" 
              value={`${finSummary.resolutionRate}%`} 
              subtitle="Resolved / FIN involved" 
              isLoading={isLoading} 
            />
            <Scorecard 
              title="Resolved Conversations" 
              value={finSummary.resolvedCount?.toLocaleString() || '-'} 
              subtitle="Successfully handled" 
              isLoading={isLoading} 
            />
            <Scorecard 
              title="Abandon Rate" 
              value={`${finSummary.abandonRate}%`} 
              subtitle="Left without resolution" 
              isLoading={isLoading} 
            />
            <Scorecard 
              title="Teammate Handover Rate" 
              value={`${finSummary.handoverRate}%`} 
              subtitle="Transferred to agents" 
              isLoading={isLoading} 
            />
            <Scorecard 
              title="Accuracy Rate" 
              value={`${finSummary.accuracyRate}%`} 
              subtitle="Correct responses" 
              isLoading={isLoading} 
            />
            <Scorecard 
              title="Payable Amount" 
              value={`$${finSummary.payableAmount?.toLocaleString()}`} 
              subtitle="$24,500 + $0.7/resolution >35k" 
              isOnHold={true}
            />
            <Scorecard 
              title="CX Score" 
              value={finSummary.cxScore || '-'} 
              subtitle="Customer experience" 
              isLoading={isLoading} 
            />
            <Scorecard 
              title="Resentment Rate" 
              value={`${finSummary.resentmentRate}%`} 
              subtitle="Negative sentiment" 
              isLoading={isLoading} 
            />
          </div>

          {/* FIN Charts Row 1: Involvement Rate Pie & Resolved Trend */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
            <ChartCard title="Involvement Rate" isLoading={isLoading}>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie 
                    data={finInvolvementData} 
                    cx="50%" 
                    cy="50%" 
                    innerRadius={60} 
                    outerRadius={90} 
                    paddingAngle={3} 
                    dataKey="value" 
                    stroke="none"
                    label={({ name, value }) => `${value}%`}
                  >
                    {finInvolvementData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} 
                    formatter={(value) => `${value}%`}
                  />
                  <Legend 
                    verticalAlign="bottom" 
                    formatter={(value) => <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>{value}</span>} 
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Resolved Conversations Trend" isLoading={isLoading}>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={finResolvedTrend}>
                  <defs>
                    <linearGradient id="colorResolved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
                  <Legend formatter={(value) => <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>{value}</span>} />
                  <Area type="monotone" dataKey="resolved" stroke="#8B5CF6" fill="url(#colorResolved)" strokeWidth={2} name="Resolved by FIN" />
                  <Line type="monotone" dataKey="total" stroke="#38BDF8" strokeWidth={2} dot={false} name="Total FIN Involved" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* FIN Charts Row 2: Resentment Topics & Country Insights */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
            <ChartCard title="Resentment Topics (Ranked)" isLoading={isLoading}>
              <ResponsiveContainer width="100%" height={380}>
                <BarChart data={finResentmentTopics} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    tick={{ fill: '#94A3B8', fontSize: 10 }} 
                    width={130} 
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} 
                  />
                  <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
                  <Bar dataKey="count" fill="#EF4444" radius={[0, 4, 4, 0]} name="Resentment Count" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard 
              title="Countrywise Insights" 
              dropdown={finCountryDropdown}
              dropdownValue={finCountryMetric}
              onDropdownChange={setFinCountryMetric}
              isLoading={isLoading}
            >
              <ResponsiveContainer width="100%" height={380}>
                <BarChart 
                  data={[...finCountryInsights].sort((a, b) => (b[finCountryMetric] || 0) - (a[finCountryMetric] || 0))} 
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis 
                    type="number" 
                    tick={{ fill: '#64748B', fontSize: 11 }} 
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} 
                    tickFormatter={(value) => finCountryMetric === 'resolved' ? value : `${value}%`}
                  />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    tick={{ fill: '#94A3B8', fontSize: 11 }} 
                    width={110} 
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} 
                  />
                  <Tooltip 
                    contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} 
                    formatter={(value) => finCountryMetric === 'resolved' ? value : `${value}%`}
                  />
                  <Bar 
                    dataKey={finCountryMetric} 
                    fill="#10B981" 
                    radius={[0, 4, 4, 0]} 
                    name={finCountryDropdown.find(d => d.value === finCountryMetric)?.label || finCountryMetric}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}

      {/* ============ LIVE CHAT SEGMENT ============ */}
      {activeSegment === 'Live Chat' && (
        <>
          {/* Scorecards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <Scorecard title="Total Knock Count" value={summary.total_knock_count?.toLocaleString() || '-'} subtitle="New + Reopened" isLoading={isLoading} />
        <Scorecard title="New Conversations" value={summary.new_conversations?.toLocaleString() || '-'} isLoading={isLoading} />
        <Scorecard title="Reopened Conversations" value={summary.reopened_conversations?.toLocaleString() || '-'} isLoading={isLoading} />
        <Scorecard title="First Response Time" value={formatTime(summary.avg_frt_seconds)} subtitle="Avg FRT" isLoading={isLoading} />
        <Scorecard title="Avg Response Time" value={formatTime(summary.avg_art_seconds)} subtitle="ART" isLoading={isLoading} />
        <Scorecard title="Avg Handle Time" value={formatTime(summary.avg_aht_seconds)} subtitle="AHT" isLoading={isLoading} />
        <Scorecard title="FRT Hit Rate" value={summary.frt_hit_rate ? `${summary.frt_hit_rate}%` : '-'} isLoading={isLoading} />
        <Scorecard title="ART Hit Rate" value={summary.art_hit_rate ? `${summary.art_hit_rate}%` : '-'} isLoading={isLoading} />
        <Scorecard title="FCR Rate" value="x%" isOnHold={true} />
        <Scorecard title="Avg Wait Time" value={formatTime(summary.avg_wait_time_seconds)} subtitle="To connect" isLoading={isLoading} />
        <Scorecard title="Repeat Contact Rate" value="x%" subtitle="Within 48 hours" isOnHold={true} />
        <Scorecard title="Customer Effort Score" value="x%" isOnHold={true} />
        <Scorecard title="CSAT Score" value={summary.avg_csat || '-'} subtitle="Out of 5" isLoading={isLoading} />
      </div>

      {/* Charts Row 1: Sentiment & Channels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <ChartCard title="Sentiment Distribution" isLoading={isLoading}>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={sentimentData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" stroke="none">
                {sentimentData.map((entry, index) => (<Cell key={index} fill={entry.color} stroke="none" />))}
              </Pie>
              <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
              <Legend verticalAlign="bottom" formatter={(value) => <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>{value}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Conversations by Channel" isLoading={isLoading}>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={channelData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" stroke="none">
                {channelData.map((entry, index) => (<Cell key={index} fill={entry.color} stroke="none" />))}
              </Pie>
              <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
              <Legend verticalAlign="bottom" formatter={(value) => <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>{value}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Knock Count Timeseries */}
      <ChartCard title="Knock Count Timeseries" style={{ marginBottom: '1.5rem' }} isLoading={isLoading}>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={knockCountData}>
            <defs>
              <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#38BDF8" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
            <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
            <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
            <Legend formatter={(value) => <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>{value}</span>} />
            <Area type="monotone" dataKey="total" stroke="#38BDF8" fill="url(#colorTotal)" strokeWidth={2} name="Total" />
            <Line type="monotone" dataKey="new" stroke="#10B981" strokeWidth={2} dot={false} name="New" />
            <Line type="monotone" dataKey="reopened" stroke="#F59E0B" strokeWidth={2} dot={false} name="Reopened" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Volume Heatmap */}
      <ChartCard title="Volume Heatmap (Day & Hour)" style={{ marginBottom: '1.5rem' }} isLoading={isLoading}>
        <Heatmap data={heatmapData} />
      </ChartCard>

      {/* Performance Metric Timeseries */}
      <ChartCard 
        title="Performance Metric Timeseries" 
        dropdown={performanceDropdown}
        dropdownValue={performanceMetric}
        onDropdownChange={setPerformanceMetric}
        style={{ marginBottom: '1.5rem' }}
        isLoading={isLoading}
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={performanceData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
            <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
            <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
            <ReferenceLine y={goalLines[performanceMetric]} stroke="#EF4444" strokeDasharray="5 5" label={{ value: 'Goal', position: 'right', fill: '#EF4444', fontSize: 11 }} />
            <Line type="monotone" dataKey={performanceMetric} stroke="#38BDF8" strokeWidth={2} dot={{ fill: '#38BDF8', r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Teammate Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <ChartCard title="Conversations Handled by Teammate" isLoading={isLoading}>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={teammateData.slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} width={100} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
              <Bar dataKey="conversations" fill="#38BDF8" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Teammate Performance" dropdown={teammateDropdown} dropdownValue={teammateMetric} onDropdownChange={setTeammateMetric} isLoading={isLoading}>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={[...teammateData].sort((a, b) => (b[teammateMetric] || 0) - (a[teammateMetric] || 0)).slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} width={100} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
              <ReferenceLine x={goalLines[teammateMetric]} stroke="#EF4444" strokeDasharray="5 5" />
              <Bar dataKey={teammateMetric} fill="#A78BFA" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Backlog Heatmap */}
      <ChartCard title="Backlog Heatmap (Unassigned)" style={{ marginBottom: '1.5rem' }} isLoading={isLoading}>
        <Heatmap data={heatmapData.map(d => ({ ...d, value: Math.floor(d.value * 0.3) }))} />
      </ChartCard>

      {/* Country & Active Hours */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <ChartCard title="Knock Count by Location" dropdown={[{ value: 'country', label: 'By Country' }, { value: 'region', label: 'By Region' }]} dropdownValue={countryView} onDropdownChange={setCountryView} isLoading={isLoading}>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={countryData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} width={120} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
              <Bar dataKey="knockCount" fill="#10B981" radius={[0, 4, 4, 0]} name="Knock Count" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Intercom Active Hours (Avg)" isLoading={isLoading}>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={activeHoursData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="hour" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} interval={2} />
              <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <Tooltip contentStyle={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#F8FAFC' }} />
              <Bar dataKey="avgActive" fill="#F59E0B" radius={[4, 4, 0, 0]} name="Avg Active Agents" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
        </>
      )}

      {/* ============ EMAIL SEGMENT ============ */}
      {activeSegment === 'Email' && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4rem 2rem',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.7) 100%)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          marginTop: '1rem'
        }}>
          <span style={{ fontSize: '4rem', marginBottom: '1rem' }}>📧</span>
          <h2 style={{ color: '#F8FAFC', fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem' }}>
            Email Analytics
          </h2>
          <p style={{ color: '#94A3B8', fontSize: '0.9rem', textAlign: 'center', maxWidth: '400px' }}>
            Email conversation metrics and analytics will be displayed here.
            <br />
            <span style={{ color: '#64748B', fontSize: '0.8rem' }}>Coming soon...</span>
          </p>
        </div>
      )}

      {/* ============ TICKET SEGMENT ============ */}
      {activeSegment === 'Ticket' && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4rem 2rem',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.7) 100%)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          marginTop: '1rem'
        }}>
          <span style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎫</span>
          <h2 style={{ color: '#F8FAFC', fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem' }}>
            Ticket Analytics
          </h2>
          <p style={{ color: '#94A3B8', fontSize: '0.9rem', textAlign: 'center', maxWidth: '400px' }}>
            Support ticket metrics and analytics will be displayed here.
            <br />
            <span style={{ color: '#64748B', fontSize: '0.8rem' }}>Coming soon...</span>
          </p>
        </div>
      )}
    </div>
  );
};

export default ServicePerformanceOverview;
