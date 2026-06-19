import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { handleReminder } from '../src/scheduler/reminder-job.js';
import type { Pusher } from '../src/line/push.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

function fakePusher(throwErr?: unknown) {
  const pushes: { to: string; messages: unknown[] }[] = [];
  const pusher: Pusher = {
    async push(to, messages) {
      if (throwErr) throw throwErr;
      pushes.push({ to, messages });
    },
  };
  return { pushes, pusher };
}

async function setupDose() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const { prescriptionId } = await makePrescriptionService(db).create({
    memberId: member.id,
    startDate: '2026-06-20',
    days: 1,
    meds: [{ name: '高血壓藥', qty: 1, freq: 'QD', timing: '飯後' }],
  });
  const doseId = (
    await db.query('SELECT id FROM dose_event WHERE prescription_id = $1', [prescriptionId])
  ).rows[0].id as string;
  return { db, doseId, memberId: member.id };
}

function status(db: Queryable, id: string) {
  return db.query('SELECT status FROM dose_event WHERE id = $1', [id]).then((r) => r.rows[0].status);
}

describe('handleReminder', () => {
  it('pushes the reminder and marks the dose REMINDED', async () => {
    const { db, doseId } = await setupDose();
    const { pushes, pusher } = fakePusher();

    await handleReminder(doseId, { db, pusher });

    expect(pushes.length).toBe(1);
    expect(pushes[0].to).toBe('U1');
    expect(await status(db, doseId)).toBe('REMINDED');
  });

  it('does nothing for a dose that is not SCHEDULED', async () => {
    const { db, doseId } = await setupDose();
    await db.query(`UPDATE dose_event SET status='CONFIRMED' WHERE id=$1`, [doseId]);
    const { pushes, pusher } = fakePusher();

    await handleReminder(doseId, { db, pusher });

    expect(pushes.length).toBe(0);
    expect(await status(db, doseId)).toBe('CONFIRMED');
  });

  it('on 429 rethrows and leaves the dose SCHEDULED (queue will retry)', async () => {
    const { db, doseId } = await setupDose();
    const { pusher } = fakePusher({ statusCode: 429 });

    await expect(handleReminder(doseId, { db, pusher })).rejects.toBeTruthy();
    expect(await status(db, doseId)).toBe('SCHEDULED');
  });

  it('on 403 marks unreachable, does not throw, leaves dose SCHEDULED', async () => {
    const { db, doseId, memberId } = await setupDose();
    const { pusher } = fakePusher({ statusCode: 403 });
    let unreachable: number | string | null = null;

    await handleReminder(doseId, {
      db,
      pusher,
      markUnreachable: async (id) => {
        unreachable = id;
      },
    });

    expect(String(unreachable)).toBe(String(memberId));
    expect(await status(db, doseId)).toBe('SCHEDULED');
  });
});
