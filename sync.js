/**
 * LSEMS — Google Sheets ↔ SQLite Sync Utility
 *
 * Pull (Sheet → DB):   node sync.js pull
 * Status check:        node sync.js status
 *
 * For push (DB → Sheet), the service accounts need Editor access on the
 * spreadsheets. Grant access in Google Sheets → Share → paste the service
 * account email with Editor role, then: node sync.js push
 */

import { createSign } from 'crypto';
import Database        from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath }    from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Credentials ───────────────────────────────────────────────
process.loadEnvFile('/opt/lsems/.env');

const LSEMS_EMAIL = 'lsems-dashboard@lsems-dashboard.iam.gserviceaccount.com';
const LSEMS_KEY   = process.env.GOOGLE_LSEMS_PRIVATE_KEY.replace(/\\n/g, '\n');
const LSEMS_SHEET = '1GxWLb11Txy39o7DKtaAL22hvfgLYi8aIj3rCgHL-WGs';

const TASKS_EMAIL = 'supervisortasks-service@lsems-tasks.iam.gserviceaccount.com';
const TASKS_KEY   = process.env.GOOGLE_TASKS_PRIVATE_KEY.replace(/\\n/g, '\n');
const TASKS_SHEET = '1izZOyJ6ZbXlPZWPKwffb6wHAEjjR-IGEF-aZ2XD-2_4';

const DB_PATH = '/opt/lsems/data/lsems.db';

