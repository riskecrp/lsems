/**
 * Migrate all date fields from M/D/YYYY or YYYY-MM-DD → DD/Mon/YYYY
 */
import Database from 'better-sqlite3';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function toStandard(val) {
  if (!val || typeof val !== 'string') return null;

  // Already DD/Mon/YYYY or D/Mon/YYYY — leave alone
  if (/^\d{1,2}\/[A-Za-z]{3}\/\d{4}$/.test(val)) return val;

  // M/D/YYYY or MM/DD/YYYY
  const m1 = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) {
    const [, mon, day, yr] = m1;
    return `${String(day).padStart(2,'0')}/${MONTHS[parseInt(mon)-1]}/${yr}`;
  }

  // YYYY-MM-DD (ISO)
  const m2 = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) {
    const [, yr, mon, day] = m2;
    return `${String(parseInt(day)).padStart(2,'0')}/${MONTHS[parseInt(mon)-1]}/${yr}`;
  }

  return null; // unrecognised — skip
}

const COLS = [
  ['employees',       'id', ['hire_date', 'last_promotion']],
  ['past_employees',  'id', ['hire_date', 'date_separated']],
  ['rank_history',    'id', ['event_date']],
  ['sup_tasks',       'id', ['assigned_date', 'due_date', 'completed_date']],
  ['sup_discussions', 'id', ['date_posted']],
  ['bonus_payments',  'id', ['paid_date']],
];

const db = new Database('/opt/lsems/data/lsems.db');
db.pragma('journal_mode=WAL');

let total = 0;

db.transaction(() => {
  for (const [table, pk, cols] of COLS) {
    for (const col of cols) {
      const rows = db.prepare(`SELECT ${pk}, ${col} FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`).all();
      const upd  = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${pk} = ?`);
      let count = 0;
      for (const row of rows) {
        const orig = row[col];
        const conv = toStandard(orig);
        if (conv && conv !== orig) {
          upd.run(conv, row[pk]);
          count++;
        }
      }
      if (count) console.log(`  ${table}.${col}: converted ${count} rows`);
    }
  }
})();

db.close();
console.log('\n✅  Date migration complete');
