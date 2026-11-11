"use client";
import { useState, useEffect, useRef } from 'react';

// Navbar skull button. Hover (or tap / keyboard focus) shows Carter's Kill
// Count in a small bubble under the icon.
export default function KillCount({ count = 0 }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);   // tap/click keeps it open (touch screens)
  const ref = useRef(null);
  const open = hover || pinned;

  useEffect(() => {
    if (!pinned) return;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setPinned(false); };
    const esc   = e => { if (e.key === 'Escape') setPinned(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [pinned]);

  return (
    <div ref={ref} style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        aria-label={`Carter's Kill Count: ${Number(count).toLocaleString()}`}
        aria-expanded={open}
        onClick={() => setPinned(p => !p)}
        onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        className="flex items-center justify-center w-8 h-8 rounded-lg border transition-colors"
        style={{
          color:       open ? 'var(--c-accent)' : 'var(--text-3)',
          borderColor: open ? 'var(--c-accent-glow)' : 'var(--border)',
          background:  open ? 'var(--c-accent-bg)' : 'transparent',
          cursor: 'pointer',
        }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3C7.6 3 4 6.3 4 10.5c0 2.4 1.1 4.4 3 5.8V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.7c1.9-1.4 3-3.4 3-5.8C20 6.3 16.4 3 12 3Z" />
          <circle cx="9" cy="11" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="15" cy="11" r="1.6" fill="currentColor" stroke="none" />
          <path d="M12 13.5l-.9 1.6h1.8z" fill="currentColor" stroke="none" />
          <path d="M10 20v-2M14 20v-2" />
        </svg>
      </button>

      <div role="tooltip" style={{
        position: 'absolute', top: 'calc(100% + 10px)', left: '50%',
        transform: `translateX(-50%) translateY(${open ? 0 : -4}px)`,
        opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
        transition: 'opacity 0.14s ease, transform 0.14s ease',
        zIndex: 60,
      }}>
        {/* arrow */}
        <div style={{
          position: 'absolute', top: -5, left: '50%', width: 10, height: 10,
          transform: 'translateX(-50%) rotate(45deg)',
          background: 'linear-gradient(var(--bg-card), var(--bg-card)), var(--bg-page)', borderLeft: '1px solid var(--border-hi)', borderTop: '1px solid var(--border-hi)',
        }} />
        <div style={{
          // Solid: card colour layered on the page colour, so nothing shows through.
          background: 'linear-gradient(var(--bg-card), var(--bg-card)), var(--bg-page)', border: '1px solid var(--border-hi)', borderRadius: 10,
          padding: '8px 14px', textAlign: 'center', whiteSpace: 'nowrap',
          boxShadow: '0 10px 28px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.25)',
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>
            Carter&apos;s Kill Count
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-accent)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
            {Number(count).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
