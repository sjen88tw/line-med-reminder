import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Queryable } from './member/member-service.js';

const defaultDir = join(process.cwd(), 'db', 'migrations');

// Runs every .sql file in db/migrations in lexical order. Migrations are
// idempotent (CREATE TABLE IF NOT EXISTS) so re-running is safe for the pilot.
// A real migration ledger comes later; this keeps #01 dependency-free.
export async function runMigrations(
  db: Queryable,
  dir: string = defaultDir,
): Promise<void> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.query(sql);
  }
}
