"use client";
import { useState, useMemo, useCallback, useEffect } from 'react';
import { markBonusPaid } from '../actions';
import { sortByRank, daysEmployed, getNextBonus, buildLastPaymentMap, toStoredDate, fmtDate, fmtCurrency, getRankIndex } from '../constants';

const _MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function parseDate(s) {
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (m1) return new Date(+m1[3], _MON[m1[2]], +m1[1]);
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return new Date(+m2[3], +m2[1]-1, +m2[2]);
  return null;
}
function loaDuringWeek(emp, weekEnding) {
  if (!emp.loaStart) return false;
  const weekEnd   = parseDate(weekEnding);
  if (!weekEnd) return false;
  const weekStart = new Date(weekEnd.getTime() - 6 * 86400000);
  const loaStart  = parseDate(emp.loaStart);
  if (!loaStart) return false;
  const loaEnd    = emp.loaEnd ? parseDate(emp.loaEnd) : null;
  return loaStart <= weekEnd && (!loaEnd || loaEnd >= weekStart);
}

const HIGH_COMMAND = new Set(['Chief', 'Assistant Chief', 'Deputy Chief']);
const COMMAND      = new Set(['Commander', 'Captain', 'Lieutenant']);
const SUPERVISORS  = new Set(['Lead Paramedic', 'Senior Paramedic', 'Paramedic', 'Junior Paramedic']);
function getReq(rank) {
  if (HIGH_COMMAND.has(rank)) return { type: 'weekly', hours: 5   };
  if (COMMAND.has(rank))      return { type: 'weekly', hours: 5   };
  if (SUPERVISORS.has(rank))  return { type: 'weekly', hours: 5   };
  if (rank === 'EMT-P')       return { type: 'monthly', hours: 1  };
  return                             { type: 'weekly', hours: 2.5 };
}

const BB_RANK_ORDER = [
  'Chief','Assistant Chief','Deputy Chief',
  'Commander','Captain','Lieutenant',
  'Lead Paramedic','Senior Paramedic','Paramedic','Junior Paramedic',
  'Master EMT','EMT-A','EMT-I','EMT-B','EMR',
  'EMT-P','Consultant',
];

function bbMoney(n) {
  const num = parseInt(n) || 0;
  return '$' + num.toLocaleString('en-US');
}

const fr = e => { e.currentTarget.style.borderColor='var(--c-accent)'; e.currentTarget.style.boxShadow='0 0 0 3px var(--c-accent-glow)'; };
const fb = e => { e.currentTarget.style.borderColor='var(--border)';   e.currentTarget.style.boxShadow='none'; };

