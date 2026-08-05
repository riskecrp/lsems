"use server";
import { query, queryOne, run, transaction, getDb } from './lib/db';
import { revalidatePath } from 'next/cache';
import { HOURLY_RATES, SETTLE_GRACE_DAYS } from './constants';
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

const NOTIFY_CHANNEL  = process.env.DISCORD_NOTIFY_CHANNEL  || '520680995704274954';
const SUPERVISOR_ROLE = process.env.DISCORD_SUPERVISOR_ROLE  || '740782964157448363';
const BOT_TOKEN       = process.env.DISCORD_BOT_TOKEN;

const SUPERVISOR_RANKS = new Set(['Lead Paramedic', 'Senior Paramedic', 'Paramedic', 'Junior Paramedic']);

async function discordNotify(content) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${NOTIFY_CHANNEL}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch {}
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET
);

async function getActor() {
  try {
    const store = await cookies();
    const token = store.get('lsems_session')?.value;
    if (!token) return { username: 'System', user_id: null, level: 0 };
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { username: payload.displayName || payload.username || 'Unknown', user_id: payload.userId || null, level: payload.level ?? 0 };
  } catch { return { username: 'System', user_id: null, level: 0 }; }
}

// Returns the character name for the current session user (or override if L2/L3 provided one)
async function resolveAuthorizer(override) {
  if (override?.trim()) return override.trim();
  const { user_id } = await getActor();
  if (user_id) {
    const profile = queryOne('SELECT character_name FROM user_profiles WHERE discord_id = ?', [user_id]);
    if (profile?.character_name) return profile.character_name;
  }
  return null;
}

export async function getMyProfile() {
  try {
    const { user_id } = await getActor();
    if (!user_id) return null;
    const profile = queryOne('SELECT character_name, sig_image FROM user_profiles WHERE discord_id = ?', [user_id])
      || { character_name: '', sig_image: '' };
    // Look up rank from roster
    const emp = profile.character_name
      ? queryOne('SELECT rank FROM employees WHERE LOWER(name) = LOWER(?)', [profile.character_name])
      : null;
    return { ...profile, rank: emp?.rank || '' };
  } catch { return null; }
}

