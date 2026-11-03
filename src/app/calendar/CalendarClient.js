"use client";
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { addEvent, updateEvent, deleteEvent } from '../actions';

// ── Shared helpers ────────────────────────────────────────────
const fr = e => { e.currentTarget.style.borderColor='var(--c-accent)'; e.currentTarget.style.boxShadow='0 0 0 3px var(--c-accent-glow)'; };
const fb = e => { e.currentTarget.style.borderColor='var(--border)';   e.currentTarget.style.boxShadow='none'; };
const inp = { width:'100%', padding:'7px 10px', fontSize:12, borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-sub)', color:'var(--text-1)', outline:'none', boxSizing:'border-box' };

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = n => String(n).padStart(2, '0');

// Event times are stored as unix seconds (UTC); the form works in UTC parts
function toUtcParts(ts) {
  const d = new Date(ts * 1000);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
function fromUtcParts(date, time) {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/), t = time?.match(/^(\d{2}):(\d{2})$/);
  if (!m || !t) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]) / 1000;
}
function fmtLocal(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' });
}
function fmtUtc(ts) {
  return new Date(ts * 1000).toLocaleString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'UTC' }) + ' UTC';
}
function fmtLocalTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
}
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function Fl({ label, hint, children }) {
  return (
    <div>
      <label style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-3)',display:'block',marginBottom:6}}>{label}</label>
      {children}
      {hint && <div style={{fontSize:10,color:'var(--text-4)',marginTop:4}}>{hint}</div>}
    </div>
  );
}
function Modal({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.80)'}} onClick={onClose}>
      <div className="surface p-5 w-full max-w-lg glass-modal" style={{borderRadius:16,maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:15,fontWeight:700,color:'var(--text-1)',marginBottom:4,wordBreak:'break-word'}}>{title}</div>
        {subtitle && <div style={{fontSize:11,color:'var(--text-3)',marginBottom:14}}>{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}
function SupBadge() {
  return <span style={{fontSize:9,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.06em',padding:'1px 6px',borderRadius:4,color:'var(--c-warning)',background:'var(--c-warn-bg)',border:'1px solid var(--c-warn-glow)'}}>Supervisors</span>;
}
function AllHandsBadge() {
  return <span style={{fontSize:9,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.06em',padding:'1px 6px',borderRadius:4,color:'var(--c-success)',background:'var(--c-succ-bg)',border:'1px solid var(--c-succ-glow)'}}>All-Hands</span>;
}
// Chip colours: All-Hands green, Supervisors amber, everything else blue
function chipColors(ev) {
  if (ev.all_hands)       return { border:'var(--c-succ-glow)',   bg:'var(--c-succ-bg)',   fg:'var(--c-success)' };
  if (ev.for_supervisors) return { border:'var(--c-warn-glow)',   bg:'var(--c-warn-bg)',   fg:'var(--c-warning)' };
  return                         { border:'var(--c-accent-glow)', bg:'var(--c-accent-bg)', fg:'var(--c-accent)'  };
}
const sentLabel = ts => ts ? '✓ sent' : 'pending';
function TimeRow({ label, ts }) {
  return (
    <div style={{padding:'8px 10px',borderRadius:8,background:'var(--bg-sub)',border:'1px solid var(--border)'}}>
      <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-4)',marginBottom:3}}>{label}</div>
      <div style={{fontSize:12,fontWeight:600,color:'var(--text-1)'}}>{fmtLocal(ts)} <span style={{fontSize:10,fontWeight:500,color:'var(--text-4)'}}>· your time</span></div>
      <div style={{fontSize:11,fontFamily:'monospace',color:'var(--text-3)',marginTop:2}}>{fmtUtc(ts)}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function CalendarClient({ events = [], perms = {} }) {
  const can    = (key) => perms[key] !== false;
  const router = useRouter();

  // Local-time rendering only happens in the browser, so wait for mount
  const [now,   setNow]   = useState(null);
  const [month, setMonth] = useState(null); // { y, m } in local time
  useEffect(() => { const d = new Date(); setNow(d); setMonth({ y: d.getFullYear(), m: d.getMonth() }); }, []);

  const [viewId,     setViewId]     = useState(null);   // event detail modal
  const [form,       setForm]       = useState(null);   // add/edit modal state
  const [processing, setProcessing] = useState(false);
  const [error,      setError]      = useState('');

  const viewing = viewId != null ? events.find(e => e.id === viewId) : null;

  // Events bucketed by the local day(s) they cover
  const byDay = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const d   = new Date(ev.start_ts * 1000);
      const end = new Date(((ev.end_ts ?? ev.start_ts + 1) - 1) * 1000);
      const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      for (let i = 0; i < 31 && cur <= end; i++) {
        (map[dayKey(cur)] ||= []).push(ev);
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  }, [events]);

  const cells = useMemo(() => {
    if (!month) return [];
    const first  = new Date(month.y, month.m, 1);
    const offset = first.getDay();
    const days   = new Date(month.y, month.m + 1, 0).getDate();
    const total  = Math.ceil((offset + days) / 7) * 7;
    return Array.from({ length: total }, (_, i) => new Date(month.y, month.m, 1 - offset + i));
  }, [month]);

  const upcoming = useMemo(() => {
    if (!now) return [];
    const nowTs = now.getTime() / 1000;
    return events.filter(e => (e.end_ts ?? e.start_ts) > nowTs).slice(0, 10);
  }, [events, now]);

  if (!now || !month) {
    return <div className="p-8 text-center" style={{ color:'var(--text-3)', fontSize:12 }}>Loading calendar…</div>;
  }

  const shiftMonth = (delta) => setMonth(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const monthLabel = new Date(month.y, month.m, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' });

  // ── Form ────────────────────────────────────────────────────
  const openAdd = (date) => {
    setError('');
    setForm({ id: null, title: '', link: '', startDate: date, startTime: '18:00', endDate: '', endTime: '', forSupervisors: false, allHands: false });
  };
  const openEdit = (ev) => {
    const s = toUtcParts(ev.start_ts), e = ev.end_ts ? toUtcParts(ev.end_ts) : { date: '', time: '' };
    setError(''); setViewId(null);
    setForm({ id: ev.id, title: ev.title, link: ev.link || '', startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, forSupervisors: !!ev.for_supervisors, allHands: !!ev.all_hands });
  };
  const setStart = (patch) => setForm(f => ({ ...f, ...patch }));
  const setEnd   = (patch) => setForm(f => ({ ...f, ...patch }));

  // End is optional: blank means no end time; a time with no date uses the start date
  const formStart  = form ? fromUtcParts(form.startDate, form.startTime) : null;
  const hasEnd     = !!(form && (form.endDate || form.endTime));
  const formEnd    = hasEnd ? fromUtcParts(form.endDate || form.startDate, form.endTime) : null;

  const handleSave = async () => {
    if (!form.title.trim())                  { setError('Title required.'); return; }
    if (formStart == null)                   { setError('Enter a start date and time (UTC).'); return; }
    if (hasEnd && formEnd == null)           { setError('Enter an end time (UTC), or clear the end fields.'); return; }
    if (hasEnd && formEnd <= formStart)      { setError('End time must be after the start time.'); return; }
    setProcessing(true); setError('');
    const payload = { title: form.title, link: form.link, startTs: formStart, endTs: formEnd, forSupervisors: form.forSupervisors, allHands: form.allHands };
    const res = form.id ? await updateEvent({ id: form.id, ...payload }) : await addEvent(payload);
    setProcessing(false);
    if (!res.ok) { setError(res.error); return; }
    setForm(null);
    router.refresh();
  };

  const handleDelete = async (ev) => {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    const res = await deleteEvent(ev.id);
    if (!res.ok) { alert(res.error); return; }
    setViewId(null);
    router.refresh();
  };

  const todayKey = dayKey(now);
  const nowTs    = now.getTime() / 1000;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">

      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div>
          <h1 style={{fontSize:18,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>Calendar</h1>
          <p style={{fontSize:11,color:'var(--text-3)',marginTop:3}}>Shown in your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}) · events are entered in UTC</p>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {can('add') && <button onClick={() => openAdd(isoDate(now))} className="btn-primary">+ Add Event</button>}
        </div>
      </div>

      {/* Month grid */}
      <section className="surface" style={{overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--border)'}}>
          <button onClick={() => shiftMonth(-1)} className="btn-ghost" aria-label="Previous month">‹</button>
          <button onClick={() => shiftMonth(1)}  className="btn-ghost" aria-label="Next month">›</button>
          <div style={{fontSize:14,fontWeight:800,color:'var(--text-1)',marginLeft:4}}>{monthLabel}</div>
          <button onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })} className="btn-ghost" style={{marginLeft:'auto'}}>Today</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7, minmax(0, 1fr))'}}>
          {WEEKDAYS.map(w => (
            <div key={w} style={{padding:'6px 8px',fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--text-4)',borderBottom:'1px solid var(--border)'}}>{w}</div>
          ))}
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === month.m;
            const isToday = dayKey(d) === todayKey;
            const dayEvs  = byDay[dayKey(d)] || [];
            return (
              <div key={i}
                onClick={can('add') ? () => openAdd(isoDate(d)) : undefined}
                title={can('add') ? 'Click an empty spot to add an event' : undefined}
                style={{
                  minHeight:96, padding:'4px 4px 6px', minWidth:0,
                  borderRight: (i % 7) < 6 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  borderBottom:'1px solid rgba(255,255,255,0.04)',
                  background: isToday ? 'var(--c-accent-bg)' : inMonth ? 'transparent' : 'var(--bg-stripe)',
                  cursor: can('add') ? 'pointer' : 'default',
                }}>
                <div style={{fontSize:11,fontWeight:isToday?800:600,color:isToday?'var(--c-accent)':inMonth?'var(--text-2)':'var(--text-4)',padding:'0 4px 3px'}}>{d.getDate()}</div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {dayEvs.map(ev => {
                    const c = chipColors(ev);
                    return (
                      <button key={ev.id} onClick={e => { e.stopPropagation(); setViewId(ev.id); }}
                        title={`${ev.title} — ${fmtLocal(ev.start_ts)}`}
                        style={{
                          display:'block', width:'100%', textAlign:'left', cursor:'pointer',
                          padding:'2px 5px', borderRadius:4, fontSize:10, lineHeight:1.35,
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                          border:'1px solid', borderColor: c.border, background: c.bg, color: c.fg,
                          opacity: (ev.end_ts ?? ev.start_ts) < nowTs ? 0.55 : 1,
                        }}>
                        <span style={{fontWeight:700}}>{fmtLocalTime(ev.start_ts)}</span> {ev.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Upcoming list — the easiest view on small screens */}
      <section className="surface" style={{padding:'12px 14px'}}>
        <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.12em',color:'var(--text-3)',paddingBottom:8,marginBottom:8,borderBottom:'1px solid var(--border)'}}>Upcoming</div>
        {upcoming.length === 0 ? (
          <div style={{fontSize:12,fontStyle:'italic',color:'var(--text-3)',padding:'12px 0',textAlign:'center'}}>No upcoming events.</div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {upcoming.map(ev => (
              <button key={ev.id} onClick={() => setViewId(ev.id)}
                style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',textAlign:'left',cursor:'pointer',padding:'8px 10px',borderRadius:8,background:'var(--bg-sub)',border:'1px solid var(--border)',color:'inherit'}}>
                <span style={{fontSize:12,fontWeight:700,color:'var(--text-1)',minWidth:0,wordBreak:'break-word'}}>{ev.title}</span>
                {!!ev.all_hands && <AllHandsBadge />}
                {!!ev.for_supervisors && <SupBadge />}
                <span style={{fontSize:11,color:'var(--text-3)',marginLeft:'auto'}}>{fmtLocal(ev.start_ts)}</span>
                <span style={{fontSize:10,fontFamily:'monospace',color:'var(--text-4)'}}>{fmtUtc(ev.start_ts)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Event detail */}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewId(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:10}}>
            {(!!viewing.all_hands || !!viewing.for_supervisors) && (
              <div style={{display:'flex',gap:6}}>{!!viewing.all_hands && <AllHandsBadge />}{!!viewing.for_supervisors && <SupBadge />}</div>
            )}
            <TimeRow label="Start" ts={viewing.start_ts} />
            {viewing.end_ts && <TimeRow label="End" ts={viewing.end_ts} />}
            {viewing.link && (
              <a href={viewing.link} target="_blank" rel="noopener noreferrer"
                style={{fontSize:12,color:'var(--c-accent)',wordBreak:'break-all',textDecoration:'underline'}}>{viewing.link}</a>
            )}
            {!!viewing.all_hands && viewing.start_ts > nowTs && (
              <div style={{fontSize:11,color:'var(--text-3)'}}>
                All-Hands messages: announcement {sentLabel(viewing.ah_announced_at)} · 24h {sentLabel(viewing.ah_reminded_24h_at)} · 1h {sentLabel(viewing.ah_reminded_1h_at)}
              </div>
            )}
            {!!viewing.for_supervisors && viewing.start_ts > nowTs && (
              <div style={{fontSize:11,color:'var(--text-3)'}}>
                Supervisor reminders: 24h {sentLabel(viewing.reminded_24h_at)} · 1h {sentLabel(viewing.reminded_1h_at)}
              </div>
            )}
            {viewing.created_by && <div style={{fontSize:10,color:'var(--text-4)'}}>Added by {viewing.created_by}</div>}
          </div>
          <div style={{display:'flex',gap:10,marginTop:16}}>
            {can('delete') && <button onClick={() => handleDelete(viewing)} className="btn-ghost" style={{color:'var(--c-danger)'}}>Delete</button>}
            <button onClick={() => setViewId(null)} className="btn-ghost" style={{marginLeft:'auto'}}>Close</button>
            {can('edit') && <button onClick={() => openEdit(viewing)} className="btn-primary">Edit</button>}
          </div>
        </Modal>
      )}

      {/* Add / edit */}
      {form && (
        <Modal title={form.id ? 'Edit Event' : 'Add Event'} subtitle="Enter all dates and times in UTC." onClose={() => !processing && setForm(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Fl label="Title">
              <input style={inp} value={form.title} maxLength={200} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} onFocus={fr} onBlur={fb} />
            </Fl>
            <Fl label="Link (optional)">
              <input style={inp} placeholder="https://…" value={form.link} onChange={e => setForm(f => ({ ...f, link: e.target.value }))} onFocus={fr} onBlur={fb} />
            </Fl>
            <Fl label="Start (UTC)" hint={formStart != null ? `Your time: ${fmtLocal(formStart)}` : null}>
              <div style={{display:'flex',gap:8}}>
                <input type="date" style={inp} value={form.startDate} onChange={e => setStart({ startDate: e.target.value })} onFocus={fr} onBlur={fb} />
                <input type="time" style={{...inp,maxWidth:130}} value={form.startTime} onChange={e => setStart({ startTime: e.target.value })} onFocus={fr} onBlur={fb} />
              </div>
            </Fl>
            <Fl label="End (UTC, optional)" hint={formEnd != null ? `Your time: ${fmtLocal(formEnd)}` : 'Leave blank for no end time. A time with no date uses the start date.'}>
              <div style={{display:'flex',gap:8}}>
                <input type="date" style={inp} value={form.endDate} onChange={e => setEnd({ endDate: e.target.value })} onFocus={fr} onBlur={fb} />
                <input type="time" style={{...inp,maxWidth:130}} value={form.endTime} onChange={e => setEnd({ endTime: e.target.value })} onFocus={fr} onBlur={fb} />
                {hasEnd && <button type="button" onClick={() => setEnd({ endDate: '', endTime: '' })} className="btn-ghost" title="Remove the end time">Clear</button>}
              </div>
            </Fl>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',fontSize:12,color:'var(--text-2)'}}>
              <input type="checkbox" checked={form.forSupervisors} onChange={e => setForm(f => ({ ...f, forSupervisors: e.target.checked }))}
                style={{marginTop:2,accentColor:'var(--c-warning)'}} />
              <span>
                <strong style={{color:'var(--text-1)'}}>For Supervisors</strong>
                <span style={{display:'block',fontSize:10,color:'var(--text-4)',marginTop:2}}>Posts a Discord reminder to Supervisors 24 hours and 1 hour before it starts.</span>
              </span>
            </label>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',fontSize:12,color:'var(--text-2)'}}>
              <input type="checkbox" checked={form.allHands} onChange={e => setForm(f => ({ ...f, allHands: e.target.checked }))}
                style={{marginTop:2,accentColor:'var(--c-success)'}} />
              <span>
                <strong style={{color:'var(--text-1)'}}>All-Hands Meeting</strong>
                <span style={{display:'block',fontSize:10,color:'var(--text-4)',marginTop:2}}>Posts in #announcements when saved, then 24 hours and 1 hour before it starts.</span>
              </span>
            </label>
            {error && <p style={{fontSize:12,padding:'8px 10px',borderRadius:8,background:'var(--c-danger-bg)',border:'1px solid rgba(248,113,113,0.3)',color:'var(--c-danger)'}}>{error}</p>}
          </div>
          <div style={{display:'flex',gap:10,marginTop:16}}>
            <button onClick={() => setForm(null)} disabled={processing} className="btn-ghost" style={{flex:1,textAlign:'center',justifyContent:'center'}}>Cancel</button>
            <button onClick={handleSave} disabled={processing} className="btn-primary" style={{flex:1,textAlign:'center',justifyContent:'center'}}>
              {processing ? 'Saving…' : form.id ? 'Save Changes' : 'Add Event'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