// ── Auth helpers ──────────────────────────────────────────────
function b64url(s) { return Buffer.from(s).toString('base64url'); }
function makeJwt(email, key, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ iss: email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const s = createSign('RSA-SHA256'); s.update(`${h}.${p}`);
  return `${h}.${p}.${s.sign(key, 'base64url')}`;
}
async function getToken(email, key, write = false) {
  const scope = write
    ? 'https://www.googleapis.com/auth/spreadsheets'
    : 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: makeJwt(email, key, scope) }) });
  const d = await r.json();
  if (!d.access_token) throw new Error('Auth failed: ' + JSON.stringify(d));
  return d.access_token;
}
async function getSheet(token, sheetId, name) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.values || [];
}
async function clearAndWrite(token, sheetId, name, values) {
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(name)}:clear`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(name)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range: name, values }),
  });
}

function parseAnyDate(s) {
  if (!s) return null;
  const m1 = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (m1) { const M = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 }; return new Date(+m1[3], M[m1[2]], +m1[1]); }
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return new Date(+m2[3], +m2[1]-1, +m2[2]);
  return null;
}
function parseNum(v) { const n = parseFloat(String(v||'').replace(/[$,]/g,'')); return isNaN(n) ? 0 : n; }

const cmd = process.argv[2] || 'status';

// ══════════════════════════════════════════════════════════════
// STATUS — compare sheet vs DB
// ══════════════════════════════════════════════════════════════
if (cmd === 'status') {
  const db = new Database(DB_PATH);
  const [lsemsToken, tasksToken] = await Promise.all([getToken(LSEMS_EMAIL, LSEMS_KEY), getToken(TASKS_EMAIL, TASKS_KEY)]);

  console.log('\n📊  LSEMS Sheet vs DB\n' + '─'.repeat(40));
  for (const [sheet, table, col] of [['Employees','employees','name'],['Past Employees','past_employees','name'],['Rank History','rank_history','name'],['Treasury','treasury','type']]) {
    const rows = (await getSheet(lsemsToken, LSEMS_SHEET, sheet)).slice(1).filter(r=>r[0]?.trim()).length;
    const dbCount = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get().n;
    const status = rows === dbCount ? '✓' : rows > dbCount ? `⚠ sheet +${rows-dbCount}` : `⚠ DB +${dbCount-rows}`;
    console.log(`  ${sheet.padEnd(20)} sheet:${String(rows).padStart(4)}  db:${String(dbCount).padStart(4)}  ${status}`);
  }

  console.log('\n📊  Supervisortasks Sheet vs DB\n' + '─'.repeat(40));
  const [taskRows, histRows, nameRows, discRows] = await Promise.all([
    getSheet(tasksToken, TASKS_SHEET, 'Tasks'),
    getSheet(tasksToken, TASKS_SHEET, 'Historical Tasks'),
    getSheet(tasksToken, TASKS_SHEET, 'Names'),
    getSheet(tasksToken, TASKS_SHEET, 'Discussions Pending Feedback'),
  ]);
  const sheetActive = taskRows.slice(1).filter(r=>r[0]?.trim()).length;
  const sheetHist   = histRows.slice(1).filter(r=>r[0]?.trim()).length;
  const dbActive    = db.prepare('SELECT COUNT(*) as n FROM sup_tasks WHERE is_historical=0').get().n;
  const dbHist      = db.prepare('SELECT COUNT(*) as n FROM sup_tasks WHERE is_historical=1').get().n;
  console.log(`  Tasks (active)       sheet:${String(sheetActive).padStart(4)}  db:${String(dbActive).padStart(4)}  ${sheetActive===dbActive?'✓':'⚠ diff'}`);
  console.log(`  Tasks (historical)   sheet:${String(sheetHist).padStart(4)}  db:${String(dbHist).padStart(4)}  ${sheetHist===dbHist?'✓':'⚠ diff'}`);
  console.log(`  Supervisors          sheet:${String(nameRows.length-1).padStart(4)}  db:${String(db.prepare('SELECT COUNT(*) as n FROM supervisors').get().n).padStart(4)}`);
  console.log(`  Discussions          sheet:${String(discRows.length-1).padStart(4)}  db:${String(db.prepare('SELECT COUNT(*) as n FROM sup_discussions').get().n).padStart(4)}`);

  db.close();
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════
// PULL — Sheet → DB (imports new/missing records)
// ══════════════════════════════════════════════════════════════
if (cmd === 'pull') {
  console.log('\n⬇️   Pulling from Google Sheets → SQLite\n' + '─'.repeat(40));
  const db = new Database(DB_PATH);
  db.pragma('journal_mode=WAL');
  db.pragma('foreign_keys=ON');

  const [lsemsToken, tasksToken] = await Promise.all([
    getToken(LSEMS_EMAIL, LSEMS_KEY),
    getToken(TASKS_EMAIL, TASKS_KEY),
  ]);

  // ── LSEMS: Employees ─────────────────────────────────────────
  {
    const rows = await getSheet(lsemsToken, LSEMS_SHEET, 'Employees');
    const headers = rows[0];
    const insEmp = db.prepare('INSERT OR IGNORE INTO employees (name,rank,hire_date,last_promotion) VALUES (?,?,?,?)');
    const insHrs = db.prepare('INSERT OR REPLACE INTO employee_hours (employee_name,week_ending,hours) VALUES (?,?,?)');
    const weekHeaders = headers.slice(6);
    let empAdded=0, hrsAdded=0;
    db.transaction(() => {
      for (const row of rows.slice(1)) {
        const name = (row[0]||'').trim(); if (!name) continue;
        const rank=(row[1]||'').trim(), hire=(row[2]||'').trim(), promo=(row[3]||'').trim();
        if (!rank || !hire) continue;
        const r = insEmp.run(name,rank,hire,promo||null); if (r.changes) empAdded++;
        weekHeaders.forEach((w,i) => {
          const h = parseNum(row[6+i]);
          if (h > 0) { insHrs.run(name,w,h); hrsAdded++; }
        });
      }
    })();
    console.log(`  Employees: +${empAdded} new  |  Hours: ${hrsAdded} upserted`);
  }

  // ── LSEMS: Past Employees ────────────────────────────────────
  {
    const rows = await getSheet(lsemsToken, LSEMS_SHEET, 'Past Employees');
    const existing = new Set(db.prepare('SELECT name FROM past_employees').all().map(r=>r.name.toLowerCase()));
    const ins = db.prepare('INSERT INTO past_employees (name,date_separated,exit_rank,authorizer,hire_date,total_hours) VALUES (?,?,?,?,?,?)');
    let added=0;
    db.transaction(() => {
      for (const r of rows.slice(1)) {
        const n=(r[0]||'').trim(); if(!n)continue;
        if (existing.has(n.toLowerCase())) continue;
        ins.run(n,r[1]||'',r[2]||'',r[3]||'',r[4]||null,parseNum(r[5])); added++;
      }
    })();
    console.log(`  Past Employees: +${added} new`);
  }

  // ── LSEMS: Rank History ──────────────────────────────────────
  {
    const rows = await getSheet(lsemsToken, LSEMS_SHEET, 'Rank History');
    const ins = db.prepare('INSERT INTO rank_history (event_date,name,old_rank,new_rank,authorizer) VALUES (?,?,?,?,?)');
    const existing = new Set(db.prepare('SELECT event_date,name,new_rank FROM rank_history').all().map(r=>`${r.event_date}|${r.name}|${r.new_rank}`.toLowerCase()));
    let added=0;
    db.transaction(() => {
      for (const r of rows.slice(1)) {
        const name=(r[1]||r[0]||'').trim(), newRank=(r[3]||r[4]||'').trim();
        if (!name||!newRank) continue;
        const key=`${r[0]}|${name}|${newRank}`.toLowerCase();
        if (existing.has(key)) continue;
        ins.run(r[0]||'',name,r[2]||null,newRank,r[4]||r[3]||''); added++;
      }
    })();
    console.log(`  Rank History: +${added} new`);
  }

  // ── LSEMS: Treasury ──────────────────────────────────────────
  {
    const rows = await getSheet(lsemsToken, LSEMS_SHEET, 'Treasury');
    const ins = db.prepare('INSERT INTO treasury (timestamp,type,amount,balance,notes) VALUES (?,?,?,?,?)');
    const existing = new Set(db.prepare('SELECT timestamp,type FROM treasury').all().map(r=>`${r.timestamp}|${r.type}`.toLowerCase()));
    let added=0;
    db.transaction(() => {
      for (const r of rows.slice(1)) {
        const type=(r[1]||'').trim(); if(!type)continue;
        const key=`${r[0]}|${type}`.toLowerCase();
        if (existing.has(key)) continue;
        ins.run(r[0]||'',type,parseNum(r[2]),parseNum(r[3]),r[4]||null); added++;
      }
    })();
    console.log(`  Treasury: +${added} new`);
  }

  // ── Supervisortasks: Tasks ───────────────────────────────────
  {
    const [taskRows, histRows] = await Promise.all([
      getSheet(tasksToken, TASKS_SHEET, 'Tasks'),
      getSheet(tasksToken, TASKS_SHEET, 'Historical Tasks'),
    ]);
    const ins = db.prepare('INSERT OR IGNORE INTO sup_tasks (task_name,owner,status,assigned_date,due_date,completed_date,notes,is_historical) VALUES (?,?,?,?,?,?,?,?)');
    const existing = new Set(db.prepare('SELECT task_name FROM sup_tasks').all().map(r=>r.task_name.toLowerCase()));
    let added=0;
    db.transaction(() => {
      for (const [rows, isHist] of [[taskRows,0],[histRows,1]]) {
        for (const r of rows.slice(1)) {
          const name=(r[0]||'').trim(); if(!name)continue;
          if (existing.has(name.toLowerCase())) continue;
          ins.run(name,r[1]||null,r[2]||'Assigned',r[3]||null,r[4]||null,r[5]||null,r[6]||null,isHist); added++;
        }
      }
    })();
    console.log(`  Sup Tasks: +${added} new`);
  }

  db.close();
  console.log('\n✅  Pull complete');
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════
// PUSH — DB → Sheet (overwrites sheet with current DB data)
// Requires Editor access on both spreadsheets for the service accounts
// ══════════════════════════════════════════════════════════════
if (cmd === 'push') {
  console.log('\n⬆️   Pushing SQLite → Google Sheets\n' + '─'.repeat(40));
  console.log('⚠️  This overwrites the sheet data with the current DB contents.');
  const db = new Database(DB_PATH);

  const [lsemsToken, tasksToken] = await Promise.all([
    getToken(LSEMS_EMAIL, LSEMS_KEY, true),
    getToken(TASKS_EMAIL, TASKS_KEY, true),
  ]).catch(e => { console.error('Auth failed — make sure service accounts have Editor access on both sheets.\n', e.message); process.exit(1); });

  // Push Rank History
  {
    const rows = db.prepare('SELECT event_date,name,old_rank,new_rank,authorizer FROM rank_history ORDER BY id ASC').all();
    const values = [['Date','Name','Old Rank','New Rank','Authorizer'], ...rows.map(r=>[r.event_date,r.name,r.old_rank||'',r.new_rank,r.authorizer])];
    await clearAndWrite(lsemsToken, LSEMS_SHEET, 'Rank History', values);
    console.log(`  Rank History: ${rows.length} rows pushed`);
  }

  // Push Treasury
  {
    const rows = db.prepare('SELECT timestamp,type,amount,balance,notes FROM treasury ORDER BY id ASC').all();
    const values = [['Timestamp','Type','Amount','Balance','Notes'], ...rows.map(r=>[r.timestamp,r.type,r.amount,r.balance,r.notes||''])];
    await clearAndWrite(lsemsToken, LSEMS_SHEET, 'Treasury', values);
    console.log(`  Treasury: ${rows.length} rows pushed`);
  }

  // Push Employees
  {
    const rows = db.prepare('SELECT name,rank,hire_date,last_promotion FROM employees ORDER BY name ASC').all();
    const values = [['Name','Rank','Hire Date','Last Promotion'], ...rows.map(r=>[r.name,r.rank,r.hire_date,r.last_promotion||''])];
    await clearAndWrite(lsemsToken, LSEMS_SHEET, 'Roster', values);
    console.log(`  Roster: ${rows.length} employees pushed`);
  }

  // Push Supervisortasks: Tasks
  {
    const active = db.prepare("SELECT task_name,owner,status,assigned_date,due_date,completed_date,notes FROM sup_tasks WHERE is_historical=0 ORDER BY id ASC").all();
    const hist   = db.prepare("SELECT task_name,owner,status,assigned_date,due_date,completed_date,notes FROM sup_tasks WHERE is_historical=1 ORDER BY id ASC").all();
    const hdr = ['Task List','Task Owner','Status','Claimed/Assigned Date','Due Date','Completed Date','Notes'];
    const toRow = r=>[r.task_name,r.owner||'',r.status,r.assigned_date||'',r.due_date||'',r.completed_date||'',r.notes||''];
    await clearAndWrite(tasksToken, TASKS_SHEET, 'Tasks', [hdr,...active.map(toRow)]);
    await clearAndWrite(tasksToken, TASKS_SHEET, 'Historical Tasks', [hdr,...hist.map(toRow)]);
    console.log(`  Tasks: ${active.length} active + ${hist.length} historical pushed`);
  }

  db.close();
  console.log('\n✅  Push complete');
  process.exit(0);
}

console.log('Usage: node sync.js [status|pull|push]');
