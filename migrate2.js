/**
 * LSEMS — Google Sheets → SQLite Migration (native crypto, no jwa)
 * Usage: node migrate2.js
 */

import { createSign }   from 'crypto';
import Database         from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Load .env.migrate ──────────────────────────────────────────
const __dir  = dirname(fileURLToPath(import.meta.url));
const envRaw = readFileSync(resolve(__dir, '.env.migrate'), 'utf8');
const env    = {};
for (const line of envRaw.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const idx = t.indexOf('=');
  if (idx === -1) continue;
  let val = t.slice(idx + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  env[t.slice(0, idx).trim()] = val;
}

const EMAIL   = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const KEY_RAW = env.GOOGLE_PRIVATE_KEY;
const SHEET_ID = env.GOOGLE_SPREADSHEET_ID;
const DB_PATH  = env.DATABASE_PATH || '/opt/lsems/data/lsems.db';

if (!EMAIL || !KEY_RAW || !SHEET_ID) {
  console.error('Missing credentials in .env.migrate'); process.exit(1);
}
const PRIVATE_KEY = KEY_RAW.replace(/\\n/g, '\n');

// ── JWT / OAuth helpers ────────────────────────────────────────
function b64url(s) {
  return Buffer.from(s).toString('base64url');
}

function makeJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signing = `${header}.${payload}`;
  const signer  = createSign('RSA-SHA256');
  signer.update(signing);
  const sig = signer.sign(PRIVATE_KEY, 'base64url');
  return `${signing}.${sig}`;
}

async function getAccessToken() {
  const jwt = makeJwt();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(JSON.stringify(data));
  return data.access_token;
}

async function sheetsGet(token, path) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Helpers ────────────────────────────────────────────────────
function fmtDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  return s || null;
}

function parseNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

function getCell(row, headers, name) {
  const idx = headers.indexOf(name);
  return idx !== -1 ? (row[idx] ?? '') : '';
}

// ── DB ─────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const counts = { employees: 0, hours: 0, pastEmployees: 0, rankHistory: 0, treasury: 0, skipped: [] };

// ── Connect ────────────────────────────────────────────────────
console.log('\n🔗  Authenticating with Google…');
const token = await getAccessToken();
console.log('✅  Got access token\n');

const meta = await sheetsGet(token, '?fields=properties.title,sheets.properties.title');
console.log(`📄  Spreadsheet: "${meta.properties.title}"`);
const sheetTitles = meta.sheets.map(s => s.properties.title);
console.log(`    Sheets: ${sheetTitles.join(', ')}\n`);

// ── Helper: fetch sheet data ───────────────────────────────────
async function getSheetData(title) {
  const encoded = encodeURIComponent(title);
  const res = await sheetsGet(token, `/values/${encoded}`);
  if (!res.values || res.values.length < 2) return { headers: [], rows: [] };
  const headers = res.values[0].map(h => String(h).trim());
  const rows    = res.values.slice(1);
  return { headers, rows };
}

// ── 1. Employees ───────────────────────────────────────────────
if (!sheetTitles.includes('Employees')) {
  console.warn('⚠️  "Employees" sheet not found — skipping.');
} else {
  console.log('👥  Migrating Employees…');
  const { headers, rows } = await getSheetData('Employees');
  const weekHeaders = headers.slice(6);

  const insertEmp = db.prepare(`
    INSERT OR IGNORE INTO employees (name, rank, hire_date, last_promotion)
    VALUES (?, ?, ?, ?)
  `);
  const insertHours = db.prepare(`
    INSERT OR REPLACE INTO employee_hours (employee_name, week_ending, hours)
    VALUES (?, ?, ?)
  `);

  db.transaction(() => {
    for (const row of rows) {
      const name = String(getCell(row, headers, 'Name')).trim();
      if (!name) continue;
      const rank          = String(getCell(row, headers, 'Rank')).trim();
      const hireDate      = fmtDate(getCell(row, headers, 'Hire Date'));
      const lastPromotion = fmtDate(getCell(row, headers, 'Last Promotion'));

      if (!rank || !hireDate) {
        counts.skipped.push(`Employee "${name}" missing rank or hire date`);
        continue;
      }

      insertEmp.run(name, rank, hireDate, lastPromotion || null);
      counts.employees++;

      for (const wh of weekHeaders) {
        const hrs = parseNum(getCell(row, headers, wh));
        if (hrs > 0) {
          insertHours.run(name, wh, hrs);
          counts.hours++;
        }
      }
    }
  })();

  console.log(`   ✓ ${counts.employees} employees  |  ${counts.hours} weekly hour entries`);
}

