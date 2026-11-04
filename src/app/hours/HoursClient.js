"use client";
import { useState, useMemo, useCallback } from 'react';
import { getRankIndex } from '../constants';
import { updateEmployeeHours, deleteHoursWeek, deleteEmployeeHours } from '../actions';

const T = {
  card: { background: 'var(--bg-card)', borderColor: 'var(--border)' },
  sub:  { background: 'var(--bg-sub)',  borderColor: 'var(--border)' },
  t1: { color: 'var(--text-1)' }, t2: { color: 'var(--text-2)' },
  t3: { color: 'var(--text-3)' }, t4: { color: 'var(--text-4)' },
};

const WEEK_OPTIONS = [4, 8, 12, 999];

// Calendar quarters are indexed as year*4 + (0..3); a week belongs to the quarter its week-ending date falls in
const quarterIndex = (d) => d.getFullYear() * 4 + Math.floor(d.getMonth() / 3);
const QUARTER_MONTHS = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'];
const quarterLabel = (qi) => `Q${(qi % 4) + 1} ${Math.floor(qi / 4)} (${QUARTER_MONTHS[qi % 4]})`;

const DEFAULT_REQ = { type: 'weekly', hours: 2.5 };

function makeGetReq(hourReqs) {
  return (rank) => hourReqs?.[rank] || DEFAULT_REQ;
}

function monthKey(weekEnding) {
  const m = weekEnding?.match(/^\d{1,2}\/([A-Za-z]{3}\/\d{4})$/);
  return m ? m[1] : null;
}

const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseDate(s) {
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (m1) {
    const mon = MON[m1[2][0].toUpperCase() + m1[2].slice(1).toLowerCase()];
    return mon === undefined ? null : new Date(+m1[3], mon, +m1[1]);
  }
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return new Date(+m2[3], +m2[1]-1, +m2[2]);
  return null;
}

// Returns LOA overlap info for an employee during the 7-day window ending on weekEnding
function loaDuringWeek(emp, weekEnding) {
  if (!emp.loaStart) return null;
  const weekEnd   = parseDate(weekEnding);
  if (!weekEnd) return null;
  const weekStart = new Date(weekEnd.getTime() - 6 * 86400000);
  const loaStart  = parseDate(emp.loaStart);
  if (!loaStart) return null;
  const loaEnd = emp.loaEnd ? parseDate(emp.loaEnd) : null;
  const overlaps = loaStart <= weekEnd && (!loaEnd || loaEnd >= weekStart);
  if (!overlaps) return null;
  return { start: emp.loaStart, end: emp.loaEnd || null };
}

// True only when today falls within the employee's LOA dates (open-ended if no valid end)
function loaActiveToday(emp) {
  if (!emp.isOnLoa) return false;
  const start = parseDate(emp.loaStart);
  if (!start) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = parseDate(emp.loaEnd);
  return start <= today && (!end || end >= today);
}

