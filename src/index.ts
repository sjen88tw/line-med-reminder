import { Readable } from 'node:stream';
import { Pool } from 'pg';
import { messagingApi } from '@line/bot-sdk';
import { loadConfig } from './config.js';
import { runMigrations } from './db.js';
import { makeMemberService } from './member/member-service.js';
import { makeConfirmService } from './dosing/confirm-service.js';
import { makeConsentService } from './consent/consent-service.js';
import { makeImageService } from './prescription/image-service.js';
import { makePrescriptionService } from './prescription/prescription-service.js';
import { InMemoryObjectStore } from './storage/object-store.js';
import { startPgBoss } from './scheduler/pgboss-queue.js';
import type { Pusher } from './line/push.js';
import { createApp } from './server.js';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const cfg = loadConfig();

  const pool = new Pool({ connectionString: cfg.databaseUrl });
  await runMigrations(pool);

  const members = makeMemberService(pool);
  const confirms = makeConfirmService(pool);

  const lineApi = new messagingApi.MessagingApiClient({
    channelAccessToken: cfg.channelAccessToken,
  });
  const getDisplayName = async (userId: string): Promise<string | null> => {
    try {
      const profile = await lineApi.getProfile(userId);
      return profile.displayName ?? null;
    } catch {
      // Profile lookup is best-effort; never block member creation on it.
      return null;
    }
  };
  const reply = async (replyToken: string, text: string): Promise<void> => {
    await lineApi.replyMessage({ replyToken, messages: [{ type: 'text', text }] });
  };

  // #06: prescription image upload. InMemoryObjectStore is a dev/pilot default;
  // swap in an S3/GCS adapter (private bucket + real signed URLs) for prod.
  const blobApi = new messagingApi.MessagingApiBlobClient({
    channelAccessToken: cfg.channelAccessToken,
  });
  const pusher: Pusher = {
    async push(to, messages) {
      await lineApi.pushMessage({ to, messages });
    },
  };
  const consent = makeConsentService(pool);
  const images = makeImageService({
    db: pool,
    store: new InMemoryObjectStore(),
    consent,
    fetchContent: async (messageId: string) => {
      const stream = await blobApi.getMessageContent(messageId);
      return { body: await streamToBuffer(stream as unknown as Readable), contentType: 'image/jpeg' };
    },
    notifyPharmacy: async (text: string) => {
      console.log('[pharmacy]', text);
    },
    reply,
    pusher,
  });

  // #07: prescription create API needs the queue so each dose gets reminder +
  // refill jobs at creation time. Web schedules; the worker process drains.
  const { queue } = await startPgBoss(cfg.databaseUrl);
  const prescriptions = makePrescriptionService(pool);

  const app = createApp({
    channelSecret: cfg.channelSecret,
    members,
    confirms,
    images,
    prescriptions,
    queue,
    getDisplayName,
    reply,
  });
  app.listen(cfg.port, () => {
    console.log(`line-med-reminder listening on :${cfg.port}`);
  });
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
