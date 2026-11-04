"use client";
import { useState } from 'react';
import { addEmployee, removeEmployee, promoteEmployee, renameEmployee, setEmployeeLOA, getEmployeeProfile } from './actions';
import { RANK_ORDER, sortByRank, daysInRank, fmtDate, fmtCurrency, getNextBonus, getRankIndex } from './constants';

const JP_INDEX = RANK_ORDER.indexOf('Junior Paramedic');

// ── Rank groups ───────────────────────────────────────────────
const RANK_GROUPS = [
  { label: 'High Command', ranks: new Set(['Chief', 'Assistant Chief', 'Deputy Chief']) },
  { label: 'Command',      ranks: new Set(['Commander', 'Captain', 'Lieutenant']) },
  { label: 'Supervisor',   ranks: new Set(['Lead Paramedic', 'Senior Paramedic', 'Paramedic', 'Junior Paramedic']) },
  { label: 'EMT',          ranks: new Set(['EMT-P', 'Master EMT', 'EMT-A', 'EMT-I', 'EMT-B', 'EMR']) },
  { label: 'Consultant',   ranks: new Set(['Consultant']) },
];
function getRankGroup(rank) {
  for (const g of RANK_GROUPS) if (g.ranks.has(rank)) return g.label;
  return 'Other';
}

const focusRing = e => { e.currentTarget.style.borderColor = 'var(--c-accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--c-accent-glow)'; };
const blurRing  = e => { e.currentTarget.style.borderColor = 'var(--border)';   e.currentTarget.style.boxShadow = 'none'; };

