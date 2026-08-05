/**
 * LSEMS — Google Sheets → SQLite Migration
 *
 * Usage:
 *   1. Add credentials to /opt/lsems/.env.migrate  (see bottom of this file)
 *   2. node migrate.js
 *   3. Review the summary output
 *   4. Delete this file and .env.migrate when done
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT }               from 'google-auth-library';
import Database              from 'better-sqlite3';
import { readFileSync }      from 'fs';
import { resolve, dirname }  from 'path';
import { fileURLToPath }     from 'url';

// ── Load migration env ────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '.env.migrate');
const envLines = readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
}

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: EMAIL,
  GOOGLE_PRIVATE_KEY:           KEY_RAW,
  GOOGLE_SPREADSHEET_ID:        SHEET_ID,
  DATABASE_PATH:                DB_PATH = '/opt/lsems/data/lsems.db',
} = env;

if (!EMAIL || !KEY_RAW || !SHEET_ID) {
  console.error('Missing credentials in .env.migrate — see instructions at bottom of this file.');
  process.exit(1);
}

const KEY = KEY_RAW.replace(/\\n/g, '\n');

// ── DB ────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Helpers ───────────────────────────────────────────────────
function fmtDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${m}/${d}/${v.getFullYear()}`;
  }
  return String(v).trim() || null;
}

function parseNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

const counts = {
  employees: 0, hours: 0,
  pastEmployees: 0,
  rankHistory: 0,
  treasury: 0,
  skipped: [],
};

// ── Connect ───────────────────────────────────────────────────
console.log('\n🔗  Connecting to Google Sheets…');
const auth = new JWT({ email: EMAIL, key: KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const doc  = new GoogleSpreadsheet(SHEET_ID, auth);
await doc.loadInfo();
console.log(`📄  Spreadsheet: "${doc.title}"`);
console.log(`    Sheets found: ${Object.keys(doc.sheetsByTitle).join(', ')}\n`);

// ── 1. Employees ──────────────────────────────────────────────
const EMPLOYEES_SHEET = doc.sheetsByTitle['Employees'];
if (!EMPLOYEES_SHEET) {
  console.warn('⚠️  "Employees" sheet not found — skipping.');
} else {
  console.log('👥  Migrating Employees…');
  await EMPLOYEES_SHEET.loadHeaderRow();
  const headers = EMPLOYEES_SHEET.headerValues;   // ['Name','Rank','Hire Date','Last Promotion','Days in Rank','Total Hours','5/Jan/2025',...]
  const weekHeaders = headers.slice(6);            // dynamic week columns start at index 6 (col G)

  const rows = await EMPLOYEES_SHEET.getRows();
  const insertEmp = db.prepare(`
    INSERT OR IGNORE INTO employees (name, rank, hire_date, last_promotion)
    VALUES (?, ?, ?, ?)
  `);
  const insertHours = db.prepare(`
    INSERT OR REPLACE INTO employee_hours (employee_name, week_ending, hours)
    VALUES (?, ?, ?)
  `);

  const txn = db.transaction(() => {
    for (const row of rows) {
      const name = (row.get('Name') || '').trim();
      if (!name) continue;

      const rank          = (row.get('Rank') || '').trim();
      const hireDate      = fmtDate(row.get('Hire Date'));
      const lastPromotion = fmtDate(row.get('Last Promotion'));

      if (!rank || !hireDate) {
        counts.skipped.push(`Employee "${name}" missing rank or hire date`);
        continue;
      }

      insertEmp.run(name, rank, hireDate, lastPromotion || null);
      counts.employees++;

      // Weekly hours
      for (const weekHeader of weekHeaders) {
        const hrs = parseNum(row.get(weekHeader));
        if (hrs > 0) {
          insertHours.run(name, weekHeader, hrs);
          counts.hours++;
        }
      }
    }
  });
  txn();
  console.log(`   ✓ ${counts.employees} employees  |  ${counts.hours} weekly hour entries`);
}

// ── 2. Past Employees ─────────────────────────────────────────
const PAST_SHEET = doc.sheetsByTitle['Past Employees'];
if (!PAST_SHEET) {
  console.warn('⚠️  "Past Employees" sheet not found — skipping.');
} else {
  console.log('📦  Migrating Past Employees…');
  await PAST_SHEET.loadHeaderRow();
  const rows = await PAST_SHEET.getRows();

  const insertPast = db.prepare(`
    INSERT OR IGNORE INTO past_employees (name, date_separated, exit_rank, authorizer, hire_date, total_hours)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    for (const row of rows) {
      const name = (row.get('Name') || '').trim();
      if (!name) continue;

      insertPast.run(
        name,
        fmtDate(row.get('Date Separated')) || '',
        (row.get('Exit Rank') || '').trim(),
        (row.get('Authorizer') || '').trim(),
        fmtDate(row.get('Hire Date')) || null,
        parseNum(row.get('Total Hours')),
      );
      counts.pastEmployees++;
    }
  });
  txn();
  console.log(`   ✓ ${counts.pastEmployees} past employees`);
}

// ── 3. Rank History ───────────────────────────────────────────
const HIST_SHEET = doc.sheetsByTitle['Rank History'];
if (!HIST_SHEET) {
  console.warn('⚠️  "Rank History" sheet not found — skipping.');
} else {
  console.log('📋  Migrating Rank History…');
  await HIST_SHEET.loadHeaderRow();
  const rows = await HIST_SHEET.getRows();

  const insertHist = db.prepare(`
    INSERT INTO rank_history (event_date, name, old_rank, new_rank, authorizer)
    VALUES (?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    for (const row of rows) {
      // Support both old-script column names and new ones
      const name    = (row.get('Name') || '').trim();
      const newRank = (row.get('New Rank') || row.get('new_rank') || '').trim();
      if (!name || !newRank) continue;

      insertHist.run(
        fmtDate(row.get('Date') || row.get('event_date')) || '',
        name,
        (row.get('Old Rank') || row.get('old_rank') || '').trim() || null,
        newRank,
        (row.get('Authorizer') || row.get('authorizer') || '').trim(),
      );
      counts.rankHistory++;
    }
  });
  txn();
  console.log(`   ✓ ${counts.rankHistory} rank history events`);
}

// ── 4. Treasury ───────────────────────────────────────────────
const TREAS_SHEET = doc.sheetsByTitle['Treasury'];
if (!TREAS_SHEET) {
  console.warn('⚠️  "Treasury" sheet not found — skipping.');
} else {
  console.log('💰  Migrating Treasury…');
  await TREAS_SHEET.loadHeaderRow();
  const rows = await TREAS_SHEET.getRows();

  const insertTreas = db.prepare(`
    INSERT INTO treasury (timestamp, type, amount, balance, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    for (const row of rows) {
      const type = (row.get('Type') || '').trim();
      if (!type) continue;

      insertTreas.run(
        String(row.get('Timestamp') || '').trim(),
        type,
        parseNum(row.get('Amount')),
        parseNum(row.get('Balance')),
        (row.get('Notes') || '').trim() || null,
      );
      counts.treasury++;
    }
  });
  txn();
  console.log(`   ✓ ${counts.treasury} treasury entries`);
}

// ── Summary ───────────────────────────────────────────────────
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
console.log('   2. Delete this file:  rm /opt/lsems/migrate.js');
console.log('   3. Delete credentials:  rm /opt/lsems/.env.migrate\n');

db.close();

/**
 * ── .env.migrate template ────────────────────────────────────
 * Create this file at /opt/lsems/.env.migrate with your values:
 *
 * GOOGLE_SERVICE_ACCOUNT_EMAIL=your-account@your-project.iam.gserviceaccount.com
 * GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR KEY HERE\n-----END PRIVATE KEY-----\n"
 * GOOGLE_SPREADSHEET_ID=your_spreadsheet_id_here
 *
 * The spreadsheet ID is the string between /d/ and /edit in the sheet URL.
 * Make sure the service account has been shared on the spreadsheet (Viewer is enough).
 */
