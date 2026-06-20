import { describe, it, expect } from 'vitest';
import {
  scheduleLifecycle,
  JOB_REFILL,
  JOB_END_COURSE,
  type JobQueue,
} from '../src/scheduler/scheduler.js';

describe('scheduleLifecycle (#05)', () => {
  it('schedules a refill nudge R days before the end and an end-course job', async () => {
    const jobs: { name: string; payload: any; runAt: Date }[] = [];
    const queue: JobQueue = {
      async schedule(name, payload, runAt) {
        jobs.push({ name, payload, runAt });
      },
    };

    // start 2026-06-20, 7 days -> ends 2026-06-27; R=2 -> refill on 2026-06-25
    await scheduleLifecycle(queue, {
      prescriptionId: 42,
      startDate: '2026-06-20',
      days: 7,
      refillLeadDays: 2,
    });

    const refill = jobs.find((j) => j.name === JOB_REFILL)!;
    const endCourse = jobs.find((j) => j.name === JOB_END_COURSE)!;

    expect(refill.payload).toEqual({ prescriptionId: 42 });
    // 2026-06-25 10:00 Taipei = 02:00 UTC
    expect(refill.runAt.toISOString()).toBe('2026-06-25T02:00:00.000Z');
    // 2026-06-27 09:00 Taipei = 01:00 UTC
    expect(endCourse.runAt.toISOString()).toBe('2026-06-27T01:00:00.000Z');
  });
});
