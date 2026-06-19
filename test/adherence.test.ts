import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { makeAdherenceService } from '../src/stats/adherence.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function setup() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const rx = makePrescriptionService(db);
  const { prescriptionId } = await rx.create({
    memberId: member.id,
    startDate: '2026-06-20',
    days: 1,
    meds: [{ name: 'A', qty: 1, freq: 'TID', timing: '飯後' }], // 3 doses
  });
  const ids = (
    await db.query('SELECT id FROM dose_event WHERE prescription_id = $1 ORDER BY scheduled_at', [
      prescriptionId,
    ])
  ).rows.map((r) => r.id as string);
  return { db, memberId: member.id, ids, adherence: makeAdherenceService(db) };
}

describe('adherence stats', () => {
  it('rate = confirmed / (confirmed + missed)', async () => {
    const { db, memberId, ids, adherence } = await setup();
    await db.query(`UPDATE dose_event SET status='CONFIRMED' WHERE id IN ($1, $2)`, [ids[0], ids[1]]);
    await db.query(`UPDATE dose_event SET status='MISSED' WHERE id = $1`, [ids[2]]);

    const stats = await adherence.forMember(memberId);
    expect(stats.confirmed).toBe(2);
    expect(stats.missed).toBe(1);
    expect(stats.rate).toBeCloseTo(2 / 3, 5);
  });

  it('all missed → rate 0', async () => {
    const { db, memberId, ids, adherence } = await setup();
    await db.query(`UPDATE dose_event SET status='MISSED' WHERE id IN ($1, $2, $3)`, [ids[0], ids[1], ids[2]]);

    const stats = await adherence.forMember(memberId);
    expect(stats.rate).toBe(0);
    expect(stats.missed).toBe(3);
  });

  it('no confirmed/missed events → rate 0, no divide by zero', async () => {
    const { adherence } = await setup();
    // member 999 has no dose events at all
    const stats = await adherence.forMember(999);
    expect(stats).toEqual({ confirmed: 0, missed: 0, rate: 0 });
  });
});
