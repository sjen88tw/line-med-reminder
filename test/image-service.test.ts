import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makeConsentService } from '../src/consent/consent-service.js';
import { makeImageService } from '../src/prescription/image-service.js';
import { InMemoryObjectStore } from '../src/storage/object-store.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function setup() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const store = new InMemoryObjectStore();
  const notices: string[] = [];
  const replies: string[] = [];
  const images = makeImageService({
    db,
    store,
    consent: makeConsentService(db),
    fetchContent: async () => ({ body: Buffer.from('img-bytes'), contentType: 'image/jpeg' }),
    notifyPharmacy: async (t) => {
      notices.push(t);
    },
    reply: async (_t, text) => {
      replies.push(text);
    },
  });
  return { db, store, images, notices, replies };
}

describe('image service (#06 upload + consent)', () => {
  it('without consent: requests consent, stores nothing', async () => {
    const { db, store, images, replies } = await setup();

    const outcome = await images.handleIncomingImage({
      lineUserId: 'U1',
      messageId: 'm1',
      replyToken: 'rt',
    });

    expect(outcome).toBe('consent_requested');
    expect(store.has('prescriptions/1/m1')).toBe(false);
    const { rows } = await db.query('SELECT * FROM prescription_image');
    expect(rows.length).toBe(0);
    expect(replies[0]).toContain('同意');
  });

  it('after consent: stores privately, records row, notifies pharmacy', async () => {
    const { db, store, images, notices, replies } = await setup();
    expect(await images.recordConsent('U1')).toBe(true);

    const outcome = await images.handleIncomingImage({
      lineUserId: 'U1',
      messageId: 'm1',
      replyToken: 'rt',
    });

    expect(outcome).toBe('stored');
    const { rows } = await db.query('SELECT * FROM prescription_image');
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
    expect(store.has(rows[0].object_key)).toBe(true);
    expect(notices.some((n) => n.includes('處方箋影像'))).toBe(true);
    expect(replies.some((r) => r.includes('已收到'))).toBe(true);
  });

  it('consent is idempotent', async () => {
    const { db, images } = await setup();
    await images.recordConsent('U1');
    await images.recordConsent('U1');
    const { rows } = await db.query('SELECT * FROM consent');
    expect(rows.length).toBe(1);
  });

  it('getSignedUrl returns a URL for a stored image, null for a missing id', async () => {
    const { db, images } = await setup();
    await images.recordConsent('U1');
    await images.handleIncomingImage({ lineUserId: 'U1', messageId: 'm1' });
    const { rows } = await db.query('SELECT id FROM prescription_image');

    const url = await images.getSignedUrl(rows[0].id, 600);
    expect(url).toContain('exp=600');
    expect(await images.getSignedUrl(999999)).toBeNull();
  });

  it('returns no_member for an unknown LINE user', async () => {
    const { images } = await setup();
    expect(
      await images.handleIncomingImage({ lineUserId: 'GHOST', messageId: 'm1' }),
    ).toBe('no_member');
  });
});
