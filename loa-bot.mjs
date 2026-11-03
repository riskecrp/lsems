/**
 * LSEMS LOA Bot
 * Reads the LOA webhook feed (embeds) and automatically sets LOA records.
 *
 * Embed formats handled:
 *   author.name: "Leave of Absence • RANK NAME | [DD/MON/YYYY] to [DD/MON/YYYY]"
 *   author.name: "Leave of Absence • RANK | NAME [DD/MON/YYYY] to [DD/MON/YYYY]"
 *   footer.text: "Author: Firstname Lastname"  ← used for name lookup
 */
import { Client, GatewayIntentBits, Events } from 'discord.js';
import Database from 'better-sqlite3';

process.loadEnvFile('/opt/lsems/.env');

const BOT_TOKEN           = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID          = '1369579949878411344';
const RESIGN_CHANNEL_ID   = '1369582404963930122';
const RIBBON_CHANNEL_ID   = '1369586851975008326';
const NOTIFY_CHANNEL      = '520680995704274954';
const SUPERVISOR_ROLE     = '740782964157448363';
const SENIOR_PARA_ROLE    = '459439799825072129';
const LEAD_PARA_ROLE      = '579584822494625803';
const DB_PATH             = '/opt/lsems/data/lsems.db';
const REVALIDATE_URL      = 'http://127.0.0.1:3002/api/revalidate';
const REVALIDATE_SECRET   = process.env.REVALIDATE_SECRET;

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_LOOKUP = {};
['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']
  .forEach((m,i) => MONTH_LOOKUP[m] = i);
MONTH_NAMES.forEach((m,i) => MONTH_LOOKUP[m.toUpperCase()] = i);

// Normalise any date variant to DD/Mon/YYYY
function normaliseDate(s) {
  return s.replace(/(\d{1,2})\/([A-Za-z]+|\d{1,2})\/(\d{4})/g, (_, d, mon, y) => {
    const dd = d.padStart(2, '0');
    if (/^\d+$/.test(mon)) return `${dd}/${MONTH_NAMES[parseInt(mon) - 1]}/${y}`;
    const idx = MONTH_LOOKUP[mon.toUpperCase().slice(0, 9)];
    if (idx !== undefined) return `${dd}/${MONTH_NAMES[idx]}/${y}`;
    return `${dd}/${mon[0].toUpperCase()}${mon.slice(1, 3).toLowerCase()}/${y}`;
  });
}

// Extract name + dates from a LOA embed
function parseLoaEmbed(embed) {
  const title = embed.author?.name || '';
  if (!/Leave of Absence/i.test(title)) return null;

  // Dates anywhere in the title — handles 3-letter, full-name, and numeric months
  const dateMatches = [...title.matchAll(/\[?(\d{1,2}\/(?:[A-Za-z]+|\d{1,2})\/\d{4})\]?/gi)];
  if (dateMatches.length < 2) return { error: 'no_dates' };

  const startDate = normaliseDate(dateMatches[0][1]);
  const endDate   = normaliseDate(dateMatches[1][1]);

  // Prefer footer "Author: Name" for clean name (no rank prefix)
  const footerName = embed.footer?.text?.replace(/^Author:\s*/i, '').trim() || null;

  const govLink = embed.url || embed.author?.url || null;

  return { name: footerName, startDate, endDate, title, govLink };
}

function findEmployee(db, name) {
  if (!name) return null;
  const exact = db.prepare('SELECT name FROM employees WHERE LOWER(name) = LOWER(?)').get(name);
  if (exact) return exact.name;
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  const all   = db.prepare('SELECT name FROM employees').all();
  for (const emp of all) {
    if (words.every(w => emp.name.toLowerCase().includes(w))) return emp.name;
  }
  return null;
}

