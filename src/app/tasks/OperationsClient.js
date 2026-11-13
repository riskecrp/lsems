"use client";
import { useState, useMemo, useCallback } from 'react';
import { addSupTask, updateSupTask, deleteSupTask, addDiscussion, deleteDiscussion, toggleDiscussionResponse, archiveDiscussion, unarchiveDiscussion, getArchivedDiscussions } from '../actions';

// ── Shared helpers ────────────────────────────────────────────
const fr = e => { e.currentTarget.style.borderColor='var(--c-accent)'; e.currentTarget.style.boxShadow='0 0 0 3px var(--c-accent-glow)'; };
const fb = e => { e.currentTarget.style.borderColor='var(--border)';   e.currentTarget.style.boxShadow='none'; };

const STATUSES    = ['Assigned','In Progress','Completed'];
const STATUS_NEXT = { 'Assigned':'In Progress','In Progress':'Completed','Completed':'Assigned' };

function statusStyle(s) {
  if (s==='Completed')   return { color:'var(--c-success)',bg:'var(--c-succ-bg)',  border:'var(--c-succ-glow)'  };
  if (s==='In Progress') return { color:'var(--c-warning)',bg:'var(--c-warn-bg)',  border:'var(--c-warn-glow)'  };
  return                        { color:'var(--c-accent)', bg:'var(--c-accent-bg)',border:'var(--c-accent-glow)' };
}
function isOverdue(t) {
  return t.status !== 'Completed' && !!t.due_date && new Date(t.due_date) < new Date();
}
const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function today() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${_MONTHS[d.getMonth()]}/${d.getFullYear()}`;
}
function daysUntilDate(str) {
  const m = String(str||'').trim().match(/^(\d{1,2})[\/\-.\s]([A-Za-z]+)[\/\-.\s](\d{4})$/);
  if (!m) return null;
  const idx = _MONTHS.findIndex(x => x.toLowerCase() === m[2].slice(0,3).toLowerCase());
  if (idx < 0) return null;
  const d = new Date(+m[3], idx, +m[1]);
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.round((d - now) / 86400000);
}
function Fl({ label, children }) {
  return <div><label style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-3)',display:'block',marginBottom:6}}>{label}</label>{children}</div>;
}
function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.80)'}} onClick={onClose}>
      <div className="surface p-5 w-full max-w-lg glass-modal" style={{borderRadius:16}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:15,fontWeight:700,color:'var(--text-1)',marginBottom:4}}>{title}</div>
        {subtitle && <div style={{fontSize:11,color:'var(--text-3)',marginBottom:14}}>{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}
function Btns({ processing, onCancel, onConfirm, label }) {
  return (
    <div style={{display:'flex',gap:10,marginTop:16}}>
      <button onClick={onCancel} className="btn-ghost" style={{flex:1,textAlign:'center'}}>Cancel</button>
      <button disabled={processing} onClick={onConfirm} className="btn-primary" style={{flex:1,textAlign:'center',justifyContent:'center'}}>
        {processing?'Saving…':label}
      </button>
    </div>
  );
}

function NameChips({ label, names, tone }) {
  if (!names?.length) return null;
  const c = {
    danger:  { color:'var(--c-danger)',  bg:'var(--c-danger-bg)',   border:'var(--c-danger-glow)' },
    warning: { color:'var(--c-warning)', bg:'var(--c-warn-bg)',     border:'var(--c-warn-glow)'   },
    success: { color:'var(--c-success)', bg:'var(--c-succ-bg)',     border:'var(--c-succ-glow)'   },
  }[tone];
  return (
    <div>
      <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:c.color,marginBottom:6}}>{label} ({names.length})</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
        {names.map(n => (
          <span key={n} style={{padding:'4px 9px',borderRadius:7,border:`1px solid ${c.border}`,background:c.bg,color:c.color,fontSize:11,fontWeight:600}}>{n}</span>
        ))}
      </div>
    </div>
  );
}
function ConfirmModal({ box, busy, onClose }) {
  return (
    <Modal title={box.title} subtitle={box.subtitle} onClose={busy?()=>{}:onClose}>
      {box.body && <div style={{display:'flex',flexDirection:'column',gap:12,fontSize:12,color:'var(--text-2)',lineHeight:1.5}}>{box.body}</div>}
      <div style={{display:'flex',gap:10,marginTop:18}}>
        <button onClick={onClose} disabled={busy} className="btn-ghost" style={{flex:1,textAlign:'center'}}>Cancel</button>
        <button onClick={box.onConfirm} disabled={busy} className="btn-primary"
          style={{flex:1,textAlign:'center',justifyContent:'center',
            ...(box.danger ? {background:'var(--c-danger-bg)',color:'var(--c-danger)',border:'1px solid var(--c-danger-glow)',boxShadow:'0 0 10px var(--c-danger-glow)'} : {})}}>
          {busy ? 'Working…' : box.label}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
export default function OperationsClient({ tasks:initial, supervisors, assignees=[], stats, discussions:initDisc, loaMap={}, taskPerms={}, discPerms={} }) {
  const canTask = (key) => taskPerms[key] !== false;
  const canDisc = (key) => discPerms[key] !== false;
  const [tab, setTab] = useState('tasks');

  // ── Tasks state ─────────────────────────────────────────────
  const [tasks,        setTasks]       = useState(initial);
  const [search,       setSearch]      = useState('');
  const [statusFilter, setStFilter]    = useState('Active');
  const [ownerFilter,  setOwnerFilter] = useState('All');
  const [showAddTask,  setShowAddTask] = useState(false);
  const [editTask,     setEditTask]    = useState(null);
  const [expandNotes,  setExpandNotes] = useState(null);
  const [addForm,      setAddForm]     = useState({taskName:'',owner:'',assignedDate:'',dueDate:'',notes:''});
  const [editForm,     setEditForm]    = useState({});
  const [taskErr,      setTaskErr]     = useState('');
  const [taskProc,     setTaskProc]    = useState(false);

  // ── Discussions state ────────────────────────────────────────
  const [discussions, setDiscussions] = useState(initDisc);
  const [expanded,    setExpanded]    = useState(null);
  const [showAddDisc, setShowAddDisc] = useState(false);
  const [discForm,    setDiscForm]    = useState({datePosted:'',topic:'',link:''});
  const [discErr,     setDiscErr]     = useState('');
  const [discProc,    setDiscProc]    = useState(false);
  const [pending,     setPending]     = useState(new Set());
  const [discView,    setDiscView]    = useState('active');   // 'active' | 'archived'
  const [archived,    setArchived]    = useState(null);       // null = not loaded yet
  const [archExpanded,setArchExpanded]= useState(null);
  const [archBusy,    setArchBusy]    = useState(null);       // discussion id being (un)archived
  const [confirmBox,  setConfirmBox]  = useState(null);       // themed confirm dialog

  // ── Derived ──────────────────────────────────────────────────
  const activeSups      = useMemo(() => supervisors.filter(s=>!s.is_on_loa), [supervisors]);
  const activeAssignees = useMemo(() => assignees.filter(a=>!a.isOnLoa), [assignees]);
  const owners     = useMemo(() => ['All',...new Set(tasks.map(t=>t.owner).filter(Boolean))].sort(), [tasks]);
  const allSups    = useMemo(() => supervisors.map(s=>s.name), [supervisors]);

  const filtered = useMemo(() => tasks.filter(t => {
    if (statusFilter==='Active' && t.status==='Completed') return false;
    if (statusFilter!=='Active' && statusFilter!=='All' && t.status!==statusFilter) return false;
    if (ownerFilter!=='All' && t.owner!==ownerFilter) return false;
    if (search && !t.task_name.toLowerCase().includes(search.toLowerCase()) && !(t.owner||'').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [tasks, statusFilter, ownerFilter, search]);

  const counts = useMemo(() => ({
    active:     tasks.filter(t=>t.status!=='Completed').length,
    assigned:   tasks.filter(t=>t.status==='Assigned').length,
    inProgress: tasks.filter(t=>t.status==='In Progress').length,
    overdue:    tasks.filter(t=>isOverdue(t)).length,
  }), [tasks]);

  const discAwait    = useMemo(() => discussions.filter(d => allSups.some(s => !d.responses?.[s])).length, [discussions, allSups]);
  const respondedCnt = d => allSups.filter(s=>d.responses?.[s]).length;
  const allResponded = d => allSups.length>0 && respondedCnt(d)===allSups.length;

  // ── Task actions ─────────────────────────────────────────────
  const reloadTasks = useCallback(async () => {
    const {getSupTasks} = await import('../actions');
    setTasks(await getSupTasks(false));
  }, []);

  const taskAct = async fn => {
    setTaskProc(true); setTaskErr('');
    try {
      const r = await fn();
      if (!r.ok) { setTaskErr(r.error); return false; }
      await reloadTasks(); return true;
    } catch(e) { setTaskErr(e.message); return false; }
    finally { setTaskProc(false); }
  };

  const cycleStatus = async task => {
    const ns = STATUS_NEXT[task.status];
    const cd = ns==='Completed' ? today() : '';
    setTasks(p=>p.map(t=>t.id===task.id?{...t,status:ns,completed_date:cd||t.completed_date}:t));
    const r = await updateSupTask({id:task.id,status:ns,owner:task.owner,completedDate:cd,notes:task.notes});
    if (!r.ok) { setTaskErr(r.error); await reloadTasks(); }
  };

  const reassign = async (task, newOwner) => {
    setTasks(p=>p.map(t=>t.id===task.id?{...t,owner:newOwner}:t));
    const r = await updateSupTask({id:task.id,status:task.status,owner:newOwner,completedDate:task.completed_date,notes:task.notes});
    if (!r.ok) { setTaskErr(r.error); await reloadTasks(); }
  };

  const handleAddTask = async () => {
    const ok = await taskAct(()=>addSupTask(addForm));
    if (ok) { setShowAddTask(false); setAddForm({taskName:'',owner:'',assignedDate:'',dueDate:'',notes:''}); }
  };
  const handleEditTask = async () => {
    const ok = await taskAct(()=>updateSupTask({id:editTask.id,...editForm}));
    if (ok) setEditTask(null);
  };
  const handleDeleteTask = async id => {
    if (!confirm('Delete this task?')) return;
    taskAct(()=>deleteSupTask(id));
  };

  // ── Discussion actions ────────────────────────────────────────
  const reloadDisc = async () => {
    const {getDiscussions} = await import('../actions');
    setDiscussions(await getDiscussions());
  };

  const handleAddDisc = async () => {
    if (!discForm.topic.trim()) { setDiscErr('Topic required.'); return; }
    setDiscProc(true); setDiscErr('');
    try {
      const r = await addDiscussion(discForm);
      if (!r.ok) { setDiscErr(r.error); }
      else { setShowAddDisc(false); setDiscForm({datePosted:'',topic:'',link:''}); await reloadDisc(); }
    } catch(e) { setDiscErr(e.message); }
    finally { setDiscProc(false); }
  };

  const handleDeleteDisc = disc => setConfirmBox({
    title:'Delete Discussion', subtitle:disc.topic, label:'Delete', danger:true,
    body:<div>This permanently deletes the discussion and every response recorded for it. To keep a record of who responded, use <b style={{color:'var(--text-1)'}}>Archive</b> instead.</div>,
    onConfirm: async () => {
      setArchBusy(disc.id); setDiscErr('');
      try {
        const r = await deleteDiscussion(disc.id);
        if (r?.ok===false) { setDiscErr(r.error); return; }
        setDiscussions(d=>d.filter(x=>x.id!==disc.id));
        if (expanded===disc.id) setExpanded(null);
      } catch(e) { setDiscErr(e.message); }
      finally { setArchBusy(null); setConfirmBox(null); }
    },
  });

  const reloadArchived = async () => setArchived(await getArchivedDiscussions());

  const showDiscView = v => {
    setDiscView(v); setDiscErr('');
    if (v==='archived' && archived===null) reloadArchived();
  };

  const handleArchiveDisc = async disc => {
    const missing = allSups.filter(s=>!disc.responses?.[s]);
    const onLoa   = missing.filter(s=>loaMap[s]?.isOnLoa);
    const noResp  = missing.filter(s=>!loaMap[s]?.isOnLoa);
    setConfirmBox({
      title:'Archive Discussion', subtitle:disc.topic, label:'Archive',
      body:<>
        {noResp.length===0 && onLoa.length===0
          ? <div style={{color:'var(--c-success)',fontWeight:600}}>✓ Everyone has responded.</div>
          : <div>Supervisors who haven&apos;t been checked off will be recorded as follows:</div>}
        <NameChips label="No response" names={noResp} tone="danger"/>
        <NameChips label="Excused (on LOA)" names={onLoa} tone="warning"/>
        <div style={{fontSize:11,color:'var(--text-3)'}}>The discussion moves to the Archived view. You can unarchive it later.</div>
      </>,
      onConfirm: async () => {
        setArchBusy(disc.id); setDiscErr('');
        try {
          const r = await archiveDiscussion(disc.id);
          if (!r.ok) { setDiscErr(r.error); return; }
          if (expanded===disc.id) setExpanded(null);
          await reloadDisc();
          if (archived!==null) await reloadArchived();
        } catch(e) { setDiscErr(e.message); }
        finally { setArchBusy(null); setConfirmBox(null); }
      },
    });
  };

  const handleUnarchiveDisc = disc => setConfirmBox({
    title:'Unarchive Discussion', subtitle:disc.topic, label:'Unarchive',
    body:<>
      <div>This moves the discussion back to the active list. These supervisors go back to <b style={{color:'var(--text-1)'}}>pending</b>:</div>
      <NameChips label="No response" names={disc.noResponse} tone="danger"/>
      <NameChips label="Excused (LOA)" names={disc.excused} tone="warning"/>
    </>,
    onConfirm: async () => {
      setArchBusy(disc.id); setDiscErr('');
      try {
        const r = await unarchiveDiscussion(disc.id);
        if (!r.ok) { setDiscErr(r.error); return; }
        await Promise.all([reloadDisc(), reloadArchived()]);
      } catch(e) { setDiscErr(e.message); }
      finally { setArchBusy(null); setConfirmBox(null); }
    },
  });

  const handleDeleteArchived = disc => setConfirmBox({
    title:'Delete Archived Discussion', subtitle:disc.topic, label:'Delete', danger:true,
    body:<div>This permanently deletes the discussion and its record of who responded. It can&apos;t be undone.</div>,
    onConfirm: async () => {
      setArchBusy(disc.id); setDiscErr('');
      try {
        const r = await deleteDiscussion(disc.id);
        if (r?.ok===false) { setDiscErr(r.error); return; }
        setArchived(a=>a.filter(x=>x.id!==disc.id));
      } catch(e) { setDiscErr(e.message); }
      finally { setArchBusy(null); setConfirmBox(null); }
    },
  });

  const handleToggle = async (discussionId, supervisorName, current) => {
    const key = `${discussionId}::${supervisorName}`;
    setPending(p=>new Set([...p,key]));
    setDiscussions(prev=>prev.map(d=>d.id!==discussionId?d:{...d,responses:{...d.responses,[supervisorName]:!current}}));
    try { await toggleDiscussionResponse({discussionId,supervisorName,responded:!current}); }
    catch { setDiscussions(prev=>prev.map(d=>d.id!==discussionId?d:{...d,responses:{...d.responses,[supervisorName]:current}})); }
    setPending(p=>{const n=new Set(p);n.delete(key);return n;});
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">

      {/* Title row */}
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div>
          <h1 style={{fontSize:18,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>Operations</h1>
          <p style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>
            <span className="stat-accent" style={{fontWeight:700}}>{counts.active}</span> active tasks
            {counts.overdue>0 && <span> · <span style={{color:'var(--c-danger)',fontWeight:600}}>{counts.overdue} overdue</span></span>}
            {discAwait>0 && <span> · <span style={{color:'var(--c-warning)',fontWeight:600}}>{discAwait} pending discussions</span></span>}
          </p>
        </div>
        {stats && Object.entries(stats).filter(([name,s])=>s.completed>0&&supervisors.some(sv=>sv.name===name)&&!supervisors.find(sv=>sv.name===name)?.is_on_loa).length>0 && (
          <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-4)'}}>Done:</span>
            {Object.entries(stats)
              .filter(([name,s])=>s.completed>0&&supervisors.some(sv=>sv.name===name)&&!supervisors.find(sv=>sv.name===name)?.is_on_loa)
              .sort(([,a],[,b])=>b.completed-a.completed)
              .map(([name,s])=>(
                <span key={name} style={{fontSize:11}}>
                  <span style={{color:'var(--text-2)'}}>{name.split(' ')[0]}</span>
                  <span style={{color:'var(--c-accent)',fontWeight:700,marginLeft:3}}>{s.completed}</span>
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Tab + controls row */}
      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        <div style={{display:'flex',gap:3,padding:'3px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-sub)'}}>
          {[['tasks','Tasks'],['discussions','Discussions']].map(([t,l]) => (
            <button key={t} onClick={()=>setTab(t)}
              style={{
                padding:'4px 12px',borderRadius:6,border:'none',cursor:'pointer',
                fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',
                background:tab===t?'var(--c-accent-bg)':'transparent',
                color:tab===t?'var(--c-accent)':'var(--text-3)',
                transition:'all 0.12s',
              }}>
              {l}
            </button>
          ))}
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          {tab==='tasks' && (
            <>
              <input placeholder="Search tasks…" className="lsems-input" style={{width:152}}
                value={search} onChange={e=>setSearch(e.target.value)} onFocus={fr} onBlur={fb}/>
              {canTask('add') && <button className="btn-primary" onClick={()=>setShowAddTask(true)}>+ Task</button>}
            </>
          )}
          {tab==='discussions' && (
            <div style={{display:'flex',gap:3,padding:'3px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-sub)'}}>
              {[['active','Active'],['archived','Archived']].map(([v,l]) => (
                <button key={v} onClick={()=>showDiscView(v)}
                  style={{
                    padding:'4px 10px',borderRadius:6,border:'none',cursor:'pointer',
                    fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.07em',
                    background:discView===v?'var(--c-accent-bg)':'transparent',
                    color:discView===v?'var(--c-accent)':'var(--text-3)',
                  }}>
                  {l}
                </button>
              ))}
            </div>
          )}
          {tab==='discussions' && discView==='active' && canDisc('add') && (
            <button className="btn-primary" onClick={()=>setShowAddDisc(true)}>+ Discussion</button>
          )}
        </div>
      </div>

      {/* ── TASKS TAB ─────────────────────────────────────────── */}
      {tab==='tasks' && (
        <>
          {/* Filter row */}
          <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
            <div style={{display:'flex',gap:4}}>
              {['Active','All','Assigned','In Progress','Completed'].map(s=>{
                const ss = s==='Active'||s==='All' ? null : statusStyle(s);
                const on = statusFilter===s;
                return (
                  <button key={s} onClick={()=>setStFilter(s)}
                    style={{
                      padding:'4px 10px', borderRadius:6, border:'1px solid',
                      fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em',
                      cursor:'pointer', transition:'all 0.12s',
                      background: on ? (ss?ss.bg:'var(--c-accent-bg)') : 'transparent',
                      color:      on ? (ss?ss.color:'var(--c-accent)') : 'var(--text-3)',
                      borderColor:on ? (ss?ss.border:'var(--c-accent-glow)') : 'var(--border)',
                    }}>
                    {s}
                  </button>
                );
              })}
            </div>
            <select className="lsems-input" style={{width:'auto',padding:'4px 8px',fontSize:11}}
              value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value)}>
              {owners.map(o=><option key={o}>{o}</option>)}
            </select>
          </div>

          <div className="surface" style={{overflow:'hidden'}}>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="lsems-table" style={{minWidth:680}}>
                <thead><tr>
                  <th>Task</th>
                  <th style={{width:160}}>Owner</th>
                  <th className="text-center" style={{width:120}}>Status</th>
                  <th style={{width:110}}>Start</th>
                  <th style={{width:100}}>Due</th>
                  <th className="text-right" style={{width:100}}>Actions</th>
                </tr></thead>
                <tbody>
                  {filtered.length===0 ? (
                    <tr><td colSpan={6} style={{padding:'40px 16px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>No tasks found.</td></tr>
                  ) : filtered.map(task => {
                    const od  = isOverdue(task);
                    const ss  = statusStyle(task.status);
                    const sn  = expandNotes===task.id;
                    return [
                      <tr key={task.id} style={od?{background:'rgba(248,113,113,0.04)'}:{}}>
                        <td>
                          <div style={{fontWeight:600,color:'var(--text-1)',fontSize:13}}>{task.task_name}</div>
                          {task.notes && (
                            <button style={{fontSize:10,color:'var(--c-accent)',marginTop:2,background:'none',border:'none',cursor:'pointer',padding:0}}
                              onClick={()=>setExpandNotes(sn?null:task.id)}>
                              {sn?'▲ hide':'▼ notes'}
                            </button>
                          )}
                        </td>
                        <td>
                          <select className="lsems-input" style={{padding:'3px 6px',fontSize:11,width:'100%'}}
                            value={task.owner||''} onChange={e=>reassign(task,e.target.value||null)}>
                            <option value="">— Unassigned —</option>
                            {activeAssignees.map(a=>{const c=stats[a.name]?.completed||0;return<option key={a.name} value={a.name}>{a.name}{c>0?` (${c}✓)`:''}</option>;})}
                            {assignees.filter(a=>a.isOnLoa).map(a=><option key={a.name} value={a.name}>{a.name} — LOA</option>)}
                          </select>
                        </td>
                        <td style={{textAlign:'center'}}>
                          <select
                            value={task.status}
                            onChange={e=>{
                              const ns=e.target.value;
                              const cd=ns==='Completed'?today():'';
                              setTasks(p=>p.map(t=>t.id===task.id?{...t,status:ns,completed_date:cd||t.completed_date}:t));
                              updateSupTask({id:task.id,status:ns,owner:task.owner,completedDate:cd,notes:task.notes})
                                .then(r=>{if(!r.ok){setTaskErr(r.error);reloadTasks();}});
                            }}
                            style={{
                              padding:'3px 8px',borderRadius:999,border:`1px solid ${ss.border}`,
                              background:ss.bg,color:ss.color,fontSize:10,fontWeight:700,
                              letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer',
                              outline:'none',boxShadow:`0 0 8px ${ss.border}`,
                              WebkitAppearance:'none',appearance:'none',textAlign:'center',
                            }}>
                            {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                          {od && <div style={{fontSize:9,fontWeight:700,color:'var(--c-danger)',marginTop:2,textShadow:'0 0 8px var(--c-danger-glow)'}}>OVERDUE</div>}
                        </td>
                        <td style={{fontSize:12,whiteSpace:'nowrap'}}>
                          {(() => {
                            const held = !task.announced_at && task.status!=='Completed';
                            const du   = daysUntilDate(task.assigned_date);
                            return (<>
                              <div style={{color: held ? 'var(--c-accent)' : 'var(--text-3)'}}>{task.assigned_date||'—'}</div>
                              {held && (
                                <div title="Discord is notified at 00:00 UTC on the start date" style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'var(--c-accent)',marginTop:2}}>
                                  {du!=null && du>0 ? `Starts in ${du}d` : 'Starting'}
                                </div>
                              )}
                            </>);
                          })()}
                        </td>
                        <td style={{fontSize:12,color:od?'var(--c-danger)':'var(--text-2)'}}>{task.due_date||'—'}</td>
                        <td style={{textAlign:'right',whiteSpace:'nowrap'}}>
                          {canTask('edit') && <button className="pill pill-accent" style={{cursor:'pointer',marginRight:4}} onClick={()=>{setEditTask(task);setEditForm({status:task.status,owner:task.owner||'',completedDate:task.completed_date||'',notes:task.notes||'',startDate:task.assigned_date||''});}}>Edit</button>}
                          {canTask('delete') && <button className="pill pill-danger" style={{cursor:'pointer'}} onClick={()=>handleDeleteTask(task.id)}>Del</button>}
                        </td>
                      </tr>,
                      sn && task.notes && (
                        <tr key={`${task.id}-n`} style={{background:'rgba(128,0,0,0.04)'}}>
                          <td colSpan={6} style={{padding:'8px 20px',fontSize:12,color:'var(--text-2)',lineHeight:1.5}}>{task.notes}</td>
                        </tr>
                      )
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {taskErr && <div style={{padding:'10px 14px',borderRadius:10,border:'1px solid var(--c-danger-glow)',background:'var(--c-danger-bg)',color:'var(--c-danger)',fontSize:13}}>{taskErr}</div>}
        </>
      )}

      {/* ── DISCUSSIONS TAB ───────────────────────────────────── */}
      {tab==='discussions' && discView==='active' && (
        <>
          <div className="surface" style={{overflow:'hidden'}}>
            {discussions.length===0 ? (
              <div style={{padding:'40px 16px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>No discussions yet.</div>
            ) : discussions.map((disc,i) => {
              const open  = expanded===disc.id;
              const rc    = respondedCnt(disc);
              const done  = allResponded(disc);
              return (
                <div key={disc.id}>
                  <div
                    style={{
                      display:'flex',alignItems:'center',gap:10,padding:'10px 16px',
                      cursor:'pointer',borderBottom:'1px solid var(--border)',
                      background: i%2===0 ? 'var(--bg-stripe)' : 'transparent',
                      transition:'background 0.12s',
                    }}
                    onClick={()=>setExpanded(open?null:disc.id)}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'var(--bg-stripe)':'transparent'}>

                    <span style={{fontSize:11,color:'var(--text-4)',flexShrink:0,transition:'transform 0.15s',transform:open?'rotate(90deg)':'none'}}>▶</span>
                    <span style={{fontSize:11,fontFamily:'monospace',color:'var(--text-3)',flexShrink:0,width:80}}>{disc.date_posted}</span>
                    <span style={{fontSize:13,fontWeight:600,color:'var(--text-1)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{disc.topic}</span>

                    <span className={done?'pill pill-success':'pill pill-warning'}>
                      {done ? `✓ ${rc}/${allSups.length}` : `${rc}/${allSups.length}`}
                    </span>

                    {/^https?:\/\//i.test(disc.link || '') && (
                      <a href={disc.link} target="_blank" rel="noreferrer"
                        className="pill pill-accent" style={{cursor:'pointer',textDecoration:'none'}}
                        onClick={e=>e.stopPropagation()}>
                        Forum ↗
                      </a>
                    )}
                    {canDisc('archive') && (
                      <button className="pill pill-accent" style={{cursor:'pointer',opacity:archBusy===disc.id?0.5:1}}
                        disabled={archBusy===disc.id} title="Archive this discussion"
                        onClick={e=>{e.stopPropagation();handleArchiveDisc(disc);}}>
                        {archBusy===disc.id?'…':'Archive'}
                      </button>
                    )}
                    {canDisc('delete') && (
                      <button className="pill pill-danger" style={{cursor:'pointer'}}
                        onClick={e=>{e.stopPropagation();handleDeleteDisc(disc);}}>✕</button>
                    )}
                  </div>

                  {open && (
                    <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',background:'rgba(0,0,0,0.18)'}}>
                      {allSups.length===0 ? (
                        <p style={{fontSize:11,color:'var(--text-3)',fontStyle:'italic'}}>No supervisors configured.</p>
                      ) : (
                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:6}}>
                          {allSups.map(sup => {
                            const key   = `${disc.id}::${sup}`;
                            const resp  = disc.responses?.[sup]??false;
                            const load  = pending.has(key);
                            const loa   = loaMap[sup];
                            return (
                              <label key={sup} style={{
                                display:'flex',alignItems:'center',gap:7,
                                padding:'7px 10px',borderRadius:8,cursor:'pointer',
                                border:`1px solid ${loa?.isOnLoa?'rgba(251,191,36,0.28)':resp?'var(--c-succ-glow)':'var(--border)'}`,
                                background: loa?.isOnLoa?'rgba(251,191,36,0.05)':resp?'rgba(52,211,153,0.07)':'var(--bg-sub)',
                                opacity: load?0.5:1, transition:'all 0.12s', userSelect:'none',
                              }}>
                                <input type="checkbox" checked={resp} disabled={load || !canDisc('respond')}
                                  onChange={()=>canDisc('respond') && handleToggle(disc.id,sup,resp)}
                                  style={{width:13,height:13,accentColor:'var(--c-success)',flexShrink:0}}/>
                                <div style={{minWidth:0,flex:1}}>
                                  <div style={{fontSize:11,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                                    color:loa?.isOnLoa?'var(--c-warning)':resp?'var(--c-success)':'var(--text-2)'}}>
                                    {sup}
                                  </div>
                                  {loa?.isOnLoa && (
                                    <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'var(--c-warning)',opacity:0.75}}>
                                      LOA{loa.loaEnd?` · ${loa.loaEnd}`:''}
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
          </div>
          {discErr && <div style={{padding:'10px 14px',borderRadius:10,border:'1px solid var(--c-danger-glow)',background:'var(--c-danger-bg)',color:'var(--c-danger)',fontSize:13}}>{discErr}</div>}
        </>
      )}

      {/* ── ARCHIVED DISCUSSIONS ───────────────────────────────── */}
      {tab==='discussions' && discView==='archived' && (
        <>
          <div className="surface" style={{overflow:'hidden'}}>
            {archived===null ? (
              <div style={{padding:'40px 16px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>Loading…</div>
            ) : archived.length===0 ? (
              <div style={{padding:'40px 16px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic'}}>No archived discussions.</div>
            ) : archived.map((disc,i) => {
              const open = archExpanded===disc.id;
              const groups = [
                ['Responded',   disc.responded,  'var(--c-success)', 'rgba(52,211,153,0.07)', 'var(--c-succ-glow)'],
                ['No response', disc.noResponse, 'var(--c-danger)',  'var(--c-danger-bg)',    'var(--c-danger-glow)'],
                ['Excused (LOA)', disc.excused,  'var(--c-warning)', 'rgba(251,191,36,0.05)', 'rgba(251,191,36,0.28)'],
              ];
              return (
                <div key={disc.id}>
                  <div
                    style={{
                      display:'flex',alignItems:'center',gap:10,padding:'10px 16px',
                      cursor:'pointer',borderBottom:'1px solid var(--border)',
                      background: i%2===0 ? 'var(--bg-stripe)' : 'transparent',
                    }}
                    onClick={()=>setArchExpanded(open?null:disc.id)}>
                    <span style={{fontSize:11,color:'var(--text-4)',flexShrink:0,transition:'transform 0.15s',transform:open?'rotate(90deg)':'none'}}>▶</span>
                    <span style={{fontSize:11,fontFamily:'monospace',color:'var(--text-3)',flexShrink:0,width:80}}>{disc.date_posted}</span>
                    <span style={{fontSize:13,fontWeight:600,color:'var(--text-1)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{disc.topic}</span>
                    <span className="pill pill-success">✓ {disc.responded.length}</span>
                    {disc.noResponse.length>0 && <span className="pill pill-danger">✗ {disc.noResponse.length}</span>}
                    {disc.excused.length>0 && <span className="pill pill-warning">LOA {disc.excused.length}</span>}
                    {/^https?:\/\//i.test(disc.link || '') && (
                      <a href={disc.link} target="_blank" rel="noreferrer"
                        className="pill pill-accent" style={{cursor:'pointer',textDecoration:'none'}}
                        onClick={e=>e.stopPropagation()}>
                        Forum ↗
                      </a>
                    )}
                    {canDisc('archive') && (
                      <button className="pill pill-accent" style={{cursor:'pointer',opacity:archBusy===disc.id?0.5:1}}
                        disabled={archBusy===disc.id}
                        onClick={e=>{e.stopPropagation();handleUnarchiveDisc(disc);}}>
                        {archBusy===disc.id?'…':'Unarchive'}
                      </button>
                    )}
                    {canDisc('delete') && (
                      <button className="pill pill-danger" style={{cursor:'pointer'}}
                        onClick={e=>{e.stopPropagation();handleDeleteArchived(disc);}}>✕</button>
                    )}
                  </div>
                  {open && (
                    <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',background:'rgba(0,0,0,0.18)',display:'flex',flexDirection:'column',gap:10}}>
                      <div style={{fontSize:10,color:'var(--text-3)'}}>
                        Archived {disc.archived_at}{disc.archived_by?` by ${disc.archived_by}`:''}
                      </div>
                      {groups.filter(([,names])=>names.length>0).map(([label,names,color,bg,border]) => (
                        <div key={label}>
                          <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color,marginBottom:6}}>{label} ({names.length})</div>
                          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:6}}>
                            {names.map(n => (
                              <div key={n} style={{padding:'7px 10px',borderRadius:8,border:`1px solid ${border}`,background:bg,fontSize:11,fontWeight:600,color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {discErr && <div style={{padding:'10px 14px',borderRadius:10,border:'1px solid var(--c-danger-glow)',background:'var(--c-danger-bg)',color:'var(--c-danger)',fontSize:13}}>{discErr}</div>}
        </>
      )}

      {/* ── MODALS ────────────────────────────────────────────── */}

      {showAddTask && (
        <Modal title="New Task" onClose={()=>setShowAddTask(false)}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Fl label="Task Description"><input className="lsems-input" placeholder="What needs to be done?" value={addForm.taskName} onChange={e=>setAddForm(f=>({...f,taskName:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
            <Fl label="Assign To">
              <select className="lsems-input" value={addForm.owner} onChange={e=>setAddForm(f=>({...f,owner:e.target.value}))}>
                <option value="">— Unassigned —</option>
                {[...activeAssignees].sort((a,b)=>(stats[a.name]?.completed||0)-(stats[b.name]?.completed||0)).map(a=>{const c=stats[a.name]?.completed||0;return<option key={a.name} value={a.name}>{a.name}{c>0?` (${c}✓)`:''}</option>;})}
              </select>
            </Fl>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Fl label="Start"><input className="lsems-input" placeholder="Today (DD/Mon/YYYY)" value={addForm.assignedDate} onChange={e=>setAddForm(f=>({...f,assignedDate:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
              <Fl label="Due"><input className="lsems-input" placeholder="DD/Mon/YYYY" value={addForm.dueDate} onChange={e=>setAddForm(f=>({...f,dueDate:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
            </div>
            {daysUntilDate(addForm.assignedDate) > 1 && (
              <div style={{fontSize:11,color:'var(--c-accent)',marginTop:-4}}>
                Future start. The Discord announcement is held until 24 hours before {addForm.assignedDate.trim()} (00:00 UTC the day before).
              </div>
            )}
            <Fl label="Notes"><textarea className="lsems-input" style={{minHeight:68,resize:'vertical'}} value={addForm.notes} onChange={e=>setAddForm(f=>({...f,notes:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
          </div>
          <Btns processing={taskProc} onCancel={()=>setShowAddTask(false)} onConfirm={handleAddTask} label="Create Task"/>
        </Modal>
      )}

      {editTask && (
        <Modal title="Edit Task" subtitle={editTask.task_name} onClose={()=>setEditTask(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Fl label="Status">
              <select className="lsems-input" value={editForm.status} onChange={e=>setEditForm(f=>({...f,status:e.target.value}))}>
                {STATUSES.map(s=><option key={s}>{s}</option>)}
              </select>
            </Fl>
            <Fl label="Owner">
              <select className="lsems-input" value={editForm.owner} onChange={e=>setEditForm(f=>({...f,owner:e.target.value}))}>
                <option value="">— Unassigned —</option>
                {assignees.map(a=><option key={a.name} value={a.name}>{a.name}{a.isOnLoa?' (LOA)':''}</option>)}
              </select>
            </Fl>
            <Fl label="Start"><input className="lsems-input" placeholder="DD/Mon/YYYY" value={editForm.startDate||''} onChange={e=>setEditForm(f=>({...f,startDate:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
            {!editTask.announced_at && editTask.status!=='Completed' && (
              <div style={{fontSize:11,color:'var(--c-accent)',marginTop:-4}}>Not announced yet. Discord is notified 24 hours before the start date (00:00 UTC the day before).</div>
            )}
            {editForm.status==='Completed' && (
              <Fl label="Completed Date"><input className="lsems-input" placeholder="DD/Mon/YYYY" value={editForm.completedDate} onChange={e=>setEditForm(f=>({...f,completedDate:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
            )}
            <Fl label="Notes"><textarea className="lsems-input" style={{minHeight:76,resize:'vertical'}} value={editForm.notes} onChange={e=>setEditForm(f=>({...f,notes:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
          </div>
          <Btns processing={taskProc} onCancel={()=>setEditTask(null)} onConfirm={handleEditTask} label="Save Changes"/>
        </Modal>
      )}

      {confirmBox && <ConfirmModal box={confirmBox} busy={archBusy!==null} onClose={()=>setConfirmBox(null)}/>}

      {showAddDisc && (
        <Modal title="Add Discussion" onClose={()=>setShowAddDisc(false)}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Fl label="Topic"><input className="lsems-input" placeholder="e.g. John Smith Reinstatement" value={discForm.topic} onChange={e=>setDiscForm(f=>({...f,topic:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
            <Fl label="Date Posted"><input className="lsems-input" placeholder="DD/Mon/YYYY" value={discForm.datePosted} onChange={e=>setDiscForm(f=>({...f,datePosted:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
            <Fl label="Forum Link (optional)"><input className="lsems-input" placeholder="https://…" value={discForm.link} onChange={e=>setDiscForm(f=>({...f,link:e.target.value}))} onFocus={fr} onBlur={fb}/></Fl>
          </div>
          <Btns processing={discProc} onCancel={()=>setShowAddDisc(false)} onConfirm={handleAddDisc} label="Add Discussion"/>
        </Modal>
      )}
    </div>
  );
}
