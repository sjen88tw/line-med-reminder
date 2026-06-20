export interface JobQueue {
  // Schedule `payload` to run under job `name` at `runAt`. The implementation
  // (pg-boss) persists this so a process restart does not drop pending jobs.
  schedule(name: string, payload: unknown, runAt: Date): Promise<void>;
}

export const JOB_REMINDER = 'dose.reminder';
export const JOB_ESCALATION = 'dose.escalation';
export const JOB_REFILL = 'prescription.refill';
export const JOB_END_COURSE = 'prescription.end_course';

// #05: nudge the patient to refill this many days before the course runs out.
export const REFILL_LEAD_DAYS = 2;

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

function addDaysStr(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

// Taiwan wall-clock HH:00 -> UTC (UTC+8, no DST).
function taipeiAtHour(dateStr: string, hour: number): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, hour - 8, 0));
}

export interface PrescriptionLifecycleInput {
  prescriptionId: number | string;
  startDate: string; // "YYYY-MM-DD"
  days: number;
  refillLeadDays?: number;
}

export async function scheduleLifecycle(
  queue: JobQueue,
  p: PrescriptionLifecycleInput,
): Promise<void> {
  const lead = p.refillLeadDays ?? REFILL_LEAD_DAYS;
  // Refill nudge at 10:00 Taipei, R days before the course ends.
  await queue.schedule(
    JOB_REFILL,
    { prescriptionId: p.prescriptionId },
    taipeiAtHour(addDaysStr(p.startDate, p.days - lead), 10),
  );
  // End the course at 09:00 Taipei on the day after the last dosing day.
  await queue.schedule(
    JOB_END_COURSE,
    { prescriptionId: p.prescriptionId },
    taipeiAtHour(addDaysStr(p.startDate, p.days), 9),
  );
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
