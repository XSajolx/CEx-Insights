import React, { useState, useRef, useCallback } from 'react';

// ============================================================
// Constants
// ============================================================
const HOUR_LABELS = [
  "12AM-1AM","1AM-2AM","2AM-3AM","3AM-4AM","4AM-5AM","5AM-6AM",
  "6AM-7AM","7AM-8AM","8AM-9AM","9AM-10AM","10AM-11AM","11AM-12PM",
  "12PM-1PM","1PM-2PM","2PM-3PM","3PM-4PM","4PM-5PM","5PM-6PM",
  "6PM-7PM","7PM-8PM","8PM-9PM","9PM-10PM","10PM-11PM","11PM-12AM",
];
const DAY_NAMES_H = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

const SHIFTS = [
  { label: "7AM-1PM", hours: [7,8,9,10,11,12], crossesMidnight: false },
  { label: "1PM-10PM", hours: [13,14,15,16,17,18,19,20,21], crossesMidnight: false },
  { label: "10PM-3AM", hoursToday: [22,23], hoursTomorrow: [0,1,2], crossesMidnight: true, totalHours: 5 },
  { label: "3AM-7AM", hours: [3,4,5,6], crossesMidnight: false },
];

const ALL_SHIFTS_DEF = [
  { hours: [7,8,9,10,11,12], nextDayHours: [] },
  { hours: [13,14,15,16,17,18,19,20,21], nextDayHours: [] },
  { hours: [22,23], nextDayHours: [0,1,2] },
  { hours: [], nextDayHours: [3,4,5,6] },
];

const NEXT_DAY_MAP = {};
for (let i = 0; i < DAY_NAMES_H.length; i++) {
  NEXT_DAY_MAP[DAY_NAMES_H[i]] = DAY_NAMES_H[(i + 1) % 7];
}

const API_BASE = window.location.origin + "/api";

// ============================================================
// Theme-matched styles (CEx Insights dark glassmorphism)
// ============================================================
const S = {
  card: {
    background: 'rgba(15, 20, 35, 0.6)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '12px',
    padding: '20px',
    backdropFilter: 'blur(20px)',
  },
  summaryCard: (color) => ({
    background: 'rgba(15, 20, 35, 0.6)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'center',
    backdropFilter: 'blur(20px)',
  }),
  summaryValue: (color) => ({
    fontSize: '2rem',
    fontWeight: '700',
    color,
    textShadow: `0 0 20px ${color}40`,
  }),
  summaryLabel: {
    fontSize: '0.7rem',
    color: '#64748B',
    textTransform: 'uppercase',
    marginTop: '4px',
    letterSpacing: '0.05em',
    fontWeight: '600',
  },
  tableWrap: {
    overflowX: 'auto',
    background: 'rgba(15, 20, 35, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '10px',
  },
  th: (bg) => ({
    padding: '10px 12px',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: '0.78rem',
    background: bg,
    color: '#fff',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    whiteSpace: 'nowrap',
  }),
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    fontSize: '0.82rem',
    color: '#F8FAFC',
    textAlign: 'center',
  },
  sectionTitle: (color) => ({
    fontSize: '0.95rem',
    color,
    margin: '24px 0 10px',
    padding: '10px 14px',
    background: 'rgba(15, 20, 35, 0.6)',
    borderLeft: `4px solid ${color}`,
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.06)',
    fontWeight: '600',
  }),
  input: {
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    fontSize: '0.85rem',
    color: '#F8FAFC',
    background: 'rgba(15, 20, 35, 0.8)',
    outline: 'none',
    width: '100%',
  },
  btn: {
    background: 'linear-gradient(135deg, #06B6D4, #3B82F6)',
    color: '#fff',
    border: 'none',
    padding: '10px 24px',
    borderRadius: '10px',
    fontSize: '0.9rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 0 20px rgba(6,182,212,0.3)',
  },
  btnPdf: {
    background: 'linear-gradient(135deg, #22C55E, #059669)',
    color: '#fff',
    border: 'none',
    padding: '10px 24px',
    borderRadius: '10px',
    fontSize: '0.9rem',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 0 20px rgba(34,197,94,0.3)',
  },
  weekHeader: {
    fontSize: '0.9rem',
    color: '#F8FAFC',
    padding: '12px 14px',
    background: 'rgba(6,182,212,0.08)',
    borderRadius: '10px',
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: '1px solid rgba(6,182,212,0.15)',
    marginBottom: '4px',
  },
};

