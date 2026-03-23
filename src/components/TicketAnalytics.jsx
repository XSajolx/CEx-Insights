import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// ─── Supabase client (separate from main app) ───
const supabase = createClient(
  'https://umkzssfympyhifdjptwf.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVta3pzc2Z5bXB5aGlmZGpwdHdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NTM5MzMsImV4cCI6MjA4MzUyOTkzM30.yACHrTSkAwiDrALjn_11YS9nQ0R8OnFyDbPOY3nkzAA'
);

// ─── Constants ───
const TEAM_ABBREVS = {
  'Pro Solutions Task Force': 'PSTF',
  'Ticket Dependencies': 'T Deps',
  'CEx Reversal': 'CEx Rev',
  'Tech Team': 'TT',
  'Platform Operations': 'PO',
  'Payments and Treasury': 'P&T',
  'Back Office': 'BO',
  'Customer Experience': 'CEx',
  'GB Email Communication': 'GB Email',
};

const PIE_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#eab308', '#22c55e'];
const SLA_COLORS = ['#22c55e', '#ef4444', '#6b7280'];
const PRODUCT_COLORS = ['#8b5cf6', '#06b6d4', '#6b7280'];
const WORK_COLORS = ['#22c55e', '#6366f1'];

const DATE_PRESETS = [
  { label: 'All Time', from: null, to: null },
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: -1 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 30 Days', days: 30 },
  { label: 'Last 90 Days', days: 90 },
  { label: 'This Month', month: true },
  { label: 'Q1', q: 1 }, { label: 'Q2', q: 2 }, { label: 'Q3', q: 3 }, { label: 'Q4', q: 4 },
];

const cardStyle = {
  background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
  borderRadius: '16px',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  padding: '1.25rem',
};

// ─── Helpers ───
function formatMinutes(totalMinutes) {
  if (!totalMinutes) return '-';
  const m = Math.round(totalMinutes);
  if (m < 60) return `${m}m`;
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const rh = hours % 24;
  return `${days}d ${rh}h`;
}

function getDateRange(preset) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset.from === null && preset.to === null) return { from: null, to: null };
  if (preset.days === 0) {
    return { from: today.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
  }
  if (preset.days === -1) {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return { from: y.toISOString().slice(0, 10), to: y.toISOString().slice(0, 10) };
  }
  if (preset.days > 0) {
    const f = new Date(today); f.setDate(f.getDate() - preset.days + 1);
    return { from: f.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
  }
  if (preset.month) {
    const f = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: f.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
  }
  if (preset.q) {
    const year = now.getFullYear();
    const startMonth = (preset.q - 1) * 3;
    const f = new Date(year, startMonth, 1);
    const t = new Date(year, startMonth + 3, 0);
    return { from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) };
  }
  return { from: null, to: null };
}

function getISOWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

function groupDaily(daily, mode) {
  const entries = Object.entries(daily || {}).sort(([a], [b]) => a.localeCompare(b));
  if (mode === 'day') {
    const last30 = entries.slice(-30);
    return last30.map(([date, count]) => ({ date: date.slice(5), count }));
  }
  if (mode === 'week') {
    const map = {};
    entries.forEach(([date, count]) => {
      const wk = getISOWeekStart(date);
      map[wk] = (map[wk] || 0) + count;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date: date.slice(5), count }));
  }
  // month
  const map = {};
  entries.forEach(([date, count]) => {
    const m = date.slice(0, 7);
    map[m] = (map[m] || 0) + count;
  });
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
}

function downloadCSV(rows) {
  if (!rows || rows.length === 0) return;
  const cols = ['date', 'ticket_id', 'handler', 'team', 'resolution_minutes', 'sla', 'category'];
  const header = ['Date', 'Ticket ID', 'Handler', 'Team', 'Resolution Time', 'SLA', 'Category'];
  const csvRows = [header.join(',')];
  rows.forEach(r => {
    csvRows.push(cols.map(c => {
      let v = r[c] ?? '';
      if (c === 'resolution_minutes') v = formatMinutes(v);
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(','));
  });
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ticket_details.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ─── Custom Tooltip ───
const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
      <div style={{ color: '#94A3B8', fontSize: '0.75rem', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#F8FAFC', fontSize: '0.8rem' }}>
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</strong>
        </div>
      ))}
    </div>
  );
};

