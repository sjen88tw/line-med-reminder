import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { join } from 'node:path';
import { runMigrations } from '../src/db.js';
import { makeMemberService, type Queryable } from '../src/member/member-service.js';
import { makeConsentService } from '../src/consent/consent-service.js';
import { makeImageService } from '../src/prescription/image-service.js';
import { InMemoryObjectStore } from '../src/storage/object-store.js';
import type { Pusher } from '../src/line/push.js';

const MIGRATIONS = join(process.cwd(), 'db', 'migrations');

function makeDb(): Queryable {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as Queryable;
}

async function setupStoredImage() {
  const db = makeDb();
  await runMigrations(db, MIGRATIONS);
  await makeMemberService(db).upsertByLineUserId('U1', '阿明');
  const pushes: { to: string }[] = [];
  const pusher: Pusher = { async push(to) { pushes.push({ to }); } };
  const images = makeImageService({
    db,
    store: new InMemoryObjectStore(),
    consent: makeConsentService(db),
    fetchContent: async () => ({ body: Buffer.from('x'), contentType: 'image/jpeg' }),
    notifyPharmacy: async () => {},
    pusher,
  });
  await images.recordConsent('U1');
  await images.handleIncomingImage({ lineUserId: 'U1', messageId: 'm1' });
  const imageId = (await db.query('SELECT id FROM prescription_image')).rows[0].id as number;
  return { db, images, imageId, pushes };
}

describe('markUnreadable (#07 bad image)', () => {
  it('marks the image unreadable and asks the patient to resend', async () => {
    const { db, images, imageId, pushes } = await setupStoredImage();

    expect(await images.markUnreadable(imageId)).toBe(true);

    const { rows } = await db.query('SELECT status FROM prescription_image WHERE id=$1', [imageId]);
    expect(rows[0].status).toBe('unreadable');
    expect(pushes.length).toBe(1);
    expect(pushes[0].to).toBe('U1');
  });

  it('returns false (no double-push) when the image is not pending', async () => {
    const { images, imageId, pushes } = await setupStoredImage();
    await images.markUnreadable(imageId);
    const before = pushes.length;

    expect(await images.markUnreadable(imageId)).toBe(false);
    expect(pushes.length).toBe(before); // no second resend push
  });

  it('returns false for an unknown image id', async () => {
    const { images } = await setupStoredImage();
    expect(await images.markUnreadable(999999)).toBe(false);
  });
});
