export interface JobQueue {
  // Schedule `payload` to run under job `name` at `runAt`. The implementation
  // (pg-boss) persists this so a process restart does not drop pending jobs.
  schedule(name: string, payload: unknown, runAt: Date): Promise<void>;
}

export const JOB_REMINDER = 'dose.reminder';
export const JOB_ESCALATION = 'dose.escalation';

// Push the reminder N minutes before the dose; check for confirmation 3 minutes
// after (then escalate). Both are persisted jobs.
export const REMINDER_LEAD_MIN = 5;
export const ESCALATION_DELAY_MIN = 3;

export interface DoseJobPayload {
  doseEventId: string;
}

export interface SchedulableDose {
  doseEventId: string;
  scheduledAt: Date;
}

function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

export async function scheduleForDose(
  queue: JobQueue,
  dose: SchedulableDose,
): Promise<void> {
  await queue.schedule(
    JOB_REMINDER,
    { doseEventId: dose.doseEventId } satisfies DoseJobPayload,
    addMinutes(dose.scheduledAt, -REMINDER_LEAD_MIN),
  );
  await queue.schedule(
    JOB_ESCALATION,
    { doseEventId: dose.doseEventId } satisfies DoseJobPayload,
    addMinutes(dose.scheduledAt, ESCALATION_DELAY_MIN),
  );
}