// ============================================================
// Helpers
// ============================================================
function nowGMT6() { return new Date(Date.now() + 6 * 3600 * 1000); }

function buildDateList(from, to) {
  const dates = [];
  const current = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function getDayNameJS(dateStr) {
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const d = new Date(dateStr + "T00:00:00Z");
  return days[d.getUTCDay()];
}

function heatColor(val, minVal, maxVal, dark = false) {
  if (maxVal === minVal) return dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)';
  const ratio = (val - minVal) / (maxVal - minVal);
  if (dark) {
    // Dark-theme heatmap: from dark blue to cyan to yellow to red
    if (ratio < 0.33) {
      const g = Math.round(80 + ratio * 3 * 140);
      return `rgba(20, ${g}, 180, ${0.15 + ratio * 0.5})`;
    } else if (ratio < 0.66) {
      const r = Math.round((ratio - 0.33) * 3 * 200);
      return `rgba(${r}, 220, 100, ${0.3 + ratio * 0.3})`;
    } else {
      const g = Math.round(220 - (ratio - 0.66) * 3 * 160);
      return `rgba(240, ${g}, 60, ${0.4 + ratio * 0.3})`;
    }
  }
  if (ratio < 0.5) {
    const r = Math.round(255 * (ratio * 2));
    return `rgb(${r}, 200, 80)`;
  }
  const g = Math.round(200 * (1 - (ratio - 0.5) * 2));
  return `rgb(255, ${g}, 80)`;
}

