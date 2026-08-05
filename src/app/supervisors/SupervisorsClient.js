"use client";
import { useState, useMemo } from 'react';
import { addSupervisor, removeSupervisor, setLOA } from '../actions';
import { fmtCurrency } from '../constants';

const T = {
  card:  { background:'var(--bg-card)', borderColor:'var(--border)' },
  sub:   { background:'var(--bg-sub)',  borderColor:'var(--border)' },
  input: { background:'var(--bg-sub)',  borderColor:'var(--border)', color:'var(--text-1)' },
  t1: { color:'var(--text-1)' }, t2: { color:'var(--text-2)' }, t3: { color:'var(--text-3)' },
};
const focusOn  = e => (e.currentTarget.style.borderColor = 'var(--c-accent)');
const focusOff = e => (e.currentTarget.style.borderColor = 'var(--border)');
const inputCls = 'w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors placeholder:opacity-40';
const labelCls = 'text-[10px] font-semibold uppercase tracking-wider mb-1.5 block';

export default function SupervisorsClient({ supervisors: initial, stats, perms = {} }) {
  const can = (key) => perms[key] !== false;
  const [supervisors, setSupervisors] = useState(initial);
  const [showAdd,     setShowAdd]     = useState(false);
  const [loaModal,    setLoaModal]    = useState(null);
  const [profileSup,  setProfileSup]  = useState(null);
  const [addForm,     setAddForm]     = useState({ name:'', rank:'' });
  const [loaForm,     setLoaForm]     = useState({ loaStart:'', loaEnd:'', loaReason:'' });
  const [processing,  setProcessing]  = useState(false);
  const [error,       setError]       = useState('');
  const [tab,         setTab]         = useState('active'); // active | loa | all

  const reload = async () => {
    const { getSupervisors } = await import('../actions');
    setSupervisors(await getSupervisors());
  };

  const act = async (fn) => {
    setProcessing(true); setError('');
    try {
      const res = await fn();
      if (!res.ok) { setError(res.error); return false; }
      await reload();
      return true;
    } catch (e) { setError(e.message); return false; }
    finally { setProcessing(false); }
  };

  const handleAdd = async () => {
    const ok = await act(() => addSupervisor(addForm));
    if (ok) { setShowAdd(false); setAddForm({ name:'', rank:'' }); }
  };

  const handleRemove = async (name) => {
    if (!confirm(`Remove ${name} from supervisors?`)) return;
    await act(() => removeSupervisor(name));
  };

  const openLoa = (sup) => {
    setLoaModal(sup);
    setLoaForm({ loaStart: sup.loa_start||'', loaEnd: sup.loa_end||'', loaReason: sup.loa_reason||'' });
  };

  const handleSetLoa = async (isOnLoa) => {
    const ok = await act(() => setLOA({ name: loaModal.name, isOnLoa, ...loaForm }));
    if (ok) setLoaModal(null);
  };

  const filtered = useMemo(() => {
    if (tab === 'active') return supervisors.filter(s => !s.is_on_loa);
    if (tab === 'loa')    return supervisors.filter(s => s.is_on_loa);
    return supervisors;
  }, [supervisors, tab]);

  const active = supervisors.filter(s => !s.is_on_loa);
  const onLoa  = supervisors.filter(s => s.is_on_loa);

  // Leaderboard from stats
  const leaderboard = useMemo(() => {
    return supervisors
      .map(s => ({ ...s, ...(stats[s.name] || { total:0, completed:0, active:0 }) }))
      .sort((a, b) => (b.completed||0) - (a.completed||0));
  }, [supervisors, stats]);

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-4">

      {/* Toolbar */}
      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color:'var(--text-3)' }}>Los Santos EMS</p>
          <h1 className="text-xl font-bold" style={{ color:'var(--text-1)' }}>Supervisors</h1>
          <p className="text-[11px] mt-0.5" style={{ color:'var(--text-3)' }}>
            {active.length} active · {onLoa.length} on LOA
          </p>
        </div>
        {can('add') && (
          <button onClick={() => setShowAdd(true)} className="sm:ml-auto px-4 py-1.5 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors whitespace-nowrap">
            + Add Supervisor
          </button>
        )}
      </div>

      {/* Task leaderboard — compact inline strip */}
      {leaderboard.some(s => s.completed > 0) && (
        <div className="border rounded-xl px-4 py-2.5 glass-sub flex flex-wrap items-center gap-x-4 gap-y-1.5" style={T.sub}>
          <span className="text-[10px] font-bold uppercase tracking-widest flex-shrink-0" style={T.t3}>Completed:</span>
          {leaderboard.filter(s => s.completed > 0).map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5 text-[12px]">
              <span className="text-[9px] font-bold" style={T.t3}>#{i+1}</span>
              <span style={T.t1}>{s.name}</span>
              <span className="font-bold font-mono" style={{ color:'var(--c-accent)' }}>{s.completed}</span>
              {s.active > 0 && <span className="text-[10px]" style={{ color:'var(--c-warning)' }}>({s.active} active)</span>}
            </span>
          ))}
        </div>
      )}

      {/* Tab filter */}
      <div className="flex gap-1.5">
        {[['active','Active'], ['loa','On LOA'], ['all','All']].map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-3 py-1.5 rounded-lg border text-[10px] font-semibold uppercase tracking-wider transition-colors"
            style={tab === t
              ? { background:'var(--c-accent-bg)', borderColor:'rgba(96,165,250,0.35)', color:'var(--c-accent)' }
              : { background:'transparent', borderColor:'var(--border)', color:'var(--text-3)' }}>
            {l}
            {t === 'loa' && onLoa.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px]" style={{ background:'var(--c-warn-bg)', color:'var(--c-warning)' }}>{onLoa.length}</span>}
          </button>
        ))}
      </div>

      <section className="border rounded-2xl overflow-hidden glass" style={T.card}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="lsems-table min-w-[600px]">
            <thead><tr>
              <th>Name</th><th>Rank</th>
              <th className="text-center">Active Tasks</th><th className="text-center">Completed</th>
              <th className="text-center">Status</th><th>LOA Period</th><th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center italic" style={{ color:'var(--text-3)' }}>No supervisors.</td></tr>
              ) : filtered.map((sup) => {
                const s = stats[sup.name] || { active:0, completed:0 };
                return (
                  <tr key={sup.name} style={sup.is_on_loa ? { background:'rgba(251,191,36,0.03)' } : {}}>
                    <td className="font-semibold" style={{ color:'var(--text-1)' }}>{sup.name}</td>
                    <td style={{ color:'var(--text-2)' }}>{sup.rank}</td>
                    <td className="text-center font-mono font-bold"
                      style={{ color: s.active >= 5 ? 'var(--c-danger)' : s.active > 0 ? 'var(--c-accent)' : 'var(--text-4)',
                               textShadow: s.active >= 5 ? '0 0 12px var(--c-danger-glow)' : s.active > 0 ? '0 0 12px var(--c-accent-glow)' : 'none' }}>
                      {s.active || '—'}
                    </td>
                    <td className="text-center font-mono font-bold stat-success">{s.completed || '—'}</td>
                    <td className="text-center">
                      {sup.is_on_loa
                        ? <span className="pill pill-warning">On LOA</span>
                        : <span className="pill pill-success">Active</span>}
                    </td>
                    <td style={{ color:'var(--text-3)', fontSize:'11px' }}>
                      {sup.is_on_loa ? `${sup.loa_start||'?'} – ${sup.loa_end||'ongoing'}${sup.loa_reason ? ` · ${sup.loa_reason}` : ''}` : '—'}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {can('loa') && (
                        <button onClick={() => openLoa(sup)} className="pill pill-warning mr-1.5 cursor-pointer hover:opacity-80 transition-opacity">
                          {sup.is_on_loa ? 'End LOA' : 'Set LOA'}
                        </button>
                      )}
                      {can('remove') && (
                        <button onClick={() => handleRemove(sup.name)} className="pill pill-danger cursor-pointer hover:opacity-80 transition-opacity">Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="text-sm px-3 py-2 rounded-lg border" style={{ background:'var(--c-danger-bg)', borderColor:'rgba(248,113,113,0.3)', color:'var(--c-danger)' }}>{error}</p>}

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.75)' }} onClick={() => setShowAdd(false)}>
          <div className="border rounded-2xl p-5 w-full max-w-sm glass-modal" style={T.card} onClick={e => e.stopPropagation()}>
            <div className="text-base font-semibold mb-4" style={T.t1}>Add Supervisor</div>
            <div className="space-y-3 mb-4">
              <div><label className={labelCls} style={T.t3}>Name</label><input className={inputCls} style={T.input} placeholder="Full name" value={addForm.name} onChange={e=>setAddForm(f=>({...f,name:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></div>
              <div><label className={labelCls} style={T.t3}>Rank</label><input className={inputCls} style={T.input} placeholder="e.g. Senior Paramedic" value={addForm.rank} onChange={e=>setAddForm(f=>({...f,rank:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></div>
            </div>
            <div className="flex gap-2.5">
              <button onClick={()=>setShowAdd(false)} className="flex-1 py-2 rounded-lg border text-[11px] font-semibold uppercase tracking-wide" style={{ background:'var(--bg-sub)', borderColor:'var(--border)', color:'var(--text-2)' }}>Cancel</button>
              <button disabled={processing} onClick={handleAdd} className="flex-1 py-2 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors disabled:opacity-50">{processing?'Saving…':'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {/* LOA modal */}
      {loaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.75)' }} onClick={()=>setLoaModal(null)}>
          <div className="border rounded-2xl p-5 w-full max-w-sm glass-modal" style={{ ...T.card, borderColor:'rgba(251,191,36,0.35)' }} onClick={e=>e.stopPropagation()}>
            <div className="text-base font-semibold mb-1" style={T.t1}>{loaModal.is_on_loa ? 'End LOA' : 'Set LOA'} — {loaModal.name}</div>
            {!loaModal.is_on_loa && (
              <div className="space-y-3 my-4">
                <div><label className={labelCls} style={T.t3}>Start Date</label><input className={inputCls} style={T.input} placeholder="DD/Mon/YYYY" value={loaForm.loaStart} onChange={e=>setLoaForm(f=>({...f,loaStart:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></div>
                <div><label className={labelCls} style={T.t3}>End Date (est.)</label><input className={inputCls} style={T.input} placeholder="DD/Mon/YYYY" value={loaForm.loaEnd} onChange={e=>setLoaForm(f=>({...f,loaEnd:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></div>
                <div><label className={labelCls} style={T.t3}>Reason</label><input className={inputCls} style={T.input} value={loaForm.loaReason} onChange={e=>setLoaForm(f=>({...f,loaReason:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></div>
              </div>
            )}
            {loaModal.is_on_loa && <p className="text-sm my-4" style={T.t2}>Mark {loaModal.name} as active and clear their LOA record.</p>}
            <div className="flex gap-2.5 mt-4">
              <button onClick={()=>setLoaModal(null)} className="flex-1 py-2 rounded-lg border text-[11px] font-semibold uppercase tracking-wide" style={{ background:'var(--bg-sub)', borderColor:'var(--border)', color:'var(--text-2)' }}>Cancel</button>
              <button disabled={processing} onClick={()=>handleSetLoa(!loaModal.is_on_loa)}
                className="flex-1 py-2 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide border transition-colors disabled:opacity-50"
                style={{ background: loaModal.is_on_loa ? 'rgb(22,163,74)' : 'rgb(202,138,4)', borderColor: loaModal.is_on_loa ? 'rgba(74,222,128,0.4)' : 'rgba(251,191,36,0.4)' }}>
                {processing ? 'Saving…' : loaModal.is_on_loa ? 'Mark Active' : 'Set LOA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