// ─── Scorecard ───
const Scorecard = ({ title, value, subtitle, icon, color }) => (
  <div style={{ ...cardStyle, minWidth: '180px', flex: 1 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: color || 'rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>{icon}</div>
      <div style={{ color: '#94A3B8', fontSize: '0.75rem', fontWeight: '500', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</div>
    </div>
    <div style={{ color: '#F8FAFC', fontSize: '1.75rem', fontWeight: '700' }}>{value}</div>
    {subtitle && <div style={{ color: '#64748B', fontSize: '0.7rem', marginTop: '0.25rem' }}>{subtitle}</div>}
  </div>
);

// ─── ChartCard ───
const ChartCard = ({ title, children, extra }) => (
  <div style={{ ...cardStyle }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
      <div style={{ color: '#F8FAFC', fontSize: '1rem', fontWeight: '600' }}>{title}</div>
      {extra}
    </div>
    {children}
  </div>
);

// ─── SearchableMultiSelect ───
const SearchableMultiSelect = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = React.useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return options;
    const s = search.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(s));
  }, [options, search]);

  const toggle = (val) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val));
    else onChange([...selected, val]);
  };

  const displayText = selected.length === 0 ? label : `${selected.length} Selected`;

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 160 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8, padding: '0.45rem 0.7rem', color: selected.length > 0 ? '#F8FAFC' : '#64748B',
          fontSize: '0.8rem', cursor: 'pointer', userSelect: 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText}</span>
        <span style={{ color: '#64748B', fontSize: '0.65rem', marginLeft: 6 }}>&#9662;</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: 'rgba(15, 23, 42, 0.98)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10, zIndex: 1000, maxHeight: 260, display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ padding: '0.4rem' }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              style={{
                width: '100%', boxSizing: 'border-box', background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6,
                padding: '0.35rem 0.5rem', color: '#F8FAFC', fontSize: '0.78rem', outline: 'none',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '0 0.3rem 0.3rem' }}>
            {filtered.map(opt => (
              <label
                key={opt}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '0.3rem 0.4rem',
                  borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', color: '#E2E8F0',
                  background: selected.includes(opt) ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                }}
                onMouseEnter={e => { if (!selected.includes(opt)) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { if (!selected.includes(opt)) e.currentTarget.style.background = 'transparent'; }}
              >
                <input
                  type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)}
                  style={{ accentColor: '#6366f1' }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
              </label>
            ))}
            {filtered.length === 0 && <div style={{ color: '#64748B', fontSize: '0.75rem', padding: '0.5rem' }}>No results</div>}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Ticket Detail Modal ───
