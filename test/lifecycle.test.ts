import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { makeLifecycleService } from '../src/prescription/lifecycle.js';
import { makeRefillService } from '../src/stats/refill.js';
import { handleReminder } from '../src/scheduler/reminder-job.js';
import type { Pusher } from '../src/line/push.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function setupRx() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const { prescriptionId } = await makePrescriptionService(db).create({
    memberId: member.id,
    startDate: '2026-06-20',
    days: 1,
    meds: [{ name: 'A', qty: 1, freq: 'QD', timing: '飯後' }],
  });
  return { db, prescriptionId, lifecycle: makeLifecycleService(db) };
}

describe('prescription lifecycle', () => {
  it('endCourse flips status to ended', async () => {
    const { db, prescriptionId, lifecycle } = await setupRx();
    await lifecycle.endCourse(prescriptionId);
    const { rows } = await db.query('SELECT status FROM prescription WHERE id=$1', [prescriptionId]);
    expect(rows[0].status).toBe('ended');
  });

  it('an ended course stops dose reminders (no push, no state change)', async () => {
    const { db, prescriptionId, lifecycle } = await setupRx();
    const doseId = (
      await db.query('SELECT id FROM dose_event WHERE prescription_id=$1', [prescriptionId])
    ).rows[0].id as string;
    await lifecycle.endCourse(prescriptionId);

    const pushes: unknown[] = [];
    const pusher: Pusher = { async push(_to, m) { pushes.push(m); } };
    await handleReminder(doseId, { db, pusher });

    expect(pushes.length).toBe(0);
    const { rows } = await db.query('SELECT status FROM dose_event WHERE id=$1', [doseId]);
    expect(rows[0].status).toBe('SCHEDULED'); // untouched
  });

  it('markRefilled + refill stats: rate = refilled / reminded', async () => {
    const { db, prescriptionId, lifecycle } = await setupRx();
    // simulate the refill nudge having fired, then the patient returns
    await db.query('UPDATE prescription SET refill_reminded_at = now() WHERE id=$1', [prescriptionId]);
    await lifecycle.markRefilled(prescriptionId);

    const stats = await makeRefillService(db).summary();
    expect(stats.reminded).toBe(1);
    expect(stats.refilled).toBe(1);
    expect(stats.rate).toBe(1);
  });

  it('refill stats: no nudges yet -> rate 0, no divide by zero', async () => {
    const { db } = await setupRx();
    const stats = await makeRefillService(db).summary();
    expect(stats).toEqual({ reminded: 0, refilled: 0, rate: 0 });
  });
});
