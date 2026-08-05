"use client";
import { useState } from 'react';
import { fmtDate } from '../constants';

const T = {
  t1: { color:'var(--text-1)' }, t2: { color:'var(--text-2)' }, t3: { color:'var(--text-3)' },
};

export default function HistoryClient({ rankHistory }) {
  const [search, setSearch] = useState('');

  const filtered = rankHistory.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">

      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div>
          <h1 style={{ fontSize:18, fontWeight:800, color:'var(--text-1)', lineHeight:1 }}>Employee History</h1>
          <p style={{ fontSize:11, color:'var(--text-3)', marginTop:3 }}>
            {rankHistory.length} rank events
          </p>
        </div>
        <div style={{ marginLeft:'auto' }}>
          <input type="text" placeholder="Search…" className="lsems-input" style={{ width:180 }}
            value={search} onChange={e => setSearch(e.target.value)}
            onFocus={e => { e.currentTarget.style.borderColor='var(--c-accent)'; e.currentTarget.style.boxShadow='0 0 0 3px var(--c-accent-glow)'; }}
            onBlur={e  => { e.currentTarget.style.borderColor='var(--border)';   e.currentTarget.style.boxShadow='none'; }} />
        </div>
      </div>

      <div className="surface" style={{ overflow:'hidden' }}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="lsems-table" style={{ minWidth:520 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>From</th>
                <th>To</th>
                <th>Authorized By</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding:'40px 16px', textAlign:'center', color:'var(--text-3)', fontStyle:'italic' }}>No records.</td></tr>
              ) : filtered.map((r, i) => {
                const isSep  = r.newRank === 'SEPARATED';
                const isHire = !r.oldRank;
                return (
                  <tr key={i}>
                    <td style={{ fontFamily:'monospace', fontSize:11, color:'var(--text-3)' }}>{r.date}</td>
                    <td style={{ fontWeight:600, color:'var(--text-1)' }}>{r.name}</td>
                    <td style={{ color:'var(--text-2)' }}>{r.oldRank || <span className="pill pill-success" style={{ fontSize:9 }}>New Hire</span>}</td>
                    <td>
                      <span className={`pill ${isSep ? 'pill-danger' : isHire ? 'pill-success' : 'pill-accent'}`} style={{ fontSize:9 }}>
                        {r.newRank}
                      </span>
                    </td>
                    <td style={{ color:'var(--text-3)', fontSize:11 }}>{r.authorizer}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
