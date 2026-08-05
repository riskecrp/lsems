"use client";
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';

const NAV_LINKS = [
  { href: '/',         label: 'Roster'    },
  { href: '/hours',    label: 'Hours'     },
  { href: '/payroll',  label: 'Payroll'   },
  { href: '/bonuses',  label: 'Bonuses'   },
  { href: '/history',  label: 'History'   },
];

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setIsOpen(false); }, [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 sticky top-0 z-40 border-b glass"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold border"
            style={{ background: 'var(--c-accent-bg)', borderColor: 'var(--c-accent)', color: 'var(--c-accent)' }}>
            LS
          </div>
          <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--text-1)' }}>
            LSEMS
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button onClick={() => setIsOpen(!isOpen)} className="p-1.5 text-lg leading-none transition-colors"
            style={{ color: 'var(--text-3)' }}>
            {isOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        className={`${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:sticky top-[52px] md:top-0 left-0 h-[calc(100vh-52px)] md:h-screen w-56 flex flex-col z-40 md:z-auto transition-transform duration-300 border-r glass`}
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        {/* Logo — desktop */}
        <div className="hidden md:flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold border flex-shrink-0"
            style={{ background: 'var(--c-accent-bg)', borderColor: 'var(--c-accent)', color: 'var(--c-accent)' }}>
            LS
          </div>
          <div>
            <div className="text-[12px] font-bold tracking-widest uppercase leading-tight" style={{ color: 'var(--text-1)' }}>
              LSEMS
            </div>
            <div className="text-[9px] tracking-wider mt-0.5" style={{ color: 'var(--text-4)' }}>
              Management Suite
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-0.5 overflow-y-auto">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href || (href !== '/' && pathname?.startsWith(href));
            return (
              <Link key={href} href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-colors border"
                style={{
                  background:  isActive ? 'linear-gradient(90deg, var(--c-accent-bg) 0%, transparent 100%)' : 'transparent',
                  color:       isActive ? 'var(--c-accent)' : 'var(--text-3)',
                  borderLeft:  isActive ? '2px solid var(--c-accent)' : '2px solid transparent',
                  borderTop:    'none', borderRight: 'none', borderBottom: 'none',
                  boxShadow:   isActive ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : 'none',
                }}>
                {label}
              </Link>
            );
          })}
          {NAV_LINKS.length === 0 && (
            <div className="px-3 py-2 text-[10px] italic" style={{ color: 'var(--text-4)' }}>
              No pages yet
            </div>
          )}
        </nav>

        {/* Footer: theme toggle */}
        <div className="px-3 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-4)' }}>
            Appearance
          </span>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div onClick={() => setIsOpen(false)}
          className="md:hidden fixed inset-0 top-[52px] z-30"
          style={{ background: 'rgba(0,0,0,0.5)' }} />
      )}
    </>
  );
}
