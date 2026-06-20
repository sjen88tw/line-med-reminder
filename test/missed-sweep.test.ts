import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { markMissedDoses } from '../src/scheduler/missed-sweep.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function setup() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const { prescriptionId } = await makePrescriptionService(db).create({
    memberId: member.id,
    startDate: '2026-06-20',
    days: 1,
    meds: [{ name: 'A', qty: 1, freq: 'TID', timing: '飯後' }],
  });
  const ids = (
    await db.query('SELECT id FROM dose_event WHERE prescription_id=$1 ORDER BY scheduled_at', [prescriptionId])
  ).rows.map((r) => r.id as string);
  return { db, ids };
}

describe('markMissedDoses', () => {
  it('marks REMINDED/ESCALATED past doses MISSED, leaves CONFIRMED alone', async () => {
    const { db, ids } = await setup();
    await db.query(`UPDATE dose_event SET status='REMINDED' WHERE id=$1`, [ids[0]]);
    await db.query(`UPDATE dose_event SET status='ESCALATED' WHERE id=$1`, [ids[1]]);
    await db.query(`UPDATE dose_event SET status='CONFIRMED' WHERE id=$1`, [ids[2]]);

    const n = await markMissedDoses(db, new Date('2026-07-01T00:00:00Z'));

    expect(n).toBe(2);
    const statuses = (await db.query('SELECT id, status FROM dose_event')).rows;
    const byId = Object.fromEntries(statuses.map((r) => [r.id, r.status]));
    expect(byId[ids[0]]).toBe('MISSED');
    expect(byId[ids[1]]).toBe('MISSED');
    expect(byId[ids[2]]).toBe('CONFIRMED');
  });

  it('does not sweep doses still within the grace window', async () => {
    const { db, ids } = await setup();
    await db.query(`UPDATE dose_event SET status='REMINDED' WHERE id=$1`, [ids[0]]);
    // asOf right at the dose time -> within grace -> not missed
    const n = await markMissedDoses(db, new Date('2026-06-20T01:00:00Z'));
    expect(n).toBe(0);
  });

  it('does not sweep SCHEDULED doses (never delivered)', async () => {
    const { db } = await setup();
    const n = await markMissedDoses(db, new Date('2026-07-01T00:00:00Z'));
    expect(n).toBe(0); // all still SCHEDULED
  });
});
