-- LSEMS Dashboard — SQLite Schema
-- Run once to initialise: node src/app/lib/init.js

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Active employees ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  rank           TEXT    NOT NULL,
  hire_date      TEXT    NOT NULL,   -- stored as MM/DD/YYYY
  last_promotion TEXT,               -- stored as MM/DD/YYYY
  created_at     TEXT    DEFAULT (datetime('now'))
);

-- ── Weekly hours per employee ───────────────────────────────────
-- One row per (employee, week). Week ending date stored as entered
-- (e.g. "5/Jan/2025") so it matches exactly what leadership types.
CREATE TABLE IF NOT EXISTS employee_hours (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_name TEXT    NOT NULL COLLATE NOCASE,
  week_ending   TEXT    NOT NULL,
  hours         REAL    NOT NULL DEFAULT 0,
  UNIQUE (employee_name, week_ending)
);

-- ── Separated / past employees (archive) ───────────────────────
CREATE TABLE IF NOT EXISTS past_employees (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL COLLATE NOCASE,
  date_separated TEXT    NOT NULL,
  exit_rank      TEXT    NOT NULL,
  authorizer     TEXT    NOT NULL,
  hire_date      TEXT,
  total_hours    REAL    DEFAULT 0,
  created_at     TEXT    DEFAULT (datetime('now'))
);

-- ── Personnel event log (promotions + separations) ─────────────
CREATE TABLE IF NOT EXISTS rank_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date TEXT    NOT NULL,
  name       TEXT    NOT NULL COLLATE NOCASE,
  old_rank   TEXT,
  new_rank   TEXT    NOT NULL,   -- or 'SEPARATED'
  authorizer TEXT    NOT NULL,
  created_at TEXT    DEFAULT (datetime('now'))
);

-- ── Treasury ledger ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treasury (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT    NOT NULL,
  type       TEXT    NOT NULL,   -- 'Payroll' | 'Balance Adjustment' | 'Deposit' | etc.
  amount     REAL    NOT NULL,
  balance    REAL    NOT NULL,   -- running balance AFTER this transaction
  notes      TEXT,
  created_at TEXT    DEFAULT (datetime('now'))
);

-- ── Supervisors (task system) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS supervisors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  rank       TEXT    NOT NULL,
  is_on_loa  INTEGER NOT NULL DEFAULT 0,
  loa_start  TEXT,
  loa_end    TEXT,
  loa_reason TEXT,
  created_at TEXT    DEFAULT (datetime('now'))
);

-- ── Supervisor tasks ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sup_tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name      TEXT    NOT NULL,
  owner          TEXT    COLLATE NOCASE,
  status         TEXT    NOT NULL DEFAULT 'Assigned',
  assigned_date  TEXT,
  due_date       TEXT,
  completed_date TEXT,
  notes          TEXT,
  is_historical  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    DEFAULT (datetime('now')),
  announced_at   TEXT              -- when Discord was told; NULL = held until start date (00:00 UTC)
);

-- ── Supervisor discussions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS sup_discussions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date_posted TEXT    NOT NULL,
  topic       TEXT    NOT NULL,
  link        TEXT,
  created_at  TEXT    DEFAULT (datetime('now')),
  archived_at TEXT,             -- NULL = active; set when archived
  archived_by TEXT
);

-- ── Discussion responses (one row per supervisor per discussion) ─
CREATE TABLE IF NOT EXISTS sup_discussion_responses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id   INTEGER NOT NULL REFERENCES sup_discussions(id) ON DELETE CASCADE,
  supervisor_name TEXT    NOT NULL COLLATE NOCASE,
  responded       INTEGER NOT NULL DEFAULT 0,   -- 0 pending, 1 responded, 2 no response, 3 excused (LOA)
  UNIQUE (discussion_id, supervisor_name)
);

-- ── Bonus payment records ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS bonus_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_name TEXT    NOT NULL COLLATE NOCASE,
  amount        REAL    NOT NULL,
  months_tenure INTEGER,          -- milestone month (3, 6, 9, 12, 15...)
  paid_date     TEXT    NOT NULL,
  created_at    TEXT    DEFAULT (datetime('now'))
);

-- ── Indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_emp_hours_name  ON employee_hours (employee_name);
CREATE INDEX IF NOT EXISTS idx_emp_hours_week  ON employee_hours (week_ending);
CREATE INDEX IF NOT EXISTS idx_rank_hist_name  ON rank_history   (name);
CREATE INDEX IF NOT EXISTS idx_treasury_ts     ON treasury       (created_at DESC);

-- Calendar events (times are unix seconds, UTC)
CREATE TABLE IF NOT EXISTS calendar_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  link            TEXT,
  start_ts        INTEGER NOT NULL,
  end_ts          INTEGER,            -- optional
  for_supervisors INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      INTEGER NOT NULL,
  timing_set_at   INTEGER NOT NULL,   -- when the start time was last set (decides if the 24h reminder is owed)
  reminded_24h_at INTEGER,            -- set by loa-bot once the reminder is sent
  reminded_1h_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_ts);

-- ── Retention bonus resolutions ─────────────────────────────────
-- Marks an overdue milestone as settled without a new payment: either
-- covered by an existing bonus_payments row, or dismissed with a reason.
-- Never deleted; "undo" sets undone_at so the history is kept.
CREATE TABLE IF NOT EXISTS bonus_resolutions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_name  TEXT    NOT NULL COLLATE NOCASE,
  months_tenure  INTEGER NOT NULL,          -- milestone month (3, 6, 9...)
  amount         REAL,                      -- amount that was due (info only)
  due_date       TEXT    NOT NULL,          -- YYYY-MM-DD; settles the schedule up to here
  type           TEXT    NOT NULL CHECK (type IN ('covered','dismissed')),
  payment_id     INTEGER REFERENCES bonus_payments(id) ON DELETE SET NULL,
  reason         TEXT,
  resolved_by    TEXT,
  resolved_at    TEXT    DEFAULT (datetime('now')),
  undone_by      TEXT,
  undone_at      TEXT
);
