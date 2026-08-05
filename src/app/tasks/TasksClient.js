"use client";
import { useState, useMemo, useCallback } from 'react';
import { addSupTask, updateSupTask, deleteSupTask } from '../actions';

const T = {
  card:  { background:'var(--bg-card)', borderColor:'var(--border)' },
  sub:   { background:'var(--bg-sub)',  borderColor:'var(--border)' },
  input: { background:'var(--bg-sub)',  borderColor:'var(--border)', color:'var(--text-1)' },
  t1: { color:'var(--text-1)' }, t2: { color:'var(--text-2)' }, t3: { color:'var(--text-3)' },
};
const focusOn  = e => (e.currentTarget.style.borderColor = 'var(--c-accent)');
const focusOff = e => (e.currentTarget.style.borderColor = 'var(--border)');
const inputCls = 'w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors placeholder:opacity-40';

const STATUSES    = ['Assigned', 'In Progress', 'Completed'];
const STATUS_NEXT = { 'Assigned': 'In Progress', 'In Progress': 'Completed', 'Completed': 'Assigned' };

function statusStyle(s) {
  if (s === 'Completed')  return { color:'var(--c-success)', bg:'var(--c-succ-bg)',  border:'rgba(74,222,128,0.3)' };
  if (s === 'In Progress') return { color:'var(--c-warning)', bg:'var(--c-warn-bg)',  border:'rgba(251,191,36,0.3)' };
  return                          { color:'var(--c-accent)',  bg:'var(--c-accent-bg)',border:'rgba(96,165,250,0.3)' };
}

function isOverdue(t) {
  if (t.status === 'Completed' || !t.due_date) return false;
  return new Date(t.due_date) < new Date();
}

function today() {
  return new Date().toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' });
}

