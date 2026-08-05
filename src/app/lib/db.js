import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const DB_PATH = process.env.DATABASE_PATH || '/opt/lsems/data/lsems.db';

let _db = null;

export function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('busy_timeout = 5000');
  }
  return _db;
}

export const query       = (sql, params = []) => getDb().prepare(sql).all(...(Array.isArray(params) ? params : [params]));
export const queryOne    = (sql, params = []) => getDb().prepare(sql).get(...(Array.isArray(params) ? params : [params]));
export const run         = (sql, params = []) => getDb().prepare(sql).run(...(Array.isArray(params) ? params : [params]));
export const transaction = (fn)               => getDb().transaction(fn)();
