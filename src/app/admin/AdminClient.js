"use client";
import { useState } from 'react';
import { updateAppSetting } from '../actions';

const fr = e => { e.currentTarget.style.borderColor='var(--c-accent)'; e.currentTarget.style.boxShadow='0 0 0 2px var(--c-accent-glow)'; };
const fb = e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.boxShadow='none'; };
const inp = { padding:'4px 8px', fontSize:11, borderRadius:5, border:'1px solid var(--border)', background:'var(--bg-sub)', color:'var(--text-1)', outline:'none' };

const HOUR_PLACEHOLDERS = [
  { key:'{{employee_name}}',  desc:"Employee's full name"            },
  { key:'{{date}}',           desc:"Today's date (DD/Mon/YYYY)"      },
  { key:'{{min_hours}}',      desc:'Hour requirement (e.g. 5h/week)' },
  { key:'{{week}}',           desc:'Week ending date'                },
  { key:'{{sig_image}}',      desc:'Your signature image URL'        },
  { key:'{{character_name}}', desc:'Your character name'             },
  { key:'{{rank}}',           desc:'Your LSEMS rank'                 },
];

const BONUS_PLACEHOLDERS = [
  { key:'{{bonus_table}}',          desc:'Auto-generated rank/amount/count/total rows' },
  { key:'{{not_recommended_list}}', desc:'BBCode list of non-recommended employees'    },
  { key:'{{recommended_list}}',     desc:'BBCode list of exception-recommended employees' },
];

const DEFAULT_W1 =
`[img]https://i.imgur.com/rLIJtNZ.png[/img][divbox=white][fpimg=25]https://i.imgur.com/4MaDTqz.png[/fpimg][aligntable=right,0,0,0,0,0,0][right][font=Arial][b]
[size=150]Los Santos Emergency Medical Services[/size][/b]
[size=115]Hour Minimum - First Warning[/size]
[size=95]{{date}}[/size][/font][/right][/aligntable]
[hr]

Hello {{employee_name}},

You're receiving this email because we have noticed that you did not meet the minimum amount of {{min_hours}} last pay period.

As you were made aware during your interview, on-boarding and contract signing, we require each employee to meet the minimum amount of hours weekly to ensure we're providing the best possible service to the community.

We understand that there are situations that come up that require you to take time away from work, and we've set up our LOA system for you to use should that happen. Please make sure you're taking the time you need and plan it in advance to prevent future warnings.

Consider this email the [b]first[/b] warning. You will receive one more warning should you fall behind in hours. Should you require a third warning, it would lead directly to a discharge with or without notice.
[hr][/hr]
Kind regards,

[img]{{sig_image}}[/img]
[I]{{character_name}}[/i]
[b]{{rank}}[/b]
[b]Los Santos Emergency Medical Services[/b]
[/divbox]
[LSEMSfooter][/LSEMSfooter]`;

const DEFAULT_W2 =
`[img]https://i.imgur.com/rLIJtNZ.png[/img][divbox=white][fpimg=25]https://i.imgur.com/4MaDTqz.png[/fpimg][aligntable=right,0,0,0,0,0,0][right][font=Arial][b]
[size=150]Los Santos Emergency Medical Services[/size][/b]
[size=115]Hour Minimum - Second Warning[/size]
[size=95]{{date}}[/size][/font][/right][/aligntable]
[hr]

Hello {{employee_name}},

You're receiving this email because we have noticed that you did not meet the minimum amount of {{min_hours}} last pay period.

As you were made aware during your interview, on-boarding and contract signing, we require each employee to meet the minimum amount of hours weekly to ensure we're providing the best possible service to the community.

We understand that there are situations that come up that require you to take time away from work, and we've set up our LOA system for you to use should that happen. Please make sure you're taking the time you need and plan it in advance to prevent future warnings.

Consider this email a [b]second[/b] warning. In the event of you not meeting the minimum hours again without an LOA in place, you may face a discharge from the LSEMS. Please do reach out if you have any concerns.
[hr][/hr]
Kind regards,

[img]{{sig_image}}[/img]
[I]{{character_name}}[/i]
[b]{{rank}}[/b]
[b]Los Santos Emergency Medical Services[/b]
[/divbox]
[LSEMSfooter][/LSEMSfooter]`;

const DEFAULT_QUARTERLY =
`[mdheader title="Los Santos Emergency Medical Services" location="Pillbox Hill Medical Center" date=" | Paleto Bay Medical Center"department="One Team, One Mission, Saving Lives"][/mdheader]
[divbox4=eeeeee][hr][/hr]Greetings!

See below a table that was made to show the recommended bonuses per rank. And below that the justifications for each.

[url=HOURS_SHEET_URL_HERE]Here is a link to our hours sheet![/url]

| Rank  | Bonus | Count | Total |
|:-----|:------:|------:|------:|
{{bonus_table}}

{{not_recommended_list}}{{recommended_list}}Please let me know if you have any follow up questions!

[hr][/hr]

[/divbox4]`;