export default function TasksClient({ tasks: initial, supervisors, stats }) {
  const [tasks,        setTasks]        = useState(initial);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('Active'); // Active | All | Assigned | In Progress | Completed
  const [ownerFilter,  setOwnerFilter]  = useState('All');
  const [showAdd,      setShowAdd]      = useState(false);
  const [editTask,     setEditTask]     = useState(null);
  const [expandNotes,  setExpandNotes]  = useState(null);
  const [addForm,      setAddForm]      = useState({ taskName:'', owner:'', assignedDate:'', dueDate:'', notes:'' });
  const [editForm,     setEditForm]     = useState({});
  const [processing,   setProcessing]   = useState(false);
  const [error,        setError]        = useState('');

  const activeSupervisors = useMemo(() => supervisors.filter(s => !s.is_on_loa), [supervisors]);
  const owners = useMemo(() => ['All', ...new Set(tasks.map(t=>t.owner).filter(Boolean))].sort(), [tasks]);

  const filtered = useMemo(() => tasks.filter(t => {
    if (statusFilter === 'Active' && t.status === 'Completed') return false;
    if (statusFilter !== 'Active' && statusFilter !== 'All' && t.status !== statusFilter) return false;
    if (ownerFilter !== 'All' && t.owner !== ownerFilter) return false;
    if (search && !t.task_name.toLowerCase().includes(search.toLowerCase()) && !(t.owner||'').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [tasks, statusFilter, ownerFilter, search]);

  const counts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter(t => t.status !== 'Completed').length,
    assigned: tasks.filter(t => t.status === 'Assigned').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    completed: tasks.filter(t => t.status === 'Completed').length,
    overdue: tasks.filter(t => isOverdue(t)).length,
  }), [tasks]);

  const reload = useCallback(async () => {
    const { getSupTasks } = await import('../actions');
    setTasks(await getSupTasks(false));
  }, []);

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

  // Cycle status with one click
  const cycleStatus = async (task) => {
    const newStatus = STATUS_NEXT[task.status];
    const completedDate = newStatus === 'Completed' ? today() : '';
    // Optimistic
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus, completed_date: completedDate || t.completed_date } : t));
    const res = await updateSupTask({ id: task.id, status: newStatus, owner: task.owner, completedDate, notes: task.notes });
    if (!res.ok) { setError(res.error); await reload(); }
  };

  // Quick owner reassign
  const reassign = async (task, newOwner) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, owner: newOwner } : t));
    const res = await updateSupTask({ id: task.id, status: task.status, owner: newOwner, completedDate: task.completed_date, notes: task.notes });
    if (!res.ok) { setError(res.error); await reload(); }
  };

  const handleAdd = async () => {
    const ok = await act(() => addSupTask(addForm));
    if (ok) { setShowAdd(false); setAddForm({ taskName:'', owner:'', assignedDate:'', dueDate:'', notes:'' }); }
  };

  const handleEdit = async () => {
    const ok = await act(() => updateSupTask({ id: editTask.id, ...editForm }));
    if (ok) setEditTask(null);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this task?')) return;
    await act(() => deleteSupTask(id));
  };

  const openEdit = (task) => {
    setEditTask(task);
    setEditForm({ status: task.status, owner: task.owner||'', completedDate: task.completed_date||'', notes: task.notes||'' });
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">

      {/* Toolbar */}
      <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color:'var(--text-3)' }}>Los Santos EMS</p>
          <h1 className="text-xl font-bold" style={{ color:'var(--text-1)' }}>Supervisor Tasks</h1>
          <p className="text-[11px] mt-0.5" style={{ color:'var(--text-3)' }}>
            {counts.assigned} assigned · {counts.inProgress} in progress · {counts.completed} completed
            {counts.overdue > 0 && <span style={{ color:'var(--c-danger)', textShadow:'0 0 12px var(--c-danger-glow)' }}> · {counts.overdue} overdue</span>}
          </p>
        </div>
        <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
          <input type="text" placeholder="Search…"
            className="px-3 py-1.5 rounded-lg border text-[11px] outline-none transition-colors placeholder:opacity-40 w-40"
            style={T.sub} value={search} onChange={e=>setSearch(e.target.value)} onFocus={focusOn} onBlur={focusOff} />
          <button onClick={()=>setShowAdd(true)}
            className="px-4 py-1.5 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors whitespace-nowrap">
            + New Task
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && Object.keys(stats).length > 0 && (
        <div className="border rounded-xl px-4 py-2.5 glass-sub flex flex-wrap gap-x-5 gap-y-1.5 items-center" style={T.sub}>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={T.t3}>Completed by supervisor:</span>
          {Object.entries(stats)
            .filter(([,s]) => s.completed > 0)
            .sort(([,a],[,b]) => b.completed - a.completed)
            .map(([name, s]) => (
              <span key={name} className="text-[11px]" style={T.t2}>
                <span style={T.t1}>{name.split(' ')[0]}</span>
                <span className="ml-1 font-bold font-mono" style={{ color:'var(--c-accent)' }}>{s.completed}</span>
              </span>
            ))
          }
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          {['Active','All','Assigned','In Progress','Completed'].map(s => {
            const ss = s === 'Active' || s === 'All' ? null : statusStyle(s);
            const isActive = statusFilter === s;
            return (
              <button key={s} onClick={()=>setStatusFilter(s)}
                className="px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide border transition-colors"
                style={isActive
                  ? (ss ? { background:ss.bg, color:ss.color, borderColor:ss.border } : { background:'var(--c-accent-bg)', color:'var(--c-accent)', borderColor:'rgba(96,165,250,0.35)' })
                  : { background:'transparent', color:'var(--text-3)', borderColor:'var(--border)' }}>
                {s}
              </button>
            );
          })}
        </div>
        <select className="px-2.5 py-1 rounded-lg border text-[10px] outline-none" style={T.sub}
          value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value)}>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      {/* Table */}
      <section className="border rounded-2xl overflow-hidden glass" style={T.card}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead className="border-b" style={{ background:'var(--bg-sub)', borderColor:'var(--border)' }}>
              <tr className="text-[10px] uppercase tracking-wider font-semibold" style={T.t3}>
                <th className="px-4 py-2.5">Task</th>
                <th className="px-4 py-2.5">Owner</th>
                <th className="px-4 py-2.5 text-center">Status</th>
                <th className="px-4 py-2.5">Due</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center italic text-sm" style={T.t3}>No tasks found.</td></tr>
              ) : filtered.map((task, i) => {
                const overdue = isOverdue(task);
                const ss      = statusStyle(task.status);
                const isEven  = i % 2 === 0;
                const rowBg   = overdue ? 'rgba(248,113,113,0.05)' : isEven ? 'rgba(255,255,255,0.016)' : 'transparent';
                const showNotes = expandNotes === task.id;
                return [
                  <tr key={task.id} className="border-b transition-colors"
                    style={{ borderColor:'rgba(255,255,255,0.05)', background: rowBg }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                    {/* Task name */}
                    <td className="px-4 py-2.5 max-w-[280px]">
                      <div className="text-sm font-semibold" style={T.t1}>{task.task_name}</div>
                      {task.notes && (
                        <button className="text-[10px] mt-0.5 transition-colors" style={{ color:'var(--c-accent)' }}
                          onClick={() => setExpandNotes(showNotes ? null : task.id)}>
                          {showNotes ? '▲ hide notes' : '▼ notes'}
                        </button>
                      )}
                    </td>
                    {/* Inline owner reassign */}
                    <td className="px-4 py-2.5">
                      <select
                        className="px-2 py-1 rounded-lg border text-[11px] outline-none transition-colors"
                        style={{ ...T.sub, minWidth: 130 }}
                        value={task.owner || ''}
                        onChange={e => reassign(task, e.target.value || null)}>
                        <option value="">— Unassigned —</option>
                        {activeSupervisors.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                        {supervisors.filter(s=>s.is_on_loa).map(s => <option key={s.name} value={s.name}>{s.name} (LOA)</option>)}
                      </select>
                    </td>
                    {/* Clickable status badge cycles through */}
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => cycleStatus(task)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full border transition-opacity hover:opacity-70"
                        style={{ color:ss.color, background:ss.bg, borderColor:ss.border }}
                        title="Click to advance status">
                        {task.status}
                      </button>
                      {overdue && <div className="text-[9px] font-bold mt-0.5" style={{ color:'var(--c-danger)' }}>OVERDUE</div>}
                    </td>
                    <td className="px-4 py-2.5 text-[12px]" style={overdue ? { color:'var(--c-danger)' } : T.t2}>
                      {task.due_date || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={()=>openEdit(task)}
                        className="px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wide border mr-1.5 transition-colors"
                        style={{ color:'var(--c-accent)', background:'var(--c-accent-bg)', borderColor:'rgba(96,165,250,0.3)' }}>
                        Edit
                      </button>
                      <button onClick={()=>handleDelete(task.id)}
                        className="px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wide border transition-colors"
                        style={{ color:'var(--c-danger)', background:'var(--c-danger-bg)', borderColor:'rgba(248,113,113,0.3)' }}>
                        Delete
                      </button>
                    </td>
                  </tr>,
                  showNotes && task.notes && (
                    <tr key={`${task.id}-notes`} style={{ background:'rgba(96,165,250,0.04)', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                      <td colSpan={5} className="px-6 py-2.5 text-[12px] leading-relaxed" style={T.t2}>{task.notes}</td>
                    </tr>
                  )
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="text-sm px-3 py-2 rounded-lg border" style={{ background:'var(--c-danger-bg)', borderColor:'rgba(248,113,113,0.3)', color:'var(--c-danger)' }}>{error}</p>}

      {/* Add modal */}
      {showAdd && (
        <Modal title="New Task" onClose={()=>setShowAdd(false)}>
          <div className="space-y-3 mb-4">
            <Field label="Task Description"><input className={inputCls} style={T.input} placeholder="What needs to be done?" value={addForm.taskName} onChange={e=>setAddForm(f=>({...f,taskName:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></Field>
            <Field label="Assign To">
              <select className={inputCls} style={T.input} value={addForm.owner} onChange={e=>setAddForm(f=>({...f,owner:e.target.value}))}>
                <option value="">— Unassigned —</option>
                {activeSupervisors.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assigned Date"><input className={inputCls} style={T.input} placeholder="DD/Mon/YYYY" value={addForm.assignedDate} onChange={e=>setAddForm(f=>({...f,assignedDate:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></Field>
              <Field label="Due Date"><input className={inputCls} style={T.input} placeholder="DD/Mon/YYYY" value={addForm.dueDate} onChange={e=>setAddForm(f=>({...f,dueDate:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></Field>
            </div>
            <Field label="Notes"><textarea className={inputCls} style={{...T.input,minHeight:72,resize:'vertical'}} value={addForm.notes} onChange={e=>setAddForm(f=>({...f,notes:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></Field>
          </div>
          <ModalButtons processing={processing} onCancel={()=>setShowAdd(false)} onConfirm={handleAdd} confirmLabel="Create Task" />
        </Modal>
      )}

      {/* Edit modal */}
      {editTask && (
        <Modal title="Edit Task" subtitle={editTask.task_name} onClose={()=>setEditTask(null)}>
          <div className="space-y-3 mb-4">
            <Field label="Status">
              <select className={inputCls} style={T.input} value={editForm.status} onChange={e=>setEditForm(f=>({...f,status:e.target.value}))}>
                {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Owner">
              <select className={inputCls} style={T.input} value={editForm.owner} onChange={e=>setEditForm(f=>({...f,owner:e.target.value}))}>
                <option value="">— Unassigned —</option>
                {supervisors.map(s=><option key={s.name} value={s.name}>{s.name}{s.is_on_loa?' (LOA)':''}</option>)}
              </select>
            </Field>
            {editForm.status === 'Completed' && (
              <Field label="Completed Date"><input className={inputCls} style={T.input} placeholder="DD/Mon/YYYY" value={editForm.completedDate} onChange={e=>setEditForm(f=>({...f,completedDate:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></Field>
            )}
            <Field label="Notes"><textarea className={inputCls} style={{...T.input,minHeight:80,resize:'vertical'}} value={editForm.notes} onChange={e=>setEditForm(f=>({...f,notes:e.target.value}))} onFocus={focusOn} onBlur={focusOff} /></Field>
          </div>
          <ModalButtons processing={processing} onCancel={()=>setEditTask(null)} onConfirm={handleEdit} confirmLabel="Save" />
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return <div><label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color:'var(--text-3)' }}>{label}</label>{children}</div>;
}
function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="border rounded-2xl p-5 w-full max-w-lg glass-modal" className="surface" style={{}} onClick={e=>e.stopPropagation()}>
        <div className="mb-4"><div className="text-base font-semibold" style={{ color:'var(--text-1)' }}>{title}</div>{subtitle&&<div className="text-xs mt-0.5 line-clamp-2" style={{ color:'var(--text-3)' }}>{subtitle}</div>}</div>
        {children}
      </div>
    </div>
  );
}
function ModalButtons({ processing, onCancel, onConfirm, confirmLabel }) {
  return (
    <div className="flex gap-2.5">
      <button onClick={onCancel} className="flex-1 py-2 rounded-lg border text-[11px] font-semibold uppercase tracking-wide" style={{ background:'var(--bg-sub)', borderColor:'var(--border)', color:'var(--text-2)' }}>Cancel</button>
      <button disabled={processing} onClick={onConfirm} className="flex-1 py-2 rounded-lg text-[11px] font-semibold text-white uppercase tracking-wide bg-blue-600 hover:bg-blue-500 border border-blue-500/40 transition-colors disabled:opacity-50">{processing?'Saving…':confirmLabel}</button>
    </div>
  );
}
