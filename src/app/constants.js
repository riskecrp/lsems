// Shared constants — no "use server" so client components can import these too

export const RANK_ORDER = [
  'Chief', 'Assistant Chief', 'Deputy Chief', 'Commander', 'Captain',
  'Lieutenant', 'Consultant', 'Lead Paramedic', 'Senior Paramedic', 'Paramedic',
  'Junior Paramedic', 'EMT-P', 'Master EMT', 'EMT-A', 'EMT-I', 'EMT-B', 'EMR',
];

export const HOURLY_RATES = {
  'Chief':           8000,
  'Assistant Chief': 8000,
  'Deputy Chief':    8000,
  'Commander':       7900,
  'Captain':         7800,
  'Lieutenant':      7700,
  'Lead Paramedic':  7550,
  'Senior Paramedic':7300,
  'Paramedic':       7150,
  'Junior Paramedic':7000,
  'Consultant':      7000,
  'EMT-P':           6900,
  'Master EMT':      6900,
  'EMT-A':           6800,
  'EMT-I':           6650,
  'EMT-B':           6500,
  'EMR':             6000,
};

// Retention bonus amounts in order — cycle repeats after the last entry
export const BONUS_CYCLE = [
  { months: 3,  amount: 50000  },
  { months: 6,  amount: 75000  },
  { months: 9,  amount: 100000 },
  { months: 12, amount: 200000 },
];

export const SHEET_NAMES = {
  EMPLOYEES:     'Employees',
  PAST_EMPLOYEES:'Past Employees',
  BONUSES:       'Retention Bonuses',
  RANK_HISTORY:  'Rank History',
  TREASURY:      'Treasury',
  PAYMENT_INPUT: 'Payment Input',
};

export function getRankIndex(rank) {
  const i = RANK_ORDER.indexOf(rank);
  return i === -1 ? 999 : i;
}

export function sortByRank(arr) {
  return [...arr].sort((a, b) => {
    const aConsult = a.rank === 'Consultant' ? 1 : 0;
    const bConsult = b.rank === 'Consultant' ? 1 : 0;
    if (aConsult !== bConsult) return aConsult - bConsult;
    const diff = getRankIndex(a.rank) - getRankIndex(b.rank);
    if (diff !== 0) return diff;
    return (a.name || '').localeCompare(b.name || '');
  });
}

export function daysInRank(hireDate, lastPromotion) {
  const ref = lastPromotion ? new Date(lastPromotion) : new Date(hireDate);
  if (isNaN(ref.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - ref.getTime()) / 86400000));
}

export function daysEmployed(hireDate) {
  const ref = new Date(hireDate);
  if (isNaN(ref.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - ref.getTime()) / 86400000));
}

// Parses DD/Mon/YYYY (any case, any month-name length) and DD/MM/YYYY.
// Month names are matched case-insensitively — the roster contains both
// "16/Jul/2026" and "16/JUL/2026", and an unrecognised month used to fall
// back to January, silently dating people ~6 months early.
const _MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
export function _parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const mAlpha = str.match(/^(\d{1,2})[\/\-.\s]([A-Za-z]+)[\/\-.\s](\d{4})$/);
  if (mAlpha) {
    const idx = _MON[mAlpha[2].slice(0, 3).toLowerCase()];
    // Unknown month name → fall through rather than defaulting to January.
    if (idx !== undefined) return new Date(+mAlpha[3], idx, +mAlpha[1]);
  }
  const mISO = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mISO) return new Date(+mISO[1], +mISO[2] - 1, +mISO[3]);
  // Numeric: day first, matching parseFlexDate on the server.
  const mNum = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (mNum) return new Date(+mNum[3], +mNum[2] - 1, +mNum[1]);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// The canonical stored date shape, e.g. "05/Aug/2026".
const _MON_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function toStoredDate(d = new Date()) {
  return `${String(d.getDate()).padStart(2,'0')}/${_MON_NAMES[d.getMonth()]}/${d.getFullYear()}`;
}

// Most recent bonus payment per employee.
// Dates MUST be compared as dates: "05/Aug/2026" sorts before "20/Jul/2026"
// as text, which used to pick the wrong "last payment" and therefore the
// wrong next amount and due date.
// Same as buildLastPaymentMap, but active retention-bonus resolutions also
// settle the schedule up to their milestone's due date (no money involved).
export function buildSettledMap(payments = [], resolutions = []) {
  const extra = resolutions
    .filter(r => !r.undone_at)
    .map(r => ({ employee_name: r.employee_name, paid_date: r.due_date, amount: 0, months_tenure: r.months_tenure, resolution: true }));
  return buildLastPaymentMap([...payments, ...extra]);
}