async function processMessage(msg, db) {
  const embed = msg.embeds?.[0];
  if (!embed) return;

  const parsed = parseLoaEmbed(embed);
  if (!parsed) return;

  if (parsed.error === 'no_dates') {
    await msg.react('❓').catch(() => {});
    await msg.channel.send(
      `<@&${SUPERVISOR_ROLE}> LOA failed to record due to improper formatting in title. Please review and manually add.`
    ).catch(() => {});
    console.log(`[LOA Bot] Bad formatting on message ${msg.id} — alerted supervisors.`);
    return;
  }

  const { name, startDate, endDate, govLink } = parsed;
  const empName = findEmployee(db, name);

  if (!empName) {
    await msg.react('❓').catch(() => {});
    console.log(`[LOA Bot] Not found: "${name}"`);
    return;
  }

  db.prepare('UPDATE employees SET is_on_loa = 1, loa_start = ?, loa_end = ? WHERE name = ?')
    .run(startDate, endDate, empName);
  db.prepare('UPDATE supervisors SET is_on_loa = 1, loa_start = ?, loa_end = ? WHERE name = ?')
    .run(startDate, endDate, empName);

  // Log for audit history so profile LOA markers work
  const alreadyLogged = db.prepare(
    "SELECT id FROM audit_log WHERE action=? AND details=? LIMIT 1"
  ).get(`LOA — ${empName}`, `LOA set ${startDate}–${endDate}`);
  if (!alreadyLogged) {
    const ts = new Date().toLocaleString('en-US');
    db.prepare(
      'INSERT INTO audit_log (timestamp, username, user_id, action, details) VALUES (?,?,?,?,?)'
    ).run(ts, 'LOA Bot', null, `LOA — ${empName}`, `LOA set ${startDate}–${endDate}`);
  }

  fetch(REVALIDATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: REVALIDATE_SECRET }),
  }).catch(() => {});

  // Create Operations task if one isn't already open for this employee
  const taskName = `LOA — ${empName}`;
  const existingTask = db.prepare(
    "SELECT id FROM sup_tasks WHERE task_name = ? AND status != 'Completed' LIMIT 1"
  ).get(taskName);
  if (!existingTask) {
    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2,'0')}/${MONTH_NAMES[now.getMonth()]}/${now.getFullYear()}`;
    const dueD = new Date(now); dueD.setDate(dueD.getDate() + 5);
    const dueDateStr = `${String(dueD.getDate()).padStart(2,'0')}/${MONTH_NAMES[dueD.getMonth()]}/${dueD.getFullYear()}`;
    const noteLink = govLink || `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.id}`;
    const taskNotes = `On LOA from ${startDate} to ${endDate}\n${noteLink}`;
    db.prepare(
      `INSERT INTO sup_tasks (task_name, owner, status, assigned_date, due_date, notes, is_historical)
       VALUES (?, '', 'Assigned', ?, ?, ?, 0)`
    ).run(taskName, todayStr, dueDateStr, taskNotes);
    console.log(`[LOA Bot] Task created: ${taskName} (due ${dueDateStr})`);
    fetch(`https://discord.com/api/v10/channels/${NOTIFY_CHANNEL}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `<@&${SUPERVISOR_ROLE}> **New Task Added**\n**Task:** ${taskName}\n**Assigned To:** TBD\n**Due:** ${dueDateStr}\nhttps://ecrplsems.com/tasks` }),
    }).catch(() => {});
  }

  await msg.react('✅').catch(() => {});
  console.log(`[LOA Bot] Set LOA: ${empName} ${startDate} → ${endDate}`);
}

async function processResignation(msg, db) {
  const embed = msg.embeds?.[0];
  if (!embed) return;
  if (!/Resignation\s*[-|]/i.test(embed.author?.name || '')) return;

  const name = embed.footer?.text?.replace(/^Author:\s*/i, '').trim() || null;
  if (!name) {
    await msg.react('❓').catch(() => {});
    await msg.channel.send(
      `<@&${SUPERVISOR_ROLE}> Resignation failed to record — no author name found in embed. Please review manually.`
    ).catch(() => {});
    console.log(`[Resign Bot] Missing name on message ${msg.id} — alerted supervisors.`);
    return;
  }

  const govLink = embed.url || embed.author?.url || null;
  const taskName = `Resignation — ${name}`;

  const existing = db.prepare(
    "SELECT id FROM sup_tasks WHERE task_name = ? AND status != 'Completed' LIMIT 1"
  ).get(taskName);

  if (existing) {
    await msg.react('✅').catch(() => {});
    console.log(`[Resign Bot] Task already exists for ${name}, skipping.`);
    return;
  }

  const now = new Date();
  const todayStr = `${String(now.getDate()).padStart(2,'0')}/${MONTH_NAMES[now.getMonth()]}/${now.getFullYear()}`;
  const dueD = new Date(now); dueD.setDate(dueD.getDate() + 5);
  const dueDateStr = `${String(dueD.getDate()).padStart(2,'0')}/${MONTH_NAMES[dueD.getMonth()]}/${dueD.getFullYear()}`;

  db.prepare(
    `INSERT INTO sup_tasks (task_name, owner, status, assigned_date, due_date, notes, is_historical)
     VALUES (?, '', 'Assigned', ?, ?, ?, 0)`
  ).run(taskName, todayStr, dueDateStr, govLink || '');

  fetch(`https://discord.com/api/v10/channels/${NOTIFY_CHANNEL}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `<@&${SUPERVISOR_ROLE}> **New Task Added**\n**Task:** ${taskName}\n**Assigned To:** TBD\n**Due:** ${dueDateStr}\nhttps://ecrplsems.com/tasks` }),
  }).catch(() => {});

  await msg.react('✅').catch(() => {});
  console.log(`[Resign Bot] Task created: ${taskName} (due ${dueDateStr})`);
}

