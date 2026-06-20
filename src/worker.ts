import { Pool } from 'pg';
import { messagingApi } from '@line/bot-sdk';
import { loadConfig } from './config.js';
import { startPgBoss } from './scheduler/pgboss-queue.js';
import {
  JOB_REMINDER,
  JOB_ESCALATION,
  JOB_REFILL,
  JOB_END_COURSE,
  type DoseJobPayload,
} from './scheduler/scheduler.js';
import { handleReminder } from './scheduler/reminder-job.js';
import { handleEscalation } from './scheduler/escalation-job.js';
import { handleRefillReminder } from './scheduler/refill-job.js';
import { makeLifecycleService } from './prescription/lifecycle.js';
import type { Pusher } from './line/push.js';

interface RxJobPayload {
  prescriptionId: number | string;
}

// Background worker: drains the reminder + escalation queues. Run as a separate
// process from the web server (`bun run worker`). Requires live Postgres + LINE.
async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = new Pool({ connectionString: cfg.databaseUrl });
  const lineApi = new messagingApi.MessagingApiClient({
    channelAccessToken: cfg.channelAccessToken,
  });

  const pusher: Pusher = {
    async push(to, messages) {
      await lineApi.pushMessage({ to, messages });
    },
  };
  const notifyPharmacy = async (text: string): Promise<void> => {
    // TODO #07/#08: push to the pharmacy official account / dashboard feed.
    console.log('[pharmacy]', text);
  };
  const markUnreachable = async (memberId: number | string): Promise<void> => {
    console.warn('[unreachable] member', memberId);
  };

  const { boss } = await startPgBoss(cfg.databaseUrl);

  await boss.work(JOB_REMINDER, async (jobs) => {
    for (const job of jobs) {
      await handleReminder((job.data as DoseJobPayload).doseEventId, {
        db: pool,
        pusher,
        markUnreachable,
      });
    }
  });
  await boss.work(JOB_ESCALATION, async (jobs) => {
    for (const job of jobs) {
      await handleEscalation((job.data as DoseJobPayload).doseEventId, {
        db: pool,
        pusher,
        notifyPharmacy,
      });
    }
  });

  await boss.work(JOB_REFILL, async (jobs) => {
    for (const job of jobs) {
      await handleRefillReminder((job.data as RxJobPayload).prescriptionId, {
        db: pool,
        pusher,
        notifyPharmacy,
      });
    }
  });

  const lifecycle = makeLifecycleService(pool);
  await boss.work(JOB_END_COURSE, async (jobs) => {
    for (const job of jobs) {
      await lifecycle.endCourse((job.data as RxJobPayload).prescriptionId);
    }
  });

  console.log('worker started: draining dose + prescription queues');
}

main().catch((err) => {
  console.error('fatal worker error', err);
  process.exit(1);
});
