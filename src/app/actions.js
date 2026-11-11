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
      // Only the Supervisor role may be pinged — user-entered text can't trigger @everyone/@here
      body: JSON.stringify({ content, allowed_mentions: { parse: [], roles: [SUPERVISOR_ROLE] } }),
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
    await requirePerm('admin', 'view_audit');
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

// True once the LOA start date has arrived (an unreadable start date counts as started)
function isLoaStarted(loaStart) {
  if (!loaStart) return true;
  const start = parseFlexDate(loaStart);
  if (!start) return true;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return start <= now;
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
        loaStarted:    !!r.is_on_loa && isLoaActive(r.loa_end) && isLoaStarted(r.loa_start),
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
    // Same inputs the Bonuses page uses, so the profile's "Next Bonus" matches it.
    const bonusResolutions = query(
      'SELECT employee_name, months_tenure, due_date, undone_at FROM bonus_resolutions WHERE LOWER(employee_name) = LOWER(?) AND undone_at IS NULL', [name]
    );
    const bonusCycle = (await getAppSettings()).bonus_cycle || null;
    return { ok: true, hours, bonuses, rankHistory, loaHistory, bonusResolutions, bonusCycle };
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
    await requirePerm('bonuses', 'view');
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
    await requirePerm('payroll', 'view');
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

    // Hours may already exist under the new name — e.g. a separated employee
    // re-added with a typo and then corrected. Merge those weeks instead of
    // tripping UNIQUE(employee_name, week_ending). A case-only rename hits the
    // same rows (the column is COLLATE NOCASE), so no merge is needed then.
    const caseOnly = newTrimmed.toLowerCase() === oldName.toLowerCase();
    const overlap = caseOnly ? [] : query(
      `SELECT a.week_ending FROM employee_hours a
         JOIN employee_hours b ON b.week_ending = a.week_ending AND b.employee_name = ?
        WHERE a.employee_name = ?`, [newTrimmed, oldName]).map(r => r.week_ending);

    transaction(() => {
      run('UPDATE employees SET name = ? WHERE name = ?', [newTrimmed, oldName]);
      if (overlap.length) {
        const ph = overlap.map(() => '?').join(',');
        run(`UPDATE employee_hours SET hours = hours + COALESCE((
               SELECT h.hours FROM employee_hours h
                WHERE h.employee_name = ? AND h.week_ending = employee_hours.week_ending), 0)
              WHERE employee_name = ? AND week_ending IN (${ph})`,
          [oldName, newTrimmed, ...overlap]);
        run(`DELETE FROM employee_hours WHERE employee_name = ? AND week_ending IN (${ph})`,
          [oldName, ...overlap]);
      }
      run('UPDATE employee_hours SET employee_name = ? WHERE employee_name = ?', [newTrimmed, oldName]);
      run('UPDATE rank_history SET name = ? WHERE name = ?', [newTrimmed, oldName]);
      run('UPDATE supervisors SET name = ? WHERE name = ?', [newTrimmed, oldName]);
    });

    const { username, user_id } = await getActor();
    const merged = overlap.length ? ` · merged ${overlap.length} week(s) of existing hours` : '';
    logAudit(username, user_id, `Rename — ${oldName}`, `→ ${newTrimmed}${merged}`);
    revalidatePath('/'); revalidatePath('/history');
    revalidatePath('/supervisors'); revalidatePath('/tasks');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Payroll ───────────────────────────────────────────────────

// entries: [{ name, hours }] — only employees who worked that week
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
    return query(`SELECT id, task_name, owner, status, assigned_date, due_date, completed_date, notes, is_historical, announced_at FROM sup_tasks ${where} ORDER BY id DESC`);
  } catch (e) { return []; }
}

