"use client";
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import ThemeToggle from './ThemeToggle';
import { getMyProfile, setMyProfile } from './actions';

const ALL_NAV = [
  { href: '/',               label: 'Roster'           },
  { href: '/hours',          label: 'Hours'            },
  { href: '/payroll',        label: 'Payroll'          },
  { href: '/bonuses',        label: 'Bonuses'          },
  { href: '/tasks',          label: 'Operations'       },
  { href: '/calendar',       label: 'Calendar'         },
  { href: '/history',        label: 'Employee History' },
  { href: '/past-employees', label: 'Past Employees'   },
  { href: '/admin',          label: 'Admin'            },
];

export default function Navbar({ session, viewAs, pageViewLevels = {} }) {
  const pathname       = usePathname();
  const realLevel      = session?.level ?? 1;
  const effectiveLevel = viewAs ?? realLevel;
  const [profileOpen, setProfileOpen] = useState(false);
  const [charName,    setCharName]    = useState('');
  const [sigImage,    setSigImage]    = useState('');
  const [profSaving,  setProfSaving]  = useState(false);
  const [profSaved,   setProfSaved]   = useState(false);

  useEffect(() => {
    if (profileOpen) {
      getMyProfile().then(p => { if (p) { setCharName(p.character_name || ''); setSigImage(p.sig_image || ''); } });
    }
  }, [profileOpen]);

  const saveProfile = async () => {
    setProfSaving(true);
    await setMyProfile({ characterName: charName, sigImage });
    setProfSaving(false); setProfSaved(true);
    setTimeout(() => setProfSaved(false), 2000);
  };
  const NAV = ALL_NAV.filter(n => effectiveLevel >= (pageViewLevels[n.href] ?? 1));

  const avatarUrl = session?.avatar && session?.userId
    ? `https://cdn.discordapp.com/avatars/${session.userId}/${session.avatar}.png?size=32`
    : null;

  return (
    <>
    <header className="sticky top-0 z-50 w-full" style={{
      background: 'var(--nav-bg)',
      backdropFilter: 'blur(28px)',
      WebkitBackdropFilter: 'blur(28px)',
      borderBottom: '1px solid var(--border)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.40)',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: 'linear-gradient(90deg, transparent 0%, var(--c-accent) 30%, rgba(210,50,50,0.4) 70%, transparent 100%)',
        opacity: 0.8,
      }} />

      <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-14 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2.5 flex-shrink-0 group">
          <Image src="/lsems-logo.png" alt="LSEMS" width={34} height={34}
            style={{ borderRadius: 6, flexShrink: 0 }} priority />
          <div className="hidden sm:block leading-none">
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-1)', lineHeight: 1 }}>LSEMS</div>
            <div style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--text-3)', marginTop: 2, lineHeight: 1 }}>Management Suite</div>
          </div>
        </Link>

        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

        <nav className="flex items-stretch flex-1 overflow-x-auto h-14" style={{ scrollbarWidth: 'none' }}>
          {NAV.map(({ href, label }) => {
            const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
            return (
              <Link key={href} href={href}
                className="relative flex items-center px-3.5 transition-colors whitespace-nowrap"
                style={{
                  fontSize: 11, fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: active ? 'var(--c-accent)' : 'var(--text-3)',
                  textShadow: active ? '0 0 20px var(--c-accent-glow)' : 'none',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-1)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-3)'; }}>
                {label}
                {active && (
                  <span style={{
                    position: 'absolute', bottom: 0, left: 6, right: 6, height: 2,
                    borderRadius: '2px 2px 0 0',
                    background: 'linear-gradient(90deg, transparent, var(--c-accent), transparent)',
                    boxShadow: '0 0 10px var(--c-accent-glow)',
                  }} />
                )}
              </Link>
            );
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {viewAs && viewAs !== realLevel && (
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                background: 'var(--c-accent-bg)', color: 'var(--c-accent)',
                border: '1px solid var(--c-accent-glow)', textTransform: 'uppercase',
              }}>
                Viewing as L{viewAs}
              </span>
              <button
                onClick={async () => {
                  await fetch('/api/auth/viewas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ viewAs: realLevel }),
                  });
                  window.location.reload();
                }}
                style={{
                  padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.07em', cursor: 'pointer',
                  background: 'var(--c-succ-bg)', color: 'var(--c-success)',
                  border: '1px solid var(--c-succ-glow)', transition: 'all 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity='0.8'}
                onMouseLeave={e => e.currentTarget.style.opacity='1'}>
                Return
              </button>
            </div>
          )}
          <ThemeToggle />
          {session && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              {avatarUrl && (
                <img src={avatarUrl} alt="" width={24} height={24}
                  style={{ borderRadius: '50%', border: '1px solid var(--border)' }} />
              )}
              <button onClick={() => setProfileOpen(true)}
                style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontSize:11, color:'var(--text-3)', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', transition:'color 0.12s' }}
                onMouseEnter={e=>e.currentTarget.style.color='var(--text-1)'}
                onMouseLeave={e=>e.currentTarget.style.color='var(--text-3)'}
                title="Edit your profile">
                {session.displayName || session.username}
              </button>
              <a href="/api/auth/logout" style={{
                padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-4)', fontSize: 10,
                fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
                cursor: 'pointer', textDecoration: 'none', transition: 'all 0.12s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--c-danger)'; e.currentTarget.style.borderColor = 'var(--c-danger-glow)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
                Logout
              </a>
            </div>
          )}
        </div>
      </div>
    </header>

    {/* Profile modal — outside <header> to avoid sticky stacking context */}
    {profileOpen && (
      <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.80)', zIndex:9999 }}
        onClick={() => setProfileOpen(false)}>
        <div className="surface glass-modal p-5 w-full max-w-sm" style={{ borderRadius:16 }} onClick={e=>e.stopPropagation()}>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--text-1)', marginBottom:4 }}>My Profile</div>
          <div style={{ fontSize:11, color:'var(--text-3)', marginBottom:16 }}>
            Signed in as <strong style={{ color:'var(--text-2)' }}>{session?.displayName || session?.username}</strong>
          </div>
          <div className="space-y-3 mb-4">
            <div>
              <label style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)', display:'block', marginBottom:6 }}>Character Name</label>
              <input className="lsems-input" placeholder="e.g. CeeCee Rhodes"
                value={charName} onChange={e=>setCharName(e.target.value)}
                onFocus={e=>{e.currentTarget.style.borderColor='var(--c-accent)';e.currentTarget.style.boxShadow='0 0 0 3px var(--c-accent-glow)';}}
                onBlur={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.boxShadow='none';}} />
              <div style={{ fontSize:10, color:'var(--text-4)', marginTop:4 }}>Used as the authorizer on promotions, separations, and other actions.</div>
            </div>
            <div>
              <label style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-3)', display:'block', marginBottom:6 }}>Signature Image URL</label>
              <input className="lsems-input" placeholder="https://i.ibb.co/..."
                value={sigImage} onChange={e=>setSigImage(e.target.value)}
                onFocus={e=>{e.currentTarget.style.borderColor='var(--c-accent)';e.currentTarget.style.boxShadow='0 0 0 3px var(--c-accent-glow)';}}
                onBlur={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.boxShadow='none';}} />
              <div style={{ fontSize:10, color:'var(--text-4)', marginTop:4 }}>Used in BBCode post footers.</div>
            </div>
          </div>
          <div style={{ textAlign:'center', marginBottom:12 }}>
            <a href="/guide" target="_blank" rel="noreferrer"
              style={{ fontSize:11, color:'var(--c-accent)', textDecoration:'none', fontWeight:600, letterSpacing:'0.04em', transition:'opacity 0.12s' }}
              onMouseEnter={e=>e.currentTarget.style.opacity='0.7'}
              onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
              📋 Dashboard Guide &amp; Help →
            </a>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setProfileOpen(false)} className="btn-ghost" style={{ flex:1, textAlign:'center' }}>Cancel</button>
            <button disabled={profSaving} onClick={saveProfile} className="btn-primary"
              style={{ flex:1, justifyContent:'center', background: profSaved ? 'linear-gradient(135deg,#059669,#047857)' : undefined }}>
              {profSaving ? 'Saving…' : profSaved ? '✓ Saved' : 'Save Profile'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