export default function RosterClient({ employees: initial, userLevel = 1, perms = {} }) {
  const can = (key) => perms[key] !== false;
  const canOverrideAuth = userLevel >= 2;
  const [employees,    setEmployees]    = useState(sortByRank(initial));
  const [search,       setSearch]       = useState('');
  const [rankFilter,   setRankFilter]   = useState('All');
  const [processing,   setProcessing]   = useState(false);
  const [error,        setError]        = useState('');

  // Modals
  const [addModal,     setAddModal]     = useState(false);
  const [removeModal,  setRemoveModal]  = useState(null);
  const [promoteModal, setPromoteModal] = useState(null);
  const [renameModal,  setRenameModal]  = useState(null);
  const [loaModal,     setLoaModal]     = useState(null);

  // Forms
  const [addForm,     setAddForm]     = useState({ name:'', rank:RANK_ORDER[RANK_ORDER.length-1], hireDate:'', authorizer:'' });
  const [promoteForm, setPromoteForm] = useState({ newRank:'', authorizer:'' });
  const [removeForm,  setRemoveForm]  = useState({ authorizer:'' });
  // authorizer is only sent when L2/L3 explicitly picks an override; otherwise resolved server-side
  const [renameForm,  setRenameForm]  = useState({ newName:'' });
  const [loaForm,     setLoaForm]     = useState({ loaStart:'', loaEnd:'', loaReason:'' });

  const [profileEmp,   setProfileEmp]   = useState(null); // { name, rank, ... }
  const [profileData,  setProfileData]  = useState(null); // { hours, bonuses, rankHistory }
  const [profileTab,   setProfileTab]   = useState('hours');
  const [profileLoading, setProfileLoading] = useState(false);

  const openProfile = async (emp) => {
    setProfileEmp(emp);
    setProfileData(null);
    setProfileTab('hours');
    setProfileLoading(true);
    try {
      const data = await getEmployeeProfile(emp.name);
      setProfileData(data);
    } finally {
      setProfileLoading(false);
    }
  };

  const authorizers  = employees.filter(e => getRankIndex(e.rank) <= JP_INDEX && e.rank !== 'Consultant').map(e => e.name).sort();
  const rankGroups   = ['All', ...RANK_ORDER.filter(r => employees.some(e => e.rank === r))];
  const baseFiltered = employees.filter(e =>
    (rankFilter === 'All' || e.rank === rankFilter) &&
    (!search || e.name.toLowerCase().includes(search.toLowerCase()))
  );

  // Group filtered employees
  const grouped = RANK_GROUPS.map(g => ({
    label: g.label,
    members: baseFiltered.filter(e => g.ranks.has(e.rank)),
  })).filter(g => g.members.length > 0);

  const act = async (fn, reset) => {
    setProcessing(true); setError('');
    try {
      const res = await fn();
      if (!res.ok) { setError(res.error || 'Operation failed.'); return; }
      reset?.();
      window.location.reload();
    } catch (e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  const openLoa = (emp) => {
    setLoaModal(emp);
    setLoaForm({ loaStart: emp.loaStart || '', loaEnd: emp.loaEnd || '', loaReason: emp.loaReason || '' });
  };

  const handleLoa = async (isOnLoa) => {
    await act(
      () => setEmployeeLOA({ name: loaModal.name, isOnLoa, ...loaForm }),
      () => setLoaModal(null)
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">

      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div>
          <h1 style={{fontSize:18,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>Staff Roster</h1>
          <p style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>
            <span className="stat-accent" style={{fontWeight:700}}>{employees.length}</span> active
            {employees.filter(e=>e.loaStarted).length > 0 && <span> · <span style={{color:'var(--c-warning)',fontWeight:600}}>{employees.filter(e=>e.loaStarted).length} on LOA</span></span>}
          </p>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {can('add') && <button className="btn-primary" onClick={() => setAddModal(true)}>+ Add Employee</button>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <input type="text" placeholder="Search…" className="lsems-input" style={{ width:160 }}
          value={search} onChange={e => setSearch(e.target.value)} onFocus={focusRing} onBlur={blurRing} />
        <div className="flex flex-wrap gap-0.5">
          {rankGroups.map(r => (
            <button key={r} onClick={() => setRankFilter(r)}
              style={{
                padding:'2px 7px', borderRadius:5, border:'1px solid', cursor:'pointer',
                fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em',
                transition:'all 0.12s',
                background:  rankFilter===r ? 'var(--c-accent-bg)' : 'transparent',
                color:       rankFilter===r ? 'var(--c-accent)'    : 'var(--text-4)',
                borderColor: rankFilter===r ? 'var(--c-accent-glow)': 'var(--border)',
              }}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Single table — all groups share one column grid for perfect alignment */}
      {grouped.length === 0 ? (
        <div className="surface p-10 text-center italic" style={{ color:'var(--text-3)' }}>No staff found.</div>
      ) : (
        <div className="space-y-2">
          {/* Shared colgroup rendered once as a reference via an invisible placeholder */}
          {grouped.map((group, gi) => (
            <div key={group.label} className="surface overflow-hidden">
              {/* Group header */}
              <div style={{
                padding:'9px 18px',
                background:'rgba(0,0,0,0.30)',
                borderBottom:'1px solid var(--border)',
                display:'flex', alignItems:'center', gap:8,
              }}>
                <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.10em', color:'var(--text-3)' }}>
                  {group.label}
                </span>
                <span style={{ fontSize:10, color:'var(--text-4)' }}>
                  {group.members.length} member{group.members.length !== 1 ? 's' : ''}
                </span>
                {group.members.some(e => e.loaStarted) && (
                  <span className="pill pill-warning" style={{ marginLeft:'auto', fontSize:10 }}>
                    {group.members.filter(e=>e.loaStarted).length} on LOA
                  </span>
                )}
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed', minWidth:820 }}>
                  <colgroup>
                    <col style={{ width:'18%' }} />
                    <col style={{ width:'13%' }} />
                    <col style={{ width:'10%' }} />
                    <col style={{ width:'11%' }} />
                    <col style={{ width:'7%'  }} />
                    <col style={{ width:'8%'  }} />
                    <col style={{ width:'8%'  }} />
                    <col style={{ width:'25%' }} />
                  </colgroup>
                  {/* Column headers only on first group */}
                  {gi === 0 && (
                    <thead style={{ background:'var(--bg-sub)', borderBottom:'1px solid var(--border)' }}>
                      <tr>
                        {['Name','Rank','Hire Date','Last Promotion','Days','Hrs/Rank','Total Hrs','Actions'].map((h,i) => (
                          <th key={h} style={{
                            padding:'9px 16px', fontSize:10, fontWeight:700, textTransform:'uppercase',
                            letterSpacing:'0.08em', color:'var(--text-3)', whiteSpace:'nowrap',
                            textAlign: i>=4 && i<=6 ? 'right' : i===7 ? 'right' : 'left',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {group.members.map((emp, ri) => {
                    const days = daysInRank(emp.hireDate, emp.lastPromotion);
                    return (
                      <tr key={emp.name} style={emp.loaStarted ? { background:'rgba(251,191,36,0.03)' } : {}}>
                        <td style={{ padding:'10px 16px', overflow:'hidden' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, overflow:'hidden' }}>
                            <div style={{ overflow:'hidden', minWidth:0 }}>
                              <button onClick={() => openProfile(emp)}
                                style={{
                                  background:'none', border:'none', cursor:'pointer', padding:0,
                                  fontWeight:600, color:'var(--c-accent)', fontSize:13,
                                  textAlign:'left', overflow:'hidden', textOverflow:'ellipsis',
                                  whiteSpace:'nowrap', maxWidth:'100%', transition:'opacity 0.12s',
                                  display:'block',
                                }}
                                onMouseEnter={e=>e.currentTarget.style.opacity='0.75'}
                                onMouseLeave={e=>e.currentTarget.style.opacity='1'}
                                title={emp.name}>
                                {emp.name}
                              </button>
                              <div style={{ marginTop:3 }}>
                                {emp.isOnLoa && (
                                  <div style={{ fontSize:10, color: emp.loaStarted ? 'var(--c-warning)' : 'var(--text-3)', whiteSpace:'nowrap', marginBottom:3 }}>
                                    {emp.loaStarted ? 'LOA' : 'LOA scheduled'} {emp.loaStart}{emp.loaEnd ? ` – ${emp.loaEnd}` : ''}
                                  </div>
                                )}
                                {can('loa') && (
                                  <button onClick={() => openLoa(emp)}
                                    style={{
                                      background:'none', border:'1px solid var(--c-warn-glow)',
                                      borderRadius:4, cursor:'pointer', padding:'1px 6px',
                                      fontSize:9, fontWeight:700, textTransform:'uppercase',
                                      letterSpacing:'0.05em', color:'var(--c-warning)',
                                      transition:'opacity 0.12s',
                                    }}
                                    onMouseEnter={e=>e.currentTarget.style.opacity='0.7'}
                                    onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                                    {emp.isOnLoa ? 'Adjust LOA' : 'Add LOA'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding:'10px 16px', color:'var(--text-2)', fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{emp.rank}</td>
                        <td style={{ padding:'10px 16px', color:'var(--text-2)', fontSize:13 }}>{fmtDate(emp.hireDate)}</td>
                        <td style={{ padding:'10px 16px', color:'var(--text-3)', fontSize:13 }}>{emp.lastPromotion ? fmtDate(emp.lastPromotion) : '—'}</td>
                        <td style={{ padding:'10px 16px', textAlign:'right', fontFamily:'monospace', fontSize:13,
                          color: days > 90 ? 'var(--c-warning)' : 'var(--text-2)',
                          textShadow: days > 90 ? '0 0 10px var(--c-warn-glow)' : 'none',
                        }}>{days}</td>
                        <td style={{ padding:'10px 16px', textAlign:'right', fontFamily:'monospace', fontWeight:600, fontSize:13 }} className="stat-accent">{(emp.hoursInRank ?? 0).toFixed(1)}</td>
                        <td style={{ padding:'10px 16px', textAlign:'right', fontFamily:'monospace', fontWeight:600, fontSize:13 }} className="stat-success">{emp.totalHours.toFixed(1)}</td>
                        <td style={{ padding:'10px 16px', textAlign:'right', whiteSpace:'nowrap' }}>
                          <>
                            {can('promote') && <button onClick={() => { setPromoteModal(emp); setPromoteForm({ newRank:emp.rank, authorizer:'' }); }}
                              className="pill pill-accent cursor-pointer hover:opacity-80 transition-opacity" style={{ marginRight:4, fontSize:10 }}>Promote</button>}
                            {can('rename') && <button onClick={() => { setRenameModal(emp); setRenameForm({ newName:emp.name }); }}
                              className="pill pill-muted cursor-pointer hover:opacity-80 transition-opacity" style={{ marginRight:4, fontSize:10 }}>Rename</button>}
                            {can('separate') && <button onClick={() => { setRemoveModal(emp); setRemoveForm({ authorizer:'' }); }}
                              className="pill pill-danger cursor-pointer hover:opacity-80 transition-opacity" style={{ fontSize:10 }}>Remove</button>}
                          </>
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="px-4 py-3 rounded-xl border text-sm" style={{ background:'var(--c-danger-bg)', borderColor:'var(--c-danger-glow)', color:'var(--c-danger)' }}>{error}</div>}

      {/* Add modal */}
      {addModal && (
        <Modal title="Add Employee" onClose={() => setAddModal(false)}>
          <div className="space-y-3 mb-4">
            <Field label="Full Name"><input className="lsems-input" placeholder="e.g. John Smith" value={addForm.name} onChange={e=>setAddForm({...addForm,name:e.target.value})} onFocus={focusRing} onBlur={blurRing}/></Field>
            <Field label="Rank"><select className="lsems-input" value={addForm.rank} onChange={e=>setAddForm({...addForm,rank:e.target.value})}>{RANK_ORDER.map(r=><option key={r}>{r}</option>)}</select></Field>
            <Field label="Hire Date"><input className="lsems-input" placeholder="DD/Mon/YYYY" value={addForm.hireDate} onChange={e=>setAddForm({...addForm,hireDate:e.target.value})} onFocus={focusRing} onBlur={blurRing}/></Field>
            <AuthField label="Authorized By" canOverride={canOverrideAuth} authorizers={authorizers}
              value={addForm.authorizer} onChange={v=>setAddForm({...addForm,authorizer:v})} />
          </div>
          <ModalButtons processing={processing} onCancel={()=>setAddModal(false)} onConfirm={()=>act(()=>addEmployee(addForm),()=>setAddModal(false))} confirmLabel="Add Employee"/>
        </Modal>
      )}

      {/* Promote modal */}
      {promoteModal && (
        <Modal title={`Promote — ${promoteModal.name}`} subtitle={`Current rank: ${promoteModal.rank}`} onClose={()=>setPromoteModal(null)}>
          <div className="space-y-3 mb-4">
            <Field label="New Rank"><select className="lsems-input" value={promoteForm.newRank} onChange={e=>setPromoteForm({...promoteForm,newRank:e.target.value})}>{RANK_ORDER.map(r=><option key={r}>{r}</option>)}</select></Field>
            <AuthField label="Authorized By" canOverride={canOverrideAuth} authorizers={authorizers}
              value={promoteForm.authorizer} onChange={v=>setPromoteForm({...promoteForm,authorizer:v})} />
          </div>
          <ModalButtons processing={processing} onCancel={()=>setPromoteModal(null)} onConfirm={()=>act(()=>promoteEmployee({name:promoteModal.name,...promoteForm}),()=>setPromoteModal(null))} confirmLabel="Confirm Promotion"/>
        </Modal>
      )}

      {/* Rename modal */}
      {renameModal && (
        <Modal title={`Rename — ${renameModal.name}`} onClose={()=>setRenameModal(null)}>
          <div className="mb-4"><Field label="New Name"><input className="lsems-input" value={renameForm.newName} onChange={e=>setRenameForm({newName:e.target.value})} onFocus={focusRing} onBlur={blurRing}/></Field></div>
          <ModalButtons processing={processing} onCancel={()=>setRenameModal(null)} onConfirm={()=>act(()=>renameEmployee({oldName:renameModal.name,newName:renameForm.newName}),()=>setRenameModal(null))} confirmLabel="Save Name"/>
        </Modal>
      )}

      {/* Remove modal */}
      {removeModal && (
        <Modal title={`Remove — ${removeModal.name}`} subtitle="This will archive the employee. Cannot be undone." onClose={()=>setRemoveModal(null)} danger>
          <div className="mb-4">
            <AuthField label="Authorized By" canOverride={canOverrideAuth} authorizers={authorizers}
              value={removeForm.authorizer} onChange={v=>setRemoveForm({authorizer:v})} />
          </div>
          <ModalButtons processing={processing} onCancel={()=>setRemoveModal(null)} onConfirm={()=>act(()=>removeEmployee({name:removeModal.name,authorizer:removeForm.authorizer}),()=>setRemoveModal(null))} confirmLabel="Confirm Removal" danger/>
        </Modal>
      )}

      {/* LOA modal */}
      {loaModal && (
        <Modal
          title={loaModal.isOnLoa ? `Adjust LOA — ${loaModal.name}` : `Set LOA — ${loaModal.name}`}
          onClose={() => setLoaModal(null)}
          warning>
          <div className="space-y-3 mb-4">
            <Field label="Start Date"><input className="lsems-input" placeholder="DD/Mon/YYYY" value={loaForm.loaStart} onChange={e=>setLoaForm({...loaForm,loaStart:e.target.value})} onFocus={focusRing} onBlur={blurRing}/></Field>
            <Field label="Est. End Date"><input className="lsems-input" placeholder="DD/Mon/YYYY" value={loaForm.loaEnd} onChange={e=>setLoaForm({...loaForm,loaEnd:e.target.value})} onFocus={focusRing} onBlur={blurRing}/></Field>
            <Field label="Reason"><input className="lsems-input" placeholder="Optional reason" value={loaForm.loaReason} onChange={e=>setLoaForm({...loaForm,loaReason:e.target.value})} onFocus={focusRing} onBlur={blurRing}/></Field>
          </div>
          <div className="flex gap-2.5">
            <button onClick={() => setLoaModal(null)} className="btn-ghost" style={{ flex:1 }}>Cancel</button>
            {loaModal.isOnLoa && (
              <button disabled={processing} onClick={() => handleLoa(false)}
                className="py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide border transition-all disabled:opacity-50"
                style={{ flex:1, background:'linear-gradient(135deg,#059669,#047857)', borderColor:'var(--c-succ-glow)', color:'#fff', boxShadow:'0 0 20px var(--c-succ-glow)' }}>
                {processing ? 'Saving…' : 'End LOA'}
              </button>
            )}
            <button disabled={processing} onClick={() => handleLoa(true)}
              className="py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide border transition-all disabled:opacity-50"
              style={{ flex:1, background:'linear-gradient(135deg,#d97706,#b45309)', borderColor:'var(--c-warn-glow)', color:'#fff', boxShadow:'0 0 20px var(--c-warn-glow)' }}>
              {processing ? 'Saving…' : loaModal.isOnLoa ? 'Save Dates' : 'Set LOA'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Employee Profile Panel ── */}
      {profileEmp && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background:'rgba(0,0,0,0.75)' }}
          onClick={() => setProfileEmp(null)}>
          <div
            className="glass-modal w-full sm:w-[540px] sm:max-w-xl flex flex-col"
            style={{
              background:'var(--bg-card)',
              borderRadius:'16px 16px 0 0',
              border:'1px solid var(--border)',
              maxHeight:'82vh',
              borderRadius: '16px',
            }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{
              padding:'16px 20px 12px',
              borderBottom:'1px solid var(--border)',
              display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12,
            }}>
              <div>
                <div style={{fontSize:17,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>{profileEmp.name}</div>
                <div style={{fontSize:12,color:'var(--text-3)',marginTop:4,display:'flex',gap:10,flexWrap:'wrap'}}>
                  <span>{profileEmp.rank}</span>
                  <span>Hired {profileEmp.hireDate}</span>
                  {profileEmp.loaStarted && <span style={{color:'var(--c-warning)',fontWeight:600}}>On LOA</span>}
                  {profileEmp.isOnLoa && !profileEmp.loaStarted && <span style={{color:'var(--text-3)',fontWeight:600}}>LOA scheduled {profileEmp.loaStart}</span>}
                </div>
                <div style={{fontSize:11,color:'var(--text-3)',marginTop:2,display:'flex',gap:10,flexWrap:'wrap'}}>
                  <span>Total <span style={{color:'var(--c-success)',fontWeight:700,fontFamily:'monospace'}}>{profileEmp.totalHours?.toFixed(1)}</span> hrs</span>
                  <span>In rank <span style={{color:'var(--c-accent)',fontWeight:700,fontFamily:'monospace'}}>{profileEmp.hoursInRank?.toFixed(1)}</span> hrs</span>
                </div>
              </div>
              <button onClick={() => setProfileEmp(null)}
                style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text-4)',lineHeight:1,padding:'2px 4px'}}
                onMouseEnter={e=>e.currentTarget.style.color='var(--text-2)'}
                onMouseLeave={e=>e.currentTarget.style.color='var(--text-4)'}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{display:'flex',borderBottom:'1px solid var(--border)',flexShrink:0}}>
              {[['hours','Hours'],['bonuses','Bonuses'],['ranks','Rank History'],['loa','LOA']].map(([t,l]) => (
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
            <div className="overflow-y-auto custom-scrollbar" style={{flex:1, minHeight:0}}>
              {profileLoading ? (
                <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
              ) : profileData && (
                <>
                  {/* Hours tab */}
                  {profileTab==='hours' && (
                    <div>
                      {profileData.hours.length === 0 ? (
                        <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>No hours recorded.</div>
                      ) : (
                        <table style={{width:'100%',borderCollapse:'collapse'}}>
                          <thead>
                            <tr style={{background:'var(--bg-sub)',borderBottom:'1px solid var(--border)'}}>
                              <th style={{padding:'8px 20px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-3)',textAlign:'left'}}>Week Ending</th>
                              <th style={{padding:'8px 20px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-3)',textAlign:'right'}}>Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profileData.hours.map((h,i) => {
                              const isEven = i%2===0;
                              const hrs    = h.hours;
                              const req    = ['Chief','Assistant Chief','Deputy Chief','Lead Paramedic','Senior Paramedic','Paramedic','Junior Paramedic'].includes(profileEmp.rank) ? 5 : 2.5;
                              const hrsColor = h.loa
                                ? 'var(--c-warning)'
                                : !h.hasEntry
                                  ? 'var(--text-4)'
                                  : hrs >= req
                                    ? 'var(--c-success)'
                                    : hrs > 0
                                      ? 'var(--c-danger)'
                                      : 'var(--text-4)';
                              return (
                                <tr key={i} style={{
                                  borderBottom:'1px solid rgba(255,255,255,0.04)',
                                  background: h.loa ? 'rgba(251,191,36,0.05)' : isEven ? 'var(--bg-stripe)' : 'transparent',
                                }}>
                                  <td style={{padding:'7px 20px',fontSize:12,fontFamily:'monospace',display:'flex',alignItems:'center',gap:8,color:'var(--text-3)'}}>
                                    {h.week_ending}
                                    {h.loa && (
                                      <span style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',padding:'1px 6px',borderRadius:4,background:'rgba(251,191,36,0.15)',border:'1px solid rgba(251,191,36,0.35)',color:'var(--c-warning)'}}>LOA</span>
                                    )}
                                  </td>
                                  <td style={{padding:'7px 20px',fontSize:13,fontWeight:600,fontFamily:'monospace',textAlign:'right',color:hrsColor}}>
                                    {!h.hasEntry ? <span style={{opacity:0.35}}>—</span> : (hrs ?? 0).toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* Bonuses tab */}
                  {profileTab==='bonuses' && (() => {
                    const bonusList  = profileData.bonuses || [];
                    const lastPayment = bonusList.length > 0
                      ? bonusList.reduce((a, b) => (a.paid_date >= b.paid_date ? a : b))
                      : null;
                    const nextBonus = profileEmp?.hireDate ? getNextBonus(profileEmp.hireDate, lastPayment) : null;
                    return (
                      <div>
                        {/* Upcoming bonus */}
                        {nextBonus && (
                          <div style={{
                            margin:'12px 20px 0',padding:'12px 14px',borderRadius:10,
                            border:`1px solid ${nextBonus.daysUntil<=0?'var(--c-danger-glow)':nextBonus.daysUntil<=30?'var(--c-warn-glow)':'var(--border)'}`,
                            background: nextBonus.daysUntil<=0?'var(--c-danger-bg)':nextBonus.daysUntil<=30?'var(--c-warn-bg)':'var(--bg-sub)',
                            display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,
                          }}>
                            <div>
                              <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',
                                color: nextBonus.daysUntil<=0?'var(--c-danger)':nextBonus.daysUntil<=30?'var(--c-warning)':'var(--text-3)',
                                marginBottom:3}}>
                                Next Bonus{nextBonus.lastAmount ? ` — after $${(nextBonus.lastAmount/1000).toFixed(0)}k` : ' — First'}
                              </div>
                              <div style={{fontSize:12,color:'var(--text-2)'}}>
                                Due {fmtDate(nextBonus.nextDate)}
                                {nextBonus.daysUntil<=0
                                  ? <span style={{color:'var(--c-danger)',fontWeight:700,marginLeft:8}}>OVERDUE</span>
                                  : <span style={{color:'var(--text-3)',marginLeft:8}}>{nextBonus.daysUntil}d away</span>}
                              </div>
                            </div>
                            <div style={{fontSize:18,fontWeight:800,fontFamily:'monospace',color:'var(--c-success)',flexShrink:0}}>
                              {fmtCurrency(nextBonus.nextAmount)}
                            </div>
                          </div>
                        )}

                        {/* Payment history */}
                        <div style={{margin:'12px 0 0'}}>
                          <div style={{padding:'6px 20px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-3)'}}>
                            Payment History
                          </div>
                          {profileData.bonuses.length === 0 ? (
                            <div style={{padding:'20px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic',fontSize:12}}>No payments recorded yet.</div>
                          ) : (
                            <table style={{width:'100%',borderCollapse:'collapse'}}>
                              <thead>
                                <tr style={{background:'var(--bg-sub)',borderBottom:'1px solid var(--border)'}}>
                                  {['Date','Milestone','Amount'].map(h=>(
                                    <th key={h} style={{padding:'7px 20px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-3)',textAlign:h==='Amount'?'right':'left'}}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {profileData.bonuses.map((b,i) => (
                                  <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)',background:i%2===0?'var(--bg-stripe)':'transparent'}}>
                                    <td style={{padding:'8px 20px',fontSize:12,color:'var(--text-3)',fontFamily:'monospace'}}>{b.paid_date}</td>
                                    <td style={{padding:'8px 20px',fontSize:12,color:'var(--text-2)'}}>{b.months_tenure ? `${b.months_tenure}-month` : '—'}</td>
                                    <td style={{padding:'8px 20px',fontSize:13,fontWeight:700,fontFamily:'monospace',textAlign:'right',color:'var(--c-success)'}}>{fmtCurrency(b.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Rank History tab */}
                  {profileTab==='ranks' && (
                    <div style={{padding:'12px 20px',display:'flex',flexDirection:'column',gap:0}}>
                      {profileData.rankHistory.length === 0 ? (
                        <div style={{padding:'28px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>No rank history.</div>
                      ) : profileData.rankHistory.map((r,i) => {
                        const isSep  = r.new_rank === 'SEPARATED';
                        const isHire = !r.old_rank;
                        const color  = isSep ? 'var(--c-danger)' : isHire ? 'var(--c-success)' : 'var(--c-accent)';
                        const isLast = i === profileData.rankHistory.length - 1;
                        return (
                          <div key={i} style={{display:'flex',gap:12,paddingBottom: isLast?0:16,position:'relative'}}>
                            {/* Timeline line */}
                            {!isLast && (
                              <div style={{position:'absolute',left:7,top:16,bottom:0,width:1,background:'var(--border)'}} />
                            )}
                            {/* Dot */}
                            <div style={{width:15,height:15,borderRadius:'50%',background:color,flexShrink:0,marginTop:1,boxShadow:`0 0 8px ${color}60`,zIndex:1}} />
                            <div style={{flex:1,paddingBottom:4}}>
                              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                                <div>
                                  {isHire ? (
                                    <span style={{fontSize:13,fontWeight:600,color:'var(--c-success)'}}>Hired as {r.new_rank}</span>
                                  ) : isSep ? (
                                    <span style={{fontSize:13,fontWeight:600,color:'var(--c-danger)'}}>Separated from {r.old_rank}</span>
                                  ) : (
                                    <span style={{fontSize:13,fontWeight:600,color:'var(--text-1)'}}>
                                      {r.old_rank} <span style={{color:'var(--text-4)'}}>→</span> <span style={{color:'var(--c-accent)'}}>{r.new_rank}</span>
                                    </span>
                                  )}
                                  {r.authorizer && (
                                    <div style={{fontSize:11,color:'var(--text-3)',marginTop:1}}>by {r.authorizer}</div>
                                  )}
                                </div>
                                <span style={{fontSize:11,color:'var(--text-4)',fontFamily:'monospace',flexShrink:0}}>{r.event_date}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* LOA History tab */}
                  {profileTab==='loa' && (
                    <div>
                      {(!profileData.loaHistory || profileData.loaHistory.length === 0) ? (
                        <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>No LOA history recorded.</div>
                      ) : (
                        <table style={{width:'100%',borderCollapse:'collapse'}}>
                          <thead>
                            <tr style={{background:'var(--bg-sub)',borderBottom:'1px solid var(--border)'}}>
                              {['Date','Set By','Details'].map(h=>(
                                <th key={h} style={{padding:'8px 16px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-3)',textAlign:'left'}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {profileData.loaHistory.map((r,i)=>(
                              <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.04)',background:i%2===0?'var(--bg-stripe)':'transparent'}}>
                                <td style={{padding:'8px 16px',fontSize:11,color:'var(--text-4)',fontFamily:'monospace',whiteSpace:'nowrap'}}>{r.timestamp}</td>
                                <td style={{padding:'8px 16px',fontSize:12,color:'var(--c-accent)',fontWeight:600,whiteSpace:'nowrap'}}>{r.username}</td>
                                <td style={{padding:'8px 16px',fontSize:12,color:'var(--text-2)'}}>{r.details || r.action}</td>
                              </tr>
                            ))}
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

function AuthField({ label, canOverride, authorizers, value, onChange }) {
  if (!canOverride) {
    return (
      <div style={{ padding:'6px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-sub)', fontSize:11, color:'var(--text-3)' }}>
        Authorized as your character
      </div>
    );
  }
  return (
    <Field label={label}>
      <select className="lsems-input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— My character —</option>
        {authorizers.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </Field>
  );
}

function Field({ label, children }) {
  return <div><label style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)', display:'block', marginBottom:6 }}>{label}</label>{children}</div>;
}

function Modal({ title, subtitle, onClose, children, danger, warning }) {
  const borderColor = danger ? 'var(--c-danger-glow)' : warning ? 'var(--c-warn-glow)' : 'var(--border)';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.80)' }} onClick={onClose}>
      <div className="border rounded-2xl p-5 w-full max-w-md glass-modal"
        style={{ background:'var(--bg-card)', borderColor }}
        onClick={e=>e.stopPropagation()}>
        <div className="mb-4">
          <div style={{ fontSize:16, fontWeight:700, color:'var(--text-1)' }}>{title}</div>
          {subtitle && <div style={{ fontSize:12, marginTop:2, color:'var(--text-3)' }}>{subtitle}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalButtons({ processing, onCancel, onConfirm, confirmLabel, danger }) {
  return (
    <div className="flex gap-2.5">
      <button onClick={onCancel} className="btn-ghost flex-1">Cancel</button>
      <button disabled={processing} onClick={onConfirm}
        className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide border transition-all disabled:opacity-50"
        style={danger
          ? { background:'linear-gradient(135deg,#dc2626,#b91c1c)', borderColor:'var(--c-danger-glow)', color:'#fff', boxShadow:'0 0 20px var(--c-danger-glow)' }
          : { background:'linear-gradient(135deg,#c0392b,#7a0000)', borderColor:'rgba(255,150,150,0.15)', color:'#fff', boxShadow:'var(--shadow-btn),0 0 24px rgba(192,57,43,0.30)' }}>
        {processing ? 'Processing…' : confirmLabel}
      </button>
    </div>
  );
}
