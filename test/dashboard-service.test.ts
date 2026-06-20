import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { makeDashboardService } from '../src/dashboard/dashboard-service.js';
import type { Pusher } from '../src/line/push.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function setup() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '陳阿明');
  const { prescriptionId } = await makePrescriptionService(db).create({
    memberId: member.id,
    startDate: '2026-06-20',
    days: 1,
    meds: [{ name: '高血壓藥', qty: 1, freq: 'TID', timing: '飯後' }],
  });
  const ids = (
    await db.query('SELECT id FROM dose_event WHERE prescription_id=$1 ORDER BY scheduled_at', [prescriptionId])
  ).rows.map((r) => r.id as string);
  const pushes: { to: string }[] = [];
  const pusher: Pusher = { async push(to) { pushes.push({ to }); } };
  return { db, prescriptionId, ids, pushes, dash: makeDashboardService({ db, pusher }) };
}

describe('dashboard service (#08)', () => {
  it('atRisk lists prescriptions running out within threshold, sorted, with risk', async () => {
    const { dash } = await setup();
    // course ends 2026-06-21; asOf 2026-06-20 -> 1 day left -> high risk
    const rows = await dash.atRisk(new Date('2026-06-20T00:00:00Z'));
    expect(rows.length).toBe(1);
    expect(rows[0].daysLeft).toBe(1);
    expect(rows[0].risk).toBe('high');
    expect(rows[0].drugSummary).toContain('高血壓藥');
    expect(rows[0].memberName).toBe('陳阿明');
  });

  it('atRisk excludes prescriptions not yet near the end', async () => {
    const { dash } = await setup();
    const rows = await dash.atRisk(new Date('2026-06-10T00:00:00Z')); // 11 days left
    expect(rows.length).toBe(0);
  });

  it('row adherence reflects confirmed vs missed', async () => {
    const { db, ids, dash } = await setup();
    await db.query(`UPDATE dose_event SET status='CONFIRMED' WHERE id IN ($1,$2)`, [ids[0], ids[1]]);
    await db.query(`UPDATE dose_event SET status='MISSED' WHERE id=$1`, [ids[2]]);

    const rows = await dash.atRisk(new Date('2026-06-20T00:00:00Z'));
    expect(rows[0].adherenceRate).toBeCloseTo(2 / 3, 5);
  });

  it('metrics aggregates refill rate, adherence, at-risk count, recovered', async () => {
    const { db, ids, dash } = await setup();
    await db.query(`UPDATE dose_event SET status='CONFIRMED' WHERE id IN ($1,$2)`, [ids[0], ids[1]]);
    await db.query(`UPDATE dose_event SET status='MISSED' WHERE id=$1`, [ids[2]]);

    const m = await dash.metrics(new Date('2026-06-20T00:00:00Z'));
    expect(m.adherenceRate).toBeCloseTo(2 / 3, 5);
    expect(m.atRiskCount).toBe(1);
    expect(m.recovered).toBe(0);
    expect(m.refillRate).toBe(0);
  });

  it('remind pushes a refill nudge and records refill_reminded_at', async () => {
    const { db, prescriptionId, pushes, dash } = await setup();
    expect(await dash.remind(prescriptionId)).toBe(true);
    expect(pushes.length).toBe(1);
    const { rows } = await db.query('SELECT refill_reminded_at FROM prescription WHERE id=$1', [prescriptionId]);
    expect(rows[0].refill_reminded_at).not.toBeNull();
  });
});