async function processRibbonRequest(msg, db) {
  const embed = msg.embeds?.[0];
  if (!embed) return;
  const authorName = embed.author?.name || '';
  if (!/\[Ribbon Request\]/i.test(authorName)) return;

  const nameMatch = authorName.match(/\[Ribbon Request\]\s*(.+)/i);
  const name = nameMatch ? nameMatch[1].trim() : (embed.footer?.text?.replace(/^Author:\s*/i, '').trim() || null);

  if (!name) {
    await msg.react('❓').catch(() => {});
    await msg.channel.send(
      `<@&${SENIOR_PARA_ROLE}> <@&${LEAD_PARA_ROLE}> Ribbon request failed to record — could not extract a name. Please review manually.`
    ).catch(() => {});
    console.log(`[Ribbon Bot] Missing name on message ${msg.id} — alerted roles.`);
    return;
  }

  const govLink = embed.url || embed.author?.url || null;
  const taskName = `Ribbon Request — ${name}`;

  const existing = db.prepare(
    "SELECT id FROM sup_tasks WHERE task_name = ? AND status != 'Completed' LIMIT 1"
  ).get(taskName);

  if (existing) {
    await msg.react('✅').catch(() => {});
    console.log(`[Ribbon Bot] Task already exists for ${name}, skipping.`);
    return;
  }

  const now = new Date();
  const todayStr = `${String(now.getDate()).padStart(2,'0')}/${MONTH_NAMES[now.getMonth()]}/${now.getFullYear()}`;
  const dueD = new Date(now); dueD.setDate(dueD.getDate() + 5);
  const dueDateStr = `${String(dueD.getDate()).padStart(2,'0')}/${MONTH_NAMES[dueD.getMonth()]}/${dueD.getFullYear()}`;

  db.prepare(
    `INSERT INTO sup_tasks (task_name, owner, status, assigned_date, due_date, notes, is_historical)
     VALUES (?, '', 'Assigned', ?, ?, ?, 0)`
  ).run(taskName, todayStr, dueDateStr, govLink || '');

  fetch(`https://discord.com/api/v10/channels/${NOTIFY_CHANNEL}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `<@&${SENIOR_PARA_ROLE}> <@&${LEAD_PARA_ROLE}> **New Task Added**\n**Task:** ${taskName}\n**Assigned To:** TBD\n**Due:** ${dueDateStr}\nhttps://ecrplsems.com/tasks` }),
  }).catch(() => {});

  await msg.react('✅').catch(() => {});
  console.log(`[Ribbon Bot] Task created: ${taskName} (due ${dueDateStr})`);
}

