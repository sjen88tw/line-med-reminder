import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { makeDashboardService } from '../src/dashboard/dashboard-service.js';
import { createApp } from '../src/server.js';
import type { Pusher } from '../src/line/push.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function makeServer() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  // Start far in the past so it's overdue regardless of the wall clock (the API
  // routes use new Date()). daysLeft will be very negative -> always at-risk.
  const { prescriptionId } = await makePrescriptionService(db).create({
    memberId: member.id,
    startDate: '2020-01-01',
    days: 7,
    meds: [{ name: '高血壓藥', qty: 1, freq: 'QD', timing: '飯後' }],
  });
  const pushes: unknown[] = [];
  const pusher: Pusher = { async push(_to, m) { pushes.push(m); } };
  const app = createApp({
    channelSecret: 'test',
    members: makeMemberService(db),
    dashboard: makeDashboardService({ db, pusher }),
  });
  return { app, prescriptionId, pushes };
}

describe('dashboard API (#08)', () => {
  it('GET /api/dashboard/at-risk returns the overdue prescription', async () => {
    const { app } = await makeServer();
    const res = await request(app).get('/api/dashboard/at-risk');
    expect(res.status).toBe(200);
    expect(res.body.atRisk.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/dashboard/metrics returns the four numbers', async () => {
    const { app } = await makeServer();
    const res = await request(app).get('/api/dashboard/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('refillRate');
    expect(res.body).toHaveProperty('adherenceRate');
    expect(res.body).toHaveProperty('atRiskCount');
    expect(res.body).toHaveProperty('recovered');
  });

  it('POST /api/dashboard/remind/:id sends a nudge (200)', async () => {
    const { app, prescriptionId, pushes } = await makeServer();
    const res = await request(app).post('/api/dashboard/remind/' + prescriptionId);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(pushes.length).toBe(1);
  });
});