function groupByWeek(days) {
  const weeks = [];
  let cw = null;
  for (const d of days) {
    const dt = new Date(d.date + "T00:00:00Z");
    const month = dt.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    const weekNum = Math.ceil(dt.getUTCDate() / 7);
    const weekKey = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}-W${weekNum}`;
    if (!cw || cw.key !== weekKey) {
      cw = { key: weekKey, label: `Week ${weekNum} of ${month} ${dt.getUTCFullYear()}`, days: [], totals: { chat:0, email:0, fin:0, ticket:0, cfd:0, fut:0 } };
      weeks.push(cw);
    }
    cw.days.push(d);
    cw.totals.chat += d.chat;
    cw.totals.email += d.email;
    cw.totals.fin += d.fin;
    cw.totals.ticket += d.ticket;
    cw.totals.cfd += d.cfd || 0;
    cw.totals.fut += d.fut || 0;
  }
  return weeks;
}

// ============================================================
// Sub-components
// ============================================================
function SummaryCards({ days }) {
  const totalChat = days.reduce((s,d) => s+d.chat, 0);
  const totalEmail = days.reduce((s,d) => s+d.email, 0);
  const totalFin = days.reduce((s,d) => s+d.fin, 0);
  const totalTicket = days.reduce((s,d) => s+d.ticket, 0);
  const totalCfd = days.reduce((s,d) => s+(d.cfd||0), 0);
  const totalFut = days.reduce((s,d) => s+(d.fut||0), 0);
  const grand = totalChat + totalEmail + totalTicket;

  const cards = [
    { label: 'Grand Total', value: grand, color: '#06B6D4' },
    { label: 'Live Chat', value: totalChat, color: '#A855F7' },
    { label: 'Email', value: totalEmail, color: '#FBBF24' },
    { label: 'Ticket', value: totalTicket, color: '#22C55E' },
    { label: 'FIN Resolution', value: totalFin, color: '#3B82F6' },
    { label: 'CFD Chats', value: totalCfd, color: '#EF4444' },
    { label: 'Futures Chats', value: totalFut, color: '#F97316' },
  ];

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'12px', marginBottom:'24px' }}>
      {cards.map(c => (
        <div key={c.label} style={S.summaryCard(c.color)}>
          <div style={S.summaryValue(c.color)}>{c.value}</div>
          <div style={S.summaryLabel}>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function WeekTable({ week, idx, expanded, onToggle }) {
  const wTotal = week.totals.chat + week.totals.email + week.totals.fin + week.totals.ticket;
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={S.weekHeader} onClick={() => onToggle(idx)}>
        <span><span style={{ display:'inline-block', marginRight:'8px', transition:'transform 0.2s' }}>{expanded ? '\u25BC' : '\u25B6'}</span>{week.label}</span>
        <span style={{ color:'#06B6D4', fontWeight:'700' }}>{wTotal} total</span>
      </div>
      {expanded && (
        <div style={{ ...S.tableWrap, marginTop:'8px' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['Day','Date','Chat','Email','FIN','Ticket','CFD','FUT','Total'].map(h => (
                  <th key={h} style={S.th('rgba(6,182,212,0.15)')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {week.days.map(d => {
                const total = d.chat + d.email + d.fin + d.ticket;
                const isWknd = d.day === "Saturday" || d.day === "Sunday";
                return (
                  <tr key={d.date} style={isWknd ? { background:'rgba(251,191,36,0.06)' } : {}}>
                    <td style={{...S.td, fontWeight:'600', textAlign:'left'}}>{d.day}</td>
                    <td style={{...S.td, textAlign:'left', color:'#94A3B8'}}>{d.date}</td>
                    <td style={{...S.td, color:'#A855F7', fontWeight:'600'}}>{d.chat}</td>
                    <td style={{...S.td, color:'#FBBF24', fontWeight:'600'}}>{d.email}</td>
                    <td style={{...S.td, color:'#3B82F6', fontWeight:'600'}}>{d.fin}</td>
                    <td style={{...S.td, color:'#22C55E', fontWeight:'600'}}>{d.ticket}</td>
                    <td style={{...S.td, color:'#EF4444', fontWeight:'600'}}>{d.cfd}</td>
                    <td style={{...S.td, color:'#F97316', fontWeight:'600'}}>{d.fut}</td>
                    <td style={{...S.td, fontWeight:'700'}}>{total}</td>
                  </tr>
                );
              })}
              <tr style={{ background:'rgba(6,182,212,0.08)' }}>
                <td colSpan="2" style={{...S.td, fontWeight:'700', textAlign:'left'}}>Week Total</td>
                <td style={{...S.td, color:'#A855F7', fontWeight:'700'}}>{week.totals.chat}</td>
                <td style={{...S.td, color:'#FBBF24', fontWeight:'700'}}>{week.totals.email}</td>
                <td style={{...S.td, color:'#3B82F6', fontWeight:'700'}}>{week.totals.fin}</td>
                <td style={{...S.td, color:'#22C55E', fontWeight:'700'}}>{week.totals.ticket}</td>
                <td style={{...S.td, color:'#EF4444', fontWeight:'700'}}>{week.totals.cfd}</td>
                <td style={{...S.td, color:'#F97316', fontWeight:'700'}}>{week.totals.fut}</td>
                <td style={{...S.td, fontWeight:'700'}}>{wTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HourlyHeatmap({ avgData, title, themeColor }) {
  let minV = Infinity, maxV = -Infinity;
  for (const day of DAY_ORDER) for (let h = 0; h < 24; h++) { const v = avgData[day]?.[h] ?? 0; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  if (minV === maxV) { minV = 0; maxV = Math.max(1, maxV); }

  const dayTotals = {};
  for (const day of DAY_ORDER) dayTotals[day] = (avgData[day] || Array(24).fill(0)).reduce((s,v) => s+v, 0);

  return (
    <div>
      <div style={S.sectionTitle(themeColor)}>{title}</div>
      <div style={S.tableWrap}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead>
            <tr>
              <th style={{...S.th(themeColor), textAlign:'left'}}>Hour</th>
              {DAY_ORDER.map(d => <th key={d} style={S.th(themeColor)}>{d.slice(0,3)}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({length:24}, (_,h) => (
              <tr key={h}>
                <td style={{...S.td, fontWeight:'600', whiteSpace:'nowrap', textAlign:'left', background:'rgba(15,20,35,0.5)', color:'#94A3B8'}}>{HOUR_LABELS[h]}</td>
                {DAY_ORDER.map(day => {
                  const val = avgData[day]?.[h] ?? 0;
                  const bg = heatColor(val, minV, maxV, true);
                  return <td key={day} style={{...S.td, background:bg, fontWeight:'600'}}>{val}</td>;
                })}
              </tr>
            ))}
            <tr>
              <td style={{...S.td, background:themeColor, color:'#fff', fontWeight:'700', textAlign:'left'}}>Daily Avg</td>
              {DAY_ORDER.map(d => <td key={d} style={{...S.td, background:themeColor, color:'#fff', fontWeight:'700'}}>{dayTotals[d]}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AvgInflowTable({ avgInflowData, shifts, title, themeColor }) {
  let minV = Infinity, maxV = -Infinity;
  for (const day of DAY_ORDER) for (let si = 0; si < shifts.length; si++) { const v = avgInflowData[day]?.[si] ?? 0; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  if (minV === maxV) { minV = 0; maxV = Math.max(1, maxV); }

  return (
    <div>
      <div style={S.sectionTitle(themeColor)}>{title}</div>
      <div style={S.tableWrap}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead><tr>
            <th style={{...S.th(themeColor), textAlign:'left'}}>Shift</th>
            {DAY_ORDER.map(d => <th key={d} style={S.th(themeColor)}>{d.slice(0,3)}</th>)}
          </tr></thead>
          <tbody>
            {shifts.map((shift, si) => (
              <tr key={si}>
                <td style={{...S.td, fontWeight:'600', whiteSpace:'nowrap', textAlign:'left', background:'rgba(15,20,35,0.5)', color:'#94A3B8'}}>{shift.label}</td>
                {DAY_ORDER.map(day => {
                  const val = avgInflowData[day]?.[si] ?? 0;
                  const bg = heatColor(val, minV, maxV, true);
                  return <td key={day} style={{...S.td, background:bg, fontWeight:'600'}}>{val.toFixed(1)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgentTable({ shiftMaxData, shifts, ahtHours, conc, leaveRate, breakRate, title, themeColor, tableId, currentAgents, onCurrentChange }) {
  const nightBreakRate = 0.10;
  const grid = [];
  let maxTotal = 0;
  for (let si = 0; si < shifts.length; si++) {
    const isNight = si >= 2;
    const effBreak = isNight ? nightBreakRate : breakRate;
    grid[si] = [];
    for (let di = 0; di < DAY_ORDER.length; di++) {
      const day = DAY_ORDER[di];
      const v = shiftMaxData[day]?.[si] ?? 0;
      const rawBase = (v * ahtHours) / conc;
      const leave = Math.ceil(rawBase * leaveRate);
      const brk = Math.ceil(rawBase * effBreak);
      const total = Math.ceil(rawBase + leave + brk);
      grid[si][di] = { total, v };
      if (total > maxTotal) maxTotal = total;
    }
  }

  const totalNeeded = shifts.map((_, si) => {
    let sum = 0;
    for (let di = 0; di < DAY_ORDER.length; di++) sum += grid[si][di].total;
    return Math.ceil(sum / 5);
  });

  const rgbMap = { '#0d6e6e':'13,110,110', '#dc2626':'220,38,38', '#ea580c':'234,88,12', '#06B6D4':'6,182,212', '#EF4444':'239,68,68', '#F97316':'249,115,22' };
  const rgb = rgbMap[themeColor] || '6,182,212';

  return (
    <div>
      <div style={S.sectionTitle(themeColor)}>{title}</div>
      <div style={S.tableWrap}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead><tr>
            <th style={{...S.th(themeColor), textAlign:'left'}}>Shift</th>
            {DAY_ORDER.map(d => <th key={d} style={S.th(themeColor)}>{d.slice(0,3)}</th>)}
            <th style={S.th(themeColor)}>Total Needed</th>
            <th style={S.th(themeColor)}>Current</th>
            <th style={S.th(themeColor)}>Gap</th>
          </tr></thead>
          <tbody>
            {shifts.map((shift, si) => {
              const cur = currentAgents?.[tableId]?.[si] || 0;
              const gap = cur - totalNeeded[si];
              return (
                <tr key={si}>
                  <td style={{...S.td, fontWeight:'600', whiteSpace:'nowrap', textAlign:'left', background:'rgba(15,20,35,0.5)', color:'#94A3B8'}}>{shift.label}</td>
                  {DAY_ORDER.map((_, di) => {
                    const { total } = grid[si][di];
                    const ratio = maxTotal > 0 ? total / maxTotal : 0;
                    const alpha = 0.05 + ratio * 0.35;
                    return <td key={di} style={{...S.td, background:`rgba(${rgb}, ${alpha})`, fontWeight:'700'}}>{total}</td>;
                  })}
                  <td style={{...S.td, fontWeight:'700', background:'rgba(15,20,35,0.5)'}}>{totalNeeded[si]}</td>
                  <td style={{...S.td, background:'rgba(15,20,35,0.5)'}}>
                    <input
                      type="number" min="0" step="1" value={cur}
                      onChange={(e) => onCurrentChange(tableId, si, parseInt(e.target.value)||0)}
                      style={{ ...S.input, width:'55px', textAlign:'center', padding:'4px 6px', fontSize:'0.8rem', fontWeight:'600' }}
                    />
                  </td>
                  <td style={{...S.td, fontWeight:'700', background:'rgba(15,20,35,0.5)'}}>
                    {cur === 0 ? '' : gap >= 0
                      ? <span style={{ color:'#22C55E' }}>{'\u25B2'}{gap}</span>
                      : <span style={{ color:'#EF4444' }}>{'\u25BC'}{Math.abs(gap)}</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================
const SalesDashboard = () => {
  const n = nowGMT6();
  const twoMonthsAgo = new Date(n); twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2); twoMonthsAgo.setDate(1);

  const [fromDate, setFromDate] = useState(twoMonthsAgo.toISOString().slice(0,10));
  const [toDate, setToDate] = useState(n.toISOString().slice(0,10));
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [days, setDays] = useState(null);
  const [hourlyData, setHourlyData] = useState(null);
  const [expandedWeeks, setExpandedWeeks] = useState({});

  // Agent calculator state
  const [aht, setAht] = useState(35);
  const [conc, setConc] = useState(5);
  const [leaves, setLeaves] = useState(32);
  const [workDays, setWorkDays] = useState(264);
  const [breakTime, setBreakTime] = useState(1.5);
  const [workHrs, setWorkHrs] = useState(9);
  const [currentAgents, setCurrentAgents] = useState({});

  const resultsRef = useRef(null);

  const toggleWeek = (idx) => setExpandedWeeks(prev => ({...prev, [idx]: !prev[idx]}));

  const handleCurrentChange = (tableId, si, val) => {
    setCurrentAgents(prev => ({
      ...prev,
      [tableId]: { ...(prev[tableId] || {}), [si]: val }
    }));
  };

  const fetchData = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setLoading(true); setError(''); setDays(null); setHourlyData(null);

    try {
      const dateList = buildDateList(fromDate, toDate);
      const allDays = [];

      // Phase 1: daily counts
      for (let i = 0; i < dateList.length; i++) {
        setStatus(`Processing day ${i+1} of ${dateList.length} (${dateList[i]})...`);
        const res = await fetch(`${API_BASE}/chat-count?date=${dateList[i]}`);
        if (!res.ok) { const e = await res.json().catch(() => ({error:`HTTP ${res.status}`})); throw new Error(e.error); }
        const data = await res.json();
        allDays.push({ date: data.date, day: data.day, chat: data.chat, email: data.email, fin: data.fin, ticket: data.ticket, cfd: data.cfd||0, fut: data.fut||0 });
      }
      setDays(allDays);

      // Phase 2: hourly
      const accAll={}, accCfd={}, accFut={};
      for (const day of DAY_NAMES_H) {
        accAll[day] = Array.from({length:24}, () => ({sum:0,count:0}));
        accCfd[day] = Array.from({length:24}, () => ({sum:0,count:0}));
        accFut[day] = Array.from({length:24}, () => ({sum:0,count:0}));
      }

      const monthAccAll = {}, monthAccCfd = {}, monthAccFut = {};
      const months = [...new Set(dateList.map(d => d.slice(0,7)))].sort();
      for (const m of months) { monthAccAll[m]={}; monthAccCfd[m]={}; monthAccFut[m]={}; for (const day of DAY_NAMES_H) { monthAccAll[m][day]=Array.from({length:24},()=>({sum:0,count:0})); monthAccCfd[m][day]=Array.from({length:24},()=>({sum:0,count:0})); monthAccFut[m][day]=Array.from({length:24},()=>({sum:0,count:0})); } }

      const dailyHourly = {};
      for (let i = 0; i < dateList.length; i++) {
        setStatus(`Hourly data: day ${i+1} of ${dateList.length} (${dateList[i]})...`);
        const hRes = await fetch(`${API_BASE}/chat-hourly?date=${dateList[i]}`);
        if (!hRes.ok) { const e = await hRes.json().catch(() => ({error:`HTTP ${hRes.status}`})); throw new Error(e.error); }
        const hData = await hRes.json();
        const dayName = hData.day;
        dailyHourly[dateList[i]] = hData;
        const mk = dateList[i].slice(0,7);

        for (let h = 0; h < 24; h++) {
          accAll[dayName][h].sum += hData.hours[h]||0; accAll[dayName][h].count += 1;
          accCfd[dayName][h].sum += hData.cfd_hours[h]||0; accCfd[dayName][h].count += 1;
          accFut[dayName][h].sum += hData.fut_hours[h]||0; accFut[dayName][h].count += 1;
          monthAccAll[mk][dayName][h].sum += hData.hours[h]||0; monthAccAll[mk][dayName][h].count += 1;
          monthAccCfd[mk][dayName][h].sum += hData.cfd_hours[h]||0; monthAccCfd[mk][dayName][h].count += 1;
          monthAccFut[mk][dayName][h].sum += hData.fut_hours[h]||0; monthAccFut[mk][dayName][h].count += 1;
        }
      }

      const computeAvg = (acc) => { const avg={}; for (const day of DAY_NAMES_H) avg[day] = acc[day].map(({sum,count}) => count > 0 ? Math.round(sum/count) : 0); return avg; };
      const avgAll = computeAvg(accAll), avgCfd = computeAvg(accCfd), avgFut = computeAvg(accFut);

      const computeMonthlyShiftMax = (monthAcc) => { const result={}; for (const m of months) { result[m]={}; for (const day of DAY_NAMES_H) { const nextDay = NEXT_DAY_MAP[day]; result[m][day] = ALL_SHIFTS_DEF.map(shift => { let mx=0; for (const h of shift.hours) { const {sum,count}=monthAcc[m][day][h]; const a=count>0?sum/count:0; if(a>mx)mx=a; } for (const h of shift.nextDayHours) { const {sum,count}=monthAcc[m][nextDay][h]; const a=count>0?sum/count:0; if(a>mx)mx=a; } return mx; }); } } return result; };
      const monthShiftAll = computeMonthlyShiftMax(monthAccAll), monthShiftCfd = computeMonthlyShiftMax(monthAccCfd), monthShiftFut = computeMonthlyShiftMax(monthAccFut);

      const computeAvgInflow = (monthShift) => { const ai={}; for (const day of DAY_NAMES_H) { ai[day] = ALL_SHIFTS_DEF.map((_,si) => { let s=0,c=0; for (const m of months) { if (monthShift[m][day]) { const v=monthShift[m][day][si]; if(v>0){s+=v;c++;} } } return c>0?s/c:0; }); } return ai; };
      const avgInflowAll = computeAvgInflow(monthShiftAll), avgInflowCfd = computeAvgInflow(monthShiftCfd), avgInflowFut = computeAvgInflow(monthShiftFut);

      setHourlyData({ avgAll, avgCfd, avgFut, avgInflowAll, avgInflowCfd, avgInflowFut, months });
      setStatus(`Done — ${allDays.length} days loaded`);
    } catch (err) {
      setError(err.message);
      setStatus('Failed');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  const ahtHours = aht / 60;
  const leaveRate = workDays > 0 ? leaves / workDays : 0;
  const breakRate = workHrs > 0 ? breakTime / workHrs : 0;

  const weeks = days ? groupByWeek(days) : [];

  return (
    <div ref={resultsRef}>
      {/* Filters */}
      <div style={{ display:'flex', gap:'12px', alignItems:'center', marginBottom:'20px', flexWrap:'wrap' }}>
        <label style={{ display:'flex', flexDirection:'column', gap:'4px', fontSize:'0.8rem', color:'#94A3B8', fontWeight:'500' }}>
          From
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={S.input} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', gap:'4px', fontSize:'0.8rem', color:'#94A3B8', fontWeight:'500' }}>
          To
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={S.input} />
        </label>
        <div style={{ display:'flex', gap:'8px', alignItems:'flex-end', paddingTop:'18px' }}>
          <button onClick={fetchData} disabled={loading} style={{...S.btn, opacity: loading ? 0.6 : 1}}>
            {loading ? 'Loading...' : 'Get Chat Count'}
          </button>
          {days && (
            <button style={S.btnPdf} onClick={() => alert('PDF export — use browser Print (Ctrl+P)')}>
              Download PDF
            </button>
          )}
        </div>
        {loading && <div style={{ width:'20px', height:'20px', border:'3px solid rgba(255,255,255,0.1)', borderTopColor:'#06B6D4', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />}
        <span style={{ fontSize:'0.8rem', color:'#64748B' }}>{status}</span>
      </div>

      {error && (
        <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#EF4444', padding:'12px 16px', borderRadius:'10px', marginBottom:'16px', fontSize:'0.85rem' }}>
          {error}
        </div>
      )}

      {days && (
        <>
          <SummaryCards days={days} />

          {/* Weekly Breakdown */}
          {weeks.map((week, i) => (
            <WeekTable key={week.key} week={week} idx={i} expanded={!!expandedWeeks[i]} onToggle={toggleWeek} />
          ))}

          <div style={{ fontSize:'0.7rem', color:'#475569', textAlign:'right', margin:'12px 0' }}>
            Period: {fromDate} to {toDate} (GMT+6)
          </div>
        </>
      )}

      {hourlyData && (
        <>
          <HourlyHeatmap avgData={hourlyData.avgAll} title="Hourly Average — All Chats" themeColor="#06B6D4" />
          <AvgInflowTable avgInflowData={hourlyData.avgInflowAll} shifts={SHIFTS} title={`Average Inflow — All Chats (${hourlyData.months.length} months)`} themeColor="#06B6D4" />
          <HourlyHeatmap avgData={hourlyData.avgCfd} title="Hourly Average — CFD" themeColor="#EF4444" />
          <AvgInflowTable avgInflowData={hourlyData.avgInflowCfd} shifts={SHIFTS} title={`Average Inflow — CFD (${hourlyData.months.length} months)`} themeColor="#EF4444" />
          <HourlyHeatmap avgData={hourlyData.avgFut} title="Hourly Average — Futures" themeColor="#F97316" />
          <AvgInflowTable avgInflowData={hourlyData.avgInflowFut} shifts={SHIFTS} title={`Average Inflow — Futures (${hourlyData.months.length} months)`} themeColor="#F97316" />

          {/* Agent Requirement Calculator */}
          <div style={{...S.sectionTitle('#A855F7'), borderLeftColor:'#A855F7'}}>Agents Required Calculator</div>
          <div style={{...S.card, marginBottom:'16px'}}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'12px', fontSize:'0.85rem' }}>
              {[
                { label: 'AHT (minutes)', value: aht, set: setAht, step: 1 },
                { label: 'Concurrency (C)', value: conc, set: setConc, step: 1 },
                { label: 'Leaves / Year', value: leaves, set: setLeaves, step: 1 },
                { label: 'Working Days / Year', value: workDays, set: setWorkDays, step: 1 },
                { label: 'Break Time (hrs)', value: breakTime, set: setBreakTime, step: 0.5 },
                { label: 'Working Hours', value: workHrs, set: setWorkHrs, step: 0.5 },
              ].map(f => (
                <label key={f.label} style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                  <span style={{ fontWeight:'600', color:'#94A3B8', fontSize:'0.78rem' }}>{f.label}</span>
                  <input type="number" value={f.value} min={0} step={f.step} onChange={e => f.set(parseFloat(e.target.value)||0)} style={S.input} />
                </label>
              ))}
            </div>
            <div style={{ marginTop:'10px', fontSize:'0.75rem', color:'#64748B' }}>
              AHT: <strong style={{color:'#F8FAFC'}}>{ahtHours.toFixed(2)} hrs</strong> &nbsp;|&nbsp;
              Leave Rate: <strong style={{color:'#F8FAFC'}}>{(leaveRate*100).toFixed(2)}%</strong> &nbsp;|&nbsp;
              Day Break Rate: <strong style={{color:'#F8FAFC'}}>{(breakRate*100).toFixed(2)}%</strong> &nbsp;|&nbsp;
              Night Break Rate: <strong style={{color:'#F8FAFC'}}>10.00%</strong>
            </div>
          </div>

          <AgentTable shiftMaxData={hourlyData.avgInflowAll} shifts={SHIFTS} ahtHours={ahtHours} conc={conc} leaveRate={leaveRate} breakRate={breakRate} title="Required Headcount — All Chats" themeColor="#06B6D4" tableId="all" currentAgents={currentAgents} onCurrentChange={handleCurrentChange} />
          <AgentTable shiftMaxData={hourlyData.avgInflowCfd} shifts={SHIFTS} ahtHours={ahtHours} conc={conc} leaveRate={leaveRate} breakRate={breakRate} title="Required Headcount — CFD" themeColor="#EF4444" tableId="cfd" currentAgents={currentAgents} onCurrentChange={handleCurrentChange} />
          <AgentTable shiftMaxData={hourlyData.avgInflowFut} shifts={SHIFTS} ahtHours={ahtHours} conc={conc} leaveRate={leaveRate} breakRate={breakRate} title="Required Headcount — Futures" themeColor="#F97316" tableId="fut" currentAgents={currentAgents} onCurrentChange={handleCurrentChange} />
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default SalesDashboard;