function sortEmployees(arr) {
  return [...arr].sort((a, b) => {
    const aC = a.rank === 'Consultant' ? 1 : 0;
    const bC = b.rank === 'Consultant' ? 1 : 0;
    if (aC !== bC) return aC - bC;
    const diff = getRankIndex(a.rank) - getRankIndex(b.rank);
    if (diff !== 0) return diff;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function buildWarningBBCode(warning, emp, req, week, userProfile, templates) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2,'0')}/${MONTHS[now.getMonth()]}/${now.getFullYear()}`;
  const minHours = req.type === 'monthly' ? `${req.hours}h/month` : `${req.hours}h/week`;
  const sigImg  = userProfile?.sig_image      || 'SIGNATURE_URL';
  const sigName = userProfile?.character_name || 'Your Name';
  const sigRank = userProfile?.rank           || 'Rank';

  const tplKey = warning === 1 ? 'hour_warning_1' : 'hour_warning_2';
  const tpl = templates?.[tplKey];

  if (tpl) {
    return tpl
      .replace(/\{\{employee_name\}\}/g, emp.name)
      .replace(/\{\{date\}\}/g,          dateStr)
      .replace(/\{\{min_hours\}\}/g,     minHours)
      .replace(/\{\{week\}\}/g,          week)
      .replace(/\{\{sig_image\}\}/g,     sigImg)
      .replace(/\{\{character_name\}\}/g, sigName)
      .replace(/\{\{rank\}\}/g,          sigRank);
  }

  // Fallback to hardcoded template
  const warningBody = warning === 1
    ? `Consider this email the [b]first[/b] warning. You will receive one more warning should you fall behind in hours. Should you require a third warning, it would lead directly to a discharge with or without notice.`
    : `Consider this email a [b]second[/b] warning. In the event of you not meeting the minimum hours again without an LOA in place, you may face a discharge from the LSEMS. Please do reach out if you have any concerns.`;

  return `[img]https://i.imgur.com/rLIJtNZ.png[/img][divbox=white][fpimg=25]https://i.imgur.com/4MaDTqz.png[/fpimg][aligntable=right,0,0,0,0,0,0][right][font=Arial][b]
[size=150]Los Santos Emergency Medical Services[/size][/b]
[size=115]Hour Minimum - ${warning === 1 ? 'First' : 'Second'} Warning[/size]
[size=95]${dateStr}[/size][/font][/right][/aligntable]
[hr]

Hello ${emp.name},

You're receiving this email because we have noticed that you did not meet the minimum amount of ${minHours} last pay period.

As you were made aware during your interview, on-boarding and contract signing, we require each employee to meet the minimum amount of hours weekly to ensure we're providing the best possible service to the community.

We understand that there are situations that come up that require you to take time away from work, and we've set up our LOA system for you to use should that happen. Please make sure you're taking the time you need and plan it in advance to prevent future warnings.

${warningBody}
[hr][/hr]
Kind regards,

[img]${sigImg}[/img]
[I]${sigName}[/i]
[b]${sigRank}[/b]
[b]Los Santos Emergency Medical Services[/b]
[/divbox]
[LSEMSfooter][/LSEMSfooter]`;
}

export default function HoursClient({ employees, weeks, hoursMap: initialMap, hourReqs, userProfile, bbcodeTemplates, perms = {} }) {
  const can = (key) => perms[key] !== false;
  const getReq = useMemo(() => makeGetReq(hourReqs), [hourReqs]);
  const [tab,        setTab]        = useState('grid');
  const [search,     setSearch]     = useState('');
  const [weekLimit,  setWeekLimit]  = useState(12);
  const currentQuarter = useMemo(() => quarterIndex(new Date()), []);
  const [quarter,    setQuarter]    = useState(currentQuarter);
  const [localHours, setLocalHours] = useState({});
  const [editCell,   setEditCell]   = useState(null);
  const [editValue,  setEditValue]  = useState('');
  const [saveStatus, setSaveStatus] = useState({});
  const [copiedKey,  setCopiedKey]  = useState(null);

  const sorted       = useMemo(() => sortEmployees(employees), [employees]);
  const earliestQuarter = useMemo(() => {
    const qs = weeks.map(parseDate).filter(Boolean).map(quarterIndex);
    return qs.length ? Math.min(...qs) : currentQuarter;
  }, [weeks, currentQuarter]);
  const visibleWeeks = useMemo(() => {
    if (weekLimit === 'quarter') return weeks.filter(w => { const d = parseDate(w); return d && quarterIndex(d) === quarter; });
    return weeks.slice(0, weekLimit === 999 ? weeks.length : weekLimit);
  }, [weeks, weekLimit, quarter]);

  const getHours = useCallback((name, week) => {
    const key = `${name}::${week}`;
    if (key in localHours) return localHours[key] ?? 0; // null = deleted, show 0
    return initialMap[name]?.[week] ?? 0;
  }, [localHours, initialMap]);

  const filtered = useMemo(() => {
    let rows = sorted;
    if (search) rows = rows.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));
    return rows;
  }, [sorted, search, visibleWeeks, getHours]);

  const empTotals = useMemo(() => {
    const out = {};
    for (const e of filtered)
      out[e.name] = visibleWeeks.reduce((s, w) => s + getHours(e.name, w), 0);
    return out;
  }, [filtered, visibleWeeks, getHours]);

  const weekTotals = useMemo(() =>
    visibleWeeks.map(w => filtered.reduce((s, e) => s + getHours(e.name, w), 0)),
    [filtered, visibleWeeks, getHours]
  );

  const grandTotal = weekTotals.reduce((s, h) => s + h, 0);

  // Monthly totals for visible rows (grid tab)
  const monthlyTotals = useMemo(() => {
    const out = {};
    for (const e of filtered) {
      if (e.rank !== 'EMT-P') continue;
      out[e.name] = {};
      for (const w of visibleWeeks) {
        const mk = monthKey(w);
        if (!mk) continue;
        out[e.name][mk] = (out[e.name][mk] || 0) + getHours(e.name, w);
      }
    }
    return out;
  }, [filtered, visibleWeeks, getHours]);

  // Monthly totals over ALL weeks (for compliance tab)
  const allMonthlyTotals = useMemo(() => {
    const out = {};
    for (const e of sorted) {
      if (e.rank !== 'EMT-P') continue;
      out[e.name] = {};
      for (const w of weeks) {
        const mk = monthKey(w);
        if (!mk) continue;
        out[e.name][mk] = (out[e.name][mk] || 0) + getHours(e.name, w);
      }
    }
    return out;
  }, [sorted, weeks, getHours]);

  // Returns non-compliant employees for a given week
  const getNonCompliant = useCallback((week) => {
    return sorted.filter(emp => emp.rank !== 'EMT-P' && emp.rank !== 'Consultant').map(emp => {
      const req = getReq(emp.rank);
      let logged, reqLabel;
      if (req.type === 'monthly') {
        const mk = monthKey(week);
        logged = mk ? (allMonthlyTotals[emp.name]?.[mk] ?? 0) : 0;
        reqLabel = `${req.hours}h/mo`;
      } else {
        logged = getHours(emp.name, week);
        reqLabel = `${req.hours}h/wk`;
      }
      const met = logged >= req.hours;
      return { emp, logged, required: req.hours, reqLabel, met };
    }).filter(({ met }) => !met);
  }, [sorted, allMonthlyTotals, getHours]);

  const hasEntry = useCallback((name, week) => {
    const key = `${name}::${week}`;
    if (key in localHours) return localHours[key] !== null; // null = deleted
    return initialMap[name]?.[week] !== undefined;
  }, [localHours, initialMap]);

  const startEdit = (name, week) => {
    setEditCell({ name, week });
    const hrs = getHours(name, week);
    // Show "0" if entry exists with value 0, blank if no entry yet
    setEditValue(hasEntry(name, week) || hrs > 0 ? String(hrs) : '');
  };

  const commitEdit = async (name, week) => {
    const key  = `${name}::${week}`;
    const raw  = editValue.trim();
    setEditCell(null);

    if (raw === '') {
      // Empty → delete entry (only if permitted)
      if (!hasEntry(name, week) || !can('delete_entry')) return;
      const prev = getHours(name, week);
      setLocalHours(h => ({ ...h, [key]: null })); // null = deleted
      setSaveStatus(s => ({ ...s, [key]: 'saving' }));
      try {
        const res = await deleteEmployeeHours(name, week);
        setSaveStatus(s => ({ ...s, [key]: res.ok ? 'ok' : 'err' }));
        if (!res.ok) setLocalHours(h => ({ ...h, [key]: prev }));
      } catch {
        setSaveStatus(s => ({ ...s, [key]: 'err' }));
        setLocalHours(h => ({ ...h, [key]: prev }));
      }
      setTimeout(() => setSaveStatus(s => { const n = { ...s }; delete n[key]; return n; }), 2000);
      return;
    }

    const val = parseFloat(raw);
    if (isNaN(val) || val < 0) return;
    const prev = getHours(name, week);
    if (hasEntry(name, week) && val === prev) return;
    setLocalHours(h => ({ ...h, [key]: val }));
    setSaveStatus(s => ({ ...s, [key]: 'saving' }));
    try {
      const res = await updateEmployeeHours(name, week, val);
      setSaveStatus(s => ({ ...s, [key]: res.ok ? 'ok' : 'err' }));
      if (!res.ok) setLocalHours(h => ({ ...h, [key]: prev }));
    } catch {
      setSaveStatus(s => ({ ...s, [key]: 'err' }));
      setLocalHours(h => ({ ...h, [key]: prev }));
    }
    setTimeout(() => setSaveStatus(s => { const n = { ...s }; delete n[key]; return n; }), 2000);
  };

  const handleKeyDown = (e, name, week) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit(name, week); }
    if (e.key === 'Escape') { setEditCell(null); }
  };

  function cellStyle(emp, week, hrs, isEdit, status, entryExists) {
    if (isEdit) return { bg: 'transparent', color: 'var(--text-1)' };
    if (status === 'saving') return { bg: 'var(--c-accent-bg)',  color: 'var(--c-accent)' };
    if (status === 'ok')     return { bg: 'rgba(52,211,153,0.20)',  color: 'var(--c-success)' };
    if (status === 'err')    return { bg: 'rgba(248,113,113,0.20)', color: 'var(--c-danger)' };
    if (loaDuringWeek(emp, week)) return {
      bg: 'repeating-linear-gradient(135deg, var(--c-warn-bg) 0 5px, var(--c-warn-glow) 5px 6px), var(--c-warn-bg)',
      color: 'var(--c-warning)',
      shadow: 'inset 0 0 0 1px var(--c-warn-glow)',
    };
    const req = getReq(emp.rank);
    if (req.type === 'monthly') {
      const mk    = monthKey(week);
      const total = mk ? (monthlyTotals[emp.name]?.[mk] ?? 0) : 0;
      if (total === 0 && !entryExists) return { bg: 'transparent', color: 'var(--text-4)' };
      if (total === 0)                 return { bg: 'rgba(248,113,113,0.14)', color: 'var(--c-danger)' };
      if (total >= req.hours) return { bg: 'rgba(52,211,153,0.14)', color: 'var(--c-success)' };
      return                         { bg: 'rgba(248,113,113,0.14)', color: 'var(--c-danger)' };
    }
    if (hrs === 0 && !entryExists) return { bg: 'transparent', color: 'var(--text-4)' };
    if (hrs < req.hours)           return { bg: 'rgba(248,113,113,0.14)', color: 'var(--c-danger)' };
    if (req.goal && hrs < req.goal) return { bg: 'rgba(251,191,36,0.14)', color: 'var(--c-warning)' };
    return                                 { bg: 'rgba(52,211,153,0.14)', color: 'var(--c-success)' };
  }

  const complianceWeeks = weeks.slice(0, 2);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-3">

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div>
          <h1 style={{fontSize:18,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>Employee Hours</h1>
          <p style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>
            {filtered.length} employees · <span className="stat-accent" style={{fontWeight:700,fontFamily:'monospace'}}>{grandTotal.toFixed(2)}</span> total hrs
            {tab === 'grid' && <span> · click any cell to edit</span>}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',gap:0}}>
        {[['grid','Hours Grid'], ...(can('compliance') ? [['compliance','Non-Compliance']] : [])].map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding:'8px 20px', border:'none', cursor:'pointer',
              fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em',
              background: tab===t ? 'var(--c-accent-bg)' : 'transparent',
              color:      tab===t ? 'var(--c-accent)'    : 'var(--text-3)',
              borderBottom: tab===t ? '2px solid var(--c-accent)' : '2px solid transparent',
              transition:'all 0.12s',
            }}>
            {l}
          </button>
        ))}
      </div>

      {/* ── TAB 1: Hours Grid ── */}
      {tab === 'grid' && (<>
        {/* Controls */}
        <div className="surface" style={{ padding:'10px 14px', display:'flex', flexWrap:'wrap', gap:10, alignItems:'center' }}>
          <input type="text" placeholder="Search…" className="lsems-input" style={{ width:144 }}
            value={search} onChange={e => setSearch(e.target.value)}
            onFocus={e => { e.currentTarget.style.borderColor='var(--c-accent)'; e.currentTarget.style.boxShadow='0 0 0 3px var(--c-accent-glow)'; }}
            onBlur={e  => { e.currentTarget.style.borderColor='var(--border)';   e.currentTarget.style.boxShadow='none'; }} />
          <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
            <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)' }}>Weeks:</span>
            {WEEK_OPTIONS.map(n => (
              <button key={n} onClick={() => setWeekLimit(n)}
                style={{
                  padding:'2px 8px', borderRadius:6, border:'1px solid',
                  fontSize:10, fontWeight:700, cursor:'pointer', transition:'all 0.12s',
                  background:  weekLimit===n ? 'var(--c-accent-bg)' : 'var(--bg-sub)',
                  borderColor: weekLimit===n ? 'var(--c-accent)'    : 'var(--border)',
                  color:       weekLimit===n ? 'var(--c-accent)'    : 'var(--text-3)',
                }}>
                {n === 999 ? 'All' : n}
              </button>
            ))}
            <button onClick={() => { setWeekLimit('quarter'); if (weekLimit !== 'quarter') setQuarter(currentQuarter); }}
              style={{
                padding:'2px 8px', borderRadius:6, border:'1px solid',
                fontSize:10, fontWeight:700, cursor:'pointer', transition:'all 0.12s',
                background:  weekLimit==='quarter' ? 'var(--c-accent-bg)' : 'var(--bg-sub)',
                borderColor: weekLimit==='quarter' ? 'var(--c-accent)'    : 'var(--border)',
                color:       weekLimit==='quarter' ? 'var(--c-accent)'    : 'var(--text-3)',
              }}>
              Quarterly
            </button>
          </div>
          {weekLimit === 'quarter' && (
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              {[['‹', -1, quarter <= earliestQuarter, 'Previous quarter'], null, ['›', 1, quarter >= currentQuarter, 'Next quarter']].map((b, i) => b ? (
                <button key={i} onClick={() => setQuarter(q => q + b[1])} disabled={b[2]} title={b[3]}
                  style={{
                    padding:'0 7px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg-sub)',
                    fontSize:13, fontWeight:700, lineHeight:'18px',
                    color: b[2] ? 'var(--text-4)' : 'var(--text-2)', cursor: b[2] ? 'default' : 'pointer', opacity: b[2] ? 0.5 : 1,
                  }}>
                  {b[0]}
                </button>
              ) : (
                <span key={i} style={{ fontSize:11, fontWeight:700, color:'var(--c-accent)', minWidth:118, textAlign:'center' }}>
                  {quarterLabel(quarter)}
                  {visibleWeeks.length === 0 && <span style={{ fontWeight:400, color:'var(--text-3)' }}> · no weeks yet</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="surface" style={{ width:'100%', padding:'8px 14px', display:'flex', flexWrap:'wrap', gap:'6px 16px', alignItems:'center' }}>
          <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)' }}>Legend:</span>
          {[
            { label:'Met requirement',   bg:'rgba(52,211,153,0.14)',  color:'var(--c-success)', text:'5.00' },
            { label:'Below requirement', bg:'rgba(248,113,113,0.14)', color:'var(--c-danger)',  text:'1.00' },
            { label:'Met requirement, below goal', bg:'rgba(251,191,36,0.14)', color:'var(--c-warning)', text:'6.00' },
            { label:'On LOA (excused)',  bg:'repeating-linear-gradient(135deg, var(--c-warn-bg) 0 5px, var(--c-warn-glow) 5px 6px), var(--c-warn-bg)', color:'var(--c-warning)', shadow:'inset 0 0 0 1px var(--c-warn-glow)', text:'0.00' },
            { label:'No hours logged',   bg:'transparent', color:'var(--text-4)', shadow:'inset 0 0 0 1px var(--border)', text:'—' },
          ].map(item => (
            <span key={item.label} style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text-2)' }}>
              <span className="font-mono" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:38, height:18, borderRadius:3, fontSize:10, background:item.bg, color:item.color, boxShadow:item.shadow }}>
                {item.text}
              </span>
              {item.label}
            </span>
          ))}
          <span style={{ fontSize:10, color:'var(--text-3)', fontStyle:'italic', marginLeft:'auto' }}>
            Monthly ranks (EMT-P) are colored by their total for the month.
          </span>
        </div>

        {/* Grid */}
        <div className="surface" style={{ overflow:'hidden' }}>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="border-collapse text-left w-full" style={{ minWidth:`${200 + visibleWeeks.length * 72}px` }}>
              <thead className="sticky top-0 z-20" style={{ background:'var(--bg-sub)' }}>
                <tr className="border-b" style={{ borderColor:'var(--border)' }}>
                  <th className="sticky left-0 z-30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap border-r"
                    style={{ background:'var(--bg-sub)', borderColor:'var(--border)', color:'var(--text-3)', minWidth:200 }}>
                    Employee
                  </th>
                  {visibleWeeks.map(w => (
                    <th key={w} className="px-1.5 py-1.5 text-[9px] font-semibold text-center whitespace-nowrap border-r"
                      style={{ borderColor:'var(--border)', color:'var(--text-3)', minWidth:70 }}>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                        <span>{w}</span>
                        {can('delete_week') && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Delete ALL hours for week ${w}? This cannot be undone.`)) return;
                              await deleteHoursWeek(w);
                              window.location.reload();
                            }}
                            style={{ fontSize:8, color:'var(--text-4)', background:'none', border:'none', cursor:'pointer', lineHeight:1, padding:'1px 3px', borderRadius:3, transition:'color 0.12s' }}
                            onMouseEnter={e => e.currentTarget.style.color='var(--c-danger)'}
                            onMouseLeave={e => e.currentTarget.style.color='var(--text-4)'}
                            title={`Delete week ${w}`}>
                            ✕
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 px-2 py-1.5 text-[10px] font-semibold text-right whitespace-nowrap border-l"
                    style={{ background:'var(--bg-sub)', borderColor:'var(--border)', color:'var(--text-3)', minWidth:64 }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={visibleWeeks.length + 2} className="px-4 py-8 text-center text-sm italic" style={T.t3}>No employees found.</td></tr>
                )}
                {filtered.map((emp, ri) => {
                  const rowTotal = empTotals[emp.name] ?? 0;
                  const isEven   = ri % 2 === 0;
                  const rowBg    = isEven ? 'rgba(255,255,255,0.018)' : 'transparent';
                  const req      = getReq(emp.rank);
                  return (
                    <tr key={emp.name} className="border-b"
                      style={{ borderColor:'rgba(255,255,255,0.04)', background:rowBg }}>
                      <td className="sticky left-0 z-10 px-3 py-1 border-r whitespace-nowrap"
                        style={{ borderColor:'var(--border)', background: isEven ? 'color-mix(in srgb, var(--bg-sub) 96%, transparent)' : 'var(--bg-sub)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span className="text-[11px] font-semibold" style={T.t1}>{emp.name}</span>
                          <span className="text-[10px]" style={T.t3}>{emp.rank}</span>
                          {loaActiveToday(emp) && (
                            <span className="pill pill-warning" style={{ fontSize:8, padding:'0 6px', lineHeight:'14px' }}
                              title={`On LOA ${emp.loaStart || ''}${emp.loaEnd ? ` – ${emp.loaEnd}` : ' – ongoing'}`}>
                              LOA
                            </span>
                          )}
                        </div>
                      </td>
                      {visibleWeeks.map(w => {
                        const hrs    = getHours(emp.name, w);
                        const key    = `${emp.name}::${w}`;
                        const isEdit = can('edit') && editCell?.name === emp.name && editCell?.week === w;
                        const status = saveStatus[key];
                        const { bg, color, shadow } = cellStyle(emp, w, hrs, isEdit, status, hasEntry(emp.name, w));
                        const loa    = loaDuringWeek(emp, w);
                        const loaTip = loa ? `On LOA ${loa.start}${loa.end ? ` – ${loa.end}` : ' – ongoing'}` : '';
                        const editTip = can('edit') ? `Click to edit${req.type==='monthly' ? ` — monthly req: ${req.hours}h` : ` — weekly req: ${req.hours}h`}` : '';
                        return (
                          <td key={w} className="border-r p-0"
                            style={{ borderColor:'rgba(255,255,255,0.04)', background:bg, boxShadow:shadow, minWidth:70 }}>
                            {isEdit ? (
                              <input autoFocus type="number" min="0" step="0.25"
                                className="w-full px-1.5 py-1 text-center text-[11px] font-mono outline-none"
                                style={{ background:'var(--c-accent-bg)', color:'var(--text-1)', border:'none' }}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(emp.name, w)}
                                onKeyDown={e => handleKeyDown(e, emp.name, w)}
                              />
                            ) : (
                              <div className={`w-full px-1.5 py-1 text-center text-[11px] font-mono${can('edit') ? ' cursor-pointer' : ''}`}
                                style={{ color }}
                                onClick={() => can('edit') && startEdit(emp.name, w)}
                                title={[loaTip, editTip].filter(Boolean).join(' · ') || undefined}
                                onMouseEnter={e => can('edit') && (e.currentTarget.style.opacity = '0.7')}
                                onMouseLeave={e => can('edit') && (e.currentTarget.style.opacity = '1')}>
                                {status === 'saving' ? '…' : hrs > 0 ? hrs.toFixed(2) : hasEntry(emp.name, w) ? <span style={{ color:'var(--text-3)' }}>0.00</span> : <span style={{ opacity:0.15 }}>—</span>}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="sticky right-0 z-10 px-2 py-1 text-right text-[11px] font-bold font-mono border-l"
                        style={{ borderColor:'var(--border)', background: isEven ? 'color-mix(in srgb, var(--bg-sub) 96%, transparent)' : 'var(--bg-sub)', color: rowTotal > 0 ? 'var(--c-accent)' : 'var(--text-4)' }}>
                        {rowTotal > 0 ? rowTotal.toFixed(2) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20" style={{ background:'var(--bg-sub)' }}>
                <tr className="border-t" style={{ borderColor:'var(--border-hi)' }}>
                  <td className="sticky left-0 z-30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-r"
                    style={{ background:'var(--bg-sub)', borderColor:'var(--border)', color:'var(--text-3)' }}>
                    Week Total
                  </td>
                  {weekTotals.map((total, i) => (
                    <td key={i} className="px-1.5 py-1.5 text-center text-[10px] font-bold font-mono border-r"
                      style={{ borderColor:'rgba(255,255,255,0.06)', color: total>0 ? 'var(--text-2)' : 'var(--text-4)' }}>
                      {total > 0 ? total.toFixed(2) : '—'}
                    </td>
                  ))}
                  <td className="sticky right-0 z-30 px-2 py-1.5 text-right text-[11px] font-bold font-mono border-l"
                    style={{ background:'var(--bg-sub)', borderColor:'var(--border)', color:'var(--c-accent)' }}>
                    {grandTotal.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </>)}

      {/* ── TAB 2: Non-Compliance ── */}
      {tab === 'compliance' && (
        <div className="space-y-4">
          {complianceWeeks.length === 0 ? (
            <div className="surface p-10 text-center italic" style={{ color:'var(--text-3)' }}>No week data available.</div>
          ) : complianceWeeks.map((week, wi) => {
            const list = getNonCompliant(week);
            const loaCount    = list.filter(({ emp }) => !!loaDuringWeek(emp, week)).length;
            const activeCount = list.length - loaCount;
            return (
              <div key={week} className="surface overflow-hidden">
                {/* Card header */}
                <div style={{
                  padding:'10px 18px',
                  background:'rgba(0,0,0,0.25)',
                  borderBottom:'1px solid var(--border)',
                  display:'flex', alignItems:'center', gap:12, flexWrap:'wrap',
                }}>
                  <div>
                    <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.10em', color:'var(--text-3)' }}>
                      {wi === 0 ? 'Most Recent Week' : 'Previous Week'}
                    </span>
                    <span style={{ marginLeft:8, fontSize:12, fontFamily:'monospace', color:'var(--text-2)' }}>{week}</span>
                  </div>
                  <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
                    {list.length === 0 ? (
                      <span className="pill pill-success">All compliant</span>
                    ) : (<>
                      <span className="pill pill-danger">{list.length} non-compliant</span>
                      {loaCount > 0 && <span className="pill pill-warning">{loaCount} on LOA</span>}
                      {activeCount > 0 && <span className="pill pill-muted">{activeCount} active</span>}
                    </>)}
                  </div>
                </div>

                {list.length === 0 ? (
                  <div style={{ padding:'32px', textAlign:'center', color:'var(--text-3)', fontStyle:'italic', fontSize:13 }}>
                    Everyone met their requirements this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto custom-scrollbar">
                    <table style={{ width:'100%', borderCollapse:'collapse' }}>
                      <thead>
                        <tr style={{ background:'var(--bg-sub)', borderBottom:'1px solid var(--border)' }}>
                          {['Name','Rank','Required','Logged','Status','Warnings'].map((h, i) => (
                            <th key={h} style={{
                              padding:'8px 16px', fontSize:10, fontWeight:700,
                              textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--text-3)',
                              textAlign: i >= 2 && i <= 3 ? 'right' : 'left',
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map(({ emp, logged, required, reqLabel }, i) => {
                          const loa = loaDuringWeek(emp, week);
                          return (
                          <tr key={emp.name} style={{
                            borderBottom:'1px solid var(--border)',
                            background: loa
                              ? 'rgba(251,191,36,0.04)'
                              : i % 2 === 0 ? 'var(--bg-stripe)' : 'transparent',
                          }}>
                            <td style={{ padding:'10px 16px', fontWeight:600, color:'var(--text-1)', fontSize:13 }}>
                              {emp.name}
                            </td>
                            <td style={{ padding:'10px 16px', color:'var(--text-2)', fontSize:13 }}>
                              {emp.rank}
                            </td>
                            <td style={{ padding:'10px 16px', textAlign:'right', fontFamily:'monospace', fontSize:13, color:'var(--text-3)' }}>
                              {reqLabel}
                            </td>
                            <td style={{ padding:'10px 16px', textAlign:'right', fontFamily:'monospace', fontWeight:700, fontSize:13,
                              color: logged === 0 ? 'var(--text-4)' : 'var(--c-danger)' }}>
                              {logged > 0 ? logged.toFixed(2) : '0.00'}
                            </td>
                            <td style={{ padding:'10px 16px' }}>
                              {loa ? (
                                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                                  <span className="pill pill-warning">On LOA</span>
                                  <span style={{ fontSize:10, color:'var(--c-warning)', fontFamily:'monospace' }}>
                                    {loa.start}{loa.end ? ` – ${loa.end}` : ' – ongoing'}
                                  </span>
                                </div>
                              ) : (
                                <span className="pill pill-danger">Active · No Hours</span>
                              )}
                            </td>
                            <td style={{ padding:'10px 16px' }}>
                              {can('warn_bbcode') && [1, 2].map(w => {
                                const key = `${emp.name}-w${w}-${week}`;
                                const copied = copiedKey === key;
                                return (
                                  <button key={w}
                                    onClick={async () => {
                                      const req = getReq(emp.rank);
                                      const text = buildWarningBBCode(w, emp, req, week, userProfile, bbcodeTemplates);
                                      await navigator.clipboard.writeText(text);
                                      setCopiedKey(key);
                                      setTimeout(() => setCopiedKey(null), 2500);
                                    }}
                                    style={{
                                      marginRight: w === 1 ? 4 : 0,
                                      padding:'3px 8px', borderRadius:5, border:'1px solid', cursor:'pointer',
                                      fontSize:9, fontWeight:700, textTransform:'uppercase', transition:'all 0.12s',
                                      background: copied ? 'rgba(52,211,153,0.18)' : 'transparent',
                                      color:       copied ? 'var(--c-success)' : 'var(--text-3)',
                                      borderColor: copied ? 'rgba(52,211,153,0.5)' : 'var(--border)',
                                    }}>
                                    {copied ? '✓ Copied' : `W${w}`}
                                  </button>
                                );
                              })}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