export async function setMyProfile({ characterName, sigImage }) {
  try {
    const { user_id, username } = await getActor();
    if (!user_id) return { ok: false, error: 'Not logged in.' };
    run(
      'INSERT INTO user_profiles (discord_id, character_name, sig_image) VALUES (?,?,?) ON CONFLICT(discord_id) DO UPDATE SET character_name=excluded.character_name, sig_image=excluded.sig_image',
      [user_id, characterName?.trim() || '', sigImage?.trim() || null]
    );
    logAudit(username, user_id, 'Profile Updated', `Character: ${characterName}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getAllCharacterNames() {
  try {
    return query('SELECT character_name FROM user_profiles WHERE character_name != \'\' ORDER BY character_name ASC').map(r => r.character_name);
  } catch { return []; }
}

function logAudit(username, user_id, action, details) {
  try {
    const ts = new Date().toLocaleString('en-US');
    run(
      'INSERT INTO audit_log (timestamp, username, user_id, action, details) VALUES (?,?,?,?,?)',
      [ts, username, user_id, action, details || null]
    );
  } catch {}
}

export async function getAuditLog() {
  try {
    return query('SELECT id, timestamp, username, action, details FROM audit_log ORDER BY id DESC LIMIT 500');
  } catch { return []; }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function today() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${MONTHS[d.getMonth()]}/${d.getFullYear()}`;
}

// Parses both "D/Mon/YYYY" (week_ending) and "M/D/YYYY" (hire/promotion) formats
const MONTH_LOOKUP = (() => {
  const full = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const abbr = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const map = {};
  full.forEach((m, i) => { map[m] = i; map[m.slice(0,3)] = i; });
  abbr.forEach((m, i) => { map[m] = i; });
  return map;
})();

function parseFlexDate(str) {
  if (!str) return null;
  const s = str.trim();

  // DD/Mon/YYYY or DD/MONTH/YYYY — any case, any separator (/ - .)
  const mAlpha = s.match(/^(\d{1,2})[\/\-\.\s]([A-Za-z]+)[\/\-\.\s](\d{4})$/);
  if (mAlpha) {
    const idx = MONTH_LOOKUP[mAlpha[2].toLowerCase()];
    if (idx !== undefined) return new Date(+mAlpha[3], idx, +mAlpha[1]);
  }

  // YYYY-MM-DD (ISO)
  const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mISO) return new Date(+mISO[1], +mISO[2] - 1, +mISO[3]);

  // DD/MM/YYYY numeric — treat first number as day
  const mNum = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (mNum) return new Date(+mNum[3], +mNum[2] - 1, +mNum[1]);

  // Native fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// When does a given milestone fall due for this employee?
// months_tenure is 3 × the milestone number. Anchored employees (the 2026-08
// cohort restarted from their last payment) count from bonus_anchor with their
// completed milestones offset by bonus_step; everyone else counts from hire.
function milestoneDueDate(emp, monthsTenure) {
  const months = Number(monthsTenure);
  if (!emp || !Number.isFinite(months) || months <= 0) return null;
  if (emp.bonus_anchor) {
    const anchor = parseFlexDate(emp.bonus_anchor);
    if (!anchor) return null;
    const periods = (months / 3) - (emp.bonus_step || 0);
    if (periods < 1) return null;              // milestone predates the anchor
    const d = new Date(anchor.getTime());
    d.setMonth(d.getMonth() + 3 * periods);
    return d;
  }
  const hire = parseFlexDate(emp.hire_date);
  if (!hire) return null;
  const d = new Date(hire.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

// Has this milestone already been paid? A prior row for the same milestone
// counts if it is dated on or after that milestone's due date less the settle
// grace (payroll pays up to a week early). Older rows are pre-existing history
// whose months_tenure value is meaningless and must not block a legitimate
// payment. Returns the offending paid_date, or null.
function alreadyPaidMilestone(employeeName, monthsTenure) {
  if (monthsTenure == null) return null;
  const emp = queryOne(
    'SELECT hire_date, bonus_anchor, bonus_step FROM employees WHERE LOWER(name) = LOWER(?)',
    [employeeName]
  );
  const dueDate = milestoneDueDate(emp, monthsTenure);
  if (!dueDate) return null;
  const from = new Date(dueDate.getTime() - SETTLE_GRACE_DAYS * 86400000);
  const prior = query(
    'SELECT paid_date FROM bonus_payments WHERE LOWER(employee_name) = LOWER(?) AND months_tenure = ?',
    [employeeName, monthsTenure]
  );
  const hit = prior.find(p => { const d = parseFlexDate(p.paid_date); return d && d >= from; });
  return hit ? hit.paid_date : null;
}

// Returns true if LOA end date is absent (indefinite) or has not yet passed
function isLoaActive(loaEnd) {
  if (!loaEnd) return true;
  const end = parseFlexDate(loaEnd);
  if (!end) return true;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return end >= now;
}

function getTotalHours(name) {
  const rows = query('SELECT hours FROM employee_hours WHERE employee_name = ?', [name]);
  return rows.reduce((sum, r) => sum + (r.hours || 0), 0);
}

// ── Data loaders ──────────────────────────────────────────────

export async function getEmployees() {
  try {
    const rows     = query('SELECT name, rank, hire_date, last_promotion, is_on_loa, loa_start, loa_end, loa_reason, bonus_anchor, bonus_step FROM employees ORDER BY name ASC');
    const allHours = query('SELECT employee_name, week_ending, hours FROM employee_hours');

    const hoursMap = {};
    for (const h of allHours) {
      if (!hoursMap[h.employee_name]) hoursMap[h.employee_name] = [];
      hoursMap[h.employee_name].push(h);
    }

    return rows.map(r => {
      const empHours = hoursMap[r.name] || [];
      const total    = empHours.reduce((s, h) => s + h.hours, 0);
      const refDate  = parseFlexDate(r.last_promotion) || parseFlexDate(r.hire_date);
      const inRank   = refDate
        ? empHours.filter(h => { const d = parseFlexDate(h.week_ending); return d && d >= refDate; })
                  .reduce((s, h) => s + h.hours, 0)
        : total;
      return {
        name:          r.name,
        rank:          r.rank,
        hireDate:      r.hire_date,
        lastPromotion: r.last_promotion || '',
        totalHours:    total,
        hoursInRank:   inRank,
        isOnLoa:       !!r.is_on_loa && isLoaActive(r.loa_end),
        loaStart:      r.loa_start  || '',
        loaEnd:        r.loa_end    || '',
        loaReason:     r.loa_reason || '',
        bonusAnchor:   r.bonus_anchor || null,
        bonusStep:     r.bonus_step   || 0,
      };
    });
  } catch (e) { console.error('getEmployees:', e); return []; }
}

export async function getEmployeeProfile(name) {
  try {
    const emp = queryOne('SELECT hire_date, loa_start, loa_end FROM employees WHERE name = ?', [name]);

    // All distinct weeks in the system, newest-first
    const allWeeks = query('SELECT DISTINCT week_ending FROM employee_hours')
      .map(r => r.week_ending)
      .sort((a, b) => {
        const da = parseFlexDate(a), db = parseFlexDate(b);
        if (da && db) return db - da;
        return 0;
      });

    // Only show weeks on or after the employee's hire date
    const hireDate = emp?.hire_date ? parseFlexDate(emp.hire_date) : null;
    const relevantWeeks = hireDate
      ? allWeeks.filter(w => { const d = parseFlexDate(w); return d && d >= hireDate; })
      : allWeeks;

    // Employee's actual hours keyed by week_ending
    const hoursRows = query('SELECT week_ending, hours FROM employee_hours WHERE employee_name = ?', [name]);
    const hoursMap = {};
    for (const h of hoursRows) hoursMap[h.week_ending] = h.hours;

    // Build list of LOA periods from current record + audit history
    const loaPeriods = [];
    if (emp?.loa_start) {
      loaPeriods.push({
        start: parseFlexDate(emp.loa_start),
        end:   emp.loa_end ? parseFlexDate(emp.loa_end) : null,
      });
    }
    const loaAuditRows = query(
      "SELECT details FROM audit_log WHERE action = ? ORDER BY id ASC",
      [`LOA — ${name}`]
    );
    for (const r of loaAuditRows) {
      if (!r.details) continue;
      const m = r.details.match(/LOA set (\d{1,2}\/[A-Za-z]{3}\/\d{4})[–-](\d{1,2}\/[A-Za-z]{3}\/\d{4}|ongoing)/);
      if (!m) continue;
      const startD = parseFlexDate(m[1]);
      const endD   = m[2] === 'ongoing' ? null : parseFlexDate(m[2]);
      if (startD) loaPeriods.push({ start: startD, end: endD });
    }

    function weekHasLoa(weekEnding) {
      const weekEnd = parseFlexDate(weekEnding);
      if (!weekEnd || loaPeriods.length === 0) return false;
      const weekStart = new Date(weekEnd.getTime() - 6 * 86400000);
      return loaPeriods.some(loa => loa.start <= weekEnd && (!loa.end || loa.end >= weekStart));
    }

    const hours = relevantWeeks.map(w => ({
      week_ending: w,
      hours:    hoursMap[w] ?? null,
      hasEntry: w in hoursMap,
      loa:      weekHasLoa(w),
    }));

    const bonuses = query(
      'SELECT paid_date, amount, months_tenure FROM bonus_payments WHERE employee_name = ? ORDER BY id DESC',
      [name]
    );
    const rankHistory = query(
      'SELECT event_date, old_rank, new_rank, authorizer FROM rank_history WHERE name = ? ORDER BY id ASC',
      [name]
    );
    const loaHistory = query(
      "SELECT timestamp, username, action, details FROM audit_log WHERE action = ? ORDER BY id DESC",
      [`LOA — ${name}`]
    );
    return { ok: true, hours, bonuses, rankHistory, loaHistory };
  } catch (e) { return { ok: false, error: e.message, hours: [], bonuses: [], rankHistory: [], loaHistory: [] }; }
}

export async function setEmployeeLOA({ name, isOnLoa, loaStart, loaEnd, loaReason }) {
  try {
    await requirePerm('roster', 'loa');
    run('UPDATE employees SET is_on_loa=?, loa_start=?, loa_end=?, loa_reason=? WHERE name=?',
      [isOnLoa ? 1 : 0, loaStart || null, loaEnd || null, loaReason || null, name]);
    const sup = queryOne('SELECT id FROM supervisors WHERE name=?', [name]);
    if (sup) run('UPDATE supervisors SET is_on_loa=?, loa_start=?, loa_end=?, loa_reason=? WHERE name=?',
      [isOnLoa ? 1 : 0, loaStart || null, loaEnd || null, loaReason || null, name]);
    revalidatePath('/'); revalidatePath('/tasks'); revalidatePath('/discussions');
    const { username, user_id } = await getActor();
    const detail = isOnLoa ? `LOA set ${loaStart}–${loaEnd || 'ongoing'}${loaReason ? ` · ${loaReason}` : ''}` : 'LOA ended';
    logAudit(username, user_id, `LOA — ${name}`, detail);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getPastEmployees() {
  try {
    const rows = query('SELECT name, date_separated, exit_rank, authorizer, hire_date, total_hours FROM past_employees');
    const mapped = rows.map(r => ({ name: r.name, dateSeparated: r.date_separated, exitRank: r.exit_rank, authorizer: r.authorizer, hireDate: r.hire_date, totalHours: r.total_hours }));
    mapped.sort((a, b) => {
      const da = parseFlexDate(a.dateSeparated);
      const db = parseFlexDate(b.dateSeparated);
      if (da && db && db - da !== 0) return db - da;
      return (a.name || '').localeCompare(b.name || '');
    });
    return mapped;
  } catch (e) { console.error('getPastEmployees:', e); return []; }
}

export async function getPastEmployeeProfile(name) {
  try {
    const emp = queryOne('SELECT hire_date, date_separated FROM past_employees WHERE name = ?', [name]);

    const allWeeks = query('SELECT DISTINCT week_ending FROM employee_hours')
      .map(r => r.week_ending)
      .sort((a, b) => {
        const da = parseFlexDate(a), db = parseFlexDate(b);
        if (da && db) return db - da;
        return 0;
      });

    const hireDate = emp?.hire_date ? parseFlexDate(emp.hire_date) : null;
    const sepDate  = emp?.date_separated ? parseFlexDate(emp.date_separated) : null;

    const relevantWeeks = allWeeks.filter(w => {
      const d = parseFlexDate(w);
      if (!d) return false;
      if (hireDate && d < hireDate) return false;
      if (sepDate  && d > sepDate)  return false;
      return true;
    });

    const hoursRows = query('SELECT week_ending, hours FROM employee_hours WHERE employee_name = ?', [name]);
    const hoursMap  = {};
    for (const h of hoursRows) hoursMap[h.week_ending] = h.hours;

    const hours = relevantWeeks.map(w => ({
      week_ending: w,
      hours:       hoursMap[w] ?? null,
      hasEntry:    w in hoursMap,
    }));

    const rankHistory = query(
      'SELECT event_date, old_rank, new_rank, authorizer FROM rank_history WHERE name = ? ORDER BY id ASC', [name]
    );
    const bonuses = query(
      'SELECT paid_date, amount, months_tenure FROM bonus_payments WHERE employee_name = ? ORDER BY id DESC', [name]
    );

    return { ok: true, hours, rankHistory, bonuses };
  } catch (e) { return { ok: false, error: e.message, hours: [], rankHistory: [], bonuses: [] }; }
}

export async function getBonuses() {
  try {
    const rows = query('SELECT name, rank, hire_date, bonus_anchor, bonus_step FROM employees ORDER BY name ASC');
    return rows.map(r => ({
      name: r.name, rank: r.rank, hireDate: r.hire_date,
      bonusAnchor: r.bonus_anchor || null, bonusStep: r.bonus_step || 0,
    }));
  } catch (e) { console.error('getBonuses:', e); return []; }
}

export async function getRankHistory() {
  try {
    const rows = query('SELECT id, event_date, name, old_rank, new_rank, authorizer FROM rank_history');
    const mapped = rows.map(r => ({ id: r.id, date: r.event_date, name: r.name, oldRank: r.old_rank, newRank: r.new_rank, authorizer: r.authorizer }));
    mapped.sort((a, b) => {
      const da = parseFlexDate(a.date);
      const db = parseFlexDate(b.date);
      if (da && db && db - da !== 0) return db - da;
      return b.id - a.id;
    });
    return mapped;
  } catch (e) { console.error('getRankHistory:', e); return []; }
}

export async function getTreasury() {
  try {
    const transactions = query('SELECT id, timestamp, type, amount, balance, notes FROM treasury ORDER BY id DESC');
    const latest = queryOne('SELECT balance FROM treasury ORDER BY id DESC LIMIT 1');
    return { transactions, balance: latest?.balance ?? 0 };
  } catch (e) { console.error('getTreasury:', e); return { transactions: [], balance: 0 }; }
}

export async function deleteTreasuryEntry(id) {
  try {
    await requirePerm('payroll', 'delete_entry');
    const entry = queryOne('SELECT type, amount FROM treasury WHERE id = ?', [id]);
    run('DELETE FROM treasury WHERE id = ?', [id]);
    const { username, user_id } = await getActor();
    logAudit(username, user_id, 'Delete Treasury Entry', entry ? `${entry.type} · $${entry.amount}` : `id ${id}`);
    revalidatePath('/payroll');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function deleteHoursWeek(weekEnding) {
  try {
    await requirePerm('hours', 'delete_week');
    run('DELETE FROM employee_hours WHERE week_ending = ?', [weekEnding]);
    const { username, user_id } = await getActor();
    logAudit(username, user_id, 'Delete Hours Week', `Week: ${weekEnding}`);
    revalidatePath('/hours');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function deleteEmployeeHours(employeeName, weekEnding) {
  try {
    await requirePerm('hours', 'delete_entry');
    run('DELETE FROM employee_hours WHERE employee_name = ? AND week_ending = ?', [employeeName, weekEnding]);
    revalidatePath('/hours');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getWeeklyHours(weekEnding) {
  try {
    return query('SELECT employee_name, hours FROM employee_hours WHERE week_ending = ?', [weekEnding]);
  } catch (e) { return []; }
}

export async function getRecentWeeks() {
  try {
    const rows = query('SELECT DISTINCT week_ending FROM employee_hours').map(r => r.week_ending);
    return rows.sort((a, b) => {
      const da = parseFlexDate(a), db = parseFlexDate(b);
      if (da && db) return db - da;
      return 0;
    }).slice(0, 12);
  } catch (e) { return []; }
}

export async function getHoursGrid() {
  try {
    const employees = query('SELECT name, rank, is_on_loa, loa_start, loa_end FROM employees ORDER BY name ASC')
      .map(r => ({ ...r, isOnLoa: !!r.is_on_loa && isLoaActive(r.loa_end), loaStart: r.loa_start, loaEnd: r.loa_end }));
    const rawWeeks  = query('SELECT DISTINCT week_ending FROM employee_hours').map(r => r.week_ending);
    const weeks     = rawWeeks.sort((a, b) => {
      const da = parseFlexDate(a), db = parseFlexDate(b);
      if (da && db) return db - da;
      return 0;
    });
    const allHours  = query('SELECT employee_name, week_ending, hours FROM employee_hours');

    const map = {};
    for (const h of allHours) {
      if (!map[h.employee_name]) map[h.employee_name] = {};
      map[h.employee_name][h.week_ending] = h.hours;
    }

    return { employees, weeks, map };
  } catch (e) { console.error('getHoursGrid:', e); return { employees: [], weeks: [], map: {} }; }
}

// ── Employee management ───────────────────────────────────────

export async function addEmployee({ name, rank, hireDate, authorizer }) {
  try {
    await requirePerm('roster', 'add');
    if (!name?.trim() || !rank?.trim() || !hireDate?.trim()) return { ok: false, error: 'All fields required.' };
    const auth = await resolveAuthorizer(authorizer);
    if (!auth) return { ok: false, error: 'Set your character name in your profile first.' };
    const exists = queryOne('SELECT id FROM employees WHERE name = ?', [name.trim()]);
    if (exists) return { ok: false, error: `${name} is already on the roster.` };

    const date = today();
    transaction(() => {
      run('INSERT INTO employees (name, rank, hire_date) VALUES (?, ?, ?)', [name.trim(), rank.trim(), hireDate.trim()]);
      run(
        'INSERT INTO rank_history (event_date, name, old_rank, new_rank, authorizer) VALUES (?, ?, ?, ?, ?)',
        [date, name.trim(), null, rank.trim(), auth]
      );
      if (SUPERVISOR_RANKS.has(rank.trim())) {
        run('INSERT OR IGNORE INTO supervisors (name, rank) VALUES (?, ?)', [name.trim(), rank.trim()]);
      }
    });
    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Add Employee — ${name.trim()}`, `Rank: ${rank} · Auth: ${auth}`);
    revalidatePath('/'); revalidatePath('/bonuses'); revalidatePath('/history');
    revalidatePath('/supervisors'); revalidatePath('/tasks');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function removeEmployee({ name, authorizer }) {
  try {
    await requirePerm('roster', 'separate');
    if (!name) return { ok: false, error: 'Name required.' };
    const auth = await resolveAuthorizer(authorizer);
    if (!auth) return { ok: false, error: 'Set your character name in your profile first.' };

    const emp = queryOne('SELECT name, rank, hire_date FROM employees WHERE name = ?', [name]);
    if (!emp) return { ok: false, error: `${name} not found.` };

    const totalHours = getTotalHours(name);
    const sep = today();

    transaction(() => {
      run('INSERT INTO past_employees (name, date_separated, exit_rank, authorizer, hire_date, total_hours) VALUES (?, ?, ?, ?, ?, ?)',
        [emp.name, sep, emp.rank, auth, emp.hire_date || '', totalHours]);
      run('INSERT INTO rank_history (event_date, name, old_rank, new_rank, authorizer) VALUES (?, ?, ?, ?, ?)',
        [sep, emp.name, emp.rank, 'SEPARATED', auth]);
      // Hours are kept in employee_hours so profile history remains accessible
      run('DELETE FROM employees WHERE name = ?', [name]);
      run('DELETE FROM supervisors WHERE name = ?', [name]);
    });

    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Separate — ${name}`, `Exit rank: ${emp.rank} · Auth: ${auth}`);
    revalidatePath('/'); revalidatePath('/bonuses'); revalidatePath('/history');
    revalidatePath('/supervisors'); revalidatePath('/tasks');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function promoteEmployee({ name, newRank, authorizer }) {
  try {
    await requirePerm('roster', 'promote');
    if (!name || !newRank) return { ok: false, error: 'All fields required.' };
    const auth = await resolveAuthorizer(authorizer);
    if (!auth) return { ok: false, error: 'Set your character name in your profile first.' };

    const emp = queryOne('SELECT rank FROM employees WHERE name = ?', [name]);
    if (!emp) return { ok: false, error: `${name} not found.` };

    const promo = today();
    transaction(() => {
      run('UPDATE employees SET rank = ?, last_promotion = ? WHERE name = ?', [newRank, promo, name]);
      run('INSERT INTO rank_history (event_date, name, old_rank, new_rank, authorizer) VALUES (?, ?, ?, ?, ?)',
        [promo, name, emp.rank, newRank, auth]);
      const inSupervisors = queryOne('SELECT id FROM supervisors WHERE name = ?', [name]);
      if (SUPERVISOR_RANKS.has(newRank)) {
        if (inSupervisors) {
          run('UPDATE supervisors SET rank = ? WHERE name = ?', [newRank, name]);
        } else {
          run('INSERT INTO supervisors (name, rank) VALUES (?, ?)', [name, newRank]);
        }
      } else if (inSupervisors) {
        run('DELETE FROM supervisors WHERE name = ?', [name]);
      }
    });

    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Promote — ${name}`, `${emp.rank} → ${newRank} · Auth: ${auth}`);
    revalidatePath('/'); revalidatePath('/history');
    revalidatePath('/supervisors'); revalidatePath('/tasks');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function renameEmployee({ oldName, newName }) {
  try {
    await requirePerm('roster', 'rename');
    if (!oldName || !newName?.trim()) return { ok: false, error: 'Both names required.' };
    const newTrimmed = newName.trim();
    const exists = queryOne('SELECT id FROM employees WHERE name = ? AND name != ?', [newTrimmed, oldName]);
    if (exists) return { ok: false, error: `${newTrimmed} already exists.` };

    transaction(() => {
      run('UPDATE employees SET name = ? WHERE name = ?', [newTrimmed, oldName]);
      run('UPDATE employee_hours SET employee_name = ? WHERE employee_name = ?', [newTrimmed, oldName]);
      run('UPDATE rank_history SET name = ? WHERE name = ?', [newTrimmed, oldName]);
      run('UPDATE supervisors SET name = ? WHERE name = ?', [newTrimmed, oldName]);
    });

    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Rename — ${oldName}`, `→ ${newTrimmed}`);
    revalidatePath('/'); revalidatePath('/history');
    revalidatePath('/supervisors'); revalidatePath('/tasks');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Payroll ───────────────────────────────────────────────────

// entries: [{ name, hours }] — only employees who worked that week
export async function submitPay({ weekDate, startingBalance, entries }) {
  try {
    if (!weekDate?.trim()) return { ok: false, error: 'Week date required.' };
    if (isNaN(parseFloat(startingBalance))) return { ok: false, error: 'Invalid starting balance.' };
    if (!Array.isArray(entries) || entries.length === 0) return { ok: false, error: 'No hours entered.' };

    const active = entries.filter(e => e.hours > 0);
    if (!active.length) return { ok: false, error: 'All hours are zero.' };

    let totalPay   = 0;
    let totalHours = 0;

    // Validate all employees exist and calculate total pay
    for (const e of active) {
      const emp = queryOne('SELECT rank FROM employees WHERE name = ?', [e.name]);
      if (!emp) return { ok: false, error: `Employee "${e.name}" not found.` };
      const rate = HOURLY_RATES[emp.rank] || 0;
      totalPay   += e.hours * rate;
      totalHours += e.hours;
    }

    const newBalance = parseFloat(startingBalance) - totalPay;
    const wk = weekDate.trim();

    transaction(() => {
      for (const e of active) {
        run(
          'INSERT INTO employee_hours (employee_name, week_ending, hours) VALUES (?, ?, ?) ON CONFLICT(employee_name, week_ending) DO UPDATE SET hours = excluded.hours',
          [e.name, wk, e.hours]
        );
      }
      run(
        'INSERT INTO treasury (timestamp, type, amount, balance, notes) VALUES (?, ?, ?, ?, ?)',
        [
          new Date().toLocaleString('en-US'),
          'Payroll',
          totalPay,
          newBalance,
          `Week ${wk}: ${worked.length} employees, ${totalHours.toFixed(2)} hrs`,
        ]
      );
    });

    revalidatePath('/');
    revalidatePath('/payroll');
    return { ok: true, updatedCount: active.length, totalHours, totalPay, newBalance };
  } catch (e) { return { ok: false, error: e.message }; }
}

// entries: [{ name, hours, amount }] — name already resolved to DB employee, amount from CSV
// bonusEntries (optional): [{ name, amount }] — retention bonuses to pay out in same run
export async function submitPayCSV({ weekDate, startingBalance, entries, bonusEntries = [] }) {
  try {
    await requirePerm('payroll', 'submit');
    if (!weekDate?.trim()) return { ok: false, error: 'Week date required.' };
    if (isNaN(parseFloat(startingBalance))) return { ok: false, error: 'Invalid starting balance.' };
    if (!Array.isArray(entries) || entries.length === 0) return { ok: false, error: 'No entries provided.' };

    // Validate all entries exist
    for (const e of entries) {
      const emp = queryOne('SELECT id FROM employees WHERE name = ?', [e.name]);
      if (!emp) return { ok: false, error: `Employee "${e.name}" not found.` };
    }

    // Drop any retention bonus whose milestone is already paid — resubmitting
    // the same payroll week must not pay it twice. Done before the totals so
    // the treasury math matches what actually gets written.
    const skippedBonuses = [];
    const payableBonuses = bonusEntries.filter(b => {
      const dupDate = alreadyPaidMilestone(b.name, b.months);
      if (dupDate) { skippedBonuses.push(`${b.name} (${b.months}-month bonus already paid ${dupDate})`); return false; }
      return true;
    });

    // Pay totals only count employees who actually worked
    const worked      = entries.filter(e => e.hours > 0);
    const totalPay    = worked.reduce((s, e) => s + (e.amount || 0), 0);
    const totalHours  = worked.reduce((s, e) => s + e.hours, 0);
    const totalBonus  = payableBonuses.reduce((s, e) => s + (e.amount || 0), 0);
    const balAfterPay = parseFloat(startingBalance) - totalPay;
    const finalBal    = balAfterPay - totalBonus;
    const wk = weekDate.trim();
    const ts = new Date().toLocaleString('en-US');

    // Every active employee gets a row for this week — 0 if not in the CSV
    const allActive = query('SELECT name FROM employees').map(r => r.name);

    transaction(() => {
      // Write actual hours from CSV (including explicit 0s)
      for (const e of entries) {
        run(
          'INSERT INTO employee_hours (employee_name, week_ending, hours) VALUES (?, ?, ?) ON CONFLICT(employee_name, week_ending) DO UPDATE SET hours = excluded.hours',
          [e.name, wk, e.hours]
        );
      }
      // Fill in 0 for any active employee not covered by the CSV
      for (const name of allActive) {
        run(
          'INSERT OR IGNORE INTO employee_hours (employee_name, week_ending, hours) VALUES (?, ?, 0)',
          [name, wk]
        );
      }
      // Payroll treasury row
      run(
        'INSERT INTO treasury (timestamp, type, amount, balance, notes) VALUES (?, ?, ?, ?, ?)',
        [ts, 'Payroll', totalPay, payableBonuses.length ? balAfterPay : finalBal,
         `Week ${wk}: ${worked.length} employees, ${totalHours.toFixed(2)} hrs`]
      );
      // Retention bonus treasury row + per-employee bonus records
      if (payableBonuses.length) {
        const names = payableBonuses.map(e => e.name).join(', ');
        run(
          'INSERT INTO treasury (timestamp, type, amount, balance, notes) VALUES (?, ?, ?, ?, ?)',
          [ts, 'Retention Bonuses', totalBonus, finalBal,
           `${payableBonuses.length} employee${payableBonuses.length > 1 ? 's' : ''}: ${names}`]
        );
        for (const b of payableBonuses) {
          run('INSERT INTO bonus_payments (employee_name, amount, months_tenure, paid_date) VALUES (?, ?, ?, ?)',
            [b.name, b.amount, b.months ?? null, today()]);
        }
      }
    });

    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Payroll Submitted — Week ${wk}`, `${worked.length} employees · ${totalHours.toFixed(2)}h · $${totalPay.toLocaleString()}${totalBonus ? ` + $${totalBonus.toLocaleString()} bonuses` : ''}${skippedBonuses.length ? ` · skipped ${skippedBonuses.length} duplicate bonus(es)` : ''}`);
    revalidatePath('/'); revalidatePath('/payroll'); revalidatePath('/hours'); revalidatePath('/bonuses');
    return { ok: true, updatedCount: entries.length, workedCount: worked.length, totalHours, totalPay, totalBonus, finalBalance: finalBal, skippedBonuses };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function setTreasuryBalance({ amount, notes }) {
  try {
    await requirePerm('payroll', 'set_balance');
    const bal = parseFloat(amount);
    if (isNaN(bal)) return { ok: false, error: 'Invalid amount.' };
    run(
      'INSERT INTO treasury (timestamp, type, amount, balance, notes) VALUES (?, ?, ?, ?, ?)',
      [new Date().toLocaleString('en-US'), 'Balance Adjustment', bal, bal, notes || 'Manual balance set']
    );
    revalidatePath('/payroll');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function addTreasuryEntry({ type, amount, isCredit, notes }) {
  try {
    await requirePerm('payroll', 'add_entry');
    if (!type?.trim()) return { ok: false, error: 'Type is required.' };
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return { ok: false, error: 'Enter a valid amount greater than 0.' };
    const latest = queryOne('SELECT balance FROM treasury ORDER BY id DESC LIMIT 1');
    const prev   = latest?.balance ?? 0;
    const newBal = isCredit ? prev + amt : prev - amt;
    run(
      'INSERT INTO treasury (timestamp, type, amount, balance, notes) VALUES (?, ?, ?, ?, ?)',
      [new Date().toLocaleString('en-US'), type.trim(), amt, newBal, notes?.trim() || null]
    );
    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Treasury Entry — ${type}`, `${isCredit ? '+' : '-'}$${amt.toLocaleString()}${notes ? ` · ${notes}` : ''}`);
    revalidatePath('/payroll');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function updateEmployeeHours(employeeName, weekEnding, hours) {
  try {
    await requirePerm('hours', 'edit');
    const h = parseFloat(hours);
    if (isNaN(h) || h < 0) return { ok: false, error: 'Invalid hours.' };
    run(
      'INSERT INTO employee_hours (employee_name, week_ending, hours) VALUES (?, ?, ?) ON CONFLICT(employee_name, week_ending) DO UPDATE SET hours = excluded.hours',
      [employeeName, weekEnding, h]
    );
    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Hours Edit — ${employeeName}`, `Week ${weekEnding}: ${h}h`);
    revalidatePath('/hours');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Supervisor task system ────────────────────────────────────────

export async function getSupervisors() {
  try {
    return query('SELECT id, name, rank, is_on_loa, loa_start, loa_end, loa_reason FROM supervisors ORDER BY name ASC')
      .map(r => ({ ...r, is_on_loa: r.is_on_loa && isLoaActive(r.loa_end) ? 1 : 0 }));
  } catch (e) { return []; }
}

export async function addSupervisor({ name, rank }) {
  try {
    await requirePerm('supervisors', 'add');
    if (!name?.trim() || !rank?.trim()) return { ok: false, error: 'Name and rank required.' };
    const exists = queryOne('SELECT id FROM supervisors WHERE name = ?', [name.trim()]);
    if (exists) return { ok: false, error: `${name} already exists.` };
    run('INSERT INTO supervisors (name, rank) VALUES (?, ?)', [name.trim(), rank.trim()]);
    revalidatePath('/supervisors');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function removeSupervisor(name) {
  try {
    await requirePerm('supervisors', 'remove');
    run('DELETE FROM supervisors WHERE name = ?', [name]);
    revalidatePath('/supervisors');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function setLOA({ name, isOnLoa, loaStart, loaEnd, loaReason }) {
  try {
    await requirePerm('supervisors', 'loa');
    run(
      'UPDATE supervisors SET is_on_loa = ?, loa_start = ?, loa_end = ?, loa_reason = ? WHERE name = ?',
      [isOnLoa ? 1 : 0, loaStart || null, loaEnd || null, loaReason || null, name]
    );
    revalidatePath('/supervisors');
    revalidatePath('/tasks');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getSupTasks(includeHistorical = false) {
  try {
    const where = includeHistorical ? '' : 'WHERE is_historical = 0';
    return query(`SELECT id, task_name, owner, status, assigned_date, due_date, completed_date, notes, is_historical FROM sup_tasks ${where} ORDER BY id DESC`);
  } catch (e) { return []; }
}

export async function addSupTask({ taskName, owner, assignedDate, dueDate, notes }) {
  try {
    await requirePerm('tasks', 'add');
    if (!taskName?.trim()) return { ok: false, error: 'Task name required.' };
    run(
      'INSERT INTO sup_tasks (task_name, owner, status, assigned_date, due_date, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [taskName.trim(), owner?.trim() || null, 'Assigned', assignedDate?.trim() || today(), dueDate?.trim() || null, notes?.trim() || null]
    );
    revalidatePath('/tasks');
    const assignee = owner?.trim() || 'TBD';
    const due      = dueDate?.trim() ? `\n**Due:** ${dueDate.trim()}` : '';
    discordNotify(`<@&${SUPERVISOR_ROLE}> **New Task Added**\n**Task:** ${taskName.trim()}\n**Assigned To:** ${assignee}${due}\nhttps://ecrplsems.com/tasks`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function updateSupTask({ id, status, owner, completedDate, notes }) {
  try {
    await requirePerm('tasks', 'edit');
    const task = queryOne('SELECT id FROM sup_tasks WHERE id = ?', [id]);
    if (!task) return { ok: false, error: 'Task not found.' };
    run(
      'UPDATE sup_tasks SET status = ?, owner = ?, completed_date = ?, notes = ? WHERE id = ?',
      [status, owner?.trim() || null, completedDate?.trim() || null, notes?.trim() || null, id]
    );
    revalidatePath('/tasks');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function deleteSupTask(id) {
  try {
    await requirePerm('tasks', 'delete');
    run('DELETE FROM sup_tasks WHERE id = ?', [id]);
    revalidatePath('/tasks');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getDiscussions() {
  try {
    const discussions = query('SELECT id, date_posted, topic, link FROM sup_discussions ORDER BY id DESC');
    const responses   = query('SELECT discussion_id, supervisor_name, responded FROM sup_discussion_responses');
    const respMap = {};
    for (const r of responses) {
      if (!respMap[r.discussion_id]) respMap[r.discussion_id] = {};
      respMap[r.discussion_id][r.supervisor_name] = !!r.responded;
    }
    return discussions.map(d => ({ ...d, responses: respMap[d.id] || {} }));
  } catch (e) { return []; }
}

export async function addDiscussion({ datePosted, topic, link }) {
  try {
    await requirePerm('discussions', 'add');
    if (!topic?.trim()) return { ok: false, error: 'Topic required.' };
    const supervisors = query('SELECT name FROM supervisors ORDER BY name ASC');
    const { lastInsertRowid } = run(
      'INSERT INTO sup_discussions (date_posted, topic, link) VALUES (?, ?, ?)',
      [datePosted?.trim() || today(), topic.trim(), link?.trim() || null]
    );
    for (const s of supervisors) {
      run('INSERT OR IGNORE INTO sup_discussion_responses (discussion_id, supervisor_name, responded) VALUES (?, ?, 0)', [lastInsertRowid, s.name]);
    }
    revalidatePath('/discussions');
    const linkPart = link?.trim() ? `\n**Link:** ${link.trim()}` : '';
    discordNotify(`<@&${SUPERVISOR_ROLE}> **New Discussion Posted**\n**Topic:** ${topic.trim()}${linkPart}\nPlease log your response in the dashboard: https://ecrplsems.com/discussions`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function deleteDiscussion(id) {
  try {
    await requirePerm('discussions', 'delete');
    run('DELETE FROM sup_discussions WHERE id = ?', [id]);
    revalidatePath('/discussions');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function toggleDiscussionResponse({ discussionId, supervisorName, responded }) {
  try {
    run(
      'INSERT INTO sup_discussion_responses (discussion_id, supervisor_name, responded) VALUES (?, ?, ?) ON CONFLICT(discussion_id, supervisor_name) DO UPDATE SET responded = excluded.responded',
      [discussionId, supervisorName, responded ? 1 : 0]
    );
    revalidatePath('/discussions');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Bonus payment records ──────────────────────────────────────────

export async function markBonusPaid({ employeeName, amount, monthsTenure }) {
  try {
    await requirePerm('bonuses', 'pay');
    if (!employeeName) return { ok: false, error: 'Employee required.' };
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return { ok: false, error: 'Invalid amount.' };
    const dupDate = alreadyPaidMilestone(employeeName, monthsTenure);
    if (dupDate) return { ok: false, error: `${employeeName} was already paid the ${monthsTenure}-month bonus on ${dupDate}.` };
    const latest = queryOne('SELECT balance FROM treasury ORDER BY id DESC LIMIT 1');
    const newBal = (latest?.balance ?? 0) - amt;
    transaction(() => {
      run('INSERT INTO bonus_payments (employee_name, amount, months_tenure, paid_date) VALUES (?, ?, ?, ?)',
        [employeeName, amt, monthsTenure ?? null, today()]);
      run('INSERT INTO treasury (timestamp, type, amount, balance, notes) VALUES (?, ?, ?, ?, ?)',
        [new Date().toLocaleString('en-US'), 'Retention Bonus', amt, newBal,
         `${employeeName} — ${monthsTenure ?? '?'}-month milestone`]);
    });
    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Retention Bonus Paid — ${employeeName}`, `$${amt.toLocaleString()} · ${monthsTenure}-month milestone`);
    revalidatePath('/bonuses'); revalidatePath('/payroll');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getBonusPayments() {
  try {
    const rows = query('SELECT id, employee_name, amount, months_tenure, paid_date FROM bonus_payments');
    rows.sort((a, b) => {
      const da = parseFlexDate(a.paid_date);
      const db = parseFlexDate(b.paid_date);
      if (da && db && db - da !== 0) return db - da;
      return b.id - a.id;
    });
    return rows;
  } catch (e) { return []; }
}

export async function getDivisionalData() {
  try {
    const employees = query(
      'SELECT name, rank, hire_date, is_on_loa, loa_start, loa_end FROM employees ORDER BY name ASC'
    ).map(r => ({ name: r.name, rank: r.rank, hireDate: r.hire_date, isOnLoa: !!r.is_on_loa && isLoaActive(r.loa_end), loaStart: r.loa_start, loaEnd: r.loa_end }));

    const allWeeks = query('SELECT DISTINCT week_ending FROM employee_hours').map(r => r.week_ending);
    const weeks = allWeeks.sort((a, b) => {
      const da = parseFlexDate(a), db = parseFlexDate(b);
      if (da && db) return db - da;
      return 0;
    }).slice(0, 4);

    const hoursMap = {};
    if (weeks.length > 0) {
      const ph   = weeks.map(() => '?').join(',');
      const rows = query(
        `SELECT employee_name, week_ending, hours FROM employee_hours WHERE week_ending IN (${ph})`,
        weeks
      );
      for (const h of rows) {
        if (!hoursMap[h.employee_name]) hoursMap[h.employee_name] = {};
        hoursMap[h.employee_name][h.week_ending] = h.hours;
      }
    }
    return { employees, weeks, hoursMap };
  } catch (e) { console.error('getDivisionalData:', e); return { employees: [], weeks: [], hoursMap: {} }; }
}

// ── Supervisor task stats ──────────────────────────────────────────

export async function getSupTaskStats() {
  try {
    const rows = query(`
      SELECT owner,
        COUNT(*) as total,
        SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status!='Completed' AND is_historical=0 THEN 1 ELSE 0 END) as active
      FROM sup_tasks WHERE owner IS NOT NULL GROUP BY owner
    `);
    const stats = {};
    for (const r of rows) stats[r.owner] = r;
    return stats;
  } catch (e) { return {}; }
}

// ── App Settings ──────────────────────────────────────────────────

const SETTING_DEFAULTS = {
  level_names: {
    1: 'Supervisor',
    2: 'Command',
    3: 'High Command',
  },
  page_permissions: {
    roster:      { view:1, add:2, promote:2, rename:2, separate:3, loa:2 },
    hours:       { view:1, edit:1, delete_entry:2, delete_week:3, compliance:1, warn_bbcode:1 },
    payroll:     { view:2, submit:2, add_entry:2, delete_entry:3, set_balance:3 },
    bonuses:     { view:2, view_quarterly:2, view_retention:2, pay:2, copy_bbcode:2 },
    history:     { view:1 },
    supervisors: { view:1, add:2, remove:2, loa:2 },
    tasks:       { view:1, add:1, edit:1, delete:2 },
    discussions: { view:1, add:1, delete:2, respond:1 },
    admin:       { view:2, edit_config:3, edit_bbcode:2, access_control:3, view_audit:2 },
  },
  hour_requirements: {
    'Chief':           { type:'weekly',  hours:5,   goal:10 },
    'Assistant Chief': { type:'weekly',  hours:5,   goal:10 },
    'Deputy Chief':    { type:'weekly',  hours:5,   goal:10 },
    'Commander':       { type:'weekly',  hours:5,   goal:10 },
    'Captain':         { type:'weekly',  hours:5,   goal:10 },
    'Lieutenant':      { type:'weekly',  hours:5,   goal:10 },
    'Lead Paramedic':  { type:'weekly',  hours:5            },
    'Senior Paramedic':{ type:'weekly',  hours:5            },
    'Paramedic':       { type:'weekly',  hours:5            },
    'Junior Paramedic':{ type:'weekly',  hours:5            },
    'EMT-P':           { type:'monthly', hours:1            },
    'Master EMT':      { type:'weekly',  hours:2.5          },
    'EMT-A':           { type:'weekly',  hours:2.5          },
    'EMT-I':           { type:'weekly',  hours:2.5          },
    'EMT-B':           { type:'weekly',  hours:2.5          },
    'EMR':             { type:'weekly',  hours:2.5          },
    'Consultant':      { type:'weekly',  hours:2.5          },
  },
  salaries: {
    'Chief':8000,'Assistant Chief':8000,'Deputy Chief':8000,
    'Commander':7900,'Captain':7800,'Lieutenant':7700,
    'Lead Paramedic':7550,'Senior Paramedic':7300,'Paramedic':7150,'Junior Paramedic':7000,
    'Consultant':7000,'EMT-P':6900,'Master EMT':6900,
    'EMT-A':6800,'EMT-I':6650,'EMT-B':6500,'EMR':6000,
  },
  bonus_cycle: [
    { months:3,  amount:50000  },
    { months:6,  amount:75000  },
    { months:9,  amount:100000 },
    { months:12, amount:200000 },
  ],
  permission_roles: {
    '737481926943834193': 3,
    '587679776542556236': 3,
    '1039228533651816590': 3,
    '737482405690081371': 2,
    '740782964157448363': 1,
  },
};

export async function getAppSettings() {
  try {
    const rows = query('SELECT key, value FROM app_settings');
    const out  = { ...SETTING_DEFAULTS };
    for (const r of rows) {
      try {
        const val = JSON.parse(r.value);
        // Deep-merge page_permissions so new action keys in SETTING_DEFAULTS
        // survive even when the DB has an older saved record.
        if (r.key === 'page_permissions') {
          const defaults = SETTING_DEFAULTS.page_permissions || {};
          const merged   = {};
          const allPages = new Set([...Object.keys(defaults), ...Object.keys(val)]);
          for (const page of allPages) {
            merged[page] = { ...(defaults[page] || {}), ...(val[page] || {}) };
          }
          out[r.key] = merged;
        } else {
          out[r.key] = val;
        }
      } catch {}
    }
    return out;
  } catch { return { ...SETTING_DEFAULTS }; }
}

function resolveAccess(level, rawPerms, action) {
  if (action.startsWith('_')) return true; // meta fields, not actions
  const min    = rawPerms[action] ?? 1;
  const grants = (rawPerms._grants?.[action] || []);
  const denies = (rawPerms._denies?.[action] || []);
  if (denies.includes(level)) return false;
  if (grants.includes(level)) return true;
  return level >= min;
}

export async function getPageAccess(pageName) {
  try {
    const { level: realLevel } = await getActor();
    const store     = await cookies();
    const viewAsRaw = store.get('lsems_viewas')?.value;
    const viewAs    = viewAsRaw ? parseInt(viewAsRaw) : null;
    const level     = (viewAs && viewAs < realLevel) ? viewAs : realLevel;

    const settings = await getAppSettings();
    const rawPerms = settings.page_permissions?.[pageName] || {};
    const result   = {};
    for (const action of Object.keys(rawPerms)) {
      if (!action.startsWith('_')) result[action] = resolveAccess(level, rawPerms, action);
    }
    return result;
  } catch { return {}; }
}

// Server-side guard — always uses REAL level, never viewAs
async function requirePerm(page, action) {
  const { level } = await getActor();
  const settings  = await getAppSettings();
  const rawPerms  = settings.page_permissions?.[page] || {};
  if (!resolveAccess(level, rawPerms, action)) throw new Error('Permission denied.');
}

export async function updateAppSetting(key, value) {
  try {
    run(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)]
    );
    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Admin Setting Changed — ${key}`, null);
    revalidatePath('/'); revalidatePath('/hours'); revalidatePath('/bonuses'); revalidatePath('/payroll'); revalidatePath('/admin');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Employment history ─────────────────────────────────────────────

export async function getEmploymentHistory() {
  try {
    const history = query('SELECT event_date, name, old_rank, new_rank, authorizer FROM rank_history ORDER BY name ASC, id ASC');
    const past    = query('SELECT name, hire_date, date_separated, exit_rank, authorizer, total_hours FROM past_employees ORDER BY name ASC');
    const current = query('SELECT name, rank, hire_date, last_promotion FROM employees ORDER BY name ASC');
    return { history, past, current };
  } catch (e) { return { history: [], past: [], current: [] }; }
}
