"use client";
import { useState, useEffect } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    const saved = localStorage.getItem('lsems-theme') || 'dark';
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('lsems-theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}
      className="flex items-center justify-center w-8 h-8 rounded-lg border transition-colors hover:border-[var(--border-hi)] hover:text-[var(--text-2)] text-base leading-none"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