// A task's start date (assigned_date) as YYYY-MM-DD, or null if unreadable.
function taskStartIso(dateStr) {
  const d = parseFlexDate(dateStr);
  return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : null;
}
// Future start → Discord is told by loa-bot.mjs at 00:00 UTC on the start date.
function taskStartsLater(dateStr) {
  const iso = taskStartIso(dateStr);
  return !!iso && iso > new Date().toISOString().slice(0, 10);
}

export async function addSupTask({ taskName, owner, assignedDate, dueDate, notes }) {
  try {
    await requirePerm('tasks', 'add');
    if (!taskName?.trim()) return { ok: false, error: 'Task name required.' };
    const start = assignedDate?.trim() || today();
    if (assignedDate?.trim() && !taskStartIso(start)) return { ok: false, error: 'Start date not recognised — use DD/Mon/YYYY.' };
    const later = taskStartsLater(start);
    run(
      `INSERT INTO sup_tasks (task_name, owner, status, assigned_date, due_date, notes, announced_at) VALUES (?, ?, ?, ?, ?, ?, ${later ? 'NULL' : "datetime('now')"})`,
      [taskName.trim(), owner?.trim() || null, 'Assigned', start, dueDate?.trim() || null, notes?.trim() || null]
    );
    revalidatePath('/tasks');
    if (later) return { ok: true, scheduled: start };
    const assignee = owner?.trim() || 'TBD';
    const due      = dueDate?.trim() ? `\n**Due:** ${dueDate.trim()}` : '';
    discordNotify(`<@&${SUPERVISOR_ROLE}> **New Task Added**\n**Task:** ${taskName.trim()}\n**Assigned To:** ${assignee}${due}\nhttps://ecrplsems.com/tasks`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function updateSupTask({ id, status, owner, completedDate, notes, startDate }) {
  try {
    await requirePerm('tasks', 'edit');
    const task = queryOne('SELECT id FROM sup_tasks WHERE id = ?', [id]);
    if (!task) return { ok: false, error: 'Task not found.' };
    run(
      'UPDATE sup_tasks SET status = ?, owner = ?, completed_date = ?, notes = ? WHERE id = ?',
      [status, owner?.trim() || null, completedDate?.trim() || null, notes?.trim() || null, id]
    );
    // Start date only changes when the caller sends one (the Edit dialog does).
    // A not-yet-announced task is picked up by the bot on its (new) start date;
    // one that was already announced is never announced again.
    if (startDate !== undefined && startDate?.trim()) {
      if (!taskStartIso(startDate.trim())) return { ok: false, error: 'Start date not recognised — use DD/Mon/YYYY.' };
      run('UPDATE sup_tasks SET assigned_date = ? WHERE id = ?', [startDate.trim(), id]);
    }
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

// sup_discussion_responses.responded values
const RESP = { PENDING: 0, RESPONDED: 1, NO_RESPONSE: 2, EXCUSED: 3 };

export async function getDiscussions() {
  try {
    const discussions = query('SELECT id, date_posted, topic, link FROM sup_discussions WHERE archived_at IS NULL ORDER BY id DESC');
    const responses   = query('SELECT discussion_id, supervisor_name, responded FROM sup_discussion_responses');
    const respMap = {};
    for (const r of responses) {
      if (!respMap[r.discussion_id]) respMap[r.discussion_id] = {};
      respMap[r.discussion_id][r.supervisor_name] = r.responded === RESP.RESPONDED;
    }
    return discussions.map(d => ({ ...d, responses: respMap[d.id] || {} }));
  } catch (e) { return []; }
}

export async function addDiscussion({ datePosted, topic, link }) {
  try {
    await requirePerm('discussions', 'add');
    if (!topic?.trim()) return { ok: false, error: 'Topic required.' };
    if (link?.trim() && !/^https?:\/\/\S+$/i.test(link.trim())) return { ok: false, error: 'Link must start with http:// or https://' };
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
    await requirePerm('discussions', 'respond');
    const disc = queryOne('SELECT archived_at FROM sup_discussions WHERE id = ?', [discussionId]);
    if (!disc) return { ok: false, error: 'Discussion not found.' };
    if (disc.archived_at) return { ok: false, error: 'This discussion is archived. Unarchive it to change responses.' };
    run(
      'INSERT INTO sup_discussion_responses (discussion_id, supervisor_name, responded) VALUES (?, ?, ?) ON CONFLICT(discussion_id, supervisor_name) DO UPDATE SET responded = excluded.responded',
      [discussionId, supervisorName, responded ? 1 : 0]
    );
    revalidatePath('/discussions');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function getArchivedDiscussions() {
  try {
    const discussions = query('SELECT id, date_posted, topic, link, archived_at, archived_by FROM sup_discussions WHERE archived_at IS NOT NULL ORDER BY id DESC');
    const responses   = query('SELECT discussion_id, supervisor_name, responded FROM sup_discussion_responses WHERE responded != 0 ORDER BY supervisor_name ASC');
    const byDisc = {};
    for (const r of responses) {
      const b = byDisc[r.discussion_id] ||= { responded: [], noResponse: [], excused: [] };
      if (r.responded === RESP.RESPONDED)        b.responded.push(r.supervisor_name);
      else if (r.responded === RESP.NO_RESPONSE) b.noResponse.push(r.supervisor_name);
      else if (r.responded === RESP.EXCUSED)     b.excused.push(r.supervisor_name);
    }
    return discussions.map(d => ({ ...d, ...(byDisc[d.id] || { responded: [], noResponse: [], excused: [] }) }));
  } catch (e) { return []; }
}

// Archive a discussion: every current supervisor who hasn't responded is
// recorded as "no response" (or "excused" if they're on an active LOA).
export async function archiveDiscussion(id) {
  try {
    await requirePerm('discussions', 'archive');
    const disc = queryOne('SELECT id, topic, archived_at FROM sup_discussions WHERE id = ?', [id]);
    if (!disc) return { ok: false, error: 'Discussion not found.' };
    if (disc.archived_at) return { ok: false, error: 'Already archived.' };
    const sups = await getSupervisors();
    const { username, user_id } = await getActor();
    let noResp = 0, excused = 0;
    transaction(() => {
      for (const s of sups) {
        const status = s.is_on_loa ? RESP.EXCUSED : RESP.NO_RESPONSE;
        const r = run(
          `INSERT INTO sup_discussion_responses (discussion_id, supervisor_name, responded) VALUES (?, ?, ?)
           ON CONFLICT(discussion_id, supervisor_name) DO UPDATE SET responded = excluded.responded WHERE responded = ${RESP.PENDING}`,
          [id, s.name, status]
        );
        if (r.changes) status === RESP.EXCUSED ? excused++ : noResp++;
      }
      run('UPDATE sup_discussions SET archived_at = ?, archived_by = ? WHERE id = ?', [today(), username || null, id]);
    });
    revalidatePath('/tasks'); revalidatePath('/discussions');
    logAudit(username, user_id, `Archive Discussion — ${disc.topic}`, `${noResp} no response${excused ? ` · ${excused} excused (LOA)` : ''}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Unarchive: back to the active list; auto-marked no-response/excused go back to pending.
export async function unarchiveDiscussion(id) {
  try {
    await requirePerm('discussions', 'archive');
    const disc = queryOne('SELECT id, topic, archived_at FROM sup_discussions WHERE id = ?', [id]);
    if (!disc) return { ok: false, error: 'Discussion not found.' };
    if (!disc.archived_at) return { ok: false, error: 'Not archived.' };
    transaction(() => {
      run(`UPDATE sup_discussion_responses SET responded = ${RESP.PENDING} WHERE discussion_id = ? AND responded IN (${RESP.NO_RESPONSE}, ${RESP.EXCUSED})`, [id]);
      run('UPDATE sup_discussions SET archived_at = NULL, archived_by = NULL WHERE id = ?', [id]);
    });
    revalidatePath('/tasks'); revalidatePath('/discussions');
    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Unarchive Discussion — ${disc.topic}`, '');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Bonus payment records ──────────────────────────────────────────

// ── Retention bonus resolutions ────────────────────────────────────
// Settle an overdue milestone without recording a new payment.
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export async function getBonusResolutions() {
  try {
    if (!(await hasPerm('bonuses', 'view')) && !(await hasPerm('payroll', 'view'))) return [];
    return query(`
      SELECT r.id, r.employee_name, r.months_tenure, r.amount, r.due_date, r.type, r.payment_id, r.reason,
             r.resolved_by, r.resolved_at, r.undone_by, r.undone_at,
             p.paid_date AS payment_date, p.amount AS payment_amount, p.months_tenure AS payment_months
      FROM bonus_resolutions r LEFT JOIN bonus_payments p ON p.id = r.payment_id
      ORDER BY r.id DESC`);
  } catch (e) { return []; }
}

export async function resolveBonus({ employeeName, monthsTenure, amount, type, paymentId, reason }) {
  try {
    await requirePerm('bonuses', 'resolve');
    if (type !== 'covered' && type !== 'dismissed') return { ok: false, error: 'Choose how to resolve it.' };
    const emp = queryOne('SELECT name, hire_date, bonus_anchor, bonus_step FROM employees WHERE LOWER(name) = LOWER(?)', [employeeName || '']);
    if (!emp) return { ok: false, error: 'Employee not found.' };
    const months = Number(monthsTenure);
    const due = milestoneDueDate(emp, months);
    if (!due) return { ok: false, error: 'Could not work out that milestone\'s due date.' };
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (due > now) return { ok: false, error: 'That milestone isn\'t due yet.' };
    const dup = queryOne('SELECT id FROM bonus_resolutions WHERE LOWER(employee_name) = LOWER(?) AND months_tenure = ? AND undone_at IS NULL', [emp.name, months]);
    if (dup) return { ok: false, error: 'That milestone is already resolved.' };
    const note = (reason || '').trim();
    let pay = null;
    if (type === 'covered') {
      pay = queryOne('SELECT id, paid_date, amount, months_tenure FROM bonus_payments WHERE id = ? AND LOWER(employee_name) = LOWER(?)', [paymentId, emp.name]);
      if (!pay) return { ok: false, error: 'Pick one of this employee\'s payments.' };
    } else if (note.length < 5) {
      return { ok: false, error: 'Please give a reason (at least a few words).' };
    }
    const { username, user_id } = await getActor();
    run(`INSERT INTO bonus_resolutions (employee_name, months_tenure, amount, due_date, type, payment_id, reason, resolved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp.name, months, Number(amount) || null, isoDate(due), type, pay?.id ?? null, note || null, username || null]);
    revalidatePath('/bonuses'); revalidatePath('/payroll');
    logAudit(username, user_id, `Retention Bonus ${type === 'covered' ? 'Resolved' : 'Dismissed'} — ${emp.name}`,
      `${months}-month milestone` + (pay ? ` · covered by payment ${pay.paid_date} ($${Number(pay.amount).toLocaleString()})` : '') + (note ? ` · ${note}` : ''));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function undoBonusResolution(id) {
  try {
    await requirePerm('bonuses', 'resolve');
    const r = queryOne('SELECT id, employee_name, months_tenure, type, undone_at FROM bonus_resolutions WHERE id = ?', [id]);
    if (!r) return { ok: false, error: 'Not found.' };
    if (r.undone_at) return { ok: false, error: 'Already undone.' };
    const { username, user_id } = await getActor();
    run("UPDATE bonus_resolutions SET undone_at = datetime('now'), undone_by = ? WHERE id = ?", [username || null, id]);
    revalidatePath('/bonuses'); revalidatePath('/payroll');
    logAudit(username, user_id, `Retention Bonus ${r.type === 'covered' ? 'Resolution' : 'Dismissal'} Undone — ${r.employee_name}`, `${r.months_tenure}-month milestone is due again`);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

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
    // Used by both the Bonuses and Payroll pages
    if (!(await hasPerm('bonuses', 'view')) && !(await hasPerm('payroll', 'view'))) return [];
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
    await requirePerm('bonuses', 'view');
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

// Per-person totals for Admin → Supervisor Stats. Tasks with several owners
// ("A, B") credit each person. Discussion counts cover active + archived topics;
// "no response" / "excused" are only recorded when a topic is archived.
export async function getSupervisorStats() {
  try {
    await requirePerm('admin', 'view');
    const people = new Map(); // lower-cased name -> stats
    const get = (name) => {
      const key = name.trim().toLowerCase();
      if (!people.has(key)) people.set(key, { name: name.trim(), current: false, onLoa: false, tasksCompleted: 0, tasksActive: 0, responded: 0, noResponse: 0, excused: 0, pending: 0 });
      return people.get(key);
    };
    for (const s of await getSupervisors()) { const p = get(s.name); p.name = s.name; p.current = true; p.onLoa = !!s.is_on_loa; }
    for (const t of query("SELECT owner, status, is_historical FROM sup_tasks WHERE owner IS NOT NULL AND TRIM(owner) != ''")) {
      for (const n of t.owner.split(',').map(x => x.trim()).filter(Boolean)) {
        const p = get(n);
        if (t.status === 'Completed') p.tasksCompleted++;
        else if (!t.is_historical) p.tasksActive++;
      }
    }
    for (const r of query('SELECT supervisor_name, responded FROM sup_discussion_responses')) {
      const p = get(r.supervisor_name);
      if (r.responded === RESP.RESPONDED)        p.responded++;
      else if (r.responded === RESP.NO_RESPONSE) p.noResponse++;
      else if (r.responded === RESP.EXCUSED)     p.excused++;
      else                                       p.pending++;
    }
    return [...people.values()];
  } catch (e) { return []; }
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
    bonuses:     { view:2, view_quarterly:2, view_retention:2, pay:2, copy_bbcode:2, resolve:2 },
    history:     { view:1 },
    supervisors: { view:1, add:2, remove:2, loa:2 },
    tasks:       { view:1, add:1, edit:1, delete:2 },
    discussions: { view:1, add:1, delete:2, respond:1, archive:2 },
    admin:       { view:2, edit_config:3, edit_bbcode:2, access_control:3, view_audit:2, edit_carters_count:2 },
    calendar:    { view:1, add:2, edit:2, delete:2 },
  },
  // Discord reminder wording for supervisor events. Placeholders are filled in
  // by loa-bot.mjs (which keeps its own copy of these defaults).
  calendar_reminders: {
    day:  '{supervisor} **Reminder — {title}**\nStarts {start_full}, which is {start_relative}.\n{link}',
    hour: '{supervisor} **Starting soon — {title}**\nStarts {start_full}, which is {start_relative}.\n{link}',
  },
  // All-Hands Meeting messages (posted in #announcements). No ping by default —
  // add {employee} or a role mention on the Admin page.
  allhands_messages: {
    created: '**All-Hands Meeting Scheduled — {title}**\nStarts {start_full}, which is {start_relative}.\n{link}',
    day:     '**All-Hands Meeting Reminder — {title}**\nStarts {start_full}, which is {start_relative}.\n{link}',
    hour:    '**All-Hands Meeting Starting Soon — {title}**\nStarts {start_full}, which is {start_relative}.\n{link}',
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
  carters_count: 0,
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

async function hasPerm(page, action) {
  try { await requirePerm(page, action); return true; } catch { return false; }
}

// Server-side guard — always uses REAL level, never viewAs
async function requirePerm(page, action) {
  const { level } = await getActor();
  const settings  = await getAppSettings();
  const rawPerms  = settings.page_permissions?.[page] || {};
  if (!resolveAccess(level, rawPerms, action)) throw new Error('Permission denied.');
}

// Which Admin permission is needed to change each setting. Keys not listed
// here can't be changed at all.
const SETTING_PERMS = {
  hour_requirements:  'edit_config',
  salaries:           'edit_config',
  bonus_cycle:        'edit_config',
  carters_count:      'edit_carters_count',
  bbcode_templates:   'edit_bbcode',
  calendar_reminders: 'edit_bbcode',
  allhands_messages:  'edit_bbcode',
  page_permissions:   'access_control',
  permission_roles:   'access_control',
  level_names:        'access_control',
};

export async function updateAppSetting(key, value) {
  try {
    const action = SETTING_PERMS[key];
    if (!action) return { ok: false, error: 'Unknown setting.' };
    await requirePerm('admin', action);
    if (key === 'carters_count') {
      value = Number(value);
      if (!Number.isInteger(value)) return { ok: false, error: "Carter's Kill Count must be a whole number." };
    }
    run(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)]
    );
    const { username, user_id } = await getActor();
    logAudit(username, user_id, `Admin Setting Changed — ${key}`, key === 'carters_count' ? `Set to ${value}` : null);
    if (key === 'carters_count') revalidatePath('/', 'layout'); // navbar counter on every page
    revalidatePath('/'); revalidatePath('/hours'); revalidatePath('/bonuses'); revalidatePath('/payroll'); revalidatePath('/admin');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Calendar ──────────────────────────────────────────────────────
// Times are unix seconds (UTC). An event can be for Supervisors and/or an
// All-Hands Meeting; each has its own Discord messages, sent by loa-bot.mjs.
// *timing_set_at records when the start time (or that flag) was last set — the
// bot only sends the 24h reminder if that was at least 24h before the start, so
// short-notice events get just the 1h reminder. *_at columns are set by the bot
// once a message has gone out.

const EVENTS_DDL = `CREATE TABLE IF NOT EXISTS calendar_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  link            TEXT,
  start_ts        INTEGER NOT NULL,
  end_ts          INTEGER,
  for_supervisors INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      INTEGER NOT NULL,
  timing_set_at   INTEGER NOT NULL,
  reminded_24h_at INTEGER,
  reminded_1h_at  INTEGER
)`;
// Columns added after the table was first created (also added by loa-bot.mjs)
const EVENT_COLUMNS = {
  all_hands:          'INTEGER NOT NULL DEFAULT 0',
  ah_timing_set_at:   'INTEGER',
  ah_announced_at:    'INTEGER',
  ah_reminded_24h_at: 'INTEGER',
  ah_reminded_1h_at:  'INTEGER',
};
let _eventsReady = false;
function ensureEventsTable() {
  if (_eventsReady) return;
  run(EVENTS_DDL);
  run('CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_ts)');
  const have = new Set(query('PRAGMA table_info(calendar_events)').map(c => c.name));
  for (const [col, type] of Object.entries(EVENT_COLUMNS)) {
    if (have.has(col)) continue;
    try { run(`ALTER TABLE calendar_events ADD COLUMN ${col} ${type}`); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; } // the bot got there first
  }
  _eventsReady = true;
}

function validateEvent({ title, link, startTs, endTs }) {
  if (!title?.trim())             return 'Title required.';
  if (title.trim().length > 200)  return 'Title is too long (200 characters max).';
  if (link?.trim() && !/^https?:\/\/\S+$/i.test(link.trim())) return 'Link must start with http:// or https://';
  if (!Number.isInteger(startTs)) return 'Start date and time are required.';
  if (endTs != null && !Number.isInteger(endTs)) return 'Invalid end time.';
  if (endTs != null && endTs <= startTs) return 'End time must be after the start time.';
  return null;
}

const eventTags = (forSupervisors, allHands) =>
  `${forSupervisors ? ' · Supervisors' : ''}${allHands ? ' · All-Hands' : ''}`;

export async function getEvents() {
  try {
    ensureEventsTable();
    return query(`SELECT id, title, link, start_ts, end_ts, for_supervisors, all_hands, created_by,
      reminded_24h_at, reminded_1h_at, ah_announced_at, ah_reminded_24h_at, ah_reminded_1h_at
      FROM calendar_events ORDER BY start_ts ASC`);
  } catch (e) { console.error('getEvents:', e); return []; }
}

export async function addEvent({ title, link, startTs, endTs, forSupervisors, allHands }) {
  try {
    await requirePerm('calendar', 'add');
    ensureEventsTable();
    const err = validateEvent({ title, link, startTs, endTs });
    if (err) return { ok: false, error: err };
    const { username, user_id } = await getActor();
    const now = Math.floor(Date.now() / 1000);
    run(
      `INSERT INTO calendar_events (title, link, start_ts, end_ts, for_supervisors, all_hands, created_by, created_at, timing_set_at, ah_timing_set_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title.trim(), link?.trim() || null, startTs, endTs ?? null, forSupervisors ? 1 : 0, allHands ? 1 : 0, username, now, now, now]
    );
    logAudit(username, user_id, 'Calendar Event Added', `${title.trim()} · ${new Date(startTs * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC${eventTags(forSupervisors, allHands)}`);
    revalidatePath('/calendar');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function updateEvent({ id, title, link, startTs, endTs, forSupervisors, allHands }) {
  try {
    await requirePerm('calendar', 'edit');
    ensureEventsTable();
    const ev = queryOne('SELECT start_ts, for_supervisors, all_hands FROM calendar_events WHERE id = ?', [id]);
    if (!ev) return { ok: false, error: 'Event not found.' };
    const err = validateEvent({ title, link, startTs, endTs });
    if (err) return { ok: false, error: err };
    // A new start time re-arms both sets of reminders; newly ticking a box
    // re-arms that one's. Newly ticking All-Hands also re-sends its "created"
    // announcement — moving the start time doesn't.
    const now      = Math.floor(Date.now() / 1000);
    const moved    = ev.start_ts !== startTs;
    const supOn    = !ev.for_supervisors && !!forSupervisors;
    const ahOn     = !ev.all_hands && !!allHands;
    const sets     = ['title = ?', 'link = ?', 'start_ts = ?', 'end_ts = ?', 'for_supervisors = ?', 'all_hands = ?'];
    const params   = [title.trim(), link?.trim() || null, startTs, endTs ?? null, forSupervisors ? 1 : 0, allHands ? 1 : 0];
    if (moved || supOn) { sets.push('timing_set_at = ?', 'reminded_24h_at = NULL', 'reminded_1h_at = NULL'); params.push(now); }
    if (moved || ahOn)  { sets.push('ah_timing_set_at = ?', 'ah_reminded_24h_at = NULL', 'ah_reminded_1h_at = NULL'); params.push(now); }
    if (ahOn)           { sets.push('ah_announced_at = NULL'); }
    run(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    const { username, user_id } = await getActor();
    logAudit(username, user_id, 'Calendar Event Edited', `${title.trim()}${eventTags(forSupervisors, allHands)}`);
    revalidatePath('/calendar');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function deleteEvent(id) {
  try {
    await requirePerm('calendar', 'delete');
    ensureEventsTable();
    const ev = queryOne('SELECT title FROM calendar_events WHERE id = ?', [id]);
    if (!ev) return { ok: false, error: 'Event not found.' };
    run('DELETE FROM calendar_events WHERE id = ?', [id]);
    const { username, user_id } = await getActor();
    logAudit(username, user_id, 'Calendar Event Deleted', ev.title);
    revalidatePath('/calendar');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
