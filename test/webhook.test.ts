import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { createApp } from '../src/server.js';

const SECRET = 'test-channel-secret';
const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

function sign(rawBody: string): string {
  return createHmac('sha256', SECRET).update(rawBody).digest('base64');
}

async function makeServer() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  const members = makeMemberService(db);
  const app = createApp({
    channelSecret: SECRET,
    members,
    getDisplayName: async () => '阿明',
  });
  return { app, db };
}

function followBody(userId: string): string {
  return JSON.stringify({
    destination: 'Udest',
    events: [
      {
        type: 'follow',
        mode: 'active',
        timestamp: 1,
        source: { type: 'user', userId },
        webhookEventId: 'ev1',
        deliveryContext: { isRedelivery: false },
        replyToken: 'rt1',
      },
    ],
  });
}

describe('POST /webhook', () => {
  it('rejects a forged signature with 401', async () => {
    const { app } = await makeServer();
    const body = JSON.stringify({ destination: 'x', events: [] });

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Line-Signature', 'definitely-not-valid')
      .send(body);

    expect(res.status).toBe(401);
  });

  it('accepts a valid follow event and creates a member', async () => {
    const { app, db } = await makeServer();
    const body = followBody('U1');

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Line-Signature', sign(body))
      .send(body);

    expect(res.status).toBe(200);
    const { rows } = await db.query('SELECT * FROM member WHERE line_user_id = $1', ['U1']);
    expect(rows.length).toBe(1);
  });

  it('is idempotent across duplicate follow events', async () => {
    const { app, db } = await makeServer();
    const body = followBody('U1');

    await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Line-Signature', sign(body))
      .send(body);
    await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Line-Signature', sign(body))
      .send(body);

    const { rows } = await db.query('SELECT * FROM member WHERE line_user_id = $1', ['U1']);
    expect(rows.length).toBe(1);
  });

  it('health check responds ok', async () => {
    const { app } = await makeServer();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
