import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { makeConfirmService } from '../src/dosing/confirm-service.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function setupWithOneDose() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const rx = makePrescriptionService(db);
  const { prescriptionId } = await rx.create({
    memberId: member.id,
    startDate: '2026-06-20',
    days: 1,
    meds: [{ name: 'A', qty: 1, freq: 'QD', timing: '飯後' }],
  });
  const { rows } = await db.query('SELECT id FROM dose_event WHERE prescription_id = $1', [
    prescriptionId,
  ]);
  return { db, confirms: makeConfirmService(db), doseId: rows[0].id as string };
}

describe('confirm service (idempotent 已服藥)', () => {
  it('confirms a REMINDED dose and sets confirmed_at', async () => {
    const { db, confirms, doseId } = await setupWithOneDose();
    await db.query(`UPDATE dose_event SET status = 'REMINDED' WHERE id = $1`, [doseId]);

    const outcome = await confirms.confirm(doseId);

    expect(outcome).toBe('confirmed');
    const { rows } = await db.query('SELECT status, confirmed_at FROM dose_event WHERE id = $1', [doseId]);
    expect(rows[0].status).toBe('CONFIRMED');
    expect(rows[0].confirmed_at).not.toBeNull();
  });

  it('is idempotent: a second tap reports "already" and does not double count', async () => {
    const { db, confirms, doseId } = await setupWithOneDose();
    await db.query(`UPDATE dose_event SET status = 'REMINDED' WHERE id = $1`, [doseId]);

    expect(await confirms.confirm(doseId)).toBe('confirmed');
    const first = (await db.query('SELECT confirmed_at FROM dose_event WHERE id = $1', [doseId])).rows[0].confirmed_at;
    expect(await confirms.confirm(doseId)).toBe('already');
    const second = (await db.query('SELECT confirmed_at FROM dose_event WHERE id = $1', [doseId])).rows[0].confirmed_at;
    // confirmed_at unchanged by the second tap
    expect(String(second)).toBe(String(first));
  });

  it('rejects confirming a dose that was never reminded (SCHEDULED)', async () => {
    const { confirms, doseId } = await setupWithOneDose();
    expect(await confirms.confirm(doseId)).toBe('not_applicable');
  });

  it('returns not_applicable for an unknown dose id', async () => {
    const { confirms } = await setupWithOneDose();
    expect(await confirms.confirm('does-not-exist')).toBe('not_applicable');
  });
});
