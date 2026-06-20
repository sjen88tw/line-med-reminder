import PgBoss from 'pg-boss';
import {
  type JobQueue,
  JOB_REMINDER,
  JOB_ESCALATION,
  JOB_REFILL,
  JOB_END_COURSE,
  JOB_SWEEP,
} from './scheduler.js';

export interface PgBossHandle {
  queue: JobQueue;
  boss: PgBoss;
  stop(): Promise<void>;
}

// Starts pg-boss (Postgres-backed job queue) and creates the dose queues.
// Persistence — pending jobs survive a process restart — is pg-boss's core
// guarantee; that is why we do NOT roll our own setTimeout scheduler.
//
// NOTE: requires a live Postgres. Not exercised by the unit suite (which tests
// the queue-agnostic logic via a fake JobQueue). Verify end-to-end against a
// real DB before shipping (#03 acceptance criterion 4).
export async function startPgBoss(connectionString: string): Promise<PgBossHandle> {
  const boss = new PgBoss(connectionString);
  await boss.start();
  await boss.createQueue(JOB_REMINDER);
  await boss.createQueue(JOB_ESCALATION);
  await boss.createQueue(JOB_REFILL);
  await boss.createQueue(JOB_END_COURSE);
  await boss.createQueue(JOB_SWEEP);

  const queue: JobQueue = {
    async schedule(name: string, payload: unknown, runAt: Date): Promise<void> {
      await boss.send(name, (payload ?? {}) as object, {
        startAfter: runAt,
        retryLimit: 5,
        retryBackoff: true,
      });
    },
  };

  return { queue, boss, stop: () => boss.stop() };
}