// Add new BBCode templates here — each entry gets a sub-tab automatically
const BBCODE_CONFIGS = [
  { key:'hour_warning_1', label:'First Hour Warning',  default:DEFAULT_W1,        placeholders:HOUR_PLACEHOLDERS  },
  { key:'hour_warning_2', label:'Second Hour Warning', default:DEFAULT_W2,        placeholders:HOUR_PLACEHOLDERS  },
  { key:'quarterly_bonus', label:'Quarterly Bonuses',  default:DEFAULT_QUARTERLY, placeholders:BONUS_PLACEHOLDERS },
];

function SaveBtn({ saving, saved, onClick }) {
  return (
    <button onClick={onClick} disabled={saving} className="btn-primary"
      style={{ padding:'5px 18px', fontSize:11, background: saved ? 'linear-gradient(135deg,#059669,#047857)' : undefined }}>
      {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
    </button>
  );
}

function SectionTitle({ title, sub }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:13, fontWeight:800, color:'var(--text-1)' }}>{title}</div>
      {sub && <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

export default function AdminClient({ settings: initial, rankOrder, realLevel, viewAs: initialViewAs, auditLog = [] }) {
  const [section,     setSection]     = useState('hours');
  const [auditSearch, setAuditSearch] = useState('');
  const [viewAs,      setViewAs]      = useState(initialViewAs);

  const [hourReqs,   setHourReqs]   = useState(initial.hour_requirements);
  const [salaries,   setSalaries]   = useState(initial.salaries);
  const [bonusCycle, setBonusCycle] = useState(initial.bonus_cycle);
  const [permRoles,  setPermRoles]  = useState(initial.permission_roles);
  const [pagePerms,  setPagePerms]  = useState(initial.page_permissions || {});
  const [levelNames, setLevelNames] = useState(() => {
    // Ensure keys are numbers, sorted
    const raw = initial.level_names || { 1:'Supervisor', 2:'Command', 3:'High Command' };
    const out = {};
    for (const [k, v] of Object.entries(raw)) out[Number(k)] = v;
    return out;
  });
  const [newLvlNum,  setNewLvlNum]  = useState('');
  const [newLvlName, setNewLvlName] = useState('');
  const [bbTemplates, setBbTemplates] = useState(() => {
    const out = {};
    for (const cfg of BBCODE_CONFIGS) {
      out[cfg.key] = initial.bbcode_templates?.[cfg.key] || cfg.default;
    }
    return out;
  });
  const [bbTab, setBbTab] = useState(BBCODE_CONFIGS[0].key);
  const [reminders, setReminders] = useState(initial.calendar_reminders || { day:'', hour:'' });
  const [newRoleId,  setNewRoleId]  = useState('');
  const [newRoleLvl, setNewRoleLvl] = useState(1);
  const [saving,     setSaving]     = useState({});
  const [saved,      setSaved]      = useState({});

  const save = async (key, value) => {
    setSaving(s => ({ ...s, [key]: true }));
    const res = await updateAppSetting(key, value);
    setSaving(s => ({ ...s, [key]: false }));
    if (!res?.ok) { alert(res?.error || 'Save failed.'); return; }
    setSaved(s => ({ ...s, [key]: true }));
    setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2500);
  };

  const handleViewAs = async (level) => {
    await fetch('/api/auth/viewas', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ viewAs: level }) });
    setViewAs(level === realLevel ? null : level);
    window.location.reload();
  };

  const filteredAudit = auditLog.filter(r => {
    if (!auditSearch) return true;
    const s = auditSearch.toLowerCase();
    return (r.username||'').toLowerCase().includes(s) ||
           (r.action||'').toLowerCase().includes(s) ||
           (r.details||'').toLowerCase().includes(s) ||
           (r.timestamp||'').toLowerCase().includes(s);
  });

  const NAV = [
    { id:'hours',    label:'Hour Requirements' },
    { id:'salaries', label:'Salaries'          },
    { id:'bonuses',  label:'Bonus Cycle'       },
    { id:'bbcode',   label:'BBCode Templates'  },
    { id:'reminders', label:'Discord Reminders' },
    ...(realLevel >= 3 ? [
      { id:'access',      label:'Access Control'  },
      { id:'permissions', label:'Discord Roles'   },
    ] : []),
    { id:'audit',    label:'Audit Log'         },
  ];

  return (
    <div className="p-4 md:p-6" style={{ maxWidth:1400, margin:'0 auto' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap', marginBottom:16 }}>
        <div>
          <h1 style={{ fontSize:18, fontWeight:800, color:'var(--text-1)', lineHeight:1 }}>Admin</h1>
          <p style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>Configuration — changes take effect immediately</p>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)' }}>View As:</span>
          {[1,2,3].filter(l => l <= realLevel).map(lvl => (
            <button key={lvl} onClick={() => handleViewAs(lvl)}
              style={{
                padding:'4px 10px', borderRadius:6, border:'1px solid', cursor:'pointer',
                fontSize:10, fontWeight:700, transition:'all 0.12s',
                background:  (viewAs??realLevel)===lvl ? 'var(--c-accent-bg)' : 'transparent',
                color:       (viewAs??realLevel)===lvl ? 'var(--c-accent)'    : 'var(--text-3)',
                borderColor: (viewAs??realLevel)===lvl ? 'var(--c-accent-glow)': 'var(--border)',
              }}>
              L{lvl}{lvl===realLevel ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Sidebar + Content */}
      <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>

        {/* Sidebar nav */}
        <div className="surface" style={{ width:170, flexShrink:0, padding:'6px 0' }}>
          {NAV.map(item => {
            const active = section === item.id;
            return (
              <button key={item.id} onClick={() => setSection(item.id)}
                style={{
                  display:'block', width:'100%', textAlign:'left',
                  padding:'9px 14px', border:'none', cursor:'pointer',
                  background:  active ? 'var(--c-accent-bg)' : 'transparent',
                  color:       active ? 'var(--c-accent)'    : 'var(--text-3)',
                  fontSize:11, fontWeight: active ? 700 : 500,
                  borderLeft:  active ? '2px solid var(--c-accent)' : '2px solid transparent',
                  transition:'all 0.12s',
                }}>
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Content panel */}
        <div style={{ flex:1, minWidth:0 }}>

          {/* ── Hour Requirements ── */}
          {section === 'hours' && (
            <div className="surface" style={{ padding:'18px 20px' }}>
              <SectionTitle title="Hour Requirements" sub="Minimum and goal hours per rank — goal creates the yellow warning zone" />
              <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:16 }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--border)' }}>
                    {['Rank','Type','Min','Goal'].map((h,i) => (
                      <th key={h} style={{ padding:'4px 8px', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-4)', textAlign:i>1?'center':'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rankOrder.map((rank,i) => {
                    const req = hourReqs[rank] || { type:'weekly', hours:2.5 };
                    return (
                      <tr key={rank} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', background:i%2===0?'var(--bg-stripe)':'transparent' }}>
                        <td style={{ padding:'5px 8px', fontSize:11, color:'var(--text-1)', minWidth:150 }}>{rank}</td>
                        <td style={{ padding:'5px 8px' }}>
                          <select style={{ ...inp, width:90 }} value={req.type}
                            onChange={e => setHourReqs(r => ({ ...r, [rank]:{ ...req, type:e.target.value } }))}
                            onFocus={fr} onBlur={fb}>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </td>
                        <td style={{ padding:'5px 8px', textAlign:'center' }}>
                          <input type="number" min="0" step="0.5" style={{ ...inp, width:58, textAlign:'center' }}
                            value={req.hours}
                            onChange={e => setHourReqs(r => ({ ...r, [rank]:{ ...req, hours:parseFloat(e.target.value)||0 } }))}
                            onFocus={fr} onBlur={fb} />
                        </td>
                        <td style={{ padding:'5px 8px', textAlign:'center' }}>
                          <input type="number" min="0" step="0.5" placeholder="—" style={{ ...inp, width:58, textAlign:'center' }}
                            value={req.goal||''}
                            onChange={e => { const v=parseFloat(e.target.value); setHourReqs(r => ({ ...r, [rank]:{ ...req, goal:isNaN(v)?undefined:v } })); }}
                            onFocus={fr} onBlur={fb} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <SaveBtn saving={saving.hour_requirements} saved={saved.hour_requirements} onClick={() => save('hour_requirements', hourReqs)} />
            </div>
          )}

          {/* ── Salaries ── */}
          {section === 'salaries' && (
            <div className="surface" style={{ padding:'18px 20px' }}>
              <SectionTitle title="Salaries" sub="Hourly rate used in payroll calculations" />
              <table style={{ borderCollapse:'collapse', marginBottom:16 }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--border)' }}>
                    {['Rank','$/hr'].map((h,i) => (
                      <th key={h} style={{ padding:'4px 8px', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-4)', textAlign:i===1?'right':'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rankOrder.map((rank,i) => (
                    <tr key={rank} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', background:i%2===0?'var(--bg-stripe)':'transparent' }}>
                      <td style={{ padding:'5px 8px', fontSize:11, color:'var(--text-1)', minWidth:160 }}>{rank}</td>
                      <td style={{ padding:'5px 8px', textAlign:'right' }}>
                        <input type="number" min="0" step="100" style={{ ...inp, width:110, textAlign:'right' }}
                          value={salaries[rank]??0}
                          onChange={e => setSalaries(s => ({ ...s, [rank]:parseInt(e.target.value)||0 }))}
                          onFocus={fr} onBlur={fb} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <SaveBtn saving={saving.salaries} saved={saved.salaries} onClick={() => save('salaries', salaries)} />
            </div>
          )}

          {/* ── Bonus Cycle ── */}
          {section === 'bonuses' && (
            <div className="surface" style={{ padding:'18px 20px' }}>
              <SectionTitle title="Retention Bonus Cycle" sub="Months of tenure → payout amount" />
              <table style={{ borderCollapse:'collapse', marginBottom:10 }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--border)' }}>
                    {['Months','Amount',''].map(h => (
                      <th key={h} style={{ padding:'4px 8px', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-4)', textAlign:'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bonusCycle.map((step,i) => (
                    <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding:'5px 8px' }}>
                        <input type="number" min="1" step="1" style={{ ...inp, width:60 }}
                          value={step.months}
                          onChange={e => setBonusCycle(c => c.map((s,j) => j===i?{...s,months:parseInt(e.target.value)||s.months}:s))}
                          onFocus={fr} onBlur={fb} />
                      </td>
                      <td style={{ padding:'5px 8px' }}>
                        <input type="number" min="0" step="1000" style={{ ...inp, width:120 }}
                          value={step.amount}
                          onChange={e => setBonusCycle(c => c.map((s,j) => j===i?{...s,amount:parseInt(e.target.value)||0}:s))}
                          onFocus={fr} onBlur={fb} />
                      </td>
                      <td style={{ padding:'5px 8px' }}>
                        <button onClick={() => setBonusCycle(c => c.filter((_,j) => j!==i))}
                          style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-4)', transition:'color 0.12s' }}
                          onMouseEnter={e => e.currentTarget.style.color='var(--c-danger)'}
                          onMouseLeave={e => e.currentTarget.style.color='var(--text-4)'}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16 }}>
                <button
                  onClick={() => setBonusCycle(c => [...c, { months:(c[c.length-1]?.months||0)+3, amount:0 }])}
                  style={{ padding:'4px 12px', borderRadius:5, border:'1px solid var(--border)', background:'transparent', color:'var(--text-3)', fontSize:10, fontWeight:700, cursor:'pointer', transition:'all 0.12s' }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--c-accent)';e.currentTarget.style.color='var(--c-accent)';}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text-3)';}}>
                  + Add Milestone
                </button>
              </div>
              <SaveBtn saving={saving.bonus_cycle} saved={saved.bonus_cycle} onClick={() => save('bonus_cycle', bonusCycle)} />
            </div>
          )}

          {/* ── BBCode Templates ── */}
          {section === 'bbcode' && (() => {
            const activeCfg = BBCODE_CONFIGS.find(c => c.key === bbTab) || BBCODE_CONFIGS[0];
            return (
              <div className="surface" style={{ padding:'18px 20px' }}>
                <SectionTitle title="BBCode Templates" sub="Editable forum post templates — use placeholders to auto-fill dynamic content" />

                {/* Sub-tabs — one per config entry */}
                <div style={{ display:'flex', flexWrap:'wrap', borderBottom:'1px solid var(--border)', marginBottom:16 }}>
                  {BBCODE_CONFIGS.map(cfg => (
                    <button key={cfg.key} onClick={() => setBbTab(cfg.key)}
                      style={{
                        padding:'6px 18px', border:'none', cursor:'pointer',
                        fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em',
                        background:   bbTab===cfg.key ? 'var(--c-accent-bg)' : 'transparent',
                        color:        bbTab===cfg.key ? 'var(--c-accent)'    : 'var(--text-3)',
                        borderBottom: bbTab===cfg.key ? '2px solid var(--c-accent)' : '2px solid transparent',
                        transition:'all 0.12s',
                      }}>{cfg.label}</button>
                  ))}
                </div>

                {/* Editor */}
                <textarea
                  key={bbTab}
                  style={{
                    ...inp, width:'100%', minHeight:340, resize:'vertical',
                    fontFamily:'monospace', fontSize:11, lineHeight:1.6,
                    padding:'10px 12px', boxSizing:'border-box', display:'block',
                  }}
                  value={bbTemplates[bbTab] || ''}
                  onChange={e => setBbTemplates(t => ({ ...t, [bbTab]: e.target.value }))}
                  onFocus={fr} onBlur={fb}
                />

                {/* Placeholder reference */}
                <div style={{ marginTop:12, marginBottom:16 }}>
                  <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--text-4)', marginBottom:8 }}>
                    Available Placeholders
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {activeCfg.placeholders.map(p => (
                      <span key={p.key} title={p.desc}
                        style={{
                          padding:'2px 9px', borderRadius:4, cursor:'default',
                          background:'var(--bg-sub)', border:'1px solid var(--border)',
                          fontFamily:'monospace', fontSize:10, color:'var(--c-accent)',
                        }}>
                        {p.key}
                      </span>
                    ))}
                  </div>
                </div>

                <SaveBtn saving={saving.bbcode_templates} saved={saved.bbcode_templates} onClick={() => save('bbcode_templates', bbTemplates)} />
              </div>
            );
          })()}

          {/* ── Discord Reminders ── */}
          {section === 'reminders' && (() => {
            const PLACEHOLDERS = [
              { key:'{title}',          desc:'Event title' },
              { key:'{link}',           desc:'Event link (blank if none)' },
              { key:'{start_full}',     desc:'Start — full date & time in each reader\'s local time (<t:…:F>)' },
              { key:'{start_relative}', desc:'Start — relative, e.g. "in 23 hours" (<t:…:R>)' },
              { key:'{end_full}',       desc:'End — full date & time (<t:…:F>)' },
              { key:'{end_relative}',   desc:'End — relative (<t:…:R>)' },
              { key:'{role}',           desc:'@Supervisor role mention' },
            ];
            const KINDS = [
              { key:'day',  label:'24 Hours Before', rel:'in a day'   },
              { key:'hour', label:'1 Hour Before',   rel:'in an hour' },
            ];
            // Rough preview with a sample event 24h / 1h from now
            const preview = (tpl, kind) => {
              const start = new Date(Date.now() + (kind.key === 'day' ? 864e5 : 36e5));
              const end   = new Date(start.getTime() + 36e5);
              const full  = d => d.toLocaleString(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
              return (tpl || '')
                .replaceAll('{title}', 'Supervisor Meeting')
                .replaceAll('{link}', 'https://example.com/meeting')
                .replaceAll('{start_full}', full(start))
                .replaceAll('{start_relative}', kind.rel)
                .replaceAll('{end_full}', full(end))
                .replaceAll('{end_relative}', kind.key === 'day' ? 'in a day' : 'in 2 hours')
                .replaceAll('{role}', '@Supervisor');
            };
            return (
              <div className="surface" style={{ padding:'18px 20px' }}>
                <SectionTitle title="Discord Reminders" sub="Messages the bot posts for calendar events marked For Supervisors" />
                <div style={{ fontSize:11, color:'var(--text-3)', marginBottom:14, lineHeight:1.5 }}>
                  Discord shows <code>{'{start_relative}'}</code> as e.g. <em>“in 23 hours”</em> — so write <code>which is {'{start_relative}'}</code>, not <code>which is in {'{start_relative}'}</code>.
                  Changes apply to the next reminder sent.
                </div>
                {KINDS.map(kind => {
                  const tpl     = reminders[kind.key] || '';
                  const missing = ['{start_full}', '{start_relative}'].filter(p => !tpl.includes(p));
                  return (
                    <div key={kind.key} style={{ marginBottom:18 }}>
                      <div style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--c-accent)', marginBottom:6 }}>{kind.label}</div>
                      <textarea
                        style={{ ...inp, width:'100%', minHeight:90, fontFamily:'monospace', fontSize:12, padding:'10px 12px', boxSizing:'border-box', display:'block', resize:'vertical' }}
                        value={tpl}
                        onChange={e => setReminders(r => ({ ...r, [kind.key]: e.target.value }))}
                        onFocus={fr} onBlur={fb}
                      />
                      {missing.length > 0 && (
                        <div style={{ marginTop:6, padding:'6px 10px', borderRadius:6, background:'var(--c-warn-bg)', border:'1px solid var(--c-warn-glow)', fontSize:11, color:'var(--c-warning)' }}>
                          Missing {missing.join(' and ')} — the timestamp won’t appear in this reminder.
                        </div>
                      )}
                      <div style={{ marginTop:6, padding:'8px 12px', borderRadius:6, background:'var(--bg-sub)', border:'1px solid var(--border)', fontSize:12, color:'var(--text-2)', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
                        <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--text-4)', marginBottom:4 }}>Preview (approximate)</div>
                        {preview(tpl, kind)}
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--text-4)', marginBottom:8 }}>Available Placeholders</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                    {PLACEHOLDERS.map(p => (
                      <span key={p.key} title={p.desc}
                        style={{ padding:'2px 9px', borderRadius:4, cursor:'default', background:'var(--bg-sub)', border:'1px solid var(--border)', fontFamily:'monospace', fontSize:10, color:'var(--c-accent)' }}>
                        {p.key}
                      </span>
                    ))}
                  </div>
                </div>
                <SaveBtn saving={saving.calendar_reminders} saved={saved.calendar_reminders} onClick={() => save('calendar_reminders', reminders)} />
              </div>
            );
          })()}

          {/* ── Access Control (L3 only) ── */}
          {section === 'access' && realLevel >= 3 && (() => {
            const PAGE_ACTIONS = [
              { page:'roster',      label:'Roster',       actions:[
                { key:'view',           label:'View Roster'                  },
                { key:'add',            label:'Add Employee'                 },
                { key:'promote',        label:'Promote'                      },
                { key:'rename',         label:'Rename'                       },
                { key:'separate',       label:'Separate (Remove)'            },
                { key:'loa',            label:'Add / Adjust LOA'             },
              ]},
              { page:'hours',       label:'Hours',        actions:[
                { key:'view',           label:'View Grid'                    },
                { key:'edit',           label:'Edit Hours Entry'             },
                { key:'delete_entry',   label:'Delete Hours Entry'           },
                { key:'delete_week',    label:'Delete Entire Week'           },
                { key:'compliance',     label:'Non-Compliance Tab'           },
                { key:'warn_bbcode',    label:'Copy Warning BBCode'          },
              ]},
              { page:'payroll',     label:'Payroll',      actions:[
                { key:'view',           label:'View Payroll & Treasury'      },
                { key:'submit',         label:'Submit Payroll'               },
                { key:'add_entry',      label:'Add Treasury Entry'           },
                { key:'delete_entry',   label:'Delete Treasury Entry'        },
                { key:'set_balance',    label:'Set Opening Balance'          },
              ]},
              { page:'bonuses',     label:'Bonuses',      actions:[
                { key:'view',           label:'View Bonuses Page'            },
                { key:'view_quarterly', label:'View Quarterly Bonuses Tab'   },
                { key:'view_retention', label:'View Retention Bonuses Tab'   },
                { key:'pay',            label:'Mark Bonus Paid'              },
                { key:'copy_bbcode',    label:'Copy Quarterly BBCode'        },
              ]},
              { page:'history',     label:'History',      actions:[
                { key:'view',           label:'View History'                 },
              ]},
              { page:'tasks',       label:'Tasks & Ops',  actions:[
                { key:'view',           label:'View Tasks'                   },
                { key:'add',            label:'Add Task'                     },
                { key:'edit',           label:'Edit Task'                    },
                { key:'delete',         label:'Delete Task'                  },
              ]},
              { page:'discussions', label:'Discussions',  actions:[
                { key:'view',           label:'View Discussions'             },
                { key:'add',            label:'Post Discussion'              },
                { key:'delete',         label:'Delete Discussion'            },
                { key:'respond',        label:'Mark Response'                },
              ]},
              { page:'calendar',    label:'Calendar',     actions:[
                { key:'view',           label:'View Calendar'                },
                { key:'add',            label:'Add Event'                    },
                { key:'edit',           label:'Edit Event'                   },
                { key:'delete',         label:'Delete Event'                 },
              ]},
              { page:'admin',       label:'Admin',        actions:[
                { key:'view',           label:'Access Admin Page'            },
                { key:'edit_config',    label:'Edit Configuration'           },
                { key:'edit_bbcode',    label:'Edit BBCode Templates'        },
                { key:'access_control', label:'Edit Access Control'          },
                { key:'view_audit',     label:'View Audit Log'               },
              ]},
            ];

            // All defined levels go in the toggle buttons; custom (>3) also get grant/deny chips
            const allLevels    = Object.keys(levelNames).map(Number).sort((a,b)=>a-b);
            const customLevels = allLevels.filter(n => n > 3);
            const hasCustom    = customLevels.length > 0;

            const setLevel = (page, key, val) =>
              setPagePerms(p => ({ ...p, [page]: { ...(p[page]||{}), [key]: val } }));

            // Cycle custom level through: inherit (0) → grant (1) → deny (2) → inherit
            const cycleCustom = (page, action, lvl) => {
              setPagePerms(p => {
                const curr    = p[page] || {};
                const grants  = { ...(curr._grants || {}) };
                const denies  = { ...(curr._denies || {}) };
                const inGrant = (grants[action] || []).includes(lvl);
                const inDeny  = (denies[action] || []).includes(lvl);
                // current state: grant→deny, deny→inherit, inherit→grant
                grants[action] = (grants[action] || []).filter(l => l !== lvl);
                denies[action] = (denies[action] || []).filter(l => l !== lvl);
                if (inGrant)       denies[action] = [...denies[action], lvl]; // grant → deny
                else if (!inDeny)  grants[action] = [...grants[action], lvl]; // inherit → grant
                // deny → inherit (already removed above)
                return { ...p, [page]: { ...curr, _grants: grants, _denies: denies } };
              });
            };

            const LevelBtn = ({ page, actionKey }) => {
              const current = pagePerms[page]?.[actionKey] ?? 1;
              return (
                <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                  {allLevels.map(lvl => (
                    <button key={lvl} onClick={() => setLevel(page, actionKey, lvl)}
                      title={levelNames[lvl]}
                      style={{
                        padding:'2px 9px', borderRadius:4, border:'1px solid', cursor:'pointer',
                        fontSize:10, fontWeight:700, transition:'all 0.12s',
                        background:  current===lvl ? 'var(--c-accent-bg)' : 'transparent',
                        color:       current===lvl ? 'var(--c-accent)'    : 'var(--text-4)',
                        borderColor: current===lvl ? 'var(--c-accent-glow)': 'var(--border)',
                      }}>
                      L{lvl}
                    </button>
                  ))}
                </div>
              );
            };

            const CustomChips = ({ page, actionKey }) => {
              if (!hasCustom) return null;
              return (
                <div style={{ display:'flex', gap:3, flexWrap:'wrap', paddingLeft:8, borderLeft:'1px solid var(--border)' }}>
                  {customLevels.map(lvl => {
                    const inGrant = (pagePerms[page]?._grants?.[actionKey] || []).includes(lvl);
                    const inDeny  = (pagePerms[page]?._denies?.[actionKey] || []).includes(lvl);
                    const state   = inGrant ? 'grant' : inDeny ? 'deny' : 'inherit';
                    return (
                      <button key={lvl} onClick={() => cycleCustom(page, actionKey, lvl)}
                        title={`${levelNames[lvl]||`L${lvl}`}: ${state==='grant'?'Explicitly allowed':state==='deny'?'Explicitly blocked':'Inherits from numeric level — click to grant, grant to block, block to clear'}`}
                        style={{
                          padding:'2px 7px', borderRadius:4, border:'1px solid', cursor:'pointer',
                          fontSize:9, fontWeight:700, transition:'all 0.12s',
                          background:  state==='grant' ? 'rgba(52,211,153,0.15)' : state==='deny' ? 'rgba(248,113,113,0.15)' : 'transparent',
                          color:       state==='grant' ? 'var(--c-success)'      : state==='deny' ? 'var(--c-danger)'        : 'var(--text-4)',
                          borderColor: state==='grant' ? 'var(--c-succ-glow)'   : state==='deny' ? 'var(--c-danger-glow)'   : 'var(--border)',
                        }}>
                        {state==='grant' ? '✓' : state==='deny' ? '✗' : '·'} L{lvl}
                      </button>
                    );
                  })}
                </div>
              );
            };

            return (
              <div className="surface" style={{ overflow:'hidden' }}>
                <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', background:'rgba(0,0,0,0.20)' }}>
                  <div style={{ fontSize:13, fontWeight:800, color:'var(--text-1)' }}>Access Control</div>
                  <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>
                    <strong style={{ color:'var(--text-2)' }}>Min Level:</strong> select who can do this action — anyone at or above that level gets access.
                    {hasCustom && <span>&ensp;<strong style={{ color:'var(--text-2)' }}>Override chips</strong> (custom roles only): <span style={{ color:'var(--c-success)' }}>✓ always allow</span> · <span style={{ color:'var(--c-danger)' }}>✗ always block</span> · = follow min level. Click to cycle.</span>}
                  </div>
                </div>

                <div style={{ padding:'0 20px 20px' }}>
                  {PAGE_ACTIONS.map((group) => (
                    <div key={group.page} style={{ marginTop:20 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6, paddingBottom:6, borderBottom:'1px solid var(--border)' }}>
                        <span style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--c-accent)' }}>{group.label}</span>
                        {hasCustom && <span style={{ fontSize:9, color:'var(--text-4)', marginLeft:'auto' }}>Min Level · Override (custom roles)</span>}
                        {!hasCustom && <span style={{ flex:1, height:1, background:'var(--border)' }} />}
                      </div>
                      <table style={{ width:'100%', borderCollapse:'collapse' }}>
                        <tbody>
                          {group.actions.map((action, ai) => (
                            <tr key={action.key} style={{
                              borderBottom: ai < group.actions.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                              background: ai%2===0 ? 'var(--bg-stripe)' : 'transparent',
                            }}>
                              <td style={{ padding:'7px 10px', fontSize:12, color:'var(--text-2)', width:'40%' }}>
                                {action.label}
                              </td>
                              <td style={{ padding:'5px 10px' }}>
                                <LevelBtn page={group.page} actionKey={action.key} />
                              </td>
                              <td style={{ padding:'5px 10px' }}>
                                <CustomChips page={group.page} actionKey={action.key} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}

                  <div style={{ marginTop:20, marginBottom:16, padding:'10px 12px', borderRadius:8, background:'var(--c-warn-bg)', border:'1px solid var(--c-warn-glow)', fontSize:11, color:'var(--c-warning)' }}>
                    L3 always retains full access regardless of settings here.
                  </div>
                  <SaveBtn saving={saving.page_permissions} saved={saved.page_permissions} onClick={() => save('page_permissions', pagePerms)} />
                </div>
              </div>
            );
          })()}

          {/* ── Discord Roles (L3 only) ── */}
          {section === 'permissions' && realLevel >= 3 && (() => {
            const sortedLvls = Object.keys(levelNames).map(Number).sort((a,b)=>a-b);

            const LvlSelect = ({ value, onChange }) => (
              <select style={{ ...inp, minWidth:140 }} value={value} onChange={e => onChange(parseInt(e.target.value))} onFocus={fr} onBlur={fb}>
                {sortedLvls.map(n => (
                  <option key={n} value={n}>L{n} — {levelNames[n] || `Level ${n}`}</option>
                ))}
              </select>
            );

            return (
              <div className="space-y-3">

                {/* ── Level Definitions ── */}
                <div className="surface" style={{ padding:'18px 20px' }}>
                  <SectionTitle title="Permission Levels" sub="Define the access levels used across the dashboard" />

                  <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:12 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--border)' }}>
                        {['#','Name',''].map((h,i) => (
                          <th key={h} style={{ padding:'4px 8px', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-4)', textAlign:'left', width: i===0?'60px': i===2?'36px':undefined }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLvls.map((num, i) => (
                        <tr key={num} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', background: i%2===0?'var(--bg-stripe)':'transparent' }}>
                          <td style={{ padding:'5px 8px', fontFamily:'monospace', fontSize:12, fontWeight:700, color:'var(--c-accent)' }}>L{num}</td>
                          <td style={{ padding:'5px 8px' }}>
                            <input style={{ ...inp, width:'100%', maxWidth:260 }}
                              value={levelNames[num] || ''}
                              onChange={e => setLevelNames(n => ({ ...n, [num]: e.target.value }))}
                              onFocus={fr} onBlur={fb} />
                          </td>
                          <td style={{ padding:'5px 8px' }}>
                            <button
                              onClick={() => setLevelNames(n => { const x={...n}; delete x[num]; return x; })}
                              style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-4)', transition:'color 0.12s' }}
                              onMouseEnter={e => e.currentTarget.style.color='var(--c-danger)'}
                              onMouseLeave={e => e.currentTarget.style.color='var(--text-4)'}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Add new level */}
                  <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:16 }}>
                    <input type="number" min="1" step="1" placeholder="Level #" style={{ ...inp, width:80 }}
                      value={newLvlNum} onChange={e => setNewLvlNum(e.target.value)} onFocus={fr} onBlur={fb} />
                    <input placeholder="Name (e.g. Consultant)" style={{ ...inp, flex:1, maxWidth:220 }}
                      value={newLvlName} onChange={e => setNewLvlName(e.target.value)} onFocus={fr} onBlur={fb} />
                    <button
                      onClick={() => {
                        const n = parseInt(newLvlNum);
                        if (!n || !newLvlName.trim()) return;
                        setLevelNames(l => ({ ...l, [n]: newLvlName.trim() }));
                        setNewLvlNum(''); setNewLvlName('');
                      }}
                      className="btn-primary" style={{ padding:'4px 14px', fontSize:11 }}>
                      Add Level
                    </button>
                  </div>
                  <SaveBtn saving={saving.level_names} saved={saved.level_names} onClick={() => save('level_names', levelNames)} />
                </div>

                {/* ── Discord Role Mappings ── */}
                <div className="surface" style={{ padding:'18px 20px' }}>
                  <SectionTitle title="Discord Role Mappings" sub="Assign a permission level to each Discord role ID" />
                  <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:10 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--border)' }}>
                        {['Role ID','Level',''].map(h => (
                          <th key={h} style={{ padding:'4px 8px', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-4)', textAlign:'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(permRoles).map(([roleId, lvl], i) => (
                        <tr key={roleId} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)', background: i%2===0?'var(--bg-stripe)':'transparent' }}>
                          <td style={{ padding:'5px 8px', fontFamily:'monospace', fontSize:11, color:'var(--text-2)', minWidth:220 }}>{roleId}</td>
                          <td style={{ padding:'5px 8px' }}>
                            <LvlSelect value={lvl} onChange={v => setPermRoles(r => ({ ...r, [roleId]: v }))} />
                          </td>
                          <td style={{ padding:'5px 8px' }}>
                            <button onClick={() => setPermRoles(r => { const n={...r}; delete n[roleId]; return n; })}
                              style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-4)', transition:'color 0.12s' }}
                              onMouseEnter={e => e.currentTarget.style.color='var(--c-danger)'}
                              onMouseLeave={e => e.currentTarget.style.color='var(--text-4)'}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:16 }}>
                    <input style={{ ...inp, width:220 }} placeholder="Discord Role ID" value={newRoleId}
                      onChange={e => setNewRoleId(e.target.value)} onFocus={fr} onBlur={fb} />
                    <LvlSelect value={newRoleLvl} onChange={setNewRoleLvl} />
                    <button
                      onClick={() => { if (!newRoleId.trim()) return; setPermRoles(r => ({...r,[newRoleId.trim()]:newRoleLvl})); setNewRoleId(''); }}
                      className="btn-primary" style={{ padding:'4px 14px', fontSize:11 }}>
                      Add
                    </button>
                  </div>
                  <SaveBtn saving={saving.permission_roles} saved={saved.permission_roles} onClick={() => save('permission_roles', permRoles)} />
                </div>

              </div>
            );
          })()}

          {/* ── Audit Log ── */}
          {section === 'audit' && (
            <div className="surface overflow-hidden">
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                  {filteredAudit.length} events
                </span>
                <input
                  style={{ ...inp, marginLeft:'auto', width:240 }}
                  placeholder="Search user, action, details…"
                  value={auditSearch}
                  onChange={e => setAuditSearch(e.target.value)}
                  onFocus={fr} onBlur={fb}
                />
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table style={{ width:'100%', borderCollapse:'collapse', minWidth:600 }}>
                  <thead>
                    <tr style={{ background:'var(--bg-sub)', borderBottom:'1px solid var(--border)' }}>
                      {['Timestamp','User','Action','Details'].map(h => (
                        <th key={h} style={{ padding:'6px 14px', fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-4)', textAlign:'left', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudit.length === 0 ? (
                      <tr><td colSpan={4} style={{ padding:'32px', textAlign:'center', color:'var(--text-4)', fontStyle:'italic', fontSize:12 }}>No events found.</td></tr>
                    ) : filteredAudit.map((r,i) => (
                      <tr key={r.id} style={{ borderBottom:'1px solid var(--border)', background:i%2===0?'var(--bg-stripe)':'transparent' }}>
                        <td style={{ padding:'5px 14px', fontSize:11, fontFamily:'monospace', color:'var(--text-4)', whiteSpace:'nowrap' }}>{r.timestamp}</td>
                        <td style={{ padding:'5px 14px', fontSize:11, fontWeight:600, color:'var(--c-accent)', whiteSpace:'nowrap' }}>{r.username||'—'}</td>
                        <td style={{ padding:'5px 14px', fontSize:11, color:'var(--text-1)', whiteSpace:'nowrap' }}>{r.action}</td>
                        <td style={{ padding:'5px 14px', fontSize:11, color:'var(--text-3)' }}>{r.details||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
