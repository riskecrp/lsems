/**
 * Backfill 0-hour entries for every active employee × every week,
 * then push the complete hours matrix to the Google Sheets "Employees" tab.
 */
import { createSign } from 'crypto';
import Database       from 'better-sqlite3';

process.loadEnvFile('/opt/lsems/.env');

const LSEMS_EMAIL = 'lsems-dashboard@lsems-dashboard.iam.gserviceaccount.com';
const LSEMS_KEY   = process.env.GOOGLE_LSEMS_PRIVATE_KEY.replace(/\\n/g, '\n');
const LSEMS_SHEET = '1GxWLb11Txy39o7DKtaAL22hvfgLYi8aIj3rCgHL-WGs';
const DB_PATH     = '/opt/lsems/data/lsems.db';

function b64url(s) { return Buffer.from(s).toString('base64url'); }
function makeJwt(email, key, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const p = b64url(JSON.stringify({ iss:email, scope, aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600 }));
  const s = createSign('RSA-SHA256'); s.update(`${h}.${p}`);
  return `${h}.${p}.${s.sign(key,'base64url')}`;
}
async function getToken(email, key) {
  const scope = 'https://www.googleapis.com/auth/spreadsheets';
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion:makeJwt(email,key,scope) })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Auth failed: ' + JSON.stringify(d));
  return d.access_token;
}
async function clearAndWrite(token, sheetId, name, values) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  await fetch(`${base}/values/${encodeURIComponent(name)}:clear`, { method:'POST', headers:{ Authorization:`Bearer ${token}` } });
  const r = await fetch(`${base}/values/${encodeURIComponent(name)}?valueInputOption=USER_ENTERED`, {
    method:'PUT', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ range:name, values }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode=WAL');

// ── Step 1: DB backfill ───────────────────────────────────────
console.log('\n📋  Step 1: Backfill 0s in SQLite\n' + '─'.repeat(40));

const employees = db.prepare('SELECT name FROM employees').all().map(r => r.name);
const weeks     = db.prepare('SELECT DISTINCT week_ending FROM employee_hours ORDER BY rowid ASC').all().map(r => r.week_ending);

console.log(`  ${employees.length} employees × ${weeks.length} weeks = ${employees.length * weeks.length} possible combinations`);

const existing = new Set(
  db.prepare("SELECT employee_name || '::' || week_ending as k FROM employee_hours").all().map(r => r.k)
);

const ins = db.prepare('INSERT OR IGNORE INTO employee_hours (employee_name, week_ending, hours) VALUES (?, ?, 0)');
let inserted = 0;
db.transaction(() => {
  for (const name of employees) {
    for (const week of weeks) {
      if (!existing.has(`${name}::${week}`)) {
        ins.run(name, week);
        inserted++;
      }
    }
  }
})();

console.log(`  Inserted ${inserted} missing 0-hour entries`);

// ── Step 2: Push to Google Sheets ────────────────────────────
console.log('\n📤  Step 2: Push hours to Google Sheets\n' + '─'.repeat(40));

const token = await getToken(LSEMS_EMAIL, LSEMS_KEY);

// Build matrix: rows = employees (sorted by name), cols = weeks (chronological order)
// Sheet format matches pull: Name | Rank | Hire Date | Last Promotion | | | week1 | week2 | ...
const empRows = db.prepare('SELECT name, rank, hire_date, last_promotion FROM employees ORDER BY name ASC').all();

// Weeks in chronological order (oldest first, matching typical sheet layout)
const weeksChron = [...weeks]; // already ASC from query above

// Build hours lookup
const allHours = db.prepare('SELECT employee_name, week_ending, hours FROM employee_hours').all();
const hMap = {};
for (const h of allHours) {
  if (!hMap[h.employee_name]) hMap[h.employee_name] = {};
  hMap[h.employee_name][h.week_ending] = h.hours;
}

const header = ['Name', 'Rank', 'Hire Date', 'Last Promotion', 'Total Hours', '', ...weeksChron];
const rows = empRows.map(e => {
  const hourCols = weeksChron.map(w => hMap[e.name]?.[w] ?? 0);
  const total    = hourCols.reduce((s, h) => s + h, 0);
  return [e.name, e.rank, e.hire_date, e.last_promotion || '', total.toFixed(2), '', ...hourCols];
});

const values = [header, ...rows];
await clearAndWrite(token, LSEMS_SHEET, 'Employees', values);
console.log(`  Pushed ${rows.length} employees × ${weeksChron.length} weeks to "Employees" sheet`);

db.close();
console.log('\n✅  Done');
