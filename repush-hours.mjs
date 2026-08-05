/**
 * Re-push hours data to Google Sheets "Employees" tab, weeks newest-first.
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
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion:makeJwt(email,key,'https://www.googleapis.com/auth/spreadsheets') })
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

function parseWeekDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (!m) return null;
  const M = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  return new Date(+m[3], M[m[2]], +m[1]);
}

const db = new Database(DB_PATH);

const empRows = db.prepare('SELECT name, rank, hire_date, last_promotion FROM employees ORDER BY name ASC').all();

// Sort weeks newest → oldest (same as the app)
const rawWeeks = db.prepare('SELECT DISTINCT week_ending FROM employee_hours').all().map(r => r.week_ending);
const weeks = rawWeeks.sort((a, b) => {
  const da = parseWeekDate(a), db2 = parseWeekDate(b);
  if (da && db2) return db2 - da;
  return 0;
});

// Build hours lookup
const allHours = db.prepare('SELECT employee_name, week_ending, hours FROM employee_hours WHERE hours > 0').all();
const hMap = {};
for (const h of allHours) {
  if (!hMap[h.employee_name]) hMap[h.employee_name] = {};
  hMap[h.employee_name][h.week_ending] = h.hours;
}

// Header: Name | Rank | Hire Date | Last Promotion | [blank] | [blank] | week1 | week2 | ...
const header = ['Name', 'Rank', 'Hire Date', 'Last Promotion', '', '', ...weeks];
const rows = empRows.map(e => {
  const hourCols = weeks.map(w => hMap[e.name]?.[w] ?? '');
  return [e.name, e.rank, e.hire_date, e.last_promotion || '', '', '', ...hourCols];
});

const token = await getToken(LSEMS_EMAIL, LSEMS_KEY);
await clearAndWrite(token, LSEMS_SHEET, 'Employees', [header, ...rows]);
console.log(`✅  Pushed ${rows.length} employees × ${weeks.length} weeks to Sheets (newest week first)`);
console.log(`    First week: ${weeks[0]}  |  Last week: ${weeks[weeks.length-1]}`);

db.close();