function clearExpiredLOAs() {
  const db = new Database(DB_PATH);
  try {
    const MONTH_LOOKUP = (() => {
      const full = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const map = {};
      full.forEach((m, i) => { map[m] = i; map[m.slice(0,3)] = i; });
      return map;
    })();
    function parse(s) {
      if (!s) return null;
      const t = s.trim();
      const mAlpha = t.match(/^(\d{1,2})[\/\-\.\s]([A-Za-z]+)[\/\-\.\s](\d{4})$/);
      if (mAlpha) {
        const idx = MONTH_LOOKUP[mAlpha[2].toLowerCase()];
        if (idx !== undefined) return new Date(+mAlpha[3], idx, +mAlpha[1]);
      }
      const mISO = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (mISO) return new Date(+mISO[1], +mISO[2] - 1, +mISO[3]);
      const mNum = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
      if (mNum) return new Date(+mNum[3], +mNum[2] - 1, +mNum[1]);
      const d = new Date(t);
      return isNaN(d.getTime()) ? null : d;
    }
    const now = new Date(); now.setHours(0,0,0,0);
    const rows = db.prepare('SELECT name, loa_end FROM employees WHERE is_on_loa = 1').all();
    let count = 0;
    db.transaction(() => {
      for (const r of rows) {
        const end = parse(r.loa_end);
        if (end && end < now) {
          db.prepare('UPDATE employees SET is_on_loa = 0 WHERE name = ?').run(r.name);
          db.prepare('UPDATE supervisors SET is_on_loa = 0 WHERE name = ?').run(r.name);
          const todayStr = `${String(now.getDate()).padStart(2,'0')}/${MONTH_NAMES[now.getMonth()]}/${now.getFullYear()}`;
          db.prepare(
            "UPDATE sup_tasks SET status='Completed', completed_date=? WHERE task_name=? AND status != 'Completed'"
          ).run(todayStr, `LOA — ${r.name}`);
          count++;
        }
      }
    })();
    if (count > 0) {
      console.log(`[LOA Bot] Cleared ${count} expired LOA(s)`);
      fetch(REVALIDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: REVALIDATE_SECRET }),
      }).catch(() => {});
    }
  } finally { db.close(); }
}

const BOT_START_TIME = Date.now();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

async function pollChannel(client, limit = 20) {
  try {
    const db = new Database(DB_PATH);
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) return;
    const msgs = await channel.messages.fetch({ limit });
    const botId = client.user.id;
    const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const msg of sorted) {
      for (const emoji of ['✅', '❓']) {
        const r = msg.reactions.cache.get(emoji);
        if (r) {
          const users = await r.users.fetch().catch(() => null);
          if (users?.has(botId)) { msg._botHandled = true; break; }
        }
      }
      if (msg._botHandled) continue;
      try { await processMessage(msg, db); }
      catch (e) { console.error('[LOA Poll] Error on message:', e.message); }
    }
    db.close();
  } catch (e) {
    console.error('[LOA Poll] Error:', e.message);
  }
}

