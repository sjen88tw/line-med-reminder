import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { makeLifecycleService } from '../src/prescription/lifecycle.js';
import { handleRefillReminder } from '../src/scheduler/refill-job.js';
import type { Pusher } from '../src/line/push.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

function harness() {
  const pushes: { to: string }[] = [];
  const notices: string[] = [];
  const pusher: Pusher = { async push(to) { pushes.push({ to }); } };
  const notifyPharmacy = async (t: string) => { notices.push(t); };
  return { pushes, notices, pusher, notifyPharmacy };
}

async function setupRx() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const { prescriptionId } = await makePrescriptionService(db).create({
    memberId: member.id,
    startDate: '2026-06-20',
    days: 7,
    meds: [{ name: '高血壓藥', qty: 1, freq: 'TID', timing: '飯後' }],
  });
  return { db, prescriptionId, lifecycle: makeLifecycleService(db) };
}

describe('handleRefillReminder (E1)', () => {
  it('nudges the patient and puts them on the pharmacy recall list', async () => {
    const { db, prescriptionId } = await setupRx();
    const h = harness();

    await handleRefillReminder(prescriptionId, { db, pusher: h.pusher, notifyPharmacy: h.notifyPharmacy });

    expect(h.pushes.length).toBe(1);
    expect(h.pushes[0].to).toBe('U1');
    expect(h.notices.some((n) => n.includes('待續領召回'))).toBe(true);
    const { rows } = await db.query('SELECT refill_reminded_at FROM prescription WHERE id=$1', [prescriptionId]);
    expect(rows[0].refill_reminded_at).not.toBeNull();
  });

  it('does not nudge an ended prescription', async () => {
    const { db, prescriptionId, lifecycle } = await setupRx();
    await lifecycle.endCourse(prescriptionId);
    const h = harness();

    await handleRefillReminder(prescriptionId, { db, pusher: h.pusher, notifyPharmacy: h.notifyPharmacy });

    expect(h.pushes.length).toBe(0);
    expect(h.notices.length).toBe(0);
  });
});
