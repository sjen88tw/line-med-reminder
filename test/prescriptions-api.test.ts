import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makePrescriptionService } from '../src/prescription/prescription-service.js';
import { validateCreatePrescription } from '../src/api/prescriptions.js';
import { createApp } from '../src/server.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

const goodMed = { name: '高血壓藥', qty: 1, freq: 'TID', timing: '飯後' };

describe('validateCreatePrescription', () => {
  it('accepts a well-formed prescription', () => {
    const r = validateCreatePrescription({ memberId: 1, startDate: '2026-06-20', days: 7, meds: [goodMed] });
    expect(r.ok).toBe(true);
  });

  it('rejects a missing frequency', () => {
    const r = validateCreatePrescription({ memberId: 1, startDate: '2026-06-20', days: 7, meds: [{ ...goodMed, freq: undefined }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('freq');
  });

  it('rejects days out of range', () => {
    expect(validateCreatePrescription({ memberId: 1, startDate: '2026-06-20', days: 0, meds: [goodMed] }).ok).toBe(false);
    expect(validateCreatePrescription({ memberId: 1, startDate: '2026-06-20', days: 999, meds: [goodMed] }).ok).toBe(false);
  });

  it('rejects empty meds and bad qty', () => {
    expect(validateCreatePrescription({ memberId: 1, startDate: '2026-06-20', days: 7, meds: [] }).ok).toBe(false);
    expect(validateCreatePrescription({ memberId: 1, startDate: '2026-06-20', days: 7, meds: [{ ...goodMed, qty: 0 }] }).ok).toBe(false);
  });

  it('rejects a malformed start date', () => {
    expect(validateCreatePrescription({ memberId: 1, startDate: '06/20/2026', days: 7, meds: [goodMed] }).ok).toBe(false);
  });
});

async function makeServer() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const member = await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const app = createApp({
    channelSecret: 'test',
    members: makeMemberService(db),
    prescriptions: makePrescriptionService(db),
  });
  return { db, app, memberId: member.id };
}

describe('POST /api/prescriptions', () => {
  it('creates a prescription and materializes doses (201)', async () => {
    const { db, app, memberId } = await makeServer();
    const res = await request(app)
      .post('/api/prescriptions')
      .send({ memberId, startDate: '2026-06-20', days: 7, meds: [goodMed] });

    expect(res.status).toBe(201);
    expect(res.body.doseCount).toBe(21);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM dose_event WHERE prescription_id=$1', [res.body.prescriptionId]);
    expect(rows[0].n).toBe(21);
  });

  // Regression: ISSUE-003 — a non-existent memberId (FK violation) used to throw
  // an unhandled 500 (HTML body). Found by /qa on 2026-06-19.
  it('returns a clean 400 (not a 500 crash) for a non-existent memberId', async () => {
    const { app } = await makeServer();
    const res = await request(app)
      .post('/api/prescriptions')
      .send({ memberId: 999999, startDate: '2026-06-20', days: 7, meds: [goodMed] });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('returns 400 with errors for invalid input', async () => {
    const { app } = await makeServer();
    const res = await request(app)
      .post('/api/prescriptions')
      .send({ memberId: 1, startDate: 'bad', days: 0, meds: [] });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});