async function sendDailyDigest() {
  try {
    const db = new Database(DB_PATH);

    // Open tasks
    const tasks = db.prepare(
      "SELECT task_name, owner, due_date FROM sup_tasks WHERE status != 'Completed' AND is_historical = 0 ORDER BY id ASC"
    ).all();

    // Open discussions with non-responders
    const discussions = db.prepare(
      "SELECT d.id, d.topic, d.link FROM sup_discussions d ORDER BY d.id DESC LIMIT 20"
    ).all();
    const responses = db.prepare(
      "SELECT discussion_id, supervisor_name, responded FROM sup_discussion_responses"
    ).all();
    db.close();

    const lines = [`<@&${SUPERVISOR_ROLE}> **Daily LSEMS Digest**\nhttps://ecrplsems.com\n`];

    // Tasks section
    if (tasks.length === 0) {
      lines.push('**Open Tasks:** None');
    } else {
      lines.push(`**Open Tasks (${tasks.length})**`);
      for (const t of tasks) {
        const assignee = t.owner || 'No assignee yet';
        const due = t.due_date ? ` *(due ${t.due_date})*` : '';
        lines.push(`• ${t.task_name} — **${assignee}**${due}`);
      }
    }

    lines.push('');

    // Discussions section — only those with pending responses
    const pendingDiscs = discussions.map(d => {
      const discResponses = responses.filter(r => r.discussion_id === d.id);
      const pending = discResponses.filter(r => !r.responded).map(r => r.supervisor_name);
      return { ...d, pending };
    }).filter(d => d.pending.length > 0);

    if (pendingDiscs.length === 0) {
      lines.push('**Discussions:** All responses received');
    } else {
      lines.push(`**Discussions Awaiting Response**`);
      for (const d of pendingDiscs) {
        lines.push(`• **${d.topic}** — Pending: ${d.pending.join(', ')}`);
      }
    }

    const content = lines.join('\n');
    await fetch(`https://discord.com/api/v10/channels/${NOTIFY_CHANNEL}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      // Task names/topics are user-entered — only the Supervisor role may be pinged
      body: JSON.stringify({ content, allowed_mentions: { parse: [], roles: [SUPERVISOR_ROLE] } }),
    });
    console.log('[LOA Bot] Daily digest sent.');
  } catch (e) {
    console.error('[LOA Bot] Daily digest error:', e.message);
  }
}

function scheduleDailyDigest() {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(10, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next - now;
  console.log(`[LOA Bot] Daily digest scheduled in ${Math.round(delay / 60000)} minutes.`);
  setTimeout(() => {
    sendDailyDigest();
    setInterval(sendDailyDigest, 24 * 60 * 60 * 1000);
  }, delay);
}

async function pollResignChannel(client, limit = 20) {
  try {
    const db = new Database(DB_PATH);
    const channel = await client.channels.fetch(RESIGN_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    const msgs = await channel.messages.fetch({ limit });
    const botId = client.user.id;
    const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const msg of sorted) {
      if (msg.createdTimestamp < BOT_START_TIME) continue;
      for (const emoji of ['✅', '❓']) {
        const r = msg.reactions.cache.get(emoji);
        if (r) {
          const users = await r.users.fetch().catch(() => null);
          if (users?.has(botId)) { msg._botHandled = true; break; }
        }
      }
      if (msg._botHandled) continue;
      try { await processResignation(msg, db); }
      catch (e) { console.error('[Resign Poll] Error on message:', e.message); }
    }
    db.close();
  } catch (e) {
    console.error('[Resign Poll] Error:', e.message);
  }
}

async function pollRibbonChannel(client, limit = 20) {
  try {
    const db = new Database(DB_PATH);
    const channel = await client.channels.fetch(RIBBON_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    const msgs = await channel.messages.fetch({ limit });
    const botId = client.user.id;
    const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const msg of sorted) {
      if (msg.createdTimestamp < BOT_START_TIME) continue;
      for (const emoji of ['✅', '❓']) {
        const r = msg.reactions.cache.get(emoji);
        if (r) {
          const users = await r.users.fetch().catch(() => null);
          if (users?.has(botId)) { msg._botHandled = true; break; }
        }
      }
      if (msg._botHandled) continue;
      try { await processRibbonRequest(msg, db); }
      catch (e) { console.error('[Ribbon Poll] Error on message:', e.message); }
    }
    db.close();
  } catch (e) {
    console.error('[Ribbon Poll] Error:', e.message);
  }
}

// ── Calendar reminders ──────────────────────────────────────────
// Supervisor events get a reminder 24h and 1h before they start. Wording comes
// from the Admin page (app_settings.calendar_reminders); these are the fallbacks
// and should match SETTING_DEFAULTS in src/app/actions.js.
const REMINDER_DEFAULTS = {
  day:  '{role} **Reminder — {title}**\nStarts {start_full}, which is {start_relative}.\n{link}',
  hour: '{role} **Starting soon — {title}**\nStarts {start_full}, which is {start_relative}.\n{link}',
};
const DAY = 24 * 60 * 60, HOUR = 60 * 60;

function fillReminder(tpl, ev) {
  return tpl
    .replaceAll('{title}',          ev.title)
    .replaceAll('{link}',           ev.link || '')
    .replaceAll('{start_full}',     `<t:${ev.start_ts}:F>`)
    .replaceAll('{start_relative}', `<t:${ev.start_ts}:R>`)
    .replaceAll('{end_full}',       ev.end_ts ? `<t:${ev.end_ts}:F>` : '')   // end time is optional
    .replaceAll('{end_relative}',   ev.end_ts ? `<t:${ev.end_ts}:R>` : '')
    .replaceAll('{role}',           `<@&${SUPERVISOR_ROLE}>`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendCalendarReminders() {
  let db;
  try {
    db = new Database(DB_PATH);
    db.pragma('busy_timeout = 5000');
    db.exec(`CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, link TEXT,
      start_ts INTEGER NOT NULL, end_ts INTEGER, for_supervisors INTEGER NOT NULL DEFAULT 0,
      created_by TEXT, created_at INTEGER NOT NULL, timing_set_at INTEGER NOT NULL,
      reminded_24h_at INTEGER, reminded_1h_at INTEGER)`);

    const now = Math.floor(Date.now() / 1000);
    const due = db.prepare(
      'SELECT * FROM calendar_events WHERE for_supervisors = 1 AND reminded_1h_at IS NULL AND start_ts > ? AND start_ts <= ?'
    ).all(now, now + DAY);
    if (!due.length) return;

    let templates = REMINDER_DEFAULTS;
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'calendar_reminders'").get();
    if (row) { try { templates = { ...REMINDER_DEFAULTS, ...JSON.parse(row.value) }; } catch {} }

    for (const ev of due) {
      let kind;
      if (now >= ev.start_ts - HOUR) kind = 'hour';
      // 24h reminder only if the event was on the calendar before the 24h mark;
      // short-notice events just get the 1h one
      else if (ev.reminded_24h_at == null && ev.timing_set_at <= ev.start_ts - DAY) kind = 'day';
      else continue;

      // Claim the reminder first so an overlapping run can't double-send
      const claim = kind === 'hour'
        ? db.prepare('UPDATE calendar_events SET reminded_1h_at = ?, reminded_24h_at = COALESCE(reminded_24h_at, ?) WHERE id = ? AND reminded_1h_at IS NULL AND start_ts = ?').run(now, now, ev.id, ev.start_ts)
        : db.prepare('UPDATE calendar_events SET reminded_24h_at = ? WHERE id = ? AND reminded_24h_at IS NULL AND start_ts = ?').run(now, ev.id, ev.start_ts);
      if (!claim.changes) continue;

      const content = fillReminder(templates[kind] || REMINDER_DEFAULTS[kind], ev).slice(0, 2000);
      const res = await fetch(`https://discord.com/api/v10/channels/${NOTIFY_CHANNEL}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
        // Only the Supervisor role may be pinged — never @everyone from an event title
        body: JSON.stringify({ content, allowed_mentions: { parse: [], roles: [SUPERVISOR_ROLE] } }),
      }).catch(e => ({ ok: false, status: e.message }));

      if (res.ok) {
        console.log(`[Calendar] Sent ${kind === 'day' ? '24h' : '1h'} reminder for "${ev.title}" (#${ev.id}).`);
      } else {
        // Release the claim so the next run retries
        if (kind === 'hour') db.prepare('UPDATE calendar_events SET reminded_1h_at = NULL, reminded_24h_at = ? WHERE id = ?').run(ev.reminded_24h_at, ev.id);
        else                 db.prepare('UPDATE calendar_events SET reminded_24h_at = NULL WHERE id = ?').run(ev.id);
        console.error(`[Calendar] Failed to send reminder for "${ev.title}" (#${ev.id}): ${res.status}`);
      }
    }
  } catch (e) {
    console.error('[Calendar] Reminder error:', e.message);
  } finally { db?.close(); }
}