export function buildLastPaymentMap(payments = []) {
  const map = {};
  for (const p of payments) {
    const d = _parseDate(p.paid_date);
    if (!d) continue;
    const cur = map[p.employee_name];
    if (!cur || d > cur._date) map[p.employee_name] = { ...p, _date: d };
  }
  return map;
}

function _addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function _minusDays(date, n) {
  return new Date(date.getTime() - n * 86400000);
}

// A payment this many days before a milestone's due date still settles it.
// Comfortably wider than payroll's 7-day lead, and nowhere near the ~91 days
// back to the previous milestone, so it can never swallow the wrong one.
export const SETTLE_GRACE_DAYS = 14;

// Retention bonuses — the schedule is a pure function of the hire date.
//
//   Milestone N falls on hireDate + 3N months (N = 1, 2, 3, …), forever.
//   Amount for milestone N = cycle[(N - 1) mod cycle.length]
//     → 3mo $50k · 6mo $75k · 9mo $100k · 12mo $200k · 15mo $50k · …
//
// Because the schedule is anchored to the hire date and never to when a
// payment actually happened, paying early or late cannot shift anyone's
// future dates — lateness does not compound.
//
// lastPayment only answers one question: has the milestone that is currently
// due already been settled? A payment dated on or after that milestone's due
// date settles it. Milestones older than that are NOT chased — the history
// predates this system and is deliberately left alone.
//
// `anchor` re-bases the clock for one employee: { date, step } means "as at
// `date`, `step` milestones were complete, count from there". It exists only
// for the 2026-08 cohort whose schedule was restarted from their last actual
// payment. Everyone else — and every future hire or re-hire — passes null and
// gets the plain hire-date math. Separation resets the clock: a re-hire is a
// fresh row with no anchor and a new hire date.
//
// Returns { milestone, monthsTenure, nextAmount, nextDate, daysUntil, lastAmount, lastDate, anchored }
export function getNextBonus(hireDate, lastPayment = null, cycle = null, anchor = null) {
  const useCycle = (cycle && cycle.length > 0) ? cycle : BONUS_CYCLE;
  const amounts  = useCycle.map(s => s.amount);

  const anchorDate = anchor?.date ? _parseDate(anchor.date) : null;
  const start      = anchorDate || _parseDate(hireDate);
  if (!start) return null;
  const baseStep   = anchorDate ? (Number(anchor.step) || 0) : 0;

  const now = new Date(); now.setHours(0, 0, 0, 0);

  // Complete 3-month periods elapsed since the start point (0 = none yet).
  let elapsed = 0;
  while (_addMonths(start, 3 * (elapsed + 1)) <= now) elapsed++;

  // How many periods has the last payment settled? Payroll offers a bonus up
  // to 7 days before its due date, so a payment landing shortly BEFORE the
  // date still settles it — otherwise paying on the pay run that precedes the
  // due date would leave the milestone open and offer it again on the next run.
  // Walk forward rather than testing one period, so an early payment for a
  // not-yet-due milestone still advances the schedule.
  const lastDate = lastPayment ? _parseDate(lastPayment.paid_date) : null;
  let settledPeriods = 0;
  if (lastDate) {
    for (let k = 1; k <= elapsed + 2; k++) {
      if (lastDate >= _minusDays(_addMonths(start, 3 * k), SETTLE_GRACE_DAYS)) settledPeriods = k;
      else break;
    }
  }

  // Next unsettled period; with nothing settled it is the one currently in play.
  const periods    = settledPeriods > 0 ? settledPeriods + 1 : Math.max(1, elapsed);
  const milestone  = baseStep + periods;
  const nextDate   = _addMonths(start, 3 * periods);
  const nextAmount = amounts[(milestone - 1) % amounts.length];

  return {
    milestone,
    monthsTenure: milestone * 3,
    nextAmount,
    nextDate,
    daysUntil:  Math.ceil((nextDate - now) / 86400000),
    lastAmount: lastPayment ? parseFloat(lastPayment.amount) : null,
    lastDate,
    anchored: !!anchorDate,
  };
}

export function fmtDate(val) {
  if (!val) return '';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtCurrency(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
