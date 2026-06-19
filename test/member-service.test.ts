import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

describe('member service', () => {
  it('creates a member on first upsert', async () => {
    const db = makeDb();
    await runMigrations(db, MIGRATIONS);
    const members = makeMemberService(db);

    const m = await members.upsertByLineUserId('U1', '阿明');

    expect(m.line_user_id).toBe('U1');
    expect(m.display_name).toBe('阿明');
  });

  it('is idempotent: duplicate follow does not create a second row, updates name', async () => {
    const db = makeDb();
    await runMigrations(db, MIGRATIONS);
    const members = makeMemberService(db);

    await members.upsertByLineUserId('U1', '阿明');
    await members.upsertByLineUserId('U1', '陳阿明');

    const { rows } = await db.query('SELECT * FROM member WHERE line_user_id = $1', ['U1']);
    expect(rows.length).toBe(1);
    expect(rows[0].display_name).toBe('陳阿明');
  });

  it('stores null display name without error', async () => {
    const db = makeDb();
    await runMigrations(db, MIGRATIONS);
    const members = makeMemberService(db);

    const m = await members.upsertByLineUserId('U2', null);
    expect(m.display_name).toBeNull();
  });
});