client.once(Events.ClientReady, async c => {
  console.log(`[LOA Bot] Ready as ${c.user.tag}`);
  clearExpiredLOAs();
  setInterval(clearExpiredLOAs, 6 * 60 * 60 * 1000);
  scheduleDailyDigest();
  sendCalendarReminders();
  setInterval(sendCalendarReminders, 60 * 1000);
  console.log('[LOA Bot] Running startup catchup scan (last 100 messages)...');
  await pollChannel(c, 100);
  console.log('[LOA Bot] Startup scan complete. Polling every 2 minutes.');
  setInterval(() => pollChannel(c, 20), 2 * 60 * 1000);
  setInterval(() => pollResignChannel(c, 20), 2 * 60 * 1000);
  setInterval(() => pollRibbonChannel(c, 20), 2 * 60 * 1000);
});

client.on(Events.MessageCreate, async msg => {
  if (msg.author.id === client.user?.id) return;
  const db = new Database(DB_PATH);
  try {
    if (msg.channelId === CHANNEL_ID) await processMessage(msg, db);
    else if (msg.channelId === RESIGN_CHANNEL_ID) await processResignation(msg, db);
    else if (msg.channelId === RIBBON_CHANNEL_ID) await processRibbonRequest(msg, db);
  } catch (e) {
    console.error('[Bot] Error:', e.message);
    await msg.react('❌').catch(() => {});
  } finally { db.close(); }
});

client.login(BOT_TOKEN).catch(e => {
  console.error('[LOA Bot] Login failed:', e.message);
  process.exit(1);
});