// ── 2. Past Employees ──────────────────────────────────────────
if (!sheetTitles.includes('Past Employees')) {
  console.warn('⚠️  "Past Employees" sheet not found — skipping.');
} else {
  console.log('📦  Migrating Past Employees…');
  const { headers, rows } = await getSheetData('Past Employees');

  const insertPast = db.prepare(`
    INSERT OR IGNORE INTO past_employees (name, date_separated, exit_rank, authorizer, hire_date, total_hours)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const row of rows) {
      const name = String(getCell(row, headers, 'Name')).trim();
      if (!name) continue;
      insertPast.run(
        name,
        fmtDate(getCell(row, headers, 'Date Separated')) || '',
        String(getCell(row, headers, 'Exit Rank')).trim(),
        String(getCell(row, headers, 'Authorizer')).trim(),
        fmtDate(getCell(row, headers, 'Hire Date')) || null,
        parseNum(getCell(row, headers, 'Total Hours')),
      );
      counts.pastEmployees++;
    }
  })();

  console.log(`   ✓ ${counts.pastEmployees} past employees`);
}

// ── 3. Rank History ────────────────────────────────────────────
if (!sheetTitles.includes('Rank History')) {
  console.warn('⚠️  "Rank History" sheet not found — skipping.');
} else {
  console.log('📋  Migrating Rank History…');
  const { headers, rows } = await getSheetData('Rank History');

  const insertHist = db.prepare(`
    INSERT INTO rank_history (event_date, name, old_rank, new_rank, authorizer)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const row of rows) {
      const name    = String(getCell(row, headers, 'Name') || getCell(row, headers, 'name')).trim();
      const newRank = String(getCell(row, headers, 'New Rank') || getCell(row, headers, 'new_rank')).trim();
      if (!name || !newRank) continue;
      insertHist.run(
        fmtDate(getCell(row, headers, 'Date') || getCell(row, headers, 'event_date')) || '',
        name,
        String(getCell(row, headers, 'Old Rank') || getCell(row, headers, 'old_rank')).trim() || null,
        newRank,
        String(getCell(row, headers, 'Authorizer') || getCell(row, headers, 'authorizer')).trim(),
      );
      counts.rankHistory++;
    }
  })();

  console.log(`   ✓ ${counts.rankHistory} rank history events`);
}

// ── 4. Treasury ────────────────────────────────────────────────
if (!sheetTitles.includes('Treasury')) {
  console.warn('⚠️  "Treasury" sheet not found — skipping.');
} else {
  console.log('💰  Migrating Treasury…');
  const { headers, rows } = await getSheetData('Treasury');

  const insertTreas = db.prepare(`
    INSERT INTO treasury (timestamp, type, amount, balance, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const row of rows) {
      const type = String(getCell(row, headers, 'Type')).trim();
      if (!type) continue;
      insertTreas.run(
        String(getCell(row, headers, 'Timestamp')).trim(),
        type,
        parseNum(getCell(row, headers, 'Amount')),
        parseNum(getCell(row, headers, 'Balance')),
        String(getCell(row, headers, 'Notes')).trim() || null,
      );
      counts.treasury++;
    }
  })();

  console.log(`   ✓ ${counts.treasury} treasury entries`);
}

// ── Summary ────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log('✅  Migration complete!\n');
console.log(`   Employees:       ${counts.employees}`);
console.log(`   Weekly hours:    ${counts.hours}`);
console.log(`   Past employees:  ${counts.pastEmployees}`);
console.log(`   Rank history:    ${counts.rankHistory}`);
console.log(`   Treasury rows:   ${counts.treasury}`);

if (counts.skipped.length > 0) {
  console.log(`\n⚠️  Skipped (${counts.skipped.length}):`);
  counts.skipped.forEach(s => console.log('   -', s));
}

console.log('\n💡  Next steps:');
console.log('   1. Open the dashboard and verify the data looks correct.');
console.log('   2. Delete: rm /opt/lsems/migrate.js /opt/lsems/migrate2.js /opt/lsems/.env.migrate\n');

db.close();