const TicketModal = ({ row, onClose }) => {
  if (!row) return null;
  const fields = Object.entries(row).filter(([k]) => k !== '__index');
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...cardStyle, maxWidth: 560, width: '90%', maxHeight: '80vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ color: '#F8FAFC', fontSize: '1.1rem', fontWeight: '600' }}>Ticket Details</div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.3rem', cursor: 'pointer' }}
          >&times;</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {fields.map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: '#94A3B8', fontSize: '0.8rem', padding: '0.45rem 0.6rem', borderBottom: '1px solid rgba(255,255,255,0.05)', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                  {k.replace(/_/g, ' ')}
                </td>
                <td style={{ color: '#F8FAFC', fontSize: '0.8rem', padding: '0.45rem 0.6rem', borderBottom: '1px solid rgba(255,255,255,0.05)', wordBreak: 'break-word' }}>
                  {k === 'resolution_minutes' ? formatMinutes(v) : (v === null ? '-' : String(v))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Spinner ───
const Spinner = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
    <div style={{
      width: 36, height: 36, border: '3px solid rgba(99, 102, 241, 0.2)',
      borderTopColor: '#6366f1', borderRadius: '50%',
      animation: 'ta-spin 0.7s linear infinite',
    }} />
    <style>{`@keyframes ta-spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// ═══════════════════════════════════════════════════
// ─── MAIN COMPONENT ──────────────────────────────
// ═══════════════════════════════════════════════════
const TicketAnalytics = () => {
  const [aggregates, setAggregates] = useState(null);
  const [tableData, setTableData] = useState({ rows: [], total: 0 });
  const [filterOptions, setFilterOptions] = useState({ agents: [], teams: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [filters, setFilters] = useState({ from: null, to: null, agents: [], teams: [], categories: [], sla: [], search: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortColumn, setSortColumn] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [volumeView, setVolumeView] = useState('day');
  const [datePresetLabel, setDatePresetLabel] = useState('All Time');
  const [modalRow, setModalRow] = useState(null);

  // Build filter-only params (for aggregates — no sort/page params)
  const buildFilterParams = () => {
    const p = {};
    if (filters.from) p.p_from = filters.from;
    if (filters.to) p.p_to = filters.to;
    if (filters.agents.length > 0) p.p_agents = filters.agents;
    if (filters.teams.length > 0) p.p_teams = filters.teams;
    if (filters.categories.length > 0) p.p_categories = filters.categories;
    if (filters.sla.length > 0) p.p_sla = filters.sla;
    if (filters.search) p.p_search = filters.search;
    return p;
  };

  // Build table params (filter params + sort/page)
  const buildTableParams = (page = currentPage) => {
    const p = buildFilterParams();
    p.p_sort_col = sortColumn;
    p.p_sort_dir = sortDirection;
    p.p_offset = (page - 1) * pageSize;
    p.p_limit = pageSize;
    return p;
  };

  // Serialized filter key to detect changes
  const filterKey = JSON.stringify([filters.from, filters.to, filters.agents, filters.teams, filters.categories, filters.sla, filters.search]);

  // Load everything
  const loadAll = async (page = 1) => {
    setLoading(true);
    try {
      const filterP = buildFilterParams();
      const tableP = { ...filterP, p_sort_col: sortColumn, p_sort_dir: sortDirection, p_offset: (page - 1) * pageSize, p_limit: pageSize };

      console.log('[TicketAnalytics] Loading data...', filterP);

      const [aggRes, tableRes, optRes] = await Promise.allSettled([
        supabase.rpc('dashboard_aggregates', filterP),
        supabase.rpc('dashboard_table_page', tableP),
        supabase.rpc('dashboard_filter_options'),
      ]);

      if (aggRes.status === 'fulfilled' && !aggRes.value.error) {
        console.log('[TicketAnalytics] Aggregates:', aggRes.value.data);
        setAggregates(aggRes.value.data);
      } else {
        console.error('[TicketAnalytics] Aggregates error:', aggRes.status === 'fulfilled' ? aggRes.value.error : aggRes.reason);
      }

      if (tableRes.status === 'fulfilled' && !tableRes.value.error) {
        console.log('[TicketAnalytics] Table rows:', tableRes.value.data?.rows?.length);
        setTableData(tableRes.value.data || { rows: [], total: 0 });
      } else {
        console.error('[TicketAnalytics] Table error:', tableRes.status === 'fulfilled' ? tableRes.value.error : tableRes.reason);
      }

      if (optRes.status === 'fulfilled' && !optRes.value.error) {
        setFilterOptions(optRes.value.data || { agents: [], teams: [], categories: [] });
      } else {
        console.error('[TicketAnalytics] Filter options error:', optRes.status === 'fulfilled' ? optRes.value.error : optRes.reason);
      }
    } catch (err) {
      console.error('[TicketAnalytics] Unexpected error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load table only (for page/sort changes)
  const loadTableOnly = async () => {
    setTableLoading(true);
    try {
      const params = buildTableParams();
      const { data, error } = await supabase.rpc('dashboard_table_page', params);
      if (error) { console.error('[TicketAnalytics] Table page error:', error); return; }
      setTableData(data || { rows: [], total: 0 });
    } finally {
      setTableLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadAll(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when filters change (skip initial mount)
  const isFirstMount = React.useRef(true);
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    setCurrentPage(1);
    loadAll(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Reload table when page/sort changes
  const tableKey = JSON.stringify([currentPage, pageSize, sortColumn, sortDirection]);
  const isFirstTableMount = React.useRef(true);
  useEffect(() => {
    if (isFirstTableMount.current) { isFirstTableMount.current = false; return; }
    loadTableOnly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey]);

  // ─── Computed data ───
  const kpiData = useMemo(() => {
    if (!aggregates) return null;
    const total = aggregates.total || 0;
    const met = aggregates.sla_met || 0;
    const missed = aggregates.sla_missed || 0;
    return {
      total,
      metPct: total > 0 ? Math.round((met / total) * 100) : 0,
      metCount: met,
      missedPct: total > 0 ? Math.round((missed / total) * 100) : 0,
      missedCount: missed,
      avgRes: formatMinutes(aggregates.avg_resolution_minutes),
    };
  }, [aggregates]);

  const volumeData = useMemo(() => {
    if (!aggregates?.daily) return [];
    return groupDaily(aggregates.daily, volumeView);
  }, [aggregates, volumeView]);

  const teamPieData = useMemo(() => {
    if (!aggregates?.teams) return [];
    return Object.entries(aggregates.teams).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [aggregates]);

  const handlerBarData = useMemo(() => {
    if (!aggregates?.handlers) return [];
    return Object.entries(aggregates.handlers).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  }, [aggregates]);

  const categoryBarData = useMemo(() => {
    if (!aggregates?.categories) return [];
    return Object.entries(aggregates.categories).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  }, [aggregates]);

  const slaPieData = useMemo(() => {
    if (!aggregates) return [];
    return [
      { name: 'Met', value: aggregates.sla_met || 0 },
      { name: 'Missed', value: aggregates.sla_missed || 0 },
      { name: 'N/A', value: aggregates.sla_na || 0 },
    ];
  }, [aggregates]);

  const productPieData = useMemo(() => {
    if (!aggregates?.product_types) return [];
    return Object.entries(aggregates.product_types).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [aggregates]);

  const teamSlaData = useMemo(() => {
    if (!aggregates?.team_sla) return [];
    return aggregates.team_sla.map(t => ({
      team: TEAM_ABBREVS[t.team] || t.team,
      slaPct: t.met + t.missed > 0 ? Math.round((t.met / (t.met + t.missed)) * 100) : 0,
      avgRes: Math.round(t.avg_res || 0),
    }));
  }, [aggregates]);

  const workVsNonWork = useMemo(() => {
    if (!aggregates?.avg_res_work) return [];
    const w = aggregates.avg_res_work;
    const workAvg = w.work_count > 0 ? w.work_sum / w.work_count : 0;
    const nonworkAvg = w.nonwork_count > 0 ? w.nonwork_sum / w.nonwork_count : 0;
    return [
      { name: 'Work Hours', minutes: Math.round(workAvg) },
      { name: 'After Hours', minutes: Math.round(nonworkAvg) },
    ];
  }, [aggregates]);

  const agentSlaData = useMemo(() => {
    if (!aggregates?.agent_sla) return [];
    return [...aggregates.agent_sla]
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 20);
  }, [aggregates]);

  // ─── Filter handlers ───
  const handleDatePreset = (preset) => {
    const range = getDateRange(preset);
    setDatePresetLabel(preset.label);
    setFilters(f => ({ ...f, from: range.from, to: range.to }));
  };

  const handleReset = () => {
    setFilters({ from: null, to: null, agents: [], teams: [], categories: [], sla: [], search: '' });
    setDatePresetLabel('All Time');
    setCurrentPage(1);
    setSortColumn('date');
    setSortDirection('desc');
    setVolumeView('day');
  };

  const handleSort = (col) => {
    if (sortColumn === col) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDirection('desc'); }
    setCurrentPage(1);
  };

  const totalPages = Math.ceil((tableData.total || 0) / pageSize);

  // SLA badge
  const slaBadge = (val) => {
    const s = String(val || '').toLowerCase();
    let bg = 'rgba(107, 114, 128, 0.25)'; let c = '#9CA3AF'; let text = val || 'N/A';
    if (s === 'met') { bg = 'rgba(34, 197, 94, 0.2)'; c = '#22c55e'; text = 'Met'; }
    else if (s === 'missed') { bg = 'rgba(239, 68, 68, 0.2)'; c = '#EF4444'; text = 'Missed'; }
    return <span style={{ background: bg, color: c, padding: '2px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600 }}>{text}</span>;
  };

  // ─── Render ───
  return (
    <div style={{ padding: '0.5rem 0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Title */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ color: '#F8FAFC', fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>Ticket Analytics</h2>
        <p style={{ color: '#64748B', fontSize: '0.82rem', margin: '0.25rem 0 0' }}>Real-time ticket tracking and SLA performance</p>
      </div>

      {/* ─── Filters ─── */}
      <div style={{
        ...cardStyle, marginBottom: '1.25rem',
        display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center',
      }}>
        {/* Date preset */}
        <div style={{ position: 'relative', minWidth: 140 }}>
          <select
            value={datePresetLabel}
            onChange={e => {
              const p = DATE_PRESETS.find(d => d.label === e.target.value);
              if (p) handleDatePreset(p);
            }}
            style={{
              width: '100%', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '0.45rem 0.7rem', color: '#F8FAFC', fontSize: '0.8rem',
              appearance: 'none', cursor: 'pointer', outline: 'none',
            }}
          >
            {DATE_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
          </select>
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', fontSize: '0.6rem', pointerEvents: 'none' }}>&#9662;</span>
        </div>

        {/* Handler */}
        <SearchableMultiSelect
          label="Handler" options={filterOptions.agents || []}
          selected={filters.agents} onChange={v => setFilters(f => ({ ...f, agents: v }))}
        />

        {/* Team */}
        <SearchableMultiSelect
          label="Team" options={filterOptions.teams || []}
          selected={filters.teams} onChange={v => setFilters(f => ({ ...f, teams: v }))}
        />

        {/* Category */}
        <SearchableMultiSelect
          label="Category" options={filterOptions.categories || []}
          selected={filters.categories} onChange={v => setFilters(f => ({ ...f, categories: v }))}
        />

        {/* SLA */}
        <div style={{ minWidth: 110 }}>
          <select
            value={filters.sla.length === 1 ? filters.sla[0] : ''}
            onChange={e => setFilters(f => ({ ...f, sla: e.target.value ? [e.target.value] : [] }))}
            style={{
              width: '100%', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '0.45rem 0.7rem', color: filters.sla.length ? '#F8FAFC' : '#64748B',
              fontSize: '0.8rem', appearance: 'none', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="">All SLA</option>
            <option value="met">Met</option>
            <option value="missed">Missed</option>
            <option value="n/a">N/A</option>
          </select>
        </div>

        {/* Search */}
        <input
          placeholder="Search tickets..."
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          style={{
            background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '0.45rem 0.7rem', color: '#F8FAFC', fontSize: '0.8rem',
            minWidth: 160, outline: 'none', flex: 1,
          }}
        />

        {/* Reset */}
        <button
          onClick={handleReset}
          style={{
            background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '0.45rem 0.9rem', color: '#EF4444', fontSize: '0.8rem',
            cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          Reset
        </button>
      </div>

      {loading && !aggregates ? <Spinner /> : aggregates && (
        <>
          {/* ─── KPI Row ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem', marginBottom: '1.25rem' }}>
            <Scorecard title="Total Tickets" value={(kpiData?.total || 0).toLocaleString()} icon="🎫" color="rgba(99,102,241,0.2)" />
            <Scorecard title="SLA Met" value={`${kpiData?.metPct || 0}%`} subtitle={`(${(kpiData?.metCount || 0).toLocaleString()})`} icon="✅" color="rgba(34,197,94,0.2)" />
            <Scorecard title="SLA Missed" value={`${kpiData?.missedPct || 0}%`} subtitle={`(${(kpiData?.missedCount || 0).toLocaleString()})`} icon="❌" color="rgba(239,68,68,0.2)" />
            <Scorecard title="Avg Resolution" value={kpiData?.avgRes || '-'} icon="⏱️" color="rgba(59,130,246,0.2)" />
          </div>

          {/* ─── Charts Grid ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '0.8rem', marginBottom: '0.8rem' }}>

            {/* Row 1 — Volume */}
            <ChartCard
              title="Ticket Volume"
              extra={
                <div style={{ display: 'flex', gap: 4 }}>
                  {['day', 'week', 'month'].map(v => (
                    <button
                      key={v} onClick={() => setVolumeView(v)}
                      style={{
                        background: volumeView === v ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
                        padding: '2px 10px', color: volumeView === v ? '#a5b4fc' : '#64748B',
                        fontSize: '0.7rem', cursor: 'pointer', textTransform: 'capitalize',
                      }}
                    >{v}s</button>
                  ))}
                </div>
              }
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={volumeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} />
                  <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} />
                  <Tooltip content={<DarkTooltip />} />
                  <Bar dataKey="count" name="Tickets" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Row 1 — Team Distribution */}
            <ChartCard title="Team Distribution">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ResponsiveContainer width="55%" height={260}>
                  <PieChart>
                    <Pie data={teamPieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" nameKey="name" stroke="none">
                      {teamPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<DarkTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1, maxHeight: 260, overflowY: 'auto' }}>
                  {teamPieData.map((t, i) => {
                    const total = teamPieData.reduce((s, x) => s + x.value, 0);
                    return (
                      <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: '0.72rem' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                        <span style={{ color: '#E2E8F0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                        <span style={{ color: '#94A3B8', whiteSpace: 'nowrap' }}>{t.value} ({total > 0 ? Math.round((t.value / total) * 100) : 0}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ChartCard>

            {/* Row 2 — Top 10 Handlers */}
            <ChartCard title="Top 10 Handlers">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={handlerBarData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                  <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} />
                  <Tooltip content={<DarkTooltip />} />
                  <Bar dataKey="count" name="Tickets" fill="rgba(139, 92, 246, 0.7)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Row 2 — Category */}
            <ChartCard title="Ticket Category">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categoryBarData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                  <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} />
                  <Tooltip content={<DarkTooltip />} />
                  <Bar dataKey="count" name="Tickets" fill="rgba(99, 102, 241, 0.7)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Row 3 — SLA Breakdown */}
            <ChartCard title="SLA Breakdown">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <ResponsiveContainer width="60%" height={260}>
                  <PieChart>
                    <Pie data={slaPieData} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" nameKey="name" stroke="none" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {slaPieData.map((_, i) => <Cell key={i} fill={SLA_COLORS[i]} />)}
                    </Pie>
                    <Tooltip content={<DarkTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {slaPieData.map((d, i) => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: SLA_COLORS[i] }} />
                      <span style={{ color: '#E2E8F0', fontSize: '0.82rem' }}>{d.name}</span>
                      <span style={{ color: '#94A3B8', fontSize: '0.82rem', marginLeft: 'auto' }}>{d.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ChartCard>

            {/* Row 3 — Product Type */}
            <ChartCard title="Product Type">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <ResponsiveContainer width="60%" height={260}>
                  <PieChart>
                    <Pie data={productPieData} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" nameKey="name" stroke="none" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {productPieData.map((_, i) => <Cell key={i} fill={PRODUCT_COLORS[i % PRODUCT_COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<DarkTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {productPieData.map((d, i) => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }} />
                      <span style={{ color: '#E2E8F0', fontSize: '0.82rem' }}>{d.name}</span>
                      <span style={{ color: '#94A3B8', fontSize: '0.82rem', marginLeft: 'auto' }}>{d.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ChartCard>

            {/* Row 4 — Team SLA Performance */}
            <ChartCard title="Team SLA Performance & Avg Resolution">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={teamSlaData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                  <XAxis dataKey="team" tick={{ fill: '#94A3B8', fontSize: 10 }} axisLine={{ stroke: '#64748B' }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis yAxisId="left" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} label={{ value: 'SLA %', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} label={{ value: 'Avg Res (min)', angle: 90, position: 'insideRight', fill: '#64748B', fontSize: 11 }} />
                  <Tooltip content={<DarkTooltip />} />
                  <Legend wrapperStyle={{ color: '#94A3B8', fontSize: '0.75rem' }} />
                  <Bar yAxisId="left" dataKey="slaPct" name="SLA Met %" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="avgRes" name="Avg Resolution (min)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Row 4 — Work vs Non-Work */}
            <ChartCard title="Average Resolution: Work vs Non-Work">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={workVsNonWork}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 12 }} axisLine={{ stroke: '#64748B' }} />
                  <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#64748B' }} label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11 }} />
                  <Tooltip content={<DarkTooltip />} />
                  <Bar dataKey="minutes" name="Avg Resolution (min)" radius={[6, 6, 0, 0]}>
                    {workVsNonWork.map((_, i) => <Cell key={i} fill={WORK_COLORS[i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* ─── Row 5 — Agent SLA Table ─── */}
          <div style={{ ...cardStyle, marginBottom: '0.8rem' }}>
            <div style={{ color: '#F8FAFC', fontSize: '1rem', fontWeight: '600', marginBottom: '1rem' }}>Agent SLA Performance</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                <thead>
                  <tr>
                    {['Agent', 'Total', 'Met', 'Missed', 'SLA %', 'Avg Resolution'].map(h => (
                      <th key={h} style={{
                        color: '#94A3B8', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase',
                        letterSpacing: '0.5px', padding: '0.6rem 0.8rem', textAlign: 'left',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentSlaData.map((a, idx) => {
                    const slaPct = (a.met || 0) + (a.missed || 0) > 0
                      ? Math.round(((a.met || 0) / ((a.met || 0) + (a.missed || 0))) * 100)
                      : 0;
                    const slaColor = slaPct >= 90 ? '#22c55e' : slaPct >= 75 ? '#eab308' : '#EF4444';
                    return (
                      <tr key={a.name || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ color: '#F8FAFC', fontSize: '0.82rem', padding: '0.55rem 0.8rem' }}>{a.name}</td>
                        <td style={{ color: '#E2E8F0', fontSize: '0.82rem', padding: '0.55rem 0.8rem' }}>{(a.total || 0).toLocaleString()}</td>
                        <td style={{ color: '#22c55e', fontSize: '0.82rem', padding: '0.55rem 0.8rem' }}>{(a.met || 0).toLocaleString()}</td>
                        <td style={{ color: '#EF4444', fontSize: '0.82rem', padding: '0.55rem 0.8rem' }}>{(a.missed || 0).toLocaleString()}</td>
                        <td style={{ color: slaColor, fontSize: '0.82rem', padding: '0.55rem 0.8rem', fontWeight: 700 }}>{slaPct}%</td>
                        <td style={{ color: '#E2E8F0', fontSize: '0.82rem', padding: '0.55rem 0.8rem' }}>{formatMinutes(a.avg_handle_min)}</td>
                      </tr>
                    );
                  })}
                  {agentSlaData.length === 0 && (
                    <tr><td colSpan={6} style={{ color: '#64748B', padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem' }}>No data available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Row 6 — Ticket Details Table ─── */}
          <div style={{ ...cardStyle }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ color: '#F8FAFC', fontSize: '1rem', fontWeight: '600' }}>
                Ticket Details
                <span style={{ color: '#64748B', fontSize: '0.78rem', fontWeight: 400, marginLeft: 8 }}>
                  ({(tableData.total || 0).toLocaleString()} total)
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, padding: '4px 8px', color: '#E2E8F0', fontSize: '0.75rem', outline: 'none',
                  }}
                >
                  {[25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
                <button
                  onClick={() => downloadCSV(tableData.rows)}
                  style={{
                    background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: 6, padding: '4px 12px', color: '#a5b4fc', fontSize: '0.75rem',
                    cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Export CSV
                </button>
              </div>
            </div>

            {tableLoading && <Spinner />}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                <thead>
                  <tr>
                    {[
                      { key: 'date', label: 'Date' },
                      { key: 'ticket_id', label: 'Ticket ID' },
                      { key: 'handler', label: 'Handler' },
                      { key: 'team', label: 'Team' },
                      { key: 'resolution_minutes', label: 'Resolution Time' },
                      { key: 'sla', label: 'SLA' },
                      { key: 'category', label: 'Category' },
                    ].map(col => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        style={{
                          color: sortColumn === col.key ? '#a5b4fc' : '#94A3B8',
                          fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase',
                          letterSpacing: '0.5px', padding: '0.6rem 0.8rem', textAlign: 'left',
                          borderBottom: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
                          userSelect: 'none', whiteSpace: 'nowrap',
                        }}
                      >
                        {col.label}
                        {sortColumn === col.key && (
                          <span style={{ marginLeft: 4, fontSize: '0.6rem' }}>{sortDirection === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tableData.rows || []).map((row, idx) => (
                    <tr
                      key={row.ticket_id || idx}
                      onClick={() => setModalRow(row)}
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ color: '#E2E8F0', fontSize: '0.8rem', padding: '0.5rem 0.8rem', whiteSpace: 'nowrap' }}>{row.date}</td>
                      <td style={{ color: '#a5b4fc', fontSize: '0.8rem', padding: '0.5rem 0.8rem' }}>{row.ticket_id}</td>
                      <td style={{ color: '#E2E8F0', fontSize: '0.8rem', padding: '0.5rem 0.8rem' }}>{row.handler}</td>
                      <td style={{ color: '#E2E8F0', fontSize: '0.8rem', padding: '0.5rem 0.8rem' }}>{row.team}</td>
                      <td style={{ color: '#E2E8F0', fontSize: '0.8rem', padding: '0.5rem 0.8rem' }}>{formatMinutes(row.resolution_minutes)}</td>
                      <td style={{ padding: '0.5rem 0.8rem' }}>{slaBadge(row.sla)}</td>
                      <td style={{ color: '#E2E8F0', fontSize: '0.8rem', padding: '0.5rem 0.8rem' }}>{row.category}</td>
                    </tr>
                  ))}
                  {(!tableData.rows || tableData.rows.length === 0) && !tableLoading && (
                    <tr><td colSpan={7} style={{ color: '#64748B', padding: '1.5rem', textAlign: 'center', fontSize: '0.85rem' }}>No tickets found</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, padding: '4px 12px', color: currentPage <= 1 ? '#334155' : '#E2E8F0',
                    fontSize: '0.78rem', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >Prev</button>

                {(() => {
                  const pages = [];
                  const maxVisible = 5;
                  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                  let end = Math.min(totalPages, start + maxVisible - 1);
                  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

                  if (start > 1) {
                    pages.push(
                      <button key={1} onClick={() => setCurrentPage(1)}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 10px', color: '#E2E8F0', fontSize: '0.78rem', cursor: 'pointer' }}
                      >1</button>
                    );
                    if (start > 2) pages.push(<span key="s1" style={{ color: '#64748B', fontSize: '0.75rem' }}>...</span>);
                  }

                  for (let i = start; i <= end; i++) {
                    pages.push(
                      <button key={i} onClick={() => setCurrentPage(i)}
                        style={{
                          background: i === currentPage ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                          border: '1px solid', borderColor: i === currentPage ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)',
                          borderRadius: 6, padding: '4px 10px', color: i === currentPage ? '#a5b4fc' : '#E2E8F0',
                          fontSize: '0.78rem', cursor: 'pointer', fontWeight: i === currentPage ? 700 : 400,
                        }}
                      >{i}</button>
                    );
                  }

                  if (end < totalPages) {
                    if (end < totalPages - 1) pages.push(<span key="s2" style={{ color: '#64748B', fontSize: '0.75rem' }}>...</span>);
                    pages.push(
                      <button key={totalPages} onClick={() => setCurrentPage(totalPages)}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 10px', color: '#E2E8F0', fontSize: '0.78rem', cursor: 'pointer' }}
                      >{totalPages}</button>
                    );
                  }
                  return pages;
                })()}

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, padding: '4px 12px', color: currentPage >= totalPages ? '#334155' : '#E2E8F0',
                    fontSize: '0.78rem', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                  }}
                >Next</button>

                <span style={{ color: '#64748B', fontSize: '0.72rem', marginLeft: 8 }}>
                  Page {currentPage} of {totalPages}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ─── Modal ─── */}
      {modalRow && <TicketModal row={modalRow} onClose={() => setModalRow(null)} />}
    </div>
  );
};

export default TicketAnalytics;
