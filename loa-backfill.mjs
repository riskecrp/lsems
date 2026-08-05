/**
 * LOA Backfill — processes all LOA messages in the channel from Jan 2026
 * onwards that the bot hasn't already marked with ✅.
 *
 * Run once: node loa-backfill.mjs
 */
import { Client, GatewayIntentBits } from 'discord.js';
import Database from 'better-sqlite3';

process.loadEnvFile('/opt/lsems/.env');

const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = '1369579949878411344';
const DB_PATH    = '/opt/lsems/data/lsems.db';

// Snowflake for 2026-01-01 00:00:00 UTC
const DISCORD_EPOCH   = 1420070400000n;
const JAN_2026_TS     = BigInt(new Date('2026-01-01T00:00:00.000Z').getTime());
const AFTER_SNOWFLAKE = ((JAN_2026_TS - DISCORD_EPOCH) << 22n).toString();

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_IDX = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const MONTH_LOOKUP = {};
['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']
  .forEach((m,i) => MONTH_LOOKUP[m] = i);
MONTH_NAMES.forEach((m,i) => MONTH_LOOKUP[m.toUpperCase()] = i);

function normaliseDate(s) {
  return s.replace(/(\d{1,2})\/([A-Za-z]+|\d{1,2})\/(\d{4})/g, (_, d, mon, y) => {
    const dd = d.padStart(2, '0');
    if (/^\d+$/.test(mon)) return `${dd}/${MONTH_NAMES[parseInt(mon) - 1]}/${y}`;
    const idx = MONTH_LOOKUP[mon.toUpperCase().slice(0, 9)];
    if (idx !== undefined) return `${dd}/${MONTH_NAMES[idx]}/${y}`;
    return `${dd}/${mon[0].toUpperCase()}${mon.slice(1, 3).toLowerCase()}/${y}`;
  });
}

function parseFlexDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  return m ? new Date(+m[3], MONTH_IDX[m[2]] ?? 0, +m[1]) : null;
}

function isStillActive(endDate) {
  if (!endDate) return true;
  const end = parseFlexDate(endDate);
  if (!end) return true;
  const now = new Date(); now.setHours(0,0,0,0);
  return end >= now;
}

function parseLoaEmbed(embed) {
  const title = embed.author?.name || '';
  if (!/Leave of Absence/i.test(title)) return null;
  const dateMatches = [...title.matchAll(/\[?(\d{1,2}\/(?:[A-Za-z]+|\d{1,2})\/\d{4})\]?/gi)];
  if (dateMatches.length < 2) return null;
  const startDate  = normaliseDate(dateMatches[0][1]);
  const endDate    = normaliseDate(dateMatches[1][1]);
  const footerName = embed.footer?.text?.replace(/^Author:\s*/i, '').trim() || null;
  return { name: footerName, startDate, endDate };
}

function findEmployee(db, name) {
  if (!name) return null;
  const exact = db.prepare('SELECT name FROM employees WHERE LOWER(name) = LOWER(?)').get(name);
  if (exact) return exact.name;
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  for (const emp of db.prepare('SELECT name FROM employees').all()) {
    if (words.every(w => emp.name.toLowerCase().includes(w))) return emp.name;
  }
  return null;
}

async function run() {
  const db = new Database(DB_PATH);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.login(BOT_TOKEN).catch(reject);
  });

  console.log(`[Backfill] Ready as ${client.user.tag}`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) { console.error('[Backfill] Channel not found'); process.exit(1); }

  const botId = client.user.id;
  let after = AFTER_SNOWFLAKE;
  const allMessages = [];

  console.log('[Backfill] Fetching messages since Jan 2026…');
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, after });
    if (batch.size === 0) break;
    const sorted = [...batch.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    allMessages.push(...sorted);
    after = sorted[sorted.length - 1].id;
    process.stdout.write(`\r  Fetched ${allMessages.length} messages…`);
    if (batch.size < 100) break;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`\n[Backfill] ${allMessages.length} messages to examine.\n`);

  let processed = 0, skipped = 0, notFound = 0;

  for (const msg of allMessages) {
    // Skip if bot already reacted ✅
    const ckReaction = msg.reactions.cache.get('✅');
    if (ckReaction) {
      const users = await ckReaction.users.fetch().catch(() => null);
      if (users?.has(botId)) { skipped++; continue; }
    }

    const embed = msg.embeds?.[0];
    if (!embed) { skipped++; continue; }

    const parsed = parseLoaEmbed(embed);
    if (!parsed) { skipped++; continue; }

    const { name, startDate, endDate } = parsed;
    const empName = findEmployee(db, name);

    if (!empName) {
      console.log(`  ❓ Not found: "${name}"`);
      await msg.react('❓').catch(() => {});
      notFound++;
      continue;
    }

    // Apply to employees table only if the LOA is still active
    if (isStillActive(endDate)) {
      db.prepare('UPDATE employees SET is_on_loa=1, loa_start=?, loa_end=? WHERE name=?')
        .run(startDate, endDate, empName);
      db.prepare('UPDATE supervisors SET is_on_loa=1, loa_start=?, loa_end=? WHERE name=?')
        .run(startDate, endDate, empName);
    }

    // Log to audit_log for history (skip if identical entry already exists)
    const alreadyLogged = db.prepare(
      "SELECT id FROM audit_log WHERE action=? AND details=? LIMIT 1"
    ).get(`LOA — ${empName}`, `LOA set ${startDate}–${endDate}`);

    if (!alreadyLogged) {
      const ts = new Date(Number((BigInt(msg.id) >> 22n) + DISCORD_EPOCH)).toLocaleString('en-US');
      db.prepare(
        'INSERT INTO audit_log (timestamp, username, user_id, action, details) VALUES (?,?,?,?,?)'
      ).run(ts, 'LOA Bot (backfill)', null, `LOA — ${empName}`, `LOA set ${startDate}–${endDate}`);
    }

    await msg.react('✅').catch(() => {});
    console.log(`  ✅ ${empName}: ${startDate} → ${endDate}`);
    processed++;

    await new Promise(r => setTimeout(r, 200));
  }

  db.close();
  await client.destroy();

  console.log(`\n[Backfill] Complete.`);
  console.log(`  Applied   : ${processed}`);
  console.log(`  Skipped   : ${skipped}`);
  console.log(`  Not found : ${notFound}`);
}

run().catch(e => { console.error('[Backfill] Fatal:', e.message); process.exit(1); });
