"use client";
import { useState, useMemo } from 'react';
import { addDiscussion, deleteDiscussion, toggleDiscussionResponse } from '../actions';

const T = {
  card:  { background:'var(--bg-card)', borderColor:'var(--border)' },
  sub:   { background:'var(--bg-sub)',  borderColor:'var(--border)' },
  input: { background:'var(--bg-sub)',  borderColor:'var(--border)', color:'var(--text-1)' },
  t1: { color:'var(--text-1)' }, t2: { color:'var(--text-2)' }, t3: { color:'var(--text-3)' },
};
const focusOn  = e => (e.currentTarget.style.borderColor = 'var(--c-accent)');
const focusOff = e => (e.currentTarget.style.borderColor = 'var(--border)');
const inputCls = 'w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors placeholder:opacity-40';

export default function DiscussionsClient({ discussions: initial, supervisors, loaMap = {}, perms = {} }) {
  const can = (key) => perms[key] !== false;
  const [discussions, setDiscussions] = useState(initial);
  const [expanded,    setExpanded]    = useState(null); // discussion id with response grid open
  const [showAdd,     setShowAdd]     = useState(false);
  const [form,        setForm]        = useState({ datePosted:'', topic:'', link:'' });
  const [processing,  setProcessing]  = useState(false);
  const [error,       setError]       = useState('');
  const [pending,     setPending]     = useState(new Set());

  const allSups = useMemo(() => supervisors.map(s => s.name), [supervisors]);

  const reload = async () => {
    const { getDiscussions } = await import('../actions');
    setDiscussions(await getDiscussions());
  };

  const handleAdd = async () => {
    if (!form.topic.trim()) { setError('Topic required.'); return; }
    setProcessing(true); setError('');
    try {
      const res = await addDiscussion(form);
      if (!res.ok) { setError(res.error); }
      else { setShowAdd(false); setForm({ datePosted:'', topic:'', link:'' }); await reload(); }
    } catch (e) { setError(e.message); }
    finally { setProcessing(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this discussion?')) return;
    await deleteDiscussion(id);
    setDiscussions(d => d.filter(x => x.id !== id));
    if (expanded === id) setExpanded(null);
  };

  const handleToggle = async (discussionId, supervisorName, current) => {
    const key = `${discussionId}::${supervisorName}`;
    setPending(p => new Set([...p, key]));
    setDiscussions(prev => prev.map(d => d.id !== discussionId ? d : {
      ...d, responses: { ...d.responses, [supervisorName]: !current }
    }));
    try {
      await toggleDiscussionResponse({ discussionId, supervisorName, responded: !current });
    } catch {
      setDiscussions(prev => prev.map(d => d.id !== discussionId ? d : {
        ...d, responses: { ...d.responses, [supervisorName]: current }
      }));
    }
    setPending(p => { const n = new Set(p); n.delete(key); return n; });
  };

  const respondedCount = (d) => allSups.filter(s => d.responses?.[s]).length;
  const pendingCount   = (d) => allSups.length - respondedCount(d);
  const allResponded   = (d) => allSups.length > 0 && pendingCount(d) === 0;

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-3">

      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color:'var(--text-3)' }}>Los Santos EMS</p>
          <h1 className="text-xl font-bold" style={{ color:'var(--text-1)' }}>Discussions</h1>
          <p className="text-[11px] mt-0.5" style={{ color:'var(--text-3)' }}>
            {discussions.length} topics · {discussions.filter(d => !allResponded(d)).length} awaiting responses
          </p>
        </div>
        {can('add') && (
          <button onClick={() => setShowAdd(true)}
            className="sm:ml-auto px-4 py-1.5 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors whitespace-nowrap">
            + Add Discussion
          </button>
        )}
      </div>

      {/* Discussion list */}
      <section className="border rounded-2xl overflow-hidden glass" style={T.card}>
        {discussions.length === 0 ? (
          <div className="px-4 py-10 text-center italic text-sm" style={T.t3}>No discussions yet.</div>
        ) : discussions.map((disc, i) => {
          const open   = expanded === disc.id;
          const rCount = respondedCount(disc);
          const pCount = pendingCount(disc);
          const done   = allResponded(disc);
          const isEven = i % 2 === 0;
          return (
            <div key={disc.id}>
              {/* Summary row */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b"
                style={{ borderColor:'rgba(255,255,255,0.05)', background: isEven ? 'rgba(255,255,255,0.016)' : 'transparent' }}
                onClick={() => setExpanded(open ? null : disc.id)}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = isEven ? 'rgba(255,255,255,0.016)' : 'transparent'}>

                {/* Expand chevron */}
                <span className="text-[11px] flex-shrink-0 transition-transform" style={{ color:'var(--text-4)', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>

                {/* Date */}
                <span className="text-[11px] font-mono flex-shrink-0 w-20" style={T.t3}>{disc.date_posted}</span>

                {/* Topic */}
                <span className="text-sm font-semibold flex-1 truncate" style={T.t1}>{disc.topic}</span>

                {/* Response badge */}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0"
                  style={done
                    ? { color:'var(--c-success)', background:'var(--c-succ-bg)', borderColor:'rgba(74,222,128,0.3)' }
                    : { color:'var(--c-warning)', background:'var(--c-warn-bg)', borderColor:'rgba(251,191,36,0.3)' }}>
                  {done ? `✓ ${rCount}/${allSups.length}` : `${rCount}/${allSups.length}`}
                </span>

                {/* Link */}
                {disc.link && (
                  <a href={disc.link} target="_blank" rel="noreferrer"
                    className="text-[11px] px-2.5 py-1 rounded-lg border transition-colors flex-shrink-0"
                    style={{ color:'var(--c-accent)', background:'var(--c-accent-bg)', borderColor:'rgba(96,165,250,0.3)' }}
                    onClick={e => e.stopPropagation()}>
                    Forum ↗
                  </a>
                )}

                {/* Delete */}
                {can('delete') && (
                  <button onClick={e => { e.stopPropagation(); handleDelete(disc.id); }}
                    className="text-[10px] px-2 py-1 rounded-md border transition-colors flex-shrink-0"
                    style={{ color:'var(--c-danger)', background:'var(--c-danger-bg)', borderColor:'rgba(248,113,113,0.3)' }}>
                    ✕
                  </button>
                )}
              </div>

              {/* Expanded supervisor grid */}
              {open && (
                <div className="px-4 py-3 border-b" style={{ borderColor:'rgba(255,255,255,0.05)', background:'rgba(0,0,0,0.15)' }}>
                  {allSups.length === 0 ? (
                    <p className="text-[11px] italic" style={T.t3}>No supervisors configured.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                      {allSups.map(sup => {
                        const key       = `${disc.id}::${sup}`;
                        const responded = disc.responses?.[sup] ?? false;
                        const loading   = pending.has(key);
                        const loa       = loaMap[sup];
                        return (
                          <label key={sup}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors select-none"
                            style={{
                              background:  loa?.isOnLoa ? 'rgba(251,191,36,0.06)' : responded ? 'rgba(52,211,153,0.08)' : 'var(--bg-sub)',
                              borderColor: loa?.isOnLoa ? 'rgba(251,191,36,0.30)' : responded ? 'rgba(52,211,153,0.30)' : 'var(--border)',
                              opacity:     loading ? 0.5 : 1,
                            }}>
                            <input type="checkbox" checked={responded} disabled={loading || !can('respond')}
                              onChange={() => can('respond') && handleToggle(disc.id, sup, responded)}
                              className="w-3.5 h-3.5 accent-green-500 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-semibold truncate"
                                style={{ color: loa?.isOnLoa ? 'var(--c-warning)' : responded ? 'var(--c-success)' : 'var(--text-2)' }}>
                                {sup}
                              </div>
                              {loa?.isOnLoa && (
                                <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color:'var(--c-warning)', opacity:0.8 }}>
                                  LOA{loa.loaEnd ? ` until ${loa.loaEnd}` : ''}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {error && <p className="text-sm px-3 py-2 rounded-lg border" style={{ background:'var(--c-danger-bg)', borderColor:'rgba(248,113,113,0.3)', color:'var(--c-danger)' }}>{error}</p>}

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.75)' }} onClick={() => setShowAdd(false)}>
          <div className="border rounded-2xl p-5 w-full max-w-md glass-modal" style={T.card} onClick={e => e.stopPropagation()}>
            <div className="text-base font-semibold mb-4" style={T.t1}>Add Discussion</div>
            <div className="space-y-3 mb-4">
              <div><label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 block" style={T.t3}>Topic</label><input className={inputCls} style={T.input} placeholder="e.g. Bryan Trey Reinstatement" value={form.topic} onChange={e=>setForm(f=>({...f,topic:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 block" style={T.t3}>Date Posted</label><input className={inputCls} style={T.input} placeholder="DD/Mon/YYYY" value={form.datePosted} onChange={e=>setForm(f=>({...f,datePosted:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 block" style={T.t3}>Forum Link (optional)</label><input className={inputCls} style={T.input} placeholder="https://…" value={form.link} onChange={e=>setForm(f=>({...f,link:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></div>
            </div>
            <div className="flex gap-2.5">
              <button onClick={() => setShowAdd(false)} className="flex-1 py-2 rounded-lg border text-[11px] font-semibold uppercase tracking-wide" style={{ background:'var(--bg-sub)', borderColor:'var(--border)', color:'var(--text-2)' }}>Cancel</button>
              <button disabled={processing} onClick={handleAdd} className="flex-1 py-2 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors disabled:opacity-50">{processing?'Saving…':'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
