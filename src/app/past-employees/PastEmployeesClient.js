"use client";
import { useState } from 'react';
import { fmtDate, fmtCurrency, getNextBonus } from '../constants';
import { getPastEmployeeProfile } from '../actions';

export default function PastEmployeesClient({ employees }) {
  const [search, setSearch] = useState('');

  const [profileEmp,     setProfileEmp]     = useState(null);
  const [profileData,    setProfileData]    = useState(null);
  const [profileTab,     setProfileTab]     = useState('ranks');
  const [profileLoading, setProfileLoading] = useState(false);

  const openProfile = async (emp) => {
    setProfileEmp(emp);
    setProfileData(null);
    setProfileTab('ranks');
    setProfileLoading(true);
    try {
      const data = await getPastEmployeeProfile(emp.name);
      setProfileData(data);
    } finally {
      setProfileLoading(false);
    }
  };

  const filtered = employees.filter(e =>
    !search ||
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.exitRank || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">

      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div>
          <h1 style={{ fontSize:18, fontWeight:800, color:'var(--text-1)', lineHeight:1 }}>Past Employees</h1>
          <p style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>
            <span style={{ color:'var(--c-accent)', fontWeight:700 }}>{employees.length}</span> separated · click a name to view history
          </p>
        </div>
        <div style={{ marginLeft:'auto' }}>
          <input type="text" placeholder="Search…" className="lsems-input" style={{ width:180 }}
            value={search} onChange={e => setSearch(e.target.value)}
            onFocus={e => { e.currentTarget.style.borderColor='var(--c-accent)'; e.currentTarget.style.boxShadow='0 0 0 3px var(--c-accent-glow)'; }}
            onBlur={e  => { e.currentTarget.style.borderColor='var(--border)';   e.currentTarget.style.boxShadow='none'; }} />
        </div>
      </div>

      <div className="surface" style={{ overflow:'hidden' }}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="lsems-table" style={{ minWidth:580 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Separated</th>
                <th>Exit Rank</th>
                <th>Hire Date</th>
                <th>Authorized By</th>
                <th className="text-right">Total Hours</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding:'40px 16px', textAlign:'center', color:'var(--text-3)', fontStyle:'italic' }}>No records found.</td></tr>
              ) : filtered.map((p, i) => (
                <tr key={i}>
                  <td>
                    <button
                      onClick={() => openProfile(p)}
                      style={{
                        background:'none', border:'none', cursor:'pointer', padding:0,
                        fontWeight:600, color:'var(--c-accent)', fontSize:13,
                        textAlign:'left', transition:'opacity 0.12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.opacity='0.75'}
                      onMouseLeave={e => e.currentTarget.style.opacity='1'}
                      title="View profile">
                      {p.name}
                    </button>
                  </td>
                  <td style={{ color:'var(--text-2)' }}>{fmtDate(p.dateSeparated)}</td>
                  <td><span className="pill pill-danger">{p.exitRank}</span></td>
                  <td style={{ color:'var(--text-2)' }}>{fmtDate(p.hireDate)}</td>
                  <td style={{ color:'var(--text-3)' }}>{p.authorizer}</td>
                  <td className="text-right font-mono font-semibold stat-accent">{p.totalHours?.toFixed(1) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Profile Panel — same as Roster */}
      {profileEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.80)' }}
          onClick={() => setProfileEmp(null)}>
          <div className="glass-modal w-full sm:w-[540px] flex flex-col"
            style={{ background:'var(--bg-card)', borderRadius:16, border:'1px solid var(--border)', maxHeight:'82vh' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ padding:'16px 20px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
              <div>
                <div style={{ fontSize:17, fontWeight:800, color:'var(--text-1)', lineHeight:1 }}>{profileEmp.name}</div>
                <div style={{ fontSize:12, color:'var(--text-3)', marginTop:4, display:'flex', gap:10, flexWrap:'wrap' }}>
                  <span className="pill pill-danger">{profileEmp.exitRank}</span>
                  {profileEmp.hireDate && <span>Hired {fmtDate(profileEmp.hireDate)}</span>}
                  {profileEmp.dateSeparated && <span style={{ color:'var(--c-danger)' }}>Sep. {fmtDate(profileEmp.dateSeparated)}</span>}
                </div>
                <div style={{ fontSize:11, color:'var(--text-3)', marginTop:4 }}>
                  Total <span style={{ color:'var(--c-accent)', fontWeight:700, fontFamily:'monospace' }}>{profileEmp.totalHours?.toFixed(1) ?? '—'}</span> hrs
                </div>
              </div>
              <button onClick={() => setProfileEmp(null)}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--text-4)', lineHeight:1 }}
                onMouseEnter={e => e.currentTarget.style.color='var(--text-2)'}
                onMouseLeave={e => e.currentTarget.style.color='var(--text-4)'}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              {[['ranks','Rank History'],['bonuses','Bonuses'],['hours','Hours']].map(([t,l]) => (
                <button key={t} onClick={() => setProfileTab(t)}
                  style={{
                    flex:1, padding:'9px 0', border:'none', cursor:'pointer',
                    fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em',
                    background: profileTab===t ? 'var(--c-accent-bg)' : 'transparent',
                    color:      profileTab===t ? 'var(--c-accent)'    : 'var(--text-3)',
                    borderBottom: profileTab===t ? '2px solid var(--c-accent)' : '2px solid transparent',
                    transition:'all 0.12s',
                  }}>
                  {l}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="overflow-y-auto custom-scrollbar" style={{ flex:1, minHeight:0 }}>
              {profileLoading ? (
                <div style={{ padding:'40px', textAlign:'center', color:'var(--text-3)' }}>Loading…</div>
              ) : profileData && (
                <>
                  {/* Rank History */}
                  {profileTab==='ranks' && (
                    <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column', gap:0 }}>
                      {profileData.rankHistory.length === 0 ? (
                        <div style={{ padding:'28px', textAlign:'center', color:'var(--text-3)', fontStyle:'italic' }}>No rank history.</div>
                      ) : profileData.rankHistory.map((r, i) => {
                        const isSep  = r.new_rank === 'SEPARATED';
                        const isHire = !r.old_rank;
                        const color  = isSep ? 'var(--c-danger)' : isHire ? 'var(--c-success)' : 'var(--c-accent)';
                        const isLast = i === profileData.rankHistory.length - 1;
                        return (
                          <div key={i} style={{ display:'flex', gap:12, paddingBottom: isLast ? 0 : 16, position:'relative' }}>
                            {!isLast && <div style={{ position:'absolute', left:7, top:16, bottom:0, width:1, background:'var(--border)' }} />}
                            <div style={{ width:15, height:15, borderRadius:'50%', background:color, flexShrink:0, marginTop:1, boxShadow:`0 0 8px ${color}60`, zIndex:1 }} />
                            <div style={{ flex:1 }}>
                              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                                <div>
                                  {isHire
                                    ? <span style={{ fontSize:13, fontWeight:600, color:'var(--c-success)' }}>Hired as {r.new_rank}</span>
                                    : isSep
                                      ? <span style={{ fontSize:13, fontWeight:600, color:'var(--c-danger)' }}>Separated from {r.old_rank}</span>
                                      : <span style={{ fontSize:13, fontWeight:600, color:'var(--text-1)' }}>
                                          {r.old_rank} <span style={{ color:'var(--text-4)' }}>→</span> <span style={{ color:'var(--c-accent)' }}>{r.new_rank}</span>
                                        </span>
                                  }
                                  {r.authorizer && <div style={{ fontSize:11, color:'var(--text-3)', marginTop:1 }}>by {r.authorizer}</div>}
                                </div>
                                <span style={{ fontSize:11, color:'var(--text-4)', fontFamily:'monospace', flexShrink:0 }}>{r.event_date}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Bonuses */}
                  {profileTab==='bonuses' && (
                    <div>
                      <div style={{ margin:'12px 0 0' }}>
                        <div style={{ padding:'6px 20px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)' }}>
                          Payment History
                        </div>
                        {profileData.bonuses.length === 0 ? (
                          <div style={{ padding:'20px', textAlign:'center', color:'var(--text-3)', fontStyle:'italic', fontSize:12 }}>No payments recorded.</div>
                        ) : (
                          <table style={{ width:'100%', borderCollapse:'collapse' }}>
                            <thead>
                              <tr style={{ background:'var(--bg-sub)', borderBottom:'1px solid var(--border)' }}>
                                {['Date','Milestone','Amount'].map(h => (
                                  <th key={h} style={{ padding:'7px 20px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)', textAlign: h==='Amount' ? 'right' : 'left' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {profileData.bonuses.map((b, i) => (
                                <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', background: i%2===0 ? 'var(--bg-stripe)' : 'transparent' }}>
                                  <td style={{ padding:'8px 20px', fontSize:12, color:'var(--text-3)', fontFamily:'monospace' }}>{b.paid_date}</td>
                                  <td style={{ padding:'8px 20px', fontSize:12, color:'var(--text-2)' }}>{b.months_tenure ? `${b.months_tenure}-month` : '—'}</td>
                                  <td style={{ padding:'8px 20px', fontSize:13, fontWeight:700, fontFamily:'monospace', textAlign:'right', color:'var(--c-success)' }}>{fmtCurrency(b.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Hours */}
                  {profileTab==='hours' && (
                    <div>
                      {profileData.hours.length === 0 ? (
                        <div style={{ padding:'40px', textAlign:'center', color:'var(--text-3)', fontStyle:'italic' }}>No hours recorded.</div>
                      ) : (
                        <table style={{ width:'100%', borderCollapse:'collapse' }}>
                          <thead>
                            <tr style={{ background:'var(--bg-sub)', borderBottom:'1px solid var(--border)' }}>
                              <th style={{ padding:'8px 20px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)', textAlign:'left' }}>Week Ending</th>
                              <th style={{ padding:'8px 20px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)', textAlign:'right' }}>Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profileData.hours.map((h, i) => {
                              const hrs = h.hours;
                              const req = ['Chief','Assistant Chief','Deputy Chief','Lead Paramedic','Senior Paramedic','Paramedic','Junior Paramedic'].includes(profileEmp.exitRank) ? 5 : 2.5;
                              const color = !h.hasEntry ? 'var(--text-4)' : hrs >= req ? 'var(--c-success)' : hrs > 0 ? 'var(--c-danger)' : 'var(--text-4)';
                              return (
                                <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', background: i%2===0 ? 'var(--bg-stripe)' : 'transparent' }}>
                                  <td style={{ padding:'7px 20px', fontSize:12, color:'var(--text-3)', fontFamily:'monospace' }}>{h.week_ending}</td>
                                  <td style={{ padding:'7px 20px', fontSize:13, fontWeight:600, fontFamily:'monospace', textAlign:'right', color }}>
                                    {!h.hasEntry ? <span style={{ opacity:0.35 }}>—</span> : (hrs ?? 0).toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
