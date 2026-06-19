import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { runMigrations } from './db.js';

const cfg = loadConfig();
const pool = new Pool({ connectionString: cfg.databaseUrl });
await runMigrations(pool);
await pool.end();
console.log('migrations applied');
