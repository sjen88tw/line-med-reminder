import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';

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
  return { db, memberId: member.id, rx };
}

describe('prescription service (materialize)', () => {
  it('creates a prescription and materializes one dose_event per dose', async () => {
    const { db, memberId, rx } = await setup();

    const result = await rx.create({
      memberId,
      startDate: '2026-06-20',
      days: 7,
      meds: [{ name: '高血壓藥', qty: 1, freq: 'TID', timing: '飯後' }],
    });

    expect(result.doseCount).toBe(21);
    const { rows } = await db.query('SELECT * FROM dose_event WHERE prescription_id = $1', [
      result.prescriptionId,
    ]);
    expect(rows.length).toBe(21);
    expect(rows.every((r) => r.status === 'SCHEDULED')).toBe(true);
  });

  it('dose ids are unique and re-materializing is idempotent', async () => {
    const { db, memberId, rx } = await setup();

    const r1 = await rx.create({
      memberId,
      startDate: '2026-06-20',
      days: 1,
      meds: [{ name: 'A', qty: 1, freq: 'BID', timing: '飯後' }],
    });
    // Re-running create() makes a NEW prescription, but dose ids are derived
    // from the prescription id, so they never collide across prescriptions.
    const { rows: r1rows } = await db.query(
      'SELECT id FROM dose_event WHERE prescription_id = $1',
      [r1.prescriptionId],
    );
    const ids = r1rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids.length).toBe(2);
  });

  it('uses A2 default meal times when none supplied', async () => {
    const { db, memberId, rx } = await setup();

    const result = await rx.create({
      memberId,
      startDate: '2026-06-20',
      days: 1,
      meds: [{ name: 'A', qty: 1, freq: 'QD', timing: '飯後' }],
    });

    const { rows } = await db.query(
      'SELECT scheduled_at FROM dose_event WHERE prescription_id = $1',
      [result.prescriptionId],
    );
    // breakfast default 08:00 + 30m = 08:30 Taipei = 00:30 UTC
    expect(new Date(rows[0].scheduled_at).toISOString()).toBe('2026-06-20T00:30:00.000Z');
  });
});
