import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { handleEscalation } from '../src/scheduler/escalation-job.js';
import type { Pusher } from '../src/line/push.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function setupDose() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const { prescriptionId } = await makePrescriptionService(db).create({
    memberId: member.id,
    startDate: '2026-06-20',
    days: 1,
    meds: [{ name: 'A', qty: 1, freq: 'QD', timing: '飯後' }],
  });
  const doseId = (
    await db.query('SELECT id FROM dose_event WHERE prescription_id = $1', [prescriptionId])
  ).rows[0].id as string;
  return { db, doseId };
}

function harness() {
  const pushes: unknown[] = [];
  const notices: string[] = [];
  const pusher: Pusher = { async push(_to, messages) { pushes.push(messages); } };
  const notifyPharmacy = async (text: string) => { notices.push(text); };
  return { pushes, notices, pusher, notifyPharmacy };
}

const statusOf = (db: Queryable, id: string) =>
  db.query('SELECT status FROM dose_event WHERE id=$1', [id]).then((r) => r.rows[0].status);

describe('handleEscalation', () => {
  it('escalates a REMINDED dose: status ESCALATED, push + pharmacy notice', async () => {
    const { db, doseId } = await setupDose();
    await db.query(`UPDATE dose_event SET status='REMINDED' WHERE id=$1`, [doseId]);
    const h = harness();

    await handleEscalation(doseId, { db, pusher: h.pusher, notifyPharmacy: h.notifyPharmacy });

    expect(await statusOf(db, doseId)).toBe('ESCALATED');
    expect(h.pushes.length).toBe(1);
    expect(h.notices.some((n) => n.includes('逾時'))).toBe(true);
  });

  it('does not escalate a CONFIRMED dose', async () => {
    const { db, doseId } = await setupDose();
    await db.query(`UPDATE dose_event SET status='CONFIRMED' WHERE id=$1`, [doseId]);
    const h = harness();

    await handleEscalation(doseId, { db, pusher: h.pusher, notifyPharmacy: h.notifyPharmacy });

    expect(h.pushes.length).toBe(0);
    expect(h.notices.length).toBe(0);
    expect(await statusOf(db, doseId)).toBe('CONFIRMED');
  });

  it('SCHEDULED (reminder never delivered) notifies pharmacy of non-delivery, no push', async () => {
    const { db, doseId } = await setupDose(); // stays SCHEDULED
    const h = harness();

    await handleEscalation(doseId, { db, pusher: h.pusher, notifyPharmacy: h.notifyPharmacy });

    expect(h.pushes.length).toBe(0);
    expect(h.notices.some((n) => n.includes('未送達'))).toBe(true);
  });
});
