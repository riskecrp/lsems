// Run once to create the database tables:
//   node src/app/lib/init.js
import { readFileSync } from 'fs';
import { getDb } from './db.js';

const schema = readFileSync(new URL('../../../schema.sql', import.meta.url), 'utf8');

const db = getDb();
db.exec(schema);
console.log('LSEMS database initialised at', process.env.DATABASE_PATH || '/opt/lsems/data/lsems.db');
