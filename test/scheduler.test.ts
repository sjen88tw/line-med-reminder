import { describe, it, expect } from 'vitest';
import {
  scheduleForDose,
  JOB_REMINDER,
  JOB_ESCALATION,
  REMINDER_LEAD_MIN,
  ESCALATION_DELAY_MIN,
  type JobQueue,
} from '../src/scheduler/scheduler.js';

describe('scheduleForDose', () => {
  it('schedules a reminder before and an escalation after the dose time', async () => {
    const jobs: { name: string; payload: any; runAt: Date }[] = [];
    const queue: JobQueue = {
      async schedule(name, payload, runAt) {
        jobs.push({ name, payload, runAt });
      },
    };
    const at = new Date('2026-06-20T00:30:00.000Z');

    await scheduleForDose(queue, { doseEventId: 'd1', scheduledAt: at });

    expect(jobs.length).toBe(2);

    const reminder = jobs.find((j) => j.name === JOB_REMINDER)!;
    const escalation = jobs.find((j) => j.name === JOB_ESCALATION)!;

    expect(reminder.payload).toEqual({ doseEventId: 'd1' });
    expect(reminder.runAt.toISOString()).toBe(
      new Date(at.getTime() - REMINDER_LEAD_MIN * 60_000).toISOString(),
    );
    expect(escalation.runAt.toISOString()).toBe(
      new Date(at.getTime() + ESCALATION_DELAY_MIN * 60_000).toISOString(),
    );
  });
});