export default function BonusesClient({ bonuses: initial, payments: initialPayments, divData, bbcodeTemplates, bonusCycle, perms = {} }) {
  const can = (key) => perms[key] !== false;
  const [tab,        setTab]        = useState(() => can('view_quarterly') ? 'quarterly' : can('view_retention') ? 'retention' : 'history');
  const [search,     setSearch]     = useState('');
  const [payments,   setPayments]   = useState(initialPayments);
  const [payModal,   setPayModal]   = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error,      setError]      = useState('');
  const [showAll,    setShowAll]    = useState(false);
  const [copied,     setCopied]     = useState(false);

  // Compliance recommendation state
  const [recs, setRecs] = useState({});
  // Bonus amounts keyed by rank — counts come from roster automatically
  const [bonusAmounts, setBonusAmounts] = useState({});

  const { employees: divEmps = [], weeks: divWeeks = [], hoursMap: divMap = {} } = divData || {};

  const periodKey    = useMemo(() => `lsems-qrec-${divWeeks.join('|')}`,       [divWeeks]);
  const amountsKey   = useMemo(() => `lsems-qamounts-${divWeeks[0] || 'all'}`, [divWeeks]);

  // Count employees per rank from the live roster
  const rankCounts = useMemo(() => {
    const counts = {};
    for (const emp of initial) counts[emp.rank] = (counts[emp.rank] || 0) + 1;
    return counts;
  }, [initial]);

  // Ranks present in the roster, in BB display order
  const activeRanks = useMemo(
    () => BB_RANK_ORDER.filter(r => rankCounts[r] > 0),
    [rankCounts]
  );

  useEffect(() => {
    try {
      const savedRecs    = localStorage.getItem(periodKey);
      const savedAmounts = localStorage.getItem(amountsKey);
      if (savedRecs)    setRecs(JSON.parse(savedRecs));
      if (savedAmounts) setBonusAmounts(JSON.parse(savedAmounts));
    } catch {}
  }, [periodKey, amountsKey]);

  const updateRec = useCallback((name, rec) => {
    setRecs(prev => {
      const next = { ...prev, [name]: { ...prev[name], rec } };
      try { localStorage.setItem(periodKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [periodKey]);

  const updateNote = useCallback((name, note) => {
    setRecs(prev => {
      const next = { ...prev, [name]: { ...prev[name], note } };
      try { localStorage.setItem(periodKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [periodKey]);

  const updateAmount = useCallback((rank, value) => {
    setBonusAmounts(prev => {
      const next = { ...prev, [rank]: value };
      try { localStorage.setItem(amountsKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [amountsKey]);

  // ── Compliance calculation ────────────────────────────────────
  const divCompliance = useMemo(() => {
    return divEmps.map(emp => {
      const req      = getReq(emp.rank);
      const total4   = divWeeks.reduce((s, w) => s + (divMap[emp.name]?.[w] ?? 0), 0);
      const reqTotal = req.type === 'monthly' ? req.hours : req.hours * 4;
      const threshold = reqTotal * 0.75;
      const pct = reqTotal > 0 ? (total4 / reqTotal) * 100 : 0;
      return { emp, total4, reqTotal, threshold, pct, met: total4 >= threshold };
    }).sort((a, b) => {
      const diff = getRankIndex(a.emp.rank) - getRankIndex(b.emp.rank);
      return diff !== 0 ? diff : a.emp.name.localeCompare(b.emp.name);
    });
  }, [divEmps, divWeeks, divMap]);

  const compliant    = useMemo(() => divCompliance.filter(d =>  d.met), [divCompliance]);
  const nonCompliant = useMemo(() => divCompliance.filter(d => !d.met), [divCompliance]);
  const pendingCount = useMemo(() => nonCompliant.filter(d => !recs[d.emp.name]?.rec).length, [nonCompliant, recs]);

  // ── BBCode generation ─────────────────────────────────────────
  const generateBBCode = useCallback(() => {
    const tableRows = activeRanks
      .map(rank => {
        const amount = parseInt(bonusAmounts[rank]) || 0;
        const count  = rankCounts[rank] || 0;
        const total  = amount * count;
        if (!amount && !count) return null;
        return `|   ${rank}  |    ${bbMoney(amount)}   |   ${count}   |   ${bbMoney(total)}   |`;
      })
      .filter(Boolean);

    const notRecList = nonCompliant.filter(d => recs[d.emp.name]?.rec === 'no');
    const recExcList = nonCompliant.filter(d => recs[d.emp.name]?.rec === 'yes');

    const notRecBB = notRecList.length === 0 ? '' :
      `Bonuses not Recommended to:\n[list]\n` +
      notRecList.map((d, i) =>
        `${i > 0 ? '[*]' : ''}[color=#FF0000]${d.emp.rank} - ${d.emp.name}[/color] - ${recs[d.emp.name]?.note || 'No reason provided.'}`
      ).join('\n') + '\n[/list]\n';

    const recExcBB = recExcList.length === 0 ? '' :
      `Bonuses Recommended to:\n[list]\n` +
      recExcList.map((d, i) =>
        `${i > 0 ? '[*]' : ''}[color=#008000]${d.emp.rank} - ${d.emp.name}[/color] - ${recs[d.emp.name]?.note || 'No reason provided.'}`
      ).join('\n') + '\n[/list]\n';

    const tpl = bbcodeTemplates?.quarterly_bonus;
    if (tpl) {
      return tpl
        .replace(/\{\{bonus_table\}\}/g,          tableRows.join('\n'))
        .replace(/\{\{not_recommended_list\}\}/g, notRecBB)
        .replace(/\{\{recommended_list\}\}/g,     recExcBB);
    }

    return `[mdheader title="Los Santos Emergency Medical Services" location="Pillbox Hill Medical Center" date=" | Paleto Bay Medical Center"department="One Team, One Mission, Saving Lives"][/mdheader]
[divbox4=eeeeee][hr][/hr]Greetings!

See below a table that was made to show the recommended bonuses per rank. And below that the justifications for each.

[url=HOURS_SHEET_URL_HERE]Here is a link to our hours sheet![/url]

| Rank  | Bonus | Count | Total |
|:-----|:------:|------:|------:|
${tableRows.join('\n')}

${notRecBB}${recExcBB}Please let me know if you have any follow up questions!

[hr][/hr]

[/divbox4]`;
  }, [activeRanks, bonusAmounts, rankCounts, nonCompliant, recs, bbcodeTemplates]);

  const copyBBCode = async () => {
    try {
      await navigator.clipboard.writeText(generateBBCode());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  // ── Retention bonus data ──────────────────────────────────────
  // Most recent payment per employee — only used to tell whether the
  // currently-due milestone has been settled. The schedule itself comes
  // from the hire date.
  const lastPaymentByEmployee = useMemo(() => buildLastPaymentMap(payments), [payments]);

  const enriched = useMemo(() => sortByRank(initial).map(b => ({
    ...b,
    days:  daysEmployed(b.hireDate),
    bonus: getNextBonus(b.hireDate, lastPaymentByEmployee[b.name] || null, bonusCycle,
      b.bonusAnchor ? { date: b.bonusAnchor, step: b.bonusStep } : null),
  })), [initial, lastPaymentByEmployee, bonusCycle]);

  const dueNow  = enriched.filter(b => b.bonus?.daysUntil <= 0);
  const dueSoon = enriched.filter(b => b.bonus?.daysUntil > 0 && b.bonus.daysUntil <= 30);
  const allFiltered = enriched.filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase()));

  const handlePay = async () => {
    if (!payModal) return;
    setProcessing(true); setError('');
    try {
      const res = await markBonusPaid({ employeeName: payModal.name, amount: payModal.amount, monthsTenure: payModal.months });
      if (!res.ok) { setError(res.error); return; }
      // Same date shape the server stores, so the optimistic row sorts correctly.
      setPayments(p => [...p, { employee_name: payModal.name, amount: payModal.amount, months_tenure: payModal.months, paid_date: toStoredDate() }]);
      setPayModal(null);
    } catch(e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  const TABS = [
    can('view_quarterly') && { id: 'quarterly', label: 'Quarterly Bonuses',  badge: pendingCount > 0 ? `${pendingCount} pending` : null, badgeAccent: 'warning' },
    can('view_retention') && { id: 'retention', label: 'Retention Bonuses',  badge: dueNow.length > 0 ? `${dueNow.length} due` : dueSoon.length > 0 ? `${dueSoon.length} soon` : null, badgeAccent: dueNow.length > 0 ? 'danger' : 'warning' },
                             { id: 'history',   label: 'Payment History',    badge: payments.length > 0 ? String(payments.length) : null, badgeAccent: 'accent' },
  ].filter(Boolean);

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-3">

      {/* Title + tabs */}
      <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
        <h1 style={{fontSize:18,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>Bonuses</h1>
        <div style={{display:'flex',gap:4}}>
          {TABS.map(({ id, label, badge, badgeAccent }) => {
            const active = tab === id;
            const badgeColor = badgeAccent==='danger'?'var(--c-danger)':badgeAccent==='warning'?'var(--c-warning)':'var(--c-accent)';
            const badgeGlow  = badgeAccent==='danger'?'var(--c-danger-glow)':badgeAccent==='warning'?'var(--c-warn-glow)':'var(--c-accent-glow)';
            return (
              <button key={id} onClick={() => setTab(id)}
                style={{
                  padding:'5px 12px', borderRadius:8, border:'1px solid', cursor:'pointer',
                  fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em',
                  background: active ? 'var(--c-accent-bg)' : 'transparent',
                  color:      active ? 'var(--c-accent)'    : 'var(--text-3)',
                  borderColor:active ? 'var(--c-accent-glow)':'var(--border)',
                  boxShadow:  active ? '0 0 10px var(--c-accent-glow)':'none',
                  transition:'all 0.15s', display:'flex', alignItems:'center', gap:6,
                }}>
                {label}
                {badge && (
                  <span style={{fontSize:9,fontWeight:800,padding:'1px 5px',borderRadius:999,color:badgeColor,background:`${badgeColor}15`,border:`1px solid ${badgeGlow}`}}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── QUARTERLY BONUSES ─────────────────────────────────── */}
      {tab === 'quarterly' && (
        <div className="space-y-3">

          {/* Period header + Copy BBCode */}
          <div className="surface" style={{ padding:'12px 16px', display:'flex', flexWrap:'wrap', gap:12, alignItems:'center' }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)', marginBottom:3 }}>
                Analyzing Last 4 Weeks
              </div>
              {divWeeks.length > 0 ? (
                <div style={{ fontSize:12, color:'var(--text-2)', fontFamily:'monospace' }}>
                  {divWeeks[divWeeks.length - 1]} → {divWeeks[0]}
                </div>
              ) : (
                <div style={{ fontSize:12, color:'var(--text-4)', fontStyle:'italic' }}>No week data available.</div>
              )}
              <div style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>
                Threshold: <span style={{ color:'var(--c-accent)', fontWeight:700 }}>75%</span> of 4-week requirement ·
                <span style={{ marginLeft:4 }}>{compliant.length} met</span> ·
                <span style={{ color:'var(--c-danger)', marginLeft:4 }}>{nonCompliant.length} below</span>
              </div>
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
              {pendingCount > 0 && (
                <span style={{ fontSize:11, color:'var(--c-warning)' }}>{pendingCount} decisions pending</span>
              )}
              {can('copy_bbcode') && (
                <button onClick={copyBBCode} className="btn-primary"
                  style={{ background: copied ? 'linear-gradient(135deg,#059669,#047857)' : undefined }}>
                  {copied ? '✓ Copied!' : 'Copy BBCode'}
                </button>
              )}
            </div>
          </div>

          {/* ── Bonus Table — auto-populated from roster ─────────── */}
          <div className="surface" style={{ overflow:'hidden' }}>
            <div style={{
              padding:'9px 18px', background:'rgba(0,0,0,0.25)',
              borderBottom:'1px solid var(--border)',
              display:'flex', alignItems:'center', gap:10,
            }}>
              <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.10em', color:'var(--text-3)' }}>
                Bonus Table
              </span>
              <span style={{ fontSize:10, color:'var(--text-4)' }}>
                Counts are live from the roster — enter the bonus amount per rank
              </span>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:420 }}>
                <thead>
                  <tr style={{ background:'var(--bg-sub)', borderBottom:'1px solid var(--border)' }}>
                    {['Rank','Count','Bonus Amount','Total'].map((h, i) => (
                      <th key={h} style={{
                        padding:'7px 14px', fontSize:10, fontWeight:700, textTransform:'uppercase',
                        letterSpacing:'0.09em', color:'var(--text-3)',
                        textAlign: i >= 1 ? 'right' : 'left',
                        width: i === 1 ? '8%' : i === 0 ? '30%' : undefined,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeRanks.map((rank, i) => {
                    const count  = rankCounts[rank] || 0;
                    const amount = parseInt(bonusAmounts[rank]) || 0;
                    const total  = amount * count;
                    const inp = { border:'1px solid var(--border)', background:'var(--bg-sub)', color:'var(--text-1)', fontSize:11, outline:'none', borderRadius:5, padding:'3px 8px', textAlign:'right' };
                    return (
                      <tr key={rank} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', background: i%2===0 ? 'var(--bg-stripe)' : 'transparent' }}>
                        <td style={{ padding:'5px 14px', fontSize:12, fontWeight:600, color:'var(--text-1)' }}>{rank}</td>
                        <td style={{ padding:'5px 14px', textAlign:'right', fontFamily:'monospace', fontSize:12, color:'var(--text-3)' }}>{count}</td>
                        <td style={{ padding:'3px 8px', textAlign:'right' }}>
                          <input type="number" min="0" step="1000"
                            value={bonusAmounts[rank] ?? ''}
                            onChange={e => updateAmount(rank, e.target.value)}
                            placeholder="—"
                            style={{ ...inp, width:120 }}
                            onFocus={fr} onBlur={fb} />
                        </td>
                        <td style={{ padding:'5px 14px', textAlign:'right', fontFamily:'monospace', fontSize:12, fontWeight:600, color: total > 0 ? 'var(--c-success)' : 'var(--text-4)' }}>
                          {total > 0 ? bbMoney(total) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {activeRanks.length === 0 && (
                    <tr><td colSpan={4} style={{ padding:'24px', textAlign:'center', color:'var(--text-4)', fontStyle:'italic', fontSize:12 }}>No employees on roster.</td></tr>
                  )}
                </tbody>
                {(() => {
                  const grand = activeRanks.reduce((s, rank) => s + (parseInt(bonusAmounts[rank])||0) * (rankCounts[rank]||0), 0);
                  if (!grand) return null;
                  return (
                    <tfoot>
                      <tr style={{ borderTop:'1px solid var(--border-hi)', background:'var(--bg-sub)' }}>
                        <td colSpan={3} style={{ padding:'8px 14px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)' }}>Grand Total</td>
                        <td style={{ padding:'8px 14px', textAlign:'right', fontFamily:'monospace', fontWeight:800, fontSize:14, color:'var(--c-success)' }}>{bbMoney(grand)}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </div>

          {/* Non-compliant employees */}
          {nonCompliant.length === 0 ? (
            <div className="surface" style={{ padding:'32px 16px', textAlign:'center' }}>
              <span className="pill pill-success" style={{ fontSize:12, padding:'6px 16px' }}>All members met the 75% threshold</span>
            </div>
          ) : (
            <div className="surface" style={{ overflow:'hidden' }}>
              <div style={{
                padding:'9px 18px', background:'rgba(0,0,0,0.25)',
                borderBottom:'1px solid var(--border)',
                display:'flex', alignItems:'center', gap:10,
              }}>
                <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.10em', color:'var(--text-3)' }}>
                  Below 75% Threshold
                </span>
                <span style={{ fontSize:11, color:'var(--c-danger)', fontWeight:600 }}>
                  {nonCompliant.length} member{nonCompliant.length !== 1 ? 's' : ''}
                </span>
              </div>

              {nonCompliant.map((d, i) => {
                const rec     = recs[d.emp.name]?.rec ?? null;
                const note    = recs[d.emp.name]?.note ?? '';
                const loaWeeks = divWeeks.filter(w => loaDuringWeek(d.emp, w)).length;
                return (
                  <div key={d.emp.name} style={{
                    padding:'14px 18px',
                    borderBottom: i < nonCompliant.length - 1 ? '1px solid var(--border)' : 'none',
                    background: rec === 'yes' ? 'rgba(52,211,153,0.04)' : rec === 'no' ? 'rgba(248,113,113,0.04)' : 'transparent',
                  }}>
                    <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:10, marginBottom:10 }}>
                      <div style={{ flex:1, minWidth:180 }}>
                        <div style={{ fontSize:14, fontWeight:700, color:'var(--text-1)', lineHeight:1 }}>{d.emp.name}</div>
                        <div style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>{d.emp.rank}</div>
                      </div>

                      <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'center' }}>
                        {[
                          { label:'Logged',   val:`${d.total4.toFixed(2)}h`,    color:'var(--c-danger)' },
                          { label:'Required', val:`${d.reqTotal.toFixed(1)}h`,  color:'var(--text-2)'  },
                          { label:'75% Min',  val:`${d.threshold.toFixed(1)}h`, color:'var(--text-3)'  },
                          { label:'Achieved', val:`${d.pct.toFixed(0)}%`,       color:'var(--c-danger)' },
                        ].map(({ label, val, color }) => (
                          <div key={label} style={{ textAlign:'center' }}>
                            <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-4)', marginBottom:2 }}>{label}</div>
                            <div style={{ fontSize:15, fontWeight:800, fontFamily:'monospace', color }}>{val}</div>
                          </div>
                        ))}
                        {loaWeeks > 0 && (
                          <div style={{ textAlign:'center' }}>
                            <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-4)', marginBottom:2 }}>LOA Weeks</div>
                            <div style={{ fontSize:15, fontWeight:800, fontFamily:'monospace', color:'var(--c-warning)' }}>{loaWeeks}/4</div>
                          </div>
                        )}
                      </div>

                      <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                        <button onClick={() => updateRec(d.emp.name, rec === 'yes' ? null : 'yes')}
                          style={{
                            padding:'5px 12px', borderRadius:8, border:'1px solid', cursor:'pointer',
                            fontSize:11, fontWeight:700, transition:'all 0.12s',
                            background: rec === 'yes' ? 'rgba(52,211,153,0.18)' : 'transparent',
                            color:      rec === 'yes' ? 'var(--c-success)'       : 'var(--text-3)',
                            borderColor:rec === 'yes' ? 'var(--c-succ-glow)'     : 'var(--border)',
                          }}>
                          ✓ Recommend
                        </button>
                        <button onClick={() => updateRec(d.emp.name, rec === 'no' ? null : 'no')}
                          style={{
                            padding:'5px 12px', borderRadius:8, border:'1px solid', cursor:'pointer',
                            fontSize:11, fontWeight:700, transition:'all 0.12s',
                            background: rec === 'no' ? 'var(--c-danger-bg)' : 'transparent',
                            color:      rec === 'no' ? 'var(--c-danger)'    : 'var(--text-3)',
                            borderColor:rec === 'no' ? 'var(--c-danger-glow)' : 'var(--border)',
                          }}>
                          ✗ Not Recommend
                        </button>
                      </div>
                    </div>

                    <textarea
                      placeholder="Add a note (required for BBCode)..."
                      value={note}
                      onChange={e => updateNote(d.emp.name, e.target.value)}
                      rows={2}
                      style={{
                        width:'100%', padding:'7px 10px', borderRadius:8, resize:'vertical',
                        border:'1px solid var(--border)', background:'var(--bg-sub)',
                        color:'var(--text-1)', fontSize:12, outline:'none',
                        transition:'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onFocus={fr} onBlur={fb}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Compliant — collapsible */}
          <div className="surface" style={{ overflow:'hidden' }}>
            <button onClick={() => setShowAll(v => !v)}
              style={{
                width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'10px 16px', background:'none', border:'none', cursor:'pointer',
                borderBottom: showAll ? '1px solid var(--border)' : 'none', transition:'background 0.12s',
              }}
              onMouseEnter={e => e.currentTarget.style.background='var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background='none'}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--text-3)' }}>
                  Met Threshold ({compliant.length})
                </span>
                <span className="pill pill-success" style={{ fontSize:9 }}>≥75%</span>
              </div>
              <span style={{ fontSize:11, color:'var(--text-4)', transition:'transform 0.15s', transform: showAll?'rotate(90deg)':'none' }}>▶</span>
            </button>
            {showAll && (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="lsems-table" style={{ minWidth:480 }}>
                  <thead><tr>
                    <th>Name</th><th>Rank</th>
                    <th className="text-right">Logged</th>
                    <th className="text-right">Required</th>
                    <th className="text-right">%</th>
                    <th>Status</th>
                  </tr></thead>
                  <tbody>
                    {compliant.map(d => (
                      <tr key={d.emp.name}>
                        <td style={{ fontWeight:600, color:'var(--text-1)' }}>{d.emp.name}</td>
                        <td style={{ color:'var(--text-2)' }}>{d.emp.rank}</td>
                        <td className="text-right font-mono stat-success">{d.total4.toFixed(2)}</td>
                        <td className="text-right font-mono" style={{ color:'var(--text-3)' }}>{d.reqTotal.toFixed(1)}</td>
                        <td className="text-right font-mono" style={{ color:'var(--c-success)', fontWeight:700 }}>{d.pct.toFixed(0)}%</td>
                        <td>{d.emp.isOnLoa ? <span className="pill pill-warning">LOA</span> : <span className="pill pill-success">Active</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RETENTION BONUSES ─────────────────────────────────── */}
      {tab === 'retention' && (
        <div className="space-y-3">
          {dueNow.length > 0 && (
            <div style={{ padding:'10px 16px', borderRadius:12, border:'1px solid var(--c-danger-glow)', background:'var(--c-danger-bg)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
              <span style={{ fontSize:12, color:'var(--c-danger)', fontWeight:600 }}>
                {dueNow.length} retention bonus{dueNow.length!==1?'es':''} due now
              </span>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {dueNow.slice(0,3).map(b => (
                  <button key={b.name} className="pill pill-danger" style={{ cursor: can('pay') ? 'pointer' : 'default' }}
                    onClick={() => can('pay') && setPayModal({ name:b.name, amount:b.bonus.nextAmount, months: b.bonus.monthsTenure, milestone: b.bonus.milestone })}>
                    {b.name} · {fmtCurrency(b.bonus.nextAmount)}
                  </button>
                ))}
                {dueNow.length > 3 && <span style={{ fontSize:11, color:'var(--c-danger)' }}>+{dueNow.length-3} more</span>}
              </div>
            </div>
          )}
          {dueSoon.length > 0 && (
            <div style={{ padding:'10px 16px', borderRadius:12, border:'1px solid var(--c-warn-glow)', background:'var(--c-warn-bg)', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span style={{ fontSize:12, color:'var(--c-warning)', fontWeight:600 }}>Due within 30 days:</span>
              {dueSoon.map(b => (
                <span key={b.name} style={{ fontSize:11, color:'var(--c-warning)' }}>{b.name} ({b.bonus.daysUntil}d)</span>
              ))}
            </div>
          )}
          {dueNow.length === 0 && dueSoon.length === 0 && (
            <div className="surface" style={{ padding:'24px 16px', textAlign:'center' }}>
              <span className="pill pill-success" style={{ fontSize:12, padding:'6px 16px' }}>All retention bonuses current</span>
            </div>
          )}
          <div className="surface" style={{ overflow:'hidden' }}>
            <div style={{ padding:'9px 18px', background:'rgba(0,0,0,0.25)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.10em', color:'var(--text-3)' }}>All Employees</span>
              <input placeholder="Search…" className="lsems-input" style={{ width:160, marginLeft:'auto' }}
                value={search} onChange={e => setSearch(e.target.value)} onFocus={fr} onBlur={fb}/>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="lsems-table" style={{ minWidth:520 }}>
                <thead><tr><th>Name</th><th>Hire Date</th><th className="text-center">Milestone</th><th className="text-right">Next Bonus</th><th className="text-right">Due Date</th><th className="text-center">Status</th></tr></thead>
                <tbody>
                  {allFiltered.length===0 ? (
                    <tr><td colSpan={6} style={{ padding:'32px', textAlign:'center', color:'var(--text-3)', fontStyle:'italic' }}>No records.</td></tr>
                  ) : allFiltered.map(b => {
                    // "Due" means due — same test as the banner above (daysUntil <= 0),
                    // so the table and the banner can never disagree.
                    const d = b.bonus?.daysUntil;
                    const badge = d == null ? <span style={{ fontSize:11, color:'var(--text-4)' }}>—</span>
                      : d <= 0
                        ? <span className="pill pill-danger" style={{cursor: can('pay') ? 'pointer' : 'default'}} onClick={() => can('pay') && setPayModal({ name:b.name, amount:b.bonus.nextAmount, months: b.bonus.monthsTenure, milestone: b.bonus.milestone })}>{d === 0 ? 'Due today' : `${-d}d overdue`}</span>
                        : <span style={{ fontSize:11, fontFamily:'monospace', color: d <= 30 ? 'var(--c-warning)' : 'var(--text-2)' }}>in {d}d</span>;
                    return (
                      <tr key={b.name} style={d != null && d <= 0 ? { background:'var(--c-danger-bg)', boxShadow:'inset 3px 0 0 var(--c-danger)' } : undefined}>
                        <td style={{ fontWeight:600, color:'var(--text-1)' }}>{b.name}</td>
                        <td style={{ color:'var(--text-2)' }}>{fmtDate(b.hireDate)}</td>
                        <td className="text-center"><span className="pill pill-muted">#{b.bonus?.milestone ?? '—'}</span></td>
                        <td className="text-right font-mono font-semibold stat-success">{b.bonus ? fmtCurrency(b.bonus.nextAmount) : '—'}</td>
                        <td className="text-right" style={{ color:'var(--text-2)' }}>{b.bonus ? fmtDate(b.bonus.nextDate) : '—'}</td>
                        <td className="text-center">{badge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── PAYMENT HISTORY ───────────────────────────────────── */}
      {tab === 'history' && (
        <div className="space-y-3">
          <div className="surface" style={{ overflow:'hidden' }}>
            <div style={{ padding:'9px 18px', background:'rgba(0,0,0,0.25)', borderBottom:'1px solid var(--border)' }}>
              <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.10em', color:'var(--text-3)' }}>Payment Log</span>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="lsems-table" style={{ minWidth:400 }}>
                <thead><tr><th>Date Paid</th><th>Employee</th><th className="text-center">Milestone</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {payments.length===0 ? (
                    <tr><td colSpan={4} style={{ padding:'40px', textAlign:'center', color:'var(--text-3)', fontStyle:'italic' }}>No payments recorded.</td></tr>
                  ) : payments.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily:'monospace', fontSize:12, color:'var(--text-3)' }}>{p.paid_date}</td>
                      <td style={{ fontWeight:600, color:'var(--text-1)' }}>{p.employee_name}</td>
                      <td style={{ textAlign:'center' }}><span className="pill pill-muted">{p.months_tenure ? `${p.months_tenure}mo` : '—'}</span></td>
                      <td style={{ textAlign:'right', fontFamily:'monospace', fontWeight:700 }} className="stat-success">{fmtCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {error && <div style={{ padding:'10px 14px', borderRadius:10, border:'1px solid var(--c-danger-glow)', background:'var(--c-danger-bg)', color:'var(--c-danger)', fontSize:13 }}>{error}</div>}

      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.80)' }} onClick={() => setPayModal(null)}>
          <div className="surface glass-modal p-5 w-full max-w-sm" style={{ borderRadius:16, borderColor:'var(--c-succ-glow)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--text-1)', marginBottom:14 }}>Confirm Bonus Payment</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16, fontSize:13 }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ color:'var(--text-3)' }}>Employee</span><strong style={{ color:'var(--text-1)' }}>{payModal.name}</strong></div>
              <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ color:'var(--text-3)' }}>Milestone</span><span className="pill pill-muted">{payModal.months}-month</span></div>
              <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ color:'var(--text-3)' }}>Amount</span><strong className="stat-success">{fmtCurrency(payModal.amount)}</strong></div>
            </div>
            <p style={{ fontSize:11, color:'var(--text-3)', marginBottom:14 }}>This records a {fmtCurrency(payModal.amount)} retention bonus payout.</p>
            {error && <p style={{ fontSize:11, color:'var(--c-danger)', marginBottom:10 }}>{error}</p>}
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setPayModal(null)} className="btn-ghost" style={{ flex:1, textAlign:'center' }}>Cancel</button>
              <button disabled={processing} onClick={handlePay}
                className="btn-primary" style={{ flex:1, justifyContent:'center', background:'linear-gradient(135deg,#059669,#047857)', boxShadow:'var(--shadow-btn),0 0 20px var(--c-succ-glow)' }}>
                {processing ? 'Recording…' : 'Confirm & Deduct'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
