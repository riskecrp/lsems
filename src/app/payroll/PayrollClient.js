"use client";
import { useState, useMemo, useEffect } from 'react';
import { submitPayCSV, setTreasuryBalance, addTreasuryEntry, addEmployee, deleteTreasuryEntry } from '../actions';
import { fmtCurrency, getNextBonus, buildLastPaymentMap, daysEmployed, RANK_ORDER, getRankIndex } from '../constants';

const JP_INDEX = RANK_ORDER.indexOf('Junior Paramedic');

// Pay amounts and the treasury ledger are no longer tracked. Flip to true to
// bring back the balance, pay columns, Treasury Log and entry/balance modals.
const SHOW_TREASURY = false;

const _MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseWeekDate(s) {
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (m1) return new Date(+m1[3], _MON[m1[2]] ?? 0, +m1[1]);
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return new Date(+m2[3], +m2[1]-1, +m2[2]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const T = {
  card:  { background: 'var(--bg-card)', borderColor: 'var(--border)' },
  sub:   { background: 'var(--bg-sub)',  borderColor: 'var(--border)' },
  input: { background: 'var(--bg-sub)',  borderColor: 'var(--border)', color: 'var(--text-1)' },
  t1: { color: 'var(--text-1)' }, t2: { color: 'var(--text-2)' }, t3: { color: 'var(--text-3)' },
};
const focusOn  = e => (e.currentTarget.style.borderColor = 'var(--c-accent)');
const focusOff = e => (e.currentTarget.style.borderColor = 'var(--border)');
const inputCls = 'w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors placeholder:opacity-40';
const labelCls = 'text-[10px] font-semibold uppercase tracking-wider mb-1.5 block';

function parseCSV(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headerIdx = lines.findIndex(l => l.toLowerCase().startsWith('name,'));
  if (headerIdx === -1) return [];
  const headers   = lines[headerIdx].split(',').map(h => h.trim().toLowerCase());
  const nameCol   = headers.indexOf('name');
  const hoursCol  = headers.findIndex(h => h.includes('duty hours') || h === 'on duty hours');
  const amountCol = headers.findIndex(h => h.includes('pay amount') || h === 'pay amount');
  if (nameCol === -1 || hoursCol === -1) return [];
  const result = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const csvName = (cols[nameCol] || '').trim();
    if (!csvName) continue;
    const hours  = parseFloat(cols[hoursCol]) || 0;
    const amount = amountCol !== -1 ? (parseFloat(cols[amountCol]) || 0) : 0;
    result.push({ csvName, resolvedName: csvName.replace(/_/g, ' '), hours, amount });
  }
  return result;
}

export default function PayrollClient({ transactions, currentBalance, employees, bonusPayments = [], bonusCycle = [], perms = {} }) {
  const can = (key) => perms[key] !== false;
  // localEmployees: employees added during this session (not yet page-reloaded)
  const [localEmployees,  setLocalEmployees]  = useState([]);

  // Merged roster for matching — includes newly-added employees immediately
  const allEmployees = useMemo(() => [...employees, ...localEmployees], [employees, localEmployees]);
  const empNames     = useMemo(() => new Map(allEmployees.map(e => [e.name.toLowerCase(), e.name])),  [allEmployees]);
  const empByName    = useMemo(() => new Map(allEmployees.map(e => [e.name.toLowerCase(), e])),        [allEmployees]);
  const authorizers  = useMemo(() => employees.filter(e => getRankIndex(e.rank) <= JP_INDEX).map(e => e.name).sort(), [employees]);

  const [csvText,        setCsvText]        = useState('');
  const [weekDate,       setWeekDate]       = useState('');
  const [parsed,         setParsed]         = useState(null);
  const [addForms,       setAddForms]       = useState({});  // { resolvedName: { hireDate, rank, loading, error, done } }
  const [includeBonuses, setIncludeBonuses] = useState(new Set());
  const [processing,     setProcessing]     = useState(false);
  const [error,          setError]          = useState('');
  const [result,         setResult]         = useState(null);
  const [showBalModal,   setShowBalModal]   = useState(false);
  const [balForm,        setBalForm]        = useState({ amount: '', notes: '' });
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [entryForm,      setEntryForm]      = useState({ type: '', amount: '', isCredit: false, notes: '' });

  const matched = useMemo(() => {
    if (!parsed) return [];
    return parsed.map(row => {
      const dbName = empNames.get(row.resolvedName.toLowerCase()) || null;
      return { ...row, dbName, matched: !!dbName };
    });
  }, [parsed, empNames]);

  // All matched (hours recorded regardless), worked = subset that has hours
  const allMatched   = useMemo(() => matched.filter(r => r.matched),                   [matched]);
  const worked       = useMemo(() => matched.filter(r => r.matched && r.hours > 0),    [matched]);
  const unmatched    = useMemo(() => matched.filter(r => !r.matched && r.hours > 0),   [matched]);
  const totalPay     = useMemo(() => worked.reduce((s, r) => s + r.amount, 0),          [worked]);
  const totalHrs     = useMemo(() => worked.reduce((s, r) => s + r.hours, 0),           [worked]);

  // Most recent payment per employee — tells getNextBonus whether the
  // currently-due milestone is already settled (dates compared as dates).
  const lastPaymentByEmployee = useMemo(() => buildLastPaymentMap(bonusPayments), [bonusPayments]);

  // Flag employees whose due date falls within ±7 days of the payroll week ending date
  const dueBonuses = useMemo(() => {
    const weekDateParsed = parseWeekDate(weekDate);
    if (!weekDateParsed) return [];
    return allMatched.map(r => {
      const emp = empByName.get(r.dbName.toLowerCase());
      if (!emp?.hireDate) return null;
      const bonus = getNextBonus(emp.hireDate, lastPaymentByEmployee[r.dbName] || null, bonusCycle,
        emp.bonusAnchor ? { date: emp.bonusAnchor, step: emp.bonusStep } : null);
      if (!bonus) return null;
      const diffDays = Math.abs((bonus.nextDate - weekDateParsed) / 86400000);
      if (diffDays > 7) return null;
      return { name: r.dbName, amount: bonus.nextAmount, months: bonus.monthsTenure };
    }).filter(Boolean);
  }, [allMatched, empByName, lastPaymentByEmployee, bonusCycle, weekDate]);

  const bonusByName = useMemo(() => {
    const m = {};
    for (const b of dueBonuses) m[b.name] = b;
    return m;
  }, [dueBonuses]);

  const totalBonus = useMemo(() =>
    dueBonuses.filter(b => includeBonuses.has(b.name)).reduce((s, b) => s + b.amount, 0),
    [dueBonuses, includeBonuses]
  );
  const newBal = currentBalance - totalPay - totalBonus;

  useEffect(() => {
    if (dueBonuses.length) setIncludeBonuses(new Set(dueBonuses.map(b => b.name)));
  }, [dueBonuses.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBonus    = (name) => setIncludeBonuses(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleAllBonus = (checked) => setIncludeBonuses(checked ? new Set(dueBonuses.map(b => b.name)) : new Set());

  // Initialise add-forms whenever unmatched list changes
  useEffect(() => {
    setAddForms(prev => {
      const next = { ...prev };
      for (const row of unmatched) {
        if (!next[row.resolvedName]) {
          next[row.resolvedName] = { hireDate: '', rank: RANK_ORDER[RANK_ORDER.length - 1], authorizer: '', loading: false, error: '', done: false };
        }
      }
      return next;
    });
  }, [unmatched.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateAddForm = (name, patch) =>
    setAddForms(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }));

  const handleAddToRoster = async (resolvedName) => {
    const form = addForms[resolvedName];
    if (!form?.hireDate?.trim())    { updateAddForm(resolvedName, { error: 'Hire date required.' });   return; }
    if (!form?.authorizer?.trim())  { updateAddForm(resolvedName, { error: 'Authorizer required.' });  return; }
    updateAddForm(resolvedName, { loading: true, error: '' });
    try {
      const res = await addEmployee({ name: resolvedName, rank: form.rank, hireDate: form.hireDate.trim(), authorizer: form.authorizer.trim() });
      if (!res.ok) { updateAddForm(resolvedName, { loading: false, error: res.error }); }
      else {
        setLocalEmployees(prev => [...prev, { name: resolvedName, rank: form.rank, hireDate: form.hireDate.trim() }]);
        updateAddForm(resolvedName, { loading: false, done: true });
      }
    } catch (e) { updateAddForm(resolvedName, { loading: false, error: e.message }); }
  };

  const handleParse = () => {
    setError(''); setResult(null);
    const rows = parseCSV(csvText);
    if (!rows.length) { setError('Could not parse CSV — paste the full export including the header row.'); return; }
    setParsed(rows);
    setIncludeBonuses(new Set());
  };

  const handleReset = () => { setParsed(null); setCsvText(''); setError(''); setResult(null); setIncludeBonuses(new Set()); setLocalEmployees([]); setAddForms({}); };

  const handleSubmit = async () => {
    if (!weekDate.trim())    { setError('Enter a week ending date.'); return; }
    if (!allMatched.length) { setError('No matched employees to submit.'); return; }
    setProcessing(true); setError('');
    try {
      const matchedNames = new Set(allMatched.map(r => r.dbName));
    const zeroEntries  = allEmployees.filter(e => !matchedNames.has(e.name)).map(e => ({ name: e.name, hours: 0, amount: 0 }));
    const entries      = [...allMatched.map(r => ({ name: r.dbName, hours: r.hours, amount: r.amount })), ...zeroEntries];
      const bonusEntries = dueBonuses.filter(b => includeBonuses.has(b.name)).map(b => ({ name: b.name, amount: b.amount, months: b.months }));
      const res = await submitPayCSV({ weekDate: weekDate.trim(), startingBalance: currentBalance, entries, bonusEntries });
      if (!res.ok) { setError(res.error); }
      else { setResult(res); setTimeout(() => window.location.reload(), 1400); }
    } catch (e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  const handleSetBalance = async () => {
    const amt = parseFloat(balForm.amount);
    if (isNaN(amt)) { setError('Invalid amount.'); return; }
    setProcessing(true);
    try {
      const res = await setTreasuryBalance({ amount: amt, notes: balForm.notes });
      if (!res.ok) setError(res.error);
      else { setShowBalModal(false); setBalForm({ amount: '', notes: '' }); window.location.reload(); }
    } catch (e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  const handleAddEntry = async () => {
    setProcessing(true); setError('');
    try {
      const res = await addTreasuryEntry(entryForm);
      if (!res.ok) { setError(res.error); }
      else { setShowEntryModal(false); setEntryForm({ type: '', amount: '', isCredit: false, notes: '' }); window.location.reload(); }
    } catch (e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">

      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div>
          <h1 style={{fontSize:18,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>{SHOW_TREASURY ? 'Payroll & Treasury' : 'Payroll'}</h1>
          <p style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>
            {allEmployees.length} active{SHOW_TREASURY && <> · balance <span className="stat-success" style={{fontWeight:700,fontFamily:'monospace'}}>{fmtCurrency(currentBalance)}</span></>}
          </p>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {SHOW_TREASURY && can('add_entry')  && <button onClick={() => setShowEntryModal(true)} className="btn-ghost">+ Add Entry</button>}
          {SHOW_TREASURY && can('set_balance') && <button onClick={() => setShowBalModal(true)} className="btn-ghost">Set Balance</button>}
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${SHOW_TREASURY ? 'xl:grid-cols-3' : ''}`}>
        <div className={`space-y-3 ${SHOW_TREASURY ? 'xl:col-span-2' : ''}`}>

          {!parsed ? (
            /* ── Step 1: Paste ── */
            <section className="border rounded-2xl p-4 glass space-y-4" style={T.card}>
              <div className="text-[10px] font-bold uppercase tracking-widest pb-2 border-b" style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}>
                Step 1 — Paste Hours Export
              </div>
              <div>
                <label className={labelCls} style={T.t3}>Hours CSV</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border text-[11px] font-mono outline-none transition-colors placeholder:opacity-40 resize-y custom-scrollbar"
                  style={{ ...T.input, minHeight: 200 }}
                  placeholder={"Name,Branch,Group,On Duty Hours (2026-10-25 to 2026-10-31 UTC)\nCarter_Bulfinch,Medical Services,Senior Paramedic,5.13\n..."}
                  value={csvText} onChange={e => setCsvText(e.target.value)}
                  onFocus={focusOn} onBlur={focusOff}
                />
              </div>
              <div>
                <label className={labelCls} style={T.t3}>Week Ending Date</label>
                <input className={inputCls} style={T.input} placeholder="e.g. 08/May/2026"
                  value={weekDate} onChange={e => setWeekDate(e.target.value)}
                  onFocus={focusOn} onBlur={focusOff} />
              </div>
              {error && <p className="text-sm px-3 py-2 rounded-lg border" style={{ background: 'var(--c-danger-bg)', borderColor: 'rgba(248,113,113,0.3)', color: 'var(--c-danger)' }}>{error}</p>}
              <button onClick={handleParse} disabled={!csvText.trim()}
                className="w-full py-2.5 rounded-xl text-[11px] font-bold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed border border-blue-500/40 transition-colors">
                Parse & Preview
              </button>
            </section>

          ) : (
            /* ── Step 2: Preview & confirm ── */
            <>
              {/* Summary bar */}
              <div className="border rounded-xl px-4 py-3 flex flex-wrap gap-5 items-center glass-sub" style={T.sub}>
                <Stat label="Recorded"    value={allMatched.length}       color="var(--c-accent)" />
                <Stat label="With Hours"  value={worked.length}           color="var(--text-1)" />
                <Stat label="Total Hours" value={totalHrs.toFixed(2)}     color="var(--text-1)" />
                {SHOW_TREASURY && <Stat label="Payroll"     value={fmtCurrency(totalPay)}   color="var(--c-danger)" />}
                {totalBonus > 0 && <Stat label="Bonuses" value={fmtCurrency(totalBonus)} color="var(--c-warning)" />}
                {SHOW_TREASURY && <Stat label="New Balance" value={fmtCurrency(newBal)}     color={newBal >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} />}
                {unmatched.length > 0 && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border ml-auto"
                    style={{ background: 'var(--c-warn-bg)', borderColor: 'rgba(251,191,36,0.3)', color: 'var(--c-warning)' }}>
                    {unmatched.length} not in roster
                  </span>
                )}
              </div>

              {/* Week date row */}
              <div className="border rounded-xl px-4 py-2.5 flex items-center gap-4 glass-sub" style={T.sub}>
                <label className="text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap" style={T.t3}>Week Ending</label>
                <input className="flex-1 px-3 py-1.5 rounded-lg border text-sm outline-none transition-colors"
                  style={T.input} placeholder="e.g. 08/May/2026"
                  value={weekDate} onChange={e => setWeekDate(e.target.value)}
                  onFocus={focusOn} onBlur={focusOff} />
                <button onClick={handleReset}
                  className="text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap transition-colors"
                  style={{ color: 'var(--text-4)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--c-accent)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-4)'}>
                  ← Paste again
                </button>
              </div>

              {/* Hours preview table */}
              <section className="border rounded-2xl overflow-hidden glass" style={T.card}>
                <div className="px-4 py-2.5 border-b text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}>
                  All Matched Employees — {allMatched.length} ({worked.length} with hours)
                </div>
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[420px]">
                    <thead className="border-b" style={{ background: 'var(--bg-sub)', borderColor: 'var(--border)' }}>
                      <tr className="text-[10px] uppercase tracking-wider font-semibold" style={T.t3}>
                        <th className="px-4 py-2.5">Name</th>
                        <th className="px-4 py-2.5 text-right">Hours</th>
                        {SHOW_TREASURY && <th className="px-4 py-2.5 text-right">Pay</th>}
                        <th className="px-4 py-2.5 text-center w-24">Status</th>
                        <th className="px-4 py-2.5 text-right">Retention Bonus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matched.filter(r => r.matched).length === 0 ? (
                        <tr><td colSpan={SHOW_TREASURY ? 5 : 4} className="px-4 py-8 text-center italic text-sm" style={T.t3}>No matched employees in CSV.</td></tr>
                      ) : matched.filter(r => r.matched).map((row, i) => {
                        const hasHours = row.hours > 0;
                        const isEven   = i % 2 === 0;
                        const bonus    = bonusByName[row.dbName];
                        const included = bonus && includeBonuses.has(bonus.name);
                        return (
                          <tr key={i} className="border-b"
                            style={{ borderColor: 'rgba(255,255,255,0.05)', background: isEven ? 'rgba(255,255,255,0.016)' : 'transparent' }}>
                            <td className="px-4 py-2.5 text-sm font-semibold" style={hasHours ? T.t1 : T.t3}>
                              {row.dbName}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-[12px]" style={hasHours ? T.t2 : T.t3}>
                              {row.hours.toFixed(2)}
                            </td>
                            {SHOW_TREASURY && (
                              <td className="px-4 py-2.5 text-right font-mono text-[12px] font-semibold"
                                style={{ color: hasHours ? 'var(--c-success)' : 'var(--text-4)' }}>
                                {hasHours ? fmtCurrency(row.amount) : '—'}
                              </td>
                            )}
                            <td className="px-4 py-2.5 text-center">
                              {hasHours
                                ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ color: 'var(--c-success)', background: 'var(--c-succ-bg)', borderColor: 'rgba(74,222,128,0.3)' }}>✓ Hours</span>
                                : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ color: 'var(--text-4)', background: 'var(--bg-sub)', borderColor: 'var(--border)' }}>0 hrs</span>
                              }
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {bonus ? (
                                <label className="flex items-center justify-end gap-2 cursor-pointer select-none">
                                  <span className="text-[11px] font-mono" style={{ color: included ? 'var(--c-warning)' : 'var(--text-3)' }}>
                                    {fmtCurrency(bonus.amount)}
                                  </span>
                                  <input type="checkbox" checked={included} onChange={() => toggleBonus(bonus.name)}
                                    className="w-3.5 h-3.5 flex-shrink-0" style={{ accentColor: 'var(--c-warning)' }} />
                                </label>
                              ) : (
                                <span style={{ color: 'var(--text-4)', fontSize: 11 }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ── Add unmatched to roster ── */}
              {unmatched.length > 0 && (
                <section className="border rounded-2xl overflow-hidden glass" style={{ ...T.card, borderColor: 'rgba(251,191,36,0.35)' }}>
                  <div className="px-4 py-2.5 border-b text-[10px] font-bold uppercase tracking-widest"
                    style={{ background: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.25)', color: 'var(--c-warning)' }}>
                    Not in Roster — Add to continue ({unmatched.length})
                  </div>
                  <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                    {unmatched.map(row => {
                      const form = addForms[row.resolvedName] || {};
                      if (form.done) {
                        return (
                          <div key={row.resolvedName} className="px-4 py-3 flex items-center gap-3"
                            style={{ background: 'rgba(74,222,128,0.05)' }}>
                            <span className="text-sm font-semibold" style={T.t1}>{row.resolvedName}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border ml-auto"
                              style={{ color: 'var(--c-success)', background: 'var(--c-succ-bg)', borderColor: 'rgba(74,222,128,0.3)' }}>
                              ✓ Added to roster
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={row.resolvedName} className="px-4 py-3 space-y-2.5">
                          <div className="text-sm font-semibold" style={{ color: 'var(--c-warning)' }}>{row.resolvedName}</div>
                          <div className="flex flex-wrap gap-2 items-end">
                            <div className="flex-1 min-w-[130px]">
                              <label className={labelCls} style={T.t3}>Hire Date</label>
                              <input className="w-full px-2.5 py-1.5 rounded-lg border text-sm outline-none transition-colors placeholder:opacity-40"
                                style={T.input} placeholder="DD/Mon/YYYY"
                                value={form.hireDate || ''}
                                onChange={e => updateAddForm(row.resolvedName, { hireDate: e.target.value })}
                                onFocus={focusOn} onBlur={focusOff} />
                            </div>
                            <div className="flex-1 min-w-[140px]">
                              <label className={labelCls} style={T.t3}>Rank</label>
                              <select className="w-full px-2.5 py-1.5 rounded-lg border text-sm outline-none transition-colors"
                                style={T.input}
                                value={form.rank || RANK_ORDER[RANK_ORDER.length - 1]}
                                onChange={e => updateAddForm(row.resolvedName, { rank: e.target.value })}>
                                {RANK_ORDER.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </div>
                            <div className="flex-1 min-w-[160px]">
                              <label className={labelCls} style={T.t3}>Authorized By</label>
                              <select className="w-full px-2.5 py-1.5 rounded-lg border text-sm outline-none transition-colors"
                                style={T.input}
                                value={form.authorizer || ''}
                                onChange={e => updateAddForm(row.resolvedName, { authorizer: e.target.value })}>
                                <option value="">— Select —</option>
                                {authorizers.map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                            </div>
                            <button
                              onClick={() => handleAddToRoster(row.resolvedName)}
                              disabled={form.loading}
                              className="px-4 py-1.5 rounded-lg text-[11px] font-bold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors disabled:opacity-50 whitespace-nowrap">
                              {form.loading ? 'Adding…' : 'Add to Roster'}
                            </button>
                          </div>
                          {form.error && <p className="text-[11px]" style={{ color: 'var(--c-danger)' }}>{form.error}</p>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}


              {error && <p className="text-sm px-3 py-2 rounded-lg border" style={{ background: 'var(--c-danger-bg)', borderColor: 'rgba(248,113,113,0.3)', color: 'var(--c-danger)' }}>{error}</p>}
              {result && (
                <div className="border rounded-xl px-4 py-3 text-sm space-y-0.5" style={{ background: 'var(--c-succ-bg)', borderColor: 'rgba(74,222,128,0.3)', color: 'var(--c-success)' }}>
                  <div className="font-bold uppercase tracking-wide">{SHOW_TREASURY ? 'Pay run submitted!' : 'Hours submitted!'}</div>
                  <div>
                    {result.updatedCount} employees recorded ({result.workedCount} with hours) · {result.totalHours?.toFixed(2)} hrs
                    {SHOW_TREASURY && ` · ${fmtCurrency(result.totalPay)} payroll`}
                    {result.totalBonus > 0 ? ` · ${fmtCurrency(result.totalBonus)} retention bonuses` : ''}
                    {SHOW_TREASURY && ` · balance ${fmtCurrency(result.finalBalance)}`}
                  </div>
                  {result.skippedBonuses?.length > 0 && (
                    <div style={{ color:'var(--c-warning)' }}>
                      Skipped {result.skippedBonuses.length} already-paid bonus{result.skippedBonuses.length > 1 ? 'es' : ''}: {result.skippedBonuses.join(' · ')}
                    </div>
                  )}
                </div>
              )}

              <button disabled={!can('submit') || processing || !allMatched.length || !!result} onClick={handleSubmit}
                className="w-full py-2.5 rounded-xl text-[11px] font-bold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed border border-blue-500/40 transition-colors"
                title={!can('submit') ? 'You do not have permission to submit payroll' : undefined}>
                {processing ? 'Submitting…' : result ? 'Submitted ✓' : !can('submit') ? 'View Only' : SHOW_TREASURY
                  ? `Submit Pay Run — ${allMatched.length} employees (${worked.length} with hours) · ${fmtCurrency(totalPay + totalBonus)}`
                  : `Submit Hours — ${allMatched.length} employees (${worked.length} with hours)${totalBonus > 0 ? ` · ${fmtCurrency(totalBonus)} retention bonuses` : ''}`}
              </button>
            </>
          )}
        </div>

        {/* Treasury log */}
        {SHOW_TREASURY && <div>
          <section className="border rounded-2xl p-4 glass" style={T.card}>
            <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-2 border-b" style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}>Treasury Log</div>
            <div className="overflow-y-auto custom-scrollbar space-y-2 pr-0.5" style={{ maxHeight: 600 }}>
              {transactions.length === 0 ? (
                <div className="text-sm text-center py-8 italic" style={T.t3}>No transactions yet.</div>
              ) : transactions.map((tx, i) => {
                const prevBal = transactions[i + 1]?.balance ?? tx.balance;
                const isDebit = tx.balance <= prevBal;
                return (
                  <div key={tx.id ?? i} className="border rounded-xl px-3 py-2.5 glass-sub" style={T.sub}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold" style={T.t1}>{tx.type}</div>
                        {tx.notes && <div className="text-[10px] mt-0.5 leading-tight" style={T.t3}>{tx.notes}</div>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-bold font-mono"
                          style={{ color: isDebit ? 'var(--c-danger)' : 'var(--c-success)' }}>
                          {isDebit ? '−' : '+'}{fmtCurrency(tx.amount)}
                        </div>
                        <div className="text-[10px] font-mono" style={T.t3}>{fmtCurrency(tx.balance)}</div>
                      </div>
                      {tx.id && can('delete_entry') && (
                        <button
                          onClick={async () => {
                            if (!confirm('Delete this treasury entry?')) return;
                            await deleteTreasuryEntry(tx.id);
                            window.location.reload();
                          }}
                          style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-4)', lineHeight:1, padding:'2px 3px', flexShrink:0, transition:'color 0.12s' }}
                          onMouseEnter={e => e.currentTarget.style.color='var(--c-danger)'}
                          onMouseLeave={e => e.currentTarget.style.color='var(--text-4)'}
                          title="Delete entry">✕</button>
                      )}
                    </div>
                    <div className="text-[9px] mt-1.5" style={T.t3}>{tx.timestamp}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>}
      </div>

      {/* Add Treasury Entry modal */}
      {showEntryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={() => setShowEntryModal(false)}>
          <div className="border rounded-2xl p-5 w-full max-w-sm glass-modal" style={T.card} onClick={e => e.stopPropagation()}>
            <div className="text-base font-semibold mb-4" style={T.t1}>Add Treasury Entry</div>
            <div className="space-y-3 mb-4">
              <div>
                <label className={labelCls} style={T.t3}>Type</label>
                <input className={inputCls} style={T.input} placeholder="e.g. Deposit, Fine, Event Payout…"
                  value={entryForm.type} onChange={e => setEntryForm(f => ({ ...f, type: e.target.value }))}
                  onFocus={focusOn} onBlur={focusOff} />
              </div>
              <div>
                <label className={labelCls} style={T.t3}>Amount</label>
                <input type="number" min="0" className={inputCls} style={T.input} placeholder="0"
                  value={entryForm.amount} onChange={e => setEntryForm(f => ({ ...f, amount: e.target.value }))}
                  onFocus={focusOn} onBlur={focusOff} />
              </div>
              <div>
                <label className={labelCls} style={T.t3}>Effect on Balance</label>
                <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  <button onClick={() => setEntryForm(f => ({ ...f, isCredit: true }))}
                    className="flex-1 py-2 text-[11px] font-bold uppercase tracking-wide transition-colors"
                    style={{ background: entryForm.isCredit ? 'rgba(74,222,128,0.18)' : 'var(--bg-sub)', color: entryForm.isCredit ? 'var(--c-success)' : 'var(--text-3)', borderRight: '1px solid var(--border)' }}>
                    + Credit (add)
                  </button>
                  <button onClick={() => setEntryForm(f => ({ ...f, isCredit: false }))}
                    className="flex-1 py-2 text-[11px] font-bold uppercase tracking-wide transition-colors"
                    style={{ background: !entryForm.isCredit ? 'rgba(248,113,113,0.16)' : 'var(--bg-sub)', color: !entryForm.isCredit ? 'var(--c-danger)' : 'var(--text-3)' }}>
                    − Debit (subtract)
                  </button>
                </div>
              </div>
              <div>
                <label className={labelCls} style={T.t3}>Notes (optional)</label>
                <input className={inputCls} style={T.input} placeholder="e.g. Government grant"
                  value={entryForm.notes} onChange={e => setEntryForm(f => ({ ...f, notes: e.target.value }))}
                  onFocus={focusOn} onBlur={focusOff} />
              </div>
              {/* Live preview */}
              {entryForm.amount > 0 && (
                <div className="border rounded-lg px-3 py-2 text-[11px] font-mono" style={{ borderColor: 'var(--border)', background: 'var(--bg-sub)', color: entryForm.isCredit ? 'var(--c-success)' : 'var(--c-danger)' }}>
                  {entryForm.isCredit ? '+' : '−'} ${Number(entryForm.amount).toLocaleString()} → new balance: ${(currentBalance + (entryForm.isCredit ? 1 : -1) * Number(entryForm.amount)).toLocaleString()}
                </div>
              )}
            </div>
            {error && <p className="text-[11px] mb-3 px-2 py-1.5 rounded-lg border" style={{ background: 'var(--c-danger-bg)', borderColor: 'rgba(248,113,113,0.3)', color: 'var(--c-danger)' }}>{error}</p>}
            <div className="flex gap-2.5">
              <button onClick={() => { setShowEntryModal(false); setError(''); }} className="flex-1 py-2 rounded-lg border text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'var(--bg-sub)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>Cancel</button>
              <button disabled={processing} onClick={handleAddEntry} className="flex-1 py-2 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors disabled:opacity-50">
                {processing ? 'Saving…' : 'Add Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Balance modal */}
      {showBalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={() => setShowBalModal(false)}>
          <div className="border rounded-2xl p-5 w-full max-w-sm glass-modal" style={T.card} onClick={e => e.stopPropagation()}>
            <div className="text-base font-semibold mb-4" style={T.t1}>Set Treasury Balance</div>
            <div className="space-y-3 mb-4">
              <div><label className={labelCls} style={T.t3}>Amount</label><input type="number" className={inputCls} style={T.input} placeholder="0" value={balForm.amount} onChange={e => setBalForm(f => ({ ...f, amount: e.target.value }))} onFocus={focusOn} onBlur={focusOff} /></div>
              <div><label className={labelCls} style={T.t3}>Notes (optional)</label><input className={inputCls} style={T.input} placeholder="e.g. Monthly reconciliation" value={balForm.notes} onChange={e => setBalForm(f => ({ ...f, notes: e.target.value }))} onFocus={focusOn} onBlur={focusOff} /></div>
            </div>
            <div className="flex gap-2.5">
              <button onClick={() => setShowBalModal(false)} className="flex-1 py-2 rounded-lg border text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'var(--bg-sub)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>Cancel</button>
              <button disabled={processing} onClick={handleSetBalance} className="flex-1 py-2 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors disabled:opacity-50">
                {processing ? 'Saving…' : 'Set Balance'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="text-sm font-bold font-mono" style={{ color }}>{value}</div>
    </div>
  );
}
